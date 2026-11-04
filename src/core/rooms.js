// rooms: a shared memory that is not a shared persona.
//
// cresca's framing is "a group is a shared memory - it remembers things as one,
// like a person or a topic". the two properties that make that safe inside
// moira, and that every method here exists to keep:
//
//   1. NOTHING ENTERS A ROOM EXCEPT AN ITEM A MEMBER POSTED. a room does not
//      absorb a persona's facts, notes, circles, importance or interactions -
//      it has no read path into any of them. that is why a room payload is
//      small and closed: an item, who posted it, when.
//   2. MEMBERSHIP IS CONSENTED AND PER REQUEST. a connected persona is invited
//      and must accept; every read re-checks the membership row. leaving is
//      immediate for future items.
//
// what this cannot do, stated rather than implied: leaving stops the room, it
// does not unshare what was already read. the honest model of a shared memory is
// that history belongs to everyone who was there. so `leftAt` is recorded and
// the summary keeps counting for the members who remain, instead of pretending a
// retraction happened.
//
// items are sealed at rest with a key derived from the instance key and the room
// id. that protects the store, NOT the service: a service that can read a room
// can read it while it runs. per-member cryptography would be a bigger claim
// than this build makes, and a worse one to state loosely.

import { randomId, deriveKey, seal, open, canonicalJson } from '../util/crypto.js';
import { OUTCOME, RECEIPT_OP } from '../model/constants.js';

const ROOM_ITEM_KINDS = new Set(['note', 'link', 'decision', 'file']);
const SEAL_CTX = 'moira-room-v1';
const NAME_MAX = 80;
const BODY_MAX = 4000;

export class RoomService {
  constructor({ store, personas, people, keys, receipts, now = Date.now }) {
    this.store = store;
    this.personas = personas;
    this.people = people;
    this.keys = keys;
    this.receipts = receipts;
    this.now = now;
  }

  // --- rooms -----------------------------------------------------------------

  create({ personaId, name, connectionId = null }) {
    const clean = String(name ?? '').trim().replace(/\s+/g, ' ');
    if (!clean) return { outcome: OUTCOME.DECLINED, reason: 'room_name_required' };
    if (clean.length > NAME_MAX) return { outcome: OUTCOME.DECLINED, reason: 'room_name_too_long' };
    if (!this.personas.get(personaId)) return { outcome: OUTCOME.DECLINED, reason: 'persona_not_found' };

    const room = { id: randomId('rm'), name: clean, ownerPersonaId: personaId, createdAt: this.now() };
    this.store.put('rooms', room.id, room);
    this.store.put('roomMembers', `${room.id}:${personaId}`, {
      id: `${room.id}:${personaId}`, roomId: room.id, personaId, state: 'active', joinedAt: this.now(), leftAt: null
    });
    this.receipts.write({ actor: 'owner', personaId, op: RECEIPT_OP.PEOPLE, reason: 'room_created' });

    // a connection is a consented bridge between humans, not consent to join a
    // room - so the peer is INVITED and must accept. an invite grants nothing.
    if (connectionId) {
      const invite = this.invite({ roomId: room.id, personaId, connectionId });
      if (invite.outcome !== OUTCOME.RESULTS) return invite;
    }
    return { outcome: OUTCOME.RESULTS, roomId: room.id, name: room.name, members: this._members(room.id) };
  }

  invite({ roomId, personaId, connectionId }) {
    const room = this.store.get('rooms', roomId);
    if (!room) return { outcome: OUTCOME.UNAVAILABLE, reason: 'room_not_found' };
    if (!this._isActive(roomId, personaId)) return { outcome: OUTCOME.DECLINED, reason: 'not_a_room_member' };
    const conn = this.store.get('connections', connectionId);
    if (!conn) return { outcome: OUTCOME.UNAVAILABLE, reason: 'connection_not_found' };
    if (conn.state !== 'active') return { outcome: OUTCOME.DECLINED, reason: 'connection_revoked' };

    const peer = conn.sides.find((s) => s.personaId !== personaId);
    if (!peer) return { outcome: OUTCOME.DECLINED, reason: 'connection_has_no_peer' };
    const key = `${roomId}:${peer.personaId}`;
    if (this.store.get('roomMembers', key)) return { outcome: OUTCOME.DECLINED, reason: 'already_invited' };

    this.store.put('roomMembers', key, {
      id: key, roomId, personaId: peer.personaId, state: 'invited', invitedBy: personaId,
      invitedAt: this.now(), joinedAt: null, leftAt: null
    });
    this.receipts.write({ actor: 'owner', personaId, op: RECEIPT_OP.PEOPLE, reason: 'room_invited' });
    return { outcome: OUTCOME.RESULTS, roomId, members: this._members(roomId) };
  }

  accept({ roomId, personaId }) {
    const member = this.store.get('roomMembers', `${roomId}:${personaId}`);
    if (!member) return { outcome: OUTCOME.DECLINED, reason: 'no_such_invite' };
    if (member.state !== 'invited') return { outcome: OUTCOME.DECLINED, reason: `already_${member.state}` };
    this.store.update('roomMembers', member.id, (row) => ({ ...row, state: 'active', joinedAt: this.now() }));
    this.receipts.write({ actor: 'owner', personaId, op: RECEIPT_OP.PEOPLE, reason: 'room_joined' });
    return { outcome: OUTCOME.RESULTS, roomId, members: this._members(roomId) };
  }

  leave({ roomId, personaId }) {
    const member = this.store.get('roomMembers', `${roomId}:${personaId}`);
    if (!member) return { outcome: OUTCOME.DECLINED, reason: 'not_a_room_member' };
    if (member.state !== 'active') return { outcome: OUTCOME.DECLINED, reason: `already_${member.state}` };
    const leftAt = this.now();
    this.store.update('roomMembers', member.id, (row) => ({ ...row, state: 'left', leftAt }));
    this.receipts.write({ actor: 'owner', personaId, op: RECEIPT_OP.PEOPLE, reason: 'room_left' });
    // leftAt is the honest boundary: no unsharing, no pretend-retraction
    return { outcome: OUTCOME.RESULTS, roomId, leftAt };
  }

  // --- items ------------------------------------------------------------------

  post({ roomId, personaId, kind, body }) {
    const room = this.store.get('rooms', roomId);
    if (!room) return { outcome: OUTCOME.UNAVAILABLE, reason: 'room_not_found' };
    if (!this._isActive(roomId, personaId)) return { outcome: OUTCOME.DECLINED, reason: 'not_a_room_member' };
    if (!ROOM_ITEM_KINDS.has(kind)) return { outcome: OUTCOME.DECLINED, reason: 'room_item_kind_invalid' };
    const text = String(body ?? '').trim();
    if (!text) return { outcome: OUTCOME.DECLINED, reason: 'room_item_body_required' };
    if (text.length > BODY_MAX) return { outcome: OUTCOME.DECLINED, reason: 'room_item_body_too_long' };

    const item = {
      id: randomId('rmi'), roomId, personaId, kind, at: this.now(),
      sealed: seal(this._roomKey(roomId), text, `${SEAL_CTX}:${roomId}`)
    };
    this.store.put('roomItems', item.id, item);
    // content-free: the receipt says a room got an item, never what it said
    this.receipts.write({ actor: 'owner', personaId, op: RECEIPT_OP.PEOPLE, reason: `room_item:${kind}` });
    return { outcome: OUTCOME.RESULTS, itemId: item.id, at: item.at };
  }

  // membership is re-checked here, every time. a room read is not a cached right.
  timeline({ roomId, personaId }) {
    const room = this.store.get('rooms', roomId);
    if (!room) return { outcome: OUTCOME.UNAVAILABLE, reason: 'room_not_found' };
    const member = this.store.get('roomMembers', `${roomId}:${personaId}`);
    if (!member || member.state !== 'active') return { outcome: OUTCOME.DECLINED, reason: 'not_a_room_member' };

    const items = this.store.list('roomItems', (x) => x.roomId === roomId, { roomId })
      .sort((x, y) => x.at - y.at)
      .map((x) => ({
        itemId: x.id,
        kind: x.kind,
        from: x.personaId,
        at: x.at,
        body: open(this._roomKey(roomId), x.sealed, `${SEAL_CTX}:${roomId}`)
      }));
    // the payload is closed on purpose: an item, who posted it, when. no circles,
    // no importance, no notes, no address book. a room cannot become a side door
    // into what a persona privately thinks about the people in it.
    return { outcome: OUTCOME.RESULTS, roomId, items };
  }

  summary({ roomId, personaId }) {
    const room = this.store.get('rooms', roomId);
    if (!room) return { outcome: OUTCOME.UNAVAILABLE, reason: 'room_not_found' };
    if (!this._isActive(roomId, personaId)) return { outcome: OUTCOME.DECLINED, reason: 'not_a_room_member' };
    const items = this.store.list('roomItems', (x) => x.roomId === roomId, { roomId });
    return {
      outcome: OUTCOME.RESULTS,
      roomId,
      items: items.length,
      latestAt: items.length ? Math.max(...items.map((x) => x.at)) : null,
      members: this._members(roomId) // counts, not narration
    };
  }

  // --- internals --------------------------------------------------------------

  // sealed at rest, derived from the instance key so it survives a restart.
  // note what this is and is not: it protects the store, not a running service.
  _roomKey(roomId) {
    return deriveKey(this.keys.instanceKey, `room-domain:${roomId}`);
  }

  _isActive(roomId, personaId) {
    const member = this.store.get('roomMembers', `${roomId}:${personaId}`);
    return Boolean(member && member.state === 'active');
  }

  _members(roomId) {
    return this.store.list('roomMembers', (x) => x.roomId === roomId, { roomId })
      .map((x) => ({ personaId: x.personaId, state: x.state }));
  }
}
