// the ego.ist build, step 3: field-level addressing.
//
// ego.ist's ask is `read: ["style.preferences", "profile.sizes"]` - a PATH, not
// a category. moira's unit has been the category; now a fact can name its
// fields at write time, and a pass (or a request, or an approval) can address
// `category.field` exactly. granularity stays honest in both directions: an
// addressed pass cannot reach a fact that never named a field, and an owner
// approving a request cannot add fields the app did not ask for.

import test from 'node:test';
import assert from 'node:assert/strict';
import { Moira } from '../src/index.js';
import { MemoryStore } from '../src/store.js';

function setup() {
  const m = new Moira({ store: new MemoryStore() });
  const ctx = m.createOwnerContext({ kind: 'owner_session', verified: true, ownerRef: 'owner' });
  const persona = m.owner.createPersona(ctx, { name: 'alexa', identity: 'linked' });
  const agentId = m.owner.registerAgent(ctx, { name: 'planner', tier: 'verified', personasAllowed: [persona.id], spendCaps: { usd: 1 } }).id;
  const token = m.owner.createSession(ctx, { clientId: agentId, personaId: persona.id }).accessToken;
  const p = m.personas.get(persona.id);
  m.facts.add(p, { content: 'writes in lowercase', category: 'preferences', fields: ['writing_style'] });
  m.facts.add(p, { content: 'ships on fridays', category: 'preferences', fields: ['shipping'] });
  m.facts.add(p, { content: 'dislikes group calls', category: 'preferences' }); // unfielded
  return { m, ctx, persona, agentId, token, p };
}

test('fields: an addressed pass serves exactly that field', () => {
  const { m, ctx, persona, agentId, token } = setup();

  // a fact validates its fields the way stack validates sets
  const bad = m.facts.add(m.personas.get(persona.id), { content: 'x', category: 'preferences', fields: [42] });
  assert.equal(bad.outcome, 'declined');
  assert.equal(bad.reason, 'fields_invalid');

  const pass = m.owner.grantPass(ctx, {
    clientId: agentId, personaId: persona.id, category: 'preferences', purpose: 'draft',
    duration: 'session', acknowledgeFull: true, fields: ['writing_style']
  });
  assert.equal(pass.outcome, 'results');
  assert.deepEqual(pass.pass.fields, ['preferences.writing_style'], 'stored fully addressed');

  const read = m.agent.persona_context(token, { categories: ['preferences'], purpose: 'draft' });
  assert.equal(read.outcome, 'results');
  const contents = read.categories.preferences.served.map((s) => s.content);
  assert.deepEqual(contents, ['writes in lowercase'], 'exactly the addressed field');
  assert.ok(!contents.includes('ships on fridays'), 'other field withheld');
  assert.ok(!contents.includes('dislikes group calls'), 'unfielded fact withheld');

  // a category-wide pass still sees everything (no regression)
  const wide = m.owner.grantPass(ctx, {
    clientId: agentId, personaId: persona.id, category: 'preferences', purpose: 'all',
    duration: 'session', acknowledgeFull: true
  });
  assert.equal(wide.pass.fields, null);
  const wideRead = m.agent.persona_context(token, { categories: ['preferences'], purpose: 'all' });
  assert.equal(wideRead.categories.preferences.served.length, 3);

  // an address must stay inside its pass's category
  const wrongCat = m.owner.grantPass(ctx, {
    clientId: agentId, personaId: persona.id, category: 'stack', purpose: 'x',
    duration: 'session', acknowledgeFull: true, fields: ['preferences.writing_style']
  });
  assert.equal(wrongCat.outcome, 'declined');
  assert.equal(wrongCat.reason, 'fields_outside_category');
});

test('fields: requests can ask by path, approvals can only narrow', () => {
  const { m, ctx, token } = setup();

  const ask = m.agent.request_access(token, {
    categories: ['preferences'], fields: ['writing_style', 'shipping'],
    purpose: 'draft_replies', duration: 'session'
  });
  assert.equal(ask.outcome, 'results');
  assert.deepEqual(ask.request.fields, ['preferences.writing_style', 'preferences.shipping'], 'ask is addressed');

  // narrowing to one field is allowed
  const narrow = m.owner.approveAccessRequest(ctx, { requestId: ask.request.id, edits: { fields: ['writing_style'] } });
  assert.equal(narrow.outcome, 'results');
  assert.deepEqual(narrow.passes[0].fields, ['preferences.writing_style']);

  // adding a field the app never asked for is widening
  const ask2 = m.agent.request_access(token, { categories: ['preferences'], fields: ['writing_style'], purpose: 'p2', duration: 'session' });
  const widen = m.owner.approveAccessRequest(ctx, { requestId: ask2.request.id, edits: { fields: ['writing_style', 'shipping'] } });
  assert.equal(widen.outcome, 'declined');
  assert.equal(widen.reason, 'edits_widen_the_request');

  // and dropping the address entirely (back to the whole category) is widening too
  const drop = m.owner.approveAccessRequest(ctx, { requestId: ask2.request.id, edits: { fields: null } });
  assert.equal(drop.outcome, 'declined');
  assert.equal(drop.reason, 'edits_widen_the_request');
});
