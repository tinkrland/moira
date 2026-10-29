// turnkey owner-session wiring (owner direction 2026-10-29: "be able to
// turnkey plug in"). the transport's /authorize needs a getOwnerContext(req)
// hook; until real owner auth (passkeys/oidc) lands, hosts either wire their
// own or use this reference verifier: one shared secret, constant-time
// compared, minting a real OwnerContext through the only legal path
// (moira.createOwnerContext).
//
// this is TURNKEY, not production auth: a shared secret is exactly what a
// single-host local deployment can hold. the gap stays stated in the readme.

import { timingSafeEqual } from 'node:crypto';

const parseCookie = (header, name) => {
  if (typeof header !== 'string') return null;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    if (part.slice(0, idx).trim() === name) return decodeURIComponent(part.slice(idx + 1).trim());
  }
  return null;
};

export function createOwnerSessionVerifier({ moira, secret, ownerRef = 'owner', header = 'x-moira-owner', cookieName = 'moira_owner' }) {
  if (!moira || typeof moira.createOwnerContext !== 'function') {
    throw new Error('createOwnerSessionVerifier requires the moira instance');
  }
  if (typeof secret !== 'string' || secret.length < 16) {
    throw new Error('owner secret must be a string of at least 16 characters');
  }
  const expected = Buffer.from(secret, 'utf8');

  const matches = (given) => {
    if (typeof given !== 'string' || given.length === 0) return false;
    const buf = Buffer.from(given, 'utf8');
    if (buf.length !== expected.length) return false; // length leak is unavoidable and harmless here
    return timingSafeEqual(buf, expected);
  };

  // returns getOwnerContext(req): an OwnerContext or null, never a throw
  return function verifyOwner(req) {
    const rawHeader = req?.headers?.[header];
    const candidates = [
      Array.isArray(rawHeader) ? rawHeader[0] : rawHeader,
      (() => {
        const auth = req?.headers?.authorization;
        return typeof auth === 'string' && /^bearer\s+/i.test(auth) ? auth.replace(/^bearer\s+/i, '') : null;
      })(),
      parseCookie(req?.headers?.cookie, cookieName)
    ];
    if (!candidates.some(matches)) return null;
    return moira.createOwnerContext({ kind: 'owner_session', verified: true, ownerRef });
  };
}
