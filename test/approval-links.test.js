// saying no should not require an owner session (2026-11-13).
//
// ask expiry shipped: an ask carries a deadline and a ghost never sits in the
// inbox. the ergonomic half did not: replying to one question still meant
// authenticating as the owner, which is the wrong ask for "yes, this one".
//
// a link here is a short-lived, single-use, read-only token that answers
// exactly one ask: it can see that ask and decide it, and nothing else. it
// cannot list asks, read a fact, or touch another hat.

import test from 'node:test';
import assert from 'node:assert/strict';
import { Moira } from '../src/index.js';
import { MemoryStore } from '../src/store.js';

const HOUR = 3600000;

function setup() {
  const clock = { t: Date.parse('2026-11-13T12:00:00Z') };
  // the clock is injected, so "expired" is a fact the test states rather than a
  // sleep it hopes for
  const m = new Moira({ store: new MemoryStore(), now: () => clock.t });
  const owner = m.createOwnerContext({ kind: 'owner_session', verified: true, ownerRef: 'owner-a' });
  const p = m.owner.createPersona(owner, { name: 'alex-work', identity: 'pseudonymous' });
  m.facts.add(p, { content: 'ships on fridays', category: 'preferences', rungs: { summary: 'ships fridays' } });
  const agentId = m.owner.registerAgent(owner, { name: 'planner', tier: 'verified', personasAllowed: [p.id], spendCaps: { usd: 1 } }).id;
  const token = m.owner.createSession(owner, { clientId: agentId, personaId: p.id }).accessToken;
  const ask = (categories = ['preferences']) =>
    m.agent.request_access(token, { categories, purpose: 'draft the weekly note', duration: 'session' });
  return { m, owner, p, agentId, ask, clock };
}

test('approval links: the token is shown once, stored hashed, and answers one ask', () => {
  const { m, owner, ask, clock } = setup();
  const { request } = ask();
  const minted = m.owner.approvalLinkMint(owner, { requestId: request.id });
  assert.equal(minted.outcome, 'results');
  assert.match(minted.token, /^appr_/);
  assert.ok(minted.expiresAt > clock.t, 'a link has a deadline of its own');

  const stored = m.store.list('approvalLinks', () => true, {});
  assert.equal(stored.length, 1);
  assert.equal(stored[0].tokenHash.includes(minted.token), false, 'the raw token is never at rest');

  // read-only: it can see the ask, and nothing else about the hat
  const seen = m.approvals.peek({ token: minted.token });
  assert.equal(seen.outcome, 'results');
  assert.deepEqual(seen.request.categories, ['preferences']);
  assert.equal(seen.request.purpose, 'draft the weekly note');
  assert.equal(seen.request.personaName, 'alex-work');
  assert.equal(seen.request.duration, 'session');
  assert.equal(seen.request.status, 'pending');
  assert.equal(seen.facts, undefined, 'a link never shows a fact');
  assert.equal(seen.requests, undefined, 'nor the rest of the inbox');
});

test('approval links: deciding through the link mints the pass, once', () => {
  const { m, owner, ask, p } = setup();
  const { request } = ask();
  const { token } = m.owner.approvalLinkMint(owner, { requestId: request.id });

  const decided = m.approvals.decide({ token, decision: 'approve' });
  assert.equal(decided.outcome, 'results');
  assert.equal(decided.decision, 'approve');
  assert.equal(decided.passes.length, 1, 'yes means a pass, minted the same way the panel mints it');

  const after = m.store.get('accessRequests', request.id);
  assert.equal(after.status, 'approved');
  assert.ok(m.receipts.query({ personaId: p.id }).some((r) => r.reason === 'approved_via_link'),
    'the ledger says how the owner answered');

  // single use: a link already spent is not a way to answer twice
  const again = m.approvals.decide({ token, decision: 'deny' });
  assert.equal(again.outcome, 'declined');
  assert.equal(again.reason, 'link_already_used');
  assert.equal(m.store.get('accessRequests', request.id).status, 'approved', 'and it did not flip the answer');
});

test('approval links: no is an answer too, and it mints nothing', () => {
  const { m, owner, ask } = setup();
  const { request } = ask();
  const { token } = m.owner.approvalLinkMint(owner, { requestId: request.id });
  const denied = m.approvals.decide({ token, decision: 'deny', reason: 'not this one' });
  assert.equal(denied.outcome, 'results');
  assert.equal(denied.passes, undefined);
  assert.equal(m.store.get('accessRequests', request.id).status, 'denied');
  assert.equal(m.store.list('passes', (x) => x.personaId === request.personaId).length, 0);
});

test('approval links: an expired link or an expired ask refuses, and says which', () => {
  const { m, owner, ask, clock } = setup();
  const first = ask();
  const short = m.owner.approvalLinkMint(owner, { requestId: first.request.id, ttlMs: 30 * 24 * HOUR });
  clock.t = first.request.expiresAt + 1; // past the ask's own 7-day deadline
  const late = m.approvals.decide({ token: short.token, decision: 'approve' });
  assert.equal(late.outcome, 'declined');
  assert.equal(late.reason, 'request_expired', 'the ask deadline outranks the link');

  // a second shape, so the second ask is a real ask and not a duplicate of the
  // first one still sitting in the inbox
  const second = m.agent.request_access(
    m.owner.createSession(owner, { clientId: m.owner.registerAgent(owner, { name: 'drafter', tier: 'verified', personasAllowed: [first.request.personaId], spendCaps: { usd: 1 } }).id, personaId: first.request.personaId }).accessToken,
    { categories: ['work'], purpose: 'draft the deck', duration: 'session' }
  );
  const quick = m.owner.approvalLinkMint(owner, { requestId: second.request.id, ttlMs: HOUR });
  clock.t += HOUR + 1;
  const stale = m.approvals.decide({ token: quick.token, decision: 'approve' });
  assert.equal(stale.outcome, 'declined');
  assert.equal(stale.reason, 'link_expired');
  assert.equal(m.store.get('accessRequests', second.request.id).status, 'pending', 'a stale link changed nothing');
});

test('approval links: an unknown token, a decided ask and a frozen hat all fail closed', () => {
  const { m, owner, ask, p } = setup();
  assert.equal(m.approvals.peek({ token: 'appr_nope' }).reason, 'link_not_found');

  const a = ask();
  const minted = m.owner.approvalLinkMint(owner, { requestId: a.request.id });
  m.requests.approve({ requestId: a.request.id }); // the owner answered in the panel first
  const late = m.approvals.decide({ token: minted.token, decision: 'deny' });
  assert.equal(late.outcome, 'declined');
  assert.equal(late.reason, 'request_already_decided');

  const b = ask();
  const other = m.owner.approvalLinkMint(owner, { requestId: b.request.id });
  m.owner.freezePersona(owner, p.id);
  const frozen = m.approvals.decide({ token: other.token, decision: 'approve' });
  assert.equal(frozen.outcome, 'declined');
  assert.equal(frozen.reason, 'persona_frozen', 'a frozen hat takes no new access, by any route');
});

test('approval links: minting needs owner authority, and only a pending ask can be linked', async () => {
  const { m, owner, ask } = setup();
  assert.throws(() => m.owner.approvalLinkMint({ owner: true }, { requestId: 'rq_x' }), /owner/i,
    'a plain object is not authority');

  const missing = m.owner.approvalLinkMint(owner, { requestId: 'rq_nope' });
  assert.equal(missing.outcome, 'unavailable');
  assert.equal(missing.reason, 'request_not_found');

  const done = ask();
  m.requests.deny({ requestId: done.request.id });
  const decided = m.owner.approvalLinkMint(owner, { requestId: done.request.id });
  assert.equal(decided.outcome, 'declined');
  assert.equal(decided.reason, 'request_already_decided', 'a link to an answered ask is a dead link');
});
