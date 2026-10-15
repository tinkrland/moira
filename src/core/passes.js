// passes (spec sections 4, 9.1, 11).
//
// a pass is permission for one app/agent to read one category within one
// persona for one purpose and duration: (client, persona, category, purpose,
// duration). five dimensions; a pass never widens; revocation takes effect on
// the next read.
//
// passes grant READ, never write approval (section 9.3).

import { randomId } from '../util/crypto.js';
import { PASS_DURATION, OUTCOME } from '../model/constants.js';

export class PassService {
  constructor({ store, agents, receipts, now = Date.now }) {
    this.store = store;
    this.agents = agents;
    this.receipts = receipts;
    this.now = now;
  }

  // owner grants. connect codes and consent screens call into this after
  // owner authentication; agents can never reach it directly.
  grant({ clientId, personaId, category, purpose, duration = PASS_DURATION.PERMANENT, ttlMs = null, maxRung = 3, uses = null }) {
    const agent = this.agents.get(clientId);
    if (!agent) return { outcome: OUTCOME.UNAVAILABLE, reason: 'unknown_agent' };

    const pass = {
      id: randomId('pass'),
      clientId,
      personaId,
      category,
      purpose,
      duration,
      maxRung,
      usesLeft: duration === PASS_DURATION.ONE_TIME ? 1 : uses,
      createdAt: this.now(),
      expiresAt: duration === PASS_DURATION.PERMANENT ? null : this.now() + (ttlMs ?? 60 * 60 * 1000),
      revoked: false
    };
    this.store.put('passes', pass.id, pass);
    this.receipts.write({ actor: 'owner', personaId, op: 'pass_grant', categories: [category], reason: purpose });
    return { outcome: OUTCOME.RESULTS, pass };
  }

  // active pass for (client, persona, category, purpose). one_time passes are
  // consumed by the read itself (called by the gateway after a successful read).
  verify({ clientId, personaId, category, purpose }) {
    const now = this.now();
    const candidates = this.store
      .list('passes', (p) => p.clientId === clientId && p.personaId === personaId &&
        p.category === category && p.purpose === purpose && !p.revoked,
        { clientId, personaId, category, purpose })
      .filter((p) => (p.expiresAt === null || p.expiresAt > now) && (p.usesLeft === null || p.usesLeft > 0))
      .sort((a, b) => (b.maxRung - a.maxRung) || (b.createdAt - a.createdAt));
    return candidates[0] ?? null;
  }

  consume(passId) {
    return this.store.update('passes', passId, (p) => ({
      ...p,
      usesLeft: p.usesLeft === null ? null : p.usesLeft - 1
    }));
  }

  // revocation takes effect on the next read (section 16).
  revoke(passId) {
    const pass = this.store.update('passes', passId, (p) => ({ ...p, revoked: true }));
    if (pass) {
      this.receipts.write({ actor: 'owner', personaId: pass.personaId, op: 'pass_revoke', categories: [pass.category] });
    }
    return pass;
  }

  revokeAllForAgent(clientId) {
    const passes = this.store.list('passes', (p) => p.clientId === clientId && !p.revoked, { clientId });
    for (const p of passes) this.revoke(p.id);
    return passes.length;
  }

  listFor(clientId, personaId) {
    return this.store.list('passes', (p) => p.clientId === clientId && p.personaId === personaId && !p.revoked, { clientId, personaId });
  }
}
