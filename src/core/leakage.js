// inference leakage: measured, not promised.
//
// a pass blocks retrieval. it does not block inference, and no permission check
// can catch that, because every individual read inside the audit is legal. the
// only honest move is to measure it: take what an agent was SERVED, take what
// was WITHHELD from it, and count how much of the withheld text is
// reconstructible from the served text.
//
// the method is deliberately dumb and auditable:
//   - normalize to lowercase word tokens, drop a small stopword list, keep
//     tokens of length >= 3 (distinctive tokens)
//   - score = |withheld ∩ served| / |withheld|   (containment, 0..1)
//   - flag when score >= threshold (default 0.6, always reported)
//
// three kinds of finding:
//   rung_gap        a served rung reproduces the same fact's fuller rung
//   slice_gap       a withheld fact (wrong set / off-scope) is inferable from
//                   a served fact in the same persona
//   cross_persona   the same content exists under another persona the agent
//                   can address but has no pass for - isolation that does not
//                   hold in practice
//
// the report carries ids, categories, kinds and scores. never content: a leak
// report that quotes the secret is itself a leak.

const STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'that', 'this', 'from', 'into', 'about', 'was',
  'were', 'are', 'has', 'have', 'had', 'not', 'but', 'you', 'your', 'their',
  'they', 'them', 'its', 'our', 'out', 'over', 'under', 'than', 'then', 'there',
  'here', 'when', 'what', 'which', 'who', 'whom', 'how', 'why', 'can', 'could',
  'will', 'would', 'should', 'may', 'might', 'must', 'does', 'did', 'done', 'his',
  'her', 'hers', 'him', 'she', 'he', 'it', 'on', 'in', 'at', 'to', 'of', 'a', 'an'
]);

export const DEFAULT_THRESHOLD = 0.6;

// DIRECT leakage: does a served item fall outside the pass that allowed it?
// this is deliberately independent of the serve path - it re-derives every
// constraint from the pass record. a checker that asks the server "was that
// allowed?" only repeats whatever bug the server has.
//
// returns null when clean, else { kind, passId, detail }.
// the minimum evidence shim: how many served facts must be read, and combined,
// before a withheld one is reconstructible. greedy, so the count is an upper
// bound on parsimony - a smaller set may exist. reported as such, never implied.
export function greedyCover(withheldTokens, servedTokenEntries) {
  const uncovered = new Set(withheldTokens);
  const total = uncovered.size;
  if (total === 0) return { count: 0, covered: 0, factIds: [] };
  const chosen = [];
  while (uncovered.size > 0 && chosen.length < 64) {
    let best = null;
    for (const [id, tokens] of servedTokenEntries) {
      let gain = 0;
      for (const t of tokens) if (uncovered.has(t)) gain++;
      if (gain > 0 && (!best || gain > best.gain)) best = { id, gain, tokens };
    }
    if (!best) break;
    for (const t of best.tokens) uncovered.delete(t);
    chosen.push(best.id);
  }
  return { count: chosen.length, covered: (total - uncovered.size) / total, factIds: chosen };
}

const tierFor = (n) => (n <= 1 ? 'glance' : n <= 3 ? 'attentive' : 'exhaustive');

export function checkServedAgainstPass(item, pass) {
  if (!pass) return { kind: 'no_pass', passId: null, detail: 'served without a pass' };
  if (item.personaId !== pass.personaId) {
    return { kind: 'persona_mismatch', passId: pass.id, detail: `${item.personaId} != ${pass.personaId}` };
  }
  if (pass.category && item.category !== pass.category) {
    return { kind: 'category_out_of_scope', passId: pass.id, detail: `${item.category} not ${pass.category}` };
  }
  // a scoped pass serves only its own sets; an unfiled item is out of a slice
  if (Array.isArray(pass.sets) && pass.sets.length > 0) {
    const itemSets = item.sets ?? [];
    if (!itemSets.some((s) => pass.sets.includes(s))) {
      return { kind: 'set_out_of_scope', passId: pass.id, detail: `sets ${itemSets.join(',')} outside ${pass.sets.join(',')}` };
    }
  }
  // rungs arrive named ("summary") or ranked (2): accept both, never guess
  const rankOf = (r) => (typeof r === 'number' ? r : ({ nothing: 0, exists: 1, summary: 2, conclusion: 3, full: 4 }[r] ?? 0));
  if (rankOf(item.rung) > (pass.maxRung ?? 0)) {
    return { kind: 'rung_exceeded', passId: pass.id, detail: `${item.rung} above maxRung ${pass.maxRung}` };
  }
  if (Array.isArray(pass.fields) && pass.fields.length > 0) {
    const addressed = item.field ?? `${item.category}.`;
    if (!pass.fields.some((f) => addressed === f || addressed.startsWith(`${f}.`))) {
      return { kind: 'address_out_of_scope', passId: pass.id, detail: `${addressed} outside ${pass.fields.join(',')}` };
    }
  }
  return null;
}

export function distinctiveTokens(text) {
  return String(text ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9\s'-]+/g, ' ')
    .split(/\s+/)
    .map((t) => t.replace(/^['-]+|['-]+$/g, ''))
    .filter((t) => t.length >= 3 && !STOPWORDS.has(t));
}

export function containment(withheldText, servedText) {
  const withheld = new Set(distinctiveTokens(withheldText));
  if (withheld.size === 0) return 0;
  const served = new Set(distinctiveTokens(servedText));
  let hit = 0;
  for (const t of withheld) if (served.has(t)) hit += 1;
  return hit / withheld.size;
}

export class LeakageAudit {
  constructor({ personas, facts, passes, now = Date.now }) {
    this.personas = personas;
    this.facts = facts;
    this.passes = passes;
    this.now = now;
  }

  // what this client may read from this persona, without consuming anything
  _served(personaId, clientId) {
    const active = this._activePasses(clientId, personaId);
    const out = new Map(); // factId -> { text, pass }
    for (const pass of active) {
      if (pass.category === 'vault') continue; // vault payloads are not facts and are out of scope
      const served = this.facts.serve(personaId, {
        categories: [pass.category],
        capRank: pass.maxRung,
        purpose: pass.purpose,
        sets: pass.sets ?? null,
        fields: pass.fields ?? null
      });
      for (const s of served.served ?? []) {
        if (s.rung === 'nothing') continue;
        const prev = out.get(s.factId);
        if (!prev) out.set(s.factId, { text: s.content, pass });
      }
    }
    return out;
  }

  _activePasses(clientId, personaId) {
    const now = this.now();
    return this.passes.store.list('passes', (p) => p.clientId === clientId && p.personaId === personaId && !p.revoked)
      .filter((p) => (p.expiresAt === null || p.expiresAt > now) && (p.usesLeft === null || p.usesLeft > 0));
  }

  // the audit. owner-initiated, read-only, and it never quotes content.
  audit({ personaId, clientId, threshold = DEFAULT_THRESHOLD, observationBudget = null }) {
    const persona = this.personas.get(personaId);
    if (!persona) return { outcome: 'unavailable', reason: 'persona_not_found' };
    const activePasses = this._activePasses(clientId, personaId);
    const served = this._served(personaId, clientId);

    const all = this.facts.active(personaId).map((f) => {
      const opened = this.facts.open(personaId, f);
      return { id: opened.id, category: opened.category, content: opened.content ?? '', locked: !!opened.locked, rungs: opened.rungs ?? {} };
    });
    const withheld = all.filter((f) => !served.has(f.id) && !f.locked);

    const findings = [];
    // every served fact's distinctive tokens, once: the evidence an observer has
    const servedTokens = new Map([...served].map(([id, s]) => [id, distinctiveTokens(s.text)]));

    // 1. rung gap: a served rung reproduces the fuller text of the same fact
    for (const [factId, s] of served) {
      const fact = all.find((f) => f.id === factId);
      if (!fact || !fact.rungs?.full) continue;
      if (s.text === fact.rungs.full) continue;
      const score = containment(fact.rungs.full, s.text);
      if (score >= threshold) {
        findings.push({
          kind: 'rung_gap', withheldFactId: factId, servedFactId: factId,
          category: fact.category, score: round(score), threshold,
          minObservations: 1, tier: 'glance', combination: false
        });
      }
    }

    // 2. slice gap: a withheld fact inferable from a served one (same persona)
    for (const w of withheld) {
      let best = null;
      for (const [servedId, s] of served) {
        const score = containment(w.content, s.text);
        if (!best || score > best.score) best = { servedFactId: servedId, score };
      }
      if (best && best.score >= threshold && best.servedFactId !== w.id) {
        findings.push({
          kind: 'slice_gap', withheldFactId: w.id, servedFactId: best.servedFactId,
          category: w.category, score: round(best.score), threshold,
          minObservations: 1, tier: 'glance', combination: false
        });
        continue;
      }
      // no single served fact gives it away, but the SET of them might. this is
      // the observer who reads several notes and puts them together - real
      // effort, and previously reported as nothing at all.
      const wTokens = distinctiveTokens(w.content);
      if (!wTokens.length) continue;
      const cover = greedyCover(wTokens, servedTokens);
      if (cover.count >= 2 && cover.covered >= threshold) {
        findings.push({
          kind: 'slice_gap', withheldFactId: w.id, servedFactId: cover.factIds[0],
          servedFactIds: cover.factIds, category: w.category,
          score: round(cover.covered), combinedScore: round(cover.covered), threshold,
          minObservations: cover.count, tier: tierFor(cover.count), combination: true
        });
      }
    }

    // 3. cross-persona: what this client WAS SERVED also exists under a persona
    // it cannot read. the direction matters: the served read is legal, the
    // knowledge is not - this is isolation failing in practice, not on paper.
    const others = this.personas.list().filter((p) => p.id !== personaId);
    for (const [servedFactId, s] of served) {
      const servedNorm = distinctiveTokens(s.text).join(' ');
      if (!servedNorm) continue;
      for (const other of others) {
        const hit = this.facts.active(other.id)
          .map((f) => this.facts.open(other.id, f))
          .find((f) => !f.locked && distinctiveTokens(f.content ?? '').join(' ') === servedNorm);
        if (!hit) continue;
        findings.push({
          kind: 'cross_persona', servedFactId, withheldFactId: hit.id,
          otherPersonaId: other.id, otherFactId: hit.id,
          category: hit.category, score: 1, threshold,
          minObservations: 1, tier: 'glance', combination: false
        });
        break;
      }
    }

    return {
      outcome: 'results',
      measured: true,
      method: 'distinctive-token containment, stopwords dropped, threshold ' + threshold
        + '; effort = greedy minimum observation set (upper bound, not optimal)',
      threshold,
      personaId,
      clientId,
      passesConsidered: activePasses.length,
      scanned: { served: served.size, withheld: withheld.length, active: all.length },
      caveats: [
        'vault payloads are not fact-served and are outside this scan',
        'people notes are served by people_get, not as facts, and are also outside this scan',
        'this measures reconstruction from text overlap only; it does not model common knowledge or outside data'
      ],
      observationBudget,
      latent: observationBudget === null ? [] : findings
        .filter((f) => (f.minObservations ?? 1) > observationBudget)
        .map((f) => ({ ...f, latentReason: 'above_budget' })),
      findings: findings
        .filter((f) => observationBudget === null || (f.minObservations ?? 1) <= observationBudget)
        .sort((a, b) =>
        b.score - a.score || a.kind.localeCompare(b.kind) || a.withheldFactId.localeCompare(b.withheldFactId))
    };
  }

  // the grade: direct first (must be empty), then inferred (a risk, measured).
  grade({ personaId, clientId, threshold = DEFAULT_THRESHOLD }) {
    const audit = this.audit({ personaId, clientId, threshold });
    if (audit.outcome !== 'results') return audit;
    const direct = [];
    // the fact table once, from the fact service (this audit holds no store)
    const byId = new Map(this.facts.active(personaId).map((f) => [f.id, f]));
    for (const pass of this._activePasses(clientId, personaId)) {
      if (pass.category === 'vault') continue;
      const served = this.facts.serve(personaId, {
        categories: [pass.category], capRank: pass.maxRung, purpose: pass.purpose,
        sets: pass.sets ?? null, fields: pass.fields ?? null
      });
      for (const s of served.served ?? []) {
        if (s.rung === 'nothing') continue;
        const fact = byId.get(s.factId);
        const violation = checkServedAgainstPass({
          personaId: fact?.personaId ?? personaId,
          category: s.category,
          sets: fact?.sets ?? null,
          field: s.field ?? null,
          rung: s.rung
        }, pass);
        if (violation) direct.push({ ...violation, factId: s.factId, category: s.category, rung: s.rung });
      }
    }
    const inferred = audit.findings;
    return {
      outcome: 'results',
      measured: true,
      method: audit.method,
      threshold,
      personaId,
      clientId,
      direct,
      inferred,
      verdict: direct.length === 0
        ? `no_direct_leaks_${inferred.length}_inference_risk${inferred.length === 1 ? '' : 's'}`
        : `${direct.length}_direct_leaks`,
      caveats: audit.caveats
    };
  }

  // the guard: an explicit, opt-in mitigation for inferred leakage. when a
  // served fact collides with a withheld one above threshold, the served fact
  // degrades to its exists rung. it does not prevent inference - it removes the
  // material being inferred from, and says so with the score, in the response
  // and in a receipt.
  guard({ personaId, clientId, threshold = DEFAULT_THRESHOLD }) {
    const served = this._served(personaId, clientId);
    const all = this.facts.active(personaId).map((f) => {
      const opened = this.facts.open(personaId, f);
      return { id: opened.id, category: opened.category, content: opened.content ?? '', locked: !!opened.locked };
    });
    const withheld = all.filter((f) => !served.has(f.id) && !f.locked);
    const coarsened = [];
    for (const [servedId, s] of served) {
      let best = null;
      for (const w of withheld) {
        const score = containment(w.content, s.text);
        if (score >= threshold && (!best || score > best.score)) best = { score, withheldFactId: w.id };
      }
      if (best) {
        coarsened.push({
          factId: servedId, reason: 'inference_collision',
          score: round(best.score), againstFactId: best.withheldFactId
        });
      }
    }
    return { coarsened };
  }

}

const round = (n) => Math.round(n * 1000) / 1000;
