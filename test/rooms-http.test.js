// rooms over the transport (2026-11-13).
//
// the room service was tested; its routes were not. they were also broken:
// every /api/rooms* handler referenced `owner` and `send`, neither of which
// exists in that scope, so the whole surface answered 500. these tests drive
// the routes a panel actually calls and pin the two things a room must not do:
// an invite grants no read, and a listing is counts, never judgement.

import test from 'node:test';
import assert from 'node:assert/strict';
import { Moira } from '../src/index.js';
import { MemoryStore } from '../src/store.js';
import { createOwnerSessionVerifier } from '../src/transport/ownersession.js';
import { createMoiraServer } from '../src/transport/server.js';

const SECRET = 'correct horse battery staple 42';

async function boot() {
  const m = new Moira({ store: new MemoryStore() });
  const a = m.createOwnerContext({ kind: 'owner_session', verified: true, ownerRef: 'owner-a' });
  const b = m.createOwnerContext({ kind: 'owner_session', verified: true, ownerRef: 'owner-b' });
  const workA = m.owner.createPersona(a, { name: 'alex-work', identity: 'pseudonymous' });
  const workB = m.owner.createPersona(b, { name: 'sam-work', identity: 'pseudonymous' });
  const stranger = m.owner.createPersona(a, { name: 'alex-private', identity: 'pseudonymous' });

  const inv = m.owner.connectionInvite(a, { personaId: workA.id, label: 'alex' });
  const acc = m.owner.connectionAccept(b, { code: inv.code, personaId: workB.id });

  const nina = m.owner.peopleAdd(a, { name: 'nina rao', handles: { email: 'nina@atelier.example' } }).person;
  const dave = m.owner.peopleAdd(a, { name: 'dave okafor' }).person;
  m.owner.peopleProfileSet(a, { personaId: workA.id, personId: nina.id, circles: ['work'], importance: 4, interaction: 5 });
  m.owner.peopleProfileSet(a, { personaId: workA.id, personId: dave.id, circles: ['work'], importance: 2, interaction: 1 });

  const verify = createOwnerSessionVerifier({ moira: m, secret: SECRET });
  const server = createMoiraServer({ moira: m, baseUrl: 'http://127.0.0.1:8080', tokenKey: 'ab'.repeat(32), getOwnerContext: verify, port: 0 });
  const bound = await server.listen();
  return {
    m, a, b, workA, workB, stranger, acc, nina, dave, verify,
    base: `http://127.0.0.1:${bound.port}`, server,
    owner: { 'content-type': 'application/json', 'x-moira-owner': SECRET }
  };
}

const post = (base, owner, path, body) => fetch(base + path, { method: 'POST', headers: owner, body: JSON.stringify(body) });

test('rooms: every route is owner-gated instead of throwing', async (t) => {
  const { base, server, workA, acc } = await boot();
  t.after(() => new Promise((r) => server.server.close(r)));

  const anon = { 'content-type': 'application/json' };
  const calls = [
    ['GET', `/api/rooms?personaId=${workA.id}`, null],
    ['GET', `/api/rooms/timeline?roomId=rm_x&personaId=${workA.id}`, null],
    ['GET', `/api/rooms/summary?roomId=rm_x&personaId=${workA.id}`, null],
    ['GET', `/api/rooms/brief?roomId=rm_x&personaId=${workA.id}`, null],
    ['POST', '/api/rooms', { personaId: workA.id, name: 'atlas build' }],
    ['POST', '/api/rooms/join', { roomId: 'rm_x', personaId: workA.id, connectionId: acc.connectionId }],
    ['POST', '/api/rooms/item', { roomId: 'rm_x', personaId: workA.id, kind: 'note', body: 'hi' }],
    ['POST', '/api/rooms/attend', { roomId: 'rm_x', personaId: workA.id, personIds: ['ppl_x'] }]
  ];
  for (const [method, path, body] of calls) {
    const res = method === 'GET'
      ? await fetch(base + path, { headers: anon })
      : await post(base, anon, path, body);
    assert.equal(res.status, 401, `${method} ${path.split('?')[0]} refuses an anonymous caller`);
    assert.equal((await res.json()).reason, 'owner_session_required');
  }
});

test('rooms: a room is created, read, posted to, and attended over http', async (t) => {
  const { base, server, owner, workA, workB, acc, nina, dave } = await boot();
  t.after(() => new Promise((r) => server.server.close(r)));

  const made = await post(base, owner, '/api/rooms', { personaId: workA.id, name: 'atlas build', connectionId: acc.connectionId });
  assert.equal(made.status, 200);
  const room = await made.json();
  assert.equal(room.outcome, 'results');
  assert.equal(room.name, 'atlas build');
  const roomId = room.roomId;

  // the peer accepts; before that the invite is visible but reads nothing
  const listed = await (await fetch(`${base}/api/rooms?personaId=${workB.id}`, { headers: owner })).json();
  assert.equal(listed.outcome, 'results');
  assert.equal(listed.rooms.length, 1);
  assert.equal(listed.rooms[0].state, 'invited');
  assert.equal(listed.rooms[0].items, null, 'an invite grants no item count');
  assert.equal(listed.rooms[0].memberCount, null, 'and no membership count');

  const before = await fetch(`${base}/api/rooms/timeline?roomId=${roomId}&personaId=${workB.id}`, { headers: owner });
  assert.equal(before.status, 400);
  assert.equal((await before.json()).reason, 'not_a_room_member', 'an invited persona cannot read');

  const joined = await post(base, owner, '/api/rooms/join', { roomId, personaId: workB.id });
  assert.equal(joined.status, 200);
  const listedNow = await (await fetch(`${base}/api/rooms?personaId=${workB.id}`, { headers: owner })).json();
  assert.equal(listedNow.rooms[0].state, 'active');
  assert.equal(listedNow.rooms[0].items, 0);

  const posted = await post(base, owner, '/api/rooms/item', { roomId, personaId: workA.id, kind: 'decision', body: 'ship the read path first' });
  assert.equal(posted.status, 200);
  assert.equal((await posted.json()).outcome, 'results');

  const tl = await (await fetch(`${base}/api/rooms/timeline?roomId=${roomId}&personaId=${workB.id}`, { headers: owner })).json();
  assert.equal(tl.items.length, 1);
  assert.equal(tl.items[0].body, 'ship the read path first');
  assert.equal(tl.items[0].kind, 'decision');

  const sum = await (await fetch(`${base}/api/rooms/summary?roomId=${roomId}&personaId=${workA.id}`, { headers: owner })).json();
  assert.equal(sum.items, 1);
  assert.deepEqual(sum.members.map((x) => x.state).sort(), ['active', 'active']);

  const attended = await post(base, owner, '/api/rooms/attend', { roomId, personaId: workA.id, personIds: [nina.id, dave.id] });
  assert.equal(attended.status, 200);

  const ownerBrief = await (await fetch(`${base}/api/rooms/brief?roomId=${roomId}&personaId=${workA.id}`, { headers: owner })).json();
  assert.equal(ownerBrief.attendance, 2);
  assert.deepEqual(ownerBrief.participation.map((p) => p.name).sort(), ['dave okafor', 'nina rao'], 'the room owner sees names');

  const peerBrief = await (await fetch(`${base}/api/rooms/brief?roomId=${roomId}&personaId=${workB.id}`, { headers: owner })).json();
  assert.equal(peerBrief.attendance, 2, 'a member sees the count');
  assert.deepEqual(peerBrief.participation, [], 'and not the names, because nobody shared them');
  assert.ok(peerBrief.unknown.includes('attendance not shared'));
  for (const forbidden of ['importance', 'interaction', 'circles', 'atelier.example']) {
    assert.equal(JSON.stringify(peerBrief).includes(forbidden), false, `a shared brief never carries ${forbidden}`);
  }
});

test('rooms: a stranger lists no rooms, and a declined act is not a success', async (t) => {
  const { base, server, owner, workA, stranger } = await boot();
  t.after(() => new Promise((r) => server.server.close(r)));

  const made = await (await post(base, owner, '/api/rooms', { personaId: workA.id, name: 'atlas build' })).json();
  const roomId = made.roomId;

  const mine = await (await fetch(`${base}/api/rooms?personaId=${workA.id}`, { headers: owner })).json();
  assert.equal(mine.rooms.length, 1);
  assert.equal(mine.rooms[0].state, 'active');
  assert.equal(mine.rooms[0].owner, true);
  assert.equal(mine.rooms[0].memberCount, 1);

  const other = await (await fetch(`${base}/api/rooms?personaId=${stranger.id}`, { headers: owner })).json();
  assert.deepEqual(other.rooms, [], 'a persona in no room lists none');

  const badKind = await post(base, owner, '/api/rooms/item', { roomId, personaId: workA.id, kind: 'gossip', body: 'x' });
  assert.equal(badKind.status, 400, 'an invalid item kind is a refusal, not a 200');
  assert.equal((await badKind.json()).reason, 'room_item_kind_invalid');

  const noRoom = await fetch(`${base}/api/rooms/timeline?roomId=rm_missing&personaId=${workA.id}`, { headers: owner });
  assert.equal(noRoom.status, 404);

  const noName = await post(base, owner, '/api/rooms', { personaId: workA.id, name: '  ' });
  assert.equal(noName.status, 400);

  const unknown = await fetch(`${base}/api/rooms?personaId=persona_missing`, { headers: owner });
  assert.equal(unknown.status, 404, 'an unknown persona is not an empty list');
});

test('rooms: an invite can be refused, and refusing is not joining', async (t) => {
  const { base, server, owner, workA, workB, acc } = await boot();
  t.after(() => new Promise((r) => server.server.close(r)));

  const room = await (await post(base, owner, '/api/rooms', { personaId: workA.id, name: 'atlas build', connectionId: acc.connectionId })).json();
  const declined = await post(base, owner, '/api/rooms/join', { roomId: room.roomId, personaId: workB.id, action: 'leave' });
  assert.equal(declined.status, 200);
  assert.equal((await declined.json()).outcome, 'results');

  const listed = await (await fetch(`${base}/api/rooms?personaId=${workB.id}`, { headers: owner })).json();
  assert.equal(listed.rooms[0].state, 'left', 'a refused invite is not pending');
  assert.equal(listed.rooms[0].items, null, 'and it still grants no read');

  const read = await fetch(`${base}/api/rooms/timeline?roomId=${room.roomId}&personaId=${workB.id}`, { headers: owner });
  assert.equal(read.status, 400);

  const again = await post(base, owner, '/api/rooms/join', { roomId: room.roomId, personaId: workB.id });
  assert.equal(again.status, 400, 'and it cannot be accepted afterwards');
  assert.equal((await again.json()).reason, 'already_left', 'the refusal is recorded, not forgotten');
});
