// persona switching (spec section 17): explicit choice is the source of
// truth and moira never silently auto-switches inside a session. a switch
// is therefore a new consent, not a mutation: the agent requests, the owner
// approves, the agent collects a NEW session bound to the target persona.
// the old session stays valid on the old persona until revoked or expired -
// that is the isolation property, and it is what makes switching safe.
//
// this service is pure core: no io, no clock beyond the injected now, and
// every state change writes a receipt.

import { randomId } from '../util/crypto.js';
import { OUTCOME, RECEIPT_OP } from '../model/constants.js';

export const SWITCH_STATUS = {
  PENDING: 'pending',
  APPROVED: 'approved',
  DENIED: 'denied'
};

export class SwitchService {
  constructor({ store, keys, agents, personas, sessions, facts, receipts, now = Date.now }) {
    this.store = store;
    this.keys = keys;
    this.agents = agents;
    this.personas = personas;
    this.sessions = sessions;
    this.facts = facts;
    this.receipts = receipts;
    this.now = now;
  }

  // --- agent-side request -----------------------------------------------------
  // the agent asks to operate as another persona. nothing changes yet: the
  // request lands in the owner's inbox (personaSwitches) and waits.
  request({ clientId, fromPersonaId, toPersonaId, purpose }) {
    const agent = this.agents.get(clientId);
    if (!agent || agent.revoked) return { outcome: OUTCOME.DECLINED, reason: 'unknown_or_revoked_agent' };
    const to = this.personas.get(toPersonaId);
    if (!to) return { outcome: OUTCOME.UNAVAILABLE, reason: 'target_persona_missing' };
    if (fromPersonaId === toPersonaId) return { outcome: OUTCOME.DECLINED, reason: 'same_persona' };

    const sw = {
      id: randomId('psw'),
      clientId,
      fromPersonaId,
      toPersonaId,
      purpose: purpose ?? null,
      status: SWITCH_STATUS.PENDING,
      createdAt: this.now(),
      resolvedAt: null,
      sessionId: null,
      collected: false
    };
    this.store.put('personaSwitches', sw.id, sw);
    this.receipts.write({ actor: clientId, personaId: fromPersonaId, op: RECEIPT_OP.SESSION, reason: 'persona_switch_requested' });
    return { outcome: OUTCOME.RESULTS, switchId: sw.id, status: sw.status };
  }

  // --- owner-side resolution ----------------------------------------------------
  list({ status = null } = {}) {
    return this.store.list('personaSwitches', (s) => (status ? s.status === status : true));
  }

  // approval is the consent act (section 17: explicit choice at grant time).
  // it extends the agent's allowed personas to include the target and mints a
  // fresh session bound to it. the old session is NOT touched.
  approve({ switchId }) {
    const sw = this.store.get('personaSwitches', switchId);
    if (!sw) return { outcome: OUTCOME.UNAVAILABLE, reason: 'switch_not_found' };
    if (sw.status !== SWITCH_STATUS.PENDING) return { outcome: OUTCOME.DECLINED, reason: 'switch_already_resolved' };
    const to = this.personas.get(sw.toPersonaId);
    if (!to) return { outcome: OUTCOME.UNAVAILABLE, reason: 'target_persona_missing' };

    // the explicit owner act, recorded on the agent like connect approval
    this.agents.update(sw.clientId, (a) => ({ ...a, personasAllowed: [...new Set([...(a.personasAllowed ?? []), sw.toPersonaId])] }));
    const created = this.sessions.create({ clientId: sw.clientId, personaId: sw.toPersonaId });
    if (created.outcome !== OUTCOME.RESULTS) {
      this.store.update('personaSwitches', sw.id, (s) => ({ ...s, status: SWITCH_STATUS.DENIED, resolvedAt: this.now() }));
      return { outcome: OUTCOME.DECLINED, reason: `session_mint_failed:${created.reason ?? created.outcome}` };
    }
    this.store.update('personaSwitches', sw.id, (s) => ({
      ...s, status: SWITCH_STATUS.APPROVED, resolvedAt: this.now(), sessionId: created.session.id
    }));
    this.receipts.write({ actor: 'owner', personaId: sw.toPersonaId, op: RECEIPT_OP.SESSION, reason: 'persona_switch_approved' });
    return { outcome: OUTCOME.RESULTS, sessionId: created.session.id };
  }

  deny({ switchId }) {
    const sw = this.store.get('personaSwitches', switchId);
    if (!sw) return { outcome: OUTCOME.UNAVAILABLE, reason: 'switch_not_found' };
    if (sw.status !== SWITCH_STATUS.PENDING) return { outcome: OUTCOME.DECLINED, reason: 'switch_already_resolved' };
    this.store.update('personaSwitches', sw.id, (s) => ({ ...s, status: SWITCH_STATUS.DENIED, resolvedAt: this.now() }));
    this.receipts.write({ actor: 'owner', personaId: sw.fromPersonaId, op: RECEIPT_OP.SESSION, reason: 'persona_switch_denied' });
    return { outcome: OUTCOME.RESULTS, status: SWITCH_STATUS.DENIED };
  }

  // --- agent-side collection ------------------------------------------------------
  // one-time handoff of the new session's tokens to the requesting client.
  // old session keeps working: switching is additive, never a takeover.
  collect({ clientId, switchId }) {
    const sw = this.store.get('personaSwitches', switchId);
    if (!sw || sw.clientId !== clientId) return { outcome: OUTCOME.DECLINED, reason: 'switch_not_found' };
    if (sw.status !== SWITCH_STATUS.APPROVED) return { outcome: OUTCOME.DECLINED, reason: `switch_${sw.status}` };
    if (sw.collected) return { outcome: OUTCOME.DECLINED, reason: 'switch_already_collected' };
    if (sw.sessionId === null) return { outcome: OUTCOME.DECLINED, reason: 'no_session_minted' };

    const session = this.store.get('sessions', sw.sessionId);
    if (!session) return { outcome: OUTCOME.UNAVAILABLE, reason: 'session_gone' };
    const access = this.store.list('tokens', (t) => t.sessionId === sw.sessionId && t.kind === 'access' && !t.revoked)[0];
    const refresh = this.store.list('tokens', (t) => t.sessionId === sw.sessionId && t.kind === 'refresh' && !t.revoked)[0];
    if (!access) return { outcome: OUTCOME.UNAVAILABLE, reason: 'access_token_gone' };
    this.store.update('personaSwitches', sw.id, (s) => ({ ...s, collected: true, collectedAt: this.now() }));
    return { outcome: OUTCOME.RESULTS, sessionId: session.id, accessToken: access.id, refreshToken: refresh ? refresh.id : null };
  }

  // --- wrong-persona escape hatch (section 17) -----------------------------------
  // one-tap "this belongs to another persona": the fact (or proposal) is moved
  // through the policy engine itself - propose under the target persona is the
  // taint review. canon facts never leave a heteronym (section 13).
  reassign({ factId, toPersonaId }) {
    const fact = this.store.get('facts', factId);
    if (!fact) return { outcome: OUTCOME.UNAVAILABLE, reason: 'fact_not_found' };
    const from = this.personas.get(fact.personaId);
    const to = this.personas.get(toPersonaId);
    if (!to) return { outcome: OUTCOME.UNAVAILABLE, reason: 'target_persona_missing' };
    if (from && from.identity === 'heteronymous' && fact.truthBasis === 'canon' && to.identity !== 'heteronymous') {
      return { outcome: OUTCOME.DECLINED, reason: 'canon_facts_stay_in_character' };
    }

    // the content is sealed in the source persona's vault; a move means
    // opening it there and re-sealing it under the target persona's key.
    const payload = this.keys.openPayload(fact.personaId, fact.category, fact.id, fact.sealed);
    if (!payload) return { outcome: OUTCOME.UNAVAILABLE, reason: 'content_unsealed_or_shredded' };
    const spec = {
      content: payload.content,
      category: fact.category,
      rungs: payload.rungs ?? {},
      basis: null,
      evidence: fact.provenance?.evidence ?? [],
      preferenceBasis: fact.preferenceBasis ?? null,
      validUntil: fact.validUntil ?? null,
      truthBasis: fact.truthBasis ?? 'owner',
      source: fact.provenance?.source ?? 'owner',
      recordRef: fact.recordRef ?? null,
      derivedFrom: []
    };
    // the policy engine decides: a category or label the target persona
    // refuses is a declined reassignment, not a forced move.
    const proposed = this.facts.propose(to, spec, { actor: 'owner', clientId: null });
    if (proposed.outcome !== OUTCOME.RESULTS) {
      return { outcome: OUTCOME.DECLINED, reason: `taint_review_declined:${proposed.reason ?? proposed.outcome}` };
    }
    let moved = proposed.fact;
    if (fact.status === 'active') {
      moved = this.facts.approve(proposed.fact.id);
    }
    // original is superseded with a pointer, so provenance survives
    this.store.update('facts', fact.id, (f) => ({ ...f, status: 'deleted', movedTo: moved.id }));
    this.store.update('facts', moved.id, (f) => ({ ...f, movedFrom: fact.personaId }));
    this.receipts.write({ actor: 'owner', personaId: fact.personaId, op: RECEIPT_OP.MOVE, reason: `fact_reassigned:${toPersonaId}` });
    this.receipts.write({ actor: 'owner', personaId: toPersonaId, op: RECEIPT_OP.MOVE, reason: `fact_received:${fact.personaId}` });
    return { outcome: OUTCOME.RESULTS, movedFactId: moved.id, status: moved.status };
  }
}
