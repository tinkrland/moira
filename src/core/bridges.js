// bridges and the privacy budget (spec sections 4, 9.2, 9.5, 13).
//
// a bridge is a two-sided, auditable rule for flow from persona a to persona b:
// predicate, max rung, transform, purpose, ttl, exposure. no bridge means
// NOT_AVAILABLE, never a hint that anything exists.
//
// flow requires BOTH an egress check at the source and an ingress check at
// the destination (9.2). the bridge record is the two-sided grant; the
// destination persona's ingress.accept_from must also name the source
// explicitly. defaults are deny for pseudonymous/heteronymous personas.
//
// pseudonymous destinations: linkable-labeled facts never flow in; results are
// style-normalized. heteronymous destinations: inspiration template only
// (themes/interests at conclusion rung), never biographical facts.
//
// privacy budget (9.5): per (persona pair, window) counter. every bridge pull
// spends by rung and linkability. exhausted -> refused until reset.

import { randomId } from '../util/crypto.js';
import { RUNG, OUTCOME, IDENTITY, BASIS, INSPIRATION_CATEGORIES, ATTRIBUTION_CATEGORIES, BRIDGE_EXPOSURE } from '../model/constants.js';
import { serveRung, nameToRank } from './policy.js';

const PRIVACY_WINDOW_MS = 24 * 60 * 60 * 1000;
const PRIVACY_BUDGET = 24; // per persona pair per window

export class BridgeService {
  constructor({ store, personas, facts, receipts, now = Date.now }) {
    this.store = store;
    this.personas = personas;
    this.facts = facts;
    this.receipts = receipts;
    this.now = now;
  }

  // --- owner-side bridge management -------------------------------------------

  create({ src, dst, predicate = () => true, maxRung = RUNG.SUMMARY, purpose, ttlMs = null, standing = true, exposure = BRIDGE_EXPOSURE.DST_SEES_SRC, direction = 'one_way' }) {
    if (src === dst) throw new Error('a bridge needs two different personas');
    const bridge = {
      id: randomId('brdg'),
      src,
      dst,
      predicateId: predicate, // persisted predicates are declarative in production
      maxRung,
      purpose,
      ttlMs,
      standing,
      exposure,
      direction,
      createdAt: this.now(),
      revoked: false
    };
    this.store.put('bridges', bridge.id, bridge);
    return bridge;
  }

  revoke(bridgeId) {
    return this.store.update('bridges', bridgeId, (b) => ({ ...b, revoked: true }));
  }

  list() {
    return this.store.list('bridges', (b) => !b.revoked);
  }

  // --- the mediated cross-persona read (9.2) ------------------------------------

  // requester: session context of persona b. never raw facts, never auto-merge.
  request({ requesterPersonaId, requesterClientId, srcPersonaId, query, purpose, maxRung = null }) {
    const src = this.personas.get(srcPersonaId);
    const dst = this.personas.get(requesterPersonaId);
    if (!src || !dst) return { outcome: OUTCOME.UNAVAILABLE, reason: 'persona_not_found' };
    if (src.id === dst.id) return { outcome: OUTCOME.DECLINED, reason: 'same_persona_use_persona_context' };
    if (src.locked || dst.locked) return { outcome: OUTCOME.LOCKED, reason: 'persona_kill_switch' };

    // step 1: find bridges src->dst matching purpose. none -> not_available.
    const now = this.now();
    const bridge = this.store
      .list('bridges', (b) => b.src === src.id && b.dst === dst.id && !b.revoked && b.purpose === purpose, { src: src.id, dst: dst.id, purpose })
      .find((b) => (b.ttlMs === null || b.createdAt + b.ttlMs > now));
    if (!bridge) return { outcome: OUTCOME.NOT_AVAILABLE, reason: 'no_bridge' };

    // step 2: egress check at src. deny_labels + persona egress template.
    const cap = Math.min(maxRung ?? bridge.maxRung, bridge.maxRung);
    const egressDeny = new Set([...(src.egress.denyLabels ?? []), ...(bridge.denyLabels ?? [])]);
    const heteronymSrc = src.identity === IDENTITY.HETERONYMOUS;

    const candidates = this.facts.active(src.id).filter(query || (() => true));
    const selected = [];
    for (const fact of candidates) {
      // fact-level purpose policy always applies
      if (fact.policy.allowedPurposes !== null && !fact.policy.allowedPurposes.includes(purpose)) continue;

      // heteronym egress: attribution template only (13)
      if (heteronymSrc && !ATTRIBUTION_CATEGORIES.includes(fact.category)) continue;
      // linkable facts never cross into a pseudonymous destination (13)
      if (dst.identity === IDENTITY.PSEUDONYMOUS && fact.policy.linkability === 'high') continue;
      // heteronym ingress: inspiration template only (13)
      if (dst.identity === IDENTITY.HETERONYMOUS && !INSPIRATION_CATEGORIES.includes(fact.category)) continue;
      // explicit deny labels (string labels on the fact)
      if ((fact.labels ?? []).some((l) => egressDeny.has(l))) continue;
      // canon facts never leave a heteronym as true statements (13)
      if (fact.truthBasis === 'canon' && dst.identity !== IDENTITY.HETERONYMOUS && !ATTRIBUTION_CATEGORIES.includes(fact.category)) continue;

      const served = serveRung(fact, cap);
      if (!served) continue;
      selected.push({ fact, served });
    }

    // step 3: ingress check at dst. is src in accept_from?
    if (!(dst.ingress.acceptFrom ?? []).includes(src.id)) {
      return { outcome: OUTCOME.DECLINED, reason: 'ingress_not_allowed' };
    }

    // both sides allowed; transforms have been applied via rung capping and
    // filters above. pseudonymous dst: strip any residual linkable markers and
    // mark style-normalized.
    if (selected.length === 0) {
      return { outcome: OUTCOME.EMPTY, bridgeId: bridge.id };
    }

    // step 4 (9.2 step 7): spend privacy budget, per rung and linkability.
    const budget = this._budgetFor(src.id, dst.id);
    const spend = selected.reduce((acc, { fact, served }) => acc + nameToRank(served.rung) * (fact.policy.linkability === 'high' ? 2 : 1), 0);
    if (budget.spent + spend > PRIVACY_BUDGET) {
      return { outcome: OUTCOME.DECLINED, reason: 'privacy_budget_exhausted', resetsAt: budget.resetAt };
    }
    this._spendBudget(src.id, dst.id, spend);

    // results: transformed content only, tagged untrusted-imported, origin
    // hidden when exposure is dst_sees_anon. never merged into dst's store.
    const items = selected.map(({ fact, served }) => ({
      content: served.content,
      rung: served.rung,
      category: fact.category,
      truthBasis: fact.truthBasis,
      preferenceBasis: fact.preferenceBasis ?? null,
      trust: 'untrusted-imported',
      styleNormalized: dst.identity === IDENTITY.PSEUDONYMOUS,
      origin: bridge.exposure === BRIDGE_EXPOSURE.DST_SEES_ANON ? null : src.id,
      srcPersonaId: bridge.exposure === BRIDGE_EXPOSURE.DST_SEES_ANON ? null : src.id,
      derivedFrom: bridge.exposure === BRIDGE_EXPOSURE.DST_SEES_ANON ? null : fact.id
    }));

    // receipts on both sides (content-free).
    this.receipts.write({
      actor: requesterClientId ?? 'owner', personaId: src.id, op: 'bridge',
      categories: selected.map((s) => s.fact.category), rung: Math.max(...selected.map((s) => nameToRank(s.served.rung))),
      factCount: selected.length, bridgeId: bridge.id
    });
    this.receipts.write({
      actor: requesterClientId ?? 'owner', personaId: dst.id, op: 'bridge',
      categories: [], rung: null, factCount: selected.length, bridgeId: bridge.id
    });

    return {
      outcome: OUTCOME.RESULTS,
      bridgeId: bridge.id,
      items,
      merged: false, // dst may propose to keep items; proposals go through the inbox
      privacyBudget: { spent: spend, remaining: PRIVACY_BUDGET - (budget.spent + spend), resetsAt: budget.resetAt }
    };
  }

  // dst proposes to keep an imported item: a new fact owned by dst whose
  // derived_from edge points at the source fact (9.2 step 6).
  importPropose(dstPersona, item, { clientId, srcPersonaId = null }) {
    // the source fact lives in another persona's vault: taint still applies.
    let external = [];
    if (item.derivedFrom && item.srcPersonaId) {
      const srcFact = this.facts.get(item.srcPersonaId, item.derivedFrom);
      if (srcFact) {
        external = [{ factId: item.derivedFrom, personaId: item.srcPersonaId, policy: srcFact.policy }];
      }
    }
    return this.facts.propose(dstPersona, {
      content: item.content,
      category: item.category,
      derivedFrom: [],
      externalDerived: external,
      basis: BASIS.INFERRED,
      preferenceBasis: item.preferenceBasis,
      rungs: {},
      inferred: true,
      confidence: 0.5
    }, { actor: 'agent', clientId });
  }

  _budgetFor(a, b) {
    const now = this.now();
    const key = [a, b].sort().join('->');
    let state = this.store.get('privacyBudgets', key);
    if (!state || state.resetAt <= now) {
      state = { id: key, spent: 0, resetAt: now + PRIVACY_WINDOW_MS };
      this.store.put('privacyBudgets', key, state);
    }
    return state;
  }

  _spendBudget(a, b, amount) {
    const key = [a, b].sort().join('->');
    const state = this._budgetFor(a, b);
    this.store.update('privacyBudgets', key, (s) => ({ ...s, spent: s.spent + amount }));
    return state.spent + amount;
  }
}
