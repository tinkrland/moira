// turnkey plug-in: the reference owner-session verifier, and proof that a
// server booted with it answers /authorize end to end (no custom glue).

import test from 'node:test';
import assert from 'node:assert/strict';
import { Moira } from '../src/index.js';
import { MemoryStore } from '../src/store.js';
import { createOwnerSessionVerifier } from '../src/transport/ownersession.js';
import { createMoiraServer } from '../src/transport/server.js';

const SECRET = 'correct horse battery staple 42';

function boot() {
  const m = new Moira({ store: new MemoryStore() });
  const ctx = m.createOwnerContext({ kind: 'owner_session', verified: true, ownerRef: 'owner' });
  const persona = m.owner.createPersona(ctx, { name: 'p', identity: 'linked' });
  const agentId = m.owner.registerAgent(ctx, { name: 'app', tier: 'verified', personasAllowed: [persona.id], spendCaps: { usd: 1 } }).id;
  return { m, ctx, persona, agentId };
}

test('owner session verifier: constant-time match, real OwnerContext, no leaks on failure', () => {
  const { m, ctx } = boot();
  const verify = createOwnerSessionVerifier({ moira: m, secret: SECRET, ownerRef: 'owner' });

  // header, bearer, and cookie all work
  assert.ok(verify({ headers: { 'x-moira-owner': SECRET } }), 'header accepted');
  assert.ok(verify({ headers: { authorization: `Bearer ${SECRET}` } }), 'bearer accepted');
  assert.ok(verify({ headers: { cookie: `theme=dark; moira_owner=${encodeURIComponent(SECRET)}` } }), 'cookie accepted');

  // wrong, missing, empty, and same-length-wrong are all rejected
  assert.equal(verify({ headers: {} }), null, 'missing rejected');
  assert.equal(verify({ headers: { 'x-moira-owner': '' } }), null, 'empty rejected');
  assert.equal(verify({ headers: { 'x-moira-owner': 'wrong horse battery staple 42' } }), null, 'same-length wrong rejected');
  assert.equal(verify({ headers: { 'x-moira-owner': 'short' } }), null, 'wrong-length rejected');
  assert.equal(verify({ headers: { authorization: 'Bearer nope' } }), null, 'wrong bearer rejected');

  // the minted context is usable on the owner surface (it is a real context,
  // not a bare object: {owner:true} is rejected by design)
  const got = verify({ headers: { 'x-moira-owner': SECRET } });
  const made = m.owner.createPersona(got, { name: 'second', identity: 'linked' });
  assert.ok(made && made.id, 'owner surface accepts the minted context');

  // weak secrets refuse to construct
  assert.throws(() => createOwnerSessionVerifier({ moira: m, secret: 'tiny' }), /at least 16/);
});

test('turnkey: a server booted with the verifier completes the authorize step', async () => {
  const { m, ctx, persona, agentId } = boot();
  const verify = createOwnerSessionVerifier({ moira: m, secret: SECRET });
  const server = createMoiraServer({ moira: m, baseUrl: 'http://127.0.0.1:8080', tokenKey: 'ab'.repeat(32), getOwnerContext: verify, port: 0 });
  const bound = await server.listen();
  const addr = `http://127.0.0.1:${bound.port}`;
  assert.ok(bound.port, 'server exposes its bound port');

  const challenge = 'E'.repeat(43); // s256 shape; the code mint does not re-hash it
  const authorize = (headers) => fetch(
    `${addr}/authorize?client_id=${encodeURIComponent(agentId)}&persona_id=${encodeURIComponent(persona.id)}&redirect_uri=${encodeURIComponent('http://app.local/cb')}&code_challenge=${challenge}&code_challenge_method=S256&state=s1`,
    { headers, redirect: 'manual' }
  );

  // without the secret: 401, the honest default
  const anon = await authorize({});
  assert.equal(anon.status, 401);

  // with the secret: a redirect carrying a code
  const authed = await authorize({ 'x-moira-owner': SECRET });
  assert.equal(authed.status, 302);
  const loc = authed.headers.get('location');
  assert.match(loc, /[?&]code=/);

  await new Promise((resolve) => server.server.close(resolve));
});
