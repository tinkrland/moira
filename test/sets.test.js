// context sets: declarations are not project-specific but context broadly,
// organized in named sets per persona. a persona can have multiple sets, and
// at connection time (pass grant) the owner chooses which sets to share with
// that agent. a set-scoped pass exposes exactly the entries in its sets;
// an unscoped pass keeps the whole persona context. sets cut across both
// declaration kinds: one set can hold stack tools and ai tools together.

import test from 'node:test';
import assert from 'node:assert/strict';
import { Moira } from '../src/index.js';
import { MemoryStore } from '../src/store.js';

const ownerSession = () => ({ kind: 'owner_session', verified: true, ownerRef: 'owner' });

function setup() {
  const m = new Moira({ store: new MemoryStore() });
  const ctx = m.createOwnerContext(ownerSession());
  const founder = m.owner.createPersona(ctx, { name: 'founder', identity: 'linked' });
  const agentId = m.owner.registerAgent(ctx, { name: 'helper', tier: 'verified', personasAllowed: [founder.id], spendCaps: { usd: 10 } }).id;
  const sess = m.owner.createSession(ctx, { clientId: agentId, personaId: founder.id });
  return { m, ctx, founder, agentId, sess };
}

test('sets: declarations land in named sets; one persona, several sets', () => {
  const { m, ctx, founder } = setup();

  m.owner.stackAdd(ctx, { personaId: founder.id, tool: 'supabase', uses: ['auth'], sets: ['work'] });
  m.owner.stackAdd(ctx, { personaId: founder.id, tool: 'sqlite', uses: ['local storage'], sets: ['side projects'] });
  m.owner.aiAdd(ctx, { personaId: founder.id, job: 'scraping', tools: [{ tool: 'firecrawl' }], sets: ['work'] });

  const sets = m.owner.setList(ctx, { personaId: founder.id });
  assert.deepEqual(sets.sets.map((s) => s.name).sort(), ['side projects', 'work']);
  const work = sets.sets.find((s) => s.name === 'work');
  assert.equal(work.count, 2, 'one set holds a stack tool and an ai tool together');

  // an entry can sit in several sets at once
  m.owner.stackAdd(ctx, { personaId: founder.id, tool: 'supabase', uses: ['postgres'], sets: ['work', 'consulting'] });
  const entry = m.owner.stackList(ctx, { personaId: founder.id }).entries.find((e) => e.tool === 'supabase');
  assert.deepEqual(entry.sets, ['consulting', 'work'], 'set membership unions across adds');
  assert.deepEqual(entry.uses, ['auth', 'postgres'], 'and uses still union');
});

test('sets: at connection time the owner picks which set the agent gets', () => {
  const { m, ctx, founder, agentId, sess } = setup();
  m.owner.stackAdd(ctx, { personaId: founder.id, tool: 'supabase', uses: ['auth'], sets: ['work'] });
  m.owner.stackAdd(ctx, { personaId: founder.id, tool: 'sqlite', uses: ['local storage'], sets: ['side projects'] });
  m.owner.aiAdd(ctx, { personaId: founder.id, job: 'scraping', tools: [{ tool: 'firecrawl' }], sets: ['work'] });
  m.owner.aiAdd(ctx, { personaId: founder.id, job: 'summarization', tools: [{ tool: 'claude' }], sets: ['side projects'] });

  // work-set pass: the agent sees work and only work, across both kinds
  m.owner.grantPass(ctx, { clientId: agentId, personaId: founder.id, category: 'stack', purpose: 'context', duration: 'permanent', sets: ['work'] });
  m.owner.grantPass(ctx, { clientId: agentId, personaId: founder.id, category: 'ai', purpose: 'context', duration: 'permanent', sets: ['work'] });

  const stack = m.agent.stack_get(sess.accessToken, {});
  assert.equal(stack.outcome, 'results');
  assert.deepEqual(stack.entries.map((e) => e.tool), ['supabase'], 'sqlite is not in the work set');

  const ai = m.agent.ai_get(sess.accessToken, {});
  assert.equal(ai.outcome, 'results');
  assert.deepEqual(ai.jobs.map((j) => j.job), ['scraping'], 'summarization is not in the work set');

  // grant both sets on a second pass for the same category: the union reads
  m.owner.grantPass(ctx, { clientId: agentId, personaId: founder.id, category: 'stack', purpose: 'context', duration: 'one_time', sets: ['work', 'side projects'] });
  // a different client gets a different set: connection-time choice is
  // per agent, not per persona
  const otherId = m.owner.registerAgent(ctx, { name: 'other', tier: 'verified', personasAllowed: [founder.id], spendCaps: { usd: 10 } }).id;
  const otherSess = m.owner.createSession(ctx, { clientId: otherId, personaId: founder.id });
  m.owner.grantPass(ctx, { clientId: otherId, personaId: founder.id, category: 'stack', purpose: 'context', duration: 'permanent', sets: ['side projects'] });
  const otherStack = m.agent.stack_get(otherSess.accessToken, {});
  assert.deepEqual(otherStack.entries.map((e) => e.tool), ['sqlite'], 'the second agent gets the other set');
});

test('sets: an unscoped pass still means the whole persona context', () => {
  const { m, ctx, founder, agentId, sess } = setup();
  m.owner.stackAdd(ctx, { personaId: founder.id, tool: 'supabase', uses: ['auth'], sets: ['work'] });
  m.owner.stackAdd(ctx, { personaId: founder.id, tool: 'sqlite', uses: ['local storage'], sets: ['side projects'] });
  m.owner.stackAdd(ctx, { personaId: founder.id, tool: 'vscode', uses: ['editor'] }); // in no set at all

  const grantRes = m.owner.grantPass(ctx, { clientId: agentId, personaId: founder.id, category: 'stack', purpose: 'context', duration: 'permanent' });
  const got = m.agent.stack_get(sess.accessToken, {});
  assert.equal(got.outcome, 'results');
  assert.equal(got.entries.length, 3, 'unscoped pass reads everything, set membership or not');

  // scoped pass excludes entries outside its sets, including setless ones
  const scoped = m.owner.grantPass(ctx, { clientId: agentId, personaId: founder.id, category: 'stack', purpose: 'full', duration: 'permanent', sets: ['work'] });
  assert.equal(scoped.outcome, 'results');
  // re-grant the context pass scoped this time by revoking first
  m.owner.revokePass(ctx, grantRes.pass.id);
  const ctxPass = m.owner.grantPass(ctx, { clientId: agentId, personaId: founder.id, category: 'stack', purpose: 'context', duration: 'permanent', sets: ['work'] });
  const only = m.agent.stack_get(sess.accessToken, {});
  assert.deepEqual(only.entries.map((e) => e.tool), ['supabase'], 'setless entries never ride a scoped pass');
});

test('sets: removing a set untags its entries; removing an unknown set says so', () => {
  const { m, ctx, founder } = setup();
  m.owner.stackAdd(ctx, { personaId: founder.id, tool: 'supabase', uses: ['auth'], sets: ['work'] });

  const gone = m.owner.setRemove(ctx, { personaId: founder.id, name: 'work' });
  assert.equal(gone.outcome, 'results');
  const entry = m.owner.stackList(ctx, { personaId: founder.id }).entries[0];
  assert.deepEqual(entry.sets, [], 'entries survive, just untagged');

  const missing = m.owner.setRemove(ctx, { personaId: founder.id, name: 'work' });
  assert.equal(missing.outcome, 'unavailable');
});

test('sets: names normalize (case, whitespace), never duplicate', () => {
  const { m, ctx, founder } = setup();
  m.owner.stackAdd(ctx, { personaId: founder.id, tool: 'supabase', uses: ['auth'], sets: ['  Work '] });
  m.owner.stackAdd(ctx, { personaId: founder.id, tool: 'sqlite', uses: ['x'], sets: ['work'] });
  const sets = m.owner.setList(ctx, { personaId: founder.id });
  assert.equal(sets.sets.length, 1, 'Work and work are the same set');
  assert.equal(sets.sets[0].count, 2);
});

test('sets: scoped passes never leak across personas', () => {
  const { m, ctx, founder, agentId, sess } = setup();
  const student = m.owner.createPersona(ctx, { name: 'student', identity: 'linked' });
  m.owner.stackAdd(ctx, { personaId: founder.id, tool: 'supabase', uses: ['auth'], sets: ['work'] });
  m.owner.stackAdd(ctx, { personaId: student.id, tool: 'sqlite', uses: ['x'], sets: ['work'] });

  m.owner.grantPass(ctx, { clientId: agentId, personaId: founder.id, category: 'stack', purpose: 'context', duration: 'permanent', sets: ['work'] });
  const got = m.agent.stack_get(sess.accessToken, {});
  assert.equal(got.outcome, 'results');
  assert.ok(!JSON.stringify(got).includes('sqlite'), 'same set name, other persona: still invisible');
});
