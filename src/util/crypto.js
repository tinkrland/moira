// crypto primitives. node built-ins only. this module is the only place that
// touches raw key material.
//
// key hierarchy (spec section 6, 12):
//   instance key (generated per deployment; in production derived from owner passkey)
//     -> persona key (one per persona, generated at persona creation)
//        -> category subkey (HKDF-derived per category; one key per category per persona)
//
// receipt signing and pairwise subject derivation use the instance key.
// "shred" = deleting a persona key renders its vault ciphertext unreadable (section 16).

import {
  createHmac, hkdfSync, createCipheriv, createDecipheriv, randomBytes, timingSafeEqual
} from 'node:crypto';

const enc = new TextEncoder();

export function randomId(prefix) {
  return `${prefix}_${randomBytes(12).toString('hex')}`;
}

export function newSecret(bytes = 32) {
  return randomBytes(bytes);
}

export function hmacHex(key, data) {
  return createHmac('sha256', key).update(enc.encode(data)).digest('hex');
}

export function hmacEqual(a, b) {
  const ab = Buffer.from(String(a), 'utf8');
  const bb = Buffer.from(String(b), 'utf8');
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

export function deriveKey(master, info) {
  return Buffer.from(hkdfSync('sha256', master, Buffer.alloc(0), enc.encode(info), 32));
}

// canonical json for signing. stable key order, no whitespace.
export function canonicalJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(',')}}`;
}

export function signPayload(key, payload) {
  return hmacHex(key, canonicalJson(payload));
}

export function verifyPayloadSig(key, payload, sig) {
  return hmacEqual(signPayload(key, payload), sig);
}

// AES-256-GCM envelope. aad binds the envelope to its container (persona id,
// category, record id) so ciphertext cannot be moved between records.
export function seal(key, plaintext, aad) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(enc.encode(aad));
  const ct = Buffer.concat([cipher.update(enc.encode(plaintext)), cipher.final()]);
  const tag = cipher.getAuthTag();
  return { iv: iv.toString('base64'), tag: tag.toString('base64'), ct: ct.toString('base64') };
}

export function open(key, envelope, aad) {
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(envelope.iv, 'base64'));
  decipher.setAAD(enc.encode(aad));
  decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'));
  const pt = Buffer.concat([decipher.update(Buffer.from(envelope.ct, 'base64')), decipher.final()]);
  return new TextDecoder().decode(pt);
}

// pairwise subject identifier per (persona, client) (section 13): the same
// persona shows different subs to different apps. derived, never stored.
export function pairwiseSub(instanceKey, personaId, clientId) {
  return `sub_${hmacHex(instanceKey, `pairwise-sub:${personaId}:${clientId}`).slice(0, 32)}`;
}

// device-side keyed hash for linkage attributes (section 22.3). keyed with a
// device-held key, never the broker instance key, so the broker cannot brute
// force values even if the hash store leaks. this function is pure; the
// on-device monitor owns its key.
export function linkageHash(deviceKey, kind, value) {
  return hmacHex(deviceKey, `linkage:${kind}:${value.toLowerCase().trim()}`);
}
