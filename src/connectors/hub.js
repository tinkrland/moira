// connector hub (spec 14). the ONLY surface between personas and provider
// apis. every read is (persona, connector, scope, purpose, duration) gated
// by a connector pass - a separate concept from memory passes (section 9.1
// governs memory; connectors govern themselves).
//
// security posture:
//   - credentials seal under the persona key with the same envelope
//     encryption as facts (never plaintext, never returned by any read)
//   - an identity is per (persona, connector, ACCOUNT). one persona can
//     hold several accounts on the same provider (work drive + personal
//     drive); re-authorizing an account replaces only that account.
//   - provider rows are tagged untrusted with source attribution at the
//     boundary; nothing from a connector becomes a preference basis without
//     owner confirmation (same as any proposal)
//   - every read writes a content-free receipt

import { randomId } from '../util/crypto.js';
import { seal, open } from '../util/crypto.js';
import { OUTCOME, PASS_DURATION, RECEIPT_OP } from '../model/constants.js';
import { connectorDef, CONNECTOR_STATUS, CONNECTOR_KIND } from './registry.js';
import { adapterFor } from './adapters.js';

const SEAL_CTX = 'moira-connector-v1'
const DEFAULT_ACCOUNT = 'default'; // account key when the owner names none;

export class ConnectorHub {
  constructor({ store, keys, receipts, agents, now = Date.now, io = {} }) {
    this.store = store;
    this.keys = keys;
    this.receipts = receipts;
    this.agents = agents;
    this.now = now;
    this.io = io; // { fetch?, adapters? } - test injection for adapter io
  }

  // --- owner side ------------------------------------------------------------

  // owner authorizes one provider account for one persona. credentials are
  // sealed immediately; the identity record holds only the sealed envelope.
  authorize(ctx, { personaId, connectorId, credentials, label = null, account = null }) {
    if (!ctx || ctx.kind !== 'owner_context' || typeof ctx.ownerRef !== 'string') {
      return { outcome: OUTCOME.DECLINED, reason: 'owner_context_required' };
    }
    const def = connectorDef(connectorId);
    if (!def) return { outcome: OUTCOME.UNAVAILABLE, reason: 'unknown_connector' };
    if (def.status !== CONNECTOR_STATUS.ACTIVE) {
      return { outcome: OUTCOME.DECLINED, reason: `connector_not_active:${def.status}` };
    }
    if (def.kind !== CONNECTOR_KIND.CONNECTED) {
      return { outcome: OUTCOME.DECLINED, reason: 'ingest_connectors_ingest_not_authorize' };
    }
    if (!credentials || typeof credentials !== 'object') {
      return { outcome: OUTCOME.DECLINED, reason: 'credentials_required' };
    }
    // one live identity per (persona, connector, account): re-authorizing an
    // account replaces only that account; other accounts stay live.
    const accountKey = account ?? DEFAULT_ACCOUNT;
    const existing = this.store.list('connectorIdentities',
      (x) => x.personaId === personaId && x.connectorId === connectorId && !x.revoked && x.account === accountKey,
      { personaId, connectorId, account: accountKey });
    for (const x of existing) {
      this.store.update('connectorIdentities', x.id, (r) => ({ ...r, revoked: true }));
    }
    const identity = {
      id: randomId('cni'),
      personaId,
      connectorId,
      account: accountKey,
      label,
      sealed: seal(this.keys.personaKey(personaId), JSON.stringify(credentials), `${SEAL_CTX}:${connectorId}`),
      createdAt: this.now(),
      revoked: false
    };
    this.store.put('connectorIdentities', identity.id, identity);
    this.receipts.write({ actor: 'owner', personaId, op: RECEIPT_OP.CONNECTOR, reason: `authorized:${connectorId}` });
    return { outcome: OUTCOME.RESULTS, identityId: identity.id, connectorId };
  }

  revoke(ctx, { identityId }) {
    if (!ctx || ctx.kind !== 'owner_context' || typeof ctx.ownerRef !== 'string') {
      return { outcome: OUTCOME.DECLINED, reason: 'owner_context_required' };
    }
    const identity = this.store.get('connectorIdentities', identityId);
    if (!identity) return { outcome: OUTCOME.UNAVAILABLE, reason: 'identity_not_found' };
    this.store.update('connectorIdentities', identityId, (r) => ({ ...r, revoked: true }));
    // revoking the identity kills its passes too - defense in depth
    for (const p of this.store.list('connectorPasses', (p) => p.personaId === identity.personaId && p.connectorId === identity.connectorId && !p.revoked, {})) {
      this.store.update('connectorPasses', p.id, (x) => ({ ...x, revoked: true }));
    }
    this.receipts.write({ actor: 'owner', personaId: identity.personaId, op: RECEIPT_OP.CONNECTOR, reason: `revoked:${identity.connectorId}` });
    return { outcome: OUTCOME.RESULTS };
  }

  // connector pass grant: separate from memory passes by construction -
  // different collection, different verifier, different dimensions.
  grantPass(ctx, { clientId, personaId, connectorId, scope, purpose, duration = PASS_DURATION.PERMANENT, ttlMs = null, uses = null, account = null }) {
    if (!ctx || ctx.kind !== 'owner_context' || typeof ctx.ownerRef !== 'string') {
      return { outcome: OUTCOME.DECLINED, reason: 'owner_context_required' };
    }
    const agent = this.agents.get(clientId);
    if (!agent || agent.revoked) return { outcome: OUTCOME.UNAVAILABLE, reason: 'unknown_or_revoked_agent' };
    const def = connectorDef(connectorId);
    if (!def) return { outcome: OUTCOME.UNAVAILABLE, reason: 'unknown_connector' };
    const identity = this._identity(personaId, connectorId);
    if (!identity) return { outcome: OUTCOME.UNAVAILABLE, reason: 'no_active_identity' };
    const pass = {
      id: randomId('cpass'),
      kind: 'connector_pass',
      clientId, personaId, connectorId, scope, purpose,
      account, // optional: pins the pass to one account of the provider
      duration,
      usesLeft: duration === PASS_DURATION.ONE_TIME ? 1 : uses,
      createdAt: this.now(),
      expiresAt: duration === PASS_DURATION.PERMANENT ? null : this.now() + (ttlMs ?? 60 * 60 * 1000),
      revoked: false
    };
    this.store.put('connectorPasses', pass.id, pass);
    this.receipts.write({ actor: 'owner', personaId, op: RECEIPT_OP.PASS_GRANT, reason: `connector:${connectorId}:${scope}:${purpose}` });
    return { outcome: OUTCOME.RESULTS, passId: pass.id };
  }

  revokePass(ctx, { passId }) {
    if (!ctx || ctx.kind !== 'owner_context' || typeof ctx.ownerRef !== 'string') {
      return { outcome: OUTCOME.DECLINED, reason: 'owner_context_required' };
    }
    const pass = this.store.get('connectorPasses', passId);
    if (!pass) return { outcome: OUTCOME.UNAVAILABLE, reason: 'pass_not_found' };
    this.store.update('connectorPasses', passId, (p) => ({ ...p, revoked: true }));
    this.receipts.write({ actor: 'owner', personaId: pass.personaId, op: RECEIPT_OP.PASS_REVOKE, reason: `connector:${pass.connectorId}` });
    return { outcome: OUTCOME.RESULTS };
  }

  // --- agent side --------------------------------------------------------------

  // what the persona has connected (no credential material ever included)
  listForPersona(personaId) {
    const identities = this.store.list('connectorIdentities',
      (x) => x.personaId === personaId && !x.revoked, { personaId })
      .map((x) => ({ identityId: x.id, connectorId: x.connectorId, account: x.account, label: x.label, createdAt: x.createdAt }));
    return { outcome: OUTCOME.RESULTS, connectors: identities };
  }

  // the read gate: agent context (client, persona) + connector pass + active
  // identity. io goes through the adapter; results come back untrusted-tagged.
  async read({ clientId, personaId }, { connectorId, operation, params = {}, purpose, scope, account = null }) {
    const def = connectorDef(connectorId);
    if (!def || def.status !== CONNECTOR_STATUS.ACTIVE || def.kind !== CONNECTOR_KIND.CONNECTED) {
      return { outcome: OUTCOME.DECLINED, reason: 'connector_not_active' };
    }
    // account targeting: an explicit account reads exactly that account's
    // identity; no account resolves the first-authorized (deterministic).
    const identity = this._identity(personaId, connectorId, account);
    if (!identity) return { outcome: OUTCOME.DECLINED, reason: 'no_active_identity' };
    const pass = this._pass(clientId, personaId, connectorId, scope, purpose, identity.account);
    if (!pass) return { outcome: OUTCOME.DECLINED, reason: 'no_connector_pass' };

    let creds;
    try {
      creds = JSON.parse(open(this.keys.personaKey(personaId), identity.sealed, `${SEAL_CTX}:${connectorId}`));
    } catch {
      return { outcome: OUTCOME.DECLINED, reason: 'credential_unseal_failed' };
    }

    const adapter = adapterFor(connectorId, this.io);
    let raw;
    try {
      if (operation === 'list') raw = await adapter.listFiles(creds, params, this.io);
      else if (operation === 'read') raw = await adapter.readFile(creds, params, this.io);
      else return { outcome: OUTCOME.DECLINED, reason: 'unknown_operation' };
    } catch (e) {
      this.receipts.write({ actor: clientId, personaId, op: RECEIPT_OP.CONNECTOR, reason: `error:${connectorId}:${operation}` });
      return { outcome: OUTCOME.DECLINED, reason: 'connector_request_failed', detail: String(e.message).slice(0, 200) };
    }
    if (raw.outcome === 'not_implemented') {
      return { outcome: OUTCOME.DECLINED, reason: raw.reason };
    }

    // one-time connector passes are consumed by the read itself
    if (pass.usesLeft !== null) {
      const left = pass.usesLeft - 1;
      if (left <= 0) this.store.update('connectorPasses', pass.id, (p) => ({ ...p, usesLeft: 0, revoked: true }));
      else this.store.update('connectorPasses', pass.id, (p) => ({ ...p, usesLeft: left }));
    }

    // untrusted tagging at the boundary: provider text is evidence, not truth
    const result = { untrusted: true, source: connectorId, purpose };
    if (operation === 'list') {
      result.rows = (raw.rows ?? []).map((r) => ({ ...r, untrusted: true, source: connectorId }));
    } else {
      result.content = raw.content;
      result.meta = { ...(raw.meta ?? {}), untrusted: true, source: connectorId };
    }
    this.receipts.write({ actor: clientId, personaId, op: RECEIPT_OP.CONNECTOR, reason: `read:${connectorId}:${operation}` });
    return { outcome: OUTCOME.RESULTS, ...result };
  }

  // --- internals ---------------------------------------------------------------

  _identity(personaId, connectorId, account = null) {
    const live = this.store.list('connectorIdentities',
      (x) => x.personaId === personaId && x.connectorId === connectorId && !x.revoked,
      { personaId, connectorId });
    if (account != null) return live.find((x) => x.account === account) ?? null;
    // no account given: deterministic default = first authorized. the sort
    // is stable, so same-millisecond creations keep their insertion order
    // (never the random id - that would make the default nondeterministic).
    return [...live].sort((a, b) => a.createdAt - b.createdAt)[0] ?? null;
  }

  _pass(clientId, personaId, connectorId, scope, purpose, account = null) {
    const now = this.now();
    return this.store.list('connectorPasses',
      (p) => p.clientId === clientId && p.personaId === personaId && p.connectorId === connectorId &&
        p.scope === scope && p.purpose === purpose && !p.revoked,
      { clientId, personaId, connectorId, scope, purpose })
      .filter((p) => (p.account == null || p.account === account) &&
        (p.expiresAt === null || p.expiresAt > now) && (p.usesLeft === null || p.usesLeft > 0))[0] ?? null;
  }
}
