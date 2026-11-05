// the independent verifier checks BASIS scope (owner, 2026-11-05).
//
// serve() already filters by basis, which means the guarantee currently lives
// in the code that makes the promise. this audit re-derives what a pass was
// allowed to see from the pass record itself, and reports a serve that
// contradicts it - the same standard the other scopes (sets, rungs, fields)
// are already held to.

import test from 'node:test';
import assert from 'node:assert/strict';
import { Moira } from '../src/index.js';
import { MemoryStore } from '../src/store.js';
import { BASIS } from '../src/model/constants.js';
import { checkServedAgainstPass } from '../src/core/leakage.js';

function setup() {
  const m = new Moira({ store: new MemoryStore() });
  const ctx = m.createOwnerContext({ kind: 'owner_session', verified: true, ownerRef: 'owner' });
  const made = m.owner.createPersona(ctx, { name: 'alex', identity: 'linked' });
  const persona = m.personas.get(made.id);
  return { m, ctx, persona };
}

test('a liking pass serving an availability fact is reported, not silently allowed', () => {
  const { m, ctx, persona } = setup();
  const seed = [
    ['likes quiet synths', BASIS.STATED],
    ['has free credits for brightdata', BASIS.AVAILABILITY_DRIVEN],
    ['uses firecrawl because work pays', BASIS.CHOSEN_UNDER_CONSTRAINT]
  ];
  for (const [content, basis] of seed) {
    const made = m.facts.propose(persona, { content, category: 'preferences', basis });
    assert.equal(made.outcome, 'results', JSON.stringify(made));
    m.facts.approve(made.fact.id);
  }

  const pass = {
    id: 'pass_test', personaId: persona.id, category: 'preferences',
    maxRung: 4, sets: null, fields: null, basis: ['liking']
  };

  // the violating serve: an availability fact, with text that reads like taste
  assert.equal(
    checkServedAgainstPass({ personaId: persona.id, category: 'preferences', rung: 'summary', basis: BASIS.AVAILABILITY_DRIVEN }, pass).kind,
    'basis_out_of_scope'
  );
  assert.equal(
    checkServedAgainstPass({ personaId: persona.id, category: 'preferences', rung: 'summary', basis: BASIS.CHOSEN_UNDER_CONSTRAINT }, pass).kind,
    'basis_out_of_scope',
    'work-mandated is not taste, and the verifier does not care what the text says'
  );
  // the honest serve
  assert.equal(
    checkServedAgainstPass({ personaId: persona.id, category: 'preferences', rung: 'summary', basis: BASIS.STATED }, pass),
    null
  );
});

test('a fact with no recorded basis is not assumed to be a liking', () => {
  const { persona } = setup();
  const pass = { id: 'p', personaId: persona.id, category: 'preferences', maxRung: 4, basis: ['liking'] };
  assert.equal(
    checkServedAgainstPass({ personaId: persona.id, category: 'preferences', rung: 'summary', basis: null }, pass).kind,
    'basis_unrecorded',
    'stingy: unstated basis cannot satisfy a described ask'
  );
  // but a pass that describes no basis makes no such claim
  const open = { id: 'q', personaId: persona.id, category: 'preferences', maxRung: 4 };
  assert.equal(checkServedAgainstPass({ personaId: persona.id, category: 'preferences', rung: 'summary', basis: null }, open), null);
});

test('the audit runs the basis check end to end on a real pass', () => {
  const { m, ctx, persona } = setup();
  const seeded = m.facts.propose(persona, { content: 'has free credits for brightdata', category: 'preferences', basis: BASIS.AVAILABILITY_DRIVEN });
  m.facts.approve(seeded.fact.id);
  const statement = m.facts.propose(persona, { content: 'likes quiet synths', category: 'preferences', basis: BASIS.STATED });
  m.facts.approve(statement.fact.id);

  const agentId = m.owner.registerAgent(ctx, {
    name: 'taster', tier: 'verified', personasAllowed: [persona.id], spendCaps: { usd: 5 }
  }).id;
  m.owner.grantPass(ctx, {
    clientId: agentId, personaId: persona.id, categories: ['preferences'], purpose: 'probe',
    duration: 'session', maxRung: 4, acknowledgeFull: true, basis: ['liking']
  });

  const audit = m.leakage.grade({ personaId: persona.id, clientId: agentId });
  // serve already filters, so the direct list is empty: the pass and the serve agree
  assert.deepEqual(audit.direct, [], 'no direct violation when serve honours the pass');
  // and the availability fact is still in the vault, so this is a filter working,
  // not a fact that never existed
  assert.equal(m.facts.active(persona.id).length, 2);
});
