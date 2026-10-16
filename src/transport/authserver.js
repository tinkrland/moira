// the moira authorization server (transport layer).
//
// serves the oauth surface an mcp client needs (oauth 2.1 per the mcp
// authorization spec: pkce s256 mandatory, no client secrets on the wire),
// plus rfc 8628 device authorization for clients that cannot hold a
// redirect (personal agents, cli tools), plus a token-info endpoint.
//
// what each piece maps to in the core:
//   authorization code -> sessions.create({ clientId, personaId }) is called
//     at /token, AFTER pkce and code checks, so a session exists only for an
//     authenticated consent. the persona is fixed at grant time (spec 17).
//   refresh_token -> sessions.refresh (rotation + family revocation on
//     replay, live at the core).
//   device flow -> pending device grant record; the owner approves through
//     the owner surface (ownerapi.approveDeviceCode), which is the step that
//     will be gated by owner-session authentication (phase 2 open item).
//
// signed tokens (tokens.js) wrap the opaque ids; wire format is jwt.
//
// zero dependencies: node:http handler, node:crypto.

import { randomBytes, timingSafeEqual } from 'node:crypto';
import { s256Challenge } from './tokens.js';

const CODE_TTL_MS = 10 * 60 * 1000;
const DEVICE_TTL_MS = 15 * 60 * 1000;
const DEVICE_INTERVAL = 5; // seconds between polls (rfc 8628)

function b64u(buf) { return buf.toString('base64url'); }
function eq(a, b) { const x = Buffer.from(a); const y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x, y); }

export class AuthServer {
  constructor({ moira, tokens, baseUrl = 'http://127.0.0.1:8080', now = Date.now } = {}) {
    this.moira = moira;
    this.tokens = tokens;
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.now = now;
    // authorization codes: id -> { clientId, personaId, redirectUri, challenge, expiresAt, used }
    this.codes = new Map();
  }

  // --- discovery (rfc 9728 / rfc 8414) ---------------------------------------

  discovery() {
    const iss = this.baseUrl;
    return {
      // rfc 9728: what the protected resource (the mcp endpoint) points at
      protectedResource: {
        resource: iss,
        authorization_servers: [iss]
      },
      // rfc 8414: the authorization server metadata
      authorizationServer: {
        issuer: iss,
        authorization_endpoint: `${iss}/authorize`,
        token_endpoint: `${iss}/token`,
        device_authorization_endpoint: `${iss}/device/code`,
        tokeninfo_endpoint: `${iss}/tokeninfo`,
        grant_types_supported: ['authorization_code', 'refresh_token', 'urn:ietf:params:oauth:grant-type:device_code'],
        response_types_supported: ['code'],
        code_challenge_methods_supported: ['S256'],
        scopes_supported: ['moira.agent']
      }
    };
  }

  // --- authorization code flow (pkce s256) -----------------------------------

  // the consent step: the owner (or the host on the owner's behalf until
  // owner-session auth lands) chooses the persona. this method is called by
  // the http layer when an owner context is present; without one the http
  // layer must answer 401 (see handle()).
  mintAuthorizationCode(ownerCtx, { clientId, personaId, redirectUri, codeChallenge, state = null, codeChallengeMethod = 'S256' }) {
    if (codeChallengeMethod !== 'S256') throw new Error('code_challenge_method must be S256');
    if (!codeChallenge || typeof codeChallenge !== 'string') throw new Error('code_challenge required (pkce s256)');
    const agent = this.moira.agents.get(clientId);
    if (!agent || agent.revoked) throw new Error('unknown or revoked client');
    if (agent.personasAllowed.length > 0 && !agent.personasAllowed.includes(personaId)) {
      throw new Error('persona not allowed for this client');
    }
    const id = b64u(randomBytes(24));
    this.codes.set(id, {
      clientId, personaId,
      redirectUri,
      challenge: codeChallenge,
      state,
      expiresAt: this.now() + CODE_TTL_MS,
      used: false
    });
    return { code: id, state };
  }

  _tokenResponse(res, clientId, personaId) {
    const { outcome, accessToken, refreshToken, session } = this.moira.sessions.create({ clientId, personaId });
    if (outcome !== 'results') return res({ error: 'access_denied', error_description: outcome });
    return res({
      access_token: this.tokens.signAccess({ token: accessToken, clientId, personaId, sessionId: session.id }),
      token_type: 'Bearer',
      expires_in: Math.floor(this.tokens.accessTtlMs / 1000),
      refresh_token: this.tokens.signRefresh({ token: refreshToken, clientId, sessionId: session.id }),
      scope: 'moira.agent'
    });
  }

  // --- device flow (rfc 8628) -------------------------------------------------

  // client-side start: returns device_code + user_code. the record lands in
  // the store's pendingConnects collection, waiting for the owner.
  deviceCode({ clientId, agentName = null }) {
    const agent = this.moira.agents.get(clientId);
    if (!agent || agent.revoked) throw new Error('unknown or revoked client');
    const deviceCode = b64u(randomBytes(32));
    const userCode = String(Math.floor(100000 + Math.random() * 900000));
    const id = b64u(randomBytes(12));
    this.moira.store.put('pendingConnects', id, {
      id,
      kind: 'device_flow',
      deviceCode,
      userCode,
      clientId,
      agentName,
      status: 'pending',
      createdAt: this.now(),
      expiresAt: this.now() + DEVICE_TTL_MS
    });
    return {
      device_code: deviceCode,
      user_code: userCode,
      verification_uri: `${this.baseUrl}/device`,
      verification_uri_complete: `${this.baseUrl}/device?user_code=${userCode}`,
      expires_in: Math.floor(DEVICE_TTL_MS / 1000),
      interval: DEVICE_INTERVAL
    };
  }

  // --- token endpoint logic ----------------------------------------------------

  // returns the response object; the http layer writes it. errors use rfc 6749
  // shapes so generic clients handle them.
  token({ grant_type, ...rest }) {
    if (grant_type === 'authorization_code') return this._tokenCode(rest);
    if (grant_type === 'refresh_token') return this._tokenRefresh(rest);
    if (grant_type === 'urn:ietf:params:oauth:grant-type:device_code') return this._tokenDevice(rest);
    return { error: 'unsupported_grant_type' };
  }

  _tokenCode({ code, code_verifier, client_id, redirect_uri }) {
    const rec = this.codes.get(code);
    if (!rec || rec.used || rec.expiresAt < this.now()) {
      return { error: 'invalid_grant', error_description: 'code unknown, used, or expired' };
    }
    if (client_id !== rec.clientId || (redirect_uri !== undefined && redirect_uri !== rec.redirectUri)) {
      return { error: 'invalid_grant', error_description: 'client/redirect mismatch' };
    }
    if (!code_verifier || !eq(s256Challenge(code_verifier), rec.challenge)) {
      return { error: 'invalid_grant', error_description: 'pkce verification failed' };
    }
    rec.used = true;
    return this._tokenResponse((r) => r, rec.clientId, rec.personaId);
  }

  _tokenRefresh({ refresh_token }) {
    let claims;
    try {
      claims = this.tokens.verify(refresh_token, { type: 'refresh' });
    } catch (e) {
      return { error: 'invalid_grant', error_description: `bad refresh token: ${e.message}` };
    }
    const res = this.moira.sessions.refresh(claims.tok);
    if (res.outcome !== 'results') {
      return {
        error: res.outcome === 'expired' ? 'invalid_grant' : 'invalid_grant',
        error_description: `refresh ${res.outcome}${res.reason ? ': ' + res.reason : ''}`,
        ...(res.reason === 'replay_detected_family_revoked' ? { replay_detected: true } : {})
      };
    }
    const session = this.moira.store.get('sessions', claims.sid);
    if (!session) return { error: 'invalid_grant', error_description: 'session gone' };
    return {
      access_token: this.tokens.signAccess({ token: res.accessToken, clientId: claims.sub, personaId: session.personaId, sessionId: session.id }),
      token_type: 'Bearer',
      expires_in: Math.floor(this.tokens.accessTtlMs / 1000),
      refresh_token: this.tokens.signRefresh({ token: res.refreshToken, clientId: claims.sub, sessionId: session.id }),
      scope: 'moira.agent'
    };
  }

  _tokenDevice({ device_code, client_id }) {
    const pend = this.moira.store.list('pendingConnects', (p) => p.kind === 'device_flow' && p.deviceCode === device_code, {});
    const rec = pend[0];
    if (!rec || rec.clientId !== client_id) {
      return { error: 'invalid_grant', error_description: 'unknown device code' };
    }
    if (rec.expiresAt < this.now()) {
      return { error: 'expired_token', error_description: 'device code expired' };
    }
    if (rec.status === 'denied') {
      return { error: 'access_denied', error_description: 'the owner denied this device' };
    }
    if (rec.status === 'pending') {
      return { error: 'authorization_pending', error_description: 'the owner has not approved this device yet' };
    }
    // approved: rec carries the personaId the owner chose
    const out = this._tokenResponse((r) => r, rec.clientId, rec.personaId);
    this.moira.store.update('pendingConnects', rec.id, (p) => ({ ...p, status: 'completed' }));
    return out;
  }
}
