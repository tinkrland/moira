// two axes, because one number cannot say what a relationship is.
//
// IMPORTANCE is a judgement: how much this person matters to this persona.
// INTERACTION is a count of contact: how much this persona actually deals with
// them. the worksona's boss is high on both (you report to them, they shape your
// week); the private layer's view of the same human is low on both - and neither
// view is the "real" one. the axes also come apart inside a single persona: a
// parent can be importance 5, interaction 1, and bluntly averaging those two
// would produce a lie in both directions.
//
// so: both axes are per persona, never inherited, and NEVER collapsed into a
// composite. ordering is available, but it has to name its criterion, because
// "who matters most" and "who do i deal with most" are different questions and a
// silent average answers neither.

import test from 'node:test';
import assert from 'node:assert/strict';
import { Moira } from '../src/index.js';
import { MemoryStore } from '../src/store.js';

const ownerSession = () => ({ kind: 'owner_session', verified: true, ownerRef: 'owner' });

function setup() {
  const m = new Moira({ store: new MemoryStore() });
  const ctx = m.createOwnerContext(ownerSession());
  const work = m.owner.createPersona(ctx, { name: 'worksona', identity: 'pseudonymous' });
  const priv = m.owner.createPersona(ctx, { name: 'private', identity: 'pseudonymous' });
  const boss = m.owner.peopleAdd(ctx, { name: 'Priya Menon', handles: { email: 'priya@studio.example' } }).person;
  const parent = m.owner.peopleAdd(ctx, { name: 'Amma' }).person;
  return { m, ctx, work, priv, boss, parent };
}

test('the boss is high on both axes at work and low in private, and neither view is the real one', () => {
  const { m, ctx, work, priv, boss } = setup();

  m.owner.peopleProfileSet(ctx, { personaId: work.id, personId: boss.id, circles: ['work'], importance: 4, interaction: 5 });
  m.owner.peopleProfileSet(ctx, { personaId: priv.id, personId: boss.id, circles: ['acquaintances'], importance: 2, interaction: 1 });

  const atWork = m.owner.peopleList(ctx, { personaId: work.id }).people.find((p) => p.personId === boss.id);
  const atHome = m.owner.peopleList(ctx, { personaId: priv.id }).people.find((p) => p.personId === boss.id);
  assert.deepEqual([atWork.importance, atWork.interaction], [4, 5]);
  assert.deepEqual([atHome.importance, atHome.interaction], [2, 1]);
  assert.deepEqual(atWork.circles, ['work']);
  assert.deepEqual(atHome.circles, ['acquaintances']);
});

test('the axes come apart inside one persona: importance 5 with interaction 1 is a valid answer', () => {
  const { m, ctx, priv, parent } = setup();
  const set = m.owner.peopleProfileSet(ctx, { personaId: priv.id, personId: parent.id, importance: 5, interaction: 1 });
  assert.equal(set.outcome, 'results', 'no validation ties the two axes together');

  const row = m.owner.peopleList(ctx, { personaId: priv.id }).people[0];
  assert.equal(row.importance, 5);
  assert.equal(row.interaction, 1, 'rarely in contact, still the most important person');
});

test('each axis is validated and cleared on its own', () => {
  const { m, ctx, work, boss } = setup();
  const six = m.owner.peopleProfileSet(ctx, { personaId: work.id, personId: boss.id, interaction: 6 });
  assert.equal(six.outcome, 'declined');
  assert.equal(six.reason, 'interaction_out_of_range');

  const fractional = m.owner.peopleProfileSet(ctx, { personaId: work.id, personId: boss.id, interaction: 2.5 });
  assert.equal(fractional.reason, 'interaction_out_of_range');

  m.owner.peopleProfileSet(ctx, { personaId: work.id, personId: boss.id, importance: 4, interaction: 5 });
  // clearing interaction must not touch importance
  m.owner.peopleProfileSet(ctx, { personaId: work.id, personId: boss.id, interaction: null });
  const row = m.owner.peopleList(ctx, { personaId: work.id }).people[0];
  assert.equal(row.interaction, null);
  assert.equal(row.importance, 4, 'clearing one axis leaves the other alone');
});

test('ordering names its criterion instead of averaging the two', () => {
  const { m, ctx, work, boss, parent } = setup();
  // the boss is the person you deal with most; amma matters most and is rarely in touch
  m.owner.peopleProfileSet(ctx, { personaId: work.id, personId: boss.id, importance: 2, interaction: 5 });
  m.owner.peopleProfileSet(ctx, { personaId: work.id, personId: parent.id, importance: 5, interaction: 1 });

  const byImportance = m.owner.peopleList(ctx, { personaId: work.id, order: 'importance' }).people;
  const byInteraction = m.owner.peopleList(ctx, { personaId: work.id, order: 'interaction' }).people;
  assert.equal(byImportance[0].personId, parent.id, 'who matters most');
  assert.equal(byInteraction[0].personId, boss.id, 'who you deal with most');

  // a composite would rank these two the same; the default must not pretend to
  const dflt = m.owner.peopleList(ctx, { personaId: work.id }).people;
  assert.equal(dflt[0].personId, parent.id, 'default orders by importance, and says so in docs');
  assert.equal(m.owner.peopleList(ctx, { personaId: work.id, order: 'nonsense' }).outcome, 'declined');
});

test('circles report both axes, and nothing is inherited across personas', () => {
  const { m, ctx, work, priv, boss, parent } = setup();
  m.owner.peopleProfileSet(ctx, { personaId: work.id, personId: boss.id, circles: ['work'], importance: 4, interaction: 5 });
  m.owner.peopleProfileSet(ctx, { personaId: work.id, personId: parent.id, circles: ['work'], importance: 2, interaction: 1 });

  const circles = m.owner.peopleCircles(ctx, { personaId: work.id }).circles;
  const workCircle = circles.find((c) => c.name === 'work');
  assert.equal(workCircle.count, 2);
  assert.equal(workCircle.interaction, 6, 'interaction sums like importance does');

  // the other hat has never met either of them
  assert.equal(m.owner.peopleList(ctx, { personaId: priv.id }).people.length, 0);
  assert.equal(m.owner.peopleCircles(ctx, { personaId: priv.id }).circles.length, 0);
});

test('capture never sets either axis: a sighting is not a judgement', () => {
  const { m, ctx, work } = setup();
  m.owner.peopleIngest(ctx, {
    events: [{ kind: 'calendar_attendee', handle: 'priya@studio.example', name: 'Priya Menon', at: 1_800_000_000_000 }],
    source: { connectorId: 'google_calendar' }
  });
  const proposal = m.owner.peopleProposals(ctx).proposals[0];
  const accepted = m.owner.peopleProposalAccept(ctx, { proposalId: proposal.id, personaId: work.id });
  assert.equal(accepted.outcome, 'results');

  const row = m.owner.peopleList(ctx, { personaId: work.id }).people[0];
  assert.equal(row.importance, null, 'a connector cannot rate someone');
  assert.equal(row.interaction, null, 'nor can it claim contact was meaningful');
});
