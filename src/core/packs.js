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
  create({ personaId, recipientAgentId, brief, factSelections, ttlMs = 24 * 60 * 60 * 1000, reshare = RESHARE.NO_RESHARE, hopLimit = 1, connectorGrants = [], leaseId = null, voiceAttachment = null }) {
    const persona = this.personas.get(personaId);
    if (!persona) return { outcome: OUTCOME.UNAVAILABLE, reason: 'persona_not_found' };

    if (persona.status === PERSONA_STATUS.FROZEN) return { outcome: OUTCOME.DECLINED, reason: 'persona_frozen' };
    // a hop limit with no number is the promise this service refuses to make:
    // either the count is real or the option is not offered
    if (reshare === RESHARE.HOP_LIMIT && (!Number.isInteger(hopLimit) || hopLimit < 1)) {
      return { outcome: OUTCOME.DECLINED, reason: 'hop_limit_invalid' };
    }

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
      // the count, stored once: hopsUsed is how far this copy has travelled,
      // hopLimit is how far the owner allowed it to go
      hopLimit: reshare === RESHARE.HOP_LIMIT ? hopLimit : 0,
      hopsUsed: 0,
      rootPackId: null, // null means "this pack is the root"
      parentPackId: null,
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

  // reshare: the hop limit is a count, so something must count it. a holder may
  // pass a pack forward only as far as the pack's own policy allows:
  //   no_reshare      -> refused, always
  //   hop_limit       -> re-issued with hopsUsed + 1, refused at the limit
  //   named_agents    -> refused: a recipient list is the owner's choice, and a
  //                      borrower cannot widen a grant by re-issuing it
  // the child is a NEW signed pack with the same contents, its own recipient
  // binding, and a recorded chain: revocation walks the chain.
  reshare({ packId, recipientAgentId, fromAgentId, ttlMs = null, brief = null }) {
    const pack = this.store.get('packs', packId);
    if (!pack) return { outcome: OUTCOME.UNAVAILABLE, reason: 'pack_not_found' };
    if (pack.status !== 'active') return { outcome: OUTCOME.DECLINED, reason: `pack_${pack.status}` };
    if (pack.reshare === RESHARE.NO_RESHARE) return { outcome: OUTCOME.DECLINED, reason: 'reshare_not_allowed' };
    if (pack.reshare !== RESHARE.HOP_LIMIT) return { outcome: OUTCOME.DECLINED, reason: 'reshare_needs_the_owner' };
    if (pack.recipientAgentId !== fromAgentId) return { outcome: OUTCOME.DECLINED, reason: 'not_pack_recipient' };
    if (!recipientAgentId) return { outcome: OUTCOME.DECLINED, reason: 'recipient_required' };
    if (pack.createdAt + pack.ttlMs < this.now()) {
      this.store.update('packs', packId, (x) => ({ ...x, status: 'expired' }));
      return { outcome: OUTCOME.EXPIRED, reason: 'pack_ttl' };
    }
    if (!this._verify(pack)) return { outcome: OUTCOME.LOCKED, reason: 'pack_signature_invalid' };

    const hopsUsed = (pack.hopsUsed ?? 0) + 1;
    const hopLimit = pack.hopLimit ?? 0;
    if (hopsUsed > hopLimit) return { outcome: OUTCOME.DECLINED, reason: 'hop_limit_reached', hopLimit, hopsUsed: hopsUsed - 1 };

    const child = {
      id: randomId('pack'),
      personaId: pack.personaId,
      recipientAgentId,
      brief: brief ? String(brief).slice(0, 2000) : pack.brief,
      // the contents are copied, not re-derived: a hop is not a new selection
      items: pack.items,
      connectorGrants: pack.connectorGrants,
      leaseId: null, // a budget lease is not passed on with the pack
      voice: pack.voice,
      // a reshared pack never outlives the pack it came from
      ttlMs: Math.min(Number.isFinite(ttlMs) ? ttlMs : pack.ttlMs, Math.max(0, pack.createdAt + pack.ttlMs - this.now())),
      reshare: pack.reshare,
      hopLimit,
      hopsUsed,
      rootPackId: pack.rootPackId ?? pack.id,
      parentPackId: pack.id,
      createdAt: this.now(),
      status: 'active'
    };
    child.signature = this._sign(child);
    this.store.put('packs', child.id, child);

    this.receipts.write({
      actor: fromAgentId, personaId: pack.personaId, op: 'pack',
      categories: child.items.map((i) => i.category), factCount: child.items.length,
      packId: child.id, reason: `reshare:hop_${hopsUsed}_of_${hopLimit}`
    });
    return { outcome: OUTCOME.RESULTS, pack: child };
  }

  // revocation kills the pack and any attached budget lease on the next request.
  // revocation kills the pack, any pack reshared from it, and its lease - a
  // consent that survives its own withdrawal is not consent.
  revoke(packId) {
    const pack = this.store.update('packs', packId, (p) => ({ ...p, status: 'revoked' }));
    if (!pack) return pack;
    this.receipts.write({ actor: 'owner', personaId: pack.personaId, op: 'pack', packId: pack.id, reason: 'revoked' });

    for (const child of this.store.list('packs', (x) => x.rootPackId === pack.id && x.status === 'active', {})) {
      this.store.update('packs', child.id, (p) => ({ ...p, status: 'revoked' }));
      this.receipts.write({ actor: 'owner', personaId: pack.personaId, op: 'pack', packId: child.id, reason: `revoked_with_root:${pack.id}` });
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
