// receipt ledger (spec section 16). append-only, signed, content-free.
// a receipt records what happened (op), who (actor), when, which persona,
// which rung, how much money. it never records fact content.
//
// this is the audit backbone: every read, proposal, bridge use, pass grant,
// pack, handoff, lease and spend writes exactly one receipt.

import { randomId, canonicalJson } from '../util/crypto.js';
import { RECEIPT_OP } from '../model/constants.js';

const ALLOWED_OPS = new Set(Object.values(RECEIPT_OP));

export class ReceiptLedger {
  constructor({ store, keys, now = Date.now, traceOf = null, traces = null }) {
    this.store = store;
    this.keys = keys;
    this.now = now;
    // traceOf() returns the trace in scope (or null). traces stamps the sequence.
    // both are optional so an untraced moira behaves exactly as before.
    this.traceOf = traceOf;
    this.traces = traces;
  }

  write({ actor, personaId, op, categories = [], rung = null, factCount = null, bridgeId = null, handoffId = null, packId = null, amount = null, unit = null, reason = null }) {
    if (!ALLOWED_OPS.has(op)) throw new Error(`unknown receipt op: ${op}`);

    // a trace in scope stamps the receipt. a closed trace refuses the write
    // rather than letting work hide inside a finished story.
    const traceId = this.traceOf ? this.traceOf() : null;
    let seq = null;
    if (traceId) {
      const stamp = this.traces ? this.traces.nextSeq(traceId) : { error: 'trace_not_found' };
      if (stamp.error) {
        const err = new Error(stamp.error);
        err.code = stamp.error;
        throw err;
      }
      seq = stamp.seq;
    }

    const record = {
      id: randomId('rcpt'),
      ts: this.now(),
      actor: actor || 'owner',
      personaId,
      op,
      categories,
      rung,
      factCount,
      bridgeId,
      handoffId,
      packId,
      amount,
      unit,
      reason,
      traceId,
      seq
    };
    record.signature = this.keys.signReceipt(record);
    return this.store.append('receipts', record);
  }

  // queryable per persona (moira audit_receipts tool). never cross-persona by
  // default: a persona sees its own receipts only.
  query({ personaId, since = null, op = null }) {
    return this.store
      .list('receipts', (r) => r.personaId === personaId, { personaId })
      .filter((r) => (since === null || r.ts >= since) && (op === null || r.op === op))
      .sort((a, b) => a.ts - b.ts)
      .map((r) => ({ ...r, valid: this.keys.verifyReceipt(r) }));
  }

  verifyAll() {
    return this.store.list('receipts').every((r) => this.keys.verifyReceipt(r));
  }

  // delete-persona (section 16): receipts keep only content-free stubs. we
  // drop category detail and keep op/ts/actor, which contain no content.
  stubPersona(personaId) {
    const receipts = this.store.list('receipts', (r) => r.personaId === personaId, { personaId });
    for (const r of receipts) {
      this.store.update('receipts', r.id, (rec) => {
        const stub = {
          id: rec.id,
          ts: rec.ts,
          actor: rec.actor,
          personaId: null,
          op: rec.op,
          categories: [],
          rung: null,
          factCount: null,
          bridgeId: null,
          handoffId: null,
          packId: null,
          amount: rec.amount,
          unit: rec.unit,
          reason: null
        };
        // marker for the supabase receipts append-only trigger: the only
        // permitted update shape is exactly this signed deletion stub.
        stub.stubbed = true;
        stub.signature = this.keys.signReceipt(stub);
        return stub;
      });
    }
    return receipts.length;
  }

  fingerprint() {
    // deterministic state hash, for the conformance suite (section 21.1).
    const rows = this.store.list('receipts').map((r) => canonicalJson(r)).sort();
    let h = 0;
    for (const row of rows) {
      for (let i = 0; i < row.length; i++) {
        h = (h * 31 + row.charCodeAt(i)) | 0;
      }
    }
    return `${rows.length}:${h}`;
  }
}
