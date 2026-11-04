// rooms: a shared memory that is not a shared persona.
//
// the cresca idea is "a group is a shared memory - remembers it as one, like a
// person or a topic". the moira constraint is that nothing here may become a
// back channel for what a persona privately thinks about the people in it, and
// nothing enters a room without a member putting it there.
//
// so: membership is consented (a connected persona is INVITED, then accepts),
// reads are gated per request, items are sealed at rest, rooms never appear in
// the address book, and no room item mints a fact.

import test from 'node:test';
import assert from 'node:assert/strict';
import { Moira } from '../src/index.js';
import { MemoryStore } from '../src/store.js';

function setup() {
  const store = new MemoryStore();
  const m = new Moira({ store });
  const a = m.createOwnerContext({ kind: 'owner_session', verified: true, ownerRef: 'owner-a' });
  const b = m.createOwnerContext({ kind: 'owner_session', verified: true, ownerRef: 'owner-b' });

  const workA = m.owner.createPersona(a, { name: 'alex-work', identity: 'pseudonymous' });
  const workB = m.owner.createPersona(b, { name: 'sam-work', identity: 'pseudonymous' });
  const stranger = m.owner.createPersona(a, { name: 'alex-offhours', identity: 'pseudonymous' });

  const inv = m.owner.connectionInvite(a, { personaId: workA.id, label: 'alex' });
  const conn = m.owner.connectionAccept(b, { code: inv.code, personaId: workB.id });

  return { m, store, a, b, workA, workB, stranger, conn };
}

test('a room starts with consent: the peer is invited, then accepts', () => {
  const { m, a, b, workA, workB, conn } = setup();
  const room = m.owner.roomCreate(a, { personaId: workA.id, name: 'atelier build', connectionId: conn.connectionId });
  assert.equal(room.outcome, 'results');
  assert.deepEqual(room.members.map((x) => x.state).sort(), ['active', 'invited'],
    'the owner is active; the peer is only invited, which is not a membership');

  const early = m.owner.roomTimeline(b, { roomId: room.roomId, personaId: workB.id });
  assert.equal(early.outcome, 'declined');
  assert.equal(early.reason, 'not_a_room_member', 'an invite grants nothing until accepted');

  const joined = m.owner.roomAccept(b, { roomId: room.roomId, personaId: workB.id });
  assert.equal(joined.outcome, 'results');
  assert.equal(joined.members.find((x) => x.personaId === workB.id).state, 'active');
});

test('items are sealed at rest and only members read them', () => {
  const { m, store, a, b, workA, workB, stranger, conn } = setup();
  const room = m.owner.roomCreate(a, { personaId: workA.id, name: 'atelier build', connectionId: conn.connectionId });
  m.owner.roomAccept(b, { roomId: room.roomId, personaId: workB.id });

  const posted = m.owner.roomPost(a, {
    roomId: room.roomId, personaId: workA.id, kind: 'decision',
    body: 'we ship the letterpress run on friday, no more plate changes'
  });
  assert.equal(posted.outcome, 'results');

  const seen = m.owner.roomTimeline(b, { roomId: room.roomId, personaId: workB.id });
  assert.equal(seen.outcome, 'results');
  assert.equal(seen.items.length, 1);
  assert.match(seen.items[0].body, /letterpress run/);

  const outsider = m.owner.roomTimeline(a, { roomId: room.roomId, personaId: stranger.id });
  assert.equal(outsider.reason, 'not_a_room_member', 'a persona that never joined reads nothing');

  const atRest = JSON.stringify([...store.list('roomItems', () => true, {})]);
  assert.equal(atRest.includes('plate changes'), false, 'the body is sealed, not stored in clear');
});

test('a room carries no judgement about the people in it', () => {
  const { m, a, b, workA, workB, conn } = setup();
  const nina = m.owner.peopleAdd(a, { name: 'nina' }).person;
  m.owner.peopleProfileSet(a, { personaId: workA.id, personId: nina.id, importance: 5, interaction: 0, circles: ['at the studio'] });

  const room = m.owner.roomCreate(a, { personaId: workA.id, name: 'atelier build', connectionId: conn.connectionId });
  m.owner.roomAccept(b, { roomId: room.roomId, personaId: workB.id });
  m.owner.roomPost(a, { roomId: room.roomId, personaId: workA.id, kind: 'note', body: 'plates arrive thursday' });

  const payload = JSON.stringify(m.owner.roomTimeline(b, { roomId: room.roomId, personaId: workB.id }));
  for (const leaked of ['importance', 'interaction', 'circles', 'note:', 'at the studio']) {
    assert.equal(payload.includes(leaked), false, `the room must not expose ${leaked}`);
  }
  // and a room is not a person
  assert.equal(m.owner.peopleAll(a).people.length, 1, 'rooms never join the address book');
});

test('leaving stops the room, and nothing can be unshared', () => {
  const { m, a, b, workA, workB, conn } = setup();
  const room = m.owner.roomCreate(a, { personaId: workA.id, name: 'atelier build', connectionId: conn.connectionId });
  m.owner.roomAccept(b, { roomId: room.roomId, personaId: workB.id });
  m.owner.roomPost(a, { roomId: room.roomId, personaId: workA.id, kind: 'note', body: 'first note' });

  const left = m.owner.roomLeave(b, { roomId: room.roomId, personaId: workB.id });
  assert.equal(left.outcome, 'results');
  assert.equal(left.leftAt > 0, true);

  m.owner.roomPost(a, { roomId: room.roomId, personaId: workA.id, kind: 'note', body: 'after you left' });
  const after = m.owner.roomTimeline(b, { roomId: room.roomId, personaId: workB.id });
  assert.equal(after.reason, 'not_a_room_member', 'a person who left is not a reader any more');

  // but what was read cannot be unread: moira says so rather than pretending
  const owner = m.owner.roomSummary(a, { roomId: room.roomId, personaId: workA.id });
  assert.equal(owner.items, 2, 'the history stays whole for the members who remain');
});

test('a room item is a shape, not prose: kind is declared, and nothing becomes a fact', () => {
  const { m, a, workA, conn } = setup();
  const room = m.owner.roomCreate(a, { personaId: workA.id, name: 'atelier build', connectionId: conn.connectionId });
  const factsBefore = m.facts.active(workA.id).length;

  const badKind = m.owner.roomPost(a, { roomId: room.roomId, personaId: workA.id, kind: 'gossip', body: 'x' });
  assert.equal(badKind.outcome, 'declined');
  assert.equal(badKind.reason, 'room_item_kind_invalid');

  const empty = m.owner.roomPost(a, { roomId: room.roomId, personaId: workA.id, kind: 'note', body: '   ' });
  assert.equal(empty.reason, 'room_item_body_required');

  m.owner.roomPost(a, { roomId: room.roomId, personaId: workA.id, kind: 'note', body: 'plates arrive thursday' });
  assert.equal(m.facts.active(workA.id).length, factsBefore, 'a room note is not a fact about anyone');

  const summary = m.owner.roomSummary(a, { roomId: room.roomId, personaId: workA.id });
  assert.deepEqual(Object.keys(summary).sort(), ['items', 'latestAt', 'members', 'outcome', 'roomId'], 'a summary counts, it does not narrate');
});
