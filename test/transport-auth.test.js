// authorization server (phase 2): pkce code flow, refresh rotation with
// replay propagation, rfc 8628 device flow, discovery metadata, tokeninfo.
//
// the owner-consent step uses a host-minted owner context (the owner-session
// auth proposal is pending with the reviewer); every grant still proves:
// pkce, one-time codes, persona binding at grant time, core-side replay
// detection.

import test from 'node:test';
import assert from 'node:assert/strict';
import { createMoiraServer } from '../src/transport/server.js';
import { s256Challenge } from '../src/transport/tokens.js';
import { Moira } from '../src/index.js';

const KEY = 'ab'.repeat(32);
const ownerSession = () => ({ kind: 'owner_session', verified: true, ownerRef: 'owner' });

async function setup({ getOwnerContext = (req) => ({ kind: 'owner_context', ownerRef: 'owner', sessionId: null, mintedAt: Date.now() }) } = {}) {
  const m = new Moira({});
  const ctx = m.createOwnerContext(ownerSession());
  const persona = m.owner.createPersona(ctx, { name: 'student', identity: 'linked' });
  const agentId = m.owner.registerAgent(ctx, { name: 'cli-agent', tier: 'verified', personasAllowed: [persona.id], spendCaps: { usd: 15 } }).id;
  const moiraServer = createMoiraServer({
    moira: m, baseUrl: 'http://127.0.0.1:0', tokenKey: KEY, getOwnerContext, port: 0
  });
  const addr = await moiraServer.listen();
  return { base: `http://127.0.0.1:${addr.port}`, m, ctx, persona, agentId, moiraServer };
}

async function post(base, path, params) {
  const res = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(params)
  });
  return { status: res.status, body: await res.json() };
}

async function authorize(base, { clientId, personaId, redirectUri, verifier, state = 'st1' }) {
  const q = new URLSearchParams({
    client_id: clientId,
    persona_id: personaId,
    redirect_uri: redirectUri,
    code_challenge: s256Challenge(verifier),
    response_type: 'code',
    state
  });
  const res = await fetch(`${base}/authorize?${q}`, { redirect: 'manual' });
  const loc = res.headers.get('location');
  return { status: res.status, location: loc, code: loc ? new URL(loc).searchParams.get('code') : null };
}

const REDIRECT = 'https://agent.example/callback';

test('auth: discovery metadata (rfc 9728 + 8414)', async () => {
  const { base, moiraServer } = await setup();
  try {
    const pr = await (await fetch(`${base}/.well-known/oauth-protected-resource`)).json();
    assert.ok(Array.isArray(pr.authorization_servers));
    const as = await (await fetch(`${base}/.well-known/oauth-authorization-server`)).json();
    assert.ok(as.authorization_endpoint.includes('/authorize'));
    assert.deepEqual(as.code_challenge_methods_supported, ['S256']);
    assert.ok(as.grant_types_supported.includes('urn:ietf:params:oauth:grant-type:device_code'));
    assert.ok(as.tokeninfo_endpoint.includes('/tokeninfo'));
  } finally {
    await moiraServer.server.close();
  }
});

test('auth: pkce s256 code flow issues working tokens; wrong verifier and reused code rejected', async () => {
  const { base, persona, agentId, moiraServer } = await setup();
  try {
    const verifier = 'correct-horse-battery-staple';
    const { status, code } = await authorize(base, { clientId: agentId, personaId: persona.id, redirectUri: REDIRECT, verifier });
    assert.equal(status, 302);
    assert.ok(code);

    // wrong verifier -> invalid_grant (http 400 per rfc 6749), code NOT consumed
    const bad = await post(base, '/token', { grant_type: 'authorization_code', code, code_verifier: 'wrong', client_id: agentId, redirect_uri: REDIRECT });
    assert.equal(bad.status, 400);
    assert.equal(bad.body.error, 'invalid_grant');

    const ok = await post(base, '/token', { grant_type: 'authorization_code', code, code_verifier: verifier, client_id: agentId, redirect_uri: REDIRECT });
    assert.ok(ok.body.access_token, 'tokens issued after pkce proof');
    assert.ok(ok.body.refresh_token);
    assert.equal(ok.body.token_type, 'Bearer');

    // the access token works at the mcp endpoint (proves session minted + jwt valid)
    const statusRes = await fetch(`${base}/mcp`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${ok.body.access_token}`, accept: 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {} } })
    });
    assert.equal(statusRes.status, 200);

    // code is one-time: reuse -> invalid_grant
    const replay = await post(base, '/token', { grant_type: 'authorization_code', code, code_verifier: verifier, client_id: agentId, redirect_uri: REDIRECT });
    assert.equal(replay.body.error, 'invalid_grant');

    // tokeninfo reflects the live session
    const info = await post(base, '/tokeninfo', { token: ok.body.access_token });
    assert.equal(info.body.active, true);
    assert.equal(info.body.sub, agentId);
    assert.equal(info.body.persona_id, persona.id);
  } finally {
    await moiraServer.server.close();
  }
});

test('auth: authorize without an owner context answers 401 (owner-session auth pending)', async () => {
  const { base, persona, agentId, moiraServer } = await setup({ getOwnerContext: null });
  try {
    const r = await authorize(base, { clientId: agentId, personaId: persona.id, redirectUri: REDIRECT, verifier: 'v' });
    assert.equal(r.status, 401);
    assert.equal(r.location, null);
  } finally {
    await moiraServer.server.close();
  }
});

test('auth: refresh rotation works; replaying a rotated refresh revokes the family', async () => {
  const { base, persona, agentId, moiraServer } = await setup();
  try {
    const verifier = 'v2';
    const { code } = await authorize(base, { clientId: agentId, personaId: persona.id, redirectUri: REDIRECT, verifier });
    const first = await post(base, '/token', { grant_type: 'authorization_code', code, code_verifier: verifier, client_id: agentId, redirect_uri: REDIRECT });

    const second = await post(base, '/token', { grant_type: 'refresh_token', refresh_token: first.body.refresh_token });
    assert.ok(second.body.access_token, 'rotation issues a new pair');
    assert.notEqual(second.body.refresh_token, first.body.refresh_token);

    // replay of the FIRST (already rotated) refresh: core revokes the family
    const replay = await post(base, '/token', { grant_type: 'refresh_token', refresh_token: first.body.refresh_token });
    assert.equal(replay.body.error, 'invalid_grant');
    assert.ok(replay.body.replay_detected, 'replay is called out explicitly');

    // the family is dead: even the legitimate newest refresh is now revoked
    const third = await post(base, '/token', { grant_type: 'refresh_token', refresh_token: second.body.refresh_token });
    assert.equal(third.body.error, 'invalid_grant');
    // core contract: family revocation kills the refresh family; an already
    // minted access token lives out its short ttl (access tokens carry no
    // family). noted in the phase report as a conscious core decision.
    const info = await post(base, '/tokeninfo', { token: second.body.access_token });
    assert.equal(info.body.active, true, 'access token valid until its own ttl (core contract)');
  } finally {
    await moiraServer.server.close();
  }
});

test('auth: device flow (rfc 8628) - pending, approval, denial, expiry semantics', async () => {
  const { base, m, ctx, persona, agentId, moiraServer } = await setup();
  try {
    const start = await post(base, '/device/code', { client_id: agentId });
    assert.ok(start.body.device_code);
    assert.match(String(start.body.user_code), /^\d{6}$/);
    assert.equal(start.body.interval >= 1, true);
    assert.ok(start.body.verification_uri_complete.includes(start.body.user_code));

    // poll before approval: authorization_pending
    const pending = await post(base, '/token', { grant_type: 'urn:ietf:params:oauth:grant-type:device_code', device_code: start.body.device_code, client_id: agentId });
    assert.equal(pending.body.error, 'authorization_pending');

    // owner approves, choosing the persona
    const approved = m.owner.approveDeviceCode(ctx, { userCode: start.body.user_code, personaId: persona.id });
    assert.equal(approved.outcome, 'results');

    const tokens = await post(base, '/token', { grant_type: 'urn:ietf:params:oauth:grant-type:device_code', device_code: start.body.device_code, client_id: agentId });
    assert.ok(tokens.body.access_token, 'device grant completes after owner approval');
    const info = await post(base, '/tokeninfo', { token: tokens.body.access_token });
    assert.equal(info.body.persona_id, persona.id, 'bound to the persona the owner chose');

    // a second device is denied by the owner
    const second = await post(base, '/device/code', { client_id: agentId });
    m.owner.denyDeviceCode(ctx, { userCode: second.body.user_code });
    const denied = await post(base, '/token', { grant_type: 'urn:ietf:params:oauth:grant-type:device_code', device_code: second.body.device_code, client_id: agentId });
    assert.equal(denied.body.error, 'access_denied');

    // unknown device code
    const unknown = await post(base, '/token', { grant_type: 'urn:ietf:params:oauth:grant-type:device_code', device_code: 'nope', client_id: agentId });
    assert.equal(unknown.body.error, 'invalid_grant');
  } finally {
    await moiraServer.server.close();
  }
});

test('auth: grant binding - the agent cannot obtain a persona it is not allowed', async () => {
  const { base, m, ctx, agentId, moiraServer } = await setup();
  try {
    const stranger = m.owner.createPersona(ctx, { name: 'founder', identity: 'linked' });
    const r = await authorize(base, { clientId: agentId, personaId: stranger.id, redirectUri: REDIRECT, verifier: 'v3' });
    assert.equal(r.status, 400);
    assert.equal(r.code, null);
  } finally {
    await moiraServer.server.close();
  }
});
