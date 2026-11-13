// the safety controls nobody could reach (2026-11-13).
//
// freezePersona, thawPersona, killSwitch and exportPersona existed in the owner
// facade with no route and no button, so the two acts a worried owner most
// wants - "stop everything" and "give me my data" - were reachable only from
// the Node api. a control with no surface is a control for the person who wrote
// it, not for the person who owns the data.

import test from 'node:test';
import assert from 'node:assert/strict';
import { Moira } from '../src/index.js';
import { MemoryStore } from '../src/store.js';
import { createOwnerSessionVerifier } from '../src/transport/ownersession.js';
import { createMoiraServer } from '../src/transport/server.js';

const SECRET = 'a-long-enough-owner-secret-41';

async function boot() {
  const m = new Moira({ store: new MemoryStore() });
  const a = m.createOwnerContext({ kind: 'owner_session', verified: true, ownerRef: 'owner-a' });
  const p = m.owner.createPersona(a, { name: 'alex-work', identity: 'pseudonymous' });
  m.facts.add(p, { content: 'ships on fridays', category: 'preferences' });
  const verify = createOwnerSessionVerifier({ moira: m, secret: SECRET });
  const server = createMoiraServer({ moira: m, baseUrl: 'http://127.0.0.1:8080', tokenKey: 'ef'.repeat(32), getOwnerContext: verify, port: 0 });
  const bound = await server.listen();
  return {
    m, a, p, server, base: `http://127.0.0.1:${bound.port}`,
    owner: { 'content-type': 'application/json', 'x-moira-owner': SECRET }
  };
}

const post = (base, headers, path, body) => fetch(base + path, { method: 'POST', headers, body: JSON.stringify(body ?? {}) });
const get = (base, headers, path) => fetch(base + path, { headers });

test('persona controls: every route is owner-gated', async (t) => {
  const { base, server, p } = await boot();
  t.after(() => new Promise((r) => server.server.close(r)));
  const anon = { 'content-type': 'application/json' };
  for (const [method, path] of [
    ['POST', '/api/personas/freeze'],
    ['POST', '/api/personas/thaw'],
    ['POST', '/api/personas/kill'],
    ['GET', `/api/personas/export?personaId=${p.id}`]
  ]) {
    const res = method === 'POST'
      ? await post(base, anon, path, { personaId: p.id })
      : await get(base, anon, path);
    assert.equal(res.status, 401, `${path} refuses an anonymous caller`);
  }
});

test('persona controls: freeze stops the hat, thaw brings it back', async (t) => {
  const { base, server, owner, p, m, a } = await boot();
  t.after(() => new Promise((r) => server.server.close(r)));

  const frozen = await post(base, owner, '/api/personas/freeze', { personaId: p.id });
  assert.equal(frozen.status, 200);
  const frozenBody = await frozen.json();
  assert.equal(frozenBody.outcome, 'results');
  assert.equal(m.personas.get(p.id).status, 'frozen', 'the state changed, not just the receipt');

  // a frozen hat cannot be handed a new pack: the refusal is the point
  const pack = m.packs.create({
    personaId: p.id, recipientAgentId: 'agent_x', brief: 'x',
    factSelections: [], ttlMs: 60_000
  });
  assert.equal(pack.outcome, 'declined');
  assert.equal(pack.reason, 'persona_frozen');

  const thawed = await post(base, owner, '/api/personas/thaw', { personaId: p.id });
  assert.equal(thawed.status, 200);
  assert.equal(m.personas.get(p.id).status, 'active');
  assert.ok(a, 'owner context still works');
});

test('persona controls: the kill switch reports what it froze, and refuses a stranger', async (t) => {
  const { base, server, owner, p, m, a } = await boot();
  t.after(() => new Promise((r) => server.server.close(r)));

  // something live to stop: a standing budget lease is the thing that would
  // otherwise keep spending after the owner hits the switch
  const agentId = m.owner.registerAgent(a, { name: 'spender', tier: 'verified', personasAllowed: [p.id], spendCaps: { usd: 5 } }).id;
  const account = m.owner.addAccount(a, p.id, {
    provider: 'x-ai', kind: 'credits', limits: [], expiresAt: null, capabilities: { models: [], tools: [], regions: [] }
  }).account;
  m.router.requestLease({ agentId, personaId: p.id, accountId: account.id, maxSpend: 2 });

  const killed = await post(base, owner, '/api/personas/kill', { personaId: p.id });
  assert.equal(killed.status, 200);
  const out = await killed.json();
  assert.equal(out.outcome, 'results');
  assert.equal(out.frozenLeases, 1, 'the answer says what stopped, not just ok');

  const missing = await post(base, owner, '/api/personas/kill', { personaId: 'psn_nope' });
  assert.equal(missing.status, 404);

  const noBody = await post(base, owner, '/api/personas/freeze', {});
  assert.equal(noBody.status, 400);
});

test('persona controls: export is the whole hat, including the receipts', async (t) => {
  const { base, server, owner, p } = await boot();
  t.after(() => new Promise((r) => server.server.close(r)));

  const res = await get(base, owner, `/api/personas/export?personaId=${p.id}`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.outcome, 'results');
  assert.equal(body.persona.name, 'alex-work');
  assert.ok(body.facts.length >= 1, 'export without the facts is not an export');
  assert.ok(Array.isArray(body.receipts), 'and the receipts are what make it honest');
  const disposition = res.headers.get('content-disposition') ?? '';
  assert.match(disposition, /attachment; filename="alex-work/, 'an export is a file you keep');
  assert.match(res.headers.get('content-type') ?? '', /application\/json/);

  const missing = await get(base, owner, '/api/personas/export?personaId=psn_nope');
  assert.equal(missing.status, 404);
});

test('persona controls: the panel offers exactly the three acts, in words', async () => {
  const { readFileSync } = await import('node:fs');
  const js = readFileSync(new URL('../ui/app.js', import.meta.url), 'utf8');
  assert.match(js, /\/api\/personas\/freeze/);
  assert.match(js, /\/api\/personas\/thaw/);
  assert.match(js, /\/api\/personas\/kill/);
  assert.match(js, /\/api\/personas\/export/);
  // the kill switch says what it does NOT do, because that is the fear
  assert.match(js, /nothing is deleted/, 'the kill switch states its limit');
  // a download cannot carry the owner header, so the panel fetches with it
  assert.match(js, /URL\.createObjectURL/, 'export is a file handed to the browser');
  assert.equal(/location\.href = .*export/.test(js), false, 'never a raw link: it would arrive unauthenticated');
});
