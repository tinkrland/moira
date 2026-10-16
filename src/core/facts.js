// facts and the persona vault (spec sections 4, 6, 9.3, 16).
//
// three-layer split (section 10, after ego.ist): record (content + record_ref),
// representation (inferred, confidence, derived_from), policy (sensitivity,
// linkability, stylometry_risk, max_rung, allowed_purposes). policy travels
// with the fact, so a fact copied elsewhere keeps its constraints.
//
// storage: content and rungs are sealed in the persona vault (per-category
// key). policy metadata and provenance stay in the clear record so the policy
// engine can evaluate without decryption. sealed content never crosses a
// persona boundary raw (bridges serve transformed text only).
//
// all agent writes are proposals into the inbox (section 9.3). approval
// requires an owner session the agent never holds.

import { randomId } from '../util/crypto.js';
import { FACT_STATUS, RUNG, OUTCOME, BASIS, PREFERENCE_CATEGORIES, CORE_PERSONA_ID, PERSONA_STATUS } from '../model/constants.js';
import { derivePolicy, serveRung, nameToRank, decideWrite } from './policy.js';

export class FactService {
  constructor({ store, keys, personas = null, now = Date.now }) {
    this.store = store;
    this.keys = keys;
    this.personas = personas; // for shared-core inheritance reads (section 17)
    this.now = now;
  }

  // --- proposal path (agent writes) ------------------------------------------

  propose(persona, spec, { actor = 'agent', clientId = null } = {}) {
    if (persona && persona.status === PERSONA_STATUS.FROZEN) {
      // a frozen persona is on ice: no new facts, no thaw-by-backdoor
      return { outcome: OUTCOME.DECLINED, reason: 'persona_frozen' };
    }
    const {
      content, category, rungs = {}, derivedFrom = [], basis = null,
      evidence = [], preferenceBasis = null, validUntil = null, truthBasis = 'owner',
      source = 'agent', recordRef = null
    } = spec;

    if (!content) throw new Error('fact content required');

    const parents = derivedFrom.map((id) => this.get(persona.id, id)).filter(Boolean);
    // cross-persona parents (bridge imports): { factId, personaId, policy }.
    // the edge points at a fact in another persona's vault; taint still applies.
    const external = spec.externalDerived ?? [];
    if (parents.length + external.length !== derivedFrom.length + external.length || parents.length !== derivedFrom.length) {
      if (parents.length !== derivedFrom.length) {
        return { outcome: OUTCOME.UNAVAILABLE, reason: 'derived_from_missing' };
      }
    }
    // taint: proposals derived from persona-a facts inherit a's labels (section 9.3).
    // most restrictive label per dimension (open question 2, resolved).
    const parentPolicies = [...parents.map((p) => p.policy), ...external.map((e) => e.policy)];
    const policy = derivePolicy(parentPolicies, spec.policy ?? {});

    const isPreference = PREFERENCE_CATEGORIES.includes(category) || spec.isPreference === true;

    // preference-basis rules (8.9) and write decision (9.3)
    const writeDecision = decideWrite({
      persona, category, content, basis: preferenceBasis ?? basis, evidence,
      isPreferenceCategory: isPreference, derivedFrom
    });
    if (writeDecision.outcome !== OUTCOME.RESULTS) {
      return { outcome: writeDecision.outcome, reason: writeDecision.reason, detail: writeDecision.detail };
    }

    const resolvedBasis = writeDecision.basis;

    const fact = {
      id: randomId('fact'),
      personaId: persona.id,
      category,
      status: FACT_STATUS.PROPOSED,
      truthBasis,
      recordRef,
      representation: {
        inferred: spec.inferred ?? false,
        confidence: spec.confidence ?? null,
        derivedFrom: [
          ...derivedFrom,
          ...external.map((e) => `${e.personaId}/${e.factId}`)
        ]
      },
      policy,
      preferenceBasis: resolvedBasis,
      validUntil: validUntil ?? (resolvedBasis === BASIS.AVAILABILITY_DRIVEN && spec.circumstanceEndsAt ? spec.circumstanceEndsAt : null),
      provenance: { source, clientId, evidence, createdAt: this.now(), actor },
      sealed: null
    };

    // seal content + rung texts into the vault
    const payload = { content, rungs: normalizeRungs(content, rungs, category) };
    fact.sealed = this.keys.sealPayload(persona.id, category, fact.id, payload);
    this.store.put('facts', fact.id, fact);
    return { outcome: OUTCOME.RESULTS, fact, proposal: true };
  }

  // --- owner path ------------------------------------------------------------

  // owner-authored facts skip the inbox but keep the same schema and taint rules.
  add(persona, spec, { source = 'owner' } = {}) {
    const res = this.propose(persona, spec, { actor: 'owner', clientId: null });
    if (res.outcome !== OUTCOME.RESULTS) return res;
    return { ...res, fact: this.approve(res.fact.id) };
  }

  // applies an approval. authority lives in the owner facade: only
  // ownerapi.approveProposal (and the owner add path) may call this.
  approve(factId) {
    const fact = this.store.get('facts', factId);
    if (!fact || fact.status !== FACT_STATUS.PROPOSED) return null;
    return this.store.update('facts', factId, (f) => ({ ...f, status: FACT_STATUS.ACTIVE }));
  }

  // applies a rejection (removes the proposal). authority lives in the owner
  // facade: only ownerapi.rejectProposal may call this.
  reject(factId) {
    const fact = this.store.get('facts', factId);
    if (!fact) return null;
    this.store.del('facts', factId);
    return fact;
  }

  // forget (section 11): agent proposes deletion of owner-approved facts;
  // agent-owned proposals can be deleted outright by the proposing agent.
  forget(persona, factId, { clientId }) {
    const fact = this.get(persona.id, factId);
    if (!fact) return { outcome: OUTCOME.UNAVAILABLE, reason: 'fact_not_found' };
    if (fact.provenance.clientId === clientId && fact.status === FACT_STATUS.PROPOSED) {
      this.store.del('facts', factId);
      return { outcome: OUTCOME.RESULTS, deleted: true };
    }
    return { outcome: OUTCOME.APPROVAL_REQUIRED, reason: 'forget_needs_owner', factId };
  }

  deleteHard(factId) {
    const fact = this.store.get('facts', factId);
    this.store.del('facts', factId);
    return fact;
  }

  inbox(personaId) {
    return this.store.list('facts', (f) => f.personaId === personaId && f.status === FACT_STATUS.PROPOSED, { personaId, status: FACT_STATUS.PROPOSED });
  }

  // --- read path ---------------------------------------------------------------

  get(personaId, factId) {
    const fact = this.store.get('facts', factId);
    if (!fact || fact.personaId !== personaId) return null;
    return this.open(personaId, fact);
  }

  // active facts, with circumstance decay applied (8.9): availability-driven
  // facts whose circumstance ended are archived, not silently kept fresh.
  active(personaId, { category = null } = {}) {
    const now = this.now();
    return this.store
      .list('facts', (f) => f.personaId === personaId && f.status === FACT_STATUS.ACTIVE, { personaId, status: FACT_STATUS.ACTIVE })
      .filter((f) => (category === null || f.category === category))
      .map((f) => {
        if (f.validUntil !== null && f.validUntil < now && f.preferenceBasis === BASIS.AVAILABILITY_DRIVEN) {
          return { ...f, archivedAs: 'was-' + f.preferenceBasis, validUntilExpired: true };
        }
        return f;
      })
      .map((f) => this.open(personaId, f));
  }

  // search within one persona only. facts whose rung cannot be served under the
  // cap are reported as skipped, never served above their max_rung.
  serve(personaId, { categories = null, predicate = null, capRank = RUNG.FULL, purpose = null }) {
    const facts = this.active(personaId).filter((f) => categories === null || categories.includes(f.category));
    // shared core: personas with inheritsCore read core facts by reference
    // (spec 5/17). heteronyms never reach here - personas.js forces the flag
    // false at create and update - but serve still guards, because the core is
    // the one place a persona boundary could silently widen.
    const persona = this.personas ? this.personas.get(personaId) : null;
    const inherited = persona && persona.inheritsCore === true ? this.active(CORE_PERSONA_ID) : [];
    const matched = predicate ? [...facts, ...inherited].filter(predicate) : [...facts, ...inherited];
    const served = [];
    const skipped = [];
    for (const fact of matched) {
      if (purpose && fact.policy.allowedPurposes !== null && !fact.policy.allowedPurposes.includes(purpose)) {
        skipped.push({ factId: fact.id, reason: 'purpose_not_allowed' });
        continue;
      }
      const s = serveRung(fact, capRank);
      if (!s) {
        skipped.push({ factId: fact.id, reason: 'rung_unavailable' });
        continue;
      }
      served.push({
        factId: fact.id,
        rung: s.rung,
        content: s.content,
        category: fact.category,
        preferenceBasis: fact.preferenceBasis,
        truthBasis: fact.truthBasis,
        validUntil: fact.validUntil
      });
    }
    return { served, skipped };
  }

  open(personaId, factRecord) {
    if (!factRecord.sealed) return factRecord;
    const payload = this.keys.openPayload(personaId, factRecord.category, factRecord.id, factRecord.sealed);
    if (payload === null) {
      // shredded key or tampered ciphertext: locked, never "no memories".
      return { ...factRecord, locked: true, content: null, rungs: {} };
    }
    return { ...factRecord, content: payload.content, rungs: payload.rungs, sealed: undefined };
  }

  exportPersona(personaId) {
    return this.store.list('facts', (f) => f.personaId === personaId, { personaId }).map((f) => this.open(personaId, f));
  }
}

function normalizeRungs(content, rungs, category) {
  const out = { full: rungs.full ?? content };
  if (rungs.summary) out.summary = rungs.summary;
  if (rungs.conclusion) out.conclusion = rungs.conclusion;
  // the exists rung is mechanically derivable from the fact's existence: no
  // inference, no content. generated when not supplied so every fact can be
  // served at the lowest rung (spec section 9.1; rung generation open
  // question 1 is answered conservatively for exists only).
  out.exists = rungs.exists ?? `there is a note in ${category}`;
  return out;
}
