// signed token service (JOSE/JWT, phase 2): sign/verify/introspect, and the
// guarantees that matter: tampered signatures rejected, expiry enforced,
// revocation live through the opaque-id resolution.

import test from 'node:test';
import assert from 'node:assert/strict';
import { TokenService, s256Challenge } from '../src/transport/tokens.js';
import { Moira } from '../src/index.js';

const KEY = 'ab'.repeat(32);
const ownerSession = () => ({ kind: 'owner_session', verified: true, ownerRef: 'owner' });

function fixture() {
  const m = new Moira({});
  const ctx = m.createOwnerContext(ownerSession());
  const persona = m.owner.createPersona(ctx, { name: 'student', identity: 'linked' });
  const agentId = m.owner.registerAgent(ctx, { name: 'helper', tier: 'verified', personasAllowed: [persona.id], spendCaps: { usd: 15 } }).id;
  const sess = m.owner.createSession(ctx, { clientId: agentId, personaId: persona.id });
  return { m, ctx, persona, agentId, sess };
}

test('tokens: sign and verify roundtrip carries the opaque id and identity', () => {
  const { m, agentId, persona, sess } = fixture();
  const t = new TokenService({ key: KEY, now: m.now });
  const jwt = t.signAccess({ token: sess.accessToken, clientId: agentId, personaId: persona.id, sessionId: sess.session.id });
  const claims = t.verify(jwt, { type: 'access' });
  assert.equal(claims.tok, sess.accessToken);
  assert.equal(claims.sub, agentId);
  assert.equal(claims.pid, persona.id);
});

test('tokens: tampered payload rejected; wrong key rejected; bare ids never accepted', () => {
  const { m, agentId, persona, sess } = fixture();
  const t = new TokenService({ key: KEY, now: m.now });
  const jwt = t.signAccess({ token: sess.accessToken, clientId: agentId, personaId: persona.id, sessionId: sess.session.id });
  const [h, p, s] = jwt.split('.');
  const forgedPayload = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(p, 'base64url').toString()), sub: 'attacker' })).toString('base64url');
  assert.throws(() => t.verify(`${h}.${forgedPayload}.${s}`), /bad signature/);
  const other = new TokenService({ key: 'cd'.repeat(32), now: m.now });
  assert.throws(() => other.verify(jwt), /bad signature/);
  assert.throws(() => t.verify(sess.accessToken), /malformed/); // opaque ids are NOT valid at the transport
});

test('tokens: expiry enforced against the clock, not just claims', () => {
  const { m, agentId, persona, sess } = fixture();
  let clock = 1_000_000;
  const t = new TokenService({ key: KEY, now: () => clock, accessTtlMs: 60_000 });
  const jwt = t.signAccess({ token: sess.accessToken, clientId: agentId, personaId: persona.id, sessionId: sess.session.id });
  clock += 30_000;
  t.verify(jwt); // still fresh
  clock += 60_000;
  assert.throws(() => t.verify(jwt), /expired/);
});

test('tokens: introspection goes through session resolution - revoked sessions are inactive', () => {
  const { m, ctx, agentId, persona, sess } = fixture();
  const t = new TokenService({ key: KEY, now: m.now });
  const jwt = t.signAccess({ token: sess.accessToken, clientId: agentId, personaId: persona.id, sessionId: sess.session.id });
  const active = t.introspect(jwt, m);
  assert.equal(active.active, true);
  assert.equal(active.sub, agentId);
  assert.equal(active.persona_id, persona.id);
  m.sessions.revokeSession(sess.session.id); // revocation path (owner surface wires here later)
  const dead = t.introspect(jwt, m);
  assert.equal(dead.active, false);
});

test('tokens: pkce s256 challenge matches the rfc 7636 appendix b vector', () => {
  // the canonical known-answer vector from rfc 7636 appendix b
  assert.equal(
    s256Challenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'),
    'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM'
  );
});
