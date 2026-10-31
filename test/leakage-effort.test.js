// how much looking does it take?
//
// a single threshold treats every observer as equally diligent. the colleague
// who skims one summary and the agent that ingests everything and diffs it are
// not the same adversary, and the gap between them is EFFORT, not permission.
//
// so the honest quantity is the size of the MINIMUM EVIDENCE SET: how many
// served facts must be read, and combined, before the withheld one is
// reconstructible. one item = a glance. two or three = attention. all of them =
// someone working the problem. the cover is greedy, so it is an upper bound on
// parsimony (a smaller set may exist); every finding says so rather than
// implying optimality.
//
// and the real bug this closes: two served facts at 0.5 each, union 1.0, used
// to score below threshold and report NOTHING - the attentive observer saw it,
// the audit did not.

import test from 'node:test';
import assert from 'node:assert/strict';
import { Moira } from '../src/index.js';
import { MemoryStore } from '../src/store.js';

function build() {
  const m = new Moira({ store: new MemoryStore() });
  const ctx = m.createOwnerContext({ kind: 'owner_session', verified: true, ownerRef: 'owner' });
  const p = m.owner.createPersona(ctx, { name: 'alex', identity: 'linked' });
  // withheld: family-sliced. each distinct half below threshold, union complete.
  m.facts.add(m.personas.get(p.id), {
    content: 'zephyr hires kolkata relocates apartment lease signed november',
    category: 'schedule', sets: ['family']
  });
  // served: two work-sliced facts, each carrying half of it
  m.facts.add(m.personas.get(p.id), {
    content: 'zephyr hires kolkata relocates', category: 'schedule', sets: ['work']
  });
  m.facts.add(m.personas.get(p.id), {
    content: 'apartment lease signed november', category: 'schedule', sets: ['work']
  });
  // one read, one leak: a work fact and its family twin, nearly the same words
  m.facts.add(m.personas.get(p.id), {
    content: 'the board meeting is on november 20 at 9am', category: 'schedule', sets: ['work']
  });
  m.facts.add(m.personas.get(p.id), {
    content: 'the board meeting is on november 20 at 9am', category: 'schedule', sets: ['family']
  });
  const agent = m.owner.registerAgent(ctx, { name: 'planner', tier: 'verified', personasAllowed: [p.id], spendCaps: { usd: 1 } });
  m.owner.grantPass(ctx, {
    clientId: agent.id, personaId: p.id, category: 'schedule', purpose: 'plan',
    duration: 'session', maxRung: 4, sets: ['work'], acknowledgeFull: true
  });
  return { m, ctx, personaId: p.id, clientId: agent.id };
}

test('effort is measured: a fact that needs two reads is reported, not missed', () => {
  const { m, ctx, personaId, clientId } = build();
  const audit = m.owner.leakageAudit(ctx, { personaId, clientId });
  assert.equal(audit.outcome, 'results');

  const combined = audit.findings.find((f) => f.combination === true);
  assert.ok(combined, 'the two-halves reconstruction is a finding');
  assert.equal(combined.kind, 'slice_gap');
  assert.equal(combined.minObservations, 2, 'two served facts must be combined');
  assert.equal(combined.tier, 'attentive');
  assert.ok(combined.score >= audit.threshold, 'combined coverage is what crosses the threshold');
  assert.equal(combined.servedFactIds.length, 2, 'the evidence set is named');
  assert.match(audit.method, /greedy/, 'the cover is greedy and says so');

  const glance = audit.findings.find((f) => f.minObservations === 1);
  assert.ok(glance, 'a single-read leak is still a finding');
  assert.equal(glance.tier, 'glance');
});

test('an observation budget moves what a lax observer would miss out of the risk list', () => {
  const { m, ctx, personaId, clientId } = build();

  const lax = m.owner.leakageAudit(ctx, { personaId, clientId, observationBudget: 1 });
  assert.equal(lax.observationBudget, 1);
  assert.equal(lax.findings.find((f) => f.combination === true), undefined, 'one read does not reach it');
  assert.ok(lax.latent.some((f) => f.combination === true && f.latentReason === 'above_budget'),
    'it is recorded as latent, not silently dropped');
  assert.ok(lax.findings.every((f) => f.minObservations <= 1), 'findings respect the budget');

  const diligent = m.owner.leakageAudit(ctx, { personaId, clientId, observationBudget: 4 });
  assert.ok(diligent.findings.some((f) => f.combination === true), 'more looking finds more');
  assert.deepEqual(diligent.latent, [], 'nothing is above a four-read budget');
});
