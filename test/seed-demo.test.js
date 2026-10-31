// the demo card: "moira airidian" / moira@dearagent.shop. idempotent seed,
// and the address is a first-class persona field, not a character-sheet blip.

import test from 'node:test';
import assert from 'node:assert/strict';
import { Moira } from '../src/index.js';
import { MemoryStore } from '../src/store.js';
import { seedDemo } from '../scripts/seed-demo.mjs';

test('seed: the dummy card exists once, with its address on the overview', () => {
  const m = new Moira({ store: new MemoryStore() });
  const ctx = m.createOwnerContext({ kind: 'owner_session', verified: true, ownerRef: 'owner' });

  const first = seedDemo(m, ctx);
  assert.equal(first.created, true);
  const second = seedDemo(m, ctx);
  assert.equal(second.created, false, 'seed is idempotent');

  const ov = m.owner.overview(ctx);
  const p = ov.personas.find((x) => x.name === 'moira airidian');
  assert.ok(p, 'persona present');
  assert.equal(p.email, 'moira@dearagent.shop');
  assert.deepEqual(p.sets.map((s) => s.name), ['work'], 'the card face has sections');
  assert.deepEqual(p.passes, [], 'isolation is still the default for the demo card');

  // the seeded demo carries a real pending ask for the inbox to decide
  const inbox = m.owner.listAccessRequests(ctx, { status: 'pending' });
  assert.equal(inbox.requests.length, 1, 'one pending ask, seeded once');
  assert.equal(inbox.requests[0].purpose, 'draft_replies');
  assert.deepEqual(inbox.requests[0].sets, ['work']);
  seedDemo(m, ctx);
  assert.equal(m.owner.listAccessRequests(ctx, { status: 'pending' }).requests.length, 1, 'idempotent');

  // the demo address book: two humans, soft circles, per-persona importance
  const people = m.owner.peopleList(ctx, { personaId: p.id });
  assert.equal(people.people.length, 2);
  assert.equal(people.people[0].name, 'nina');
  assert.equal(people.people[0].importance, 5);
  assert.deepEqual(m.owner.peopleCircles(ctx, { personaId: p.id }).circles.map((c) => c.name).sort(), ['basically family', 'friends', 'work']);

  // the address is validated, never invented
  assert.throws(() => m.owner.createPersona(ctx, { name: 'bad', identity: 'linked', email: 'not-an-address' }), /look like an address/);
});
