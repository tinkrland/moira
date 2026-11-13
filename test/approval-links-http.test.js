// the link has to work for someone who is not logged in (2026-11-13).

import test from 'node:test';
import assert from 'node:assert/strict';
import { Moira } from '../src/index.js';
import { MemoryStore } from '../src/store.js';
import { createOwnerSessionVerifier } from '../src/transport/ownersession.js';
import { createMoiraServer } from '../src/transport/server.js';

const SECRET = 'a-long-enough-owner-secret-88';

async function boot() {
  const m = new Moira({ store: new MemoryStore() });
  const a = m.createOwnerContext({ kind: 'owner_session', verified: true, ownerRef: 'owner-a' });
  const p = m.owner.createPersona(a, { name: 'alex-work', identity: 'pseudonymous' });
  m.facts.add(p, { content: 'ships on fridays', category: 'preferences', rungs: { summary: 'ships fridays' } });
  const agentId = m.owner.registerAgent(a, { name: 'planner', tier: 'verified', personasAllowed: [p.id], spendCaps: { usd: 1 } }).id;
  const token = m.owner.createSession(a, { clientId: agentId, personaId: p.id }).accessToken;
  const { request } = m.agent.request_access(token, { categories: ['preferences'], purpose: 'draft the weekly note', duration: 'session' });
  const verify = createOwnerSessionVerifier({ moira: m, secret: SECRET });
  const server = createMoiraServer({ moira: m, baseUrl: 'http://127.0.0.1:8084', tokenKey: 'ab'.repeat(32), getOwnerContext: verify, port: 0 });
  const bound = await server.listen();
  return { m, p, request, server, base: `http://127.0.0.1:${bound.port}`, H: { 'content-type': 'application/json', 'x-moira-owner': SECRET } };
}

test('approval links over http: minted by the owner, read and spent without a session', async (t) => {
  const { base, server, H, request, m, p } = await boot();
  t.after(() => new Promise((r) => server.server.close(r)));

  const anon = await fetch(base + '/api/requests/link', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ requestId: request.id }) });
  assert.equal(anon.status, 401, 'minting needs owner authority');

  const minted = await fetch(base + '/api/requests/link', { method: 'POST', headers: H, body: JSON.stringify({ requestId: request.id }) });
  assert.equal(minted.status, 200);
  const { token, url } = await minted.json();
  assert.match(token, /^appr_/);
  assert.ok(url.endsWith(token), 'the link carries the token and nothing else');

  // no owner header on either of these, on purpose
  const peek = await fetch(base + `/api/approvals/${token}`);
  assert.equal(peek.status, 200);
  const seen = await peek.json();
  assert.equal(seen.request.purpose, 'draft the weekly note');
  assert.equal(seen.request.status, 'pending');
  assert.equal(seen.facts, undefined, 'a link never shows a fact');

  const decided = await fetch(base + `/api/approvals/${token}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ decision: 'deny', reason: 'not today' })
  });
  assert.equal(decided.status, 200);
  assert.equal((await decided.json()).decision, 'deny');
  assert.equal(m.store.get('accessRequests', request.id).status, 'denied');

  const again = await fetch(base + `/api/approvals/${token}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ decision: 'approve' })
  });
  assert.equal(again.status, 409, 'single use means single use');
  assert.equal(m.store.get('accessRequests', request.id).status, 'denied', 'and it did not become a yes');

  const unknown = await fetch(base + '/api/approvals/appr_nope');
  assert.equal(unknown.status, 404);
  assert.ok(m.receipts.query({ personaId: p.id }).some((r) => r.reason === 'approval_link_minted'));
});

test('approval links: the panel copies a link and warns that it is shown once', async () => {
  const { readFileSync } = await import('node:fs');
  const js = readFileSync(new URL('../ui/app.js', import.meta.url), 'utf8');
  assert.match(js, /\/api\/requests\/link/);
  assert.match(js, /it is shown this once/, 'an owner who loses the link must know it cannot be re-read');
});
