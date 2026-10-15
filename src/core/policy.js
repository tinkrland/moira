// policy engine, pure part (spec section 9).
//
// every function here is a pure function over its inputs: deterministic,
// replayable, testable. services call these to decide; the services execute
// effects (receipts, state changes) after the decision. the conformance
// suite pins golden decisions to these functions.
//
// design rule from section 9.4: "every decision is deterministic given the
// inputs, logged as a receipt, and replayable for audit."

import {
  RUNG, RUNG_BY_NAME, OUTCOME, IDENTITY, SENSITIVITY_ORDER, LINKABILITY_ORDER,
  STYLOMETRY_ORDER, FREE_KINDS, BASIS, RESOURCE_KIND
} from '../model/constants.js';

// --- taint algebra (section 9.3, open question 2 resolved) -------------------
// "take the most restrictive label per dimension."

function mostRestrictive(order, a, b) {
  if (!a) return b || order[order.length - 1];
  if (!b) return a;
  return order.indexOf(a) <= order.indexOf(b) ? a : b;
}

// purposes: null = all purposes (unrestricted). the intersection across
// parents must be allowed by EVERY parent; treating null as "all" means one
// null parent never launders another parent's restriction. all parents null
// = null. disjoint sets = [] (deny every purpose).
function intersectPurposes(lists) {
  if (lists.every((l) => l === null)) return null;
  const restricted = lists.filter((l) => l !== null);
  return restricted.reduce((acc, l) => acc.filter((x) => l.includes(x)), [...restricted[0]]);
}

export function mergeTaint(parents) {
  // parents: array of fact policy objects
  if (parents.length === 0) {
    return {
      sensitivity: 'normal',
      linkability: 'none',
      stylometryRisk: 'none',
      maxRung: RUNG.FULL,
      allowedPurposes: null // null = unrestricted (owner-authored)
    };
  }
  return {
    sensitivity: parents.map((p) => p.sensitivity).reduce((a, b) => mostRestrictive(SENSITIVITY_ORDER, a, b)),
    linkability: parents.map((p) => p.linkability).reduce((a, b) => mostRestrictive(LINKABILITY_ORDER, a, b)),
    stylometryRisk: parents.map((p) => p.stylometryRisk).reduce((a, b) => mostRestrictive(STYLOMETRY_ORDER, a, b)),
    maxRung: Math.min(...parents.map((p) => p.maxRung ?? RUNG.FULL)),
    // purposes must be allowed by EVERY parent: intersection, with null
    // (unrestricted) treated as "all purposes", never as a widening override.
    allowedPurposes: intersectPurposes(parents.map((p) => p.allowedPurposes ?? null))
  };
}

// summarization is label-preserving (section 9.3): a derived fact inherits the
// merged taint of its parents, full stop.
export function derivePolicy(parentPolicies, requestedPolicy = {}) {
  const taint = mergeTaint(parentPolicies);
  const requested = {
    sensitivity: requestedPolicy.sensitivity ?? taint.sensitivity,
    linkability: requestedPolicy.linkability ?? taint.linkability,
    stylometryRisk: requestedPolicy.stylometryRisk ?? taint.stylometryRisk,
    maxRung: Math.min(requestedPolicy.maxRung ?? RUNG.FULL, taint.maxRung),
    // a proposal may only narrow, never widen: the requested set is
    // intersected with the inherited one (null = all purposes either side).
    allowedPurposes: requestedPolicy.allowedPurposes === undefined || requestedPolicy.allowedPurposes === null
      ? taint.allowedPurposes
      : intersectPurposes([requestedPolicy.allowedPurposes, taint.allowedPurposes])
  };
  // a proposal may never widen taint it inherits (a pass never widens either).
  requested.sensitivity = mostRestrictive(SENSITIVITY_ORDER, taint.sensitivity, requested.sensitivity);
  requested.linkability = mostRestrictive(LINKABILITY_ORDER, taint.linkability, requested.linkability);
  requested.stylometryRisk = mostRestrictive(STYLOMETRY_ORDER, taint.stylometryRisk, requested.stylometryRisk);
  return requested;
}

// --- rung selection (section 9.1 step 4) -------------------------------------
// serve at the highest rung the pass allows, never above the fact max_rung.
// if the target rung text is absent, fall to the next lower rung that exists.

export function serveRung(fact, capRank) {
  const cap = Math.min(capRank, fact.policy.maxRung ?? RUNG.FULL);
  for (let rank = cap; rank >= RUNG.EXISTS; rank--) {
    const text = fact.rungs?.[rankToName(rank)];
    if (text !== undefined && text !== null && text !== '') {
      return { rung: rankToName(rank), content: text };
    }
  }
  return null; // nothing may be served at or below the cap
}

export function rankToName(rank) {
  return ['nothing', 'exists', 'conclusion', 'summary', 'full'][rank];
}

export function nameToRank(name) {
  return RUNG_BY_NAME[name] ?? 0;
}

// --- read decision (section 9.1) ----------------------------------------------

export function decideRead({ persona, pass, facts, purpose, query }) {
  if (!persona) return { outcome: OUTCOME.UNAVAILABLE, reason: 'persona_not_found' };
  if (persona.locked) return { outcome: OUTCOME.LOCKED, reason: 'persona_kill_switch' };

  if (!pass) {
    // "no pass means no data and no error" -> an approval link, not a refusal.
    return { outcome: OUTCOME.APPROVAL_REQUIRED, reason: 'no_pass', category: null };
  }
  if (pass.purpose !== purpose) {
    return { outcome: OUTCOME.APPROVAL_REQUIRED, reason: 'pass_purpose_mismatch' };
  }
  const matched = facts.filter((f) => f.status === 'active');
  const served = [];
  const skipped = [];
  for (const fact of matched) {
    if (fact.policy.allowedPurposes !== null && !fact.policy.allowedPurposes.includes(purpose)) {
      skipped.push({ factId: fact.id, reason: 'purpose_not_allowed' });
      continue;
    }
    const servedContent = serveRung(fact, pass.maxRung);
    if (!servedContent) {
      skipped.push({ factId: fact.id, reason: 'rung_unavailable' });
      continue;
    }
    served.push({
      factId: fact.id,
      rung: servedContent.rung,
      content: servedContent.content,
      preferenceBasis: fact.preferenceBasis ?? null,
      validUntil: fact.validUntil ?? null
    });
  }
  if (served.length === 0) {
    return { outcome: OUTCOME.EMPTY, served: [], skipped, passId: pass.id };
  }
  return { outcome: OUTCOME.RESULTS, served, skipped, passId: pass.id };
}

// --- write decision (section 9.3) -----------------------------------------------

// preference-basis rules (section 8.9). ledger events, key grants and lease use
// are circumstances, never taste.
export function decideWrite({ persona, category, content, basis, evidence, isPreferenceCategory, derivedFrom }) {
  if (!persona) return { outcome: OUTCOME.UNAVAILABLE, reason: 'persona_not_found' };
  if (persona.locked) return { outcome: OUTCOME.LOCKED, reason: 'persona_kill_switch' };

  const evidenceKinds = new Set(evidence ?? []);
  const onlyCircumstantial = evidenceKinds.size > 0 &&
    [...evidenceKinds].every((k) => k === 'ledger_event' || k === 'key_grant' || k === 'lease_use');

  if (isPreferenceCategory && onlyCircumstantial) {
    return {
      outcome: OUTCOME.DECLINED,
      reason: 'preference_poisoning',
      detail: 'ledger events are circumstances, not taste (section 8.9)'
    };
  }

  let resolvedBasis = basis;
  if (isPreferenceCategory && !resolvedBasis) resolvedBasis = BASIS.INFERRED; // missing basis defaults to inferred
  if (derivedFrom.length > 0 && !resolvedBasis) {
    // derived content inherits its parents' weakest claim
    resolvedBasis = BASIS.INFERRED;
  }

  return { outcome: OUTCOME.RESULTS, basis: resolvedBasis ?? BASIS.STATED, tainted: derivedFrom.length > 0 };
}

// --- persona flow defaults (section 5 table) --------------------------------------

export function flowDefaults(identity, direction) {
  // direction: 'in' (may facts flow INTO this persona) or 'out'
  if (identity === IDENTITY.LINKED) return { in: true, out: true }[direction];
  if (identity === IDENTITY.PSEUDONYMOUS) {
    // in: deny by default; out: allowed to linked.
    return direction === 'in' ? false : true;
  }
  if (identity === IDENTITY.HETERONYMOUS) {
    // in: deny except inspiration; out: deny except attribution.
    return direction === 'in' ? 'inspiration_only' : 'attribution_only';
  }
  return false;
}

export function canBridgetoKind(srcIdentity, dstIdentity) {
  // cheap bridges: linked <-> linked. everything else needs an explicit bridge.
  return srcIdentity === IDENTITY.LINKED && dstIdentity === IDENTITY.LINKED;
}

// --- router scoring (section 8.3) -----------------------------------------------

export function eligibility({ account, persona, task, caps, estimatedCost, now = null, unit = 'usd' }) {
  // 1. persona fit: hard. a decoupled persona never uses another persona's key.
  if (account.personaId !== persona.id) return { eligible: false, reason: 'persona_fit' };
  // 1b. an expired account is dead, whatever its caps say (8.3).
  if (account.expiresAt !== null && account.expiresAt !== undefined && now !== null && account.expiresAt <= now) {
    return { eligible: false, reason: 'expired' };
  }
  // 1c. an account with no limits entered is unknown, not unlimited: it may
  // not silently route paid work (section 11). only an owner-marked
  // unmetered account proceeds.
  if (estimatedCost > 0 && account.limits.length === 0 && account.unmetered !== true) {
    return { eligible: false, reason: 'unknown_budget' };
  }
  // 2. capability fit
  const needsModels = task.models ?? [];
  if (needsModels.length > 0 && !needsModels.some((m) => account.capabilities?.models?.includes(m))) {
    return { eligible: false, reason: 'capability_fit' };
  }
  const needsTools = task.tools ?? [];
  if (needsTools.length > 0 && !needsTools.every((t) => account.capabilities?.tools?.includes(t))) {
    return { eligible: false, reason: 'capability_fit' };
  }
  // 3. data-policy fit: sensitive personas refuse tiers that retain or train.
  if (persona.sensitive === true && account.dataPolicy !== 'no_retention') {
    return { eligible: false, reason: 'data_policy_fit' };
  }
  // 4. headroom: enough remaining cap for the estimated cost, within limits.
  if (account.priorityOverride?.excluded) return { eligible: false, reason: 'excluded' };
  // headroom is per unit: the estimate is compared only against the
  // matching unit's headroom (account.headroom is precomputed per unit).
  if (estimatedCost > 0 && account.headroom !== null && account.headroom !== undefined && estimatedCost > account.headroom) {
    return { eligible: false, reason: 'headroom' };
  }
  if (caps !== null && estimatedCost > caps) return { eligible: false, reason: 'cap' };
  return { eligible: true };
}

export function urgency({ account, now, burnRateFraction }) {
  // urgency = value_at_risk / max(days_to_expiry, 0.5)
  // value_at_risk = remaining_value * (1 - expected_use_before_expiry)
  const days = account.expiresAt ? (account.expiresAt - now) / 86400000 : Infinity;
  if (days <= 0) return 0;
  const remainingValue = account.remainingValue ?? 0;
  const expectedUse = clamp01(burnRateFraction ?? 0.5);
  const valueAtRisk = remainingValue * (1 - expectedUse);
  const score = valueAtRisk / Math.max(days, 0.5);
  return score;
}

export function rankAccounts({ accounts, now, burnRateFraction }) {
  const decorated = accounts.map((a) => ({ account: a, urgency: urgency({ account: a, now, burnRateFraction }) }));
  decorated.sort((x, y) => {
    // 1. urgency (use-it-or-lose-it): expiring credits/trials first
    if (y.urgency !== x.urgency) return y.urgency - x.urgency;
    // 2. free before paid
    const xf = FREE_KINDS.includes(x.account.kind) ? 0 : 1;
    const yf = FREE_KINDS.includes(y.account.kind) ? 0 : 1;
    if (xf !== yf) return xf - yf;
    // 3. non-renewing before renewing (a quota that resets is lower urgency than one that vanishes)
    const xr = x.account.renews ? 1 : 0;
    const yr = y.account.renews ? 1 : 0;
    if (xr !== yr) return xr - yr;
    // 4. cheapest adequate
    return (x.account.costPerUnit ?? 0) - (y.account.costPerUnit ?? 0);
  });
  return decorated;
}

function clamp01(v) {
  return Math.max(0, Math.min(1, v));
}

// lowest binding limit wins (section 8.5): persona, agent, handoff, task.
export function bindingCap(personaCap, agentCap, handoffCap, taskCap) {
  const caps = [personaCap, agentCap, handoffCap, taskCap].filter((c) => c !== null && c !== undefined && c !== Infinity);
  return caps.length === 0 ? null : Math.min(...caps);
}

export function capDecision({ cap, estimate, softCap = null }) {
  if (cap === null) return { ok: true };
  if (estimate <= cap) return { ok: true };
  if (softCap !== null && estimate <= softCap) {
    return { ok: false, outcome: OUTCOME.APPROVAL_REQUIRED, reason: 'soft_cap' };
  }
  return { ok: false, outcome: OUTCOME.DECLINED, reason: 'hard_cap' };
}

export const isFreeKind = (kind) => FREE_KINDS.includes(kind);

