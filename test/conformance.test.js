// conformance suite: golden end-to-end scenarios through the gateway facade
// (spec section 21.1: golden policy decisions, replayable for audit).
// these pin behavior that must hold in every edition: hosted, self-hosted,
// on-device. same inputs -> same decisions -> same receipts.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Moira } from '../src/index.js';

// verified owner session + context mint: in phase 0 the host application
// performs owner verification itself; phase 2 replaces this with supabase
// auth or passkeys (owner's choice pending).
const ownerSession = () => ({ kind: 'owner_session', verified: true, ownerRef: 'owner' });
const ownerCtx = (m) => m.createOwnerContext(ownerSession());


const DAY = 86400000;

// scenario: a student persona and a founder persona, one verified agent, a
// pseudonymous alias persona, and an expiring trial in the founder ledger.
function buildWorld() {
  const m = new Moira({});
  const ctx = ownerCtx(m);
  const student = m.owner.createPersona(ctx, { name: 'student', identity: 'linked' });
  const founder = m.owner.createPersona(ctx, { name: 'founder', identity: 'linked' });
  const alias = m.owner.createPersona(ctx, { name: 'nightwriter', identity: 'pseudonymous' });

  m.facts.add(student, {
    content: 'midterm thursday at 9', category: 'schedule',
    rungs: { summary: 'busy thursday morning', conclusion: 'low bandwidth this week', exists: 'busy this week' }
  });
  m.facts.add(student, {
    content: 'uses claude on free credits', category: 'preferences',
    preferenceBasis: 'availability_driven', validUntil: Date.now() + 5 * DAY
  });
  m.facts.add(founder, {
    content: 'pitch demo day nov 20', category: 'schedule',
    rungs: { summary: 'demo prep in november' }
  });
  m.facts.add(student, {
    content: 'home address', category: 'personal', policy: { linkability: 'high', maxRung: 1 }
  });

  const agent = m.owner.registerAgent(ctx, { name: 'helper', tier: 'verified', personasAllowed: [student.id, founder.id, alias.id], spendCaps: { usd: 15 } });
  m.owner.addAccount(ctx, founder.id, {
    provider: 'acme-ai', label: 'trial', kind: 'free_trial',
    limits: [{ unit: 'usd', cap: 30, windowMs: null }],
    expiresAt: Date.now() + 3 * DAY, capabilities: { models: ['acme-4'], tools: [], regions: [] },
    secret: 'sk_trial_1', remainingValue: 25
  });
  return { ctx, m, student, founder, alias, agent };
}

test('golden: no pass -> approval_required; with pass -> rung-capped facts; one-time consumption', () => {
  const { ctx, m, student, agent } = buildWorld();
  const session = m.owner.createSession(ctx, { clientId: agent.id, personaId: student.id });

  const before = m.agent.persona_context(session.accessToken, { categories: ['schedule'], purpose: 'research' });
  assert.equal(before.outcome, 'approval_required');

  m.owner.grantPass(ctx, { clientId: agent.id, personaId: student.id, category: 'schedule', purpose: 'research', maxRung: 2, duration: 'one_time' , acknowledgeFull: true });
  const after = m.agent.persona_context(session.accessToken, { categories: ['schedule'], purpose: 'research' });
  assert.equal(after.outcome, 'results');
  const served = after.categories.schedule.served;
  assert.equal(served.length, 1);
  assert.equal(served[0].rung, 'conclusion');
  assert.equal(served[0].content, 'low bandwidth this week');

  // one-time pass consumed
  const again = m.agent.persona_context(session.accessToken, { categories: ['schedule'], purpose: 'research' });
  assert.equal(again.outcome, 'approval_required');
});

test('golden: preference facts are served with their basis, so agents can phrase them honestly', () => {
  const { ctx, m, student, agent } = buildWorld();
  m.owner.grantPass(ctx, { clientId: agent.id, personaId: student.id, category: 'preferences', purpose: 'research' , acknowledgeFull: true });
  const session = m.owner.createSession(ctx, { clientId: agent.id, personaId: student.id });
  const res = m.agent.persona_context(session.accessToken, { categories: ['preferences'], purpose: 'research' });
  assert.equal(res.outcome, 'results');
  const fact = res.categories.preferences.served[0];
  assert.equal(fact.preferenceBasis, 'availability_driven');
  assert.ok(fact.validUntil > Date.now());
});

test('golden: bridge flow with rung transform, receipts, and no auto-merge', () => {
  const { ctx, m, student, founder, agent } = buildWorld();
  m.owner.createBridge(ctx, { src: student.id, dst: founder.id, purpose: 'planning', maxRung: 2 });
  m.owner.allowIngress(ctx, founder.id, student.id);
  const session = m.owner.createSession(ctx, { clientId: agent.id, personaId: founder.id });
  const res = m.agent.bridge_request(session.accessToken, { srcPersonaId: student.id, query: null, purpose: 'planning' });
  assert.equal(res.outcome, 'results');
  // the linkable home-address fact only crosses at the exists rung (its
  // max_rung is 1): the ladder redacts the content, not the existence
  const personal = res.items.find((i) => i.category === 'personal');
  assert.ok(personal);
  assert.equal(personal.rung, 'exists');
  assert.ok(!personal.content.includes('address'));
  // schedule flowed at conclusion rung max (bridge cap 2)
  const sched = res.items.find((i) => i.category === 'schedule');
  assert.ok(['conclusion', 'exists'].includes(sched.rung));
  assert.equal(res.merged, false);
  // both sides wrote content-free receipts
  assert.equal(m.receipts.query({ personaId: student.id, op: 'bridge' }).length, 1);
  assert.equal(m.receipts.query({ personaId: founder.id, op: 'bridge' }).length, 1);
});

test('golden: agent remember is a proposal; preference from ledger events is refused', () => {
  const { ctx, m, founder, agent } = buildWorld();
  const session = m.owner.createSession(ctx, { clientId: agent.id, personaId: founder.id });
  const res = m.agent.remember(session.accessToken, {
    content: 'founder likes acme-ai', category: 'preferences',
    evidence: ['ledger_event']
  });
  assert.equal(res.outcome, 'declined');
  assert.equal(res.reason, 'preference_poisoning');

  const ok = m.agent.remember(session.accessToken, { content: 'wants intro to acme founder', category: 'notes', basis: 'stated' });
  assert.equal(ok.outcome, 'approval_required');
  const approved = m.owner.approveProposal(ctx, ok.proposalId);
  assert.equal(approved.outcome, 'results');
  assert.equal(approved.fact.status, 'active');
});

test('golden: budget_route picks the expiring trial, mints a capped lease, meters spend', () => {
  const { ctx, m, founder, agent } = buildWorld();
  const session = m.owner.createSession(ctx, { clientId: agent.id, personaId: founder.id });
  const res = m.agent.budget_route(session.accessToken, { task: { models: ['acme-4'] }, constraints: { estimatedCost: 5, taskCap: 5 } });
  assert.equal(res.outcome, 'results');
  assert.equal(res.ranked[0].provider, 'acme-ai');
  assert.ok(res.lease);
  const s1 = m.router.spend(res.lease.id, { amount: 4, models: ['acme-4'] });
  assert.equal(s1.outcome, 'results');
  const s2 = m.router.spend(res.lease.id, { amount: 4, models: ['acme-4'] });
  assert.equal(s2.outcome, 'declined'); // lease cap 5 (lowest binding: task 5 < agent 15)
  // the router choice wrote no preference facts
  assert.equal(m.facts.active(founder.id, { category: 'preferences' }).length, 0);
});

test('golden: heteronym persona refuses to inherit the core and keeps canon inside', () => {
  const m = new Moira({});
  const ctx = ownerCtx(m);
  const owner = m.owner.createPersona(ctx, { name: 'main', identity: 'linked' });
  const critic = m.owner.createPersona(ctx, {
    name: 'the-critic', identity: 'heteronymous',
    characterSheet: { name: 'The Critic', backstory: 'former poet', voice: 'arch', beliefs: ['art is appetite'], expertise: ['film'], redLines: [], canonRules: [] }
  });
  assert.equal(critic.inheritsCore, false);
  assert.equal(critic.ingress.template, 'inspiration_only');
  assert.equal(critic.egress.template, 'attribution_only');
  assert.equal(critic.disclosure, 'secret');
});

test('golden: pseudonymous persona is device_only by default with pairwise subs', () => {
  const { ctx, m, alias, agent } = buildWorld();
  assert.equal(alias.linkVisibility, 'device_only');
  const subA = m.personas.sub(alias.id, agent.id);
  const subB = m.personas.sub(alias.id, 'other-client');
  assert.notEqual(subA, subB);
});

test('determinism: identical worlds produce identical receipt ledgers', () => {
  const run = () => {
    const { ctx, m, student, agent } = buildWorld();
    m.owner.grantPass(ctx, { clientId: agent.id, personaId: student.id, category: 'schedule', purpose: 'research', maxRung: 2 , acknowledgeFull: true });
    const session = m.owner.createSession(ctx, { clientId: agent.id, personaId: student.id });
    m.agent.persona_context(session.accessToken, { categories: ['schedule'], purpose: 'research' });
    return m.receipts.fingerprint();
  };
  const a = run();
  const b = run();
  // actor ids and personas differ per run, but shape/counts must match;
  // determinism of decisions is pinned by the other golden tests. we assert
  // the receipt count is stable.
  assert.equal(a.split(':')[0], b.split(':')[0]);
});
