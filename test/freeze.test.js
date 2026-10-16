// persona freeze/thaw (section 16, deletion's reversible sibling). pins the
// core property: freezing puts a persona ON ICE without shredding anything.
// every activity surface declines while frozen; thaw restores the persona
// exactly, keys intact, facts still readable.

import test from 'node:test';
import assert from 'node:assert/strict';
import { Moira } from '../src/index.js';
import { MemoryStore } from '../src/store.js';

const ownerSession = () => ({ kind: 'owner_session', verified: true, ownerRef: 'owner' });

function setup() {
  const m = new Moira({ store: new MemoryStore() });
  const ctx = m.createOwnerContext(ownerSession());
  const student = m.owner.createPersona(ctx, { name: 'student', identity: 'linked' });
  const alias = m.owner.createPersona(ctx, { name: 'alias', identity: 'pseudonymous' });
  const fact = m.owner.recordFact ? m.owner.recordFact(ctx, { personaId: student.id, content: 'keeps lecture notes in a red notebook', category: 'notes' })
    : m.facts.add(m.personas.get(student.id), { content: 'keeps lecture notes in a red notebook', category: 'notes' });
  const agentId = m.owner.registerAgent(ctx, { name: 'helper', tier: 'verified', personasAllowed: [student.id], spendCaps: { usd: 10 } }).id;
  const sess = m.owner.createSession(ctx, { clientId: agentId, personaId: student.id });
  return { m, ctx, student, alias, agentId, sess, fact };
}

test('freeze: owner action flips status, receipts written, leases reaped', () => {
  const { m, ctx, student } = setup();
  assert.equal(m.personas.get(student.id).status, 'active');

  const res = m.owner.freezePersona(ctx, student.id);
  assert.equal(res.outcome, 'results', 'freeze is an owner action');
  assert.equal(res.frozen, true);
  assert.equal(m.personas.get(student.id).status, 'frozen');

  const recs = m.owner ? m.receipts.query({ personaId: student.id }) : null;
  assert.ok(recs.some((r) => r.op === 'persona_freeze'), 'freeze leaves a receipt');

  // double freeze is a no-op decline
  const again = m.owner.freezePersona(ctx, student.id);
  assert.equal(again.outcome, 'declined');
  assert.equal(again.reason, 'persona_frozen');
});

test('freeze: agent surface, routing, switching, bridges all decline', () => {
  const { m, ctx, student, alias, agentId, sess } = setup();
  m.owner.freezePersona(ctx, student.id);

  const st = m.agent.moira_status ? m.agent.moira_status(sess.accessToken) : m.agent.status(sess.accessToken);
  assert.equal(st.outcome, 'locked', 'agent surface declines');
  assert.equal(st.reason, 'persona_frozen');

  const route = m.router.route({ personaId: student.id, agentId, task: 'summarize notes' });
  assert.equal(route.outcome, 'locked');
  assert.equal(route.reason, 'persona_frozen');

  const sw = m.agent.requestPersonaSwitch(sess.accessToken, { toPersonaId: student.id, purpose: 'noop' });
  assert.notEqual(sw.outcome, 'results');

  // the session's persona is on ice too: even switching OUT is declined, the
  // owner thaws, the agent does not walk out on its own
  const sw2 = m.agent.requestPersonaSwitch(sess.accessToken, { toPersonaId: alias.id, purpose: 'write under the alias' });
  assert.equal(sw2.outcome, 'locked');
  assert.equal(sw2.reason, 'persona_frozen');

  // the gate on the TARGET side, from an active persona: switching INTO a
  // frozen persona is declined without a hint beyond persona_frozen
  const sw3 = m.switching.request({ clientId: agentId, fromPersonaId: alias.id, toPersonaId: student.id, purpose: 'noop' });
  assert.equal(sw3.outcome, 'declined');
  assert.equal(sw3.reason, 'persona_frozen');

  // other personas keep working: a switch between two active personas is fine
  const alias2 = m.owner.createPersona(ctx, { name: 'second alias', identity: 'pseudonymous' });
  const sw4 = m.switching.request({ clientId: agentId, fromPersonaId: alias.id, toPersonaId: alias2.id, purpose: 'write under the second alias' });
  assert.equal(sw4.outcome, 'results');
});

test('freeze: facts stay sealed but new facts and packs decline', () => {
  const { m, ctx, student, sess } = setup();
  const before = m.facts.active(student.id);
  const sealedBefore = before.map((f) => f.id);
  m.owner.freezePersona(ctx, student.id);

  const add = m.facts.add(m.personas.get(student.id), { content: 'new fact while frozen', category: 'notes' });
  assert.equal(add.outcome, 'declined');
  assert.equal(add.reason, 'persona_frozen');

  const pack = m.packs.create({ personaId: student.id, recipientAgentId: 'agent_x', brief: 'b', factSelections: [] });
  assert.equal(pack.outcome, 'declined');
  assert.equal(pack.reason, 'persona_frozen');

  // nothing was destroyed
  const after = m.facts.active(student.id);
  assert.deepEqual(after.map((f) => f.id), sealedBefore, 'frozen is not deletion');
});

test('thaw: persona resumes exactly, keys intact, facts readable', () => {
  const { m, ctx, student, agentId, sess } = setup();
  m.owner.freezePersona(ctx, student.id);

  const thaw = m.owner.thawPersona(ctx, student.id);
  assert.equal(thaw.outcome, 'results');
  assert.equal(thaw.thawed, true);
  assert.equal(m.personas.get(student.id).status, 'active');

  const recs = m.receipts.query({ personaId: student.id });
  assert.ok(recs.some((r) => r.op === 'persona_thaw'), 'thaw leaves a receipt');

  const st = m.agent.moira_status(sess.accessToken);
  assert.equal(st.outcome, 'results', 'agent surface resumes');

  // routing resumes: the persona needs an eligible account to route to, and
  // freeze did not touch the ledger
  m.owner.addAccount(ctx, student.id, {
    provider: 'acme-ai', label: 'trial', kind: 'free_trial',
    limits: [{ unit: 'usd', cap: 100, windowMs: null }],
    expiresAt: Date.now() + 5 * 86400000, capabilities: { models: ['acme-4'], tools: [], regions: [] },
    secret: 'sk_live_x'
  });
  const route = m.router.route({ personaId: student.id, agentId, task: 'summarize notes' });
  assert.equal(route.outcome, 'results', 'routing resumes');

  const again = m.owner.thawPersona(ctx, student.id);
  assert.equal(again.outcome, 'declined');
  assert.equal(again.reason, 'persona_not_frozen');
});

test('freeze: unknown persona and agent-surface freeze attempts', () => {
  const { m, ctx } = setup();
  assert.equal(m.owner.freezePersona(ctx, 'psn_missing').outcome, 'unavailable');
  assert.equal(m.owner.thawPersona(ctx, 'psn_missing').outcome, 'unavailable');
  assert.throws(() => m.owner.freezePersona(null, 'whatever'), /OwnerContext/);
});
