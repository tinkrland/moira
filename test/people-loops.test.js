// people: open loops and briefs, per persona.
//
// cresca's real thesis is not the address book - every personal crm has one.
// it is that a relationship carries OPEN LOOPS (the thing you said you'd do)
// and that the loop should surface before it goes cold. moira's version keeps
// that promise without a nag engine: the owner pulls, the loop names itself,
// and nothing notifies anyone.

import test from 'node:test';
import assert from 'node:assert/strict';
import { Moira } from '../src/index.js';
import { MemoryStore } from '../src/store.js';

function setup() {
  const m = new Moira({ store: new MemoryStore() });
  const ctx = m.createOwnerContext({ kind: 'owner_session', verified: true, ownerRef: 'owner' });
  const work = m.owner.createPersona(ctx, { name: 'work-alex', identity: 'pseudonymous' });
  const priv = m.owner.createPersona(ctx, { name: 'sable', identity: 'pseudonymous' });
  const nina = m.owner.peopleAdd(ctx, { name: 'nina', handles: { email: 'nina@atelier.example' } }).person;
  m.owner.peopleProfileSet(ctx, { personaId: work.id, personId: nina.id, circles: ['work'], importance: 5, interaction: 0 });
  return { m, ctx, work, priv, nina };
}

const DAY = 24 * 3600 * 1000;

test('zero interaction is a rating, not a missing value: someone you never deal with can still matter most', () => {
  const { m, ctx, work, nina } = setup();
  const kid = m.owner.peopleAdd(ctx, { name: 'ada', handles: { email: 'ada@family.example' } }).person;
  m.owner.peopleProfileSet(ctx, { personaId: work.id, personId: kid.id, importance: 3, interaction: 4 });

  const listed = m.owner.peopleList(ctx, { personaId: work.id }).people;
  const byId = new Map(listed.map((r) => [r.personId, r]));
  assert.equal(byId.get(nina.id).interaction, 0, 'zero survives the round trip instead of collapsing to unrated');
  assert.notEqual(byId.get(nina.id).interaction, null);

  // importance order puts the zero-interaction person on top
  assert.equal(listed[0].personId, nina.id, 'a 5 matters more than a 3 even with no contact at all');
  // interaction order puts her last among rated people, but still ahead of unrated
  const byContact = m.owner.peopleList(ctx, { personaId: work.id, order: 'interaction' }).people;
  assert.equal(byContact[byContact.length - 1].personId, nina.id);

  const unrated = m.owner.peopleAdd(ctx, { name: 'ghost', handles: { email: 'ghost@x.example' } }).person;
  m.owner.peopleProfileSet(ctx, { personaId: work.id, personId: unrated.id, importance: null, interaction: null });
  const order2 = m.owner.peopleList(ctx, { personaId: work.id, order: 'interaction' }).people.map((r) => r.personId);
  assert.ok(order2.indexOf(nina.id) < order2.indexOf(unrated.id),
    'a rated zero outranks an unrated person: "never" is information, "unknown" is not');
});

test('a promise is an open loop with a person, and it lives on one persona only', () => {
  const { m, ctx, work, priv, nina } = setup();
  const added = m.owner.peoplePromiseAdd(ctx, {
    personaId: work.id, personId: nina.id, text: 'send the letterpress studio contact', dueAt: 1_800_000_000_000
  });
  assert.equal(added.outcome, 'results');

  assert.equal(m.owner.peoplePromises(ctx, { personaId: work.id }).promises.length, 1);
  assert.equal(m.owner.peoplePromises(ctx, { personaId: priv.id }).promises.length, 0,
    'a promise made by one hat is not the other hats business');
});

test('due lists what is owed and stale, oldest first, and never nags', () => {
  const { m, ctx, work, nina } = setup();
  const t0 = 1_800_000_000_000;
  m.owner.peoplePromiseAdd(ctx, { personaId: work.id, personId: nina.id, text: 'later thing', dueAt: t0 + 5 * DAY });
  m.owner.peoplePromiseAdd(ctx, { personaId: work.id, personId: nina.id, text: 'sooner thing', dueAt: t0 + 1 * DAY });
  m.owner.peoplePromiseAdd(ctx, { personaId: work.id, personId: nina.id, text: 'no date thing' });

  assert.equal(m.owner.peopleDue(ctx, { personaId: work.id, now: t0 }).promises.length, 0, 'nothing is due yet');
  const due = m.owner.peopleDue(ctx, { personaId: work.id, now: t0 + 2 * DAY }).promises;
  assert.deepEqual(due.map((p) => p.text), ['sooner thing'], 'only what has come due');
  assert.equal(due[0].personName, 'nina', 'the loop names who it is owed to');

  // overdue is reported as an age, not as a scolding
  assert.equal(due[0].overdueByMs, 1 * DAY);
  // undated promises are open loops, not due ones
  assert.equal(m.owner.peopleDue(ctx, { personaId: work.id, now: t0 + 400 * DAY }).promises.length, 2);
});

test('keeping and dropping are the only ways a loop closes, and both are receipts without content', () => {
  const { m, ctx, work, nina } = setup();
  const p1 = m.owner.peoplePromiseAdd(ctx, { personaId: work.id, personId: nina.id, text: 'send contact' }).promise;
  const p2 = m.owner.peoplePromiseAdd(ctx, { personaId: work.id, personId: nina.id, text: 'return the book' }).promise;

  assert.equal(m.owner.peoplePromiseKeep(ctx, { promiseId: p1.id }).outcome, 'results');
  assert.equal(m.owner.peoplePromiseDrop(ctx, { promiseId: p2.id }).outcome, 'results');
  assert.equal(m.owner.peoplePromiseKeep(ctx, { promiseId: p1.id }).reason, 'promise_already_closed');
  assert.equal(m.owner.peoplePromises(ctx, { personaId: work.id }).promises.length, 0);

  const receipts = JSON.stringify(m.store.list('receipts'));
  assert.equal(receipts.includes('send contact'), false, 'a receipt says a loop closed, never what was promised');
});

test('a promise needs a person and a text, and invents nothing when it lacks them', () => {
  const { m, ctx, work, nina } = setup();
  assert.equal(m.owner.peoplePromiseAdd(ctx, { personaId: work.id, personId: 'ppl_missing', text: 'x' }).reason, 'person_not_found');
  assert.equal(m.owner.peoplePromiseAdd(ctx, { personaId: work.id, personId: nina.id, text: '  ' }).reason, 'promise_text_required');
  assert.equal(m.owner.peoplePromiseAdd(ctx, { personaId: 'prs_missing', personId: nina.id, text: 'x' }).reason, 'persona_not_found');
  // a persona that has never profiled the person cannot owe them anything
  const stranger = m.owner.peopleAdd(ctx, { name: 'stranger', handles: { email: 's@x.example' } }).person;
  assert.equal(m.owner.peoplePromiseAdd(ctx, { personaId: work.id, personId: stranger.id, text: 'x' }).reason,
    'person_not_in_this_persona');
});

test('the brief is composed from what is stored, and says what it does not know', () => {
  const { m, ctx, work, nina } = setup();
  m.owner.peopleProfileSet(ctx, { personaId: work.id, personId: nina.id, note: 'met at the letterpress fair' });
  m.owner.peoplePromiseAdd(ctx, { personaId: work.id, personId: nina.id, text: 'send the studio contact', dueAt: 1_800_000_000_000 });

  const brief = m.owner.peopleBrief(ctx, { personaId: work.id, personId: nina.id });
  assert.equal(brief.outcome, 'results');
  assert.equal(brief.name, 'nina');
  assert.deepEqual(brief.circles, ['work']);
  assert.equal(brief.importance, 5);
  assert.equal(brief.interaction, 0);
  assert.equal(brief.note, 'met at the letterpress fair');
  assert.equal(brief.openPromises.length, 1, 'the thing you owe them is part of the brief');
  // a rated zero is KNOWLEDGE ("never"), so it is not reported as a gap
  assert.equal(brief.unknown.includes('no interaction recorded'), false,
    'never is a fact; unrated is the gap');
  assert.deepEqual(brief.unknown, ['no capture history'],
    'a brief lists its gaps instead of filling them with a plausible sentence');

  m.owner.peopleProfileSet(ctx, { personaId: work.id, personId: nina.id, interaction: null });
  assert.ok(m.owner.peopleBrief(ctx, { personaId: work.id, personId: nina.id }).unknown.includes('no interaction recorded'));

  // the brief never fabricates a line of prose about a person
  assert.equal(typeof brief.summary, 'string');
  assert.equal(brief.summary.includes('met at the letterpress fair'), true);
});
