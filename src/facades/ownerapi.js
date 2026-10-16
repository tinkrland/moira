// owner surface (spec sections 6, 16, 17, 11, 22.4).
//
// every method takes an OwnerContext capability minted by
// moira.createOwnerContext(verifiedOwnerSession) as its first argument. a
// plain object (for example { owner: true }) is rejected: authority is an
// unforgeable instance, not a flag. the agent surface (agentapi.js) has no
// way to reach these methods.

import { OwnerContext } from './ownercontext.js';
import { OUTCOME, VOICE_CATEGORY } from '../model/constants.js';
import { randomId } from '../util/crypto.js';

export class OwnerApi {
  constructor(gateway) {
    this.gw = gateway;
  }

  _require(ctx) {
    if (!(ctx instanceof OwnerContext)) {
      throw new Error('owner methods require an OwnerContext minted by moira.createOwnerContext(verifiedOwnerSession)');
    }
    return ctx;
  }

  createPersona(ctx, spec) {
    this._require(ctx);
    return this.gw.personas.create(spec);
  }

  registerAgent(ctx, spec) {
    this._require(ctx);
    return this.gw.agents.register(spec);
  }

  // consent screen: explicit persona choice at grant time (section 17).
  createSession(ctx, { clientId, personaId }) {
    this._require(ctx);
    return this.gw.sessions.create({ clientId, personaId });
  }

  grantPass(ctx, spec) {
    this._require(ctx);
    const agent = this.gw.agents.get(spec.clientId);
    const res = this.gw.passes.grant(spec);
    // tier gating (7.1): unverified agents cannot be offered sensitive categories.
    if (res.outcome === OUTCOME.RESULTS && agent && agent.tier === 'unverified') {
      const blocked = [VOICE_CATEGORY, 'health', 'legal', 'finance'];
      if (blocked.includes(spec.category)) {
        this.gw.passes.revoke(res.pass.id);
        return { outcome: OUTCOME.DECLINED, reason: 'tier_gated_category' };
      }
    }
    return res;
  }

  revokePass(ctx, passId) {
    this._require(ctx);
    return { outcome: OUTCOME.RESULTS, pass: this.gw.passes.revoke(passId) };
  }

  createBridge(ctx, spec) {
    this._require(ctx);
    return this.gw.bridges.create(spec);
  }

  allowIngress(ctx, personaId, srcPersonaId) {
    this._require(ctx);
    const persona = this.gw.personas.get(personaId);
    if (!persona) return { outcome: OUTCOME.UNAVAILABLE, reason: 'persona_not_found' };
    this.gw.personas.update(personaId, {
      ingress: {
        ...persona.ingress,
        acceptFrom: [...new Set([...(persona.ingress.acceptFrom ?? []), srcPersonaId])]
      }
    });
    return { outcome: OUTCOME.RESULTS };
  }

  approveProposal(ctx, factId) {
    this._require(ctx);
    const fact = this.gw.facts.approve(factId);
    if (!fact) return { outcome: OUTCOME.UNAVAILABLE, reason: 'proposal_not_found' };
    this.gw.receipts.write({ actor: 'owner', personaId: fact.personaId, op: 'approve', categories: [fact.category], factCount: 1 });
    return { outcome: OUTCOME.RESULTS, fact };
  }

  rejectProposal(ctx, factId) {
    this._require(ctx);
    const fact = this.gw.facts.reject(factId);
    if (!fact) return { outcome: OUTCOME.UNAVAILABLE, reason: 'proposal_not_found' };
    this.gw.receipts.write({ actor: 'owner', personaId: fact.personaId, op: 'propose', categories: [fact.category], reason: 'rejected' });
    return { outcome: OUTCOME.RESULTS };
  }

  // owner approves a pending handoff out of band (7.3 step 3).
  approveHandoff(ctx, handoffId) {
    this._require(ctx);
    const h = this.gw.handoffs.approve(handoffId);
    if (!h) return { outcome: OUTCOME.UNAVAILABLE, reason: 'handoff_not_found' };
    this.gw.receipts.write({ actor: 'owner', personaId: h.personaId, op: 'handoff', handoffId: h.id, reason: 'owner_approved' });
    return { outcome: OUTCOME.RESULTS, handoff: h };
  }

  addAccount(ctx, personaId, spec) {
    this._require(ctx);
    return this.gw.ledger.add(personaId, spec);
  }

  killSwitch(ctx, personaId) {
    this._require(ctx);
    const frozen = this.gw.router.killSwitch(personaId);
    return { outcome: OUTCOME.RESULTS, frozenLeases: frozen };
  }

  // owner-minted one-time connect codes (section 11).
  mintConnectCode(ctx, { personaId, ttlMs = 10 * 60 * 1000 }) {
    this._require(ctx);
    const code = {
      id: randomId('code'),
      code: randomId('cc'),
      personaId,
      expiresAt: this.gw.now() + ttlMs,
      used: false
    };
    this.gw.store.put('connectCodes', code.id, code);
    return { outcome: OUTCOME.RESULTS, code: code.code, expiresAt: code.expiresAt };
  }

  approveConnect(ctx, pendingId) {
    this._require(ctx);
    const pending = this.gw.store.get('pendingConnects', pendingId);
    if (!pending) return { outcome: OUTCOME.UNAVAILABLE, reason: 'pending_not_found' };
    this.gw.store.del('pendingConnects', pendingId);
    this.gw.agents.update(pending.agentId, (a) => ({ ...a, personasAllowed: [...new Set([...a.personasAllowed, pending.personaId])] }));
    const created = this.gw.sessions.create({ clientId: pending.agentId, personaId: pending.personaId });
    this.gw.receipts.write({ actor: 'owner', personaId: pending.personaId, op: 'session', reason: 'connect_code_approved' });
    return created;
  }

  // device flow (rfc 8628): the owner sees the user_code (on the device
  // verification screen), chooses which persona the device may bind to, and
  // approves or denies. the auth server's token endpoint completes the grant.
  approveDeviceCode(ctx, { userCode, personaId }) {
    this._require(ctx);
    const rec = this.gw.store.list('pendingConnects', (p) => p.kind === 'device_flow' && p.userCode === userCode, {})[0];
    if (!rec) return { outcome: OUTCOME.UNAVAILABLE, reason: 'device_code_not_found' };
    if (rec.expiresAt < this.gw.now()) return { outcome: OUTCOME.EXPIRED, reason: 'device_code_expired' };
    if (rec.status !== 'pending') return { outcome: OUTCOME.DECLINED, reason: 'device_code_not_pending' };
    const agent = this.gw.agents.get(rec.clientId);
    if (!agent || agent.revoked) return { outcome: OUTCOME.DECLINED, reason: 'unknown_or_revoked_agent' };
    if (agent.personasAllowed.length > 0 && !agent.personasAllowed.includes(personaId)) {
      return { outcome: OUTCOME.DECLINED, reason: 'persona_not_allowed_for_agent' };
    }
    this.gw.store.update('pendingConnects', rec.id, (p) => ({ ...p, status: 'approved', personaId }));
    this.gw.receipts.write({ actor: 'owner', personaId, op: 'session', reason: 'device_code_approved' });
    return { outcome: OUTCOME.RESULTS, userCode };
  }

  denyDeviceCode(ctx, { userCode }) {
    this._require(ctx);
    const rec = this.gw.store.list('pendingConnects', (p) => p.kind === 'device_flow' && p.userCode === userCode, {})[0];
    if (!rec) return { outcome: OUTCOME.UNAVAILABLE, reason: 'device_code_not_found' };
    if (rec.status !== 'pending') return { outcome: OUTCOME.DECLINED, reason: 'device_code_not_pending' };
    this.gw.store.update('pendingConnects', rec.id, (p) => ({ ...p, status: 'denied' }));
    this.gw.receipts.write({ actor: 'owner', personaId: null, op: 'session', reason: 'device_code_denied' });
    return { outcome: OUTCOME.RESULTS, userCode };
  }

  // owner approves a directed disclosure: attestation delivered at most once.
  approveDisclosure(ctx, disclosureId) {
    this._require(ctx);
    const d = this.gw.store.get('disclosures', disclosureId);
    if (!d || d.status !== 'pending') return { outcome: OUTCOME.UNAVAILABLE, reason: 'disclosure_not_found_or_used' };
    const attestation = {
      personaId: d.personaId,
      sub: this.gw.personas.sub(d.personaId, d.clientId),
      fields: d.fields,
      destination: d.destination,
      purpose: d.purpose,
      deliveredOnce: true,
      nonce: randomId('nonce'),
      ts: this.gw.now()
    };
    attestation.signature = this.gw.keys.signReceipt(attestation);
    this.gw.store.update('disclosures', disclosureId, (x) => ({ ...x, status: 'delivered' }));
    this.gw.receipts.write({ actor: 'owner', personaId: d.personaId, op: 'disclosure', reason: 'delivered_once' });
    return { outcome: OUTCOME.RESULTS, attestation };
  }

  // owner declares that shared evidence between two personas is intentional
  // (section 22.4): the monitor then skips that pair.
  declareLinkageIntention(ctx, { personaIds, note = null }) {
    this._require(ctx);
    if (!Array.isArray(personaIds) || personaIds.length < 2) {
      return { outcome: OUTCOME.DECLINED, reason: 'need_two_persona_ids' };
    }
    const key = [...personaIds].sort().join('|');
    this.gw.store.put('linkageDeclarations', key, {
      id: key,
      personaIds: [...new Set(personaIds)],
      note,
      declaredAt: this.gw.now()
    });
    return { outcome: OUTCOME.RESULTS };
  }

  // delete persona (section 16): key shredding, severed bridges, packs, leases,
  // disconnected accounts, receipt stubs. ciphertext becomes unreadable.
  deletePersona(ctx, personaId) {
    this._require(ctx);
    const persona = this.gw.personas.get(personaId);
    if (!persona) return { outcome: OUTCOME.UNAVAILABLE, reason: 'persona_not_found' };
    for (const b of this.gw.store.list('bridges', (x) => !x.revoked && (x.src === personaId || x.dst === personaId))) {
      this.gw.bridges.revoke(b.id);
    }
    for (const p of this.gw.store.list('packs', (x) => x.personaId === personaId && x.status === 'active', { personaId, status: 'active' })) {
      this.gw.packs.revoke(p.id);
    }
    for (const l of this.gw.store.list('leases', (x) => x.personaId === personaId && x.status === 'active', { personaId, status: 'active' })) {
      this.gw.router.revokeLease(l.id);
    }
    for (const h of this.gw.store.list('handoffs', (x) => x.personaId === personaId, { personaId })) {
      this.gw.handoffs.cancel(h.id, { ownerCancel: true });
    }
    for (const f of this.gw.store.list('facts', (x) => x.personaId === personaId, { personaId })) {
      this.gw.facts.deleteHard(f.id);
    }
    for (const a of this.gw.store.list('accounts', (x) => x.personaId === personaId, { personaId })) {
      this.gw.store.del('accounts', a.id); // ledger secrets destroyed
    }
    this.gw.personas.remove(personaId);
    this.gw.keys.shredPersona(personaId);
    const stubs = this.gw.receipts.stubPersona(personaId);
    return { outcome: OUTCOME.RESULTS, shredded: true, receiptStubs: stubs };
  }

  exportPersona(ctx, personaId) {
    this._require(ctx);
    const persona = this.gw.personas.get(personaId);
    if (!persona) return { outcome: OUTCOME.UNAVAILABLE, reason: 'persona_not_found' };
    return {
      outcome: OUTCOME.RESULTS,
      persona: { name: persona.name, identity: persona.identity, storage: persona.storage },
      facts: this.gw.facts.exportPersona(personaId),
      accounts: this.gw.ledger.list(personaId),
      receipts: this.gw.receipts.query({ personaId })
    };
  }

  // v1 decoupling monitor (section 22.4): pure owner-side function over keyed
  // hashes the owner's device computed. findings are not facts, are never
  // synced, and never reach agents. no finding does not mean safe (22.7).
  monitorScan(ctx, { linkageHashes }) {
    this._require(ctx);
    // linkageHashes: [{ personaId, kind, hash, specificity }]
    const byHash = new Map();
    for (const item of linkageHashes) {
      if (!byHash.has(item.hash)) byHash.set(item.hash, []);
      byHash.get(item.hash).push(item);
    }
    const findings = [];
    for (const [hash, items] of byHash) {
      const personaIds = [...new Set(items.map((i) => i.personaId))];
      if (personaIds.length < 2) continue;

      // which of the sharing personas are decoupled kinds? a link between a
      // linked persona and a decoupled one breaks the decoupling; linked<->linked
      // sharing is intended and never flagged.
      const decoupled = personaIds.filter((id) => {
        const persona = this.gw.personas.get(id);
        return persona && (persona.identity === 'pseudonymous' || persona.identity === 'heteronymous');
      });
      if (decoupled.length === 0) continue;

      // pairs the owner marked declared_intentional are skipped entirely.
      const undeclared = [];
      for (const id of personaIds) {
        if (id === decoupled[0]) continue;
        const key = [decoupled[0], id].sort().join('|');
        const declared = this.gw.store.get('linkageDeclarations', key);
        if (!declared) undeclared.push(id);
      }
      if (undeclared.length === 0) continue;

      const unique = items.some((i) => i.specificity === 'unique');
      findings.push({
        kind: unique ? 'hard' : 'soft',
        personas: [decoupled[0], ...undeclared],
        evidenceKinds: [...new Set(items.map((i) => i.kind))], // kinds only, no values
        advisory: true,
        note: 'a finding means a possible link, not a proven one; no finding does not mean safe'
      });
    }
    return { findings, agentVisible: false, stored: false };
  }
}
