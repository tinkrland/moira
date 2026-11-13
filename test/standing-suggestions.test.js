// the owner approves the same shape three times and is asked a fourth
// (2026-11-13).
//
// agents carried standingRules and agents.js matched them, but nothing ever
// suggested one: the owner had to know the api to stop being asked. spec v1
// calls this "standing-rule suggestions" - approve a pattern once, stop being
// asked - and it is the difference between a consent system and a prompt that
// keeps interrupting.

import test from 'node:test';
import assert from 'node:assert/strict';
import { Moira } from '../src/index.js';
import { MemoryStore } from '../src/store.js';

function setup() {
  const m = new Moira({ store: new MemoryStore() });
  const owner = m.createOwnerContext({ kind: 'owner_session', verified: true, ownerRef: 'owner-a' });
  const p = m.owner.createPersona(owner, { name: 'alex-work', identity: 'pseudonymous' });
  m.facts.add(p, { content: 'ships on fridays', category: 'preferences', rungs: { summary: 'ships fridays' } });
  const agentId = m.owner.registerAgent(owner, { name: 'planner', tier: 'verified', personasAllowed: [p.id], spendCaps: { usd: 1 } }).id;
  const token = m.owner.createSession(owner, { clientId: agentId, personaId: p.id }).accessToken;
  const ask = (categories = ['preferences'], duration = 'session') =>
    m.agent.request_access(token, { categories, purpose: 'draft the weekly note', duration });
  const approveAll = () => {
    for (const row of m.requests.list({ status: 'pending' })) m.requests.approve({ requestId: row.id });
  };
  return { m, owner, p, agentId, token, ask, approveAll };
}

test('standing suggestions: two approvals are a coincidence, three are a pattern', () => {
  const { m, owner, ask, approveAll } = setup();
  ask(); approveAll();
  ask(); approveAll();
  assert.equal(m.owner.standingRuleSuggestions(owner).suggestions.length, 0, 'twice is not a pattern');

  ask(); approveAll();
  const out = m.owner.standingRuleSuggestions(owner);
  assert.equal(out.outcome, 'results');
  assert.equal(out.suggestions.length, 1);
  const s = out.suggestions[0];
  assert.deepEqual(s.categories, ['preferences']);
  assert.equal(s.approvals, 3);
  assert.equal(s.duration, 'session');
  assert.ok(s.agentId && s.personaId);
  assert.match(s.id, /^sug_/, 'a suggestion has an id, so accepting one is not a guess');
});

test('standing suggestions: accepting one stops the asking, and only for that shape', () => {
  const { m, owner, agentId, p, ask, approveAll, token } = setup();
  for (let i = 0; i < 3; i += 1) { ask(); approveAll(); }
  const [s] = m.owner.standingRuleSuggestions(owner).suggestions;

  const accepted = m.owner.standingRuleAccept(owner, { suggestionId: s.id });
  assert.equal(accepted.outcome, 'results');
  assert.equal(accepted.rule.kind, 'access_request');
  assert.equal(accepted.rule.basedOn, 3, 'the rule records what earned it');

  // the same ask now serves instead of interrupting
  const repeat = m.agent.request_access(token, { categories: ['preferences'], purpose: 'draft the next note', duration: 'session' });
  assert.equal(repeat.outcome, 'results');
  assert.equal(repeat.autoApproved, true, 'the standing rule answered for the owner');
  assert.equal(repeat.passes.length, 1, 'and a pass was minted, not a pending row');
  assert.equal(m.requests.list({ status: 'pending' }).length, 0, 'nothing was added to the inbox');

  // a wider ask is still an ask: a pattern is not a blank cheque
  const wider = m.agent.request_access(token, { categories: ['preferences', 'health'], purpose: 'and my notes', duration: 'session' });
  assert.equal(wider.autoApproved, undefined);
  assert.equal(wider.outcome, 'results');
  assert.equal(m.requests.list({ status: 'pending' }).length, 1, 'a wider shape goes back to the owner');

  // and the suggestion is gone once taken
  assert.equal(m.owner.standingRuleSuggestions(owner).suggestions.length, 0);
  assert.ok(m.owner.standingRuleList(owner).rules.some((r) => r.agentId === agentId && r.personaId === p.id));
});

test('standing suggestions: a denied shape is never suggested', () => {
  const { m, owner, ask } = setup();
  for (let i = 0; i < 3; i += 1) {
    const { request } = ask();
    m.requests.deny({ requestId: request.id, reason: 'no' });
  }
  assert.equal(m.owner.standingRuleSuggestions(owner).suggestions.length, 0, 'a no, three times, is still a no');
});

test('standing suggestions: accepting an unknown or already-taken suggestion fails closed', () => {
  const { m, owner } = setup();
  const missing = m.owner.standingRuleAccept(owner, { suggestionId: 'sug_nope' });
  assert.equal(missing.outcome, 'unavailable');
  assert.equal(missing.reason, 'suggestion_not_found');
});
