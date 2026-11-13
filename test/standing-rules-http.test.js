// the suggestion has to be visible where the owner already is (2026-11-13).

import test from 'node:test';
import assert from 'node:assert/strict';
import { Moira } from '../src/index.js';
import { MemoryStore } from '../src/store.js';
import { createOwnerSessionVerifier } from '../src/transport/ownersession.js';
import { createMoiraServer } from '../src/transport/server.js';

const SECRET = 'a-long-enough-owner-secret-63';

async function boot() {
  const m = new Moira({ store: new MemoryStore() });
  const a = m.createOwnerContext({ kind: 'owner_session', verified: true, ownerRef: 'owner-a' });
  const p = m.owner.createPersona(a, { name: 'alex-work', identity: 'pseudonymous' });
  m.facts.add(p, { content: 'ships on fridays', category: 'preferences', rungs: { summary: 'ships fridays' } });
  const agentId = m.owner.registerAgent(a, { name: 'planner', tier: 'verified', personasAllowed: [p.id], spendCaps: { usd: 1 } }).id;
  const token = m.owner.createSession(a, { clientId: agentId, personaId: p.id }).accessToken;
  for (let i = 0; i < 3; i += 1) {
    const { request } = m.agent.request_access(token, { categories: ['preferences'], purpose: 'draft the weekly note', duration: 'session' });
    m.requests.approve({ requestId: request.id });
  }
  const verify = createOwnerSessionVerifier({ moira: m, secret: SECRET });
  const server = createMoiraServer({ moira: m, baseUrl: 'http://127.0.0.1:8082', tokenKey: 'cd'.repeat(32), getOwnerContext: verify, port: 0 });
  const bound = await server.listen();
  return { m, p, server, base: `http://127.0.0.1:${bound.port}`, H: { 'content-type': 'application/json', 'x-moira-owner': SECRET } };
}

test('standing rules: suggestions are readable and owner-gated', async (t) => {
  const { base, server, H } = await boot();
  t.after(() => new Promise((r) => server.server.close(r)));

  const anon = await fetch(base + '/api/standing-rules/suggestions');
  assert.equal(anon.status, 401);

  const res = await fetch(base + '/api/standing-rules/suggestions', { headers: H });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.suggestions.length, 1);
  assert.equal(body.suggestions[0].approvals, 3);
});

test('standing rules: accepting over http is the consent act, and it stops the asking', async (t) => {
  const { base, server, H, m } = await boot();
  t.after(() => new Promise((r) => server.server.close(r)));

  const [s] = (await (await fetch(base + '/api/standing-rules/suggestions', { headers: H })).json()).suggestions;
  const accepted = await fetch(base + '/api/standing-rules', { method: 'POST', headers: H, body: JSON.stringify({ suggestionId: s.id }) });
  assert.equal(accepted.status, 200);
  const out = await accepted.json();
  assert.equal(out.rule.kind, 'access_request');
  assert.equal(out.rule.basedOn, 3);

  const listed = await (await fetch(base + '/api/standing-rules', { headers: H })).json();
  assert.equal(listed.rules.length, 1);

  // the suggestion is gone, and the receipt says who took it and why
  assert.equal((await (await fetch(base + '/api/standing-rules/suggestions', { headers: H })).json()).suggestions.length, 0);
  assert.ok(m.receipts.query({ personaId: listed.rules[0].personaId }).some((r) => r.op === 'standing_rule'),
    'a standing rule is a consent act, so it is in the ledger');

  const missing = await fetch(base + '/api/standing-rules', { method: 'POST', headers: H, body: JSON.stringify({ suggestionId: 'sug_nope' }) });
  assert.equal(missing.status, 404);
  const empty = await fetch(base + '/api/standing-rules', { method: 'POST', headers: H, body: JSON.stringify({}) });
  assert.equal(empty.status, 400);
});

test('standing rules: the panel offers the pattern, and says a wider ask still comes back', async () => {
  const { readFileSync } = await import('node:fs');
  const js = readFileSync(new URL('../ui/app.js', import.meta.url), 'utf8');
  assert.match(js, /\/api\/standing-rules\/suggestions/);
  assert.match(js, /make it standing/);
  assert.match(js, /a wider ask still comes to you/, 'the limit of the pattern is stated where it is taken');
});
