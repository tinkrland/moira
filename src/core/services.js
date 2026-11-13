// service rules: egress as a sentence the owner can read (spec 14, adapted).
//
// moira had persona-level egress labels and a per-connector account pin, and no
// object saying "this hat may call exactly this endpoint with exactly this
// account". the account was a sealed credential and egress was implicit in
// whichever adapter happened to be installed, which is not a boundary a person
// can read, let alone argue with.
//
// a rule is four facts and one optional binding:
//
//   host + pathGlob + methods? + authKind + accountId?
//
// it is judged where the call happens - on the url being dialled - so an
// adapter cannot reach a host nobody declared, whatever it thinks it is doing.
//
// the one decision worth arguing about: what "no rules" means. it is NOT
// "refuse everything", because a hat that has never declared anything would
// stop working the day this shipped. it is "nothing declared, nothing narrowed"
// - and the moment one rule exists for that hat, egress is closed to everything
// it does not name. declaring a boundary makes it a boundary; silence does not.

import { randomId } from '../util/crypto.js';
import { OUTCOME, RECEIPT_OP } from '../model/constants.js';

const METHODS = ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'];
const AUTH_KINDS = ['header', 'query', 'none', 'oauth'];

// a glob where * stops at a slash and ** crosses it: the difference matters,
// because /repos/o/r/* is "the repo" and /repos/o/r/** is "anything inside it".
const globToRegExp = (glob) => {
  let out = '^';
  for (let i = 0; i < glob.length; i += 1) {
    const ch = glob[i];
    if (ch === '*' && glob[i + 1] === '*') { out += '.*'; i += 1; }
    else if (ch === '*') out += '[^/]*';
    else if (ch === '?') out += '[^/]';
    else out += ch.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`${out}$`);
};

const hostOf = (raw) => {
  try {
    const u = new URL(raw.includes('://') ? raw : `https://${raw}`);
    return { host: u.hostname.toLowerCase(), path: u.pathname || '/' };
  } catch {
    return null;
  }
};

export class ServiceRuleService {
  constructor({ store, personas, ledger = null, receipts, now = Date.now }) {
    this.store = store;
    this.personas = personas;
    this.ledger = ledger;
    this.receipts = receipts;
    this.now = now;
  }

  add({ personaId, host, pathGlob, methods = null, authKind = 'header', accountId = null, note = null } = {}) {
    const persona = this.personas.get(personaId);
    if (!persona) return { outcome: OUTCOME.UNAVAILABLE, reason: 'persona_not_found' };

    if (typeof host !== 'string' || host.trim() === '') return { outcome: OUTCOME.DECLINED, reason: 'host_required' };
    const cleaned = host.trim().toLowerCase();
    if (cleaned.includes('/') || cleaned.includes(':') || cleaned.includes('://')) {
      // a rule names a host. a url belongs in the note, not the shape.
      return { outcome: OUTCOME.DECLINED, reason: 'host_must_be_a_host' };
    }
    if (typeof pathGlob !== 'string' || pathGlob.trim() === '') {
      return { outcome: OUTCOME.DECLINED, reason: 'path_glob_required' };
    }
    const glob = pathGlob.trim().startsWith('/') ? pathGlob.trim() : `/${pathGlob.trim()}`;
    if (methods !== null) {
      if (!Array.isArray(methods) || methods.length === 0) return { outcome: OUTCOME.DECLINED, reason: 'methods_invalid' };
      const bad = methods.find((x) => !METHODS.includes(String(x).toUpperCase()));
      if (bad) return { outcome: OUTCOME.DECLINED, reason: 'methods_invalid' };
    }
    if (!AUTH_KINDS.includes(authKind)) return { outcome: OUTCOME.DECLINED, reason: 'auth_kind_invalid' };
    if (accountId) {
      // a rule may bind an account, but never one this hat does not hold
      const account = this.ledger ? this.ledger.get(accountId) : null;
      if (!account || account.personaId !== personaId) {
        return { outcome: OUTCOME.UNAVAILABLE, reason: 'account_not_found' };
      }
    }

    const rule = {
      id: randomId('svc'),
      personaId,
      host: cleaned,
      pathGlob: glob,
      methods: methods ? [...new Set(methods.map((x) => String(x).toUpperCase()))] : null,
      authKind,
      accountId: accountId ?? null,
      note: note ? String(note).slice(0, 300) : null,
      createdAt: this.now(),
      createdBy: 'owner'
    };
    this.store.put('serviceRules', rule.id, rule);
    this.receipts.write({
      actor: 'owner', personaId, op: RECEIPT_OP.SERVICE_RULE, reason: 'service_rule_added'
    });
    return { outcome: OUTCOME.RESULTS, rule };
  }

  remove({ ruleId } = {}) {
    if (!ruleId) return { outcome: OUTCOME.DECLINED, reason: 'rule_id_required' };
    const rule = this.store.get('serviceRules', ruleId);
    if (!rule) return { outcome: OUTCOME.UNAVAILABLE, reason: 'service_rule_not_found' };
    this.store.del('serviceRules', ruleId);
    this.receipts.write({
      actor: 'owner', personaId: rule.personaId, op: RECEIPT_OP.SERVICE_RULE, reason: 'service_rule_removed'
    });
    return { outcome: OUTCOME.RESULTS, ruleId };
  }

  list({ personaId = null } = {}) {
    const rules = this.store.list('serviceRules', (r) => (personaId ? r.personaId === personaId : true), {})
      .sort((a, b) => a.createdAt - b.createdAt);
    return { outcome: OUTCOME.RESULTS, rules };
  }

  // the judgement. pure: no io, no clock, no store writes - so it can be called
  // on every outbound request and tested without a network.
  match({ personaId, url, method = 'GET', accountId = null } = {}) {
    const rules = this.store.list('serviceRules', (r) => r.personaId === personaId, {});
    if (rules.length === 0) {
      return { allowed: true, rule: null, reason: 'no_rules_declared' };
    }
    const target = hostOf(String(url ?? ''));
    if (!target) return { allowed: false, rule: null, reason: 'url_invalid' };
    const verb = String(method).toUpperCase();

    let accountMismatch = null;
    for (const rule of rules) {
      if (rule.host !== target.host) continue;
      if (!globToRegExp(rule.pathGlob).test(target.path)) continue;
      if (rule.methods && !rule.methods.includes(verb)) continue;
      if (rule.accountId && accountId && rule.accountId !== accountId) {
        // the shape matched but the account is not the one the owner bound:
        // borrowing another account through a declared endpoint is exactly the
        // move the binding exists to stop.
        accountMismatch = rule;
        continue;
      }
      // a caller that names no account is not silently using a forbidden one:
      // the binding is enforced when the caller speaks the same vocabulary (an
      // explicit account id), and the pass/lease seam enforces it otherwise.

      return { allowed: true, rule, reason: 'service_rule' };
    }
    if (accountMismatch) return { allowed: false, rule: accountMismatch, reason: 'service_rule_account_mismatch' };
    return { allowed: false, rule: null, reason: 'egress_not_allowed' };
  }

  // a fetch wrapper that judges before it dials. adapters receive this instead
  // of raw fetch, so the boundary sits in front of the socket rather than in a
  // comment above it.
  gate({ personaId, accountId = null, fetch = globalThis.fetch } = {}) {
    return async (url, opts = {}) => {
      const verdict = this.match({ personaId, url, method: opts?.method ?? 'GET', accountId });
      if (!verdict.allowed) {
        this.receipts.write({
          actor: 'agent', personaId, op: RECEIPT_OP.SERVICE_RULE, reason: `refused:${verdict.reason}`
        });
        return { outcome: OUTCOME.DECLINED, reason: verdict.reason, url: String(url) };
      }
      const res = await fetch(url, opts);
      return res;
    };
  }
}
