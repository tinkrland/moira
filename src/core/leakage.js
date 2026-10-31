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
  audit({ personaId, clientId, threshold = DEFAULT_THRESHOLD }) {
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

    // 1. rung gap: a served rung reproduces the fuller text of the same fact
    for (const [factId, s] of served) {
      const fact = all.find((f) => f.id === factId);
      if (!fact || !fact.rungs?.full) continue;
      if (s.text === fact.rungs.full) continue;
      const score = containment(fact.rungs.full, s.text);
      if (score >= threshold) {
        findings.push({
          kind: 'rung_gap', withheldFactId: factId, servedFactId: factId,
          category: fact.category, score: round(score), threshold
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
          category: w.category, score: round(best.score), threshold
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
          category: hit.category, score: 1, threshold
        });
        break;
      }
    }

    return {
      outcome: 'results',
      measured: true,
      method: 'distinctive-token containment, stopwords dropped, threshold ' + threshold,
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
      findings: findings.sort((a, b) =>
        b.score - a.score || a.kind.localeCompare(b.kind) || a.withheldFactId.localeCompare(b.withheldFactId))
    };
  }
}

const round = (n) => Math.round(n * 1000) / 1000;
