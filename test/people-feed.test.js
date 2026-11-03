// wiring the capture: a connector yields people signals, the feed normalizes
// them, the people service turns them into proposals. three links, each doing
// one thing, because the alternative is a daemon that quietly reads a mailbox.
//
// the rules this file pins:
//
// 1. an adapter that cannot feed people SAYS so. a calendar adapter with no
//    signal method returns `adapter_cannot_feed_people`, never an empty success -
//    "nothing found" and "could not look" must not read the same.
// 2. the feed never sees a credential. the hub unseals, calls the adapter, and
//    returns only normalized rows; nothing downstream can leak a token because
//    nothing downstream ever holds one.
// 3. the feed creates no people. capture is a proposal, and it stays one.
// 4. a capture is an owner act. there is no pass that lets an agent pull its
//    human's calendar into the address book.

import test from 'node:test';
import assert from 'node:assert/strict';
import { Moira } from '../src/index.js';
import { MemoryStore } from '../src/store.js';

const ownerSession = () => ({ kind: 'owner_session', verified: true, ownerRef: 'owner' });

function setup({ adapter = null } = {}) {
  const calls = [];
  const drive = adapter ?? {
    id: 'drive',
    async listFiles() { return { rows: [] }; },
    async readFile() { return { content: 'x', meta: {} }; },
    async listPeopleSignals(creds, params) {
      calls.push({ creds, params });
      return {
        rows: [
          { kind: 'calendar_attendee', handle: 'nina@atelier.example', name: 'Nina Rao', at: 1_800_000_000_000 },
          { kind: 'mail_sender', handle: 'NINA@atelier.example', name: 'nina', at: 1_800_000_500_000 },
          { kind: 'mail_sender', handle: 'not-a-handle', name: 'nobody', at: 1_800_000_900_000 }
        ]
      };
    }
  };
  const m = new Moira({ store: new MemoryStore(), io: { adapters: { drive } } });
  const ctx = m.createOwnerContext(ownerSession());
  const persona = m.owner.createPersona(ctx, { name: 'alex', identity: 'pseudonymous' });
  m.owner.connectConnector(ctx, {
    personaId: persona.id, connectorId: 'google_drive', credentials: { t: 'super-secret-token' },
    project: 'atlas', capabilities: ['people:capture']
  });
  return { m, ctx, persona, calls };
}

test('the feed wires an adapter to proposals, dedupes, and drops unusable rows', async () => {
  const { m, ctx, persona, calls } = setup();
  const out = await m.owner.peopleCaptureFromConnector(ctx, {
    personaId: persona.id, connectorId: 'google_drive', project: 'atlas'
  });
  assert.equal(out.outcome, 'results');
  assert.equal(out.proposed, 1, 'one handle, seen twice, is one proposal');
  assert.equal(out.rejected, 1, 'a row that is not a handle is reported, not silently kept');
  assert.equal(calls.length, 1);

  const props = m.owner.peopleProposals(ctx).proposals;
  assert.equal(props.length, 1);
  assert.equal(props[0].sightings, 2, 'both sightings landed on the same proposal');
  assert.equal(m.owner.peopleAll(ctx).people.length, 0, 'the book is still empty');
});

test('the feed never holds a credential: only normalized rows travel', async () => {
  const { m, ctx, persona } = setup();
  await m.owner.peopleCaptureFromConnector(ctx, { personaId: persona.id, connectorId: 'google_drive', project: 'atlas' });
  const everything = JSON.stringify([
    m.owner.peopleProposals(ctx),
    m.owner.peopleAll(ctx),
    [...m.store.list('receipts', () => true, {})]
  ]);
  assert.equal(everything.includes('super-secret-token'), false, 'no token left the hub');
});

test('an adapter that cannot feed people refuses instead of returning nothing', async () => {
  const blind = { id: 'drive', async listFiles() { return { rows: [] }; }, async readFile() { return { content: '', meta: {} }; } };
  const { m, ctx, persona } = setup({ adapter: blind });
  const out = await m.owner.peopleCaptureFromConnector(ctx, { personaId: persona.id, connectorId: 'google_drive', project: 'atlas' });
  assert.equal(out.outcome, 'unavailable');
  assert.equal(out.reason, 'adapter_cannot_feed_people', 'could not look is not the same as found nothing');
  assert.equal(m.owner.peopleProposals(ctx).proposals.length, 0);
});

test('capture is an owner act, and a missing connection says which link broke', async () => {
  const { m, ctx, persona } = setup();
  const agent = m.owner.registerAgent(ctx, { name: 'helper', tier: 'verified', personasAllowed: [persona.id], spendCaps: { usd: 1 } });
  // the owner surface refuses a non-owner context by throwing, which is the
  // contract every owner method shares - asserted, not assumed
  assert.throws(() => m.owner.peopleCaptureFromConnector({ kind: 'agent', clientId: agent.id }, {
    personaId: persona.id, connectorId: 'google_drive', project: 'atlas'
  }), /OwnerContext/, 'no pass lets an agent pull a calendar into the book');

  const missing = await m.owner.peopleCaptureFromConnector(ctx, { personaId: persona.id, connectorId: 'google_drive', project: 'nowhere' });
  assert.equal(missing.outcome, 'unavailable');
  assert.equal(missing.reason, 'no_active_identity', 'the refusal names the broken link');
});
