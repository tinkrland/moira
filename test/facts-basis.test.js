// the liking/availability split (owner, 2026-11-05).
//
// "usage is not liking" said free usage is not preference. BASIS already records
// why a fact is believed, but serve() ignored it, so an ask about taste could be
// answered with "i use firecrawl because the company pays for it". these tests
// pin the read side: a liking ask gets liking facts, and nothing else.

import test from 'node:test';
import assert from 'node:assert/strict';
import { Moira } from '../src/index.js';
import { MemoryStore } from '../src/store.js';
import { BASIS } from '../src/model/constants.js';

const ownerSession = () => ({ kind: 'owner_session', verified: true, ownerRef: 'owner' });

function setup() {
  const m = new Moira({ store: new MemoryStore() });
  const ctx = m.createOwnerContext(ownerSession());
  const persona = m.owner.createPersona(ctx, { name: 'alex', identity: 'linked' });
  const p = m.personas.get(persona.id);
  // propose() puts a fact in front of the owner; only an approval makes it
  // servable. the basis is carried through that approval untouched.
  const seed = [
    ['likes quiet synths', BASIS.STATED],
    ['uses firecrawl because work pays', BASIS.CHOSEN_UNDER_CONSTRAINT],
    ['has free credits for brightdata', BASIS.AVAILABILITY_DRIVEN],
    ['probably likes dark mode', BASIS.INFERRED]
  ];
  for (const [content, basis] of seed) {
    const made = m.facts.propose(p, { content, category: 'preferences', basis });
    assert.equal(made.outcome, 'results', JSON.stringify(made));
    m.facts.approve(made.fact.id);
  }
  return { m, ctx, personaId: persona.id };
}

// a pass whose basis is set is a pass that asked a narrower question
function read(m, ctx, personaId, basis) {
  const agent = m.owner.registerAgent(ctx, { name: 'a', tier: 'verified', personasAllowed: [personaId], spendCaps: { usd: 5 } });
  const granted = m.owner.grantPass(ctx, {
    clientId: agent.id, personaId, categories: ['preferences'], purpose: 'probe',
    duration: 'session', maxRung: 4, basis, acknowledgeFull: true
  });
  assert.equal(granted.outcome, 'results', JSON.stringify(granted));
  return m.facts.serve(personaId, { categories: ['preferences'], capRank: 4, basis }).served;
}

test('a liking ask gets stated and freely-chosen facts only', () => {
  const { m, ctx, personaId } = setup();
  const out = read(m, ctx, personaId, 'liking');
  assert.deepEqual(out.map((f) => f.content), ['likes quiet synths']);
});

test('availability is its own answer, and is never folded into liking', () => {
  const { m, ctx, personaId } = setup();
  const out = read(m, ctx, personaId, 'availability');
  assert.deepEqual(out.map((f) => f.content), ['has free credits for brightdata']);
});

test('constraint is separate from both: work-mandated is not taste', () => {
  const { m, ctx, personaId } = setup();
  const out = read(m, ctx, personaId, 'constraint');
  assert.deepEqual(out.map((f) => f.content), ['uses firecrawl because work pays']);
});

test('an inferred basis never satisfies a liking ask, even though it says "likes"', () => {
  const { m, ctx, personaId } = setup();
  const liking = read(m, ctx, personaId, 'liking');
  assert.equal(liking.some((f) => f.preferenceBasis === BASIS.INFERRED), false, 'saving is not liking');
});

test('an explicit basis list works, and an unknown one is refused, not ignored', () => {
  const { m, personaId } = setup();
  const explicit = m.facts.serve(personaId, { categories: ['preferences'], capRank: 4, basis: [BASIS.STATED, BASIS.AVAILABILITY_DRIVEN] }).served;
  assert.equal(explicit.length, 2);
  assert.throws(() => m.facts.serve(personaId, { categories: ['preferences'], capRank: 4, basis: 'vibes' }), /basis/i);
});

test('a pass without a basis still sees everything (the old behaviour is a choice, not a default)', () => {
  const { m, ctx, personaId } = setup();
  const agent = m.owner.registerAgent(ctx, { name: 'b', tier: 'verified', personasAllowed: [personaId], spendCaps: { usd: 5 } });
  m.owner.grantPass(ctx, { clientId: agent.id, personaId, categories: ['preferences'], purpose: 'probe', duration: 'session', maxRung: 4, acknowledgeFull: true });
  const out = m.facts.serve(personaId, { categories: ['preferences'], capRank: 4 }).served;
  assert.equal(out.length, 4);
});
