// context packs (spec section 7.2).
//
// a pack is how an agent gets context without a standing connection: a task
// brief, facts at chosen rungs, optional voice attachment, optional budget
// lease, ttl, reshare policy. signed and expiring. bound to one recipient
// agent and one persona. the recipient never gets the vault, only the pack.
//
// the pack is data, not instructions: consumers render it as quoted,
// trust-tagged content (that is the consumer's contract; we mark trust here).

import { randomId, signPayload, verifyPayloadSig } from '../util/crypto.js';
import { OUTCOME, RESHARE, PERSONA_STATUS } from '../model/constants.js';
import { serveRung, nameToRank } from './policy.js';

export class PackService {
  constructor({ store, personas, facts, receipts, keys, now = Date.now }) {
    this.store = store;
    this.personas = personas;
    this.facts = facts;
    this.receipts = receipts;
    this.keys = keys;
    this.now = now;
  }

  // issued by the owner (or by an agent under a standing rule; the facade
  // checks the standing rule before calling this).
  create({ personaId, recipientAgentId, brief, factSelections, ttlMs = 24 * 60 * 60 * 1000, reshare = RESHARE.NO_RESHARE, connectorGrants = [], leaseId = null, voiceAttachment = null }) {
    const persona = this.personas.get(personaId);
    if (!persona) return { outcome: OUTCOME.UNAVAILABLE, reason: 'persona_not_found' };

    if (persona.status === PERSONA_STATUS.FROZEN) return { outcome: OUTCOME.DECLINED, reason: 'persona_frozen' };

    const items = [];
    for (const sel of factSelections) {
      const fact = this.facts.get(personaId, sel.factId);
      if (!fact || fact.status !== 'active') {
        return { outcome: OUTCOME.DECLINED, reason: 'fact_not_active', factId: sel.factId };
      }
      // a pack selection is an explicit deal: if the fact cannot be served at
      // the chosen rung (its max_rung is lower), refuse rather than silently
      // downgrade the pack contents.
      if (nameToRank(sel.rung) > (fact.policy.maxRung ?? 4)) {
        return { outcome: OUTCOME.DECLINED, reason: 'rung_above_fact_max', factId: sel.factId };
      }
      const served = serveRung(fact, nameToRank(sel.rung));
      if (!served) return { outcome: OUTCOME.DECLINED, reason: 'rung_unavailable', factId: sel.factId };
      items.push({
        content: served.content,
        rung: served.rung,
        category: fact.category,
        preferenceBasis: fact.preferenceBasis ?? null,
        trust: 'quoted-data' // pack is data, not instructions
      });
    }

    let voice = null;
    if (voiceAttachment) {
      const vp = persona.voiceProfile;
      voice = {
        register: voiceAttachment.register ?? null,
        guidelines: vp?.guidelines ?? null,
        aiTells: vp?.aiTells ?? [],
        redLines: vp?.redLines ?? [],
        // exemplars are pass-gated and off by default (7.5); only the owner
        // attaches them, only with a ttl.
        exemplars: voiceAttachment.includeExemplars === true ? (vp?.exemplars ?? []) : []
      };
    }

    const pack = {
      id: randomId('pack'),
      personaId,
      recipientAgentId,
      brief,
      items,
      connectorGrants,
      leaseId,
      voice,
      ttlMs,
      reshare,
      hopsUsed: 0,
      createdAt: this.now(),
      status: 'active'
    };
    pack.signature = this._sign(pack);
    this.store.put('packs', pack.id, pack);

    this.receipts.write({
      actor: 'owner', personaId, op: 'pack',
      categories: items.map((i) => i.category), factCount: items.length,
      rung: items.length ? Math.max(...items.map((i) => nameToRank(i.rung))) : null,
      packId: pack.id, reason: reshare
    });
    return { outcome: OUTCOME.RESULTS, pack };
  }

  // the recipient redeems: recipient binding + status + ttl checked.
  redeem(packId, { agentId }) {
    const pack = this.store.get('packs', packId);
    if (!pack) return { outcome: OUTCOME.UNAVAILABLE, reason: 'pack_not_found' };
    if (pack.status !== 'active') return { outcome: OUTCOME.DECLINED, reason: `pack_${pack.status}` };
    if (pack.recipientAgentId !== agentId) return { outcome: OUTCOME.DECLINED, reason: 'not_pack_recipient' };
    if (pack.createdAt + pack.ttlMs < this.now()) {
      this.store.update('packs', packId, (p) => ({ ...p, status: 'expired' }));
      return { outcome: OUTCOME.EXPIRED, reason: 'pack_ttl' };
    }
    if (!this._verify(pack)) return { outcome: OUTCOME.LOCKED, reason: 'pack_signature_invalid' };

    this.receipts.write({ actor: agentId, personaId: pack.personaId, op: 'pack', packId: pack.id, reason: 'redeem' });
    return {
      outcome: OUTCOME.RESULTS,
      pack: {
        id: pack.id,
        brief: pack.brief,
        items: pack.items,
        voice: pack.voice,
        connectorGrants: pack.connectorGrants,
        leaseId: pack.leaseId,
        reshare: pack.reshare,
        expiresAt: pack.createdAt + pack.ttlMs
      }
    };
  }

  // handoff transfer (7.3): the pack stays bound to its holder (the sender);
  // the handoff record authorizes the receiver to receive the pack contents.
  // the receiver never gets the vault, and the pack is not rebound.
  redeemForHandoff(packId, { handoffId, receiverAgentId, holderAgentId }) {
    const pack = this.store.get('packs', packId);
    if (!pack) return { outcome: OUTCOME.UNAVAILABLE, reason: 'pack_not_found' };
    if (pack.status !== 'active') return { outcome: OUTCOME.DECLINED, reason: `pack_${pack.status}` };
    if (pack.recipientAgentId !== holderAgentId) {
      return { outcome: OUTCOME.DECLINED, reason: 'sender_does_not_hold_pack' };
    }
    if (pack.createdAt + pack.ttlMs < this.now()) {
      this.store.update('packs', packId, (p) => ({ ...p, status: 'expired' }));
      return { outcome: OUTCOME.EXPIRED, reason: 'pack_ttl' };
    }
    if (!this._verify(pack)) return { outcome: OUTCOME.LOCKED, reason: 'pack_signature_invalid' };
    this.receipts.write({ actor: receiverAgentId, personaId: pack.personaId, op: 'pack', packId: pack.id, handoffId, reason: 'handoff_delivery' });
    return {
      outcome: OUTCOME.RESULTS,
      pack: {
        id: pack.id,
        brief: pack.brief,
        items: pack.items,
        voice: pack.voice,
        connectorGrants: pack.connectorGrants,
        leaseId: null, // the handoff's budget lease is minted separately
        reshare: pack.reshare,
        expiresAt: pack.createdAt + pack.ttlMs
      }
    };
  }

  // revocation kills the pack and any attached budget lease on the next request.
  revoke(packId) {
    const pack = this.store.update('packs', packId, (p) => ({ ...p, status: 'revoked' }));
    if (pack) {
      this.receipts.write({ actor: 'owner', personaId: pack.personaId, op: 'pack', packId: pack.id, reason: 'revoked' });
    }
    return pack;
  }

  attachLease(packId, leaseId) {
    return this.store.update('packs', packId, (p) => ({ ...p, leaseId }));
  }

  _sign(pack) {
    const { signature, ...payload } = pack;
    return signPayload(this.keys.instanceKey, payload);
  }

  _verify(pack) {
    const { signature, ...payload } = pack;
    return verifyPayloadSig(this.keys.instanceKey, payload, signature);
  }
}
