// a hop limit nobody counts is a promise, not a policy (2026-11-13).
//
// packs.create accepted RESHARE.HOP_LIMIT and stored hopsUsed: 0, and no path
// let a recipient re-issue a pack, so a hop-limited pack and a no-reshare pack
// behaved identically at every seam. either the count means something or the
// option is a lie. this enforces it: a recipient may pass a pack forward, and
// each pass costs a hop.

import test from 'node:test';
import assert from 'node:assert/strict';
import { Moira } from '../src/index.js';
import { MemoryStore } from '../src/store.js';

function setup() {
  const m = new Moira({ store: new MemoryStore() });
  const owner = m.createOwnerContext({ kind: 'owner_session', verified: true, ownerRef: 'owner-a' });
  const p = m.owner.createPersona(owner, { name: 'alex-work', identity: 'pseudonymous' });
  const fact = m.facts.add(p, {
    content: 'ships on fridays', category: 'preferences', rungs: { summary: 'ships fridays' }
  }).fact;
  const mk = (name) => m.owner.registerAgent(owner, { name, tier: 'verified', personasAllowed: [p.id], spendCaps: { usd: 1 } }).id;
  const relay = mk('relay');
  const second = mk('second');
  const third = mk('third');
  const tokenFor = (clientId) => m.owner.createSession(owner, { clientId, personaId: p.id }).accessToken;
  const issue = (reshare, extra = {}) => m.packs.create({
    personaId: p.id, recipientAgentId: relay, brief: 'draft the migration',
    factSelections: [{ factId: fact.id, rung: 'summary' }], reshare, ...extra
  });
  return { m, owner, p, relay, second, third, tokenFor, issue };
}

test('reshare: a hop-limited pack can be passed on exactly as far as its limit', () => {
  const { m, issue, relay, second, third, tokenFor } = setup();
  const root = issue('reshare_with_hop_limit', { hopLimit: 1 });
  assert.equal(root.outcome, 'results');
  assert.equal(root.pack.hopsUsed, 0, 'the first holder is hop zero');
  assert.equal(root.pack.hopLimit, 1, 'the limit is a number, stored with the pack');

  // hop 1: the holder re-issues forward
  const passed = m.agent.context_pack_reshare(tokenFor(relay), { packId: root.pack.id, recipientAgentId: second });
  assert.equal(passed.outcome, 'results');
  assert.equal(passed.pack.hopsUsed, 1);
  assert.equal(passed.pack.parentPackId, root.pack.id, 'the chain is recorded, not implied');
  assert.equal(passed.pack.rootPackId, root.pack.id);

  // hop 2: the new holder is out of hops, and says so
  const over = m.agent.context_pack_reshare(tokenFor(second), { packId: passed.pack.id, recipientAgentId: third });
  assert.equal(over.outcome, 'declined');
  assert.equal(over.reason, 'hop_limit_reached');
});

test('reshare: no_reshare refuses, and a named reshare is the owner s act', () => {
  const { m, issue, relay, second, tokenFor } = setup();
  const closed = issue('no_reshare');
  const refused = m.agent.context_pack_reshare(tokenFor(relay), { packId: closed.pack.id, recipientAgentId: second });
  assert.equal(refused.outcome, 'declined');
  assert.equal(refused.reason, 'reshare_not_allowed');

  const named = issue('reshare_to_named_agents');
  const owners = m.agent.context_pack_reshare(tokenFor(relay), { packId: named.pack.id, recipientAgentId: second });
  assert.equal(owners.outcome, 'declined');
  assert.equal(owners.reason, 'reshare_needs_the_owner', 'a named recipient list is a choice only the owner makes');
});

test('reshare: only the holder passes it on, and a dead pack stays dead', () => {
  const { m, owner, issue, relay, second, third, tokenFor } = setup();
  const root = issue('reshare_with_hop_limit', { hopLimit: 3 });
  const steal = m.agent.context_pack_reshare(tokenFor(third), { packId: root.pack.id, recipientAgentId: second });
  assert.equal(steal.outcome, 'declined');
  assert.equal(steal.reason, 'not_pack_recipient', 'a pack is held by one agent, not by anyone who knows its id');

  const child = m.agent.context_pack_reshare(tokenFor(relay), { packId: root.pack.id, recipientAgentId: second });
  assert.equal(child.outcome, 'results');

  // revoking the root revokes what was passed on: a consent that survives its
  // own withdrawal is not consent
  m.packs.revoke(root.pack.id);
  const dead = m.store.get('packs', child.pack.id);
  assert.equal(dead.status, 'revoked', 'a reshared child dies with its root');
});
