// stack context declarations (the anti-hallucination layer): ai agents tend
// to invent your stack, so each persona carries an owner-stated, structured
// stack: tool + the specific USES of that tool (the nested multiselect shape:
// one tool, many independently selected uses - supabase can be auth only, or
// auth + postgres + storage, and nothing else is implied). agents read it
// through a pass and get exactly what was declared, nothing inferred.

import test from 'node:test';
import assert from 'node:assert/strict';
import { Moira } from '../src/index.js';
import { MemoryStore } from '../src/store.js';

const ownerSession = () => ({ kind: 'owner_session', verified: true, ownerRef: 'owner' });

function setup() {
  const m = new Moira({ store: new MemoryStore() });
  const ctx = m.createOwnerContext(ownerSession());
  const founder = m.owner.createPersona(ctx, { name: 'founder', identity: 'linked' });
  const student = m.owner.createPersona(ctx, { name: 'student', identity: 'linked' });
  const agentId = m.owner.registerAgent(ctx, { name: 'helper', tier: 'verified', personasAllowed: [founder.id], spendCaps: { usd: 10 } }).id;
  const sess = m.owner.createSession(ctx, { clientId: agentId, personaId: founder.id });
  return { m, ctx, founder, student, agentId, sess };
}

test('stack: owner declares tool + multiple uses; re-declaring unions the uses', () => {
  const { m, ctx, founder } = setup();

  const add = m.owner.stackAdd(ctx, { personaId: founder.id, tool: 'supabase', uses: ['auth', 'postgres'] });
  assert.equal(add.outcome, 'results');

  // the nested-multiselect point: multiple uses of the same tool accumulate
  const more = m.owner.stackAdd(ctx, { personaId: founder.id, tool: 'supabase', uses: ['storage', 'edge functions'] });
  assert.equal(more.outcome, 'results');

  const list = m.owner.stackList(ctx, { personaId: founder.id });
  assert.equal(list.entries.length, 1, 'one tool, not four entries');
  assert.deepEqual(list.entries[0].uses, ['auth', 'edge functions', 'postgres', 'storage'], 'uses unioned and sorted');

  // a second tool alongside
  m.owner.stackAdd(ctx, { personaId: founder.id, tool: 'render', uses: ['hosting'] });
  const list2 = m.owner.stackList(ctx, { personaId: founder.id });
  assert.equal(list2.entries.length, 2);
});

test('stack: entries are per-persona and never cross over', () => {
  const { m, ctx, founder, student } = setup();
  m.owner.stackAdd(ctx, { personaId: founder.id, tool: 'supabase', uses: ['auth', 'postgres'] });
  m.owner.stackAdd(ctx, { personaId: student.id, tool: 'sqlite', uses: ['local storage'] });

  const founderList = m.owner.stackList(ctx, { personaId: founder.id });
  const studentList = m.owner.stackList(ctx, { personaId: student.id });
  assert.deepEqual(founderList.entries.map((e) => e.tool), ['supabase']);
  assert.deepEqual(studentList.entries.map((e) => e.tool), ['sqlite']);
});

test('stack: removal, whole tool or single uses', () => {
  const { m, ctx, founder } = setup();
  m.owner.stackAdd(ctx, { personaId: founder.id, tool: 'supabase', uses: ['auth', 'postgres', 'storage'] });

  const partial = m.owner.stackRemove(ctx, { personaId: founder.id, tool: 'supabase', uses: ['storage'] });
  assert.equal(partial.outcome, 'results');
  assert.deepEqual(m.owner.stackList(ctx, { personaId: founder.id }).entries[0].uses, ['auth', 'postgres']);

  const gone = m.owner.stackRemove(ctx, { personaId: founder.id, tool: 'supabase' });
  assert.equal(gone.outcome, 'results');
  assert.equal(m.owner.stackList(ctx, { personaId: founder.id }).entries.length, 0);

  const missing = m.owner.stackRemove(ctx, { personaId: founder.id, tool: 'supabase' });
  assert.equal(missing.outcome, 'unavailable');
});

test('stack: invalid input is declined deterministically', () => {
  const { m, ctx, founder } = setup();
  assert.equal(m.owner.stackAdd(ctx, { personaId: founder.id, tool: '', uses: ['x'] }).outcome, 'declined');
  assert.equal(m.owner.stackAdd(ctx, { personaId: founder.id, tool: 'supabase', uses: [] }).outcome, 'declined');
  assert.equal(m.owner.stackAdd(ctx, { personaId: founder.id, tool: 'supabase', uses: 'auth' }).outcome, 'declined');
  assert.equal(m.owner.stackAdd(ctx, { personaId: 'psn_missing', tool: 'supabase', uses: ['auth'] }).outcome, 'unavailable');
});

test('stack: frozen personas decline stack writes', () => {
  const { m, ctx, founder } = setup();
  m.owner.freezePersona(ctx, founder.id);
  assert.equal(m.owner.stackAdd(ctx, { personaId: founder.id, tool: 'supabase', uses: ['auth'] }).outcome, 'declined');
  assert.equal(m.owner.stackRemove(ctx, { personaId: founder.id, tool: 'supabase' }).outcome, 'declined');
});

test('stack: agents read it pass-gated, structured, persona-scoped', () => {
  const { m, ctx, founder, student, agentId, sess } = setup();
  m.owner.stackAdd(ctx, { personaId: founder.id, tool: 'supabase', uses: ['auth', 'postgres', 'storage'] });
  m.owner.stackAdd(ctx, { personaId: student.id, tool: 'sqlite', uses: ['local storage'] });

  // no pass: no stack
  const denied = m.agent.stack_get(sess.accessToken, {});
  assert.equal(denied.outcome, 'approval_required', 'a pass is needed, like every other read');

  // grant the pass, then the agent sees exactly the declared stack
  m.owner.grantPass(ctx, { clientId: agentId, personaId: founder.id, category: 'stack', purpose: 'context', duration: 'permanent' });
  const got = m.agent.stack_get(sess.accessToken, {});
  assert.equal(got.outcome, 'results');
  assert.equal(got.entries.length, 1);
  assert.equal(got.entries[0].tool, 'supabase');
  assert.deepEqual(got.entries[0].uses, ['auth', 'postgres', 'storage'], 'structured: tool + uses, not prose to paraphrase');
  assert.ok(!JSON.stringify(got).includes('sqlite'), 'the student persona\'s stack never crosses over');

  // the read leaves a receipt
  const recs = m.receipts.query({ personaId: founder.id });
  assert.ok(recs.some((r) => r.op === 'read' && r.reason === 'stack'), 'stack reads are audited');
});
