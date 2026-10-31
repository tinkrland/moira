// traces: one unit of work, one chain.
//
// the receipts ledger answered "who saw what" and could not answer "who did
// what, on whose behalf, in what order, with what outcome". ordering was
// timestamp-only, so two crossings in the same millisecond had no order at all,
// and nothing linked the grant to the read it was granted for.
//
// a trace is deliberately small: an id, a label, whose behalf the work ran on,
// a status, and a sequence number stamped onto each receipt as it happens. it
// adds no content, no inference and no policy. it is a correlation, and its
// only job is that the story can be reconstructed after the fact.

import { randomId } from '../util/crypto.js';

export const TRACE_STATUS = { OPEN: 'open', COMPLETED: 'completed', ABANDONED: 'abandoned' };

export class TraceService {
  constructor({ store, receipts, now = Date.now }) {
    this.store = store;
    this.receipts = receipts;
    this.now = now;
  }

  begin({ label, personaId = null, onBehalfOf = null, actor = 'owner' }) {
    if (typeof label !== 'string' || label.trim() === '') {
      return { outcome: 'declined', reason: 'label_required' };
    }
    const trace = {
      id: randomId('trc'),
      label: label.trim().slice(0, 200),
      personaId,
      onBehalfOf,
      actor,
      status: TRACE_STATUS.OPEN,
      startedAt: this.now(),
      endedAt: null,
      outcome: null
    };
    this.store.put('traces', trace.id, trace);
    return trace;
  }

  get(traceId) {
    return this.store.get('traces', traceId);
  }

  list({ status = null, limit = 50 } = {}) {
    return this.store
      .list('traces', (t) => (status ? t.status === status : true), { status })
      .sort((a, b) => b.startedAt - a.startedAt)
      .slice(0, limit);
  }

  end(traceId, { outcome = TRACE_STATUS.COMPLETED } = {}) {
    const trace = this.get(traceId);
    if (!trace) return { outcome: 'unavailable', reason: 'trace_not_found' };
    if (trace.status !== TRACE_STATUS.OPEN) return { outcome: 'declined', reason: 'trace_already_ended' };
    const next = this.store.update('traces', traceId, (t) => ({
      ...t,
      status: outcome,
      endedAt: this.now()
    }));
    return next;
  }

  // called by the ledger for every receipt while a trace is in scope. open
  // traces only: work cannot be appended to a finished story.
  nextSeq(traceId) {
    const trace = this.get(traceId);
    if (!trace) return { error: 'trace_not_found' };
    if (trace.status !== TRACE_STATUS.OPEN) return { error: 'trace_closed' };
    const existing = this.store.list('receipts', (r) => r.traceId === traceId, { traceId });
    return { seq: existing.length + 1 };
  }

  receiptsFor(traceId) {
    const trace = this.get(traceId);
    if (!trace) return null;
    const receipts = this.store
      .list('receipts', (r) => r.traceId === traceId, { traceId })
      .sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0));
    return {
      traceId: trace.id,
      label: trace.label,
      status: trace.status,
      personaId: trace.personaId,
      onBehalfOf: trace.onBehalfOf,
      startedAt: trace.startedAt,
      endedAt: trace.endedAt,
      receipts
    };
  }
}
