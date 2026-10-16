// handoffs (spec section 7.3).
//
// a handoff passes a task from agent a to agent b:
//   1. a calls handoff_create(task, pack_ref, budget, return_contract, ttl)
//   2. policy: a may pass the pack, b may receive it, persona egress/ingress ok
//   3. owner approval required unless a standing rule covers it
//   4. b calls handoff_accept, receives pack + budget lease only
//   5. b returns a typed result: answer, proposed writes, spend report.
//      writes are proposals like any other; nothing becomes cross-agent
//      memory without owner approval.
//   6. receipts every step, never content.
//
// overrun handling (8.5): estimates are declared up front and reconciled at
// return; overruns write a receipt and lower the agent's future auto-approval.

import { randomId } from '../util/crypto.js';
import { OUTCOME, HANDOFF_STATUS, PERSONA_STATUS } from '../model/constants.js';

export class HandoffService {
  constructor({ store, personas, agents, packs, receipts, router, facts, now = Date.now }) {
    this.store = store;
    this.personas = personas;
    this.agents = agents;
    this.packs = packs;
    this.receipts = receipts;
    this.router = router; // lease minting for the receiver budget
    this.facts = facts;
    this.now = now;
  }

  // from agent a's session. pack must be redeemable by a (a holds it).
  create({ fromAgentId, toAgentId, packId, task, budget = null, returnContract = null, ttlMs = 60 * 60 * 1000 }) {
    const fromAgent = this.agents.get(fromAgentId);
    const toAgent = this.agents.get(toAgentId);
    if (!fromAgent || fromAgent.revoked) return { outcome: OUTCOME.DECLINED, reason: 'from_agent_revoked' };
    if (!toAgent || toAgent.revoked) return { outcome: OUTCOME.DECLINED, reason: 'to_agent_revoked' };

    const pack = this.store.get('packs', packId);
    if (!pack) return { outcome: OUTCOME.UNAVAILABLE, reason: 'pack_not_found' };
    if (pack.recipientAgentId !== fromAgentId) {
      return { outcome: OUTCOME.DECLINED, reason: 'sender_does_not_hold_pack' };
    }
    if (pack.status !== 'active') return { outcome: OUTCOME.DECLINED, reason: `pack_${pack.status}` };
    if (pack.createdAt + pack.ttlMs < this.now()) {
      return { outcome: OUTCOME.EXPIRED, reason: 'pack_ttl' };
    }

    const persona = this.personas.get(pack.personaId);
    if (!persona) return { outcome: OUTCOME.UNAVAILABLE, reason: 'persona_not_found' };
    if (persona.status === PERSONA_STATUS.FROZEN) return { outcome: OUTCOME.DECLINED, reason: 'persona_frozen' };
    if (toAgent.personasAllowed.length > 0 && !toAgent.personasAllowed.includes(pack.personaId)) {
      return { outcome: OUTCOME.DECLINED, reason: 'receiver_persona_not_allowed' };
    }

    // owner approval unless a standing rule covers (agent pair, persona,
    // budget ceiling) (7.3 step 3).
    const rule = this.agents.standingRuleFor(fromAgent, 'handoff', {
      toAgentId, personaId: pack.personaId
    });
    const ceilingOk = !budget || !rule || rule.maxUsd === undefined || (budget.cap ?? 0) <= rule.maxUsd;
    const needsOwner = !rule || !ceilingOk;

    const handoff = {
      id: randomId('hoff'),
      fromAgentId,
      toAgentId,
      packId,
      personaId: pack.personaId,
      task,
      budget: budget ? { ...budget } : null,
      estimatedCost: budget?.cap ?? 0,
      returnContract,
      ttlMs,
      createdAt: this.now(),
      status: needsOwner ? HANDOFF_STATUS.PENDING : HANDOFF_STATUS.PENDING,
      approved: !needsOwner,
      approvalRuleId: rule?.id ?? null
    };
    this.store.put('handoffs', handoff.id, handoff);

    this.receipts.write({
      actor: fromAgentId, personaId: pack.personaId, op: 'handoff',
      handoffId: handoff.id, packId: pack.id, amount: budget?.cap ?? null, unit: budget?.unit ?? null,
      reason: needsOwner ? 'created_pending_owner_approval' : 'created_under_standing_rule'
    });

    if (needsOwner) {
      return { outcome: OUTCOME.APPROVAL_REQUIRED, reason: 'handoff_needs_owner_approval', handoff };
    }
    return { outcome: OUTCOME.RESULTS, handoff };
  }

  // applies an approval. authority lives in the owner facade: only
  // ownerapi.approveHandoff may call this (agents cannot approve handoffs).
  approve(handoffId) {
    return this.store.update('handoffs', handoffId, (h) => ({ ...h, approved: true }));
  }

  accept(handoffId, { agentId }) {
    const h = this.store.get('handoffs', handoffId);
    if (!h) return { outcome: OUTCOME.UNAVAILABLE, reason: 'handoff_not_found' };
    if (h.status !== HANDOFF_STATUS.PENDING) return { outcome: OUTCOME.DECLINED, reason: `handoff_${h.status}` };
    if (h.toAgentId !== agentId) return { outcome: OUTCOME.DECLINED, reason: 'not_handoff_recipient' };
    if (!h.approved) return { outcome: OUTCOME.APPROVAL_REQUIRED, reason: 'awaiting_owner_approval' };
    if (h.createdAt + h.ttlMs < this.now()) {
      this.store.update('handoffs', handoffId, (x) => ({ ...x, status: HANDOFF_STATUS.EXPIRED }));
      return { outcome: OUTCOME.EXPIRED, reason: 'handoff_ttl' };
    }

    // receiver gets the pack plus a budget lease only: the pack is delivered
    // under the handoff's authority, not rebound to the receiver.
    const redeemed = this.packs.redeemForHandoff(h.packId, {
      handoffId: h.id, receiverAgentId: agentId, holderAgentId: h.fromAgentId
    });
    if (redeemed.outcome !== OUTCOME.RESULTS) return redeemed;

    let lease = null;
    if (h.budget && h.budget.cap > 0) {
      const minted = this.router.mintReceiverLease({
        agentId, personaId: h.personaId, maxSpend: h.budget.cap, unit: h.budget.unit ?? 'usd',
        ttlMs: h.ttlMs, models: h.budget.models ?? [], handoffId: h.id
      });
      if (minted.outcome !== OUTCOME.RESULTS) return minted;
      lease = minted.lease;
    }

    this.store.update('handoffs', handoffId, (x) => ({ ...x, status: HANDOFF_STATUS.ACCEPTED }));
    this.receipts.write({ actor: agentId, personaId: h.personaId, op: 'handoff', handoffId: h.id, reason: 'accepted' });
    return { outcome: OUTCOME.RESULTS, pack: redeemed.pack, lease };
  }

  // typed return: answer + proposed writes + spend report (7.3 step 5).
  return(handoffId, { agentId, answer, proposedWrites = [], spend = 0 }) {
    const h = this.store.get('handoffs', handoffId);
    if (!h) return { outcome: OUTCOME.UNAVAILABLE, reason: 'handoff_not_found' };
    if (h.toAgentId !== agentId) return { outcome: OUTCOME.DECLINED, reason: 'not_handoff_recipient' };
    if (h.status !== HANDOFF_STATUS.ACCEPTED) return { outcome: OUTCOME.DECLINED, reason: `handoff_${h.status}` };

    const persona = this.personas.get(h.personaId);
    const proposals = [];
    for (const w of proposedWrites) {
      // nothing b learns becomes cross-agent memory without owner approval:
      // every write is a proposal in the persona inbox.
      const res = this.facts.propose(persona, {
        content: w.content, category: w.category,
        derivedFrom: w.derivedFrom ?? [], basis: w.basis ?? null,
        preferenceBasis: w.preferenceBasis ?? null, evidence: w.evidence ?? [],
        rungs: w.rungs ?? {}
      }, { actor: 'agent', clientId: agentId });
      if (res.outcome === OUTCOME.RESULTS) proposals.push(res.fact.id);
    }

    // reconcile estimate vs actual; overruns lower auto-approval (8.5).
    const overrun = Math.max(0, spend - (h.estimatedCost || 0));
    if (overrun > 0) {
      this.agents.update(agentId, (a) => ({
        ...a,
        autoApprovalLevel: Math.max(0, (a.autoApprovalLevel ?? 1) - 0.25)
      }));
    }

    this.store.update('handoffs', handoffId, (x) => ({ ...x, status: HANDOFF_STATUS.RETURNED }));
    this.receipts.write({
      actor: agentId, personaId: h.personaId, op: 'handoff', handoffId: h.id,
      amount: spend, unit: h.budget?.unit ?? 'usd', reason: overrun > 0 ? 'returned_with_overrun' : 'returned'
    });
    return { outcome: OUTCOME.RESULTS, answer, proposals, spend, overrun };
  }

  cancel(handoffId, { agentId = null, ownerCancel = false } = {}) {
    // ownerCancel is an internal path used by ownerapi.deletePersona;
    // agent-facing cancellation always goes through the agent facade with
    // agentId, which must be the sender.
    const h = this.store.get('handoffs', handoffId);
    if (!h) return { outcome: OUTCOME.UNAVAILABLE, reason: 'handoff_not_found' };
    if (!ownerCancel && agentId !== h.fromAgentId) return { outcome: OUTCOME.DECLINED, reason: 'only_sender_or_owner' };
    this.store.update('handoffs', handoffId, (x) => ({ ...x, status: HANDOFF_STATUS.CANCELLED }));
    this.receipts.write({ actor: ownerCancel ? 'owner' : agentId, personaId: h.personaId, op: 'handoff', handoffId: h.id, reason: 'cancelled' });
    return { outcome: OUTCOME.RESULTS };
  }

  openFor(personaId, agentId) {
    return this.store.list('handoffs', (h) =>
      h.personaId === personaId && h.status === HANDOFF_STATUS.PENDING &&
      (h.fromAgentId === agentId || h.toAgentId === agentId), { personaId, status: HANDOFF_STATUS.PENDING });
  }
}
