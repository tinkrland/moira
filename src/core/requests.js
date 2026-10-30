// access requests: the app-initiated half of consent.
//
// the pass is the owner's mint; a request is the app's ask. an agent names the
// categories it wants, a purpose, and a duration, and says why. nothing is
// readable while pending. the owner sees the ask, may narrow it, and approves
// or denies. approval is the only path from a request to a pass, and edits can
// only tighten: an owner cannot widen a request past what the app asked for,
// and nobody but the owner can approve at all.
//
// the request is content-free: categories and metadata, never data.

import { randomId } from '../util/crypto.js';
import { OUTCOME, PASS_DURATION, RECEIPT_OP } from '../model/constants.js';

const STATUS = { PENDING: 'pending', APPROVED: 'approved', DENIED: 'denied' };
const DURATIONS = new Set(Object.values(PASS_DURATION));

export class AccessRequestService {
  constructor({ store, personas, agents, passes, receipts, now = Date.now }) {
    this.store = store;
    this.personas = personas;
    this.agents = agents;
    this.passes = passes;
    this.receipts = receipts;
    this.now = now;
  }

  // an agent asks. the session already fixed which persona it can even address.
  request({ personaId, clientId, categories, purpose, duration, sets = null, note = null }) {
    const persona = this.personas.get(personaId);
    if (!persona) return { outcome: OUTCOME.UNAVAILABLE, reason: 'persona_not_found' };
    const cats = Array.isArray(categories)
      ? [...new Set(categories.map((c) => String(c).trim()).filter(Boolean))]
      : [];
    if (cats.length === 0) return { outcome: OUTCOME.DECLINED, reason: 'categories_required' };
    if (!purpose || String(purpose).trim() === '') return { outcome: OUTCOME.DECLINED, reason: 'purpose_required' };
    if (!DURATIONS.has(duration)) return { outcome: OUTCOME.DECLINED, reason: 'duration_invalid' };
    if (sets !== null && (!Array.isArray(sets) || !sets.every((s) => typeof s === 'string' && s.trim() !== ''))) {
      return { outcome: OUTCOME.DECLINED, reason: 'sets_invalid' };
    }

    const req = {
      id: randomId('rq'),
      personaId,
      clientId,
      categories: cats,
      purpose: String(purpose).trim(),
      duration,
      sets: sets ? [...new Set(sets.map((s) => s.trim()))] : null,
      note: note ? String(note).slice(0, 500) : null,
      status: STATUS.PENDING,
      createdAt: this.now(),
      decidedAt: null
    };
    this.store.put('accessRequests', req.id, req);
    this.receipts.write({
      actor: 'agent', personaId, op: RECEIPT_OP.ACCESS_REQUEST,
      categories: cats, reason: req.purpose
    });
    return { outcome: OUTCOME.RESULTS, request: req };
  }

  list({ personaId = null, status = null } = {}) {
    return this.store.list('accessRequests', (r) =>
      (personaId === null || r.personaId === personaId) && (status === null || r.status === status))
      .sort((a, b) => b.createdAt - a.createdAt);
  }

  deny({ requestId, reason = null }) {
    const req = this.store.get('accessRequests', requestId);
    if (!req) return { outcome: OUTCOME.UNAVAILABLE, reason: 'request_not_found' };
    if (req.status !== STATUS.PENDING) return { outcome: OUTCOME.DECLINED, reason: 'request_already_decided' };
    const next = this.store.update('accessRequests', requestId, (r) => ({
      ...r, status: STATUS.DENIED, decidedAt: this.now(), denialReason: reason ? String(reason).slice(0, 300) : null
    }));
    this.receipts.write({ actor: 'owner', personaId: req.personaId, op: RECEIPT_OP.ACCESS_REQUEST, categories: req.categories, reason: 'denied' });
    return { outcome: OUTCOME.RESULTS, request: next };
  }

  // approval mints the pass(es). edits can narrow duration, rung and scope;
  // they can never widen the ask (no new categories, no broader sets, no
  // longer duration than requested, no unscoped if the ask was scoped).
  approve({ requestId, edits = {} }) {
    const req = this.store.get('accessRequests', requestId);
    if (!req) return { outcome: OUTCOME.UNAVAILABLE, reason: 'request_not_found' };
    if (req.status !== STATUS.PENDING) return { outcome: OUTCOME.DECLINED, reason: 'request_already_decided' };

    const duration = edits.duration ?? req.duration;
    if (!DURATIONS.has(duration)) return { outcome: OUTCOME.DECLINED, reason: 'duration_invalid' };
    if (rank(duration) > rank(req.duration)) return { outcome: OUTCOME.DECLINED, reason: 'edits_widen_the_request' };

    const maxRung = edits.maxRung ?? 4;
    if (!Number.isInteger(maxRung) || maxRung < 0 || maxRung > 4) return { outcome: OUTCOME.DECLINED, reason: 'rung_invalid' };

    let sets = edits.sets !== undefined ? edits.sets : req.sets;
    if (sets !== null && (!Array.isArray(sets) || sets.length === 0)) {
      // an owner trying to drop a scoped ask to "the whole hat" is a widening
      if (req.sets !== null) return { outcome: OUTCOME.DECLINED, reason: 'edits_widen_the_request' };
      sets = null;
    }
    if (req.sets !== null && sets !== null) {
      const asked = new Set(req.sets.map((s) => s.toLowerCase()));
      if (!sets.every((s) => asked.has(String(s).trim().toLowerCase()))) {
        return { outcome: OUTCOME.DECLINED, reason: 'edits_widen_the_request' };
      }
      sets = [...new Set(sets.map((s) => String(s).trim()))];
    }

    // approval IS the owner's consent act: a full-scope ask the owner approved
    // counts as the explicit acknowledgement passes require.
    const passes = [];
    for (const category of req.categories) {
      const res = this.passes.grant({
        clientId: req.clientId,
        personaId: req.personaId,
        category,
        purpose: req.purpose,
        duration,
        maxRung,
        sets: sets ?? null,
        acknowledgeFull: true
      });
      if (res.outcome === OUTCOME.RESULTS) passes.push(res.pass);
      else return { outcome: res.outcome, reason: res.reason };
    }

    const next = this.store.update('accessRequests', requestId, (r) => ({
      ...r, status: STATUS.APPROVED, decidedAt: this.now(), passIds: passes.map((p) => p.id)
    }));
    this.receipts.write({ actor: 'owner', personaId: req.personaId, op: RECEIPT_OP.ACCESS_REQUEST, categories: req.categories, reason: 'approved' });
    return { outcome: OUTCOME.RESULTS, request: next, passes };
  }
}

const rank = (duration) => ({ one_time: 0, session: 1, permanent: 2 }[duration] ?? -1);
