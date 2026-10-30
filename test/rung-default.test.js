// owner: "do rung 4". a pass that does not name a rung serves the fact's full
// content, not the mechanical exists placeholder. detail level stays a dial
// the owner can lower per grant; the default should not make every read look
// like "there is a note in preferences".

import test from 'node:test';
import assert from 'node:assert/strict';
import { Moira } from '../src/index.js';
import { MemoryStore } from '../src/store.js';

test('rung: default grants serve full content', () => {
  const m = new Moira({ store: new MemoryStore() });
  const ctx = m.createOwnerContext({ kind: 'owner_session', verified: true, ownerRef: 'owner' });
  const p = m.owner.createPersona(ctx, { name: 'p', identity: 'linked' });
  m.facts.add(m.personas.get(p.id), { content: 'ships on fridays', category: 'preferences' });
  const agentId = m.owner.registerAgent(ctx, { name: 'app', tier: 'verified', personasAllowed: [p.id], spendCaps: { usd: 1 } }).id;
  const sess = m.owner.createSession(ctx, { clientId: agentId, personaId: p.id });

  // no maxRung named: full is the default
  const pass = m.owner.grantPass(ctx, {
    clientId: agentId, personaId: p.id, category: 'preferences', purpose: 'writing',
    duration: 'session', acknowledgeFull: true
  });
  assert.equal(pass.outcome, 'results');
  assert.equal(pass.pass.maxRung, 4, 'default rung is full');

  const read = m.agent.persona_context(sess.accessToken, { categories: ['preferences'], purpose: 'writing' });
  assert.equal(read.categories.preferences.served[0].content, 'ships on fridays', 'content, not a placeholder');
  assert.equal(read.categories.preferences.served[0].rung, 'full');

  // lower rungs still work when named: the dial is real, just not the default
  const low = m.owner.grantPass(ctx, {
    clientId: agentId, personaId: p.id, category: 'preferences', purpose: 'sketch',
    duration: 'session', maxRung: 1, acknowledgeFull: true
  });
  assert.equal(low.pass.maxRung, 1);
  const lowRead = m.agent.persona_context(sess.accessToken, { categories: ['preferences'], purpose: 'sketch' });
  assert.equal(lowRead.categories.preferences.served[0].rung, 'exists');
  assert.match(lowRead.categories.preferences.served[0].content, /there is a note in preferences/);
});
