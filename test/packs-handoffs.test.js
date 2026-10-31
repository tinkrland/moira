// packs, handoffs, receipts, deletion, monitor hook (sections 7, 16, 22)
import test from 'node:test';
import assert from 'node:assert/strict';
import { Moira } from '../src/index.js';

// verified owner session + context mint: in phase 0 the host application
// performs owner verification itself; phase 2 replaces this with supabase
// auth or passkeys (owner's choice pending).
const ownerSession = () => ({ kind: 'owner_session', verified: true, ownerRef: 'owner' });
const ownerCtx = (m) => m.createOwnerContext(ownerSession());


const setup = () => {
  const m = new Moira({ netguard: { resolve: async () => ['93.184.216.34'] } });
  const ctx = ownerCtx(m);
  const p = m.owner.createPersona(ctx, { name: 'founder', identity: 'linked' });
  const sender = m.owner.registerAgent(ctx, { name: 'scout', tier: 'verified', personasAllowed: [p.id], spendCaps: { usd: 50 } });
  const receiver = m.owner.registerAgent(ctx, { name: 'writer', tier: 'verified', personasAllowed: [p.id], spendCaps: { usd: 50 } });
  const fact = m.facts.add(p, {
    content: 'demo day is nov 20', category: 'schedule',
    rungs: { summary: 'busy around nov 20' }
  }).fact;
  return { ctx, m, p, sender, receiver, fact };
};

const makePack = (m, p, receiver, fact) => m.packs.create({
  personaId: p.id, recipientAgentId: receiver.id, brief: 'draft the investor update',
  factSelections: [{ factId: fact.id, rung: 'summary' }], ttlMs: 60 * 60 * 1000
});

test('packs are signed, bound to one recipient, and redeemable (7.2)', () => {
  const { ctx, m, p, sender, receiver, fact } = setup();
  const created = makePack(m, p, receiver, fact);
  assert.equal(created.outcome, 'results');
  const ok = m.packs.redeem(created.pack.id, { agentId: receiver.id });
  assert.equal(ok.outcome, 'results');
  assert.equal(ok.pack.items[0].content, 'busy around nov 20');
  assert.equal(ok.pack.items[0].trust, 'quoted-data');
  const wrongAgent = m.packs.redeem(created.pack.id, { agentId: sender.id });
  assert.equal(wrongAgent.outcome, 'declined');
  assert.equal(wrongAgent.reason, 'not_pack_recipient');
});

test('pack cannot serve above a fact max rung (7.2)', () => {
  const { ctx, m, p, receiver } = setup();
  const sensitive = m.facts.add(p, { content: 'health detail', category: 'health', policy: { maxRung: 1 } }).fact;
  const blocked = m.packs.create({
    personaId: p.id, recipientAgentId: receiver.id, brief: 'x',
    factSelections: [{ factId: sensitive.id, rung: 'full' }]
  });
  assert.equal(blocked.outcome, 'declined');
  assert.equal(blocked.reason, 'rung_above_fact_max');
});

test('pack revocation kills pack and lease on next request (7.2)', () => {
  const { ctx, m, p, receiver, fact } = setup();
  const created = makePack(m, p, receiver, fact);
  const account = m.owner.addAccount(ctx, p.id, { provider: 'x-ai', kind: 'credits', limits: [], expiresAt: null, capabilities: { models: [], tools: [], regions: [] } }).account;
  const lease = m.router.requestLease({ agentId: receiver.id, personaId: p.id, accountId: account.id, maxSpend: 5 });
  m.packs.attachLease(created.pack.id, lease.lease.id);
  m.packs.revoke(created.pack.id);
  const redeem = m.packs.redeem(created.pack.id, { agentId: receiver.id });
  assert.equal(redeem.outcome, 'declined');
  assert.match(redeem.reason, /revoked/);
});

test('handoff flow: create -> owner approval -> accept -> return (7.3)', () => {
  const { ctx, m, p, sender, receiver, fact } = setup();
  const pack = makePack(m, p, sender, fact); // sender holds the pack
  const created = m.handoffs.create({
    fromAgentId: sender.id, toAgentId: receiver.id, packId: pack.pack.id,
    task: 'draft update', budget: { cap: 5, unit: 'usd' }, returnContract: { type: 'answer' }
  });
  assert.equal(created.outcome, 'approval_required'); // owner approval needed

  const acceptedTooEarly = m.handoffs.accept(created.handoff.id, { agentId: receiver.id });
  assert.equal(acceptedTooEarly.outcome, 'approval_required');

  m.owner.approveHandoff(ctx, created.handoff.id);
  const accepted = m.handoffs.accept(created.handoff.id, { agentId: receiver.id });
  assert.equal(accepted.outcome, 'results');
  assert.equal(accepted.pack.brief, 'draft the investor update');
  assert.ok(accepted.lease); // receiver gets a budget lease

  const returned = m.handoffs.return(created.handoff.id, {
    agentId: receiver.id,
    answer: 'draft done',
    proposedWrites: [{ content: 'investors prefer traction slides', category: 'notes', derivedFrom: [fact.id] }],
    spend: 3
  });
  assert.equal(returned.outcome, 'results');
  assert.equal(returned.proposals.length, 1);
  assert.equal(returned.overrun, 0);
  // proposed writes are inbox proposals, not facts: nothing becomes
  // cross-agent memory without owner approval (7.3 step 5).
  const inbox = m.facts.inbox(p.id);
  assert.equal(inbox.length, 1);
  assert.deepEqual(inbox[0].representation.derivedFrom, [fact.id]);
});

test('standing rule covers handoff without owner approval (7.3 step 3)', () => {
  const { ctx, m, p, sender, receiver, fact } = setup();
  m.agents.update(sender.id, {
    standingRules: [{ id: 'sr1', kind: 'handoff', toAgentId: receiver.id, personaId: p.id, maxUsd: 10 }]
  });
  const pack = makePack(m, p, sender, fact);
  const created = m.handoffs.create({
    fromAgentId: sender.id, toAgentId: receiver.id, packId: pack.pack.id,
    task: 'x', budget: { cap: 5, unit: 'usd' }
  });
  assert.equal(created.outcome, 'results');
  assert.equal(created.handoff.approved, true);

  // above the rule's ceiling -> owner approval again
  const pack2 = makePack(m, p, sender, fact);
  const created2 = m.handoffs.create({
    fromAgentId: sender.id, toAgentId: receiver.id, packId: pack2.pack.id,
    task: 'x', budget: { cap: 50, unit: 'usd' }
  });
  assert.equal(created2.outcome, 'approval_required');
});

test('budget overrun writes a receipt and lowers auto-approval (8.5)', () => {
  const { ctx, m, p, sender, receiver, fact } = setup();
  const pack = makePack(m, p, sender, fact);
  const created = m.handoffs.create({
    fromAgentId: sender.id, toAgentId: receiver.id, packId: pack.pack.id,
    task: 'x', budget: { cap: 2, unit: 'usd' }
  });
  m.owner.approveHandoff(ctx, created.handoff.id);
  m.handoffs.accept(created.handoff.id, { agentId: receiver.id });
  const returned = m.handoffs.return(created.handoff.id, { agentId: receiver.id, answer: 'y', spend: 9 });
  assert.ok(returned.overrun > 0);
  const receiverNow = m.agents.get(receiver.id);
  assert.ok(receiverNow.autoApprovalLevel < 1.0);
  const receipt = m.receipts.query({ personaId: p.id, op: 'handoff' }).find((r) => r.reason === 'returned_with_overrun');
  assert.ok(receipt);
});

test('receipts are signed, verify, and content-free (16)', () => {
  const { ctx, m, p, receiver, fact } = setup();
  makePack(m, p, receiver, fact);
  assert.ok(m.receipts.verifyAll());
  const receipts = m.receipts.query({ personaId: p.id });
  assert.ok(receipts.length > 0);
  const raw = JSON.stringify(receipts);
  assert.ok(!raw.includes('demo day'));
  assert.ok(!raw.includes('investor update'));
});

test('delete persona: key shredding, severed artifacts, receipt stubs (16)', () => {
  const { ctx, m, p, receiver, fact } = setup();
  makePack(m, p, receiver, fact);
  const student = m.owner.createPersona(ctx, { name: 'student', identity: 'linked' });
  m.owner.createBridge(ctx, { src: student.id, dst: p.id, purpose: 'research' });
  m.owner.addAccount(ctx, p.id, { provider: 'x', kind: 'credits', limits: [], expiresAt: null, capabilities: { models: [], tools: [], regions: [] }, secret: 'sk_x' });
  m.receipts.write({ actor: 'owner', personaId: p.id, op: 'read', categories: ['schedule'] });

  const res = m.owner.deletePersona(ctx, p.id);
  assert.equal(res.outcome, 'results');
  assert.ok(res.shredded);
  assert.equal(m.facts.active(p.id).length, 0);
  assert.equal(m.personas.get(p.id), null);
  assert.equal(m.bridges.list().filter((b) => b.src === p.id || b.dst === p.id).length, 0);
  // receipts stubbed: persona id removed, no categories (content-free stubs)
  const stubbed = m.store.list('receipts', (r) => r.op === 'read');
  assert.ok(stubbed.some((r) => r.personaId === null && r.categories.length === 0));
});

test('monitor hook: shared payer hash across decoupled personas is a hard finding; advisory only (22.4)', () => {
  const m = new Moira({ netguard: { resolve: async () => ['93.184.216.34'] } });
  const ctx = ownerCtx(m);
  const a = m.owner.createPersona(ctx, { name: 'main', identity: 'linked' });
  const b = m.owner.createPersona(ctx, { name: 'alias', identity: 'pseudonymous' });
  const c = m.owner.createPersona(ctx, { name: 'critic', identity: 'heteronymous', characterSheet: { name: 'C', backstory: '', voice: '', beliefs: [], expertise: [], redLines: [], canonRules: [] } });
  const hash = m.keys.payerHash('visa-4242');
  const res = m.owner.monitorScan(ctx, {
    linkageHashes: [
      { personaId: b.id, kind: 'payment_method', hash, specificity: 'unique' },
      { personaId: c.id, kind: 'payment_method', hash, specificity: 'unique' },
      { personaId: a.id, kind: 'payment_method', hash: m.keys.payerHash('visa-1111'), specificity: 'unique' }
    ]
  });
  assert.equal(res.findings.length, 1);
  assert.equal(res.findings[0].kind, 'hard');
  assert.deepEqual(res.findings[0].evidenceKinds, ['payment_method']);
  assert.equal(res.agentVisible, false);
  assert.equal(res.stored, false);
});

test('connect codes: mint -> redeem (unverified) -> owner approves -> session (11)', () => {
  const m = new Moira({ netguard: { resolve: async () => ['93.184.216.34'] } });
  const ctx = ownerCtx(m);
  const p = m.owner.createPersona(ctx, { name: 'student', identity: 'linked' });
  const minted = m.owner.mintConnectCode(ctx, { personaId: p.id });
  const redeemed = m.redeemConnectCode({ code: minted.code, agentName: 'my-cli-agent' });
  assert.equal(redeemed.outcome, 'approval_required');
  const session = m.owner.approveConnect(ctx, redeemed.pendingId);
  assert.equal(session.outcome, 'results');
  const status = m.agent.moira_status(session.accessToken);
  assert.equal(status.outcome, 'results');
  assert.equal(status.persona.name, 'student');
});

test('moira_status reports unknown budget as unknown, never "no limits" (11)', () => {
  const { ctx, m, p, sender } = setup();
  const session = m.owner.createSession(ctx, { clientId: sender.id, personaId: p.id });
  const status = m.agent.moira_status(session.accessToken);
  assert.equal(status.budget.known, false);
});

test('request_disclosure: exact https destination, owner approved, delivered once (11)', async () => {
  const { ctx, m, p, sender } = setup();
  // disclosure addresses authored fields (category.field), not free labels
  m.facts.add(p, { content: 'moira@dearagent.shop', category: 'contact', fields: ['email'] });
  const session = m.owner.createSession(ctx, { clientId: sender.id, personaId: p.id });
  const bad = m.agent.request_disclosure(session.accessToken, { fields: ['contact.email'], destination: 'http://evil.com', purpose: 'x' });
  assert.equal(bad.outcome, 'declined');
  const req = m.agent.request_disclosure(session.accessToken, { fields: ['contact.email'], destination: 'https://partner.example.com', purpose: 'signup' });
  assert.equal(req.outcome, 'approval_required');
  // no deliver function, no delivery: "delivered" is never claimed without it
  const noDelivery = await m.owner.approveDisclosure(ctx, { disclosureId: req.disclosureId });
  assert.equal(noDelivery.outcome, 'declined');
  assert.equal(noDelivery.reason, 'deliver_required');

  const sent = [];
  const approved = await m.owner.approveDisclosure(ctx, {
    disclosureId: req.disclosureId,
    deliver: async (destination, payload) => { sent.push({ destination, payload }); return { ok: true }; }
  });
  assert.equal(approved.outcome, 'results');
  assert.equal(approved.disclosure.status, 'delivered');
  assert.ok(approved.attestation, 'signed attestation');
  assert.equal(sent.length, 1, 'delivered exactly once');
  const second = await m.owner.approveDisclosure(ctx, { disclosureId: req.disclosureId, deliver: async () => ({ ok: true }) });
  assert.equal(second.outcome, 'declined'); // at most once
  assert.equal(second.reason, 'already_delivered')
});
