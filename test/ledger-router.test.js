// ledger, router, leases, caps (sections 8, 9.4)
import test from 'node:test';
import assert from 'node:assert/strict';
import { Moira } from '../src/index.js';

// verified owner session + context mint: in phase 0 the host application
// performs owner verification itself; phase 2 replaces this with supabase
// auth or passkeys (owner's choice pending).
const ownerSession = () => ({ kind: 'owner_session', verified: true, ownerRef: 'owner' });
const ownerCtx = (m) => m.createOwnerContext(ownerSession());


const DAY = 86400000;

const setup = () => {
  const m = new Moira({});
  const ctx = ownerCtx(m);
  const p = m.owner.createPersona(ctx, { name: 'hacker', identity: 'linked' });
  const agent = m.owner.registerAgent(ctx, { name: 'builder', tier: 'verified', personasAllowed: [p.id], spendCaps: { usd: 20 } });
  return { ctx, m, p, agent };
};

const acct = (over = {}) => ({
  provider: 'acme-ai', label: 'trial', kind: 'free_trial',
  limits: [{ unit: 'usd', cap: 100, windowMs: null }],
  expiresAt: Date.now() + 5 * DAY, capabilities: { models: ['acme-4'], tools: [], regions: [] },
  secret: 'sk_live_x', ...over
});

test('secrets are sealed and never returned; accounts carry provenance (8.1, 8.2)', () => {
  const { ctx, m, p } = setup();
  const res = m.owner.addAccount(ctx, p.id, acct());
  assert.equal(res.outcome, 'results');
  assert.equal(res.account.secretSealed, undefined);
  const stored = m.store.get('accounts', res.account.id);
  assert.ok(stored.secretSealed);
  assert.ok(!JSON.stringify(stored).includes('sk_live_x'));
  assert.equal(stored.provenance.confirmed, true);
});

test('alerts fire at t-7 and t-2, and ahead of trial conversion (8.6)', () => {
  const { ctx, m, p } = setup();
  m.owner.addAccount(ctx, p.id, acct({ expiresAt: Date.now() + 6 * DAY }));
  const t2 = m.owner.addAccount(ctx, p.id, acct({ provider: 'beta-ai', expiresAt: Date.now() + 1.5 * DAY, label: 't-2 trial' }));
  m.owner.addAccount(ctx, p.id, acct({ provider: 'gamma-ai', convertsToPaidAt: Date.now() + 3 * DAY, cancelBy: Date.now() + 2 * DAY, label: 'converting', expiresAt: null }));
  const alerts = m.ledger.alerts(p.id);
  const kinds = alerts.map((a) => a.kind);
  assert.ok(kinds.includes('expiry'));
  assert.ok(kinds.includes('conversion'));
  const conv = alerts.find((a) => a.kind === 'conversion');
  assert.match(conv.message, /cancel by/);
  assert.ok(alerts.every((a) => typeof a.estimated === 'boolean'));
});

test('router: expiring trial outranks permanent paid plan (8.3)', () => {
  const { ctx, m, p } = setup();
  m.owner.addAccount(ctx, p.id, acct({ provider: 'expiring-trial', remainingValue: 50, expiresAt: Date.now() + 3 * DAY }));
  m.owner.addAccount(ctx, p.id, acct({ provider: 'paid-plan', kind: 'paid_plan', expiresAt: null, remainingValue: 500, costPerUnit: 0.001, renews: true }));
  const ranked = m.ledger.rankFor(p.id);
  assert.equal(ranked[0].account.provider, 'expiring-trial');
});

test('router eligibility order: persona fit is a hard filter (8.3)', () => {
  const m = new Moira({});
  const ctx = ownerCtx(m);
  const a = m.owner.createPersona(ctx, { name: 'main', identity: 'linked' });
  const b = m.owner.createPersona(ctx, { name: 'alias', identity: 'pseudonymous' });
  m.owner.addAccount(ctx, a.id, acct({ provider: 'main-key' }));
  const sessionless = m.router.route({
    personaId: b.id, task: { models: ['acme-4'] }, constraints: { estimatedCost: 1 }
  });
  assert.equal(sessionless.outcome, 'empty'); // b has no accounts of its own
});

test('router: data-policy fit; sensitive persona refuses retaining tiers (8.3)', () => {
  const m = new Moira({});
  const ctx = ownerCtx(m);
  const p = m.owner.createPersona(ctx, { name: 'sensitive', identity: 'linked', sensitive: true });
  m.owner.addAccount(ctx, p.id, acct({ provider: 'retainer', dataPolicy: 'retains' }));
  m.owner.addAccount(ctx, p.id, acct({ provider: 'clean', dataPolicy: 'no_retention' }));
  const res = m.router.route({ personaId: p.id, task: {}, constraints: {} });
  assert.ok(res.ranked.every((r) => r.provider === 'clean'));
});

test('router: capability fit filters by model (8.3)', () => {
  const { ctx, m, p, agent } = setup();
  m.owner.addAccount(ctx, p.id, acct({ provider: 'right', capabilities: { models: ['acme-4'] } }));
  m.owner.addAccount(ctx, p.id, acct({ provider: 'wrong', capabilities: { models: ['other-9'] } }));
  const session = m.owner.createSession(ctx, { clientId: agent.id, personaId: p.id });
  const res = m.agent.budget_route(session.accessToken, { task: { models: ['acme-4'] } });
  assert.equal(res.outcome, 'results');
  assert.ok(res.ranked.every((r) => r.provider === 'right'));
  assert.ok(res.ineligible.some((x) => x.reason === 'capability_fit'));
});

test('lowest binding cap wins; hard cap refuses, soft cap asks (8.5)', () => {
  const { ctx, m, p, agent } = setup();
  m.owner.addAccount(ctx, p.id, acct());
  const session = m.owner.createSession(ctx, { clientId: agent.id, personaId: p.id });
  // task cap 5 under agent cap 20: fine
  const ok = m.agent.budget_route(session.accessToken, { task: {}, constraints: { estimatedCost: 5, taskCap: 5 } });
  assert.equal(ok.outcome, 'results');
  // estimate above agent hard cap: declined
  const blocked = m.agent.budget_route(session.accessToken, { task: {}, constraints: { estimatedCost: 50 } });
  assert.equal(blocked.outcome, 'declined');
  assert.equal(blocked.reason, 'hard_cap');
  assert.equal(blocked.cap, 20); // lowest binding cap: agent 20 < task none
});

test('leases: agents never see raw secrets; spend is metered and capped (8.4)', () => {
  const { ctx, m, p, agent } = setup();
  const account = m.owner.addAccount(ctx, p.id, acct()).account;
  const session = m.owner.createSession(ctx, { clientId: agent.id, personaId: p.id });
  const lease = m.agent.lease_request(session.accessToken, { accountId: account.id, maxSpend: 10, models: ['acme-4'] });
  assert.equal(lease.outcome, 'results');
  assert.equal(lease.lease.status, 'active');
  assert.ok(!JSON.stringify(lease.lease).includes('sk_live_x'));
  const s1 = m.router.spend(lease.lease.id, { amount: 7, models: ['acme-4'] });
  assert.equal(s1.outcome, 'results');
  const s2 = m.router.spend(lease.lease.id, { amount: 7, models: ['acme-4'] });
  assert.equal(s2.outcome, 'declined'); // max_spend cap
  const acctNow = m.ledger.get(account.id);
  assert.equal(m.ledger.usedInWindow(acctNow, 'usd', null), 7); // only the successful spend metered
});

test('lease model binding is enforced (confused deputy, 15 threat 10)', () => {
  const { ctx, m, p, agent } = setup();
  const account = m.owner.addAccount(ctx, p.id, acct()).account;
  const session = m.owner.createSession(ctx, { clientId: agent.id, personaId: p.id });
  const lease = m.agent.lease_request(session.accessToken, { accountId: account.id, maxSpend: 10, models: ['acme-4'] });
  const res = m.router.spend(lease.lease.id, { amount: 1, models: ['other-9'] });
  assert.equal(res.outcome, 'declined');
  assert.equal(res.reason, 'model_not_in_lease');
});

test('unverified agents cannot hold leases (9.4)', () => {
  const { ctx, m, p } = setup();
  const unverified = m.owner.registerAgent(ctx, { name: 'sketchy', tier: 'unverified', personasAllowed: [p.id] });
  const account = m.owner.addAccount(ctx, p.id, acct()).account;
  const session = m.owner.createSession(ctx, { clientId: unverified.id, personaId: p.id });
  const res = m.agent.lease_request(session.accessToken, { accountId: account.id, maxSpend: 5 });
  assert.equal(res.outcome, 'declined');
  assert.equal(res.reason, 'tier_cannot_hold_leases');
});

test('kill switch freezes all leases for a persona (8.5)', () => {
  const { ctx, m, p, agent } = setup();
  const account = m.owner.addAccount(ctx, p.id, acct()).account;
  const session = m.owner.createSession(ctx, { clientId: agent.id, personaId: p.id });
  const lease = m.agent.lease_request(session.accessToken, { accountId: account.id, maxSpend: 10 });
  m.owner.killSwitch(ctx, p.id);
  const res = m.router.spend(lease.lease.id, { amount: 1 });
  assert.equal(res.outcome, 'declined');
});

test('router choices do not create or strengthen preference facts (8.9)', () => {
  const { ctx, m, p, agent } = setup();
  m.owner.addAccount(ctx, p.id, acct());
  const session = m.owner.createSession(ctx, { clientId: agent.id, personaId: p.id });
  m.agent.budget_route(session.accessToken, { task: {} });
  const prefs = m.facts.active(p.id, { category: 'preferences' });
  assert.equal(prefs.length, 0);
  const spendReceipts = m.receipts.query({ personaId: p.id, op: 'spend' });
  assert.ok(spendReceipts.every((r) => (r.reason ?? '').includes('availability') || (r.reason ?? '').includes('lease_spend')));
});

test('runway view: timeline + use-first queue (8.6)', () => {
  const { ctx, m, p } = setup();
  m.owner.addAccount(ctx, p.id, acct({ provider: 'a', expiresAt: Date.now() + 2 * DAY }));
  m.owner.addAccount(ctx, p.id, acct({ provider: 'b', expiresAt: Date.now() + 8 * DAY }));
  const runway = m.ledger.runway(p.id);
  assert.equal(runway.timeline.length, 2);
  assert.ok(runway.timeline[0].kind === 'expiry');
  assert.equal(runway.useFirst.length, 2);
});
