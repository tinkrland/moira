// facts, taint, rungs, proposal inbox, preference basis (sections 4, 9.3, 8.9)
import test from 'node:test';
import assert from 'node:assert/strict';
import { Moira } from '../src/index.js';

// verified owner session + context mint: in phase 0 the host application
// performs owner verification itself; phase 2 replaces this with supabase
// auth or passkeys (owner's choice pending).
const ownerSession = () => ({ kind: 'owner_session', verified: true, ownerRef: 'owner' });
const ownerCtx = (m) => m.createOwnerContext(ownerSession());


const make = () => {
  const m = new Moira({});
  const ctx = ownerCtx(m);
  const p = m.owner.createPersona(ctx, { name: 'student', identity: 'linked' });
  return { ctx, m, p };
};

test('owner fact activates directly and serves at requested rungs', () => {
  const { ctx, m, p } = make();
  const res = m.facts.add(p, {
    content: 'midterm thursday at 9',
    category: 'schedule',
    rungs: { summary: 'busy thursday morning', conclusion: 'low bandwidth this week', exists: 'busy this week' }
  });
  assert.equal(res.outcome, 'results');
  const served = m.facts.serve(p.id, { categories: ['schedule'], capRank: 3 });
  assert.equal(served.served.length, 1);
  assert.equal(served.served[0].rung, 'summary');
  const lower = m.facts.serve(p.id, { categories: ['schedule'], capRank: 1 });
  assert.equal(lower.served[0].rung, 'exists');
  const full = m.facts.serve(p.id, { categories: ['schedule'], capRank: 4 });
  assert.equal(full.served[0].rung, 'full');
});

test('never served above fact max_rung', () => {
  const { ctx, m, p } = make();
  m.facts.add(p, {
    content: 'secret detail',
    category: 'notes',
    policy: { maxRung: 1, sensitivity: 'sensitive' },
    rungs: { exists: 'there is a note' }
  });
  const served = m.facts.serve(p.id, { categories: ['notes'], capRank: 4 });
  assert.equal(served.served.length, 1);
  assert.equal(served.served[0].rung, 'exists');
  assert.equal(served.served[0].content, 'there is a note');
});

test('agent writes are proposals; approval needs owner context', () => {
  const { ctx, m, p } = make();
  const res = m.facts.propose(p, { content: 'likes rust', category: 'preferences', preferenceBasis: 'stated' }, { actor: 'agent', clientId: 'agent_x' });
  assert.equal(res.outcome, 'results');
  assert.equal(res.fact.status, 'proposed');
  // authority lives in the owner facade: the service applies approvals, the
  // facade gates them. an owner-gated call without a minted context throws.
  assert.throws(() => m.owner.approveProposal({ owner: true }, res.fact.id));
  const approved = m.owner.approveProposal(ctx, res.fact.id);
  assert.equal(approved.outcome, 'results');
  assert.equal(approved.fact.status, 'active');
});

test('taint merge takes the most restrictive label per dimension (open question 2)', () => {
  const { ctx, m, p } = make();
  const a = m.facts.add(p, {
    content: 'a', category: 'x',
    policy: { sensitivity: 'sensitive', linkability: 'low', stylometryRisk: 'none', maxRung: 3, allowedPurposes: ['research', 'chat'] }
  }).fact;
  const b = m.facts.add(p, {
    content: 'b', category: 'x',
    policy: { sensitivity: 'normal', linkability: 'high', stylometryRisk: 'low', maxRung: 4, allowedPurposes: ['chat'] }
  }).fact;
  const derived = m.facts.propose(p, {
    content: 'summary of a and b', category: 'x', derivedFrom: [a.id, b.id]
  }, { actor: 'agent', clientId: 'agent_x' });
  const pol = derived.fact.policy;
  assert.equal(pol.sensitivity, 'sensitive');
  assert.equal(pol.linkability, 'high');
  assert.equal(pol.stylometryRisk, 'low');
  assert.equal(pol.maxRung, 3);
  assert.deepEqual(pol.allowedPurposes, ['chat']); // intersection
});

test('ledger events are circumstances, never taste (8.9)', () => {
  const { ctx, m, p } = make();
  const res = m.facts.propose(p, {
    content: 'prefers openai', category: 'preferences',
    evidence: ['ledger_event', 'key_grant']
  }, { actor: 'agent', clientId: 'agent_x' });
  assert.equal(res.outcome, 'declined');
  assert.equal(res.reason, 'preference_poisoning');
});

test('missing basis on a preference defaults to inferred (8.9)', () => {
  const { ctx, m, p } = make();
  const res = m.facts.propose(p, {
    content: 'likes rust for coding', category: 'preferences'
  }, { actor: 'agent', clientId: 'agent_x' });
  assert.equal(res.outcome, 'results');
  assert.equal(res.fact.preferenceBasis, 'inferred');
});

test('availability-driven facts decay when the circumstance ends (8.9)', () => {
  const { ctx, m, p } = make();
  m.facts.add(p, {
    content: 'uses gemini (free trial)', category: 'preferences',
    preferenceBasis: 'availability_driven', validUntil: Date.now() - 1000
  });
  const active = m.facts.active(p.id);
  assert.equal(active.length, 1);
  assert.equal(active[0].validUntilExpired, true);
});

test('sealed content is unreadable after key shredding: locked, not empty (section 16)', () => {
  const { ctx, m, p } = make();
  m.facts.add(p, { content: 'sensitive note', category: 'health' });
  m.keys.shredPersona(p.id);
  const opened = m.facts.active(p.id);
  assert.equal(opened.length, 1);
  assert.equal(opened[0].locked, true);
  assert.equal(opened[0].content, null);
});
