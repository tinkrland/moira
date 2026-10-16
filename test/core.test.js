// the shared core (spec 5/17): promotion, demotion, inheritance-by-reference
// reads, and the containment rules. every property here is one the spec
// states explicitly - nothing more.

import test from 'node:test';
import assert from 'node:assert/strict';
import { Moira, MemoryStore, constants } from '../src/index.js';

const { CORE_PERSONA_ID } = constants;

function setup() {
  const m = new Moira({ store: new MemoryStore() });
  const ctx = m.createOwnerContext({ kind: 'owner_session', verified: true, ownerRef: 'owner' });
  const student = m.owner.createPersona(ctx, { name: 'student', identity: 'linked' });
  const alias = m.owner.createPersona(ctx, { name: 'alias', identity: 'pseudonymous' });
  const character = m.owner.createPersona(ctx, {
    name: 'captain quill', identity: 'heteronymous',
    characterSheet: { name: 'captain quill', backstory: 'a fictional sailor', voice: 'formal', beliefs: ['the sea provides'], expertise: ['navigation'], redLines: [], canonRules: [] }
  });
  return { m, ctx, student, alias, character };
}

test('core: promote moves a fact into the core, audited, with provenance', () => {
  const { m, ctx, student } = setup();
  const fact = m.facts.add(student, { content: 'builds moira', category: 'projects', basis: 'stated' });
  assert.equal(fact.outcome, 'results');

  const promoted = m.owner.promoteFact(ctx, { factId: fact.fact.id });
  assert.equal(promoted.outcome, 'results');
  const coreFact = m.store.get('facts', promoted.coreFactId);
  assert.equal(coreFact.personaId, CORE_PERSONA_ID, 'fact now lives in the core');
  assert.equal(coreFact.movedFrom, student.id, 'provenance kept');
  assert.equal(coreFact.provenance.promotedFrom, student.id);
  assert.equal(m.store.get('facts', fact.fact.id).status, 'deleted', 'original superseded');

  // listed, and both sides audited
  const list = m.owner.listCoreFacts(ctx);
  assert.equal(list.facts.length, 1);
  assert.equal(m.receipts.query({ personaId: student.id, op: 'promote' }).length, 1);
  assert.equal(m.receipts.query({ personaId: CORE_PERSONA_ID, op: 'promote' }).length, 1);

  // double promotion declined
  const again = m.owner.promoteFact(ctx, { factId: promoted.coreFactId });
  assert.equal(again.outcome, 'declined');
  assert.equal(again.reason, 'already_core');
});

test('core: linked personas inherit core facts BY REFERENCE in reads', () => {
  const { m, ctx, student } = setup();
  const agentId = m.owner.registerAgent(ctx, { name: 'helper', tier: 'verified', personasAllowed: [student.id], spendCaps: { usd: 5 } }).id;
  const sess = m.owner.createSession(ctx, { clientId: agentId, personaId: student.id });
  m.facts.add(student, { content: 'lives in a dorm', category: 'identity', basis: 'stated' });

  // a core fact in a category the pass covers
  const coreBase = m.facts.add(student, { content: 'likes cameras', category: 'hobbies', basis: 'stated' });
  m.owner.promoteFact(ctx, { factId: coreBase.fact.id });

  m.owner.grantPass(ctx, { clientId: agentId, personaId: student.id, category: 'hobbies', purpose: 'research', maxRung: 4 });
  const read = m.agent.persona_context(sess.accessToken, { categories: ['hobbies'], purpose: 'research' });
  assert.equal(read.outcome, 'results');
  assert.equal(read.categories.hobbies.served.length, 1, 'inherited core fact served under the linked persona');
  assert.equal(read.categories.hobbies.served[0].content, 'likes cameras');
});

test('core: heteronyms and default pseudonyms never inherit (the boundary holds)', () => {
  const { m, ctx, alias, character } = setup();
  const base = m.facts.add(alias, { content: 'placeholder', category: 'identity', basis: 'stated' });
  // promote needs an active fact from ANY persona; use the linked persona from setup instead
  const student = m.personas.list().find((p) => p.name === 'student');
  const coreBase = m.facts.add(student, { content: 'likes cameras', category: 'hobbies', basis: 'stated' });
  m.owner.promoteFact(ctx, { factId: coreBase.fact.id });

  // the guard in serve: heteronym has inheritsCore forced false by personas.js
  assert.equal(character.inheritsCore, false, 'heteronyms never inherit');
  assert.equal(alias.inheritsCore, false, 'pseudonyms opt in only');

  // promote out of a heteronym: canon refused outright
  const canon = m.facts.add(character, { content: 'sailed the seven seas', category: 'identity', basis: 'stated', truthBasis: 'canon' });
  assert.equal(canon.outcome, 'results');
  const refused = m.owner.promoteFact(ctx, { factId: canon.fact.id });
  assert.equal(refused.outcome, 'declined');
  assert.equal(refused.reason, 'canon_facts_stay_in_character');
});

test('core: demotion runs through the policy engine into the target persona', () => {
  const { m, ctx, student, alias } = setup();
  const coreBase = m.facts.add(student, { content: 'likes cameras', category: 'hobbies', basis: 'stated' });
  const promoted = m.owner.promoteFact(ctx, { factId: coreBase.fact.id });

  const demoted = m.owner.demoteFact(ctx, { factId: promoted.coreFactId, toPersonaId: alias.id });
  assert.equal(demoted.outcome, 'results', 'policy engine approved the move');
  const moved = m.store.get('facts', demoted.movedFactId);
  assert.equal(moved.personaId, alias.id, 'fact now owned by the target persona');
  assert.equal(moved.movedFrom, CORE_PERSONA_ID, 'provenance kept');
  assert.equal(m.store.get('facts', promoted.coreFactId).status, 'deleted', 'core copy superseded');
  assert.equal(m.receipts.query({ personaId: alias.id, op: 'demote' }).length, 1, 'audited');

  // demoting something that is not a core fact: unavailable
  const notCore = m.owner.demoteFact(ctx, { factId: moved.id, toPersonaId: student.id });
  assert.equal(notCore.outcome, 'unavailable');
  assert.equal(notCore.reason, 'core_fact_not_found');
});
