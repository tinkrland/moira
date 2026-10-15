// resource ledger (spec section 8).
//
// tracks every key, trial, credit balance, free tier and paid plan per
// persona, with limits, usage, resets, expiries, conversions and cancel-by
// dates. secrets are sealed and never exposed; agents get leases, never keys.
//
// how it learns state (8.2): manual entry and owner-confirmed proposals here;
// gateway metering is applied through spend(); provider usage polling and
// billing-mail extraction are connector-fed and arrive as owner-confirmed
// proposals. every field carries provenance and confidence; unconfirmed
// dates show as estimated and never drive an irreversible action.

import { randomId } from '../util/crypto.js';
import { OUTCOME, RESOURCE_KIND, DATA_POLICY } from '../model/constants.js';
import { rankAccounts } from './policy.js';

const DAY_MS = 86400000;
const ALERT_WINDOWS = [7, 2]; // t-7 and t-2 (8.6)

export class LedgerService {
  constructor({ store, personas, keys, receipts, now = Date.now }) {
    this.store = store;
    this.personas = personas;
    this.keys = keys;
    this.receipts = receipts;
    this.now = now;
  }

  // add or correct an account (ledger_propose + owner confirm).
  add(personaId, spec, { confirmedByOwner = true } = {}) {
    const persona = this.personas.get(personaId);
    if (!persona) return { outcome: OUTCOME.UNAVAILABLE, reason: 'persona_not_found' };
    const {
      provider, label, kind, limits = [], capabilities = { models: [], tools: [], regions: [] },
      expiresAt = null, convertsToPaidAt = null, cancelBy = null, cardOnFile = false,
      dataPolicy = DATA_POLICY.NO_RETENTION, secret = null, payerLabel = null,
      costPerUnit = 0, renews = false, remainingValue = null,
      unmetered = false // owner's explicit mark: no limits BY DESIGN, not unknown
    } = spec;
    if (!Object.values(RESOURCE_KIND).includes(kind)) throw new Error(`unknown resource kind: ${kind}`);

    const id = this.keys.newAccountId();
    const account = {
      id,
      personaId,
      provider,
      label,
      kind,
      limits, // [{ unit, cap, windowMs }] windowMs null = total (prepaid/credits)
      usage: [], // metered spend events: { ts, unit, amount, leaseId }
      reset: spec.reset ?? null, // { schedule } e.g. { monthlyDay: 3 }
      expiresAt,
      convertsToPaidAt,
      cancelBy,
      cardOnFile,
      capabilities,
      dataPolicy,
      costPerUnit,
      renews,
      remainingValue,
      unmetered, // null headroom for an unmetered account means "genuinely unmetered"
      priorityOverride: null, // { pinned: true } | { excluded: true }
      provenance: {
        source: confirmedByOwner ? 'owner_confirmed' : 'agent_proposed',
        confirmed: confirmedByOwner,
        fields: fieldProvenance(spec)
      },
      createdAt: this.now()
    };

    // seal the secret; store only the opaque sealed envelope. it never leaves.
    account.secretSealed = secret ? this.keys.sealSecret(personaId, id, secret) : null;
    // payer label is stored as a keyed hash only (section 22.3), never a card number.
    account.payerHash = payerLabel ? this.keys.payerHash(payerLabel) : null;

    this.store.put('accounts', id, account);
    this.receipts.write({ actor: 'owner', personaId, op: 'lease', amount: null, reason: `account_added:${provider}` });
    return { outcome: OUTCOME.RESULTS, account: { ...account, secretSealed: undefined } };
  }

  update(id, patch, { confirmedByOwner = true } = {}) {
    const account = this.store.update('accounts', id, (a) => ({
      ...a,
      ...patch,
      provenance: { ...a.provenance, confirmed: confirmedByOwner && a.provenance.confirmed }
    }));
    return account;
  }

  get(id) {
    const a = this.store.get('accounts', id);
    if (!a) return null;
    return { ...a, secretSealed: undefined, secret: undefined };
  }

  list(personaId) {
    return this.store.list('accounts', (a) => a.personaId === personaId, { personaId }).map((a) => ({ ...a, secretSealed: undefined }));
  }

  pin(id) { return this._override(id, { pinned: true }); }
  exclude(id) { return this._override(id, { excluded: true }); }
  clearOverride(id) { return this._override(id, null); }
  _override(id, o) {
    return this.store.update('accounts', id, (a) => ({ ...a, priorityOverride: o }));
  }

  // --- metering (8.4): the broker makes the call and meters it -----------------

  recordUsage(accountId, { unit, amount, leaseId = null }) {
    return this.store.update('accounts', accountId, (a) => ({
      ...a,
      usage: [...a.usage, { ts: this.now(), unit, amount, leaseId }]
    }));
  }

  // window-aware usage since a reset boundary.
  usedInWindow(account, unit, windowMs = null) {
    const cutoff = windowMs ? this.now() - windowMs : 0;
    return account.usage
      .filter((u) => u.ts >= cutoff && (unit === null || u.unit === unit))
      .reduce((acc, u) => acc + u.amount, 0);
  }

  // headroom is PER UNIT: caps in different units are never summed. the
  // matching limits' remaining values are summed within one unit only.
  // null means genuinely unmetered (owner-marked) or no limits in that unit;
  // callers that care distinguish via limitsMetered().
  headroom(account, unit = 'usd') {
    if (account.unmetered === true) return null;
    const unitLimits = account.limits.filter((lim) => lim.unit === unit);
    if (unitLimits.length === 0) return null;
    let total = 0;
    for (const lim of unitLimits) {
      total += Math.max(0, lim.cap - this.usedInWindow(account, lim.unit, lim.windowMs));
    }
    return total;
  }

  // per-unit headroom map for display; an unmetered account reports null.
  headroomByUnit(account) {
    if (account.unmetered === true) return { unmetered: true };
    const out = {};
    for (const lim of account.limits) {
      if (!(lim.unit in out)) out[lim.unit] = 0;
      out[lim.unit] += Math.max(0, lim.cap - this.usedInWindow(account, lim.unit, lim.windowMs));
    }
    return out;
  }

  // are this account's limits actually known? an account with no limits
  // entered is UNKNOWN, not unlimited (section 11: unknown budget state is
  // never "no limits"). only an explicit owner unmetered mark counts as known.
  limitsMetered(account) {
    return account.limits.length > 0 || account.unmetered === true;
  }

  remainingValueOf(account) {
    if (account.remainingValue !== null && account.remainingValue !== undefined) return account.remainingValue;
    // never silently default to 1: unknown value is null
    if (account.unmetered === true) return null;
    const hr = this.headroom(account, 'usd');
    return hr === null ? null : hr;
  }

  daysToExpiry(account) {
    return account.expiresAt ? (account.expiresAt - this.now()) / DAY_MS : Infinity;
  }

  // --- alerts (8.6) -----------------------------------------------------------

  alerts(personaId) {
    const now = this.now();
    const out = [];
    for (const a of this.list(personaId)) {
      const est = !a.provenance.confirmed;
      if (a.expiresAt) {
        const days = (a.expiresAt - now) / DAY_MS;
        for (const w of ALERT_WINDOWS) {
          if (days <= w && days > w - 1) {
            out.push({ accountId: a.id, kind: 'expiry', days, estimated: est, message: `${a.provider} ${a.kind} expires in ${Math.ceil(days)}d` });
          }
        }
      }
      if (a.convertsToPaidAt) {
        const days = (a.convertsToPaidAt - now) / DAY_MS;
        if (days <= 7 && days > 0) {
          out.push({
            accountId: a.id, kind: 'conversion', days, estimated: est,
            message: `this trial charges your card on ${new Date(a.convertsToPaidAt).toISOString().slice(0, 10)}${a.cancelBy ? '; cancel by ' + new Date(a.cancelBy).toISOString().slice(0, 10) : ''}`
          });
        }
      }
    }
    return out;
  }

  // --- runway view (8.6) -------------------------------------------------------

  runway(personaId, { ranked = null } = {}) {
    const accounts = this.list(personaId);
    const timeline = accounts
      .flatMap((a) => {
        const events = [];
        if (a.expiresAt) events.push({ accountId: a.id, kind: 'expiry', at: a.expiresAt });
        if (a.convertsToPaidAt) events.push({ accountId: a.id, kind: 'conversion', at: a.convertsToPaidAt });
        if (a.cancelBy) events.push({ accountId: a.id, kind: 'cancel_by', at: a.cancelBy });
        return events;
      })
      .sort((x, y) => x.at - y.at);
    const useFirst = (ranked ?? this.rankFor(personaId)).map((r) => ({ accountId: r.account.id, urgency: r.urgency, reason: 'availability' }));
    return { timeline, useFirst, alerts: this.alerts(personaId) };
  }

  rankFor(personaId, { burnRateFraction = 0.5 } = {}) {
    const accounts = this.list(personaId).filter((a) => !a.priorityOverride?.excluded);
    const decorated = rankAccounts({
      accounts: accounts.map((a) => ({
        ...a,
        remainingValue: this.remainingValueOf(a)
      })),
      now: this.now(),
      burnRateFraction
    });
    // pinned accounts float to the top of the ranked list
    return decorated.sort((x, y) => (y.account.priorityOverride?.pinned ? 1 : 0) - (x.account.priorityOverride?.pinned ? 1 : 0));
  }
}

function fieldProvenance(spec) {
  const out = {};
  for (const [k, v] of Object.entries(spec)) {
    if (v !== null && v !== undefined) out[k] = spec.provenanceSource ?? 'owner';
  }
  return out;
}
