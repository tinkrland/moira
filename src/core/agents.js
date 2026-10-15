// agents and sessions (spec sections 7.1, 11).
//
// agents are principals: name, tier, personas they may attach to, standing
// rules, spend caps, last seen. one tap to revoke.
//
// trust tiers (7.1): verified (cimd-hosted client), unverified (self-named
// device/code pairing), internal (owner-run). tier gates which categories a
// pass can even be offered for, and whether the agent may hold leases.
//
// sessions: every token is bound to exactly one persona at grant time. an
// agent that needs two personas holds two sessions and cannot mix them.
// refresh tokens rotate; replay of a rotated token revokes the family.

import { randomId } from '../util/crypto.js';
import { AGENT_TIER, OUTCOME } from '../model/constants.js';

const ACCESS_TTL_MS = 60 * 60 * 1000; // 1 hour access tokens (section 2 parity)
const REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export class AgentService {
  constructor({ store, receipts, now = Date.now }) {
    this.store = store;
    this.receipts = receipts;
    this.now = now;
  }

  register({ name, tier = AGENT_TIER.UNVERIFIED, personasAllowed = [], spendCaps = {}, standingRules = [] }) {
    if (!Object.values(AGENT_TIER).includes(tier)) throw new Error(`unknown tier: ${tier}`);
    const agent = {
      id: randomId('agent'),
      name,
      tier,
      personasAllowed,
      spendCaps, // { usd, tokens }
      standingRules,
      autoApprovalLevel: 1.0, // lowered after budget overruns (section 8.5)
      revoked: false,
      lastSeen: null,
      createdAt: this.now()
    };
    this.store.put('agents', agent.id, agent);
    return agent;
  }

  get(id) {
    return this.store.get('agents', id);
  }

  list() {
    return this.store.list('agents');
  }

  update(id, patch) {
    return this.store.update('agents', id, (a) =>
      typeof patch === 'function' ? patch(a) : { ...a, ...patch });
  }

  touch(id) {
    return this.store.update('agents', id, (a) => ({ ...a, lastSeen: this.now() }));
  }

  // one tap to revoke (7.1): agent, its sessions and its passes all die on
  // the next request (orchestrated by the facade; this marks the agent).
  revoke(id) {
    const agent = this.store.update('agents', id, (a) => ({ ...a, revoked: true }));
    return agent;
  }

  mayHoldLeases(agent) {
    // unverified agents never hold leases (section 9.4 lease decisions).
    return !agent.revoked && agent.tier !== AGENT_TIER.UNVERIFIED;
  }

  // tier gates which categories a pass can even be offered for (7.1).
  // unverified agents cannot be offered passes on sensitive or
  // special-category facts, nor voice exemplars (stylometry, 7.5).
  passableCategories(agent, category, factPolicy) {
    if (!agent || agent.revoked) return false;
    if (agent.tier === AGENT_TIER.UNVERIFIED) {
      if (factPolicy && (factPolicy.sensitivity === 'sensitive' || factPolicy.sensitivity === 'special_category')) return false;
      if (factPolicy && factPolicy.stylometryRisk === 'high') return false;
    }
    return true;
  }

  standingRuleFor(agent, kind, match) {
    return (agent.standingRules ?? []).find((r) => {
      if (r.kind !== kind) return false;
      return Object.entries(match).every(([k, v]) => r[k] === undefined || r[k] === v || (Array.isArray(r[k]) && r[k].includes(v)));
    }) ?? null;
  }
}

export class SessionService {
  constructor({ store, agents, now = Date.now }) {
    this.store = store;
    this.agents = agents;
    this.now = now;
  }

  // consent screen chooses the persona (section 17): explicit choice at grant
  // time is the source of truth. the token is bound to it forever.
  create({ clientId, personaId }) {
    const agent = this.agents.get(clientId);
    if (!agent || agent.revoked) return { outcome: OUTCOME.DECLINED, reason: 'unknown_or_revoked_agent' };
    if (agent.personasAllowed.length > 0 && !agent.personasAllowed.includes(personaId)) {
      return { outcome: OUTCOME.DECLINED, reason: 'persona_not_allowed_for_agent' };
    }
    const session = {
      id: randomId('sess'),
      clientId,
      personaId,
      createdAt: this.now()
    };
    const tokens = this._mint(session.id, null);
    this.store.put('sessions', session.id, session);
    this.agents.touch(clientId);
    return { outcome: OUTCOME.RESULTS, session, ...tokens };
  }

  _mint(sessionId, familyId) {
    const family = familyId ?? randomId('fam');
    const access = {
      id: randomId('tok'),
      sessionId,
      kind: 'access',
      expiresAt: this.now() + ACCESS_TTL_MS,
      revoked: false
    };
    const refresh = {
      id: randomId('tok'),
      sessionId,
      family,
      kind: 'refresh',
      expiresAt: this.now() + REFRESH_TTL_MS,
      used: false,
      revoked: false
    };
    this.store.put('tokens', access.id, access);
    this.store.put('tokens', refresh.id, refresh);
    return { accessToken: access.id, refreshToken: refresh.id, familyId: family };
  }

  // refresh rotation with replay detection (section 11): presenting an
  // already-rotated refresh token revokes the whole token family.
  refresh(refreshToken) {
    const tok = this.store.get('tokens', refreshToken);
    if (!tok || tok.kind !== 'refresh') {
      return { outcome: OUTCOME.DECLINED, reason: 'invalid_refresh_token' };
    }
    if (tok.used) {
      // replay of a rotated refresh token revokes the whole family (section 11).
      this._revokeFamily(tok.family);
      return { outcome: OUTCOME.DECLINED, reason: 'replay_detected_family_revoked' };
    }
    if (tok.revoked) {
      return { outcome: OUTCOME.DECLINED, reason: 'invalid_refresh_token' };
    }
    if (tok.expiresAt < this.now()) {
      return { outcome: OUTCOME.EXPIRED, reason: 'refresh_expired' };
    }
    this.store.update('tokens', tok.id, (t) => ({ ...t, used: true, revoked: true }));
    const session = this.store.get('sessions', tok.sessionId);
    if (!session) return { outcome: OUTCOME.UNAVAILABLE, reason: 'session_gone' };
    const agent = this.agents.get(session.clientId);
    if (!agent || agent.revoked) {
      this._revokeFamily(tok.family);
      return { outcome: OUTCOME.DECLINED, reason: 'agent_revoked' };
    }
    return { outcome: OUTCOME.RESULTS, ...this._mint(session.id, tok.family) };
  }

  _revokeFamily(family) {
    for (const t of this.store.list('tokens', (x) => x.family === family, { family })) {
      this.store.update('tokens', t.id, (x) => ({ ...x, revoked: true }));
    }
  }

  // access token -> { clientId, personaId }. the session never switches persona.
  resolve(accessToken) {
    const tok = this.store.get('tokens', accessToken);
    if (!tok || tok.kind !== 'access' || tok.revoked) return { outcome: OUTCOME.DECLINED, reason: 'invalid_access_token' };
    if (tok.expiresAt < this.now()) return { outcome: OUTCOME.EXPIRED, reason: 'access_expired' };
    const session = this.store.get('sessions', tok.sessionId);
    if (!session) return { outcome: OUTCOME.UNAVAILABLE, reason: 'session_gone' };
    const agent = this.agents.get(session.clientId);
    if (!agent || agent.revoked) return { outcome: OUTCOME.DECLINED, reason: 'agent_revoked' };
    this.agents.touch(session.clientId);
    return { outcome: OUTCOME.RESULTS, clientId: session.clientId, personaId: session.personaId, sessionId: session.id };
  }

  revokeSession(sessionId) {
    for (const t of this.store.list('tokens', (x) => x.sessionId === sessionId, { sessionId })) {
      this.store.update('tokens', t.id, (x) => ({ ...x, revoked: true }));
    }
    return this.store.del('sessions', sessionId);
  }

  revokeAllForAgent(clientId) {
    const sessions = this.store.list('sessions', (s) => s.clientId === clientId, { clientId });
    for (const s of sessions) this.revokeSession(s.id);
    return sessions.length;
  }
}
