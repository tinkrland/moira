// persona switching (spec section 17) + wrong-persona escape hatch + canon
// containment (section 13). pins the core property: a switch is a NEW
// consent - the old session is never mutated, and switching never blends
// personas.

import test from 'node:test';
import assert from 'node:assert/strict';
import { Moira } from '../src/index.js';
import { MemoryStore } from '../src/store.js';

const ownerSession = () => ({ kind: 'owner_session', verified: true, ownerRef: 'owner' });

function setup() {
  const m = new Moira({ store: new MemoryStore() });
  const ctx = m.createOwnerContext(ownerSession());
  const student = m.owner.createPersona(ctx, { name: 'student', identity: 'linked' });
  const alias = m.owner.createPersona(ctx, { name: 'alias', identity: 'pseudonymous' });
  const character = m.owner.createPersona(ctx, {
    name: 'captain quill', identity: 'heteronymous',
    characterSheet: { name: 'captain quill', backstory: 'a fictional sailor', voice: 'formal', beliefs: ['the sea provides'], expertise: ['navigation'], redLines: [], canonRules: [] }
  });
  const agentId = m.owner.registerAgent(ctx, { name: 'helper', tier: 'verified', personasAllowed: [student.id], spendCaps: { usd: 10 } }).id;
  const sess = m.owner.createSession(ctx, { clientId: agentId, personaId: student.id });
  return { m, ctx, student, alias, character, agentId, sess };
}

test('switching: request -> approve -> collect, old session untouched', () => {
  const { m, ctx, student, alias, agentId, sess } = setup();

  // agent asks; nothing changes yet
  const req = m.agent.requestPersonaSwitch(sess.accessToken, { toPersonaId: alias.id, purpose: 'writing under the alias' });
  assert.equal(req.outcome, 'results', 'request accepted');
  const pending = m.owner.listPersonaSwitches(ctx, { status: 'pending' });
  assert.equal(pending.switches.length, 1, 'lands in the owner inbox');

  // owner approves: consent act, personasAllowed extended, new session minted
  const app = m.owner.approvePersonaSwitch(ctx, { switchId: req.switchId });
  assert.equal(app.outcome, 'results', 'approve works');
  assert.ok(m.agents.get(agentId).personasAllowed.includes(alias.id), 'allowed personas extended');

  // agent collects: one-time, tokens usable on the target persona
  const col = m.agent.collectPersonaSwitch(sess.accessToken, { switchId: req.switchId });
  assert.equal(col.outcome, 'results', 'collect works');
  const col2 = m.agent.collectPersonaSwitch(sess.accessToken, { switchId: req.switchId });
  assert.equal(col2.outcome, 'declined', 'collect is one-time');
  assert.equal(col2.reason, 'switch_already_collected');

  // give the alias persona one fact so the read has something to serve
  m.facts.add(alias, { content: 'writes at night', category: 'identity', basis: 'stated' });
  // reads on the new persona still need their own pass (passes never widen)
  m.owner.grantPass(ctx, { clientId: agentId, personaId: alias.id, category: 'identity', purpose: 'test', maxRung: 4 , acknowledgeFull: true });
  const asAlias = m.agent.persona_context(col.accessToken, { categories: ['identity'], purpose: 'test' });
  assert.equal(asAlias.outcome, 'results');
  assert.equal(asAlias.categories.identity.served[0].content, 'writes at night', 'serves the alias persona facts');

  // isolation: the collected token is bound to the target, the original
  // session is untouched on the old persona - no silent switch, ever
  assert.equal(m.sessions.resolve(col.accessToken).personaId, alias.id, 'new session bound to the target persona');
  assert.equal(m.sessions.resolve(sess.accessToken).personaId, student.id, 'old session still on the old persona');
  assert.equal(m.sessions.resolve(sess.accessToken).outcome, 'results', 'old session still valid');
});

test('switching: deny, guards, and already-resolved states', () => {
  const { m, ctx, student, alias, sess } = setup();

  const req = m.agent.requestPersonaSwitch(sess.accessToken, { toPersonaId: alias.id });
  assert.equal(req.outcome, 'results');
  // same persona declined
  const same = m.agent.requestPersonaSwitch(sess.accessToken, { toPersonaId: student.id });
  assert.equal(same.outcome, 'declined');
  assert.equal(same.reason, 'same_persona');

  // owner denies; agent can never collect
  const den = m.owner.denyPersonaSwitch(ctx, { switchId: req.switchId });
  assert.equal(den.outcome, 'results');
  const col = m.agent.collectPersonaSwitch(sess.accessToken, { switchId: req.switchId });
  assert.equal(col.outcome, 'declined');
  assert.equal(col.reason, 'switch_denied');
  // double resolution declined
  const again = m.owner.approvePersonaSwitch(ctx, { switchId: req.switchId });
  assert.equal(again.outcome, 'declined');
  assert.equal(again.reason, 'switch_already_resolved');

  // wrong client cannot collect someone else's switch
  const req2 = m.agent.requestPersonaSwitch(sess.accessToken, { toPersonaId: alias.id });
  m.owner.approvePersonaSwitch(ctx, { switchId: req2.switchId });
  const stranger = m.agent.collectPersonaSwitch('tok_does_not_exist', { switchId: req2.switchId });
  assert.notEqual(stranger.outcome, 'results', 'a bad session can never collect');
});

test('switching: default persona helpers ride on the agent record', () => {
  const { m, ctx, alias, agentId } = setup();
  const set = m.owner.setDefaultPersona(ctx, { clientId: agentId, personaId: alias.id });
  assert.equal(set.outcome, 'results');
  assert.equal(m.agents.get(agentId).defaultPersonaId, alias.id, 'consent screens preselect it');
  m.owner.clearDefaultPersona(ctx, { clientId: agentId });
  assert.equal(m.agents.get(agentId).defaultPersonaId, null);
});

test('escape hatch: reassign moves a fact through the policy engine, with provenance', () => {
  const { m, ctx, student, alias } = setup();
  const fact = m.facts.add(student, { content: 'writes under an alias', category: 'identity', basis: 'stated' });
  assert.equal(fact.outcome, 'results');

  const moved = m.owner.reassignFact(ctx, { factId: fact.fact.id, toPersonaId: alias.id });
  assert.equal(moved.outcome, 'results', 'owner moves it');
  const newFact = m.store.get('facts', moved.movedFactId);
  assert.equal(newFact.personaId, alias.id, 'fact now lives in the target persona');
  assert.equal(newFact.movedFrom, student.id, 'provenance kept');
  const old = m.store.get('facts', fact.fact.id);
  assert.equal(old.status, 'deleted', 'original superseded');
  assert.equal(old.movedTo, newFact.id, 'pointer to the new fact');

  // both sides got receipts
  const outs = m.receipts.query({ personaId: student.id, op: 'move' });
  assert.ok(outs.length >= 1, 'outbound move receipt');
  const ins = m.receipts.query({ personaId: alias.id, op: 'move' });
  assert.ok(ins.length >= 1, 'inbound move receipt');
});

test('escape hatch: canon facts never leave the character (section 13)', () => {
  const { m, ctx, character, student } = setup();
  const canon = m.facts.add(character, { content: 'sailed the seven seas', category: 'identity', basis: 'stated', truthBasis: 'canon' });
  assert.equal(canon.outcome, 'results');

  // out of the heteronym to a linked persona: refused
  const out = m.owner.reassignFact(ctx, { factId: canon.fact.id, toPersonaId: student.id });
  assert.equal(out.outcome, 'declined');
  assert.equal(out.reason, 'canon_facts_stay_in_character');

  // the canon fact itself is untouched
  assert.equal(m.store.get('facts', canon.fact.id).status, 'active');
});

test('escape hatch: reassigning a proposal keeps it a proposal', () => {
  const { m, ctx, student, alias } = setup();
  const proposed = m.facts.propose(student, { content: 'maybe belongs elsewhere', category: 'habits' }, { actor: 'owner' });
  assert.equal(proposed.outcome, 'results');

  const moved = m.owner.reassignFact(ctx, { factId: proposed.fact.id, toPersonaId: alias.id });
  assert.equal(moved.outcome, 'results');
  assert.equal(moved.status, 'proposed', 'still needs its own approval - no silent promotion');
});
