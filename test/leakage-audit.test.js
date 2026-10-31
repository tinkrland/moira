// inference leakage: the sandbox's hardest half, measured instead of wished away.
//
// a pass blocks retrieval, not inference. if the served set lets an agent
// reconstruct a withheld fact, the pass did not do its job - and no permission
// check can see that, because every individual read was legal.
//
// this audit is deterministic on purpose: it discards stopwords, counts
// distinctive-token containment between what was SERVED and what was WITHHELD,
// and reports the numbers it used. it does not claim to stop inference. it
// makes a leak visible, with ids and scores, never with content.

import test from 'node:test';
import assert from 'node:assert/strict';
import { Moira } from '../src/index.js';
import { MemoryStore } from '../src/store.js';

function setup() {
  const m = new Moira({ store: new MemoryStore() });
  const ctx = m.createOwnerContext({ kind: 'owner_session', verified: true, ownerRef: 'owner' });
  const work = m.owner.createPersona(ctx, { name: 'alex', identity: 'linked' });
  const privateHat = m.owner.createPersona(ctx, { name: 'sable', identity: 'pseudonymous' });
  const agentId = m.owner.registerAgent(ctx, {
    name: 'planner', tier: 'verified', personasAllowed: [work.id, privateHat.id], spendCaps: { usd: 1 }
  }).id;
  return { m, ctx, work, privateHat, agentId };
}

test('leakage: a rung that reproduces the full content is a leak, and it says so', () => {
  const { m, ctx, work, agentId } = setup();
  const p = m.personas.get(work.id);

  // the summary gives away the full fact almost verbatim
  m.facts.add(p, {
    content: 'the board meeting is on november 20 at 9am',
    category: 'schedule',
    rungs: { summary: 'board meeting november 20 at 9am' }
  });
  // an unrelated fact the agent may read freely
  m.facts.add(p, { content: 'prefers aisle seats on long flights', category: 'preferences' });

  m.owner.grantPass(ctx, {
    clientId: agentId, personaId: work.id, category: 'schedule', purpose: 'plan',
    duration: 'session', maxRung: 3, acknowledgeFull: true // summary
  });

  const audit = m.owner.leakageAudit(ctx, { personaId: work.id, clientId: agentId });
  assert.equal(audit.outcome, 'results');
  const rung = audit.findings.filter((f) => f.kind === 'rung_gap');
  assert.equal(rung.length, 1, 'the summary leaks the full rung');
  assert.equal(rung[0].score, 1, 'every distinctive token of the withheld text was served');
  assert.equal(rung[0].threshold, 0.6);
  assert.ok(rung[0].withheldFactId && rung[0].servedFactId);

  // the audit reports no content: it is safe to log or show
  const json = JSON.stringify(audit);
  assert.equal(json.includes('november'), false, 'no fact content in a leak report');
  assert.equal(json.includes('aisle'), false);
});

test('leakage: duplicated content, and a set slice that leaks what it excludes', () => {
  const { m, ctx, work, privateHat, agentId } = setup();

  // the same truth exists under two personas; the agent may only read one
  const shared = 'my sister is called radhika and she lives in chennai';
  m.facts.add(m.personas.get(work.id), { content: shared, category: 'people' });
  m.facts.add(m.personas.get(privateHat.id), { content: shared, category: 'people' });
  // and inside one persona, a near-duplicate across set slices
  m.facts.add(m.personas.get(work.id), {
    content: 'the q3 budget review happens friday morning with the finance team',
    category: 'schedule', sets: ['work']
  });
  m.facts.add(m.personas.get(work.id), {
    content: 'the q3 budget review happens friday morning with the finance lead',
    category: 'schedule', sets: ['family']
  });

  m.owner.grantPass(ctx, {
    clientId: agentId, personaId: work.id, category: 'schedule', purpose: 'plan',
    duration: 'session', maxRung: 4, sets: ['work'], acknowledgeFull: true
  });
  m.owner.grantPass(ctx, {
    clientId: agentId, personaId: work.id, category: 'people', purpose: 'intros',
    duration: 'session', maxRung: 4, acknowledgeFull: true
  });

  const audit = m.owner.leakageAudit(ctx, { personaId: work.id, clientId: agentId });
  assert.equal(audit.outcome, 'results');

  const sliceGap = audit.findings.filter((f) => f.kind === 'slice_gap');
  assert.equal(sliceGap.length, 1, 'the family-sliced duplicate is inferable from the work one');
  assert.ok(sliceGap[0].score >= 0.6);

  const cross = audit.findings.filter((f) => f.kind === 'cross_persona');
  assert.equal(cross.length, 1, 'the same sentence under another persona is a leak too');
  assert.equal(cross[0].score, 1);
  assert.equal(cross[0].otherPersonaId, privateHat.id);

  // what was actually served, counted honestly (three facts: two served, one withheld)
  assert.equal(audit.scanned.served, 2);
  assert.equal(audit.scanned.withheld, 1);
  assert.equal(audit.scanned.active, 3);
  assert.equal(audit.measured, true);
});

test('leakage: a clean persona reports nothing, deterministically', () => {
  const { m, ctx, work, agentId } = setup();
  const p = m.personas.get(work.id);
  m.facts.add(p, { content: 'ships on fridays', category: 'preferences' });
  m.facts.add(p, { content: 'dislikes group calls', category: 'preferences' });
  m.owner.grantPass(ctx, {
    clientId: agentId, personaId: work.id, category: 'preferences', purpose: 'draft',
    duration: 'session', maxRung: 4, acknowledgeFull: true
  });

  const a = m.owner.leakageAudit(ctx, { personaId: work.id, clientId: agentId });
  const b = m.owner.leakageAudit(ctx, { personaId: work.id, clientId: agentId });
  assert.deepEqual(a.findings.map((f) => [f.kind, f.score]), b.findings.map((f) => [f.kind, f.score]), 'same inputs, same report');
  assert.equal(a.findings.length, 0, 'no leak between unrelated facts');
  assert.equal(a.scanned.served, 2);
});
