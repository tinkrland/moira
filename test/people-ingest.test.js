// the book should fill itself, without anything landing in it uninvited.
//
// connector-fed capture is ingestion, and ingestion is where trust goes wrong:
// a calendar says someone was in a meeting, which is a signal, not a
// relationship. so a captured handle becomes a PROPOSAL - counted, deduped,
// attributed to its source, untrusted by construction - and the owner accepts
// it onto a persona, with circles and importance, or declines it.
//
// the rules this file pins:
//
// 1. capture never creates a person. the address book is unchanged until an
//    accept, and an accept is where the human judgement lives.
// 2. one handle is one proposal. repeated sightings count up and keep the first
//    and last seen; casing and whitespace do not fork a person.
// 3. accepting is per persona. two personas accepting the same proposal get two
//    profiles and importance is NOT inherited - the whole point of the model.
// 4. captured names are untrusted text. a name carrying a link or an @handle is
//    stripped down to something displayable, and the proposal says it is
//    untrusted rather than laundering it into a trusted record.
// 5. nothing here mints a fact, and no receipt carries a person's name.

import test from 'node:test';
import assert from 'node:assert/strict';
import { Moira } from '../src/index.js';
import { MemoryStore } from '../src/store.js';

const DAY = 24 * 3600 * 1000;
const ownerSession = () => ({ kind: 'owner_session', verified: true, ownerRef: 'owner' });

function setup(start = 1_800_000_000_000) {
  const clock = { t: start };
  const m = new Moira({ store: new MemoryStore(), now: () => clock.t });
  const ctx = m.createOwnerContext(ownerSession());
  const work = m.owner.createPersona(ctx, { name: 'alex-work', identity: 'pseudonymous' });
  const home = m.owner.createPersona(ctx, { name: 'alex-home', identity: 'pseudonymous' });
  return { m, ctx, work, home, clock };
}

test('capture proposes, it does not populate: the book waits for an accept', () => {
  const { m, ctx, work } = setup();
  const before = m.owner.peopleAll(ctx).people.length;

  const out = m.owner.peopleIngest(ctx, {
    events: [
      { kind: 'calendar_attendee', handle: 'nina@atelier.example', name: 'Nina Rao', at: 1_800_000_000_000 },
      { kind: 'mail_sender', handle: 'dave@studio.example', name: 'Dave Okonkwo', at: 1_800_000_100_000 }
    ],
    source: { connectorId: 'google_calendar' }
  });
  assert.equal(out.outcome, 'results');
  assert.equal(out.proposed, 2);

  assert.equal(m.owner.peopleAll(ctx).people.length, before, 'capture adds no one to the book');
  assert.equal(m.owner.peopleList(ctx, { personaId: work.id }).people.length, 0, 'and profiles nobody on a persona');

  const props = m.owner.peopleProposals(ctx);
  assert.equal(props.proposals.length, 2);
  const nina = props.proposals.find((p) => p.key === 'nina@atelier.example');
  assert.equal(nina.untrusted, true, 'a connector cannot vouch for a human');
  assert.equal(nina.sightings, 1);
  assert.equal(nina.source.connectorId, 'google_calendar');
  assert.ok(JSON.stringify(props).includes('@atelier.example'), 'the owner sees the handle that was captured');
});

test('one handle is one proposal, however many times it is seen', () => {
  const { m, ctx, clock } = setup();
  m.owner.peopleIngest(ctx, { events: [{ kind: 'mail_sender', handle: 'Nina@Atelier.Example ', name: 'nina', at: clock.t }], source: { connectorId: 'gmail' } });
  clock.t += 3 * DAY;
  m.owner.peopleIngest(ctx, { events: [{ kind: 'calendar_attendee', handle: 'nina@atelier.example', name: 'Nina Rao', at: clock.t }], source: { connectorId: 'google_calendar' } });

  const props = m.owner.peopleProposals(ctx).proposals;
  assert.equal(props.length, 1, 'casing and whitespace do not fork a person');
  assert.equal(props[0].sightings, 2);
  assert.ok(props[0].lastSeenAt > props[0].firstSeenAt);
  assert.deepEqual(props[0].nameCandidates.sort(), ['Nina Rao', 'nina'], 'disagreeing names are kept as candidates, not resolved by guessing');
});

test('accepting puts a person on ONE persona, and importance is not inherited', () => {
  const { m, ctx, work, home } = setup();
  m.owner.peopleIngest(ctx, {
    events: [{ kind: 'calendar_attendee', handle: 'nina@atelier.example', name: 'Nina Rao', at: 1_800_000_000_000 }],
    source: { connectorId: 'google_calendar' }
  });
  const proposal = m.owner.peopleProposals(ctx).proposals[0];

  const accepted = m.owner.peopleProposalAccept(ctx, {
    proposalId: proposal.id, personaId: work.id, circles: ['work'], importance: 4
  });
  assert.equal(accepted.outcome, 'results');
  assert.ok(accepted.personId);

  const onWork = m.owner.peopleList(ctx, { personaId: work.id }).people;
  const onHome = m.owner.peopleList(ctx, { personaId: home.id }).people;
  assert.equal(onWork.length, 1);
  assert.equal(onWork[0].importance, 4);
  assert.equal(onHome.length, 0, 'the other hat still has never met her');

  const again = m.owner.peopleProposalAccept(ctx, { proposalId: proposal.id, personaId: work.id });
  assert.equal(again.outcome, 'declined');
  assert.equal(again.reason, 'already_accepted');

  // the second persona accepts separately and starts unrated
  const onSecond = m.owner.peopleProposalAccept(ctx, { proposalId: proposal.id, personaId: home.id, circles: ['friends'] });
  assert.equal(onSecond.outcome, 'results');
  const homeList = m.owner.peopleList(ctx, { personaId: home.id }).people;
  assert.equal(homeList.length, 1);
  assert.equal(homeList[0].importance, null, 'no inheritance: the home hat rates her herself');
  assert.deepEqual(homeList[0].circles, ['friends']);
});

test('captured names are untrusted text, so links and handles are stripped', () => {
  const { m, ctx, work } = setup();
  m.owner.peopleIngest(ctx, {
    events: [{
      kind: 'mail_sender',
      handle: 'nina@atelier.example',
      name: 'Nina Rao https://atelier.example/nina @nina_dev',
      at: 1_800_000_000_000
    }],
    source: { connectorId: 'gmail' }
  });
  const proposal = m.owner.peopleProposals(ctx).proposals[0];
  const shown = proposal.nameCandidates[0];
  assert.equal(shown.includes('http'), false, 'a captured link is not part of a name');
  assert.equal(shown.includes('@'), false, 'nor is a handle');
  assert.match(shown, /Nina Rao/);
  assert.equal(proposal.untrusted, true);

  // and acceptance does not launder that into a trusted claim
  const accepted = m.owner.peopleProposalAccept(ctx, { proposalId: proposal.id, personaId: work.id });
  assert.equal(accepted.outcome, 'results');
  const person = m.owner.peopleAll(ctx).people.find((p) => p.id === accepted.personId);
  assert.equal(person.name.includes('http'), false);
});

test('declining hides a proposal without touching the book, and capture mints no facts', () => {
  const { m, ctx, work } = setup();
  const factsBefore = m.facts.active(work.id).length;
  m.owner.peopleIngest(ctx, {
    events: [{ kind: 'calendar_attendee', handle: 'spam@example.example', name: 'Unknown', at: 1_800_000_000_000 }],
    source: { connectorId: 'google_calendar' }
  });
  const proposal = m.owner.peopleProposals(ctx).proposals[0];
  const declined = m.owner.peopleProposalDecline(ctx, { proposalId: proposal.id });
  assert.equal(declined.outcome, 'results');

  assert.equal(m.owner.peopleProposals(ctx).proposals.length, 0, 'declined proposals leave the working list');
  assert.equal(m.owner.peopleAll(ctx).people.length, 0, 'and the book is untouched');

  // nothing was learned as a fact about anyone
  assert.equal(m.facts.active(work.id).length, factsBefore);
  const receipts = JSON.stringify([...m.store.list('receipts', () => true, {})]);
  assert.equal(receipts.includes('spam@example.example'), false, 'receipts never carry a person handle');
  assert.equal(receipts.includes('Unknown'), false);
});
