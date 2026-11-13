// an ask that nobody answers must not sit in the inbox forever (2026-11-13).
//
// agent-vault's proposals expire in 7 days; ours were pending until the heat
// death of the instance. expiry is not a permission question (a pending ask
// grants nothing either way) - it is bookkeeping honesty, so "still waiting"
// never describes an ask the owner stopped being able to answer.

import test from 'node:test';
import assert from 'node:assert/strict';
import { Moira } from '../src/index.js';
import { MemoryStore } from '../src/store.js';

const DAY = 86_400_000;

function setup() {
  let t = 1_900_000_000_000;
  const m = new Moira({ store: new MemoryStore(), now: () => t });
  const owner = m.createOwnerContext({ kind: 'owner_session', verified: true, ownerRef: 'owner-a' });
  const p = m.owner.createPersona(owner, { name: 'alex-work', identity: 'pseudonymous' });
  const agentId = m.owner.registerAgent(owner, { name: 'planner', tier: 'verified', personasAllowed: [p.id], spendCaps: { usd: 1 } }).id;
  const sess = m.owner.createSession(owner, { clientId: agentId, personaId: p.id });
  const made = m.agent.request_access(sess.accessToken, {
    categories: ['preferences'], purpose: 'draft_replies', duration: 'session'
  });
  return { m, owner, p, agentId, token: sess.accessToken, requestId: made.request.id, advance: (ms) => { t += ms; return t; }, now: () => t };
}

test('asks expire after seven days, and expiry is visible before it is swept', () => {
  const { m, owner, requestId, advance } = setup();
  const fresh = m.owner.listAccessRequests(owner, { status: 'pending' });
  assert.equal(fresh.requests.length, 1);
  assert.ok(fresh.requests[0].expiresAt > 0, 'an ask carries its own deadline');

  advance(7 * DAY - 1);
  assert.equal(m.owner.listAccessRequests(owner, { status: 'pending' }).requests.length, 1, 'still answerable one ms before');

  advance(2);
  const stale = m.owner.listAccessRequests(owner, { status: 'pending' });
  assert.equal(stale.requests.length, 0, 'a stale ask is not pending, even before a sweep');
  const expired = m.owner.listAccessRequests(owner, { status: 'expired' });
  assert.equal(expired.requests.length, 1);
  assert.equal(expired.requests[0].id, requestId);
});

test('an expired ask cannot be approved, and says why', () => {
  const { m, owner, requestId, advance } = setup();
  advance(8 * DAY);
  const late = m.owner.approveAccessRequest(owner, { requestId });
  assert.equal(late.outcome, 'declined', 'expiry is a refusal, never an accidental grant');
  assert.equal(late.reason, 'request_expired');
  const after = m.owner.listAccessRequests(owner, { status: 'expired' }).requests[0];
  assert.equal(after.status, 'expired');
  assert.equal(after.passIds, undefined, 'expiry mints no pass');
});

test('the sweep is idempotent and receipts each expiry exactly once', () => {
  const { m, owner, advance } = setup();
  advance(8 * DAY);
  const first = m.owner.sweepAccessRequests(owner);
  assert.equal(first.outcome, 'results');
  assert.equal(first.expired, 1);
  const receipts = () => JSON.stringify(m.store.list('receipts', () => true, {}));
  const once = receipts();
  assert.equal(once.includes('access_request_expired'), true, 'the expiry is recorded');
  const second = m.owner.sweepAccessRequests(owner);
  assert.equal(second.expired, 0, 'a swept ask is not swept twice');
  assert.equal(receipts(), once, 'and nothing is written the second time');
});
