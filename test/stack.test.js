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
  assert.equal(m.owner.stackAdd(ctx, { personaId: founder.id, tool: 'supabase', uses: 'auth' }).outcome, 'declined');
  assert.equal(m.owner.stackAdd(ctx, { personaId: 'psn_missing', tool: 'supabase', uses: ['auth'] }).outcome, 'unavailable');
});

test('stack: add-then-describe, like the pill flow (tool first, uses after)', () => {
  const { m, ctx, founder } = setup();

  // add the tool with no uses yet: the pill exists, the panel is open
  const add = m.owner.stackAdd(ctx, { personaId: founder.id, tool: 'supabase', uses: [] });
  assert.equal(add.outcome, 'results', 'a tool can be declared before its uses');
  assert.deepEqual(add.entry.uses, [], 'uses start empty, nothing implied');

  // then describe how it is used, one declaration at a time
  m.owner.stackAdd(ctx, { personaId: founder.id, tool: 'supabase', uses: ['auth'] });
  const done = m.owner.stackAdd(ctx, { personaId: founder.id, tool: 'supabase', uses: ['postgres'] });
  assert.deepEqual(done.entry.uses, ['auth', 'postgres']);

  // re-adding with no uses is a quiet no-op, never a wipe
  const noop = m.owner.stackAdd(ctx, { personaId: founder.id, tool: 'supabase', uses: [] });
  assert.equal(noop.outcome, 'results');
  assert.deepEqual(noop.entry.uses, ['auth', 'postgres'], 'an empty add never clears existing uses');
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

test('stack: two declaration flows, tool-first or category-first', () => {
  const { m, ctx, founder } = setup();

  // category-first: define frontend with its corresponding stuff in one call
  const cat = m.owner.stackAdd(ctx, {
    personaId: founder.id, category: 'frontend',
    tools: [{ tool: 'react', uses: ['ui framework'] }, { tool: 'tailwindcss' }]
  });
  assert.equal(cat.outcome, 'results');
  assert.equal(cat.entries.length, 2);

  const list = m.owner.stackList(ctx, { personaId: founder.id });
  const react = list.entries.find((e) => e.tool === 'react');
  const tailwind = list.entries.find((e) => e.tool === 'tailwindcss');
  assert.equal(react.category, 'frontend', 'category rides along');
  assert.deepEqual(react.uses, ['ui framework']);
  assert.deepEqual(tailwind.uses, [], 'undescribed tool in a batch is fine');

  // the pill flow still works on the same persona, and re-declaring a tool
  // through either flow unions uses and never drops the category
  const pill = m.owner.stackAdd(ctx, { personaId: founder.id, tool: 'react', uses: ['spa'] });
  assert.equal(pill.outcome, 'results');
  assert.deepEqual(pill.entry.uses, ['spa', 'ui framework']);
  assert.equal(pill.entry.category, 'frontend', 'a later pill add keeps the category');

  const cat2 = m.owner.stackAdd(ctx, {
    personaId: founder.id, category: 'frontend',
    tools: [{ tool: 'react', uses: ['ssr'] }]
  });
  assert.equal(cat2.outcome, 'results');
  assert.deepEqual(cat2.entries[0].uses, ['spa', 'ssr', 'ui framework']);
});

test('stack: mixed or malformed shapes decline deterministically', () => {
  const { m, ctx, founder } = setup();
  // both shapes at once
  const both = m.owner.stackAdd(ctx, { personaId: founder.id, tool: 'react', category: 'frontend', tools: [] });
  assert.equal(both.outcome, 'declined');
  // tools without a category
  assert.equal(m.owner.stackAdd(ctx, { personaId: founder.id, tools: [{ tool: 'react' }] }).outcome, 'declined');
  // category without tools
  assert.equal(m.owner.stackAdd(ctx, { personaId: founder.id, category: 'frontend' }).outcome, 'declined');
  // tools entries must be tool objects
  const bad = m.owner.stackAdd(ctx, { personaId: founder.id, category: 'frontend', tools: ['react'] });
  assert.equal(bad.outcome, 'declined');
  // nothing declared means nothing half-applied
  assert.equal(m.owner.stackList(ctx, { personaId: founder.id }).entries.length, 0);
});

