// router + ledger safety (phase 0 item 3, spec 8.3/8.5/11):
// - expired accounts are never eligible
// - headroom is per unit; a usd estimate is never compared against a requests cap
// - an account with no limits entered is UNKNOWN, not unlimited; routing such
//   an account returns approval_required/unknown_budget unless the owner
//   explicitly marked it unmetered
// - remainingValueOf never silently defaults to 1

import test from 'node:test';
import assert from 'node:assert/strict';
import { Moira } from '../src/index.js';
import { eligibility } from '../src/core/policy.js';

const ownerSession = () => ({ kind: 'owner_session', verified: true, ownerRef: 'owner' });

function world(m) {
  const ctx = m.createOwnerContext(ownerSession());
  const p = m.owner.createPersona(ctx, { name: 'student', identity: 'linked' });
  const agent = m.owner.registerAgent(ctx, { name: 'a', tier: 'verified', personasAllowed: [p.id] });
  return { ctx, p, agent };
}

const LIMITS_USD_10 = [{ unit: 'usd', cap: 10, windowMs: null }];
const MIXED_LIMITS = [
  { unit: 'requests', cap: 1000, windowMs: null },
  { unit: 'usd', cap: 10, windowMs: null }
];

test('eligibility rejects expired accounts with reason "expired"', () => {
  const m = new Moira({});
  const { ctx, p, agent } = world(m);
  const now = m.now();
  const acc = m.owner.addAccount(ctx, p.id, {
    provider: 'openai', label: 'dead trial', kind: 'credits',
    limits: LIMITS_USD_10, expiresAt: now - 1000
  });
  const session = m.owner.createSession(ctx, { clientId: agent.id, personaId: p.id });
  const res = m.agent.budget_route(session.accessToken, { task: { models: [] }, constraints: { estimatedCost: 5 } });
  assert.equal(res.outcome, 'empty');
  assert.equal(res.ineligible[0].reason, 'expired');

  // pure form too, at the exact boundary
  const r = eligibility({
    account: { personaId: p.id, limits: LIMITS_USD_10, expiresAt: now, headroom: 10 },
    persona: p, task: {}, caps: null, estimatedCost: 5, now
  });
  assert.equal(r.eligible, false);
  assert.equal(r.reason, 'expired');
});

test('headroom is per unit: a usd estimate is never measured against a requests cap', () => {
  const m = new Moira({});
  const { ctx, p, agent } = world(m);
  m.owner.addAccount(ctx, p.id, { provider: 'x', label: 'mixed', kind: 'credits', limits: MIXED_LIMITS });

  // usd headroom is 10, not 10+1000
  assert.equal(m.ledger.headroom(m.ledger.list(p.id)[0], 'usd'), 10);
  assert.equal(m.ledger.headroom(m.ledger.list(p.id)[0], 'requests'), 1000);

  const session = m.owner.createSession(ctx, { clientId: agent.id, personaId: p.id });
  const res = m.agent.budget_route(session.accessToken, { task: { models: [] }, constraints: { estimatedCost: 50 } });
  assert.equal(res.outcome, 'empty');
  assert.ok(res.ineligible.some((i) => i.reason === 'headroom'));
});

test('an account with no limits entered is unknown, not unlimited', () => {
  const m = new Moira({});
  const { ctx, p, agent } = world(m);
  m.owner.addAccount(ctx, p.id, { provider: 'x', label: 'mystery', kind: 'credits', limits: [] });

  const session = m.owner.createSession(ctx, { clientId: agent.id, personaId: p.id });
  const res = m.agent.budget_route(session.accessToken, { task: { models: [] }, constraints: { estimatedCost: 5 } });
  // unknown limits never silently route: approval required with reason unknown_budget
  assert.equal(res.outcome, 'approval_required');
  assert.equal(res.reason, 'unknown_budget');
});

test('an account the owner explicitly marked unmetered routes normally', () => {
  const m = new Moira({});
  const { ctx, p, agent } = world(m);
  m.owner.addAccount(ctx, p.id, { provider: 'self-host', label: 'home gpu', kind: 'paid_plan', limits: [], unmetered: true });

  const session = m.owner.createSession(ctx, { clientId: agent.id, personaId: p.id });
  const res = m.agent.budget_route(session.accessToken, { task: { models: [] }, constraints: { estimatedCost: 500 } });
  assert.equal(res.outcome, 'results');
  assert.equal(res.ranked.length, 1);
});

test('remainingValueOf never silently defaults to 1', () => {
  const m = new Moira({});
  const { ctx, p } = world(m);
  const noLimits = m.owner.addAccount(ctx, p.id, { provider: 'x', label: 'mystery', kind: 'credits', limits: [] }).account;
  assert.equal(m.ledger.remainingValueOf(noLimits), null);

  const usd = m.owner.addAccount(ctx, p.id, { provider: 'y', label: 'paid', kind: 'credits', limits: LIMITS_USD_10 }).account;
  assert.equal(m.ledger.remainingValueOf(usd), 10);

  const stated = m.owner.addAccount(ctx, p.id, { provider: 'z', label: 'trial', kind: 'credits', limits: [], remainingValue: 42 }).account;
  assert.equal(m.ledger.remainingValueOf(stated), 42);
});

test('unknown-budget accounts do not poison a ledger with known accounts', () => {
  const m = new Moira({});
  const { ctx, p, agent } = world(m);
  m.owner.addAccount(ctx, p.id, { provider: 'a', label: 'known', kind: 'credits', limits: LIMITS_USD_10 });
  m.owner.addAccount(ctx, p.id, { provider: 'b', label: 'mystery', kind: 'credits', limits: [] });

  const session = m.owner.createSession(ctx, { clientId: agent.id, personaId: p.id });
  const res = m.agent.budget_route(session.accessToken, { task: { models: [] }, constraints: { estimatedCost: 5 } });
  assert.equal(res.outcome, 'results');
  assert.equal(res.ranked.length, 1);
  assert.ok(res.ineligible.some((i) => i.reason === 'unknown_budget'));
});
