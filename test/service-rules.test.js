// egress as a sentence the owner can read (2026-11-13).
//
// moira had persona-level egress labels and a per-connector account pin, and no
// object saying "this hat may call exactly this endpoint with exactly this
// account". docs/agent-vault-review.md names service rules as the one thing
// worth taking from agent-vault, and it was the largest remaining gap: the
// account was a sealed credential and egress was whatever adapter happened to
// be installed.
//
// the rule is judged where the call happens - on the url being dialled - so an
// adapter cannot reach a host nobody declared, whatever it thinks it is doing.

import test from 'node:test';
import assert from 'node:assert/strict';
import { Moira } from '../src/index.js';
import { MemoryStore } from '../src/store.js';

function setup() {
  const m = new Moira({ store: new MemoryStore() });
  const owner = m.createOwnerContext({ kind: 'owner_session', verified: true, ownerRef: 'owner-a' });
  const p = m.owner.createPersona(owner, { name: 'alex-work', identity: 'pseudonymous' });
  return { m, owner, p };
}

test('service rules: a declared rule answers, an undeclared host does not', () => {
  const { m, owner, p } = setup();
  const added = m.owner.serviceRuleAdd(owner, {
    personaId: p.id, host: 'api.anthropic.com', pathGlob: '/v1/messages', methods: ['POST'], authKind: 'header'
  });
  assert.equal(added.outcome, 'results');
  const rule = added.rule;
  assert.match(rule.id, /^svc_/);
  assert.equal(rule.host, 'api.anthropic.com');

  const hit = m.services.match({ personaId: p.id, url: 'https://api.anthropic.com/v1/messages', method: 'POST' });
  assert.equal(hit.allowed, true);
  assert.equal(hit.rule.id, rule.id);

  // a different host on the same persona is not covered by that rule
  const miss = m.services.match({ personaId: p.id, url: 'https://api.openai.com/v1/chat', method: 'POST' });
  assert.equal(miss.allowed, false);
  assert.equal(miss.reason, 'egress_not_allowed');

  // nor a different path, nor a different method: a rule is exactly what it says
  assert.equal(m.services.match({ personaId: p.id, url: 'https://api.anthropic.com/v1/keys', method: 'POST' }).allowed, false);
  assert.equal(m.services.match({ personaId: p.id, url: 'https://api.anthropic.com/v1/messages', method: 'DELETE' }).allowed, false);
});

test('service rules: declaring one closes the hat to everything else', () => {
  const { m, owner, p } = setup();
  // nothing declared: nothing to narrow, so egress is not refused (an
  // undeclared hat is unbounded and the panel says so)
  const before = m.services.match({ personaId: p.id, url: 'https://example.com/x', method: 'GET' });
  assert.equal(before.allowed, true);
  assert.equal(before.reason, 'no_rules_declared');

  m.owner.serviceRuleAdd(owner, { personaId: p.id, host: 'api.anthropic.com', pathGlob: '/*' });
  const after = m.services.match({ personaId: p.id, url: 'https://example.com/x', method: 'GET' });
  assert.equal(after.allowed, false, 'declaring a boundary makes it a boundary');
  assert.equal(after.reason, 'egress_not_allowed');
});

test('service rules: a path glob is a glob, not a prefix guess', () => {
  const { m, owner, p } = setup();
  m.owner.serviceRuleAdd(owner, { personaId: p.id, host: 'api.github.com', pathGlob: '/repos/o/r/*' });
  assert.equal(m.services.match({ personaId: p.id, url: 'https://api.github.com/repos/o/r/issues', method: 'GET' }).allowed, true);
  assert.equal(m.services.match({ personaId: p.id, url: 'https://api.github.com/repos/o/r/issues/1/comments', method: 'GET' }).allowed, false,
    'a single * does not cross a slash');
  m.owner.serviceRuleAdd(owner, { personaId: p.id, host: 'api.github.com', pathGlob: '/repos/o/r/**' });
  assert.equal(m.services.match({ personaId: p.id, url: 'https://api.github.com/repos/o/r/issues/1/comments', method: 'GET' }).allowed, true);
});

test('service rules: an account named in the rule is the account that may be used', () => {
  const { m, owner, p } = setup();
  const a = m.owner.addAccount(owner, p.id, {
    provider: 'anthropic', label: 'work key', kind: 'credits', limits: [], expiresAt: null,
    capabilities: { models: ['claude'], tools: [], regions: [] }
  }).account;
  const b = m.owner.addAccount(owner, p.id, {
    provider: 'anthropic', label: 'personal key', kind: 'credits', limits: [], expiresAt: null,
    capabilities: { models: ['claude'], tools: [], regions: [] }
  }).account;

  m.owner.serviceRuleAdd(owner, { personaId: p.id, host: 'api.anthropic.com', pathGlob: '/v1/*', accountId: a.id });

  const right = m.services.match({ personaId: p.id, url: 'https://api.anthropic.com/v1/messages', method: 'POST', accountId: a.id });
  assert.equal(right.allowed, true);

  const wrong = m.services.match({ personaId: p.id, url: 'https://api.anthropic.com/v1/messages', method: 'POST', accountId: b.id });
  assert.equal(wrong.allowed, false);
  assert.equal(wrong.reason, 'service_rule_account_mismatch');

  // a caller that names no account is not borrowing a forbidden one: the
  // binding bites on an explicit id, and the pass seam covers the rest
  const silent = m.services.match({ personaId: p.id, url: 'https://api.anthropic.com/v1/messages', method: 'POST' });
  assert.equal(silent.allowed, true);
  assert.equal(silent.reason, 'service_rule');

  // a rule that names an unknown account refuses to be created at all
  const bad = m.owner.serviceRuleAdd(owner, { personaId: p.id, host: 'x.test', pathGlob: '/*', accountId: 'acct_nope' });
  assert.equal(bad.outcome, 'unavailable');
  assert.equal(bad.reason, 'account_not_found');
});

test('service rules: bad shapes are refused with a reason, not stored', () => {
  const { m, owner, p } = setup();
  assert.equal(m.owner.serviceRuleAdd(owner, { personaId: p.id, host: '', pathGlob: '/*' }).reason, 'host_required');
  assert.equal(m.owner.serviceRuleAdd(owner, { personaId: p.id, host: 'x.test' }).reason, 'path_glob_required');
  assert.equal(m.owner.serviceRuleAdd(owner, { personaId: p.id, host: 'https://x.test/a', pathGlob: '/*' }).reason, 'host_must_be_a_host');
  assert.equal(m.owner.serviceRuleAdd(owner, { personaId: p.id, host: 'x.test', pathGlob: '/*', methods: ['FETCH'] }).reason, 'methods_invalid');
  assert.equal(m.owner.serviceRuleAdd(owner, { personaId: 'psn_nope', host: 'x.test', pathGlob: '/*' }).reason, 'persona_not_found');
  assert.equal(m.owner.serviceRuleList(owner, { personaId: p.id }).rules.length, 0, 'a refused rule leaves nothing behind');
});

test('service rules: removing one reopens the hat, and every change is receipted', () => {
  const { m, owner, p } = setup();
  const { rule } = m.owner.serviceRuleAdd(owner, { personaId: p.id, host: 'api.anthropic.com', pathGlob: '/*' });
  assert.equal(m.services.match({ personaId: p.id, url: 'https://example.com/x', method: 'GET' }).allowed, false);

  const removed = m.owner.serviceRuleRemove(owner, { ruleId: rule.id });
  assert.equal(removed.outcome, 'results');
  assert.equal(m.owner.serviceRuleList(owner, { personaId: p.id }).rules.length, 0);
  assert.equal(m.services.match({ personaId: p.id, url: 'https://example.com/x', method: 'GET' }).reason, 'no_rules_declared');

  const receipts = m.receipts.query({ personaId: p.id });
  assert.ok(receipts.some((r) => r.op === 'service_rule' && r.reason === 'service_rule_added'));
  assert.ok(receipts.some((r) => r.op === 'service_rule' && r.reason === 'service_rule_removed'));

  const missing = m.owner.serviceRuleRemove(owner, { ruleId: 'svc_nope' });
  assert.equal(missing.outcome, 'unavailable');
});

test('service rules: the call itself is judged, not the intention', async () => {
  const { m, owner, p } = setup();
  const calls = [];
  // a fetch that records what it was asked to dial, so the test can prove the
  // gate sits in front of the socket rather than in a comment
  const io = { fetch: async (url, opts) => { calls.push(String(url)); return { ok: true, json: async () => ({}) }; } };
  m.connectors.io = io;
  m.owner.serviceRuleAdd(owner, { personaId: p.id, host: 'allowed.test', pathGlob: '/*' });

  // an adapter expects a Response or a throw, so the refusal is raised with a
  // code - and the socket never opens
  await assert.rejects(
    () => m.connectors.egressFetch({ personaId: p.id })('https://blocked.test/x', {}),
    (err) => err.code === 'egress_not_allowed'
  );
  assert.deepEqual(calls, [], 'nothing left the process');
  assert.ok(m.receipts.query({ personaId: p.id }).some((r) => r.reason === 'refused:egress_not_allowed'),
    'a refusal is receipted, not swallowed');

  const ok = await m.connectors.egressFetch({ personaId: p.id })('https://allowed.test/x', {});
  assert.deepEqual(calls, ['https://allowed.test/x']);
  assert.ok(ok);
});
