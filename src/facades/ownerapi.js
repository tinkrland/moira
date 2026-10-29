// owner surface (spec sections 6, 16, 17, 11, 22.4).
//
// every method takes an OwnerContext capability minted by
// moira.createOwnerContext(verifiedOwnerSession) as its first argument. a
// plain object (for example { owner: true }) is rejected: authority is an
// unforgeable instance, not a flag. the agent surface (agentapi.js) has no
// way to reach these methods.

import { OwnerContext } from './ownercontext.js';
import { OUTCOME, VOICE_CATEGORY, STACK_CATEGORY, AI_CATEGORY } from '../model/constants.js';
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
    if (spec.sets !== undefined && spec.sets !== null && (!Array.isArray(spec.sets) || !spec.sets.every((s) => typeof s === 'string' && s.trim() !== ''))) {
      return { outcome: OUTCOME.DECLINED, reason: 'sets_invalid' };
    }
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

  // addAccount with the moment-of-risk linkage hook (spec 22.4): if the new
  // account's payer would create an UNDECLARED link between decoupled
  // personas, the account is not created and the finding comes back for the
  // owner to decide. declaredLink: true accepts and marks the pair declared
  // (permanent, solid line). acknowledgeLinkUntil: <epoch ms> accepts for a
  // limited time (gray line until expiry). findings carry kinds, never
  // values, and are owner-only.
  addAccount(ctx, personaId, spec = {}) {
    this._require(ctx);
    const { declaredLink = false, acknowledgeLinkUntil = null, ...accountSpec } = spec;
    const finding = this.gw.linkage.preLinkCheck(personaId, accountSpec.payerLabel);
    if (finding) {
      const [a, b] = finding.personaIds;
      if (!declaredLink && (acknowledgeLinkUntil == null || acknowledgeLinkUntil <= this.gw.now())) {
        return {
          outcome: OUTCOME.APPROVAL_REQUIRED,
          reason: 'linkage_finding',
          finding,
          choices: ['declaredLink: accept and mark the link declared', 'acknowledgeLinkUntil: accept until an epoch ms', 'change payerLabel: use a different payment method']
        };
      }
      const kind = declaredLink ? 'declared' : 'acknowledged';
      this.gw.store.put('linkageDeclarations', this.gw.linkage.pairKey(a, b), {
        id: this.gw.linkage.pairKey(a, b),
        personaIds: [a, b],
        kind,
        expiresAt: declaredLink ? null : acknowledgeLinkUntil,
        declaredAt: this.gw.now()
      });
      this.gw.receipts.write({ actor: 'owner', personaId, op: 'linkage', reason: kind });
    }
    return this.gw.ledger.add(personaId, accountSpec);
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

  // --- shared core (spec 5/17) --------------------------------------------
  // explicit, owner-approved, auditable promotion and demotion.
  listCoreFacts(ctx, { category = null } = {}) {
    this._require(ctx);
    return this.gw.core.list({ category });
  }

  promoteFact(ctx, { factId }) {
    this._require(ctx);
    return this.gw.core.promote({ factId });
  }

  demoteFact(ctx, { factId, toPersonaId }) {
    this._require(ctx);
    return this.gw.core.demote({ factId, toPersonaId });
  }

  // --- persona switching (section 17) ------------------------------------------
  // approval is the consent act; the old session is never touched.
  listPersonaSwitches(ctx, { status = null } = {}) {
    this._require(ctx);
    return { outcome: OUTCOME.RESULTS, switches: this.gw.switching.list({ status }) };
  }

  approvePersonaSwitch(ctx, { switchId }) {
    this._require(ctx);
    return this.gw.switching.approve({ switchId });
  }

  denyPersonaSwitch(ctx, { switchId }) {
    this._require(ctx);
    return this.gw.switching.deny({ switchId });
  }

  // per-client default persona: the consent screen preselects it. explicit
  // choice at grant time stays the source of truth - this is only a helper.
  setDefaultPersona(ctx, { clientId, personaId }) {
    this._require(ctx);
    if (!this.gw.personas.get(personaId)) return { outcome: OUTCOME.UNAVAILABLE, reason: 'persona_missing' };
    this.gw.agents.update(clientId, (a) => ({ ...a, defaultPersonaId: personaId }));
    return { outcome: OUTCOME.RESULTS };
  }

  clearDefaultPersona(ctx, { clientId }) {
    this._require(ctx);
    this.gw.agents.update(clientId, (a) => ({ ...a, defaultPersonaId: null }));
    return { outcome: OUTCOME.RESULTS };
  }

  // wrong-persona escape hatch: moves a fact or proposal with taint review.
  reassignFact(ctx, { factId, toPersonaId }) {
    this._require(ctx);
    return this.gw.switching.reassign({ factId, toPersonaId });
  }

  // --- connectors (section 14) ------------------------------------------------

  connectConnector(ctx, { personaId, connectorId, credentials, label = null, account = null }) {
    this._require(ctx);
    return this.gw.connectors.authorize(ctx, { personaId, connectorId, credentials, label, account });
  }

  revokeConnector(ctx, { identityId }) {
    this._require(ctx);
    return this.gw.connectors.revoke(ctx, { identityId });
  }

  grantConnectorPass(ctx, { clientId, personaId, connectorId, scope, purpose, duration, ttlMs, uses, account = null }) {
    this._require(ctx);
    return this.gw.connectors.grantPass(ctx, { clientId, personaId, connectorId, scope, purpose, duration, ttlMs, uses, account });
  }

  revokeConnectorPass(ctx, { passId }) {
    this._require(ctx);
    return this.gw.connectors.revokePass(ctx, { passId });
  }

  listConnectors(ctx, { personaId }) {
    this._require(ctx);
    return this.gw.connectors.listForPersona(personaId);
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
  declareLinkageIntention(ctx, { personaIds, note = null, until = null }) {
    this._require(ctx);
    if (!Array.isArray(personaIds) || personaIds.length < 2) {
      return { outcome: OUTCOME.DECLINED, reason: 'need_two_persona_ids' };
    }
    const key = [...personaIds].sort().join('|');
    this.gw.store.put('linkageDeclarations', key, {
      id: key,
      personaIds: [...new Set(personaIds)],
      kind: 'declared',
      expiresAt: until, // null: permanent. an expired `until` stops silencing
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

  // freeze persona (section 16 sibling of deletion): put it on ice instead of
  // deleting it. the keys are NOT shredded and no facts, packs, handoffs or
  // accounts are destroyed: activity surfaces decline while frozen (agent
  // calls, routing, switching, bridges, fact adds, packs, handoffs, ledger
  // mints) and thaw resumes the persona exactly. standing leases are revoked
  // like the kill switch: leases are short-lived by design and thaw never
  // resurrects revoked things; the owner re-issues.
  freezePersona(ctx, personaId) {
    this._require(ctx);
    const persona = this.gw.personas.get(personaId);
    if (!persona) return { outcome: OUTCOME.UNAVAILABLE, reason: 'persona_not_found' };
    const res = this.gw.personas.freeze(personaId);
    if (res.outcome !== OUTCOME.RESULTS) return res;
    // standing leases are revoked outright (NOT via the kill switch: that
    // flips the panic `locked` flag, and freeze is its own state); leases
    // are short-lived by design and thaw never resurrects revoked things.
    let frozenLeases = 0;
    for (const l of this.gw.store.list('leases', (x) => x.personaId === personaId && x.status === 'active', { personaId, status: 'active' })) {
      this.gw.router.revokeLease(l.id);
      frozenLeases++;
    }
    this.gw.receipts.write({ actor: 'owner', personaId, op: 'persona_freeze', reason: 'put_on_ice' });
    return { outcome: OUTCOME.RESULTS, frozen: true, frozenLeases };
  }

  // thaw persona: back from the ice, exactly as it was. keys were intact the
  // whole time, so sealed facts open again the moment the persona is active.
  thawPersona(ctx, personaId) {
    this._require(ctx);
    const persona = this.gw.personas.get(personaId);
    if (!persona) return { outcome: OUTCOME.UNAVAILABLE, reason: 'persona_not_found' };
    const res = this.gw.personas.thaw(personaId);
    if (res.outcome !== OUTCOME.RESULTS) return res;
    this.gw.receipts.write({ actor: 'owner', personaId, op: 'persona_thaw', reason: 'off_the_ice' });
    return { outcome: OUTCOME.RESULTS, thawed: true };
  }

  // the persona vault (mymind's capture-anything, linkwarden's preservation,
  // sealed per persona). capture is not a taste claim; tags/sets union later.
  // the card, opened: one persona's honest inventory for the detail panel.
  // facts grouped by category (content included: this is the owner reading
  // their own), vault captures without archives, declared stack/ai, sets,
  // and the live permission ledger. unknown persona = unavailable.
  personaDetail(ctx, personaId) {
    this._require(ctx);
    const persona = this.gw.personas.get(personaId);
    if (!persona) return { outcome: OUTCOME.UNAVAILABLE, reason: 'persona_not_found' };

    const facts = this.gw.facts.active(personaId);
    const byCategory = {};
    for (const fact of facts) (byCategory[fact.category] ??= []).push({
      id: fact.id, content: fact.content, rung: fact.rung,
      source: fact.provenance?.source ?? null, createdAt: fact.provenance?.createdAt ?? fact.createdAt ?? null
    });

    const vault = this.gw.vault.list(personaId, {});
    const stack = this.gw.stack.list(personaId);
    const ai = this.gw.aitools.list(personaId);
    const sets = this.gw.sets.list(personaId);
    const passes = this.gw.store.list('passes', (x) => x.personaId === personaId).map((x) => ({
      id: x.id, clientId: x.clientId, category: x.category, purpose: x.purpose, duration: x.duration,
      scope: x.scope ?? null, standing: x.standing ?? false, sets: x.sets ?? null, expiresAt: x.expiresAt, revoked: x.revoked === true
    }));

    return {
      outcome: OUTCOME.RESULTS,
      persona: {
        id: persona.id, name: persona.name, identity: persona.identity, status: persona.status,
        email: persona.email ?? null, createdAt: persona.createdAt ?? null
      },
      facts: { total: facts.length, byCategory },
      vault: {
        items: (vault.outcome === OUTCOME.RESULTS ? vault.items : []).map((i) => ({
          id: i.id, kind: i.kind, title: i.title, url: i.url ?? null, tags: i.tags ?? [],
          sets: i.sets ?? [], createdAt: i.createdAt
        }))
      },
      stack: stack.outcome === OUTCOME.RESULTS ? stack.entries ?? stack.stack ?? [] : [],
      ai: ai.outcome === OUTCOME.RESULTS ? (ai.jobs ?? []) : [],
      sets: sets.outcome === OUTCOME.RESULTS ? sets.sets : [],
      passes
    };
  }

  async vaultAdd(ctx, { personaId, kind, url, title, note, quote, tags, sets, snapshot, source } = {}, opts = {}) {
    this._require(ctx);
    if (!personaId) return { outcome: OUTCOME.DECLINED, reason: 'persona_required' };
    const fetcher = opts.fetch ?? this.gw.io?.fetch ?? null;
    return this.gw.vault.add(personaId, { kind, url, title, note, quote, tags, sets, snapshot, source }, fetcher);
  }

  // connector-fed capture: save a row you just read through a connector
  // straight into the persona vault, provenance attached (still untrusted).
  async vaultCapture(ctx, { personaId, connectorId, row, tags, sets, snapshot } = {}, opts = {}) {
    this._require(ctx);
    if (!personaId) return { outcome: OUTCOME.DECLINED, reason: 'persona_required' };
    const fetcher = opts.fetch ?? this.gw.io?.fetch ?? null;
    return this.gw.vault.captureFromConnector(personaId, { connectorId, row, tags, sets, snapshot }, fetcher);
  }

  vaultList(ctx, { personaId, kinds, tags } = {}) {
    this._require(ctx);
    if (!personaId) return { outcome: OUTCOME.DECLINED, reason: 'persona_required' };
    return this.gw.vault.list(personaId, { kinds, tags });
  }

  vaultTag(ctx, { personaId, id, tags, sets } = {}) {
    this._require(ctx);
    if (!personaId || !id) return { outcome: OUTCOME.DECLINED, reason: 'persona_and_item_required' };
    return this.gw.vault.tag(personaId, id, { tags: tags ?? [], sets: sets ?? [] });
  }

  vaultRemove(ctx, { personaId, id } = {}) {
    this._require(ctx);
    if (!personaId || !id) return { outcome: OUTCOME.DECLINED, reason: 'persona_and_item_required' };
    return this.gw.vault.remove(personaId, id);
  }

  // owner overview: the raw material for the browser surface. personas with
  // their sets, live pass inventory (scope, standing, expiry), frozen state.
  // no content, no canon: the card shows the shape of the hat, and opening a
  // card is a separate, deliberate read.
  overview(ctx) {
    this._require(ctx);
    const personas = this.gw.personas.list().map((p) => {
      const setsRes = this.gw.sets.list(p.id);
      const passes = this.gw.store.list('passes', (x) => x.personaId === p.id).map((x) => ({
        id: x.id, clientId: x.clientId, category: x.category, purpose: x.purpose,
        duration: x.duration, scope: x.scope ?? null, standing: x.standing ?? false,
        sets: x.sets ?? null, maxRung: x.maxRung, expiresAt: x.expiresAt, revoked: x.revoked === true
      }));
      return {
        id: p.id, name: p.name, identity: p.identity, status: p.status,
        createdAt: p.createdAt ?? null,
        email: p.email ?? null,
        bio: p.characterSheet?.bio ?? null,
        sets: setsRes.outcome === OUTCOME.RESULTS ? setsRes.sets : [],
        passes
      };
    });
    return { outcome: OUTCOME.RESULTS, personas };
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

  // stack context declarations: the owner states the stack (tool + the
  // specific uses of it) so agents stop hallucinating it. per-persona,
  // owner-stated (basis 'stated'), structured - never inferred.
  stackAdd(ctx, { personaId, tool, uses, category, tools, sets }) {
    this._require(ctx);
    return this.gw.stack.add(personaId, { tool, uses, category, tools, sets });
  }

  stackRemove(ctx, { personaId, tool, uses = null }) {
    this._require(ctx);
    return this.gw.stack.remove(personaId, { tool, uses });
  }

  stackList(ctx, { personaId }) {
    this._require(ctx);
    return this.gw.stack.list(personaId);
  }

  // ai tool declarations (anti-hallucination, job-first): which tools this
  // persona uses for which job (for scraping firecrawl and querit, for
  // search tavily). per-persona, owner-stated, structured; the job is
  // required, competing providers accumulate under one job.
  aiAdd(ctx, { personaId, job, tool, uses, tools, sets }) {
    this._require(ctx);
    return this.gw.aitools.add(personaId, { job, tool, uses, tools, sets });
  }

  // context sets: implicit, per-persona, spanning stack and ai declarations.
  setList(ctx, { personaId }) {
    this._require(ctx);
    return this.gw.sets.list(personaId);
  }

  setRemove(ctx, { personaId, name }) {
    this._require(ctx);
    return this.gw.sets.remove(personaId, name);
  }

  aiRemove(ctx, { personaId, job, tool = null, uses = null }) {
    this._require(ctx);
    return this.gw.aitools.remove(personaId, { job, tool, uses });
  }

  aiList(ctx, { personaId }) {
    this._require(ctx);
    return this.gw.aitools.list(personaId);
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
        // declared pairs are skipped; acknowledgements only until they expire
        if (!this.gw.linkage.declarationActive(decoupled[0], id)) undeclared.push(id);
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
