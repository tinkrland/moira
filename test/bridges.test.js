// bridges, rungs, privacy budget, persona kinds (sections 5, 9.2, 9.5, 13)
import test from 'node:test';
import assert from 'node:assert/strict';
import { Moira } from '../src/index.js';

// verified owner session + context mint: in phase 0 the host application
// performs owner verification itself; phase 2 replaces this with supabase
// auth or passkeys (owner's choice pending).
const ownerSession = () => ({ kind: 'owner_session', verified: true, ownerRef: 'owner' });
const ownerCtx = (m) => m.createOwnerContext(ownerSession());


const setup = () => {
  const m = new Moira({});
  const ctx = ownerCtx(m);
  const student = m.owner.createPersona(ctx, { name: 'student', identity: 'linked' });
  const founder = m.owner.createPersona(ctx, { name: 'founder', identity: 'linked' });
  const agent = m.owner.registerAgent(ctx, { name: 'planner', tier: 'verified', personasAllowed: [founder.id, student.id] });
  return { ctx, m, student, founder, agent };
};

test('no bridge -> not_available, never revealing existence (9.2)', () => {
  const { ctx, m, student, founder, agent } = setup();
  m.facts.add(student, { content: 'midterm thursday', category: 'schedule' });
  const session = m.owner.createSession(ctx, { clientId: agent.id, personaId: founder.id });
  const res = m.agent.bridge_request(session.accessToken, { srcPersonaId: student.id, query: null, purpose: 'planning' });
  assert.equal(res.outcome, 'not_available');
});

test('flow requires both bridge and ingress: two-sided, auditable (9.2)', () => {
  const { ctx, m, student, founder, agent } = setup();
  m.facts.add(student, {
    content: 'midterm thursday at 9', category: 'schedule',
    rungs: { summary: 'busy thursday morning', conclusion: 'low bandwidth this week' }
  });
  m.owner.createBridge(ctx, { src: student.id, dst: founder.id, purpose: 'planning', maxRung: 2 });
  const session = m.owner.createSession(ctx, { clientId: agent.id, personaId: founder.id });
  const noIngress = m.agent.bridge_request(session.accessToken, { srcPersonaId: student.id, query: null, purpose: 'planning' });
  assert.equal(noIngress.outcome, 'declined');
  assert.equal(noIngress.reason, 'ingress_not_allowed');

  m.owner.allowIngress(ctx, founder.id, student.id);
  const res = m.agent.bridge_request(session.accessToken, { srcPersonaId: student.id, query: null, purpose: 'planning', maxRung: 2 });
  assert.equal(res.outcome, 'results');
  assert.equal(res.items.length, 1);
  assert.equal(res.items[0].rung, 'conclusion');
  assert.equal(res.items[0].content, 'low bandwidth this week');
  assert.equal(res.items[0].trust, 'untrusted-imported');
  assert.equal(res.merged, false);
});

test('bridge never serves above bridge max rung', () => {
  const { ctx, m, student, founder, agent } = setup();
  m.facts.add(student, { content: 'midterm thursday at 9', category: 'schedule', rungs: { summary: 'busy thursday', exists: 'there is a schedule note' } });
  m.owner.createBridge(ctx, { src: student.id, dst: founder.id, purpose: 'planning', maxRung: 1 });
  m.owner.allowIngress(ctx, founder.id, student.id);
  const session = m.owner.createSession(ctx, { clientId: agent.id, personaId: founder.id });
  const res = m.agent.bridge_request(session.accessToken, { srcPersonaId: student.id, query: null, purpose: 'planning' });
  assert.equal(res.outcome, 'results');
  assert.equal(res.items[0].rung, 'exists'); // capped at the bridge rung, never the summary
  assert.equal(res.items[0].content, 'there is a schedule note');
});

test('receipts are written on both sides and are content-free (9.2, 16)', () => {
  const { ctx, m, student, founder, agent } = setup();
  m.facts.add(student, { content: 'midterm', category: 'schedule' });
  m.owner.createBridge(ctx, { src: student.id, dst: founder.id, purpose: 'planning', maxRung: 2 });
  m.owner.allowIngress(ctx, founder.id, student.id);
  const session = m.owner.createSession(ctx, { clientId: agent.id, personaId: founder.id });
  m.agent.bridge_request(session.accessToken, { srcPersonaId: student.id, query: null, purpose: 'planning' });
  const srcReceipts = m.receipts.query({ personaId: student.id, op: 'bridge' });
  const dstReceipts = m.receipts.query({ personaId: founder.id, op: 'bridge' });
  assert.equal(srcReceipts.length, 1);
  assert.equal(dstReceipts.length, 1);
  const raw = JSON.stringify(srcReceipts[0]);
  assert.ok(!raw.includes('midterm')); // content-free
});

test('pseudonymous persona: linkable facts never flow in (13)', () => {
  const m = new Moira({});
  const ctx = ownerCtx(m);
  const main = m.owner.createPersona(ctx, { name: 'main', identity: 'linked' });
  const alias = m.owner.createPersona(ctx, { name: 'alias', identity: 'pseudonymous' });
  const agent = m.owner.registerAgent(ctx, { name: 'a', tier: 'verified', personasAllowed: [alias.id, main.id] });
  m.facts.add(main, { content: 'real name is x', category: 'identity', policy: { linkability: 'high' } });
  m.owner.createBridge(ctx, { src: main.id, dst: alias.id, purpose: 'research', maxRung: 2 });
  m.owner.allowIngress(ctx, alias.id, main.id);
  const session = m.owner.createSession(ctx, { clientId: agent.id, personaId: alias.id });
  const res = m.agent.bridge_request(session.accessToken, { srcPersonaId: main.id, query: null, purpose: 'research' });
  assert.equal(res.outcome, 'empty'); // filtered: linkability high
  assert.equal(alias.linkVisibility, 'device_only');
});

test('heteronym: inspiration template only, never biographical facts (13)', () => {
  const m = new Moira({});
  const ctx = ownerCtx(m);
  const owner = m.owner.createPersona(ctx, { name: 'main', identity: 'linked' });
  const character = m.owner.createPersona(ctx, {
    name: 'the critic', identity: 'heteronymous',
    characterSheet: { name: 'The Critic', backstory: 'once a poet', voice: 'arch', beliefs: ['art is appetite'], expertise: ['film'], redLines: [], canonRules: [] }
  });
  const agent = m.owner.registerAgent(ctx, { name: 'a', tier: 'verified', personasAllowed: [character.id, owner.id] });
  m.facts.add(owner, { content: 'lives in berlin, midterm thursday', category: 'personal' });
  m.facts.add(owner, { content: 'obsessed with slow cinema', category: 'interests' });
  m.owner.createBridge(ctx, { src: owner.id, dst: character.id, purpose: 'inspiration', maxRung: 2 });
  m.owner.allowIngress(ctx, character.id, owner.id);
  const session = m.owner.createSession(ctx, { clientId: agent.id, personaId: character.id });
  const res = m.agent.bridge_request(session.accessToken, { srcPersonaId: owner.id, query: null, purpose: 'inspiration' });
  assert.equal(res.outcome, 'results');
  assert.equal(res.items.length, 1); // interests only
  assert.equal(res.items[0].category, 'interests');
  assert.equal(character.inheritsCore, false);
});

test('heteronym creation requires a character sheet (13)', () => {
  const m = new Moira({});
  const ctx = ownerCtx(m);
  assert.throws(() => m.owner.createPersona(ctx, { name: 'x', identity: 'heteronymous' }));
});

test('privacy budget exhausts and refuses (9.5)', () => {
  const { ctx, m, student, founder, agent } = setup();
  m.facts.add(student, { content: 'fact one', category: 'schedule', policy: { maxRung: 4 } });
  m.facts.add(student, { content: 'fact two', category: 'schedule', policy: { maxRung: 4 } });
  m.facts.add(student, { content: 'fact three', category: 'schedule', policy: { maxRung: 4, linkability: 'high' } });
  m.owner.createBridge(ctx, { src: student.id, dst: founder.id, purpose: 'planning', maxRung: 4 });
  m.owner.allowIngress(ctx, founder.id, student.id);
  const session = m.owner.createSession(ctx, { clientId: agent.id, personaId: founder.id });
  // full-rung facts cost 4 each; the linkable one costs 8. total 16 of 24.
  const r1 = m.agent.bridge_request(session.accessToken, { srcPersonaId: student.id, query: null, purpose: 'planning' });
  assert.equal(r1.outcome, 'results');
  assert.equal(r1.privacyBudget.spent, 16);
  m.facts.add(student, { content: 'fact four', category: 'schedule', policy: { maxRung: 4 } });
  m.facts.add(student, { content: 'fact five', category: 'schedule', policy: { maxRung: 4 } });
  const r2 = m.agent.bridge_request(session.accessToken, { srcPersonaId: student.id, query: null, purpose: 'planning' });
  assert.equal(r2.outcome, 'declined'); // 16 + 4 + 4 = 24 would exhaust the window
  assert.equal(r2.reason, 'privacy_budget_exhausted');
});

test('bridge import propose keeps derived_from edge to the source fact (9.2 step 6)', () => {
  const { ctx, m, student, founder, agent } = setup();
  const src = m.facts.add(student, { content: 'midterm', category: 'schedule' }).fact;
  m.owner.createBridge(ctx, { src: student.id, dst: founder.id, purpose: 'planning', maxRung: 4 });
  m.owner.allowIngress(ctx, founder.id, student.id);
  const session = m.owner.createSession(ctx, { clientId: agent.id, personaId: founder.id });
  const res = m.agent.bridge_request(session.accessToken, { srcPersonaId: student.id, query: null, purpose: 'planning' });
  const kept = m.agent.bridge_keep(session.accessToken, { item: res.items[0] });
  assert.equal(kept.outcome, 'approval_required');
  const proposal = m.facts.inbox(founder.id).find((f) => f.id === kept.proposalId);
  // the derived_from edge points across the persona boundary: persona/fact
  assert.deepEqual(proposal.representation.derivedFrom, [`${student.id}/${src.id}`]);
  // and the taint of the source fact is inherited (label-preserving import)
  assert.ok(proposal.policy.maxRung <= src.policy.maxRung);
});

test('bridge revoke severs the flow', () => {
  const { ctx, m, student, founder, agent } = setup();
  m.facts.add(student, { content: 'x', category: 'schedule' });
  const bridge = m.owner.createBridge(ctx, { src: student.id, dst: founder.id, purpose: 'planning' });
  m.owner.allowIngress(ctx, founder.id, student.id);
  const session = m.owner.createSession(ctx, { clientId: agent.id, personaId: founder.id });
  m.bridges.revoke(bridge.id);
  const res = m.agent.bridge_request(session.accessToken, { srcPersonaId: student.id, query: null, purpose: 'planning' });
  assert.equal(res.outcome, 'not_available');
});
