// shared adapter scenario battery (phase 1: verify).
//
// the same scenarios run against:
//   - the mock postgrest server (test/supabase-adapter.test.js) in the
//     default offline suite, and
//   - a real scratch supabase project (test/real-supabase.test.js), gated
//     behind MOIRA_REAL_SUPABASE=1 + SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY.
//
// keeping them in one module is the point: the real-project run must exercise
// exactly what the mock run exercises, no more, no less.

import { Moira } from '../../src/index.js';

export const ownerSession = () => ({ kind: 'owner_session', verified: true, ownerRef: 'owner' });
export const ownerCtx = (m) => m.createOwnerContext(ownerSession());

// the full cross-service scenario: personas, facts, passes, sessions, bridges,
// ledger, router, proposals, receipts, persona delete. returns a plain outcome
// object that must be identical across stores.
export function fullScenario(m, ctx) {
  const out = {};
  const student = m.owner.createPersona(ctx, { name: 'student', identity: 'linked' });
  const founder = m.owner.createPersona(ctx, { name: 'founder', identity: 'linked' });
  m.facts.add(student, {
    content: 'midterm thursday at 9', category: 'schedule',
    rungs: { summary: 'busy thursday morning', conclusion: 'low bandwidth this week' }
  });
  const agent = m.owner.registerAgent(ctx, { name: 'helper', tier: 'verified', personasAllowed: [student.id, founder.id], spendCaps: { usd: 15 } });
  m.owner.grantPass(ctx, { clientId: agent.id, personaId: student.id, category: 'schedule', purpose: 'research', maxRung: 2, acknowledgeFull: true });
  const session = m.owner.createSession(ctx, { clientId: agent.id, personaId: student.id });
  const read = m.agent.persona_context(session.accessToken, { categories: ['schedule'], purpose: 'research' });
  out.read = { outcome: read.outcome, rung: read.categories.schedule.served[0].rung, content: read.categories.schedule.served[0].content };

  m.owner.createBridge(ctx, { src: student.id, dst: founder.id, purpose: 'planning', maxRung: 2 });
  m.owner.allowIngress(ctx, founder.id, student.id);
  const fSession = m.owner.createSession(ctx, { clientId: agent.id, personaId: founder.id });
  const bridged = m.agent.bridge_request(fSession.accessToken, { srcPersonaId: student.id, query: null, purpose: 'planning' });
  out.bridge = { outcome: bridged.outcome, rung: bridged.items[0]?.rung, trust: bridged.items[0]?.trust };

  m.owner.addAccount(ctx, founder.id, {
    provider: 'acme-ai', kind: 'free_trial', label: 'trial',
    limits: [{ unit: 'usd', cap: 30, windowMs: null }],
    expiresAt: Date.now() + 3 * 86400000, capabilities: { models: ['acme-4'], tools: [], regions: [] },
    secret: 'sk_trial_1'
  });
  const routed = m.agent.budget_route(fSession.accessToken, { task: { models: ['acme-4'] }, constraints: { estimatedCost: 5, taskCap: 5 } });
  out.route = { outcome: routed.outcome, provider: routed.ranked[0]?.provider, hasLease: !!routed.lease };
  out.spend = m.router.spend(routed.lease.id, { amount: 3, models: ['acme-4'] }).outcome;
  out.spendOver = m.router.spend(routed.lease.id, { amount: 3, models: ['acme-4'] }).outcome;

  const rem = m.agent.remember(session.accessToken, { content: 'wants intro to acme founder', category: 'notes', basis: 'stated' });
  out.remember = rem.outcome;
  out.approve = m.owner.approveProposal(ctx, rem.proposalId).outcome;

  const receipts = m.receipts.query({ personaId: student.id });
  out.receipts = receipts.length;
  out.receiptsValid = receipts.every((r) => r.valid);

  out.statusBudget = m.agent.moira_status(session.accessToken).budget.known;
  out.delete = m.owner.deletePersona(ctx, student.id).outcome;
  out.deletedFacts = m.facts.active(student.id).length;
  return out;
}

// a "restart": a fresh gateway over the same rows and instance key. wrapped
// keys must be unwrapped from the store and reads must still serve.
export function restartScenario(store, instanceKey) {
  const a = new Moira({ store, instanceKey });
  const ctx = ownerCtx(a);
  const p = a.owner.createPersona(ctx, { name: 'student', identity: 'linked' });
  a.facts.add(p, { content: 'midterm thursday at 9', category: 'schedule' });
  const agentId = a.owner.registerAgent(ctx, { name: 'x', tier: 'verified', personasAllowed: [p.id] }).id;
  a.owner.grantPass(ctx, { clientId: agentId, personaId: p.id, category: 'schedule', purpose: 'research', maxRung: 4, acknowledgeFull: true });
  return { gatewayA: a, personaId: p.id, agentId };
}

export function restartAssertions(b, { personaId, agentId }) {
  if (b.facts.active(personaId).length !== 1) throw new Error('restart: expected 1 active fact');
  if (b.facts.active(personaId)[0].content !== 'midterm thursday at 9') throw new Error('restart: fact content mismatch (key unwrap failed?)');
  const session = b.owner.createSession(ownerCtx(b), { clientId: agentId, personaId });
  const read = b.agent.persona_context(session.accessToken, { categories: ['schedule'], purpose: 'research' });
  if (read.outcome !== 'results') throw new Error(`restart: read outcome ${read.outcome}`);
  if (read.categories.schedule.served[0].content !== 'midterm thursday at 9') throw new Error('restart: served content mismatch');
}

// where-pushdown: rows of other personas must never transfer.
export function pushdownScenario(store) {
  store.put('facts', 'f1', { id: 'f1', personaId: 'pa', status: 'active' });
  store.put('facts', 'f2', { id: 'f2', personaId: 'pb', status: 'active' });
  store.put('facts', 'f3', { id: 'f3', personaId: 'pa', status: 'active' });
  const rows = store.list('facts', () => true, { personaId: 'pa', status: 'active' });
  if (rows.length !== 2 || !rows.every((r) => r.personaId === 'pa')) {
    throw new Error(`pushdown: expected 2 rows for pa, got ${rows.length}`);
  }
  return rows.map((r) => r.id).sort();
}
