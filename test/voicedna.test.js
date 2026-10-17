// voice DNA (owner direction, 2026-10-17): a persona's unique voice is
// CONTEXT for the agent, not a training set. the corpus is sealed per
// persona, measurements are deterministic, and the handoff to agents is
// the measured three-layer profile + owner-declared quirks.
//
// framing per the owner: "not training, but rather, defining the context
// for the agent". no model ever absorbs persona signals (evie's rule
// generalizes): same corpus must produce the same profile, every time.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Moira } from '../src/index.js';
import { MemoryStore } from '../src/store.js';

const ownerSession = () => ({ kind: 'owner_session', verified: true, ownerRef: 'owner' });

const setup = () => {
  const m = new Moira({ store: new MemoryStore() });
  const ctx = m.createOwnerContext(ownerSession());
  const founder = m.owner.createPersona(ctx, { name: 'founder', identity: 'linked' });
  const student = m.owner.createPersona(ctx, { name: 'student', identity: 'linked' });
  const agentId = m.owner.registerAgent(ctx, { name: 'scribe', tier: 'verified', personasAllowed: [founder.id, student.id], spendCaps: { usd: 10 } }).id;
  const sess = m.owner.createSession(ctx, { clientId: agentId, personaId: founder.id });
  return { m, ctx, founder, student, agentId, sess };
};

const lowChat = [
  'ok so like the deploy went fine lol',
  'kind of amazed it worked tbh',
  'you know what i mean? ship it'
].join('\n');

const formalEssay = 'The quarterly review demonstrated consistent improvement. We expect the trend to hold through the next cycle. Careful analysis of the numbers supports this conclusion.';

test('voice dna: corpus is sealed, measured deterministically, absent means absent', () => {
  const { m, ctx, founder } = setup();

  const s1 = m.owner.voiceSampleAdd(ctx, { personaId: founder.id, medium: 'texts', text: lowChat });
  assert.equal(s1.outcome, 'results');
  assert.ok(s1.sample.wordCount > 10);

  // raw text never rests in the store in the clear
  const raw = JSON.stringify(m.store.list('voiceSamples', () => true));
  assert.ok(!raw.includes('deploy went fine'), 'samples are sealed at rest');

  const s2 = m.owner.voiceSampleAdd(ctx, { personaId: founder.id, medium: 'essays', text: formalEssay });
  assert.equal(s2.outcome, 'results');

  // deterministic measurement: same corpus, same profile, same digest
  const d1 = m.owner.voiceMeasure(ctx, { personaId: founder.id });
  const d2 = m.owner.voiceMeasure(ctx, { personaId: founder.id });
  assert.equal(d1.outcome, 'results');
  assert.deepEqual(d1.layers, d2.layers, 'measurement is deterministic');
  assert.equal(d1.digest, d2.digest, 'same corpus, same digest');

  // three layers, all measured
  assert.ok(d1.layers.lingvist, 'lingvist layer present');
  assert.ok(d1.layers.lexica, 'lexica layer present');
  assert.ok(d1.layers.lingvica, 'lingvica layer present');

  // lexica: the fillers are counted, not guessed
  assert.ok(d1.layers.lexica.fillers.length > 0, 'fillers measured from the corpus');
  // lingvica: punctuation as tone, lowercase style, cadence
  assert.ok(d1.layers.lingvica.ellipsisRate >= 0);
  assert.ok(d1.layers.lingvica.lowercaseRatio > 0.5, 'the texts sample is lowercase-heavy');
  assert.ok(d1.layers.lingvica.avgWordsPerSentence > 2);

  // absent means absent: a medium with no samples is recorded absent,
  // never invented (and an empty persona measures to absent, not zeros)
  const empty = m.owner.voiceMeasure(ctx, { personaId: founder.id, mediums: ['calls'] });
  assert.deepEqual(empty.registerByMedium.calls, { status: 'absent' }, 'unsampled medium is absent, not invented');
});

test('voice dna: quirks are owner-declared and ride along with the profile', () => {
  const { m, ctx, founder } = setup();
  const q = m.owner.voiceQuirkAdd(ctx, { personaId: founder.id, quirk: 'never uses periods in texts' });
  assert.equal(q.outcome, 'results');
  const q2 = m.owner.voiceQuirkAdd(ctx, { personaId: founder.id, quirk: 'says lol when amused, never lmao' });
  assert.equal(q2.outcome, 'results');
  // duplicate quirk is a quiet no-op
  const q3 = m.owner.voiceQuirkAdd(ctx, { personaId: founder.id, quirk: 'never uses periods in texts' });
  assert.equal(q3.outcome, 'results');
  assert.equal(m.owner.voiceQuirkList(ctx, { personaId: founder.id }).quirks.length, 2);

  m.owner.voiceSampleAdd(ctx, { personaId: founder.id, medium: 'texts', text: lowChat });
  const d = m.owner.voiceMeasure(ctx, { personaId: founder.id });
  assert.deepEqual(d.quirks, ['never uses periods in texts', 'says lol when amused, never lmao']);
});

test('voice dna: agents get the profile as context, gated and isolated', () => {
  const { m, ctx, founder, student, agentId, sess } = setup();
  m.owner.voiceSampleAdd(ctx, { personaId: founder.id, medium: 'texts', text: lowChat });
  m.owner.voiceQuirkAdd(ctx, { personaId: founder.id, quirk: 'types in lowercase' });
  m.owner.voiceSampleAdd(ctx, { personaId: student.id, medium: 'notes', text: 'lecture notes are long and careful and deliberate' });

  // no pass: the category is not shareable by default
  const denied = m.agent.voice_dna_get(sess.accessToken, {});
  assert.equal(denied.outcome, 'approval_required');

  m.owner.grantPass(ctx, { clientId: agentId, personaId: founder.id, category: 'voice', purpose: 'writing', duration: 'permanent' });
  const got = m.agent.voice_dna_get(sess.accessToken, {});
  assert.equal(got.outcome, 'results');
  assert.deepEqual(got.quirks, ['types in lowercase'], 'quirks ride along');
  assert.ok(got.layers.lingvica, 'the agent receives the measured layers');
  // the corpus itself never reaches the agent: context, not data
  assert.equal(got.samples, undefined, 'raw samples stay in the vault');
  assert.ok(!JSON.stringify(got).includes('deploy went fine'), 'no raw corpus leakage');

  // a session on the other persona never sees this persona's dna
  const otherSess = m.owner.createSession(ctx, { clientId: sess.clientId, personaId: student.id });
  const other = m.agent.voice_dna_get(otherSess.accessToken, {});
  assert.ok(!JSON.stringify(other).includes('lol'), 'per-persona isolation holds');
});

test('voice dna: frozen personas decline writes; invalid input declines', () => {
  const { m, ctx, founder } = setup();
  assert.equal(m.owner.voiceSampleAdd(ctx, { personaId: founder.id, medium: '', text: 'x' }).outcome, 'declined');
  assert.equal(m.owner.voiceSampleAdd(ctx, { personaId: founder.id, medium: 'texts', text: '   ' }).outcome, 'declined');
  m.owner.freezePersona(ctx, founder.id);
  assert.equal(m.owner.voiceSampleAdd(ctx, { personaId: founder.id, medium: 'texts', text: lowChat }).reason, 'persona_frozen');
  assert.equal(m.owner.voiceQuirkAdd(ctx, { personaId: founder.id, quirk: 'x' }).reason, 'persona_frozen');
});

test('viola: per-medium measurement keeps the shift visible instead of averaging it', () => {
  const { m, ctx, founder } = setup();
  m.owner.voiceSampleAdd(ctx, { personaId: founder.id, medium: 'texts', text: 'lol ok so the deploy went fine\nkinda wild tbh\nanyway gn' });
  m.owner.voiceSampleAdd(ctx, { personaId: founder.id, medium: 'texts', text: 'omg wait\nno way\nlmaooo ok fine' });
  m.owner.voiceSampleAdd(ctx, { personaId: founder.id, medium: 'texts', text: 'brb\nk done\nsheesh ok' });
  m.owner.voiceSampleAdd(ctx, { personaId: founder.id, medium: 'linkedin', text: 'Thrilled to announce our Q3 results. The team delivered exceptional work across all verticals. Grateful for every collaborator on this journey.' });
  m.owner.voiceSampleAdd(ctx, { personaId: founder.id, medium: 'linkedin', text: 'Honored to share that we shipped the platform rewrite ahead of schedule. Thank you to everyone who reviewed the draft specification.' });
  m.owner.voiceSampleAdd(ctx, { personaId: founder.id, medium: 'linkedin', text: 'Pleased to report strong adoption metrics this quarter. Grateful as always for the community feedback that shaped this release.' });

  const agg = m.owner.voiceMeasure(ctx, { personaId: founder.id });
  assert.equal(agg.outcome, 'results');
  // every tagged medium is measured independently, none merged away
  assert.deepEqual(Object.keys(agg.perMedium).sort(), ['linkedin', 'texts'], 'one profile per medium');
  const texts = agg.perMedium.texts;
  const li = agg.perMedium.linkedin;
  assert.ok(texts.layers.lingvica.lowercaseRatio > li.layers.lingvica.lowercaseRatio, 'texts are lowercase-dominant');
  assert.ok(li.layers.lexica.functionWordRate > texts.layers.lexica.functionWordRate, 'formal writing carries more function words');
  // the shift itself is reported, not averaged: fields diverge per medium
  assert.ok(agg.crossMedium.length >= 1, 'divergence between mediums is computed');
  const div = agg.crossMedium[0];
  assert.deepEqual(div.between.sort(), ['linkedin', 'texts'], 'the pair is named');
  assert.ok(div.fields.lingvica.lowercaseRatio, 'numeric deltas are reported per field');
  assert.ok(div.fields.lingvica.lowercaseRatio.delta > 0, 'and the delta is a real number');
  // stylometry convention: style is orthogonal to topic, so samples carry no topic inference
  assert.equal(agg.perMedium.texts.topics, undefined, 'no topic claim is invented');

  // determinism: measure twice, identical bytes
  const again = m.owner.voiceMeasure(ctx, { personaId: founder.id });
  assert.equal(JSON.stringify(again), JSON.stringify(agg), 'same corpus, same measurement');

  // thin mediums are flagged, not silently confident
  m.owner.voiceSampleAdd(ctx, { personaId: founder.id, medium: 'twitter', text: 'one tweet only' });
  const thin = m.owner.voiceMeasure(ctx, { personaId: founder.id });
  assert.equal(thin.perMedium.twitter.lowSample, true, 'a thin corpus is marked lowSample');
  assert.equal(thin.perMedium.linkedin.lowSample, undefined, 'a full corpus is not');
});
