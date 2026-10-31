// directed disclosure (section 11, the ego.ist shape).
//
// an app needs selected protected fields delivered to ONE exact https
// destination - one it does not control the response of, and one it must not
// be handed the values for. the owner approves, moira delivers once,
// server-to-server, and the app gets back a content-free status plus a signed
// attestation. the values never enter the app's response, at any status:
// pending, delivered, denied or failed.
//
// one request, one delivery. retrying is a new ask and a new owner decision.

import { randomId, signPayload } from '../util/crypto.js';
import { checkDestination } from '../util/netguard.js';
import { OUTCOME, RECEIPT_OP } from '../model/constants.js';

const STATUS = { PENDING: 'pending', DELIVERED: 'delivered', DENIED: 'denied', FAILED: 'failed' };

export class DisclosureService {
  constructor({ store, personas, facts, keys, receipts, netguard = {}, now = Date.now }) {
    this.store = store;
    this.netguard = netguard;
    this.personas = personas;
    this.facts = facts;
    this.keys = keys;
    this.receipts = receipts;
    this.now = now;
  }

  // exact destination: https, no credentials, no fragment. a query string is
  // allowed (hooks often need one) but the origin+path is what the owner sees.
  static destinationOk(destination) {
    try {
      const u = new URL(String(destination));
      return u.protocol === 'https:' && !u.username && !u.password && !u.hash;
    } catch { return false; }
  }

  request({ personaId, clientId, fields, destination, purpose }) {
    const persona = this.personas.get(personaId);
    if (!persona) return { outcome: OUTCOME.UNAVAILABLE, reason: 'persona_not_found' };
    if (!DisclosureService.destinationOk(destination)) {
      return { outcome: OUTCOME.DECLINED, reason: 'destination_must_be_exact_https' };
    }
    if (!Array.isArray(fields) || fields.length === 0 || !fields.every((f) => typeof f === 'string' && f.trim() !== '')) {
      return { outcome: OUTCOME.DECLINED, reason: 'fields_required' };
    }
    if (!purpose || String(purpose).trim() === '') return { outcome: OUTCOME.DECLINED, reason: 'purpose_required' };

    const record = {
      id: randomId('disc'),
      personaId,
      clientId,
      fields: [...new Set(fields.map((f) => String(f).trim().toLowerCase()))],
      destination: String(destination),
      purpose: String(purpose).trim(),
      status: STATUS.PENDING,
      createdAt: this.now(),
      deliveredAt: null,
      attestation: null
    };
    this.store.put('disclosures', record.id, record);
    this.receipts.write({ actor: clientId, personaId, op: RECEIPT_OP.DISCLOSURE, reason: 'requested' });
    return { outcome: OUTCOME.APPROVAL_REQUIRED, disclosureId: record.id };
  }

  list({ personaId = null, status = null } = {}) {
    return this.store.list('disclosures', (d) =>
      (personaId === null || d.personaId === personaId) && (status === null || d.status === status))
      .sort((a, b) => b.createdAt - a.createdAt);
  }

  deny({ disclosureId, reason = null }) {
    const rec = this.store.get('disclosures', disclosureId);
    if (!rec) return { outcome: OUTCOME.UNAVAILABLE, reason: 'disclosure_not_found' };
    if (rec.status !== STATUS.PENDING) return { outcome: OUTCOME.DECLINED, reason: 'disclosure_already_decided' };
    const next = this.store.update('disclosures', disclosureId, (d) => ({
      ...d, status: STATUS.DENIED, decidedAt: this.now(), denialReason: reason ? String(reason).slice(0, 300) : null
    }));
    this.receipts.write({ actor: 'owner', personaId: rec.personaId, op: RECEIPT_OP.DISCLOSURE, reason: 'denied' });
    return { outcome: OUTCOME.RESULTS, disclosure: next };
  }

  // approval is the delivery. the host passes `deliver(destination, payload)`;
  // moira builds the payload from the addressed fields, calls it once, and
  // records the outcome. nothing about values flows back to the caller here
  // beyond what the owner already owns.
  async approve({ disclosureId, deliver }) {
    const rec = this.store.get('disclosures', disclosureId);
    if (!rec) return { outcome: OUTCOME.UNAVAILABLE, reason: 'disclosure_not_found' };
    if (rec.status !== STATUS.PENDING) {
      return { outcome: OUTCOME.DECLINED, reason: rec.status === STATUS.DELIVERED ? 'already_delivered' : 'disclosure_already_decided' };
    }
    if (typeof deliver !== 'function') return { outcome: OUTCOME.DECLINED, reason: 'deliver_required' };

    // the target is judged before anything is opened: private ranges, loopback
    // and cloud metadata are refused, because a delivery endpoint that resolves
    // inward is an exfiltration gadget wearing this feature's name.
    const verdict = await checkDestination(rec.destination, this.netguard ?? {});
    if (!verdict.allowed) {
      const next = this.store.update('disclosures', disclosureId, (x) => ({
        ...x, status: STATUS.FAILED, decidedAt: this.now(), failure: verdict.reason
      }));
      this.receipts.write({ actor: 'owner', personaId: rec.personaId, op: RECEIPT_OP.DISCLOSURE, reason: `blocked_${verdict.reason}` });
      return { outcome: OUTCOME.DECLINED, reason: verdict.reason, disclosure: next };
    }

    const values = this._values(rec);
    if (values.length === 0) {
      const next = this.store.update('disclosures', disclosureId, (d) => ({ ...d, status: STATUS.FAILED, decidedAt: this.now(), failure: 'nothing_to_disclose' }));
      this.receipts.write({ actor: 'owner', personaId: rec.personaId, op: RECEIPT_OP.DISCLOSURE, reason: 'failed_empty' });
      return { outcome: OUTCOME.RESULTS, disclosure: next };
    }

    const payload = {
      disclosureId: rec.id,
      purpose: rec.purpose,
      fields: rec.fields,
      values,
      issuedAt: this.now()
    };

    let res;
    try {
      res = await deliver(rec.destination, payload);
    } catch {
      res = { ok: false };
    }
    const ok = res && (res.ok === true || (typeof res.status === 'number' && res.status >= 200 && res.status < 300));

    if (!ok) {
      const next = this.store.update('disclosures', disclosureId, (d) => ({
        ...d, status: STATUS.FAILED, decidedAt: this.now(), failure: 'delivery_failed'
      }));
      this.receipts.write({ actor: 'owner', personaId: rec.personaId, op: RECEIPT_OP.DISCLOSURE, reason: 'failed' });
      return { outcome: OUTCOME.RESULTS, disclosure: next };
    }

    // attestation: content-free proof of what happened, signed over the
    // identifiers only - never the values.
    const attestation = signPayload(this.keys.personaKey(rec.personaId), {
      kind: 'directed_disclosure',
      disclosureId: rec.id,
      destination: rec.destination,
      fields: rec.fields,
      deliveredAt: this.now()
    });
    const next = this.store.update('disclosures', disclosureId, (d) => ({
      ...d, status: STATUS.DELIVERED, deliveredAt: this.now(), attestation
    }));
    this.receipts.write({ actor: 'owner', personaId: rec.personaId, op: RECEIPT_OP.DISCLOSURE, reason: 'delivered' });
    return { outcome: OUTCOME.RESULTS, disclosure: next, attestation };
  }

  // the app's view. status, times, attestation, the field paths it asked for.
  // no values, ever - the whole point of directed disclosure.
  status({ clientId, disclosureId }) {
    const rec = this.store.get('disclosures', disclosureId);
    if (!rec) return { outcome: OUTCOME.UNAVAILABLE, reason: 'disclosure_not_found' };
    if (rec.clientId !== clientId) return { outcome: OUTCOME.UNAVAILABLE, reason: 'disclosure_not_found' };
    return {
      outcome: OUTCOME.RESULTS,
      disclosureId: rec.id,
      status: rec.status,
      fields: rec.fields,
      deliveredAt: rec.deliveredAt,
      attestation: rec.attestation,
      failure: rec.failure ?? null
    };
  }

  // addressed field -> value. only facts that authored the field, only at
  // full rung (the owner approved a delivery, not a summary).
  _values(rec) {
    const wanted = new Set(rec.fields.map((f) => f.toLowerCase()));
    const out = [];
    for (const fact of this.facts.active(rec.personaId)) {
      const opened = this.facts.open(rec.personaId, fact);
      if (opened.locked) continue;
      for (const field of opened.fields ?? []) {
        const path = `${opened.category}.${field}`.toLowerCase();
        if (!wanted.has(path)) continue;
        out.push({ field: path, value: opened.content });
      }
    }
    return out;
  }
}
