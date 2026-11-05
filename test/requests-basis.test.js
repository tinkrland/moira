// the owner narrows by basis at approval time (owner, 2026-11-05).
//
// the panel control only means something if the approval honours it, and if it
// can only NARROW. an approval that silently widens an ask is the failure mode.

import test from 'node:test';
import assert from 'node:assert/strict';
import { Moira } from '../src/index.js';
import { MemoryStore } from '../src/store.js';
import { BASIS } from '../src/model/constants.js';

function setup() {
  const m = new Moira({ store: new MemoryStore() });
  const ctx = m.createOwnerContext({ kind: 'owner_session', verified: true, ownerRef: 'owner' });
  const persona = m.personas.get(m.owner.createPersona(ctx, { name: 'alex', identity: 'linked' }).id);
  for (const [content, basis] of [
    ['likes quiet synths', BASIS.STATED],
    ['has free credits for brightdata', BASIS.AVAILABILITY_DRIVEN]
  ]) {
    const made = m.facts.propose(persona, { content, category: 'preferences', basis });
    m.facts.approve(made.fact.id);
  }
  const agent = m.owner.registerAgent(ctx, {
    name: 'taster', tier: 'verified', personasAllowed: [persona.id], spendCaps: { usd: 5 }
  });
  // the ask is the app's half of consent; it carries metadata only
  const request = m.requests.request({
    clientId: agent.id, personaId: persona.id, categories: ['preferences'],
    purpose: 'recommend synths', duration: 'session'
  });
  assert.equal(request.outcome, 'results', JSON.stringify(request));
  return { m, ctx, persona, agent, request };
}

test('an approval can narrow the pass to one basis, and the pass carries it', () => {
  const { m, ctx, request, agent, persona } = setup();
  const approved = m.owner.approveAccessRequest(ctx, {
    requestId: request.request.id, edits: { basis: ['liking'] }
  });
  assert.equal(approved.outcome, 'results', JSON.stringify(approved));
  const passes = m.store.list('passes', (p) => p.clientId === agent.id && p.personaId === persona.id);
  assert.deepEqual([...passes[0].basis].sort(), ['chosen_freely', 'stated'],
    'the group name is expanded once, into the vocabulary the check uses');
});

test('an invalid basis is refused instead of being ignored', () => {
  const { m, ctx, request } = setup();
  const out = m.owner.approveAccessRequest(ctx, { requestId: request.request.id, edits: { basis: ['vibes'] } });
  assert.equal(out.outcome, 'declined');
  assert.equal(out.reason, 'basis_invalid');
});

test('a pass narrowed by basis serves only that basis', () => {
  const { m, ctx, request, agent, persona } = setup();
  m.owner.approveAccessRequest(ctx, { requestId: request.request.id, edits: { basis: ['availability'] } });
  const session = m.owner.createSession(ctx, { clientId: agent.id, personaId: persona.id });
  // a pass is scoped to a purpose: reading under another one is a different ask
  const got = m.agent.persona_context(session.accessToken, { categories: ['preferences'], purpose: 'recommend synths' });
  const contents = (got.categories?.preferences?.served ?? []).map((f) => f.content);
  assert.equal(contents.some((c) => String(c).includes('free credits')), true, 'availability is what was granted');
  assert.equal(contents.some((c) => String(c).includes('quiet synths')), false, 'and liking is not');
});
