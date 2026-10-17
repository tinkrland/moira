// voice DNA (owner direction, 2026-10-17): a persona's voice as CONTEXT for
// the agent, not a training set. three parts, all deterministic:
//
// 1. corpus: owner-added writing samples, sealed under the persona's voice
//    category key (vault rules: plaintext never rests in the store).
// 2. measurement: pure functions over the corpus. same corpus, same layers,
//    same digest, every time (the anti-evie-training rule generalized:
//    nothing is inferred, everything is counted). vocabulary follows
//    regent's glossary: lingvist (language substrate), lexica (vocabulary),
//    lingvica (delivery, punctuation-as-tone, cadence).
// 3. quirks: owner-declared, never inferred. measurement counts what is
//    there; the owner states what it means.
//
// absent means absent (voice.md): a medium with no samples is recorded
// absent, never zero-filled. no phantom measurement.

import { createHash } from 'node:crypto';
import { randomId } from '../util/crypto.js';
import { OUTCOME, PERSONA_STATUS, VOICE_CATEGORY } from '../model/constants.js';

const FILLERS = ['like', 'um', 'uh', 'you know', 'i mean', 'tbh', 'kind of', 'sort of'];
const HEDGES = ['maybe', 'probably', 'i think', 'might', 'seems', 'i guess'];
const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{1F000}-\u{1F02F}]/gu;
const SCRIPTS = {
  latin: /[A-Za-z]/,
  devanagari: /[\u0900-\u097F]/,
  cyrillic: /[\u0400-\u04FF]/,
  cjk: /[\u4E00-\u9FFF\u3040-\u30FF]/,
  arabic: /[\u0600-\u06FF]/,
  greek: /[\u0370-\u03FF]/
};

const splitSentences = (text) =>
  text.split(/(?<=[.!?…])\s+|\n+/).map((s) => s.trim()).filter((s) => s.length > 0);

const words = (text) => text.match(/[\p{L}\p{N}']+/gu) ?? [];

const stdev = (xs) => {
  if (xs.length === 0) return 0;
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  return Math.round(Math.sqrt(xs.reduce((a, b) => a + (b - mean) ** 2, 0) / xs.length) * 100) / 100;
};

const round3 = (n) => Math.round(n * 1000) / 1000;

function countPhrases(haystack, list) {
  const found = [];
  for (const p of list) {
    const re = new RegExp(`(^|[^\\p{L}])${p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^\\p{L}]|$)`, 'giu');
    const hits = haystack.match(re);
    if (hits) found.push({ phrase: p, count: hits.length });
  }
  return found.sort((a, b) => b.count - a.count || a.phrase.localeCompare(b.phrase));
}

function signaturePhrases(text, limit = 8) {
  const toks = words(text.toLowerCase());
  const counts = new Map();
  for (let i = 0; i < toks.length; i++) {
    const tri = toks.slice(i, i + 3).join(' ');
    if (toks.slice(i, i + 3).length === 3) counts.set(tri, (counts.get(tri) ?? 0) + 1);
  }
  return [...counts.entries()].filter(([, c]) => c > 1)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([phrase, count]) => ({ phrase, count }));
}

export class VoiceDNAService {
  constructor({ store, personas, keys, receipts, now = Date.now }) {
    this.store = store;
    this.personas = personas;
    this.keys = keys;
    this.receipts = receipts;
    this.now = now;
  }

  _usable(personaId) {
    const persona = this.personas.get(personaId);
    if (!persona) return { outcome: OUTCOME.UNAVAILABLE, reason: 'persona_not_found' };
    if (persona.status === PERSONA_STATUS.FROZEN) return { outcome: OUTCOME.DECLINED, reason: 'persona_frozen' };
    return null;
  }

  sampleAdd(personaId, { medium, text, source = 'pasted', note = null }) {
    const gate = this._usable(personaId);
    if (gate) return gate;
    const med = typeof medium === 'string' ? medium.trim() : '';
    const body = typeof text === 'string' ? text : '';
    if (!med) return { outcome: OUTCOME.DECLINED, reason: 'medium_required' };
    if (body.trim() === '') return { outcome: OUTCOME.DECLINED, reason: 'text_required' };

    const w = words(body).length;
    const sample = {
      id: randomId('vsmpl'),
      personaId,
      medium: med.toLowerCase(),
      source,
      note,
      wordCount: w,
      sentenceCount: splitSentences(body).length,
      sealed: this.keys.sealPayload(personaId, VOICE_CATEGORY, `sample:${med}`, body),
      createdAt: this.now()
    };
    this.store.put('voiceSamples', sample.id, sample);
    this.receipts.write({ actor: 'owner', personaId, op: 'voice_sample_added', medium: med, reason: 'corpus_context' });
    return { outcome: OUTCOME.RESULTS, sample: { id: sample.id, medium: sample.medium, wordCount: sample.wordCount, sentenceCount: sample.sentenceCount } };
  }

  sampleList(personaId) {
    return { outcome: OUTCOME.RESULTS, samples: this.store.list('voiceSamples', (s) => s.personaId === personaId)
      .map(({ id, medium, wordCount, sentenceCount, source, note, createdAt }) => ({ id, medium, wordCount, sentenceCount, source, note, createdAt }))
      .sort((a, b) => a.createdAt - b.createdAt) };
  }

  quirkAdd(personaId, { quirk }) {
    const gate = this._usable(personaId);
    if (gate) return gate;
    const q = typeof quirk === 'string' ? quirk.trim() : '';
    if (!q) return { outcome: OUTCOME.DECLINED, reason: 'quirk_required' };
    const quirks = this.store.list('voiceQuirks', (e) => e.personaId === personaId);
    if (quirks.some((e) => e.quirk.toLowerCase() === q.toLowerCase())) {
      return { outcome: OUTCOME.RESULTS, entry: quirks.find((e) => e.quirk.toLowerCase() === q.toLowerCase()) }; // no-op duplicate
    }
    const entry = { id: randomId('vquirk'), personaId, quirk: q, createdAt: this.now() };
    this.store.put('voiceQuirks', entry.id, entry);
    return { outcome: OUTCOME.RESULTS, entry };
  }

  quirkRemove(personaId, { quirk }) {
    const gate = this._usable(personaId);
    if (gate) return gate;
    const list = this.store.list('voiceQuirks', (e) => e.personaId === personaId);
    const hit = list.find((e) => e.quirk.toLowerCase() === String(quirk ?? '').toLowerCase());
    if (!hit) return { outcome: OUTCOME.UNAVAILABLE, reason: 'quirk_not_found' };
    this.store.del('voiceQuirks', hit.id);
    return { outcome: OUTCOME.RESULTS, removed: hit.quirk };
  }

  quirkList(personaId) {
    const quirks = this.store.list('voiceQuirks', (e) => e.personaId === personaId)
      .map((e) => e.quirk).sort((a, b) => a.localeCompare(b));
    return { outcome: OUTCOME.RESULTS, quirks };
  }

  // the corpus is opened only in-process, only for measurement. plaintext
  // never leaves: the layers are counts and ratios, not samples.
  _corpus(personaId) {
    return this.store.list('voiceSamples', (s) => s.personaId === personaId)
      .sort((a, b) => a.createdAt - b.createdAt)
      .map((s) => ({ medium: s.medium, text: this.keys.openPayload(personaId, VOICE_CATEGORY, `sample:${s.medium}`, s.sealed) ?? '' }));
  }

  measure(personaId, { mediums = null } = {}) {
    const persona = this.personas.get(personaId);
    if (!persona) return { outcome: OUTCOME.UNAVAILABLE, reason: 'persona_not_found' };
    const corpus = this._corpus(personaId);
    const byMedium = new Map();
    for (const s of corpus) {
      if (!byMedium.has(s.medium)) byMedium.set(s.medium, []);
      byMedium.get(s.medium).push(s.text);
    }

    // register by medium (absent means absent)
    const registerByMedium = {};
    const wanted = mediums ?? [...byMedium.keys()];
    for (const med of wanted) {
      registerByMedium[med] = byMedium.has(med)
        ? { status: 'sampled', samples: byMedium.get(med).length }
        : { status: 'absent' };
    }

    if (corpus.length === 0) {
      return { outcome: OUTCOME.RESULTS, present: false, layers: null, registerByMedium, quirks: this.quirkList(personaId).quirks, digest: null };
    }

    const all = corpus.map((s) => s.text).join('\n');
    const ws = words(all);
    const sentences = splitSentences(all);
    const letters = all.match(/\p{L}/gu) ?? [];
    const upper = all.match(/\p{Lu}/gu) ?? [];

    // lingvist: which scripts the persona draws on (share is counting, not
    // language identification: scripts are exact, dialects are not guessed)
    const scriptCounts = {};
    let scriptTotal = 0;
    for (const [name, re] of Object.entries(SCRIPTS)) {
      const hits = (all.match(new RegExp(re.source, 'gu')) ?? []).length;
      if (hits > 0) { scriptCounts[name] = hits; scriptTotal += hits; }
    }
    const lingvist = {
      primaryScripts: Object.entries(scriptCounts).sort((a, b) => b[1] - a[1]).map(([s]) => s),
      scriptShares: Object.fromEntries(Object.entries(scriptCounts).map(([s, c]) => [s, round3(c / scriptTotal)])),
      mixedScriptUtterances: sentences.filter((sn) => {
        const found = Object.entries(SCRIPTS).filter(([, re]) => re.test(sn)).length;
        return found > 1;
      }).length
    };

    // lexica: counted vocabulary markers, never described ones
    const lexica = {
      fillers: countPhrases(all.toLowerCase(), FILLERS),
      hedges: countPhrases(all.toLowerCase(), HEDGES),
      signaturePhrases: signaturePhrases(all)
    };

    // lingvica: delivery. punctuation-as-tone, cadence (sentence length
    // spread), lowercase style, emoji density. prosody in a cyber context
    // is typing rhythm, and this is its measurable shadow.
    const exclam = (all.match(/!/g) ?? []).length;
    const question = (all.match(/\?/g) ?? []).length;
    const ellipsis = (all.match(/\.\.\.|…/g) ?? []).length;
    const emojiCount = (all.match(EMOJI) ?? []).length;
    const lingvica = {
      avgWordsPerSentence: round3(sentences.length ? ws.length / sentences.length : 0),
      sentenceLengthSpread: stdev(sentences.map((sn) => words(sn).length)),
      exclamationRate: round3(exclam / Math.max(sentences.length, 1)),
      questionRate: round3(question / Math.max(sentences.length, 1)),
      ellipsisRate: round3(ellipsis / Math.max(sentences.length, 1)),
      lowercaseRatio: round3(letters.length ? (letters.length - upper.length) / letters.length : 1),
      emojiDensity: round3(emojiCount / Math.max(ws.length, 1))
    };

    const layers = { lingvist, lexica, lingvica };
    const digest = createHash('sha256').update(JSON.stringify(layers)).digest('hex').slice(0, 16);
    return { outcome: OUTCOME.RESULTS, present: true, layers, registerByMedium, quirks: this.quirkList(personaId).quirks, digest };
  }
}
