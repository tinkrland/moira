// person-to-person connections: the social half, built as an authorization flow.
//
// an invite is a bearer secret with a short life. redeeming it creates a link
// between two (owner, persona) pairs - not between two address books, not
// between two people's whole identity. what crosses the link is what someone
// sends, one delivery at a time, sealed to the recipient persona's key.
//
// deliberately absent: any notion of "friend", "follow", or shared graph. a
// connection is a channel. everything social is built on top by agreement, and
// anything not sent has not crossed.

import { createHmac, randomBytes } from 'node:crypto';
import { randomId, seal, open } from '../util/crypto.js';
import { OUTCOME, RECEIPT_OP } from '../model/constants.js';

const SEAL_CTX = 'moira.connect.v1';
const CODE_SALT = 'moira.connect.invite.v1';
const DEFAULT_TTL_MS = 7 * 24 * 3600 * 1000;
const ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789'; // no 0/o/1/l/i to read aloud

// a code a person can say out loud, hashed the moment it exists
function mintCode() {
  const bytes = randomBytes(8);
  const chars = [...bytes].map((b) => ALPHABET[b % ALPHABET.length]);
  return `${chars.slice(0, 4).join('')}-${chars.slice(4, 8).join('')}`;
}

const normalizeCode = (code) => (typeof code === 'string' ? code.trim().toLowerCase().replace(/[\s-]/g, '') : '');
const hashCode = (code) => createHmac('sha256', CODE_SALT).update(normalizeCode(code)).digest('hex');

export class ConnectionService {
  constructor({ store, personas, keys, receipts, now = Date.now }) {
    this.store = store;
    this.personas = personas;
    this.keys = keys;
    this.receipts = receipts;
    this.now = now;
  }

  // --- owner side ------------------------------------------------------------

  // label is optional and it is the ONLY thing the recipient learns about the
  // inviter. nothing is inferred from the persona record.
  invite(ctx, { personaId, label = null, ttlMs = DEFAULT_TTL_MS } = {}) {
    if (!this._owner(ctx)) return { outcome: OUTCOME.DECLINED, reason: 'owner_context_required' };
    const persona = this.personas.get(personaId);
    if (!persona) return { outcome: OUTCOME.UNAVAILABLE, reason: 'persona_not_found' };
    if (!this._mine(ctx, personaId)) return { outcome: OUTCOME.DECLINED, reason: 'not_your_persona' };
    // a frozen persona is not a face you can introduce
    if (persona.status === 'frozen') return { outcome: OUTCOME.DECLINED, reason: 'persona_not_active' };
    const cleanLabel = typeof label === 'string' && label.trim() ? label.trim().slice(0, 80) : null;
    const ttl = Number.isFinite(ttlMs) && ttlMs > 0 ? ttlMs : DEFAULT_TTL_MS;

    const code = mintCode();
    const record = {
      id: randomId('inv'),
      ownerRef: ctx.ownerRef,
      personaId,
      label: cleanLabel,
      codeHash: hashCode(code),
      createdAt: this.now(),
      expiresAt: this.now() + ttl,
      consumedBy: null,
      revoked: false
    };
    this.store.put('connectionInvites', record.id, record);
    this.receipts.write({ actor: 'owner', personaId, op: RECEIPT_OP.BRIDGE, reason: 'invite_minted' });
    // the code is returned exactly once, and it is not stored in this shape
    return { outcome: OUTCOME.RESULTS, inviteId: record.id, code, expiresAt: record.expiresAt };
  }

  // one code, one use, one persona. unknown / expired / spent all refuse the
  // same way: a distinguishable refusal is a code-guessing oracle.
  accept(ctx, { code, personaId } = {}) {
    if (!this._owner(ctx)) return { outcome: OUTCOME.DECLINED, reason: 'owner_context_required' };
    const persona = this.personas.get(personaId);
    if (!persona) return { outcome: OUTCOME.UNAVAILABLE, reason: 'persona_not_found' };
    if (!this._mine(ctx, personaId)) return { outcome: OUTCOME.DECLINED, reason: 'not_your_persona' };
    const unusable = { outcome: OUTCOME.DECLINED, reason: 'invite_unusable' };

    const hash = hashCode(code);
    const invite = this.store.list('connectionInvites', (i) => i.codeHash === hash, {})[0];
    if (!invite) return unusable;
    if (invite.revoked) return unusable;
    if (invite.consumedBy) return unusable;
    if (invite.expiresAt <= this.now()) return unusable;
    if (invite.personaId === personaId) return unusable;
    // one owner cannot link a persona to its own sibling: that is not a
    // connection between two people, it is an alias
    if (invite.ownerRef === ctx.ownerRef) return { outcome: OUTCOME.DECLINED, reason: 'same_owner' };

    const connection = {
      id: randomId('cnx'),
      sides: [
        { ownerRef: invite.ownerRef, personaId: invite.personaId, label: invite.label },
        { ownerRef: ctx.ownerRef, personaId, label: null }
      ],
      createdAt: this.now(),
      state: 'active'
    };
    this.store.put('connections', connection.id, connection);
    this.store.update('connectionInvites', invite.id, (i) => ({ ...i, consumedBy: personaId, consumedAt: this.now() }));

    this.receipts.write({ actor: 'owner', personaId: invite.personaId, op: RECEIPT_OP.BRIDGE, reason: 'connection_formed' });
    this.receipts.write({ actor: 'owner', personaId, op: RECEIPT_OP.BRIDGE, reason: 'connection_formed' });

    return {
      outcome: OUTCOME.RESULTS,
      connectionId: connection.id,
      // the peer is described by what the invite offered, nothing more
      peer: { label: invite.label ?? null }
    };
  }

  connections(ctx, { personaId } = {}) {
    if (!this._owner(ctx)) return { outcome: OUTCOME.DECLINED, reason: 'owner_context_required' };
    if (!this._mine(ctx, personaId)) return { outcome: OUTCOME.DECLINED, reason: 'not_your_persona' };
    const connections = this.store.list('connections',
      (c) => c.sides.some((s) => s.personaId === personaId), {})
      .map((c) => {
        const mine = c.sides.find((s) => s.personaId === personaId);
        const peer = c.sides.find((s) => s.personaId !== personaId) ?? null;
        return {
          id: c.id, state: c.state, createdAt: c.createdAt,
          peer: { label: peer?.label ?? null },
          unread: this.store.list('connectionDeliveries',
            (d) => d.connectionId === c.id && d.toPersonaId === personaId && !d.openedAt && !d.cancelled, {}).length
        };
      });
    return { outcome: OUTCOME.RESULTS, personaId, connections };
  }

  // a share is a discrete act: one payload, sealed to the recipient's persona
  // key, openable once, cancellable by any revocation.
  share(ctx, { connectionId, personaId, kind = 'note', payload } = {}) {
    if (!this._owner(ctx)) return { outcome: OUTCOME.DECLINED, reason: 'owner_context_required' };
    const c = this.store.get('connections', connectionId);
    if (!c) return { outcome: OUTCOME.UNAVAILABLE, reason: 'connection_not_found' };
    if (!c.sides.some((s) => s.personaId === personaId)) return { outcome: OUTCOME.DECLINED, reason: 'not_a_side_of_this_connection' };
    if (c.state !== 'active') return { outcome: OUTCOME.DECLINED, reason: 'connection_revoked' };
    if (!payload || typeof payload !== 'object') return { outcome: OUTCOME.DECLINED, reason: 'payload_required' };
    const to = c.sides.find((s) => s.personaId !== personaId);
    if (!to) return { outcome: OUTCOME.DECLINED, reason: 'connection_incomplete' };

    const delivery = {
      id: randomId('dlv'),
      connectionId,
      fromPersonaId: personaId,
      toPersonaId: to.personaId,
      kind: String(kind).slice(0, 40),
      sealed: seal(this.keys.personaKey(to.personaId), JSON.stringify(payload), `${SEAL_CTX}:${connectionId}`),
      createdAt: this.now(),
      openedAt: null,
      cancelled: false
    };
    this.store.put('connectionDeliveries', delivery.id, delivery);
    this.receipts.write({ actor: 'owner', personaId, op: RECEIPT_OP.DISCLOSURE, reason: `connection_send:${delivery.kind}` });
    return { outcome: OUTCOME.RESULTS, deliveryId: delivery.id };
  }

  inbox(ctx, { personaId } = {}) {
    if (!this._owner(ctx)) return { outcome: OUTCOME.DECLINED, reason: 'owner_context_required' };
    if (!this._mine(ctx, personaId)) return { outcome: OUTCOME.DECLINED, reason: 'not_your_persona' };
    const deliveries = this.store.list('connectionDeliveries',
      (d) => d.toPersonaId === personaId && !d.openedAt && !d.cancelled, {})
      .map((d) => {
        const c = this.store.get('connections', d.connectionId);
        const peer = c?.sides.find((s) => s.personaId === d.fromPersonaId);
        return {
          id: d.id, connectionId: d.connectionId, kind: d.kind, at: d.createdAt,
          from: { label: peer?.label ?? null }
        };
      });
    // envelopes only: no payload leaves this call
    return { outcome: OUTCOME.RESULTS, personaId, deliveries };
  }

  open(ctx, { personaId, deliveryId } = {}) {
    if (!this._owner(ctx)) return { outcome: OUTCOME.DECLINED, reason: 'owner_context_required' };
    const d = this.store.get('connectionDeliveries', deliveryId);
    if (!d || d.toPersonaId !== personaId) return { outcome: OUTCOME.UNAVAILABLE, reason: 'delivery_not_found' };
    if (!this._mine(ctx, personaId)) return { outcome: OUTCOME.DECLINED, reason: 'not_your_persona' };
    if (d.cancelled) return { outcome: OUTCOME.DECLINED, reason: 'connection_revoked' };
    if (d.openedAt) return { outcome: OUTCOME.UNAVAILABLE, reason: 'already_opened' };
    const c = this.store.get('connections', d.connectionId);
    if (c?.state !== 'active') return { outcome: OUTCOME.DECLINED, reason: 'connection_revoked' };

    let payload;
    try {
      payload = JSON.parse(open(this.keys.personaKey(personaId), d.sealed, `${SEAL_CTX}:${d.connectionId}`));
    } catch {
      return { outcome: OUTCOME.DECLINED, reason: 'delivery_unseal_failed' };
    }
    this.store.update('connectionDeliveries', deliveryId, (x) => ({ ...x, openedAt: this.now() }));
    this.receipts.write({ actor: 'owner', personaId, op: RECEIPT_OP.DISCLOSURE, reason: `connection_open:${d.kind}` });
    return { outcome: OUTCOME.RESULTS, kind: d.kind, payload };
  }

  // either side, no negotiation
  revoke(ctx, { connectionId, personaId } = {}) {
    if (!this._owner(ctx)) return { outcome: OUTCOME.DECLINED, reason: 'owner_context_required' };
    const c = this.store.get('connections', connectionId);
    if (!c) return { outcome: OUTCOME.UNAVAILABLE, reason: 'connection_not_found' };
    if (!c.sides.some((s) => s.personaId === personaId)) return { outcome: OUTCOME.DECLINED, reason: 'not_a_side_of_this_connection' };
    if (c.state === 'revoked') return { outcome: OUTCOME.RESULTS, connectionId, state: 'revoked' };

    this.store.update('connections', connectionId, (r) => ({ ...r, state: 'revoked', revokedAt: this.now(), revokedBy: personaId }));
    // consent withdrawn is not consent pending: unopened deliveries die here
    for (const d of this.store.list('connectionDeliveries',
      (x) => x.connectionId === connectionId && !x.openedAt && !x.cancelled, {})) {
      this.store.update('connectionDeliveries', d.id, (x) => ({ ...x, cancelled: true }));
    }
    for (const side of c.sides) {
      this.receipts.write({ actor: 'owner', personaId: side.personaId, op: RECEIPT_OP.BRIDGE, reason: 'connection_revoked' });
    }
    return { outcome: OUTCOME.RESULTS, connectionId, state: 'revoked' };
  }

  // --- internals -------------------------------------------------------------

  _owner(ctx) {
    return !!ctx && ctx.kind === 'owner_context' && typeof ctx.ownerRef === 'string';
  }

  // HONEST LIMIT: personas today belong to the instance, not to a person - every
  // record says ownerRef 'owner'. so this can only refuse a persona that records
  // a *different* explicit owner, and the real boundary for a connection is the
  // ownerRef on the invite, checked in accept(). connecting two humans who share
  // one instance is what the same_owner guard refuses; connecting two humans on
  // two instances is what a code is for.
  _mine(ctx, personaId) {
    const persona = this.personas.get(personaId);
    if (!persona) return false;
    if (!persona.ownerRef || persona.ownerRef === 'owner') return true;
    return persona.ownerRef === ctx.ownerRef;
  }
}
