// the shared core (spec 5/17): a single curated fact base that linked
// personas inherit BY REFERENCE. promotion and demotion are explicit,
// owner-approved, auditable moves - never automatic sync.
//
// mechanics: a core fact is an ordinary fact record with personaId 'core',
// sealed under the core's own key. promotion opens the source seal and
// re-seals under the core key (owner act; the fact's policy and taint ride
// along unchanged). demotion runs the move THROUGH the policy engine -
// propose under the target persona is the taint review, same as reassign.
//
// canon containment still applies (section 13): canon facts never leave a
// heteronym, not even upward into the core.

import { randomId } from '../util/crypto.js';
import { FACT_STATUS, OUTCOME, RECEIPT_OP, CORE_PERSONA_ID } from '../model/constants.js';

export class CoreService {
  constructor({ store, keys, personas, facts, receipts, now = Date.now }) {
    this.store = store;
    this.keys = keys;
    this.personas = personas;
    this.facts = facts;
    this.receipts = receipts;
    this.now = now;
  }

  // core facts, opened for the owner's eyes only.
  list({ category = null } = {}) {
    const facts = this.store.list('facts', (f) => f.personaId === CORE_PERSONA_ID && f.status === FACT_STATUS.ACTIVE);
    const filtered = category ? facts.filter((f) => f.category === category) : facts;
    return { outcome: OUTCOME.RESULTS, facts: filtered.map((f) => ({ id: f.id, category: f.category, truthBasis: f.truthBasis, movedFrom: f.movedFrom ?? null })) };
  }

  // persona -> core. the owner act: policy and taint ride along unchanged,
  // canon is refused outright.
  promote({ factId }) {
    const fact = this.store.get('facts', factId);
    if (!fact) return { outcome: OUTCOME.UNAVAILABLE, reason: 'fact_not_found' };
    if (fact.personaId === CORE_PERSONA_ID) return { outcome: OUTCOME.DECLINED, reason: 'already_core' };
    const from = this.personas.get(fact.personaId);
    if (from && from.identity === 'heteronymous' && fact.truthBasis === 'canon') {
      return { outcome: OUTCOME.DECLINED, reason: 'canon_facts_stay_in_character' };
    }

    const payload = this.keys.openPayload(fact.personaId, fact.category, fact.id, fact.sealed);
    if (!payload) return { outcome: OUTCOME.UNAVAILABLE, reason: 'content_unsealed_or_shredded' };

    const coreFact = {
      id: randomId('fact'),
      personaId: CORE_PERSONA_ID,
      category: fact.category,
      status: FACT_STATUS.ACTIVE,
      truthBasis: fact.truthBasis ?? 'owner',
      recordRef: fact.recordRef ?? null,
      representation: fact.representation,
      policy: fact.policy,
      preferenceBasis: fact.preferenceBasis ?? null,
      validUntil: fact.validUntil ?? null,
      provenance: { ...fact.provenance, promotedAt: this.now(), promotedFrom: fact.personaId },
      movedFrom: fact.personaId,
      // aad carries the fact's own id, matching facts.js seal semantics
      sealed: null
    };
    coreFact.sealed = this.keys.sealPayload(CORE_PERSONA_ID, fact.category, coreFact.id, payload);
    this.store.put('facts', coreFact.id, coreFact);

    this.store.update('facts', fact.id, (f) => ({ ...f, status: FACT_STATUS.SUPERSEDED, movedTo: coreFact.id }));
    this.receipts.write({ actor: 'owner', personaId: fact.personaId, op: RECEIPT_OP.PROMOTE, reason: 'promoted_to_core', categories: [fact.category] });
    this.receipts.write({ actor: 'owner', personaId: CORE_PERSONA_ID, op: RECEIPT_OP.PROMOTE, reason: 'fact_promoted_in', categories: [fact.category] });
    return { outcome: OUTCOME.RESULTS, coreFactId: coreFact.id };
  }

  // core -> persona. the policy engine decides: propose under the target is
  // the taint review, exactly like the wrong-persona escape hatch.
  demote({ factId, toPersonaId }) {
    const fact = this.store.get('facts', factId);
    if (!fact || fact.personaId !== CORE_PERSONA_ID) return { outcome: OUTCOME.UNAVAILABLE, reason: 'core_fact_not_found' };
    const to = this.personas.get(toPersonaId);
    if (!to) return { outcome: OUTCOME.UNAVAILABLE, reason: 'target_persona_missing' };

    const payload = this.keys.openPayload(CORE_PERSONA_ID, fact.category, fact.id, fact.sealed);
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
    const proposed = this.facts.propose(to, spec, { actor: 'owner', clientId: null });
    if (proposed.outcome !== OUTCOME.RESULTS) {
      return { outcome: OUTCOME.DECLINED, reason: `taint_review_declined:${proposed.reason ?? proposed.outcome}` };
    }
    const moved = this.facts.approve(proposed.fact.id);
    this.store.update('facts', moved.id, (f) => ({ ...f, movedFrom: CORE_PERSONA_ID }));
    this.store.update('facts', fact.id, (f) => ({ ...f, status: FACT_STATUS.SUPERSEDED, movedTo: moved.id }));
    this.receipts.write({ actor: 'owner', personaId: CORE_PERSONA_ID, op: RECEIPT_OP.DEMOTE, reason: `demoted_to:${toPersonaId}`, categories: [fact.category] });
    this.receipts.write({ actor: 'owner', personaId: toPersonaId, op: RECEIPT_OP.DEMOTE, reason: 'fact_received_from_core', categories: [fact.category] });
    return { outcome: OUTCOME.RESULTS, movedFactId: moved.id };
  }
}
