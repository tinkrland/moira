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

import { createHmac } from 'node:crypto';
import { randomId, canonicalJson, seal, open } from '../util/crypto.js';
import { OUTCOME, PASS_DURATION, RECEIPT_OP } from '../model/constants.js';
import { connectorDef, CONNECTOR_STATUS, CONNECTOR_KIND } from './registry.js';
import { adapterFor } from './adapters.js';

const SEAL_CTX = 'moira-connector-v1'
const DEFAULT_ACCOUNT = 'default';

const INVALID_SLUG = Symbol('invalid_slug');
const INVALID_CAPS = Symbol('invalid_caps');
const SLUG_RE = /^[a-z0-9][a-z0-9_-]{0,40}$/;

// a project is an internal bucket name, so it is validated the way set names
// are: lowercase, short, no surprises
function normalizeSlug(value) {
  if (value == null || value === '') return null;
  if (typeof value !== 'string') return INVALID_SLUG;
  const s = value.trim().toLowerCase();
  return SLUG_RE.test(s) ? s : INVALID_SLUG;
}

// capabilities are declared scope LABELS as the owner reads them off the token
// screen ("workflow:write", "repo:read"). we never introspect a token: a PAT
// does not announce its scopes, so the declaration is the honest interface.
function normalizeCapabilities(value) {
  if (value == null) return [];
  if (!Array.isArray(value)) return INVALID_CAPS;
  const out = [];
  for (const raw of value) {
    if (typeof raw !== 'string') return INVALID_CAPS;
    const s = raw.trim().toLowerCase();
    if (!/^[a-z0-9][a-z0-9:_-]{0,60}$/.test(s)) return INVALID_CAPS;
    if (!out.includes(s)) out.push(s);
  }
  return out;
}

const DAY_MS = 24 * 3600 * 1000;
const DEFAULT_IDLE_GRACE_MS = 7 * DAY_MS;
const DEFAULT_MAX_AGE_MS = 30 * DAY_MS;

// "1w" / "1mo" / "30d" / "24h" / "30m" or a number of ms. a month is 30 days
// here on purpose: calendar months are not modelled and pretending otherwise
// would make a rotation date quietly wrong.
export function parseInterval(value) {
  if (Number.isFinite(value) && value > 0) return value;
  if (typeof value !== 'string') return null;
  const m = /^(\d+)\s*(m|h|d|w|mo)$/i.exec(value.trim());
  if (!m) return null;
  const n = Number(m[1]);
  const unit = m[2].toLowerCase();
  const factor = unit === 'm' ? 60 * 1000 : unit === 'h' ? 3600 * 1000 : unit === 'd' ? DAY_MS : unit === 'w' ? 7 * DAY_MS : 30 * DAY_MS;
  const ms = n * factor;
  return ms > 0 ? ms : null;
}

function normalizeSchedule(input) {
  if (!input || typeof input !== 'object') return { ok: false, reason: 'schedule_required' };
  const kind = input.kind;
  if (kind === 'every') {
    const everyMs = parseInterval(input.everyMs ?? input.every);
    if (!everyMs) return { ok: false, reason: 'schedule_invalid' };
    return { ok: true, schedule: { kind: 'every', everyMs } };
  }
  if (kind === 'at') {
    const at = typeof input.at === 'string' ? Date.parse(input.at) : input.at;
    if (!Number.isFinite(at)) return { ok: false, reason: 'schedule_invalid' };
    return { ok: true, schedule: { kind: 'at', at } };
  }
  if (kind === 'idle') {
    const idleGraceMs = input.idleGraceMs == null ? DEFAULT_IDLE_GRACE_MS : parseInterval(input.idleGraceMs);
    const idleAfterMs = input.idleAfterMs == null ? 0 : parseInterval(input.idleAfterMs);
    const maxAgeMs = input.maxAgeMs == null ? DEFAULT_MAX_AGE_MS : parseInterval(input.maxAgeMs);
    if (idleGraceMs == null || idleAfterMs == null || maxAgeMs == null) return { ok: false, reason: 'schedule_invalid' };
    // the ceiling is not optional in spirit: without it, a credential in
    // constant use would never rotate, which is the opposite of the point.
    if (maxAgeMs <= idleGraceMs + idleAfterMs) {
      return { ok: false, reason: 'schedule_max_age_too_short' };
    }
    return { ok: true, schedule: { kind: 'idle', idleGraceMs, idleAfterMs, maxAgeMs } };
  }
  return { ok: false, reason: 'schedule_invalid' };
}

// the earliest trigger wins; null means nothing is pending (a dated rotation
// that already fired, or no schedule at all)
function nextRotationAtFor(identity, now) {
  const p = identity.policy ?? {};
  const s = p.schedule;
  if (!s) return null;
  const lastRotated = p.lastRotatedAt ?? p.scheduleSetAt ?? identity.createdAt ?? now;
  if (s.kind === 'every') return lastRotated + s.everyMs;
  if (s.kind === 'at') return p.scheduleComplete ? null : s.at;
  if (s.kind === 'idle') {
    const lastActivity = p.lastActivityAt ?? p.scheduleSetAt ?? identity.createdAt ?? now;
    const quietDue = lastActivity + s.idleGraceMs + s.idleAfterMs;
    const maxAgeDue = lastRotated + s.maxAgeMs;
    return Math.min(quietDue, maxAgeDue);
  }
  return null;
}

function dueReasonFor(identity, now) {
  const p = identity.policy ?? {};
  const s = p.schedule;
  if (!s) return 'unscheduled';
  if (s.kind === 'every') return 'interval';
  if (s.kind === 'at') return 'scheduled';
  const lastActivity = p.lastActivityAt ?? identity.createdAt ?? now;
  const quietDue = lastActivity + s.idleGraceMs + s.idleAfterMs;
  const maxAgeDue = (p.lastRotatedAt ?? identity.createdAt ?? now) + s.maxAgeMs;
  return maxAgeDue <= quietDue ? 'max_age' : 'quiet';
}

// covers = does this credential satisfy everything the pass asked for?
const covers = (identityCaps, wanted) => wanted.every((w) => (identityCaps ?? []).includes(w));

// a fingerprint of the credential material: comparable, never reversible. it
// answers exactly one question - "is this the same secret?" - which is the
// question linkage needs and nothing else.
function hmacFingerprint(text) {
  return createHmac('sha256', FINGERPRINT_SALT).update(text).digest('hex').slice(0, 32);
}
const FINGERPRINT_SALT = 'moira.connector.linkage.v1'; // account key when the owner names none;

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
  authorize(ctx, { personaId, connectorId, credentials, label = null, account = null, workspace = null, project = null, credential = null, capabilities = null, acknowledgeLinkage = false }) {
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
    // a project is OURS (an internal bucket: "atlas", "beacon"); a workspace is
    // THEIRS (a tenant on the provider). both are dimensions, never synonyms.
    const projectKey = normalizeSlug(project);
    if (projectKey === INVALID_SLUG) return { outcome: OUTCOME.DECLINED, reason: 'project_invalid' };
    const credentialKey = normalizeSlug(credential) ?? 'default';
    if (credentialKey === INVALID_SLUG) return { outcome: OUTCOME.DECLINED, reason: 'credential_slug_invalid' };
    const caps = normalizeCapabilities(capabilities);
    if (caps === INVALID_CAPS) return { outcome: OUTCOME.DECLINED, reason: 'capabilities_invalid' };
    // linkage: one credential, two personas, means the provider sees one human
    // wearing two hats - which is the thing persona separation exists to deny.
    // the check is a fingerprint over the credentials (never the value), it
    // refuses by default, and the finding is owner-only.
    const fingerprint = hmacFingerprint(canonicalJson(credentials));
    const linked = this._linkedPersonas(fingerprint, personaId);
    if (linked.length > 0 && acknowledgeLinkage !== true) {
      const link = this._recordLink({ fingerprint, connectorId, personaIds: [...linked, personaId] });
      return { outcome: OUTCOME.APPROVAL_REQUIRED, reason: 'credential_linkage', linkId: link.id, otherPersonas: linked.length };
    }
    if (linked.length > 0) {
      this._recordLink({ fingerprint, connectorId, personaIds: [...linked, personaId] });
    }

    // the slot: (persona, connector, PROJECT, workspace, account, CREDENTIAL).
    // re-authorizing replaces only that slot; a second token in the same project
    // is a second identity, because fine-grained tokens are fine-grained.
    const accountKey = account ?? DEFAULT_ACCOUNT;
    // peers = same account, so distinct accounts stay distinct without needing
    // capability declarations (a work login and a personal login are not
    // ambiguous). capability only disambiguates two tokens on the SAME account.
    const inProject = this.store.list('connectorIdentities',
      (x) => x.personaId === personaId && x.connectorId === connectorId && !x.revoked
        && (x.project ?? null) === projectKey && (x.workspace ?? null) === (workspace ?? null)
        && x.account === accountKey,
      { personaId, connectorId, account: accountKey });
    const others = inProject.filter((x) => (x.credential ?? 'default') !== credentialKey);
    // stingy: when two credentials share a slot, each must say what it can do.
    // guessing which token is which is how the wrong permission gets used.
    if (others.length > 0) {
      // the NEWCOMER must say what it can do: an undeclared second token is a
      // coin flip, and the wrong permission is worse than a refusal. an older
      // undeclared credential is grandfathered as the plain fallback - it can
      // serve capability-free reads, and can never claim a capability-scoped one.
      if (caps.length === 0) {
        return {
          outcome: OUTCOME.DECLINED,
          reason: 'capabilities_required_for_multiple_credentials',
          undeclared: [credentialKey]
        };
      }
      const signatures = new Set([...others, { capabilities: caps }].map((x) => (x.capabilities ?? []).slice().sort().join('|')));
      if (signatures.size !== others.length + 1) {
        return { outcome: OUTCOME.DECLINED, reason: 'capabilities_indistinguishable' };
      }
    }
    const existing = inProject.filter((x) => (x.credential ?? 'default') === credentialKey);
    for (const x of existing) {
      this.store.update('connectorIdentities', x.id, (r) => ({ ...r, revoked: true }));
    }
    const identity = {
      id: randomId('cni'),
      personaId,
      connectorId,
      account: accountKey,
      workspace: workspace ?? null,
      project: projectKey,
      credential: credentialKey,
      capabilities: caps,
      label,
      fingerprint,
      sealed: seal(this.keys.personaKey(personaId), JSON.stringify(credentials), `${SEAL_CTX}:${connectorId}`),
      createdAt: this.now(),
      revoked: false,
      // fine-grained by default: revocable, not rotating until asked
      policy: { mode: 'revocable', rotationEveryMs: null, lastRotatedAt: null, nextRotationAt: null, rotationCount: 0 }
    };
    this.store.put('connectorIdentities', identity.id, identity);
    this.receipts.write({ actor: 'owner', personaId, op: RECEIPT_OP.CONNECTOR, reason: `authorized:${connectorId}` });
    return {
      outcome: OUTCOME.RESULTS, identityId: identity.id, connectorId,
      project: projectKey, credential: credentialKey, capabilities: caps
    };
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
  grantPass(ctx, { clientId, personaId, connectorId, scope, purpose, duration = PASS_DURATION.SESSION, ttlMs = null, uses = null, account = null, workspace = null, project = null, credential = null, capabilities = null, acknowledgeStanding = false }) {
    if (!ctx || ctx.kind !== 'owner_context' || typeof ctx.ownerRef !== 'string') {
      return { outcome: OUTCOME.DECLINED, reason: 'owner_context_required' };
    }
    const agent = this.agents.get(clientId);
    if (!agent || agent.revoked) return { outcome: OUTCOME.UNAVAILABLE, reason: 'unknown_or_revoked_agent' };
    const def = connectorDef(connectorId);
    if (!def) return { outcome: OUTCOME.UNAVAILABLE, reason: 'unknown_connector' };
    // fine-grained by default: a standing connector grant is never the default,
    // and asking for one is an explicit act (the same rule memory passes follow)
    if (duration === PASS_DURATION.PERMANENT && acknowledgeStanding !== true) {
      return { outcome: OUTCOME.DECLINED, reason: 'standing_requires_acknowledgement' };
    }
    const wanted = normalizeCapabilities(capabilities);
    if (wanted === INVALID_CAPS) return { outcome: OUTCOME.DECLINED, reason: 'capabilities_invalid' };
    const projectKey = normalizeSlug(project);
    if (projectKey === INVALID_SLUG) return { outcome: OUTCOME.DECLINED, reason: 'project_invalid' };
    const credentialKey = normalizeSlug(credential);
    if (credentialKey === INVALID_SLUG) return { outcome: OUTCOME.DECLINED, reason: 'credential_slug_invalid' };
    const identity = this._identity(personaId, connectorId, {
      account, workspace, project: projectKey, credential: credentialKey, capabilities: wanted
    });
    if (!identity) return { outcome: OUTCOME.UNAVAILABLE, reason: 'no_active_identity' };
    const pass = {
      id: randomId('cpass'),
      kind: 'connector_pass',
      clientId, personaId, connectorId, scope, purpose,
      // a pass records what the OWNER chose to pin, never what the store
      // happened to resolve: null means unpinned, and pinning later must be an
      // explicit act rather than a side effect of authorization order.
      account: account ?? null,
      workspace: workspace ?? null,
      project: projectKey,
      credential: credentialKey,
      capabilities: wanted,
      duration,
      usesLeft: duration === PASS_DURATION.ONE_TIME ? 1 : uses,
      createdAt: this.now(),
      expiresAt: duration === PASS_DURATION.PERMANENT ? null : this.now() + (ttlMs ?? 60 * 60 * 1000),
      revoked: false
    };
    this.store.put('connectorPasses', pass.id, pass);
    this.receipts.write({ actor: 'owner', personaId, op: RECEIPT_OP.PASS_GRANT, reason: `connector:${connectorId}:${scope}:${purpose}` });
    return { outcome: OUTCOME.RESULTS, passId: pass.id, duration, expiresAt: pass.expiresAt };
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
      .map((x) => ({
        identityId: x.id, connectorId: x.connectorId, account: x.account,
        workspace: x.workspace ?? null, label: x.label, createdAt: x.createdAt
      }));
    return { outcome: OUTCOME.RESULTS, connectors: identities };
  }

  // the read gate: agent context (client, persona) + connector pass + active
  // identity. io goes through the adapter; results come back untrusted-tagged.
  async read({ clientId, personaId }, { connectorId, operation, params = {}, purpose, scope, account = null, workspace = null, project = null, credential = null, capabilities = null }) {
    const def = connectorDef(connectorId);
    if (!def || def.status !== CONNECTOR_STATUS.ACTIVE || def.kind !== CONNECTOR_KIND.CONNECTED) {
      return { outcome: OUTCOME.DECLINED, reason: 'connector_not_active' };
    }
    // account targeting: an explicit account reads exactly that account's
    // identity; no account resolves the first-authorized (deterministic).
    const wanted = normalizeCapabilities(capabilities);
    if (wanted === INVALID_CAPS) return { outcome: OUTCOME.DECLINED, reason: 'capabilities_invalid' };
    const projectKey = normalizeSlug(project);
    const credentialKey = normalizeSlug(credential);
    const identity = this._identity(personaId, connectorId, {
      account, workspace, project: projectKey, credential: credentialKey, capabilities: wanted ?? []
    });
    if (!identity) {
      // name the reason: a missing capability is not the same as a missing
      // connection, and an agent should be told which one it hit
      const inSlot = this.store.list('connectorIdentities', (x) => x.personaId === personaId
        && x.connectorId === connectorId && !x.revoked
        && (projectKey == null || (x.project ?? null) === projectKey), { personaId, connectorId });
      if (inSlot.length > 0 && (wanted ?? []).length > 0 && !inSlot.some((x) => covers(x.capabilities ?? [], wanted))) {
        return { outcome: OUTCOME.DECLINED, reason: 'capability_not_covered', capabilities: wanted };
      }
      return { outcome: OUTCOME.DECLINED, reason: 'no_active_identity' };
    }
    const pass = this._pass(clientId, personaId, connectorId, scope, purpose, {
      account: account ?? identity.account,
      workspace: workspace ?? identity.workspace ?? null,
      project: projectKey,
      credential: credentialKey,
      capabilities: wanted ?? []
    });
    if (!pass) return { outcome: OUTCOME.DECLINED, reason: 'no_connector_pass' };

    let creds;
    try {
      creds = JSON.parse(open(this.keys.personaKey(personaId), identity.sealed, `${SEAL_CTX}:${connectorId}`));
    } catch {
      return { outcome: OUTCOME.DECLINED, reason: 'credential_unseal_failed' };
    }

    // a read is activity: it moves an idle schedule's quiet clock forward.
    // one signal, not the truth - the host can report more via touchConnection.
    if (identity.policy?.schedule?.kind === 'idle') {
      this.store.update('connectorIdentities', identity.id, (r) => {
        const draft = { ...r, policy: { ...(r.policy ?? {}), lastActivityAt: this.now() } };
        draft.policy.nextRotationAt = nextRotationAtFor(draft, this.now());
        return draft;
      });
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

  // --- connection policy: revocable by default, rotating on request ---------

  connectionPolicy(ctx, { identityId }) {
    if (!ctx || ctx.kind !== 'owner_context') return { outcome: OUTCOME.DECLINED, reason: 'owner_context_required' };
    const identity = this.store.get('connectorIdentities', identityId);
    if (!identity) return { outcome: OUTCOME.UNAVAILABLE, reason: 'identity_not_found' };
    const p = identity.policy ?? {};
    return {
      outcome: OUTCOME.RESULTS, identityId,
      connectorId: identity.connectorId, account: identity.account,
      workspace: identity.workspace ?? null, project: identity.project ?? null,
      mode: p.mode ?? 'revocable',
      schedule: p.schedule ?? null,
      scheduleComplete: p.scheduleComplete === true,
      rotationEveryMs: p.rotationEveryMs ?? null,
      lastRotatedAt: p.lastRotatedAt ?? null,
      lastActivityAt: p.lastActivityAt ?? identity.createdAt ?? null,
      nextRotationAt: p.nextRotationAt ?? null,
      rotationCount: p.rotationCount ?? 0,
      revocable: true
    };
  }

  // the schedule is either a CALENDAR (every / on a date) or ACTIVITY (quiet
  // for a while, with a max-age ceiling so a busy credential is not immortal)
  setConnectionPolicy(ctx, { identityId, mode, everyMs = null, schedule = null }) {
    if (!ctx || ctx.kind !== 'owner_context') return { outcome: OUTCOME.DECLINED, reason: 'owner_context_required' };
    const identity = this.store.get('connectorIdentities', identityId);
    if (!identity) return { outcome: OUTCOME.UNAVAILABLE, reason: 'identity_not_found' };
    if (!['revocable', 'rotating'].includes(mode)) return { outcome: OUTCOME.DECLINED, reason: 'mode_invalid' };

    let normal = null;
    if (mode === 'rotating') {
      // legacy shape: { everyMs } means "every", so old callers keep working
      const input = schedule ?? (everyMs ? { kind: 'every', everyMs } : null);
      const parsed = normalizeSchedule(input);
      if (!parsed.ok) return { outcome: OUTCOME.DECLINED, reason: parsed.reason };
      normal = parsed.schedule;
    }

    const now = this.now();
    const next = this.store.update('connectorIdentities', identityId, (r) => {
      const prev = r.policy ?? {};
      const draft = {
        ...r,
        policy: {
          mode,
          schedule: normal,
          scheduleSetAt: now,
          scheduleComplete: false,
          rotationEveryMs: normal?.kind === 'every' ? normal.everyMs : null,
          lastRotatedAt: prev.lastRotatedAt ?? null,
          lastActivityAt: prev.lastActivityAt ?? r.createdAt ?? now,
          nextRotationAt: null,
          rotationCount: prev.rotationCount ?? 0
        }
      };
      draft.policy.nextRotationAt = nextRotationAtFor(draft, now);
      return draft;
    });
    this.receipts.write({ actor: 'owner', personaId: identity.personaId, op: RECEIPT_OP.CONNECTOR, reason: `policy:${identity.connectorId}:${mode}:${normal?.kind ?? 'none'}` });
    return {
      outcome: OUTCOME.RESULTS, identityId, mode,
      schedule: normal, nextRotationAt: next.policy.nextRotationAt
    };
  }

  // rotation replaces the sealed material and keeps the identity, so live
  // passes keep working. the old value is overwritten, never archived.
  rotate(ctx, { identityId, credentials }) {
    if (!ctx || ctx.kind !== 'owner_context') return { outcome: OUTCOME.DECLINED, reason: 'owner_context_required' };
    const identity = this.store.get('connectorIdentities', identityId);
    if (!identity) return { outcome: OUTCOME.UNAVAILABLE, reason: 'identity_not_found' };
    if (identity.revoked) return { outcome: OUTCOME.DECLINED, reason: 'identity_revoked' };
    const policy = identity.policy ?? { mode: 'revocable', rotationCount: 0 };
    if (policy.mode !== 'rotating') return { outcome: OUTCOME.DECLINED, reason: 'not_a_rotating_connection' };
    if (!credentials || typeof credentials !== 'object') return { outcome: OUTCOME.DECLINED, reason: 'credentials_required' };

    const now = this.now();
    const count = (policy.rotationCount ?? 0) + 1;
    const next = this.store.update('connectorIdentities', identityId, (r) => {
      const draft = {
        ...r,
        sealed: seal(this.keys.personaKey(identity.personaId), JSON.stringify(credentials), `${SEAL_CTX}:${identity.connectorId}`),
        fingerprint: hmacFingerprint(canonicalJson(credentials)),
        policy: {
          ...(r.policy ?? {}),
          mode: 'rotating',
          lastRotatedAt: now,
          rotationCount: count,
          // a dated rotation is one-shot; intervals and quiet schedules re-arm
          scheduleComplete: r.policy?.schedule?.kind === 'at',
          nextRotationAt: null
        }
      };
      draft.policy.nextRotationAt = nextRotationAtFor(draft, now);
      return draft;
    });
    this.receipts.write({ actor: 'owner', personaId: identity.personaId, op: RECEIPT_OP.CONNECTOR, reason: `rotated:${identity.connectorId}` });
    return {
      outcome: OUTCOME.RESULTS, identityId, rotationCount: count,
      nextRotationAt: next.policy.nextRotationAt,
      scheduleComplete: next.policy.scheduleComplete === true
    };
  }

  // the host reporting activity moira cannot see: a push, CI, a human using the
  // token outside this system. idle means "quiet as far as we can see".
  touch(ctx, { identityId, at = null }) {
    if (!ctx || ctx.kind !== 'owner_context') return { outcome: OUTCOME.DECLINED, reason: 'owner_context_required' };
    const identity = this.store.get('connectorIdentities', identityId);
    if (!identity) return { outcome: OUTCOME.UNAVAILABLE, reason: 'identity_not_found' };
    const now = this.now();
    const when = Math.min(Number.isFinite(at) ? at : now, now); // no future activity
    const next = this.store.update('connectorIdentities', identityId, (r) => {
      const draft = { ...r, policy: { ...(r.policy ?? {}), lastActivityAt: when } };
      draft.policy.nextRotationAt = nextRotationAtFor(draft, now);
      return draft;
    });
    return { outcome: OUTCOME.RESULTS, identityId, lastActivityAt: when, nextRotationAt: next.policy.nextRotationAt };
  }

  // what is due, so a host can rotate on a schedule it owns
  dueRotations(ctx) {
    if (!ctx || ctx.kind !== 'owner_context') return { outcome: OUTCOME.DECLINED, reason: 'owner_context_required' };
    const now = this.now();
    const identities = this.store.list('connectorIdentities', (x) => !x.revoked
      && x.policy?.mode === 'rotating'
      && (x.policy?.nextRotationAt ?? Infinity) <= now, {})
      .map((x) => ({
        identityId: x.id, personaId: x.personaId, connectorId: x.connectorId,
        account: x.account, workspace: x.workspace ?? null, project: x.project ?? null,
        nextRotationAt: x.policy.nextRotationAt,
        overdueByMs: now - x.policy.nextRotationAt,
        reason: dueReasonFor(x, now),
        rotationCount: x.policy.rotationCount ?? 0
      }));
    return { outcome: OUTCOME.RESULTS, now, identities };
  }

  // owner-only: which credentials are shared across personas, and the fix
  listConnectionLinks(ctx) {
    if (!ctx || ctx.kind !== 'owner_context') return { outcome: OUTCOME.DECLINED, reason: 'owner_context_required' };
    const links = this.store.list('connectionLinks', () => true, {}).map((l) => ({
      id: l.id, connectorId: l.connectorId, personaIds: l.personaIds,
      createdAt: l.createdAt, acknowledged: l.acknowledged === true
    }));
    return { outcome: OUTCOME.RESULTS, links };
  }

  // --- linkage internals -----------------------------------------------------

  _linkedPersonas(fingerprint, personaId) {
    const others = new Set();
    for (const x of this.store.list('connectorIdentities', (r) => !r.revoked && r.fingerprint === fingerprint, {})) {
      if (x.personaId !== personaId) others.add(x.personaId);
    }
    return [...others];
  }

  _recordLink({ fingerprint, connectorId, personaIds }) {
    const existing = this.store.list('connectionLinks', (l) => l.fingerprint === fingerprint, {})[0];
    if (existing) {
      const merged = [...new Set([...(existing.personaIds ?? []), ...personaIds])];
      return this.store.update('connectionLinks', existing.id, (l) => ({ ...l, personaIds: merged }));
    }
    const link = {
      id: randomId('cnl'), fingerprint, connectorId,
      personaIds: [...new Set(personaIds)], createdAt: this.now(), acknowledged: true
    };
    this.store.put('connectionLinks', link.id, link);
    return link;
  }

  // resolve the identity a read should use. when the caller does not pin a
  // credential, the LEAST capable one that covers the asked capabilities wins:
  // a narrow token is preferred whenever it is enough.
  _identity(personaId, connectorId, { account = null, workspace = null, project = null, credential = null, capabilities = [] } = {}) {
    const live = this.store.list('connectorIdentities',
      (x) => x.personaId === personaId && x.connectorId === connectorId && !x.revoked,
      { personaId, connectorId });
    const match = (x) => (account == null || x.account === account)
      && (workspace == null || (x.workspace ?? null) === workspace)
      && (project == null || (x.project ?? null) === project)
      && (credential == null || (x.credential ?? 'default') === credential)
      && covers(x.capabilities ?? [], capabilities ?? []);
    const narrowed = account != null || workspace != null || project != null || credential != null || (capabilities ?? []).length > 0;
    if (narrowed) {
      const candidates = live.filter(match);
      if (candidates.length === 0) return null;
      // least capability first, then oldest (deterministic)
      return candidates.sort((a, b) => (a.capabilities ?? []).length - (b.capabilities ?? []).length
        || (a.createdAt ?? 0) - (b.createdAt ?? 0)
        || String(a.id).localeCompare(String(b.id)))[0];
    }
    // no account given: deterministic default = first authorized. the sort
    // is stable, so same-millisecond creations keep their insertion order
    // (never the random id - that would make the default nondeterministic).
    return [...live].sort((a, b) => a.createdAt - b.createdAt)[0] ?? null;
  }

  _pass(clientId, personaId, connectorId, scope, purpose, { account = null, workspace = null, project = null, credential = null, capabilities = [] } = {}) {
    const now = this.now();
    return this.store.list('connectorPasses',
      (p) => p.clientId === clientId && p.personaId === personaId && p.connectorId === connectorId &&
        p.scope === scope && p.purpose === purpose && !p.revoked,
      { clientId, personaId, connectorId, scope, purpose })
      .filter((p) => (p.account == null || p.account === account)
        && ((p.workspace ?? null) == null || (p.workspace ?? null) === workspace)
        // a pass granted for one project is not a pass for another, and a pass
        // granted without a capability cannot authorise a capability-scoped read
        && ((p.project ?? null) == null || (p.project ?? null) === (project ?? null))
        && ((p.credential ?? null) == null || (p.credential ?? null) === (credential ?? null))
        && covers(p.capabilities ?? [], capabilities ?? [])
        && (p.expiresAt === null || p.expiresAt > now) && (p.usesLeft === null || p.usesLeft > 0))[0] ?? null;
  }
}
