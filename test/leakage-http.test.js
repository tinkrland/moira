// the leakage surface over http: the grade tells direct from inferred, and the
// guard toggle is opt-in. pinned because both routes are owner-only and one of
// them changes serving behaviour for a persona.

import test from 'node:test';
import assert from 'node:assert/strict';
import { createMoiraServer } from '../src/transport/server.js';
import { Moira } from '../src/index.js';
import { MemoryStore } from '../src/store.js';

const KEY = '22'.repeat(32);

async function boot() {
  const m = new Moira({ store: new MemoryStore() });
  const ctx = m.createOwnerContext({ kind: 'owner_session', verified: true, ownerRef: 'owner' });
  const p = m.owner.createPersona(ctx, { name: 'alex', identity: 'linked' });
  m.facts.add(m.personas.get(p.id), {
    content: 'the q3 budget review happens friday morning with the finance team',
    category: 'schedule', sets: ['work']
  });
  m.facts.add(m.personas.get(p.id), {
    content: 'the q3 budget review happens friday morning with the finance lead',
    category: 'schedule', sets: ['family']
  });
  const agent = m.owner.registerAgent(ctx, { name: 'planner', tier: 'verified', personasAllowed: [p.id], spendCaps: { usd: 1 } });
  m.owner.grantPass(ctx, {
    clientId: agent.id, personaId: p.id, category: 'schedule', purpose: 'plan',
    duration: 'session', maxRung: 4, sets: ['work'], acknowledgeFull: true
  });
  const srv = createMoiraServer({
    moira: m, baseUrl: 'http://127.0.0.1:0', tokenKey: KEY, port: 0,
    getOwnerContext: (req) => (req.headers['x-moira-owner'] === 'owner-secret' ? m.createOwnerContext({ kind: 'owner_session', verified: true, ownerRef: 'owner' }) : null)
  });
  const addr = await srv.listen();
  return { base: `http://127.0.0.1:${addr.port}`, srv, m, personaId: p.id, agentId: agent.id };
}

test('http: /api/leakage/grade is owner-only and separates direct from inferred', async () => {
  const { base, srv, personaId, agentId } = await boot();
  const q = `?personaId=${personaId}&clientId=${agentId}`;
  try {
    const anon = await fetch(`${base}/api/leakage/grade${q}`);
    assert.equal(anon.status, 401, 'no owner context, no grade');

    const missing = await fetch(`${base}/api/leakage/grade`, { headers: { 'x-moira-owner': 'owner-secret' } });
    assert.equal(missing.status, 400, 'persona and client are required, not guessed');

    const res = await fetch(`${base}/api/leakage/grade${q}`, { headers: { 'x-moira-owner': 'owner-secret' } });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.deepEqual(body.direct, [], 'nothing crossed a boundary');
    assert.equal(body.inferred.length, 1, 'the slice leak is reported');
    assert.equal(body.inferred[0].kind, 'slice_gap');
    assert.doesNotMatch(JSON.stringify(body.inferred), /finance (team|lead)/, 'the report never quotes the secret');
  } finally {
    srv.server.close();
  }
});

test('http: /api/leakage/guard flips the mode, refuses bad input, and changes serving', async () => {
  const { base, srv, m, personaId, agentId } = await boot();
  const owner = { 'content-type': 'application/json', 'x-moira-owner': 'owner-secret' };
  const session = m.owner.createSession(m.createOwnerContext({ kind: 'owner_session', verified: true, ownerRef: 'owner' }), { clientId: agentId, personaId });
  try {
    const bad = await fetch(`${base}/api/leakage/guard`, {
      method: 'POST', headers: owner, body: JSON.stringify({ personaId, mode: 'prevent' })
    });
    assert.equal(bad.status, 400, 'an invented mode is refused, not silently accepted');

    const ok = await fetch(`${base}/api/leakage/guard`, {
      method: 'POST', headers: owner, body: JSON.stringify({ personaId, mode: 'coarsen' })
    });
    assert.equal(ok.status, 200);
    assert.equal((await ok.json()).mode, 'coarsen');

    // the panel reads the mode off the detail payload, so it must be there
    const detail = await fetch(`${base}/api/persona?id=${encodeURIComponent(personaId)}`, { headers: { 'x-moira-owner': 'owner-secret' } });
    assert.equal(detail.status, 200);
    assert.equal((await detail.json()).persona.inferenceGuard, 'coarsen', 'the detail panel can show the real mode');

    const served = m.agent.persona_context(session.accessToken, { categories: ['schedule'], purpose: 'plan' });
    assert.doesNotMatch(JSON.stringify(served.categories.schedule), /finance (team|lead)/, 'the guard is live, not just stored');
  } finally {
    srv.server.close();
  }
});
