// the card opens (owner direction 2026-10-29/30: "open card into real detail
// panels" + "persona creation/set editing surface"). owner-side only, and the
// detail is the honest inventory: facts by category, vault captures, declared
// stack/ai, sets, and the live permission ledger. no inference, no ranking.

import test from 'node:test';
import assert from 'node:assert/strict';
import { Moira } from '../src/index.js';
import { MemoryStore } from '../src/store.js';
import { seedDemo } from '../scripts/seed-demo.mjs';

function setup() {
  const m = new Moira({ store: new MemoryStore() });
  const ctx = m.createOwnerContext({ kind: 'owner_session', verified: true, ownerRef: 'owner' });
  return { m, ctx };
}

test('persona detail: an honest inventory, owner-only', async () => {
  const { m, ctx } = setup();
  const seeded = seedDemo(m, ctx);
  const personaId = seeded.persona.id;

  const d = m.owner.personaDetail(ctx, personaId);
  assert.equal(d.outcome, 'results');
  assert.equal(d.persona.name, 'moira airidian');
  assert.equal(d.persona.email, 'moira@dearagent.shop');

  // facts grouped by category, with content (the owner is reading their own)
  assert.ok(d.facts.byCategory.preferences, 'preferences bucket exists');
  assert.equal(d.facts.byCategory.preferences[0].content, 'writes in lowercase, by choice');

  assert.ok(d.facts.byCategory.preferences[0].createdAt, 'facts carry their timestamp');

  // vault captures listed with kind, never the snapshot body
  assert.equal(d.vault.items.length, 1);
  assert.equal(d.vault.items[0].kind, 'note');
  assert.equal(d.vault.items[0].snapshot, undefined, 'no archives in the panel');
  assert.match(d.vault.items[0].id, /^vi_/, 'vault ids are prefixed, not undefined-prefixed');

  // declared context + sets are visible as declared, not inferred
  assert.deepEqual(d.stack.map((s) => s.tool), ['supabase']);
  assert.deepEqual(d.ai.map((a) => a.job), ['scraping']);
  assert.deepEqual(d.sets.map((s) => s.name), ['work']);
  assert.deepEqual(d.passes, [], 'isolated until lent');

  // unknown persona is unavailable, not an empty success
  assert.equal(m.owner.personaDetail(ctx, 'psn_nope').outcome, 'unavailable');
});

test('persona creation from the surface is validated and receipted', async () => {
  const { m, ctx } = setup();
  const made = m.owner.createPersona(ctx, { name: 'night desk', identity: 'linked', email: 'desk@dearagent.shop' });
  assert.ok(made.id);
  const ov = m.owner.overview(ctx);
  assert.ok(ov.personas.some((p) => p.name === 'night desk' && p.email === 'desk@dearagent.shop'));

  // identity stays explicit: a heteronym without a sheet is refused
  assert.throws(() => m.owner.createPersona(ctx, { name: 'ghost', identity: 'heteronymous' }), /character_sheet/);
  // and a malformed address is refused rather than stored
  assert.throws(() => m.owner.createPersona(ctx, { name: 'x', identity: 'linked', email: 'nope' }), /address/);
});
