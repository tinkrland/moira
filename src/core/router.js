// the router and leases (spec sections 8.3, 8.4, 8.5, 9.4).
//
// budget_route(task, persona, constraints) returns a ranked list of eligible
// accounts and a lease for the top choice. eligibility filters, in order:
//   1. persona fit (hard: decoupled personas never share keys)
//   2. capability fit
//   3. data-policy fit (sensitive personas refuse retaining/training tiers)
//   4. headroom within the lowest binding cap (persona, agent, handoff, task)
//
// ranking: urgency (use-it-or-lose-it) then free-before-paid,
// non-renewing-before-renewing, cheapest-adequate.
//
// leases are capped handles: bound to (agent, persona, account, max_spend,
// ttl, allowed_models). agents never see raw secrets. a lease dies with its
// pack or handoff and can be revoked instantly. a global kill switch freezes
// all leases for a persona.
//
// router choices never write preferences (8.9): the receipt carries
// reason availability, and no preference fact is created or strengthened.

import { randomId } from '../util/crypto.js';
import { OUTCOME, AGENT_TIER, LEASE_STATUS, PERSONA_STATUS } from '../model/constants.js';
import { eligibility, rankAccounts, bindingCap, capDecision } from './policy.js';

export class RouterService {
  constructor({ store, ledger, agents, personas, receipts, linkage = null, now = Date.now }) {
    this.store = store;
    this.ledger = ledger;
    this.agents = agents;
    this.personas = personas;
    this.receipts = receipts;
    this.linkage = linkage;
    this.now = now;
    this.burnRateFraction = 0.5; // replaced by burn-rate learning in v2
  }

  route({ personaId, agentId = null, task, constraints = {}, linkage = false }) {
    const persona = this.personas.get(personaId);
    if (!persona) return { outcome: OUTCOME.UNAVAILABLE, reason: 'persona_not_found' };
    if (persona.locked) return { outcome: OUTCOME.LOCKED, reason: 'persona_kill_switch' };
    if (persona.status === PERSONA_STATUS.FROZEN) return { outcome: OUTCOME.LOCKED, reason: 'persona_frozen' };

    const agent = agentId ? this.agents.get(agentId) : null;
    const estimate = constraints.estimatedCost ?? 0;
    const caps = bindingCap(
      constraints.personaCap ?? null,
      agent?.spendCaps?.usd ?? null,
      constraints.handoffCap ?? null,
      constraints.taskCap ?? null
    );
    const capRes = capDecision({ cap: caps, estimate, softCap: constraints.softCap ?? null });
    if (!capRes.ok) {
      return { outcome: capRes.outcome, reason: capRes.reason, cap: caps, estimate };
    }

    const ineligible = [];
    const eligible = [];
    const unit = constraints.unit ?? 'usd'; // caps and estimates are unit-bound
    for (const account of this.ledger.list(personaId)) {
      const res = eligibility({
        account: { ...account, headroom: this.ledger.headroom(account, unit) },
        persona,
        task,
        caps,
        estimatedCost: estimate,
        now: this.now(),
        unit
      });
      if (res.eligible) eligible.push(account);
      else ineligible.push({ accountId: account.id, reason: res.reason });
    }

    if (eligible.length === 0) {
      // unknown budget state is never reported as "no limits" (section 11):
      // if the only blocker is unknown limits, ask for approval, do not
      // silently treat the account as unlimited.
      if (ineligible.some((i) => i.reason === 'unknown_budget')) {
        return { outcome: OUTCOME.APPROVAL_REQUIRED, reason: 'unknown_budget', ineligible };
      }
      return { outcome: OUTCOME.EMPTY, reason: 'no_eligible_accounts', ineligible };
    }

    const rankedAll = rankAccounts({
      accounts: eligible.map((a) => ({ ...a, remainingValue: this.ledger.remainingValueOf(a) })),
      now: this.now(),
      burnRateFraction: this.burnRateFraction
    });

    // linkage-aware routing (22.4): accounts whose payer links this decoupled
    // persona to another one are demoted below clean accounts. preference is
    // server-side for everyone; the DETAIL (which accounts and why) is
    // owner-view only and never returned on the agent surface.
    let linkageFlagged = [];
    let ranked = rankedAll;
    if (this.linkage) {
      const flagged = this.linkage.flaggedAccounts(personaId);
      if (flagged.size > 0) {
        linkageFlagged = [...flagged.keys()];
        ranked = [
          ...rankedAll.filter((r) => !flagged.has(r.account.id)),
          ...rankedAll.filter((r) => flagged.has(r.account.id))
        ];
      }
    }

    const lease = agentId
      ? this._mint({ agentId, personaId, accountId: ranked[0].account.id, maxSpend: caps ?? estimate, unit: 'usd', ttlMs: constraints.leaseTtlMs ?? 60 * 60 * 1000, models: task.models ?? [] })
      : null;

    this.receipts.write({
      actor: agentId ?? 'owner', personaId, op: 'spend', amount: 0,
      reason: `routed:${ranked[0].account.provider}:availability`
    });

    const result = {
      outcome: OUTCOME.RESULTS,
      ranked: ranked.map((r) => ({ accountId: r.account.id, provider: r.account.provider, kind: r.account.kind, urgency: r.urgency })),
      ineligible,
      lease
    };
    if (linkage) result.linkageFlagged = linkageFlagged; // owner view only (22.3)
    return result;
  }

  // lease_request(account, max_spend, ttl, models) (8.7). tier gates who may hold.
  requestLease({ agentId, personaId, accountId, maxSpend, ttlMs = 60 * 60 * 1000, models = [] }) {
    const agent = this.agents.get(agentId);
    if (!agent || agent.revoked) return { outcome: OUTCOME.DECLINED, reason: 'unknown_or_revoked_agent' };
    // requesting agent's tier allowed to hold leases (9.4)
    if (!this.agents.mayHoldLeases(agent)) {
      return { outcome: OUTCOME.DECLINED, reason: 'tier_cannot_hold_leases' };
    }
    const persona = this.personas.get(personaId);
    if (!persona) return { outcome: OUTCOME.UNAVAILABLE, reason: 'persona_not_found' };
    if (persona.locked) return { outcome: OUTCOME.LOCKED, reason: 'persona_kill_switch' };

    const account = this.ledger.get(accountId);
    if (!account || account.personaId !== personaId) {
      return { outcome: OUTCOME.DECLINED, reason: 'account_persona_fit' }; // hard filter 1
    }
    const caps = bindingCap(null, agent.spendCaps?.usd ?? null, null, maxSpend);
    if (caps !== null && maxSpend > caps) {
      return { outcome: OUTCOME.DECLINED, reason: 'cap' };
    }
    const lease = this._mint({ agentId, personaId, accountId, maxSpend, unit: 'usd', ttlMs, models });
    this.receipts.write({ actor: agentId, personaId, op: 'lease', amount: maxSpend, reason: `lease:${account.provider}` });
    return { outcome: OUTCOME.RESULTS, lease };
  }

  _mint({ agentId, personaId, accountId, maxSpend, unit, ttlMs, models, handoffId = null, packId = null }) {
    const lease = {
      id: randomId('lease'),
      agentId,
      personaId,
      accountId,
      maxSpend,
      spent: 0,
      unit,
      ttlMs,
      expiresAt: this.now() + ttlMs,
      allowedModels: models,
      handoffId,
      packId,
      status: LEASE_STATUS.ACTIVE
    };
    this.store.put('leases', lease.id, lease);
    return lease;
  }

  // used by handoff_accept: the receiver's budget lease is minted against the
  // handoff, capped by the declared budget. it is bound to the handoff, not an
  // account, and dies with the handoff.
  mintReceiverLease({ agentId, personaId, maxSpend, unit, ttlMs, models, handoffId }) {
    const agent = this.agents.get(agentId);
    if (!agent || !this.agents.mayHoldLeases(agent)) {
      return { outcome: OUTCOME.DECLINED, reason: 'tier_cannot_hold_leases' };
    }
    const persona = this.personas.get(personaId);
    if (!persona) return { outcome: OUTCOME.UNAVAILABLE, reason: 'persona_not_found' };
    if (persona.locked) return { outcome: OUTCOME.LOCKED, reason: 'persona_kill_switch' };
    const caps = bindingCap(null, agent.spendCaps?.usd ?? null, null, maxSpend);
    if (caps !== null && maxSpend > caps) return { outcome: OUTCOME.DECLINED, reason: 'cap' };
    const lease = this._mint({ agentId, personaId, accountId: null, maxSpend, unit, ttlMs, models, handoffId });
    this.receipts.write({ actor: agentId, personaId, op: 'lease', amount: maxSpend, reason: 'handoff_budget_lease' });
    return { outcome: OUTCOME.RESULTS, lease };
  }

  // the broker makes the provider call and meters it (8.4). agents get the
  // response; only the ledger sees the usage event.
  spend(leaseId, { amount, models = [] }) {
    const lease = this.store.get('leases', leaseId);
    if (!lease) return { outcome: OUTCOME.UNAVAILABLE, reason: 'lease_not_found' };
    if (lease.status !== LEASE_STATUS.ACTIVE) return { outcome: OUTCOME.DECLINED, reason: `lease_${lease.status}` };
    if (lease.expiresAt < this.now()) {
      this.store.update('leases', leaseId, (l) => ({ ...l, status: LEASE_STATUS.EXPIRED }));
      return { outcome: OUTCOME.EXPIRED, reason: 'lease_ttl' };
    }
    if ((lease.allowedModels ?? []).length > 0 && models.length > 0 && !models.some((m) => lease.allowedModels.includes(m))) {
      return { outcome: OUTCOME.DECLINED, reason: 'model_not_in_lease' };
    }
    if (lease.spent + amount > lease.maxSpend) {
      this.store.update('leases', leaseId, (l) => ({ ...l, status: LEASE_STATUS.SPENT }));
      return { outcome: OUTCOME.DECLINED, reason: 'lease_max_spend' };
    }
    this.store.update('leases', leaseId, (l) => ({ ...l, spent: l.spent + amount }));
    if (lease.accountId) {
      this.ledger.recordUsage(lease.accountId, { unit: lease.unit, amount, leaseId });
    }
    this.receipts.write({ actor: lease.agentId, personaId: lease.personaId, op: 'spend', amount, unit: lease.unit, reason: 'lease_spend' });
    return { outcome: OUTCOME.RESULTS, spent: lease.spent + amount, maxSpend: lease.maxSpend };
  }

  revokeLease(leaseId) {
    const lease = this.store.update('leases', leaseId, (l) => ({ ...l, status: LEASE_STATUS.REVOKED }));
    if (lease) {
      this.receipts.write({ actor: 'owner', personaId: lease.personaId, op: 'lease', amount: null, reason: 'lease_revoked' });
    }
    return lease;
  }

  // kill switch (8.5): freezes all leases for a persona.
  killSwitch(personaId) {
    const frozen = this.store.list('leases', (l) => l.personaId === personaId && l.status === LEASE_STATUS.ACTIVE, { personaId, status: LEASE_STATUS.ACTIVE });
    for (const l of frozen) this.revokeLease(l.id);
    this.personas.setKillSwitch(personaId, true);
    return frozen.length;
  }

  leasesFor(personaId) {
    return this.store.list('leases', (l) => l.personaId === personaId, { personaId });
  }
}
