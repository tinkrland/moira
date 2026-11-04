// rooms: the group-level brief and attendance (2026-11-04).
//
// two rules the tests exist to protect:
//   a count is not a name - attendance crosses as a number unless the owner
//   shares the person, and
//   a room still carries no judgement: no importance, no interaction, no
//   circles, even when people are attached to it.

import test from 'node:test';
import assert from 'node:assert/strict';
import { Moira } from '../src/index.js';
import { MemoryStore } from '../src/store.js';

function setup() {
  let t = 1_900_000_000_000;
  const m = new Moira({ store: new MemoryStore(), now: () => t });
  const a = m.createOwnerContext({ kind: 'owner_session', verified: true, ownerRef: 'owner-a' });
  const b = m.createOwnerContext({ kind: 'owner_session', verified: true, ownerRef: 'owner-b' });
  const workA = m.owner.createPersona(a, { name: 'alex-work', identity: 'pseudonymous' });
  const workB = m.owner.createPersona(b, { name: 'sam-work', identity: 'pseudonymous' });

  const inv = m.owner.connectionInvite(a, { personaId: workA.id, label: 'alex' });
  const acc = m.owner.connectionAccept(b, { code: inv.code, personaId: workB.id });

  const nina = m.owner.peopleAdd(a, { name: 'nina rao', handles: { email: 'nina@atelier.example' } }).person;
  const dave = m.owner.peopleAdd(a, { name: 'dave okafor' }).person;
  m.owner.peopleProfileSet(a, { personaId: workA.id, personId: nina.id, circles: ['work'], importance: 4, interaction: 5 });
  m.owner.peopleProfileSet(a, { personaId: workA.id, personId: dave.id, circles: ['work'], importance: 2, interaction: 1 });

  const room = m.owner.roomCreate(a, { personaId: workA.id, name: 'atlas build', connectionId: acc.connectionId });
  m.owner.roomAccept(b, { roomId: room.roomId, personaId: workB.id });
  return { m, a, b, workA, workB, nina, dave, roomId: room.roomId, clock: () => t, setT: (v) => { t = v; } };
}

test('the brief is counts and gaps, never a narrative', () => {
  const { m, a, workA, roomId } = setup();
  m.owner.roomPost(a, { roomId, personaId: workA.id, kind: 'note', body: 'schema settled on the flat table' });
  m.owner.roomPost(a, { roomId, personaId: workA.id, kind: 'decision', body: 'ship the read path first' });

  const brief = m.owner.roomBrief(a, { roomId, personaId: workA.id });
  assert.equal(brief.outcome, 'results');
  assert.equal(brief.items, 2);
  assert.deepEqual(brief.kinds, { note: 1, decision: 1 });
  assert.equal(brief.members.filter((x) => x.state === 'active').length, 2);
  assert.deepEqual(brief.unknown, ['no attendance recorded'], 'a gap is named, not narrated');
  assert.deepEqual(Object.keys(brief.participation), [], 'nobody attended yet');
});

test('attendance crosses as a count, not a name', () => {
  const { m, a, b, workA, workB, nina, dave, roomId } = setup();
  m.owner.roomAttend(a, { roomId, personaId: workA.id, personIds: [nina.id, dave.id] });

  const owner = m.owner.roomBrief(a, { roomId, personaId: workA.id });
  assert.equal(owner.attendance, 2, 'the owner sees how many');
  assert.deepEqual(owner.participation.map((p) => p.name).sort(), ['dave okafor', 'nina rao'], 'and who');

  const peer = m.owner.roomBrief(b, { roomId, personaId: workB.id });
  assert.equal(peer.attendance, 2, 'a member sees the count');
  assert.deepEqual(peer.participation, [], 'but not the names, because they were not shared');
  assert.deepEqual(peer.unknown.includes('attendance not shared'), true, 'and the brief says why they are missing');
});

test('sharing a participant shares a name and nothing else', () => {
  const { m, a, b, workA, workB, nina, roomId } = setup();
  m.owner.roomAttend(a, { roomId, personaId: workA.id, personIds: [nina.id], share: true });

  const peer = m.owner.roomBrief(b, { roomId, personaId: workB.id });
  assert.deepEqual(peer.participation.map((p) => p.name), ['nina rao']);
  const flat = JSON.stringify(peer);
  for (const forbidden of ['importance', 'interaction', 'circles', 'atelier.example']) {
    assert.equal(flat.includes(forbidden), false, `a shared name never carries ${forbidden}`);
  }
});

test('attendance needs membership and a profile this persona actually holds', () => {
  const { m, a, b, workA, workB, nina, roomId } = setup();
  const stranger = m.owner.createPersona(a, { name: 'alex-other', identity: 'pseudonymous' });

  const outsider = m.owner.roomAttend(a, { roomId, personaId: stranger.id, personIds: [nina.id] });
  assert.equal(outsider.outcome, 'declined');
  assert.equal(outsider.reason, 'not_a_room_member');

  const unknownPerson = m.owner.roomAttend(a, { roomId, personaId: workA.id, personIds: ['ppl_nope'] });
  assert.equal(unknownPerson.reason, 'person_not_in_this_persona');

  // and a member cannot put someone in a room the room's owner never profiled
  const peerTry = m.owner.roomAttend(b, { roomId, personaId: workB.id, personIds: [nina.id] });
  assert.equal(peerTry.reason, 'person_not_in_this_persona', 'sam has no profile for nina');
});

test('one person, many sightings: a single row that counts up', () => {
  const { m, a, workA, nina, roomId, setT } = setup();
  m.owner.roomAttend(a, { roomId, personaId: workA.id, personIds: [nina.id] });
  const first = m.owner.roomBrief(a, { roomId, personaId: workA.id }).participation[0];
  setT(first.lastAt + 86_400_000);
  m.owner.roomAttend(a, { roomId, personaId: workA.id, personIds: [nina.id] });

  const rows = m.owner.roomBrief(a, { roomId, personaId: workA.id }).participation;
  assert.equal(rows.length, 1, 'not two rows for one person');
  assert.equal(rows[0].count, 2);
  assert.equal(rows[0].firstAt, first.firstAt);
  assert.ok(rows[0].lastAt > first.lastAt);
});
