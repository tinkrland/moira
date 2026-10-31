// two kinds of leak, two different answers.
//
// DIRECT leakage is a serving bug: content crossed a boundary that the pass did
// not cover - wrong category, set outside the slice, rung above maxRung, an
// address the pass never named, a persona the client may not read. it is a hard
// failure and must never happen, so it is checked by an INDEPENDENT verifier
// that re-derives the constraints from the pass instead of trusting the serve
// path. a checker that asks the server "was that allowed?" only repeats the bug.
//
// INFERRED leakage is not a bug. every served fact was legally served, and the
// withheld thing can still be reconstructed from them. no permission check can
// catch it, so it gets a measurement (leakage audit) and an optional, explicit
// mitigation (coarsening), never a claim of prevention.
//
// this file pins all three: the verifier's rules, the measurement, the guard.

import test from 'node:test';
import assert from 'node:assert/strict';
import { Moira } from '../src/index.js';
import { MemoryStore } from '../src/store.js';
import { checkServedAgainstPass } from '../src/core/leakage.js';

const ownerCtx = (m) => m.createOwnerContext({ kind: 'owner_session', verified: true, ownerRef: 'owner' });

test('direct leakage: the verifier checks every constraint itself, not the serve path', () => {
  const pass = {
    id: 'pass_x', personaId: 'psn_a', clientId: 'agent_1', category: 'schedule',
    sets: ['work'], maxRung: 2, fields: ['schedule.board_meeting'], purpose: 'plan', revoked: false
  };

  const ok = checkServedAgainstPass(
    { personaId: 'psn_a', category: 'schedule', sets: ['work'], field: 'schedule.board_meeting', rung: 2 },
    pass
  );
  assert.equal(ok, null, 'a served item inside every constraint is clean');

  const cases = [
    [{ personaId: 'psn_b', category: 'schedule', sets: ['work'], field: 'schedule.board_meeting', rung: 2 }, 'persona_mismatch'],
    [{ personaId: 'psn_a', category: 'preferences', sets: ['work'], field: 'preferences.x', rung: 2 }, 'category_out_of_scope'],
    [{ personaId: 'psn_a', category: 'schedule', sets: ['family'], field: 'schedule.board_meeting', rung: 2 }, 'set_out_of_scope'],
    [{ personaId: 'psn_a', category: 'schedule', sets: ['work'], field: 'schedule.board_meeting', rung: 3 }, 'rung_exceeded'],
    [{ personaId: 'psn_a', category: 'schedule', sets: ['work'], field: 'schedule.salary', rung: 2 }, 'address_out_of_scope']
  ];
  for (const [item, kind] of cases) {
    const verdict = checkServedAgainstPass(item, pass);
    assert.equal(verdict?.kind, kind, `${kind} is caught`);
    assert.equal(verdict.passId, 'pass_x', 'the violation names the pass that was exceeded');
  }
});

test('inferred leakage is measured, and the grade separates it from direct', () => {
  const m = new Moira({ store: new MemoryStore() });
  const ctx = ownerCtx(m);
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
  m.owner.grantPass(ctx, { clientId: agent.id, personaId: p.id, category: 'schedule', purpose: 'plan', duration: 'session', maxRung: 4, sets: ['work'], acknowledgeFull: true });

  const graded = m.owner.leakageGrade(ctx, { personaId: p.id, clientId: agent.id });
  assert.equal(graded.outcome, 'results');
  assert.deepEqual(graded.direct, [], 'nothing crossed a boundary: every served item was covered');
  assert.equal(graded.inferred.length, 1, 'the slice leak is still visible');
  assert.equal(graded.inferred[0].kind, 'slice_gap');
  assert.ok(graded.inferred[0].score >= graded.inferred[0].threshold);
  assert.equal(graded.verdict, 'no_direct_leaks_1_inference_risk');
});

test('the inference guard coarsens a colliding fact, and says so', () => {
  const m = new Moira({ store: new MemoryStore() });
  const ctx = ownerCtx(m);
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
  m.owner.grantPass(ctx, { clientId: agent.id, personaId: p.id, category: 'schedule', purpose: 'plan', duration: 'session', maxRung: 4, sets: ['work'], acknowledgeFull: true });
  const session = m.owner.createSession(ctx, { clientId: agent.id, personaId: p.id });

  // off by default: an owner who never asked for this keeps plain serving
  const plain = m.agent.persona_context(session.accessToken, { categories: ['schedule'], purpose: 'plan' });
  assert.match(JSON.stringify(plain), /finance team/, 'guard off: content served as asked');
  assert.equal(plain.categories.schedule.coarsened, undefined);

  const on = m.owner.setInferenceGuard(ctx, { personaId: p.id, mode: 'coarsen' });
  assert.equal(on.mode, 'coarsen');

  const guarded = m.agent.persona_context(session.accessToken, { categories: ['schedule'], purpose: 'plan' });
  const servedText = JSON.stringify(guarded.categories.schedule);
  assert.doesNotMatch(servedText, /finance (team|lead)/, 'neither side of the collision is served at full');
  assert.match(servedText, /there is a note in schedule/, 'the fact degrades to its exists rung instead of vanishing');
  assert.equal(guarded.categories.schedule.coarsened.length, 1);
  assert.equal(guarded.categories.schedule.coarsened[0].reason, 'inference_collision');
  assert.ok(guarded.categories.schedule.coarsened[0].score >= 0.6, 'the score that triggered it is reported');
  assert.ok(m.store.list('receipts').some((r) => r.reason === 'coarsened_inference'), 'the downgrade is receipted');
});
