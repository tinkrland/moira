// linkage-aware isolation (spec 22.4 v1 hooks): moment-of-risk warnings when
// an account would create an undeclared link between decoupled personas,
// declared vs time-boxed acknowledged pairs, and linkage-aware routing that
// prefers accounts which do not create a new link. findings never reach
// agents: the agent surface (budget_route) sees plain ranking only.

import test from 'node:test';
import assert from 'node:assert/strict';
import { Moira } from '../src/index.js';
import { MemoryStore } from '../src/store.js';

const ownerSession = () => ({ kind: 'owner_session', verified: true, ownerRef: 'owner' });
const DAY = 86400000;

const acct = (over = {}) => ({
  provider: 'acme-ai', label: 'trial', kind: 'free_trial',
  limits: [{ unit: 'usd', cap: 100, windowMs: null }],
  expiresAt: Date.now() + 5 * DAY, capabilities: { models: ['acme-4'], tools: [], regions: [] },
  secret: 'sk_live_x', ...over
});

function setup() {
  const m = new Moira({ store: new MemoryStore() });
  const ctx = m.createOwnerContext(ownerSession());
  const founder = m.owner.createPersona(ctx, { name: 'founder', identity: 'linked' });
  const student = m.owner.createPersona(ctx, { name: 'student', identity: 'linked' });
  const alias = m.owner.createPersona(ctx, { name: 'alias', identity: 'pseudonymous' });
  const agentId = m.owner.registerAgent(ctx, { name: 'helper', tier: 'verified', personasAllowed: [alias.id], spendCaps: { usd: 10 } }).id;
  const sess = m.owner.createSession(ctx, { clientId: agentId, personaId: alias.id });
  return { m, ctx, founder, student, alias, agentId, sess };
}

// --- moment of risk (22.4): warn BEFORE the link is made -------------------------

test('linkage: shared payer across decoupled personas warns before the account exists', () => {
  const { m, ctx, founder, alias } = setup();
  m.owner.addAccount(ctx, founder.id, acct({ payerLabel: 'personal-visa' }));

  const res = m.owner.addAccount(ctx, alias.id, acct({ payerLabel: 'personal-visa' }));
  assert.equal(res.outcome, 'approval_required', 'not declined, not created: the owner decides');
  assert.equal(res.reason, 'linkage_finding');
  assert.deepEqual(res.finding.personaIds, [alias.id, founder.id].sort());
  assert.equal(res.finding.kind, 'payer');
  assert.equal(res.finding.hard, true, 'payer is a unique attribute: hard finding');
  // no account was created (the alert fires before the link is made)
  assert.equal(m.ledger.list(alias.id).length, 0);
  // and no plaintext identifier rides in the finding
  assert.ok(!JSON.stringify(res).includes('personal-visa'), 'findings carry kinds, never values');
});

test('linkage: the owner can accept the link (declared) or acknowledge it for a limited time', () => {
  const { m, ctx, founder, alias } = setup();
  m.owner.addAccount(ctx, founder.id, acct({ payerLabel: 'personal-visa' }));

  const declared = m.owner.addAccount(ctx, alias.id, acct({ payerLabel: 'personal-visa', declaredLink: true }));
  assert.equal(declared.outcome, 'results', 'accept and mark as declared');
  const key = [alias.id, founder.id].sort().join('|');
  const decl = m.store.get('linkageDeclarations', key);
  assert.ok(decl, 'declaration recorded');
  assert.equal(decl.kind, 'declared');

  // a second shared payer on the same pair is silent now
  const again = m.owner.addAccount(ctx, alias.id, acct({ provider: 'beta-ai', label: 't-2', payerLabel: 'personal-visa' }));
  assert.equal(again.outcome, 'results', 'declared pairs stop warning');
});

test('linkage: an acknowledgement is time-boxed; when it expires the risk comes back', () => {
  // mutable clock: an ack is quiet until it expires, then findings return
  let clock = Date.now();
  const m = new Moira({ store: new MemoryStore(), now: () => clock });
  const ctx = m.createOwnerContext(ownerSession());
  const founder = m.owner.createPersona(ctx, { name: 'founder', identity: 'linked' });
  const hetero = m.owner.createPersona(ctx, {
    name: 'captain quill', identity: 'heteronymous',
    characterSheet: { name: 'captain quill', backstory: 'a fictional sailor', voice: 'formal', beliefs: ['the sea provides'], expertise: ['navigation'], redLines: [], canonRules: [] }
  });

  m.owner.addAccount(ctx, founder.id, acct({ payerLabel: 'team-card' }));
  const ack = m.owner.addAccount(ctx, hetero.id, acct({ payerLabel: 'team-card', acknowledgeLinkUntil: clock + 3600_000 }));
  assert.equal(ack.outcome, 'results', 'acknowledge the risk for a limited time');
  const ackDecl = m.store.get('linkageDeclarations', [hetero.id, founder.id].sort().join('|'));
  assert.equal(ackDecl.kind, 'acknowledged');
  assert.equal(ackDecl.expiresAt, clock + 3600_000);

  // while the ack is live: a second account on the same payer is silent
  const quiet = m.owner.addAccount(ctx, hetero.id, acct({ provider: 'beta-ai', label: 't-2', payerLabel: 'team-card' }));
  assert.equal(quiet.outcome, 'results', 'active acknowledgement silences');

  // time passes; the ack expires and the warning fires again
  clock += 2 * 3600_000;
  const expired = m.owner.addAccount(ctx, hetero.id, acct({ provider: 'delta-ai', label: 't-4', payerLabel: 'team-card' }));
  assert.equal(expired.outcome, 'approval_required', 'an expired acknowledgement no longer silences the risk');
  assert.equal(expired.reason, 'linkage_finding');
});

test('linkage: linked<->linked sharing is intended, never flagged', () => {
  const { m, ctx, founder, student } = setup();
  m.owner.addAccount(ctx, founder.id, acct({ payerLabel: 'shared-office-card' }));
  const res = m.owner.addAccount(ctx, student.id, acct({ payerLabel: 'shared-office-card' }));
  assert.equal(res.outcome, 'results', 'linked personas are one person on purpose: no finding');
});

// --- monitor respects acknowledgement expiry (22.4) ------------------------------

test('linkage: monitorScan skips declared pairs but not expired acknowledgements', () => {
  const { m, ctx, founder, alias } = setup();
  m.owner.addAccount(ctx, founder.id, acct({ payerLabel: 'personal-visa' }));
  m.owner.addAccount(ctx, alias.id, acct({ payerLabel: 'personal-visa', declaredLink: true }));

  const hash = 'h-' + Math.random().toString(36).slice(2);
  const scanDeclared = m.owner.monitorScan(ctx, {
    linkageHashes: [
      { personaId: founder.id, kind: 'payer', hash, specificity: 'unique' },
      { personaId: alias.id, kind: 'payer', hash, specificity: 'unique' }
    ]
  });
  assert.equal(scanDeclared.findings.length, 0, 'declared pair is not a finding');

  // an acknowledgement that has expired does not silence the scan
  const hetero = m.owner.createPersona(ctx, {
    name: 'captain quill', identity: 'heteronymous',
    characterSheet: { name: 'captain quill', backstory: 'a fictional sailor', voice: 'formal', beliefs: ['the sea provides'], expertise: ['navigation'], redLines: [], canonRules: [] }
  });
  m.owner.declareLinkageIntention(ctx, { personaIds: [founder.id, hetero.id], until: Date.now() - 1000 });
  const scanExpired = m.owner.monitorScan(ctx, {
    linkageHashes: [
      { personaId: founder.id, kind: 'payer', hash, specificity: 'unique' },
      { personaId: hetero.id, kind: 'payer', hash, specificity: 'unique' }
    ]
  });
  assert.equal(scanExpired.findings.length, 1, 'expired acknowledgement still findings');
});

// --- linkage-aware routing (22.4): prefer accounts that do not link ----------------

test('linkage: routing prefers accounts that do not create a new link, and flags them owner-only', () => {
  // mutable clock: the shared payer enters behind a time-boxed ack, which
  // then expires, so the link is real but undeclared at routing time
  let clock = Date.now();
  const m = new Moira({ store: new MemoryStore(), now: () => clock });
  const ctx = m.createOwnerContext(ownerSession());
  const founder = m.owner.createPersona(ctx, { name: 'founder', identity: 'linked' });
  const alias = m.owner.createPersona(ctx, { name: 'alias', identity: 'pseudonymous' });
  const agentId = m.owner.registerAgent(ctx, { name: 'helper', tier: 'verified', personasAllowed: [alias.id], spendCaps: { usd: 10 } }).id;

  m.owner.addAccount(ctx, founder.id, acct({ payerLabel: 'shared-visa' }));
  m.owner.addAccount(ctx, alias.id, acct({ payerLabel: 'shared-visa', acknowledgeLinkUntil: clock + 3600_000 }));
  m.owner.addAccount(ctx, alias.id, acct({ provider: 'beta-ai', label: 'alias-only', payerLabel: 'alias-only-card' }));
  clock += 2 * 3600_000; // the ack expires: the link is live and undeclared
  const sess = m.owner.createSession(ctx, { clientId: agentId, personaId: alias.id });

  const route = m.router.route({ personaId: alias.id, agentId, task: { models: ['acme-4'] }, constraints: { estimatedCost: 1 }, linkage: true });
  assert.equal(route.outcome, 'results');
  assert.equal(route.linkageFlagged.length, 1, 'the linking account is flagged');
  assert.notEqual(route.linkageFlagged[0], route.ranked[0].accountId, 'flagged account is not the one routed');
  const clean = m.ledger.list(alias.id).find((a) => a.provider === 'beta-ai');
  assert.equal(route.ranked[0].accountId, clean.id, 'non-linking account is preferred');

  // once declared, the preference lifts
  m.owner.declareLinkageIntention(ctx, { personaIds: [alias.id, founder.id] });
  const route2 = m.router.route({ personaId: alias.id, agentId, task: { models: ['acme-4'] }, constraints: { estimatedCost: 1 }, linkage: true });
  assert.equal(route2.linkageFlagged.length, 0, 'declared link: no flag');

  // agent surface never sees linkage data
  const agentRoute = m.agent.budget_route(sess.accessToken, { task: { models: ['acme-4'] }, constraints: { estimatedCost: 1 } });
  assert.equal(agentRoute.outcome, 'results');
  assert.equal(agentRoute.linkageFlagged, undefined, 'findings never reach agents');
});
