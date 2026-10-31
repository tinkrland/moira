// the people phase: human context, per persona.
//
// the documented model (features.md, buildplan.md) is exact and this test pins
// it: a relationship is (person, persona), never (person, owner) wholesale.
// circles are soft tags, so overlap is normal (a friend tagged as basically
// family is fine). what differs between personas is the relationship's
// importance profile, not which you is real. and the same human can be known
// to one persona and a stranger to another - that is the isolation, not a bug.

import test from 'node:test';
import assert from 'node:assert/strict';
import { Moira } from '../src/index.js';
import { MemoryStore } from '../src/store.js';

function setup() {
  const m = new Moira({ store: new MemoryStore() });
  const ctx = m.createOwnerContext({ kind: 'owner_session', verified: true, ownerRef: 'owner' });
  const work = m.owner.createPersona(ctx, { name: 'alex', identity: 'linked' });
  const music = m.owner.createPersona(ctx, { name: 'sable', identity: 'pseudonymous' });
  return { m, ctx, work, music };
}

test('circles: a person is one human, a relationship is (person, persona)', () => {
  const { m, ctx, work, music } = setup();

  const nina = m.owner.peopleAdd(ctx, { name: 'nina', handles: { email: 'nina@example.com' } });
  assert.equal(nina.outcome, 'results');
  const personId = nina.person.id;

  // the same human, known differently by each persona
  const w = m.owner.peopleProfileSet(ctx, {
    personaId: work.id, personId, circles: ['work', 'mentors'], importance: 5, note: 'hired me, reads everything i ship'
  });
  assert.equal(w.outcome, 'results');
  const s = m.owner.peopleProfileSet(ctx, {
    personaId: music.id, personId, circles: ['friends', 'basically family'], importance: 2, note: 'comes to every set'
  });
  assert.equal(s.outcome, 'results');

  // circles are soft and overlapping: two circles, one human, both counts
  const circles = m.owner.peopleCircles(ctx, { personaId: work.id });
  assert.deepEqual(circles.circles.map((c) => c.name).sort(), ['mentors', 'work']);
  assert.equal(circles.circles.find((c) => c.name === 'work').count, 1);

  // importance is per relationship, and nothing inherits across personas
  const workView = m.owner.peopleList(ctx, { personaId: work.id });
  const musicView = m.owner.peopleList(ctx, { personaId: music.id });
  assert.equal(workView.people[0].importance, 5);
  assert.equal(musicView.people[0].importance, 2);
  assert.deepEqual(workView.people[0].circles.sort(), ['mentors', 'work']);
  assert.deepEqual(musicView.people[0].circles.sort(), ['basically family', 'friends']);
  assert.equal(JSON.stringify(workView).includes('every set'), false, 'notes stay on their persona');

  // a person known only to work is a stranger to music
  const dave = m.owner.peopleAdd(ctx, { name: 'dave' }).person;
  m.owner.peopleProfileSet(ctx, { personaId: work.id, personId: dave.id, circles: ['work'], importance: 3 });
  assert.equal(m.owner.peopleList(ctx, { personaId: music.id }).people.length, 1, 'dave is not on the music hat');
  assert.equal(m.owner.peopleList(ctx, { personaId: work.id }).people.length, 2);

  // the owner still sees the whole address book, with per-persona counts
  const all = m.owner.peopleAll(ctx);
  assert.equal(all.people.length, 2);
  assert.equal(all.people.find((p) => p.name === 'nina').personas.length, 2);
  assert.equal(all.people.find((p) => p.name === 'dave').personas.length, 1);

  // a duplicate human is refused rather than silently doubled
  assert.equal(m.owner.peopleAdd(ctx, { name: 'Nina' }).reason, 'person_exists');
  // and a profile cannot be set for a person who does not exist
  assert.equal(m.owner.peopleProfileSet(ctx, { personaId: work.id, personId: 'ppl_nope', importance: 1 }).reason, 'person_not_found');
});

test('circles: an agent gets people only through a pass, sliced by circle', () => {
  const { m, ctx, work } = setup();
  const nina = m.owner.peopleAdd(ctx, { name: 'nina' }).person;
  const dave = m.owner.peopleAdd(ctx, { name: 'dave' }).person;
  m.owner.peopleProfileSet(ctx, { personaId: work.id, personId: nina.id, circles: ['family'], importance: 5, note: 'sister' });
  m.owner.peopleProfileSet(ctx, { personaId: work.id, personId: dave.id, circles: ['work'], importance: 4, note: 'manager' });

  const agentId = m.owner.registerAgent(ctx, { name: 'greeter', tier: 'verified', personasAllowed: [work.id], spendCaps: { usd: 1 } }).id;
  const token = m.owner.createSession(ctx, { clientId: agentId, personaId: work.id }).accessToken;

  // no pass, no people: an approval is what a read looks like
  const before = m.agent.people_get(token, {});
  assert.equal(before.outcome, 'approval_required');

  // a family-sliced pass at summary: names + circles + importance, no notes
  m.owner.grantPass(ctx, {
    clientId: agentId, personaId: work.id, category: 'people', purpose: 'gift_ideas',
    duration: 'session', sets: ['family'], maxRung: 3
  });
  // a pass is purpose-scoped, so the read names its purpose (same rule as facts)
  const read = m.agent.people_get(token, { purpose: 'gift_ideas' });
  assert.equal(read.outcome, 'results');
  assert.deepEqual(read.people.map((p) => p.name), ['nina'], 'only the family slice');
  assert.equal(read.people[0].note, undefined, 'summary rung has no notes');

  // a full-rung pass on the work slice does include the note
  m.owner.grantPass(ctx, {
    clientId: agentId, personaId: work.id, category: 'people', purpose: 'standup',
    duration: 'session', sets: ['work'], maxRung: 4
  });
  const full = m.agent.people_get(token, { purpose: 'standup' });
  assert.equal(full.outcome, 'results');
  assert.deepEqual(full.people.map((p) => p.name), ['dave']);
  assert.equal(full.people[0].note, 'manager', 'full rung includes the note');

  // removing the relationship hides the human from that persona, not from moira
  m.owner.peopleProfileRemove(ctx, { personaId: work.id, personId: dave.id });
  assert.equal(m.owner.peopleList(ctx, { personaId: work.id }).people.length, 1);
  assert.equal(m.owner.peopleAll(ctx).people.length, 2, 'the human is still in the address book');
});
