// sets must be one vocabulary across everything they claim to span
// (docs/isolation-permeability.md): declared stack, ai tools, facts and the
// vault. the docs said so; the code only covered stack + ai, and facts
// silently dropped their sets. no phantom features: this pins the promise.

import test from 'node:test';
import assert from 'node:assert/strict';
import { Moira } from '../src/index.js';
import { MemoryStore } from '../src/store.js';

function setup() {
  const m = new Moira({ store: new MemoryStore() });
  const ctx = m.createOwnerContext({ kind: 'owner_session', verified: true, ownerRef: 'owner' });
  const persona = m.owner.createPersona(ctx, { name: 'p', identity: 'linked' });
  m.owner.stackAdd(ctx, { personaId: persona.id, tool: 'supabase', uses: ['auth'], sets: ['work'] });
  m.owner.aiAdd(ctx, { personaId: persona.id, job: 'scraping', tools: [{ tool: 'firecrawl' }], sets: ['work'] });
  const fact = m.facts.add(m.personas.get(persona.id), { content: 'ships on fridays', category: 'preferences', sets: ['work'] });
  return { m, ctx, persona, fact };
}

test('sets: one vocabulary across stack, ai, facts and vault', async () => {
  const { m, ctx, persona } = setup();
  await m.owner.vaultAdd(ctx, { personaId: persona.id, kind: 'note', note: 'a capture', sets: ['work'] });

  const sets = m.owner.setList(ctx, { personaId: persona.id });
  assert.equal(sets.outcome, 'results');
  const work = sets.sets.find((s) => s.name === 'work');
  assert.ok(work, 'the set exists');
  assert.equal(work.count, 4, 'stack + ai + fact + vault all count');

  // facts keep their sets (they used to be dropped on the floor)
  const d = m.owner.personaDetail(ctx, persona.id);
  assert.ok(d.facts.total >= 1);

  // removing the set untags EVERY holder, and nothing is deleted
  const removed = m.owner.setRemove(ctx, { personaId: persona.id, name: 'work' });
  assert.equal(removed.outcome, 'results');
  const after = m.owner.setList(ctx, { personaId: persona.id });
  assert.equal(after.sets.length, 0, 'the set is gone everywhere');

  const detail = m.owner.personaDetail(ctx, persona.id);
  assert.deepEqual(detail.stack[0].sets, [], 'stack untagged');
  assert.deepEqual(detail.ai[0].tools[0].sets ?? [], [], 'ai untagged');
  assert.equal(detail.vault.items[0].sets.length, 0, 'vault untagged');
  assert.equal(detail.facts.total, 1, 'the fact survives');
  assert.equal(detail.vault.items.length, 1, 'the capture survives');

  // facts validate their sets, same rule as stack
  const bad = m.facts.add(m.personas.get(persona.id), { content: 'x', category: 'preferences', sets: [42] });
  assert.equal(bad.outcome, 'declined');
  assert.equal(bad.reason, 'sets_invalid');
});


test('sets: a set-scoped pass slices facts, and unfiled facts stay out', async () => {
  const { m, ctx, persona } = setup();
  m.facts.add(m.personas.get(persona.id), { content: 'an unfiled fact', category: 'preferences' });
  await m.owner.vaultAdd(ctx, { personaId: persona.id, kind: 'note', note: 'scoped capture', sets: ['work'] });

  const agentId = m.owner.registerAgent(ctx, { name: 'app', tier: 'verified', personasAllowed: [persona.id], spendCaps: { usd: 1 } }).id;
  const sess = m.owner.createSession(ctx, { clientId: agentId, personaId: persona.id });

  m.owner.grantPass(ctx, {
    clientId: agentId, personaId: persona.id, category: 'preferences', purpose: 'writing',
    duration: 'session', sets: ['work'], maxRung: 4
  });
  const read = m.agent.persona_context(sess.accessToken, { categories: ['preferences'], purpose: 'writing' });
  assert.equal(read.outcome, 'results');
  const contents = (read.categories.preferences.served ?? []).map((s) => s.content);
  assert.deepEqual(contents, ['ships on fridays'], 'only the work-sliced fact');
  assert.ok(!contents.includes('an unfiled fact'), 'unfiled stays out of a sliced read');

  // the vault agrees: same slice, same scope
  const vpass = m.owner.grantPass(ctx, {
    clientId: agentId, personaId: persona.id, category: 'vault', purpose: 'recall',
    duration: 'session', sets: ['work'], maxRung: 4
  });
  assert.equal(vpass.outcome, 'results');
  const vq = m.agent.vault_query(sess.accessToken, {});
  assert.equal(vq.items.length, 1);
});
