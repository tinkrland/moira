// the first adapter that can FEED people capture (2026-11-13).
//
// the ingest pipeline was complete and unusable: dedupe, sighting counts,
// disagreeing names, untrusted text, proposals that mint no facts - all tested,
// and no adapter implemented listPeopleSignals, so only a caller could fill the
// address book. a calendar is the cheapest honest feeder: it names people the
// owner actually met, with a date, and needs no new standing access.

import test from 'node:test';
import assert from 'node:assert/strict';
import { Moira } from '../src/index.js';
import { MemoryStore } from '../src/store.js';

const EVENT = {
  id: 'evt_1',
  status: 'confirmed',
  summary: 'studio sync',
  start: { dateTime: '2026-11-10T15:00:00Z' },
  attendees: [
    { email: 'alex@atelier.example', displayName: 'Alex Rivera', responseStatus: 'accepted' },
    { email: 'nina@atelier.example', displayName: 'nina rao', responseStatus: 'accepted' },
    { email: 'owner@home.example', self: true, responseStatus: 'accepted' },
    { email: 'room-3@resource.calendar.example', resource: true },
    { displayName: 'no email at all' }
  ]
};
const CANCELLED = { ...EVENT, id: 'evt_2', status: 'cancelled' };
const ALLDAY = {
  id: 'evt_3', status: 'confirmed', summary: 'offsite',
  start: { date: '2026-11-12' },
  attendees: [{ email: 'dave@atelier.example', displayName: 'dave okafor' }]
};

function fixtureFetch() {
  const calls = [];
  const f = async (url) => {
    calls.push(String(url));
    return {
      ok: true,
      json: async () => ({ items: [EVENT, CANCELLED, ALLDAY] })
    };
  };
  f.calls = calls;
  return f;
}

function setup(overrides = {}) {
  const m = new Moira({ store: new MemoryStore(), io: overrides });
  const owner = m.createOwnerContext({ kind: 'owner_session', verified: true, ownerRef: 'owner-a' });
  const p = m.owner.createPersona(owner, { name: 'alex-work', identity: 'pseudonymous' });
  return { m, owner, p };
}

test('calendar: signals are attendees, dated, and never the owner or a room', () => {
  const { m } = setup({ fetch: fixtureFetch() });
  // the adapter is io only: it normalizes shape and nothing else
  return import('../src/connectors/adapters.js').then(async ({ adapterFor }) => {
    const a = adapterFor('google_calendar', { fetch: fixtureFetch() });
    assert.equal(typeof a.listPeopleSignals, 'function', 'a calendar can feed people capture');
    const out = await a.listPeopleSignals({ accessToken: 'tok' }, {}, { fetch: fixtureFetch() });
    const rows = out.rows;
    assert.deepEqual(rows.map((r) => r.handle).sort(), ['alex@atelier.example', 'dave@atelier.example', 'nina@atelier.example']);
    assert.equal(rows.some((r) => r.handle === 'owner@home.example'), false, 'the owner is not a contact');
    assert.equal(rows.some((r) => r.handle.includes('resource.calendar')), false, 'a room is not a person');
    assert.equal(rows.some((r) => r.handle === null || r.handle === undefined), false, 'an attendee with no address cannot be deduped');
    const nina = rows.find((r) => r.handle === 'nina@atelier.example');
    assert.equal(nina.kind, 'calendar');
    assert.equal(nina.name, 'nina rao');
    assert.equal(nina.at, Date.parse('2026-11-10T15:00:00Z'), 'a sighting carries when');
    assert.equal(rows.find((r) => r.handle === 'dave@atelier.example').at, Date.parse('2026-11-12'), 'an all-day event still dates its people');
    assert.equal(rows.some((r) => r.handle === 'cancelled@atelier.example'), false);
  });
});

test('calendar: capture proposes, and the address book stays empty until accept', async () => {
  const fetchFixture = fixtureFetch();
  const { m, owner, p } = setup({ fetch: fetchFixture });
  const conn = m.owner.connectConnector(owner, {
    personaId: p.id, connectorId: 'google_calendar', credentials: { accessToken: 'tok' }, account: 'alex@work.example'
  });
  assert.equal(conn.outcome, 'results', 'a calendar can be connected now that an adapter exists');

  const before = m.owner.peopleAll(owner).people.length;
  const out = await m.owner.peopleCaptureFromConnector(owner, { personaId: p.id, connectorId: 'google_calendar' });
  assert.equal(out.outcome, 'results');
  assert.equal(out.proposed, 3, 'three people seen, three proposals');
  assert.equal(out.populated, false, 'capture proposes, never populates');
  assert.equal(m.owner.peopleAll(owner).people.length, before, 'the book is untouched by a capture');

  const proposals = m.owner.peopleProposals(owner, { status: 'open' }).proposals;
  assert.equal(proposals.length, 3);
  assert.ok(proposals.every((x) => x.untrusted === true), 'captured names stay untrusted text');
});

test('calendar: an adapter that cannot look says so instead of finding nothing', async () => {
  const { m, owner, p } = setup({ fetch: fixtureFetch() });
  // drive can read files but cannot name people: that must not read as "no people"
  m.owner.connectConnector(owner, { personaId: p.id, connectorId: 'google_drive', credentials: { accessToken: 'tok' } });
  const out = await m.owner.peopleCaptureFromConnector(owner, { personaId: p.id, connectorId: 'google_drive' });
  assert.equal(out.outcome, 'unavailable');
  assert.equal(out.reason, 'adapter_cannot_feed_people');
});
