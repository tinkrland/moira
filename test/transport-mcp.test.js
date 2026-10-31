// mcp streamable http server (protocol 2025-11-25), exercised end to end
// over a real localhost http server with a memory-store moira.
//
// pins the spec requirements: origin validation, bearer auth on everything,
// session id lifecycle, 202 for notifications, error codes, tools/list and
// tools/call shape, 405 on GET.

import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createMoiraServer } from '../src/transport/server.js';
import { Moira } from '../src/index.js';

const KEY = 'ab'.repeat(32);
const ownerSession = () => ({ kind: 'owner_session', verified: true, ownerRef: 'owner' });

async function setup({ allowedOrigins = [] } = {}) {
  const m = new Moira({});
  const ctx = m.createOwnerContext(ownerSession());
  const persona = m.owner.createPersona(ctx, { name: 'student', identity: 'linked' });
  m.facts.add(persona, { content: 'midterm thursday at 9', category: 'schedule' });
  const agentId = m.owner.registerAgent(ctx, { name: 'helper', tier: 'verified', personasAllowed: [persona.id], spendCaps: { usd: 15 } }).id;
  m.owner.grantPass(ctx, { clientId: agentId, personaId: persona.id, category: 'schedule', purpose: 'research', maxRung: 4 , acknowledgeFull: true });
  const sess = m.owner.createSession(ctx, { clientId: agentId, personaId: persona.id });
  const moiraServer = createMoiraServer({
    moira: m, baseUrl: 'http://127.0.0.1:0', tokenKey: KEY, allowedOrigins, port: 0
  });
  // sign with the server's own token service so the issuer matches its config
  const jwt = moiraServer.tokens.signAccess({
    token: sess.accessToken, clientId: agentId, personaId: persona.id, sessionId: sess.session.id
  });
  const addr = await moiraServer.listen();
  const base = `http://127.0.0.1:${addr.port}`;
  return { base, jwt, m, ctx, persona, agentId, moiraServer };
}

async function rpc(base, body, { session, token, origin, protocolVersion, method = 'POST', raw = null } = {}) {
  const headers = {
    accept: 'application/json, text/event-stream',
    'content-type': 'application/json'
  };
  if (token) headers.authorization = `Bearer ${token}`;
  if (session) headers['mcp-session-id'] = session;
  if (origin) headers.origin = origin;
  if (protocolVersion) headers['mcp-protocol-version'] = protocolVersion;
  const res = await fetch(`${base}/mcp`, {
    method, headers, body: raw ?? JSON.stringify(body)
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch {}
  return { status: res.status, headers: res.headers, json, text };
}

async function initialize(base, jwt) {
  const res = await rpc(base, {
    jsonrpc: '2.0', id: 1, method: 'initialize',
    params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'test-client', version: '1.0' } }
  }, { token: jwt });
  const sid = res.headers.get('mcp-session-id');
  await rpc(base, { jsonrpc: '2.0', method: 'notifications/initialized' }, { session: sid, token: jwt });
  return { sid, res };
}

test('mcp: full handshake -> tools/list -> tools/call roundtrip', async () => {
  const { base, jwt, m, moiraServer } = await setup();
  try {
    const { sid, res } = await initialize(base, jwt);
    assert.equal(res.status, 200);
    assert.ok(sid && sid.length >= 16, 'session id assigned at initialization');
    assert.equal(res.json.result.protocolVersion, '2025-11-25');
    assert.equal(res.json.result.serverInfo.name, 'moira');
    assert.ok(res.json.result.capabilities.tools);

    const list = await rpc(base, { jsonrpc: '2.0', id: 2, method: 'tools/list' }, { session: sid, token: jwt });
    assert.equal(list.status, 200);
    assert.equal(list.json.result.tools.length, 33, 'all 33 agent tools exposed');
    const names = list.json.result.tools.map((t) => t.name);
    const facadeMethods = Object.getOwnPropertyNames(Object.getPrototypeOf(m.agent)).filter((k) => k !== 'constructor' && !k.startsWith('_'));
    for (const t of names) assert.ok(facadeMethods.includes(t), `tool ${t} missing from agentapi`);
    assert.ok(names.includes('moira_status') && names.includes('persona_context') && names.includes('request_disclosure'));
    for (const t of list.json.result.tools) {
      assert.equal(typeof t.description, 'string');
      assert.equal(t.inputSchema.type, 'object');
    }

    const call = await rpc(base, {
      jsonrpc: '2.0', id: 3, method: 'tools/call',
      params: { name: 'persona_context', arguments: { categories: ['schedule'], purpose: 'research' } }
    }, { session: sid, token: jwt });
    assert.equal(call.status, 200);
    const structured = call.json.result.structuredContent;
    assert.equal(structured.outcome, 'results');
    assert.equal(structured.categories.schedule.served[0].content, 'midterm thursday at 9');
    assert.equal(call.json.result.content[0].type, 'text');

    // a tool with explicit non-results outcome reports isError, per mcp semantics
    const denied = await rpc(base, {
      jsonrpc: '2.0', id: 4, method: 'tools/call',
      params: { name: 'persona_context', arguments: { categories: ['health'], purpose: 'research' } }
    }, { session: sid, token: jwt });
    assert.equal(denied.status, 200);
    assert.equal(denied.json.result.isError, true);
    assert.ok(denied.json.result.structuredContent.outcome !== 'results');
  } finally {
    await moiraServer.server.close();
  }
});

test('mcp: origin validation, auth, session lifecycle, protocol errors', async () => {
  const { base, jwt, moiraServer } = await setup({ allowedOrigins: ['https://good.example'] });
  try {
    // origin allow-list: bad origin 403, allowed origin passes, absent passes
    const bad = await rpc(base, { jsonrpc: '2.0', id: 1, method: 'ping' }, { token: jwt, origin: 'https://evil.example' });
    assert.equal(bad.status, 403);
    const good = await rpc(base, { jsonrpc: '2.0', id: 1, method: 'ping' }, { token: jwt, origin: 'https://good.example' });
    assert.equal(good.status, 200);
    assert.deepEqual(good.json.result, {});

    // auth: no bearer -> 401 with www-authenticate and resource metadata
    const noAuth = await rpc(base, { jsonrpc: '2.0', id: 2, method: 'tools/list' });
    assert.equal(noAuth.status, 401);
    assert.match(noAuth.headers.get('www-authenticate') || '', /bearer/i);
    const badToken = await rpc(base, { jsonrpc: '2.0', id: 2, method: 'tools/list' }, { token: 'not-a-jwt' });
    assert.equal(badToken.status, 401);

    // wrong protocol version -> 400
    const wrongPv = await rpc(base, {
      jsonrpc: '2.0', id: 3, method: 'initialize',
      params: { protocolVersion: '2024-11-05', capabilities: {} }
    }, { token: jwt, protocolVersion: '2024-11-05' });
    assert.equal(wrongPv.status, 400);

    // initialize assigns a session; calls without it 404; unknown id 404
    const { sid } = await initialize(base, jwt);
    const noSession = await rpc(base, { jsonrpc: '2.0', id: 5, method: 'tools/list' }, { token: jwt });
    assert.equal(noSession.status, 404);
    const ghost = await rpc(base, { jsonrpc: '2.0', id: 5, method: 'tools/list' }, { token: jwt, session: 'deadbeef' });
    assert.equal(ghost.status, 404);

    // calls before notifications/initialized are refused
    const fresh = await rpc(base, {
      jsonrpc: '2.0', id: 6, method: 'initialize',
      params: { protocolVersion: '2025-11-25', capabilities: {} }
    }, { token: jwt });
    const freshSid = fresh.headers.get('mcp-session-id');
    const tooEarly = await rpc(base, { jsonrpc: '2.0', id: 7, method: 'tools/list' }, { token: jwt, session: freshSid });
    assert.equal(tooEarly.status, 400);

    // json-rpc errors: parse error, unknown method, unknown tool
    const parseErr = await rpc(base, null, { token: jwt, session: sid, raw: '{not json' });
    assert.equal(parseErr.status, 400);
    assert.equal(parseErr.json.error.code, -32700);
    const unknownMethod = await rpc(base, { jsonrpc: '2.0', id: 8, method: 'resources/list' }, { token: jwt, session: sid });
    assert.equal(unknownMethod.json.error.code, -32601);
    const unknownTool = await rpc(base, { jsonrpc: '2.0', id: 9, method: 'tools/call', params: { name: 'steal_keys', arguments: {} } }, { token: jwt, session: sid });
    assert.equal(unknownTool.json.error.code, -32601);
    // smuggling attempts are rejected
    const smuggle = await rpc(base, { jsonrpc: '2.0', id: 10, method: 'tools/call', params: { name: 'moira_status', arguments: { accessToken: 'x' } } }, { token: jwt, session: sid });
    assert.equal(smuggle.json.error.code, -32602);

    // GET -> 405 per spec (no server-initiated streams); DELETE terminates
    const get405 = await fetch(`${base}/mcp`, { method: 'GET', headers: { accept: 'text/event-stream', authorization: `Bearer ${jwt}` } });
    assert.equal(get405.status, 405);
    const del = await fetch(`${base}/mcp`, { method: 'DELETE', headers: { 'mcp-session-id': sid, authorization: `Bearer ${jwt}` } });
    assert.equal(del.status, 204);
    const afterDelete = await rpc(base, { jsonrpc: '2.0', id: 11, method: 'tools/list' }, { token: jwt, session: sid });
    assert.equal(afterDelete.status, 404);
  } finally {
    await moiraServer.server.close();
  }
});
