// approval links: saying no should not require an owner session.
//
// an ask carries a deadline now, so a ghost never sits in the inbox. but
// answering one still meant authenticating as the owner, which is the wrong ask
// for "yes, this one" - the owner is on a phone, the ask is one question.
//
// a link is a short-lived, single-use, READ-ONLY token scoped to exactly one
// ask. it can see that ask and decide it. it cannot list asks, read a fact,
// reach another hat, or be spent twice. the token discipline is the same one
// connect.js and the device flow already use: raw once, hash at rest, single
// use.
//
// what the link may decide is the ask as it was asked. narrowing edits are
// allowed (they cannot widen anything), because "yes, but only a session" is a
// real answer and `requests.approve` already refuses every widening edit.

import { createHash, randomBytes } from 'node:crypto';
import { OUTCOME, PERSONA_STATUS, RECEIPT_OP } from '../model/constants.js';

const LINK_TTL_MS = 24 * 60 * 60 * 1000; // agent-vault's number for an approver link

const hashToken = (token) => createHash('sha256').update(String(token)).digest('hex');
const mintToken = () => `appr_${randomBytes(24).toString('hex')}`;

export class ApprovalLinkService {
  constructor({ store, requests, passes = null, receipts, personas, now = Date.now }) {
    this.store = store;
    this.requests = requests;
    this.passes = passes;
    this.receipts = receipts;
    this.personas = personas;
    this.now = now;
  }

  // owner-only (the facade requires owner authority). returns the raw token
  // exactly once; only its hash is stored, so losing the link means minting
  // another, not reading the old one out.
  mint({ requestId, ttlMs = LINK_TTL_MS } = {}) {
    const req = this.store.get('accessRequests', requestId);
    if (!req) return { outcome: OUTCOME.UNAVAILABLE, reason: 'request_not_found' };
    const view = this.requests.view(req);
    if (view.status !== 'pending') {
      return { outcome: OUTCOME.DECLINED, reason: 'request_already_decided' };
    }
    const token = mintToken();
    const link = {
      id: `apl_${randomBytes(9).toString('hex')}`,
      requestId,
      personaId: req.personaId,
      tokenHash: hashToken(token),
      createdAt: this.now(),
      expiresAt: Math.min(this.now() + ttlMs, req.expiresAt),
      usedAt: null
    };
    this.store.put('approvalLinks', link.id, link);
    this.receipts.write({
      actor: 'owner', personaId: req.personaId, op: RECEIPT_OP.APPROVAL_LINK, categories: req.categories,
      reason: 'approval_link_minted'
    });
    return { outcome: OUTCOME.RESULTS, token, linkId: link.id, requestId, expiresAt: link.expiresAt };
  }

  _link(token) {
    if (typeof token !== 'string' || token.trim() === '') return null;
    const wanted = hashToken(token.trim());
    return this.store.list('approvalLinks', (l) => l.tokenHash === wanted, {})[0] ?? null;
  }

  // read-only, unauthenticated, and deliberately thin: the ask, the hat's name,
  // and how long is left. never a fact, never another ask, never a pass.
  peek({ token } = {}) {
    const link = this._link(token);
    if (!link) return { outcome: OUTCOME.UNAVAILABLE, reason: 'link_not_found' };
    if (link.usedAt !== null) return { outcome: OUTCOME.DECLINED, reason: 'link_already_used' };

    const req = this.store.get('accessRequests', link.requestId);
    if (!req) return { outcome: OUTCOME.UNAVAILABLE, reason: 'request_not_found' };
    const view = this.requests.view(req);
    if (view.status === 'expired') return { outcome: OUTCOME.DECLINED, reason: 'request_expired' };
    if (this.now() >= link.expiresAt) return { outcome: OUTCOME.DECLINED, reason: 'link_expired' };
    const persona = this.personas.get(req.personaId);
    return {
      outcome: OUTCOME.RESULTS,
      request: {
        id: view.id,
        status: view.status,
        personaName: persona ? persona.name : null,
        categories: view.categories,
        purpose: view.purpose,
        duration: view.duration,
        sets: view.sets,
        fields: view.fields,
        note: view.note,
        createdAt: view.createdAt,
        expiresAt: view.expiresAt,
        linkExpiresAt: link.expiresAt
      }
    };
  }

  // the decision. same code path as the panel: approve mints the pass through
  // requests.approve, so a link cannot grant anything the panel could not.
  decide({ token, decision, edits = {}, reason = null } = {}) {
    const link = this._link(token);
    if (!link) return { outcome: OUTCOME.UNAVAILABLE, reason: 'link_not_found' };
    if (decision !== 'approve' && decision !== 'deny') {
      return { outcome: OUTCOME.DECLINED, reason: 'decision_invalid' };
    }
    if (link.usedAt !== null) return { outcome: OUTCOME.DECLINED, reason: 'link_already_used' };

    const req = this.store.get('accessRequests', link.requestId);
    if (!req) return { outcome: OUTCOME.UNAVAILABLE, reason: 'request_not_found' };
    // an ask's own deadline outranks the link that carried it: "the ask expired"
    // is the truer sentence than "your link is old", and mint clamps a link to
    // the ask anyway, so a link never outlives the question it asks.
    const view = this.requests.view(req);
    if (view.status === 'expired') return { outcome: OUTCOME.DECLINED, reason: 'request_expired' };
    if (view.status !== 'pending') return { outcome: OUTCOME.DECLINED, reason: 'request_already_decided' };
    if (this.now() >= link.expiresAt) return { outcome: OUTCOME.DECLINED, reason: 'link_expired' };
    const persona = this.personas.get(req.personaId);
    if (persona && persona.status === PERSONA_STATUS.FROZEN) {
      return { outcome: OUTCOME.DECLINED, reason: 'persona_frozen' };
    }

    const out = decision === 'approve'
      ? this.requests.approve({ requestId: req.id, edits })
      : this.requests.deny({ requestId: req.id, reason });
    if (out.outcome !== OUTCOME.RESULTS) return out;

    this.store.update('approvalLinks', link.id, (l) => ({ ...l, usedAt: this.now(), decision }));
    this.receipts.write({
      actor: 'owner', personaId: req.personaId, op: RECEIPT_OP.APPROVAL_LINK, categories: req.categories,
      reason: decision === 'approve' ? 'approved_via_link' : 'denied_via_link'
    });
    return { ...out, decision, viaLink: true };
  }

  // how many links an ask has, and whether any is live: shown in the panel so a
  // second link is a deliberate act rather than an accident
  forRequest({ requestId } = {}) {
    const links = this.store.list('approvalLinks', (l) => l.requestId === requestId, {})
      .map((l) => ({
        id: l.id,
        createdAt: l.createdAt,
        expiresAt: l.expiresAt,
        usedAt: l.usedAt,
        decision: l.decision ?? null,
        live: l.usedAt === null && this.now() < l.expiresAt
      }));
    return { outcome: OUTCOME.RESULTS, links };
  }
}
