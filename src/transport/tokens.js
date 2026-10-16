// signed tokens (JOSE: JWS HS256 compact, JWT claims) for the transport layer.
//
// the core keeps opaque token ids (sessions/tokens collections, replay
// detection, family revocation). the transport WRAPS them: the wire format is
// a signed JWT whose `tok` claim is the opaque id. verification is two-step:
// cryptographic (signature + expiry) then semantic (sessions.resolve on the
// opaque id), so every core protection (revocation, rotation, agent revoke)
// still applies in real time. a stolen, unexpired jwt dies the moment the
// owner revokes the session.
//
// zero dependencies: node:crypto hmac only. key: MOIRA_TOKEN_KEY env (hex of
// 32 bytes, `openssl rand -hex 32`) or an explicit Buffer in options.

import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

const SUPPORTED_ALGS = new Set(['HS256']);

export class TokenService {
  constructor({ key = process.env.MOIRA_TOKEN_KEY, issuer = 'moira', now = Date.now, accessTtlMs = 15 * 60 * 1000 } = {}) {
    if (!key) throw new Error('MOIRA_TOKEN_KEY required (openssl rand -hex 32)');
    this.key = typeof key === 'string' ? Buffer.from(key, 'hex') : key;
    if (this.key.length !== 32) throw new Error('MOIRA_TOKEN_KEY must be hex of 32 bytes');
    this.issuer = issuer;
    this.now = now;
    this.accessTtlMs = accessTtlMs;
  }

  _b64url(input) { return Buffer.from(input).toString('base64url'); }

  _sign(data) {
    return createHmac('sha256', this.key).update(data).digest('base64url');
  }

  // wrap an opaque session token id into a signed access jwt.
  signAccess({ token, clientId, personaId, sessionId }) {
    const iat = Math.floor(this.now() / 1000);
    const header = { alg: 'HS256', typ: 'JWT' };
    const payload = {
      iss: this.issuer,
      aud: 'moira-agent',
      sub: clientId,
      typ: 'access',
      tok: token,
      pid: personaId,
      sid: sessionId,
      iat,
      exp: iat + Math.floor(this.accessTtlMs / 1000)
    };
    const h = this._b64url(JSON.stringify(header));
    const p = this._b64url(JSON.stringify(payload));
    return `${h}.${p}.${this._sign(`${h}.${p}`)}`;
  }

  // wrap an opaque refresh token id. short-lived jti-rotation stays in the
  // core; the jwt only carries it.
  signRefresh({ token, clientId, sessionId }) {
    const iat = Math.floor(this.now() / 1000);
    const h = this._b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
    const p = this._b64url(JSON.stringify({
      iss: this.issuer, aud: 'moira-agent', sub: clientId,
      typ: 'refresh', tok: token, sid: sessionId, iat
    }));
    return `${h}.${p}.${this._sign(`${h}.${p}`)}`;
  }

  // verify a jwt. returns the claims or throws (bad signature, wrong alg,
  // expired, malformed). NEVER falls back to treating the string as a bare
  // opaque id: the transport surface accepts only signed tokens.
  verify(jwt, { type = null } = {}) {
    const parts = String(jwt || '').split('.');
    if (parts.length !== 3) throw new Error('malformed jwt');
    const [h, p, s] = parts;
    let header, payload;
    try {
      header = JSON.parse(Buffer.from(h, 'base64url').toString('utf8'));
      payload = JSON.parse(Buffer.from(p, 'base64url').toString('utf8'));
    } catch { throw new Error('malformed jwt'); }
    if (!SUPPORTED_ALGS.has(header.alg)) throw new Error('unsupported alg');
    if (!header.typ || header.typ !== 'JWT') throw new Error('wrong typ');
    const expected = this._sign(`${h}.${p}`);
    const a = Buffer.from(s);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) throw new Error('bad signature');
    if (payload.iss !== this.issuer) throw new Error('wrong issuer');
    if (payload.aud !== 'moira-agent') throw new Error('wrong audience');
    if (type && payload.typ !== type) throw new Error(`wrong token type (wanted ${type})`);
    if (typeof payload.tok !== 'string' || !payload.tok) throw new Error('no token claim');
    if (payload.typ === 'access' && payload.exp !== undefined) {
      if (payload.exp < Math.floor(this.now() / 1000)) throw new Error('expired');
    }
    return payload;
  }

  // token-info / introspection (rfc 7662 shape). resolves the opaque token
  // through the gateway's session service, so revoked sessions introspect as
  // inactive even with a cryptographically valid jwt.
  introspect(jwt, gateway) {
    let claims;
    try { claims = this.verify(jwt); } catch { return { active: false }; }
    const res = gateway.sessions.resolve(claims.tok);
    if (res.outcome !== 'results') return { active: false };
    return {
      active: true,
      token_type: claims.typ === 'access' ? 'Bearer' : 'refresh',
      sub: res.clientId,
      persona_id: res.personaId,
      session_id: res.sessionId,
      iss: this.issuer,
      exp: claims.exp ?? null
    };
  }
}

// pkce s256: challenge = base64url(sha256(ascii(verifier))), no padding.
export function s256Challenge(verifier) {
  return createHash('sha256').update(verifier, 'ascii').digest('base64url');
}
