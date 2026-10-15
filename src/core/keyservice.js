// key service (spec section 6: "key service"). holds per-persona keys and
// per-category subkeys, seals and opens vault payloads, signs receipts, and
// shreds keys on persona deletion. raw secrets never leave this module; the
// rest of the system sees opaque secret_refs and sealed envelopes.
//
// production notes (documented, not faked here):
//   - persona keys are passkey-derived in production; this build generates
//     them and holds them in memory. the interface (derive/shred) is the same.
//   - resource-account secrets are sealed with a separate ledger key so that
//     vault compromise does not expose billing credentials (section 15.13).

import { VaultKeyUnavailableError } from './errors.js';
import {
  newSecret, deriveKey, seal, open, signPayload, verifyPayloadSig, randomId, pairwiseSub, hmacHex
} from '../util/crypto.js';

const VAULT_PREFIX = 'moira-vault-v1';
const LEDGER_PREFIX = 'moira-ledger-v1';

export class KeyService {
  constructor({ instanceKey = newSecret(), ledgerKey = null, keyStore = null, now = Date.now } = {}) {
    this.instanceKey = instanceKey;
    // ledger and payer-hash domains are derived (deterministic) so sealed
    // account secrets and payer hashes stay valid across restarts. persona
    // vault keys are the only random-and-wrapped keys (shred semantics).
    this.ledgerKey = ledgerKey ?? deriveKey(instanceKey, 'ledger-domain');
    this.payerHashKey = deriveKey(instanceKey, 'payer-hash-domain');
    this.keyStore = keyStore; // a store instance; null = in-memory only
    this.now = now;
    this.personaKeys = new Map(); // personaId -> Buffer (wrapped at rest)
  }

  // --- persona keys ---------------------------------------------------------

  personaKey(personaId) {
    // randomly generated once per persona, never derived from the instance
    // key, so key shredding is irreversible (section 16). when a keyStore is
    // attached (persistent deployments, e.g. supabase) the key is stored
    // wrapped under the instance key, so vaults survive restarts; shredding
    // deletes the wrap.
    if (!this.personaKeys.has(personaId)) {
      let key = null;
      if (this.keyStore) {
        const wrap = this.keyStore.get('keywraps', personaId);
        if (wrap) {
          // a wrap row exists: it MUST unwrap. a failure means a tampered
          // wrap or a different MOIRA_INSTANCE_KEY. surfacing it as
          // VaultKeyUnavailableError instead of crashing (Buffer.from(null))
          // or silently generating a replacement key over an existing wrap
          // (which would orphan every sealed record under the old key).
          const unwrapped = this._unwrapKey(personaId, wrap.sealed);
          if (unwrapped === null) {
            throw new VaultKeyUnavailableError(
              personaId,
              'a stored key wrap exists but cannot be unwrapped (tampered wrap, or MOIRA_INSTANCE_KEY differs from the one that wrote it); refusing to generate a replacement key'
            );
          }
          key = Buffer.from(unwrapped, 'base64');
        }
      }
      if (!key) {
        // no wrap existed: genuinely new persona, safe to mint + wrap.
        key = newSecret();
        if (this.keyStore) {
          if (this.keyStore.get('keywraps', personaId)) {
            throw new VaultKeyUnavailableError(personaId, 'key wrap appeared while minting; refusing to overwrite');
          }
          this.keyStore.put('keywraps', personaId, {
            id: personaId, sealed: this._wrapKey(personaId, key)
          });
        }
      }
      this.personaKeys.set(personaId, key);
    }
    return this.personaKeys.get(personaId);
  }

  _wrapKey(personaId, key) {
    const wrapKey = deriveKey(this.instanceKey, `keywrap:${personaId}`);
    return seal(wrapKey, key.toString('base64'), `moira-keywrap-v1:${personaId}`);
  }

  _unwrapKey(personaId, sealed) {
    const wrapKey = deriveKey(this.instanceKey, `keywrap:${personaId}`);
    try {
      return open(wrapKey, sealed, `moira-keywrap-v1:${personaId}`);
    } catch {
      return null; // tampered wrap or wrong instance key: treat as shredded
    }
  }

  categoryKey(personaId, category) {
    return deriveKey(this.personaKey(personaId), `category:${category}`);
  }

  // key shredding (section 16): delete the key; ciphertext becomes unreadable.
  shredPersona(personaId) {
    this.personaKeys.delete(personaId);
    if (this.keyStore) this.keyStore.del('keywraps', personaId);
  }

  hasKeyFor(personaId) {
    return this.personaKeys.has(personaId);
  }

  // --- vault sealing ---------------------------------------------------------

  sealPayload(personaId, category, recordId, value) {
    const key = this.categoryKey(personaId, category);
    const aad = `${VAULT_PREFIX}:${personaId}:${category}:${recordId}`;
    return seal(key, JSON.stringify(value), aad);
  }

  openPayload(personaId, category, recordId, envelope) {
    const key = this.categoryKey(personaId, category);
    const aad = `${VAULT_PREFIX}:${personaId}:${category}:${recordId}`;
    try {
      return JSON.parse(open(key, envelope, aad));
    } catch {
      return null; // wrong key (shredded) or tampered ciphertext
    }
  }

  // --- ledger secrets (separate key domain) ----------------------------------

  sealSecret(personaId, accountId, secret) {
    const key = deriveKey(this.ledgerKey, `ledger:${personaId}`);
    const aad = `${LEDGER_PREFIX}:${personaId}:${accountId}`;
    return seal(key, secret, aad);
  }

  openSecret(personaId, accountId, envelope) {
    const key = deriveKey(this.ledgerKey, `ledger:${personaId}`);
    const aad = `${LEDGER_PREFIX}:${personaId}:${accountId}`;
    try {
      return open(key, envelope, aad);
    } catch {
      return null;
    }
  }

  // --- receipts --------------------------------------------------------------

  signReceipt(record) {
    const { signature, ...payload } = record;
    return signPayload(this.instanceKey, payload);
  }

  verifyReceipt(record) {
    const { signature, ...payload } = record;
    return verifyPayloadSig(this.instanceKey, payload, signature);
  }

  // --- identifiers ------------------------------------------------------------

  pairwiseSub(personaId, clientId) {
    return pairwiseSub(this.instanceKey, personaId, clientId);
  }

  newAccountId() {
    return randomId('acct');
  }

  // keyed hash of a payer label (section 22.3 v1 hook). in production this key
  // is device-held; here it is generated per instance and never exposed, so
  // the broker-side store holds only hashes it cannot invert.
  payerHash(payerLabel) {
    return hmacHex(this.payerHashKey, `payer:${String(payerLabel).toLowerCase().trim()}`);
  }
}
