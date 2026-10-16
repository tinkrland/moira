// linkage service (spec 22.4 v1 hooks): keeps different personas isolated by
// warning, at the moment of risk, when a new account would create an
// undeclared link between decoupled personas, and by preferring accounts that
// do not create links during routing.
//
// design notes, honestly scoped:
//   - comparisons run on the ledger's existing keyed payer hashes
//     (keys.payerHash). plaintext payer labels are never stored or compared,
//     and findings carry kinds, never values.
//   - the v1 hook is payer-label only. the fuller on-device monitor
//     (device-held hmac key, soft signals, the persona map) is the owner's
//     side of section 22 and stays out of the broker path.
//   - findings never reach agents. the agent surface (budget_route) sees
//     plain ranking; the linkage detail is opt-in for the owner view.

import { LINKAGE_KIND } from '../model/constants.js';

export class LinkageService {
  constructor({ store, personas, ledger, keys, now = Date.now }) {
    this.store = store;
    this.personas = personas;
    this.ledger = ledger;
    this.keys = keys;
    this.now = now;
  }

  pairKey(a, b) {
    return [a, b].sort().join('|');
  }

  // a declaration silences a pair permanently (declared) or until it expires
  // (acknowledged). expired acknowledgements no longer silence anything.
  declarationActive(personaA, personaB) {
    const d = this.store.get('linkageDeclarations', this.pairKey(personaA, personaB));
    if (!d) return false;
    if (d.expiresAt == null) return true; // declared: solid line, permanent
    return d.expiresAt > this.now();
  }

  _decoupled(persona) {
    return persona.identity === 'pseudonymous' || persona.identity === 'heteronymous';
  }

  // would adding `payerLabel` for personaId create an undeclared link with a
  // decoupled persona? returns a finding or null. called BEFORE the link is
  // made (moment of risk), so the owner can choose.
  preLinkCheck(personaId, payerLabel) {
    if (payerLabel == null || String(payerLabel).trim() === '') return null;
    const self = this.personas.get(personaId);
    if (!self) return null;
    const hash = this.keys.payerHash(payerLabel);
    for (const other of this.personas.list()) {
      if (other.id === personaId) continue;
      // linked<->linked sharing is the owner being one person on purpose;
      // a finding requires at least one decoupled side
      if (!this._decoupled(self) && !this._decoupled(other)) continue;
      if (this.declarationActive(self.id, other.id)) continue;
      const shares = this.ledger.list(other.id).some((a) => a.payerHash === hash);
      if (shares) {
        return {
          personaIds: [self.id, other.id].sort(),
          kind: LINKAGE_KIND.PAYER,
          hard: true, // payment method is a unique attribute (22.2)
          advisory: true,
          note: 'a finding is a possible link, not a ruling; no finding does not mean safe'
        };
      }
    }
    return null;
  }

  // accounts of personaId whose payer hash is shared with another persona
  // (undeclared, at least one decoupled side). routing demotes these below
  // clean accounts and reports them to the owner view only.
  flaggedAccounts(personaId) {
    const self = this.personas.get(personaId);
    if (!self) return new Map();
    const flagged = new Map(); // accountId -> otherPersonaId (the link target)
    for (const account of this.ledger.list(personaId)) {
      if (!account.payerHash) continue;
      for (const other of this.personas.list()) {
        if (other.id === personaId) continue;
        if (!this._decoupled(self) && !this._decoupled(other)) continue;
        if (this.declarationActive(self.id, other.id)) continue;
        if (this.ledger.list(other.id).some((a) => a.payerHash === account.payerHash)) {
          flagged.set(account.id, other.id);
          break;
        }
      }
    }
    return flagged;
  }
}
