// the coarsest giveaway is not inference at all
//
// pfp, display name, bio: these deanonymise a persona in one glance, with no
// token overlap and no combination of reads. the leakage audit scans fact
// CONTENT and does not model this class at all, so the honest thing is to
// enumerate what an agent actually receives and pin it, rather than let a
// future spread operator widen it quietly.
//
// current truth, measured here rather than asserted in prose:
//   - no avatar/pfp field exists on a persona
//   - bio (characterSheet) exists but is never served to a client
//   - email is owner-side only (card face), never client-facing
//   - display NAME is served, by design: it is the handle the agent addresses

import test from 'node:test';
import assert from 'node:assert/strict';
import { Moira } from '../src/index.js';
import { MemoryStore } from '../src/store.js';

function build() {
  const m = new Moira({ store: new MemoryStore() });
  const ctx = m.createOwnerContext({ kind: 'owner_session', verified: true, ownerRef: 'owner' });
  const linked = m.owner.createPersona(ctx, {
    name: 'Alex Realname', identity: 'linked', email: 'alex@real.example',
    characterSheet: { bio: 'runs a label in brooklyn, two dogs' }
  });
  const ghost = m.owner.createPersona(ctx, { name: 'work-ghost', identity: 'pseudonymous' });
  // heteronymous personas are the ones that actually hold a character sheet,
  // so this is the realistic carrier for a bio - not a linked persona that may
  // simply drop the field
  const hetero = m.owner.createPersona(ctx, {
    name: 'court-poet', identity: 'heteronymous',
    characterSheet: { bio: 'writes in lowercase, lives near the harbour' }
  });
  m.facts.add(m.personas.get(ghost.id), { content: 'the audit is thursday', category: 'schedule', sets: ['work'] });
  m.facts.add(m.personas.get(hetero.id), { content: 'the audit is thursday', category: 'schedule' });
  const agent = m.owner.registerAgent(ctx, { name: 'planner', tier: 'verified', personasAllowed: [ghost.id, linked.id, hetero.id], spendCaps: { usd: 1 } });
  m.owner.grantPass(ctx, {
    clientId: agent.id, personaId: hetero.id, category: 'schedule', purpose: 'plan',
    duration: 'session', maxRung: 3
  });
  m.owner.grantPass(ctx, {
    clientId: agent.id, personaId: ghost.id, category: 'schedule', purpose: 'plan',
    duration: 'session', maxRung: 3
  });
  const session = m.owner.createSession(ctx, { clientId: agent.id, personaId: ghost.id });
  const heteroSession = m.owner.createSession(ctx, { clientId: agent.id, personaId: hetero.id });
  return { m, ctx, linked, ghost, hetero, agent, session, heteroSession };
}

test('a client receives a handle, not an identity: no email, no bio, no avatar', () => {
  const { m, session, ghost, heteroSession } = build();
  const status = m.agent.moira_status(session.accessToken);
  const context = m.agent.persona_context(session.accessToken, { categories: ['schedule'], purpose: 'plan' });
  const heteroWire = JSON.stringify(m.agent.moira_status(heteroSession.accessToken));
  assert.ok(m.personas.get(m.agent._ctx(heteroSession.accessToken).persona.id).characterSheet,
    'the bio really is stored, so the next assertion is not vacuous');
  assert.equal(heteroWire.includes('harbour'), false, 'a stored bio is never served to a client');

  assert.deepEqual(Object.keys(status.persona).sort(), ['identity', 'name', 'storage', 'sub'],
    'the persona block is a closed set: adding a field is a decision, not a default');
  const wire = JSON.stringify([status, context]);
  for (const forbidden of ['alex@real.example', 'brooklyn', 'two dogs', 'characterSheet', 'email', 'avatar', 'photo']) {
    assert.equal(wire.includes(forbidden), false, `client payload must not carry ${forbidden}`);
  }
  assert.equal(status.persona.name, 'work-ghost', 'the served name is the pseudonym');
});

test('the handle is the only identity signal, and it is the declared one', () => {
  const { m, session, ghost } = build();
  const status = m.agent.moira_status(session.accessToken);
  assert.equal(status.persona.identity, 'pseudonymous');
  // sub is the per-client subject: stable for this client, never the persona id
  assert.ok(status.persona.sub);
  assert.notEqual(status.persona.sub, ghost.id, 'the subject is derived, not the record id');
  const clientId = m.agent._ctx(session.accessToken).clientId;
  assert.equal(status.persona.sub, m.personas.sub(ghost.id, clientId),
    'the same client always sees the same subject');
});
