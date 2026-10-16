// agent tool surface (spec sections 6, 11, 7.4.1, 7.5, 8.7).
//
// the ONLY surface an mcp gateway ever exposes. every method takes an access
// token, resolves to exactly one persona (fixed at grant time), runs through
// the policy engine, and writes a receipt. there are no owner methods here:
// if a future tool needs owner authority it does not belong in this class.

import {
  OUTCOME, RUNG, PREFERENCE_CATEGORIES, VOICE_CATEGORY, WORKSPACE_CATEGORY, PASS_DURATION
} from '../model/constants.js';
import { nameToRank } from '../core/policy.js';
import { randomId } from '../util/crypto.js';

export class AgentApi {
  constructor(gateway) {
    this.gw = gateway;
  }

  _ctx(accessToken) {
    const res = this.gw.sessions.resolve(accessToken);
    if (res.outcome !== OUTCOME.RESULTS) return res;
    const persona = this.gw.personas.get(res.personaId);
    if (!persona) return { outcome: OUTCOME.UNAVAILABLE, reason: 'persona_not_found' };
    return { outcome: OUTCOME.RESULTS, clientId: res.clientId, persona, sessionId: res.sessionId };
  }

  // moira_status(): call first.
  moira_status(accessToken) {
    const ctx = this._ctx(accessToken);
    if (ctx.outcome !== OUTCOME.RESULTS) return ctx;
    const { persona, clientId } = ctx;
    const activePasses = this.gw.passes.listFor(clientId, persona.id);
    const inboxCount = this.gw.facts.inbox(persona.id).length;
    const budgetAccounts = this.gw.ledger.list(persona.id);
    const budgetKnown = budgetAccounts.length > 0;
    return {
      outcome: OUTCOME.RESULTS,
      persona: { name: persona.name, identity: persona.identity, storage: persona.storage, sub: this.gw.personas.sub(persona.id, clientId) },
      memoryState: {
        activeFacts: this.gw.facts.active(persona.id).length,
        inboxProposals: inboxCount,
        locked: persona.locked
      },
      passes: activePasses.map((p) => ({ category: p.category, purpose: p.purpose, maxRung: p.maxRung, expiresAt: p.expiresAt })),
      bridges: this.gw.bridges.list().filter((b) => b.src === persona.id || b.dst === persona.id).map((b) => ({ id: b.id, src: b.src, dst: b.dst })), // names only
      openHandoffs: this.gw.handoffs.openFor(persona.id, clientId).map((h) => ({ id: h.id, role: h.fromAgentId === clientId ? 'sender' : 'receiver' })),
      budget: {
        known: budgetKnown, // unknown budget state is never "no limits"
        accounts: budgetAccounts.length,
        nextExpiry: budgetAccounts.filter((a) => a.expiresAt).sort((a, b) => a.expiresAt - b.expiresAt)[0]?.expiresAt ?? null
      }
    };
  }

  // persona_context(query, categories, purpose)
  persona_context(accessToken, { categories = null, purpose, predicate = null }) {
    const ctx = this._ctx(accessToken);
    if (ctx.outcome !== OUTCOME.RESULTS) return ctx;
    const { persona, clientId } = ctx;

    // no pass for any requested category: approval links, not content, not an error.
    if (!categories || categories.length === 0) categories = [null];
    const results = { outcome: null, approvals: [], categories: {} };
    let anyServed = false;
    let anyApproval = false;
    for (const category of categories) {
      const pass = category === null ? null : this.gw.passes.verify({ clientId, personaId: persona.id, category, purpose });
      if (!pass) {
        anyApproval = true;
        results.approvals.push({ category, action: 'approval_required' });
        continue;
      }
      const served = this.gw.facts.serve(persona.id, { categories: [category], predicate, capRank: pass.maxRung, purpose });
      results.categories[category] = served;
      if (served.served.length > 0) anyServed = true;
      if (pass.duration === PASS_DURATION.ONE_TIME) this.gw.passes.consume(pass.id);
    }
    if (anyServed) {
      results.outcome = OUTCOME.RESULTS;
    } else if (anyApproval) {
      results.outcome = OUTCOME.APPROVAL_REQUIRED;
    } else {
      results.outcome = OUTCOME.EMPTY;
    }
    this.gw.receipts.write({
      actor: clientId, personaId: persona.id, op: 'read',
      categories: categories.filter(Boolean), factCount: anyServed ? undefined : 0,
      reason: results.outcome
    });
    return results;
  }

  // remember(content, category, derived_from[], basis, evidence[]): a proposal.
  remember(accessToken, { content, category, basis = null, derivedFrom = [], evidence = [], preferenceBasis = null, rungs = {}, policy = {}, inferred = false }) {
    const ctx = this._ctx(accessToken);
    if (ctx.outcome !== OUTCOME.RESULTS) return ctx;
    const { persona, clientId } = ctx;

    const res = this.gw.facts.propose(persona, {
      content, category, derivedFrom, basis, evidence, preferenceBasis, rungs, policy, inferred
    }, { actor: 'agent', clientId });

    if (res.outcome === OUTCOME.RESULTS) {
      this.gw.receipts.write({ actor: clientId, personaId: persona.id, op: 'propose', categories: [category], reason: res.fact.preferenceBasis ?? 'proposal' });
      return { outcome: OUTCOME.APPROVAL_REQUIRED, proposalId: res.fact.id, tainted: derivedFrom.length > 0 };
    }
    return res;
  }

  forget(accessToken, { factId }) {
    const ctx = this._ctx(accessToken);
    if (ctx.outcome !== OUTCOME.RESULTS) return ctx;
    const res = this.gw.facts.forget(ctx.persona, factId, { clientId: ctx.clientId });
    this.gw.receipts.write({ actor: ctx.clientId, personaId: ctx.persona.id, op: 'delete', reason: res.outcome });
    return res;
  }

  // bridge_request(from_persona, query, max_rung, purpose): mediated, transformed, receipted.
  bridge_request(accessToken, { srcPersonaId, query, purpose, maxRung = null }) {
    const ctx = this._ctx(accessToken);
    if (ctx.outcome !== OUTCOME.RESULTS) return ctx;
    return this.gw.bridges.request({
      requesterPersonaId: ctx.persona.id,
      requesterClientId: ctx.clientId,
      srcPersonaId,
      query,
      purpose,
      maxRung: maxRug(maxRung)
    });
  }

  // agent-side tools around bridges
  bridge_list(accessToken) {
    const ctx = this._ctx(accessToken);
    if (ctx.outcome !== OUTCOME.RESULTS) return ctx;
    return {
      outcome: OUTCOME.RESULTS,
      bridges: this.gw.bridges.list().filter((b) => b.dst === ctx.persona.id).map((b) => ({ id: b.id, src: b.src, purpose: b.purpose, maxRung: b.maxRung }))
    };
  }

  bridge_revoke(accessToken, { bridgeId }) {
    const ctx = this._ctx(accessToken);
    if (ctx.outcome !== OUTCOME.RESULTS) return ctx;
    const bridge = this.gw.bridges.revoke(bridgeId);
    return { outcome: bridge ? OUTCOME.RESULTS : OUTCOME.UNAVAILABLE };
  }

  // dst proposes to keep an imported bridge item: inbox proposal, no auto-merge.
  bridge_keep(accessToken, { item }) {
    const ctx = this._ctx(accessToken);
    if (ctx.outcome !== OUTCOME.RESULTS) return ctx;
    const res = this.gw.bridges.importPropose(ctx.persona, item, { clientId: ctx.clientId, srcPersonaId: item.srcPersonaId ?? null });
    if (res.outcome === OUTCOME.RESULTS) {
      this.gw.receipts.write({ actor: ctx.clientId, personaId: ctx.persona.id, op: 'propose', reason: 'bridge_import' });
      return { outcome: OUTCOME.APPROVAL_REQUIRED, proposalId: res.fact.id };
    }
    return res;
  }

  // shared agent workspace (7.4): append-only, attributed, untrusted by default.
  workspace_append(accessToken, { entry, taskId = null }) {
    const ctx = this._ctx(accessToken);
    if (ctx.outcome !== OUTCOME.RESULTS) return ctx;
    const pass = this.gw.passes.verify({ clientId: ctx.clientId, personaId: ctx.persona.id, category: WORKSPACE_CATEGORY, purpose: 'collaborate' });
    if (!pass) return { outcome: OUTCOME.APPROVAL_REQUIRED, reason: 'no_workspace_pass' };
    const record = {
      id: randomId('ws'),
      personaId: ctx.persona.id,
      clientId: ctx.clientId,
      taskId,
      entry,
      trust: 'untrusted',
      ts: this.gw.now()
    };
    this.gw.store.append('workspace', record);
    return { outcome: OUTCOME.RESULTS, entryId: record.id };
  }

  workspace_read(accessToken, { taskId = null, limit = 20 } = {}) {
    const ctx = this._ctx(accessToken);
    if (ctx.outcome !== OUTCOME.RESULTS) return ctx;
    const pass = this.gw.passes.verify({ clientId: ctx.clientId, personaId: ctx.persona.id, category: WORKSPACE_CATEGORY, purpose: 'collaborate' });
    if (!pass) return { outcome: OUTCOME.APPROVAL_REQUIRED, reason: 'no_workspace_pass' };
    const entries = this.gw.store
      .list('workspace', (w) => w.personaId === ctx.persona.id && (taskId === null || w.taskId === taskId), { personaId: ctx.persona.id })
      .sort((a, b) => b.ts - a.ts)
      .slice(0, limit);
    return { outcome: OUTCOME.RESULTS, entries, hot: { lastFacts: this.gw.facts.active(ctx.persona.id).slice(-5).map((f) => f.id), openHandoffs: this.gw.handoffs.openFor(ctx.persona.id, ctx.clientId).length } };
  }

  // --- budget tools (8.7) -----------------------------------------------------

  budget_status(accessToken) {
    const ctx = this._ctx(accessToken);
    if (ctx.outcome !== OUTCOME.RESULTS) return ctx;
    const accounts = this.gw.ledger.list(ctx.persona.id);
    if (accounts.length === 0) {
      return { outcome: OUTCOME.RESULTS, budget: { known: false, accounts: [] }, note: 'budget state unknown; never assume no limits' };
    }
    const ranked = this.gw.ledger.rankFor(ctx.persona.id);
    return {
      outcome: OUTCOME.RESULTS,
      budget: {
        known: true,
        accounts: accounts.map((a) => ({
          id: a.id, provider: a.provider, label: a.label, kind: a.kind,
          headroom: this.gw.ledger.headroomByUnit(a), expiresAt: a.expiresAt,
          convertsToPaidAt: a.convertsToPaidAt, cancelBy: a.cancelBy,
          confirmed: a.provenance.confirmed
        })),
        useFirst: this.gw.ledger.runway(ctx.persona.id, { ranked }).useFirst,
        alerts: this.gw.ledger.alerts(ctx.persona.id)
      }
    };
  }

  budget_route(accessToken, { task, constraints = {} }) {
    const ctx = this._ctx(accessToken);
    if (ctx.outcome !== OUTCOME.RESULTS) return ctx;
    return this.gw.router.route({ personaId: ctx.persona.id, agentId: ctx.clientId, task, constraints });
  }

  lease_request(accessToken, { accountId, maxSpend, ttlMs, models = [] }) {
    const ctx = this._ctx(accessToken);
    if (ctx.outcome !== OUTCOME.RESULTS) return ctx;
    return this.gw.router.requestLease({ agentId: ctx.clientId, personaId: ctx.persona.id, accountId, maxSpend, ttlMs, models });
  }

  lease_revoke(accessToken, { leaseId }) {
    const ctx = this._ctx(accessToken);
    if (ctx.outcome !== OUTCOME.RESULTS) return ctx;
    const lease = this.gw.store.get('leases', leaseId);
    if (!lease || lease.agentId !== ctx.clientId) return { outcome: OUTCOME.DECLINED, reason: 'not_lease_holder' };
    return { outcome: OUTCOME.RESULTS, lease: this.gw.router.revokeLease(leaseId) };
  }

  // agent proposes a new/corrected account (ledger_propose): owner confirms.
  ledger_propose(accessToken, { account }) {
    const ctx = this._ctx(accessToken);
    if (ctx.outcome !== OUTCOME.RESULTS) return ctx;
    const res = this.gw.ledger.add(ctx.persona.id, account, { confirmedByOwner: false });
    if (res.outcome === OUTCOME.RESULTS) {
      this.gw.receipts.write({ actor: ctx.clientId, personaId: ctx.persona.id, op: 'propose', reason: 'ledger_account_proposed' });
      return { outcome: OUTCOME.APPROVAL_REQUIRED, accountId: res.account.id };
    }
    return res;
  }

  // --- pack and handoff tools (7.4.1, 7.3) ---------------------------------------

  context_pack_create(accessToken, { recipientAgentId, brief, factSelections, ttlMs, reshare, voiceAttachment = null }) {
    const ctx = this._ctx(accessToken);
    if (ctx.outcome !== OUTCOME.RESULTS) return ctx;
    const { persona, clientId } = ctx;
    // issued by an agent only under a standing rule (7.2).
    const agent = this.gw.agents.get(clientId);
    const rule = this.gw.agents.standingRuleFor(agent, 'pack_create', { personaId: persona.id });
    if (!rule) {
      return { outcome: OUTCOME.APPROVAL_REQUIRED, reason: 'pack_create_needs_owner_or_standing_rule' };
    }
    return this.gw.packs.create({
      personaId: persona.id, recipientAgentId, brief, factSelections, ttlMs, reshare, voiceAttachment
    });
  }

  context_pack_redeem(accessToken, { packId }) {
    const ctx = this._ctx(accessToken);
    if (ctx.outcome !== OUTCOME.RESULTS) return ctx;
    return this.gw.packs.redeem(packId, { agentId: ctx.clientId });
  }

  handoff_create(accessToken, { toAgentId, packId, task, budget, returnContract, ttlMs }) {
    const ctx = this._ctx(accessToken);
    if (ctx.outcome !== OUTCOME.RESULTS) return ctx;
    return this.gw.handoffs.create({
      fromAgentId: ctx.clientId, toAgentId, packId, task, budget, returnContract, ttlMs
    });
  }

  handoff_accept(accessToken, { handoffId }) {
    const ctx = this._ctx(accessToken);
    if (ctx.outcome !== OUTCOME.RESULTS) return ctx;
    return this.gw.handoffs.accept(handoffId, { agentId: ctx.clientId });
  }

  handoff_return(accessToken, { handoffId, answer, proposedWrites = [], spend = 0 }) {
    const ctx = this._ctx(accessToken);
    if (ctx.outcome !== OUTCOME.RESULTS) return ctx;
    return this.gw.handoffs.return(handoffId, { agentId: ctx.clientId, answer, proposedWrites, spend });
  }

  handoff_cancel(accessToken, { handoffId }) {
    const ctx = this._ctx(accessToken);
    if (ctx.outcome !== OUTCOME.RESULTS) return ctx;
    return this.gw.handoffs.cancel(handoffId, { agentId: ctx.clientId });
  }

  // --- voice tools (7.5) ----------------------------------------------------------

  voice_get(accessToken, { register = null }) {
    const ctx = this._ctx(accessToken);
    if (ctx.outcome !== OUTCOME.RESULTS) return ctx;
    const pass = this.gw.passes.verify({ clientId: ctx.clientId, personaId: ctx.persona.id, category: VOICE_CATEGORY, purpose: 'writing' });
    if (!pass) return { outcome: OUTCOME.APPROVAL_REQUIRED, reason: 'no_voice_pass' };
    const vp = ctx.persona.voiceProfile ?? {};
    const reg = register && vp.registers?.[register] ? vp.registers[register] : null;
    return {
      outcome: OUTCOME.RESULTS,
      guidelines: vp.guidelines ?? null,
      aiTells: vp.aiTells ?? [],
      redLines: vp.redLines ?? [],
      register,
      registerOverrides: reg?.overrides ?? null,
      exemplars: pass.maxRung >= RUNG.FULL ? (reg?.exemplarRefs ?? vp.exemplars ?? []) : [], // pass-gated
      stylometryRisk: 'high'
    };
  }

  // naive deterministic checks: ai-tell hits and red-line scans. the draft is
  // not stored (7.5).
  voice_check(accessToken, { draft, register = null }) {
    const ctx = this._ctx(accessToken);
    if (ctx.outcome !== OUTCOME.RESULTS) return ctx;
    const pass = this.gw.passes.verify({ clientId: ctx.clientId, personaId: ctx.persona.id, category: VOICE_CATEGORY, purpose: 'writing' });
    if (!pass) return { outcome: OUTCOME.APPROVAL_REQUIRED, reason: 'no_voice_pass' };
    const vp = ctx.persona.voiceProfile ?? {};
    const hits = (vp.aiTells ?? []).filter((tell) => draft.toLowerCase().includes(tell.toLowerCase()));
    const redLineHits = [];
    if (/\bi (never|always) /i.test(draft) === false && /(honestly, |trust me, )/i.test(draft)) redLineHits.push('stock sincerity marker');
    return {
      outcome: OUTCOME.RESULTS,
      aiTellHits: hits,
      driftFlags: [],
      redLineHits,
      register
    };
  }

  // edit-driven learning (7.5): draft->final diff becomes a proposal.
  voice_feedback(accessToken, { draft, final }) {
    const ctx = this._ctx(accessToken);
    if (ctx.outcome !== OUTCOME.RESULTS) return ctx;
    const res = this.gw.facts.propose(ctx.persona, {
      content: `voice guideline from edit pair: keep "${final.slice(0, 120)}" over "${draft.slice(0, 120)}"`,
      category: VOICE_CATEGORY,
      basis: null, evidence: ['owner_edit'],
      preferenceBasis: 'stated'
    }, { actor: 'agent', clientId: ctx.clientId });
    if (res.outcome === OUTCOME.RESULTS) {
      return { outcome: OUTCOME.APPROVAL_REQUIRED, proposalId: res.fact.id };
    }
    return res;
  }

  // --- connectors (14) -----------------------------------------------------------

  // what THIS persona has connected. no credential material, ever.
  connector_list(accessToken) {
    const ctx = this._ctx(accessToken);
    if (ctx.outcome !== OUTCOME.RESULTS) return ctx;
    return this.gw.connectors.listForPersona(ctx.persona.id);
  }

  // provider read through the gate: connector pass (separate from memory
  // passes) + active identity. every returned row is untrusted-tagged with
  // source attribution; the receipt is content-free.
  async connector_read(accessToken, { connectorId, operation, params = {}, purpose, scope }) {
    const ctx = this._ctx(accessToken);
    if (ctx.outcome !== OUTCOME.RESULTS) return ctx;
    if (!connectorId || !purpose || !scope) return { outcome: OUTCOME.DECLINED, reason: 'connectorId_purpose_scope_required' };
    return this.gw.connectors.read(
      { clientId: ctx.clientId, personaId: ctx.persona.id },
      { connectorId, operation, params, purpose, scope }
    );
  }

  // --- receipts (16) -----------------------------------------------------------------

  audit_receipts(accessToken, { since = null, op = null } = {}) {
    const ctx = this._ctx(accessToken);
    if (ctx.outcome !== OUTCOME.RESULTS) return ctx;
    // the persona's own receipts only.
    const receipts = this.gw.receipts.query({ personaId: ctx.persona.id, since, op });
    return { outcome: OUTCOME.RESULTS, receipts };
  }

  // --- persona switching (section 17) -------------------------------------------
  // request: nothing changes yet; approval lands in the owner's inbox.
  requestPersonaSwitch(accessToken, { toPersonaId, purpose = null }) {
    const ctx = this._ctx(accessToken);
    if (ctx.outcome !== OUTCOME.RESULTS) return ctx;
    return this.gw.switching.request({
      clientId: ctx.clientId, fromPersonaId: ctx.persona.id, toPersonaId, purpose
    });
  }

  // collect: one-time handoff of the new session's tokens after approval.
  collectPersonaSwitch(accessToken, { switchId }) {
    const ctx = this._ctx(accessToken);
    if (ctx.outcome !== OUTCOME.RESULTS) return ctx;
    return this.gw.switching.collect({ clientId: ctx.clientId, switchId });
  }

  // --- directed disclosure (section 11, borrowed from ego.ist) ------------------------

  // protected-field delivery to one exact https destination, owner-approved,
  // delivered at most once with a signed attestation.
  request_disclosure(accessToken, { fields, destination, purpose }) {
    const ctx = this._ctx(accessToken);
    if (ctx.outcome !== OUTCOME.RESULTS) return ctx;
    if (!/^https:\/\//.test(destination)) return { outcome: OUTCOME.DECLINED, reason: 'destination_must_be_exact_https' };
    const request = {
      id: randomId('disc'),
      personaId: ctx.persona.id,
      clientId: ctx.clientId,
      fields, destination, purpose,
      status: 'pending',
      createdAt: this.gw.now()
    };
    this.gw.store.put('disclosures', request.id, request);
    this.gw.receipts.write({ actor: ctx.clientId, personaId: ctx.persona.id, op: 'disclosure', reason: 'requested' });
    return { outcome: OUTCOME.APPROVAL_REQUIRED, disclosureId: request.id };
  }
}

function maxRug(rank) {
  return rank === null || rank === undefined ? null : typeof rank === 'number' ? rank : nameToRank(rank);
}
