// the social half: two people, two personas, one consented link
//
// everything so far keeps a persona's people private. cresca's idea is the
// other direction - a connection between two HUMANS, made through the personas
// they choose, with nothing else attached. that needs an authorization flow, not
// ingestion: an invite code that only works once, on one persona, for one other
// persona, and says as little as possible about the person behind it.
//
// the stingy rules this file pins:
//
// 1. the CODE is a bearer secret. stored hashed, never in plaintext, and an
//    unknown code, an expired code and a used code are refused with the SAME
//    reason - otherwise the refusal itself is an oracle for guessing.
// 2. the invite declares what the recipient may learn. no label offered means
//    the peer shows as nothing, not as an inferred name, and never as a list of
//    the inviter's other personas.
// 3. a share is a discrete act with a payload, sealed to the recipient's persona
//    key, opened once. receipts say that a thing moved, never what it was.
// 4. either side can revoke, and revocation kills deliveries that have not been
//    opened. consent withdrawn is not consent pending.

import test from 'node:test';
import assert from 'node:assert/strict';
import { Moira } from '../src/index.js';
import { MemoryStore } from '../src/store.js';

const DAY = 24 * 3600 * 1000;

function setup(start = 1_800_000_000_000) {
  const clock = { t: start };
  const m = new Moira({ store: new MemoryStore(), now: () => clock.t });
  // two owners on one instance: "inter-owner" means different people, not two
  // hats of the same one
  const a = m.createOwnerContext({ kind: 'owner_session', verified: true, ownerRef: 'owner-a' });
  const b = m.createOwnerContext({ kind: 'owner_session', verified: true, ownerRef: 'owner-b' });
  const personaA = m.owner.createPersona(a, { name: 'alex-work', identity: 'pseudonymous' });
  const personaA2 = m.owner.createPersona(a, {
    name: 'alex-private', identity: 'heteronymous',
    characterSheet: {
      name: 'Alex', backstory: 'keeps a small studio', voice: 'plain and dry',
      beliefs: ['quiet is a feature'], expertise: ['letterpress'], red_lines: ['no surprise calls'],
      canon_rules: ['never speaks for the work hat']
    }
  });
  const personaB = m.owner.createPersona(b, { name: 'sam', identity: 'linked' });
  return { m, a, b, personaA, personaA2, personaB, clock };
}

test('an invite is one code, one use, hashed at rest', () => {
  const { m, a, b, personaA, personaA2, personaB } = setup();
  const inv = m.owner.connectionInvite(a, { personaId: personaA.id, label: 'alex' });
  assert.equal(inv.outcome, 'results');
  assert.ok(inv.code && inv.code.length >= 8);
  assert.equal(inv.expiresAt, 1_800_000_000_000 + 7 * DAY, 'a week by default');

  // the code is not sitting in the store in the clear
  assert.equal(JSON.stringify(m.store.dump ? m.store.dump() : [...m.store.list('connectionInvites', () => true, {})]).includes(inv.code), false,
    'the invite code is never stored in plaintext');

  const acc = m.owner.connectionAccept(b, { code: inv.code, personaId: personaB.id });
  assert.equal(acc.outcome, 'results');
  assert.ok(acc.connectionId);
  assert.equal(acc.peer.label, 'alex', 'the invite declared its label, so the label is what crosses');
  assert.equal(JSON.stringify(acc).includes(personaA2.id), false, 'accepting reveals no other persona of the inviter');

  // both sides see the same link
  const fromA = m.owner.connections(a, { personaId: personaA.id });
  const fromB = m.owner.connections(b, { personaId: personaB.id });
  assert.equal(fromA.connections.length, 1);
  assert.equal(fromB.connections.length, 1);
  assert.equal(fromA.connections[0].id, fromB.connections[0].id);
  assert.equal(fromA.connections[0].state, 'active');

  // one use only, and the refusal is indistinguishable from an unknown code
  const reuse = m.owner.connectionAccept(b, { code: inv.code, personaId: personaB.id });
  assert.equal(reuse.outcome, 'declined');
  assert.equal(reuse.reason, 'invite_unusable');
  const bogus = m.owner.connectionAccept(b, { code: 'ZZZZ-ZZZZ', personaId: personaB.id });
  assert.equal(bogus.reason, 'invite_unusable', 'no oracle: a wrong code and a spent code read the same');
});

test('an invite with no label tells the recipient nothing about who it is', () => {
  const { m, a, b, personaA, personaB } = setup();
  const inv = m.owner.connectionInvite(a, { personaId: personaA.id });
  const acc = m.owner.connectionAccept(b, { code: inv.code, personaId: personaB.id });
  assert.equal(acc.outcome, 'results');
  assert.equal(acc.peer.label, null, 'nothing was offered, so nothing is claimed');
  const listed = m.owner.connections(b, { personaId: personaB.id });
  assert.equal(listed.connections[0].peer.label, null);
});

test('an expired invite is refused, and expiry reads the same as unknown', () => {
  const { m, a, b, personaA, personaB, clock } = setup();
  const inv = m.owner.connectionInvite(a, { personaId: personaA.id, ttlMs: 3600 * 1000 });
  clock.t += 2 * 3600 * 1000;
  const acc = m.owner.connectionAccept(b, { code: inv.code, personaId: personaB.id });
  assert.equal(acc.outcome, 'declined');
  assert.equal(acc.reason, 'invite_unusable');
});

test('a share is sealed to the recipient persona, opened once, and receipted without content', () => {
  const { m, a, b, personaA, personaB } = setup();
  const inv = m.owner.connectionInvite(a, { personaId: personaA.id, label: 'alex' });
  const { connectionId } = m.owner.connectionAccept(b, { code: inv.code, personaId: personaB.id });

  const secret = 'my sister is flying in on the 14th, keep it quiet';
  const sent = m.owner.shareToConnection(a, {
    connectionId, personaId: personaA.id, kind: 'note', payload: { text: secret }
  });
  assert.equal(sent.outcome, 'results');

  // at rest the payload is sealed, not readable
  const raw = JSON.stringify([...m.store.list('connectionDeliveries', () => true, {})]);
  assert.equal(raw.includes(secret), false, 'the delivery is sealed to the recipient persona key');
  assert.equal(JSON.stringify([...m.store.list('receipts', () => true, {})]).includes(secret), false,
    'a receipt records that something moved, never what it said');

  const inbox = m.owner.connectionInbox(b, { personaId: personaB.id });
  assert.equal(inbox.deliveries.length, 1);
  assert.equal(inbox.deliveries[0].kind, 'note');
  assert.equal(inbox.deliveries[0].from.label, 'alex');
  assert.equal(JSON.stringify(inbox).includes(secret), false, 'the list is an envelope, not the letter');

  const opened = m.owner.openDelivery(b, { personaId: personaB.id, deliveryId: inbox.deliveries[0].id });
  assert.equal(opened.outcome, 'results');
  assert.equal(opened.payload.text, secret);

  const again = m.owner.openDelivery(b, { personaId: personaB.id, deliveryId: inbox.deliveries[0].id });
  assert.equal(again.outcome, 'unavailable');
  assert.equal(again.reason, 'already_opened');
});

test('revocation by either side kills deliveries that were never opened', () => {
  const { m, a, b, personaA, personaB } = setup();
  const inv = m.owner.connectionInvite(a, { personaId: personaA.id });
  const { connectionId } = m.owner.connectionAccept(b, { code: inv.code, personaId: personaB.id });
  m.owner.shareToConnection(a, { connectionId, personaId: personaA.id, kind: 'note', payload: { text: 'still pending' } });

  // the recipient withdraws, and consent withdrawn is not consent pending
  const revoked = m.owner.revokeConnection(b, { connectionId, personaId: personaB.id });
  assert.equal(revoked.outcome, 'results');

  const inbox = m.owner.connectionInbox(b, { personaId: personaB.id });
  assert.equal(inbox.deliveries.length, 0, 'nothing waits after a revocation');

  const seen = m.owner.connections(a, { personaId: personaA.id });
  assert.equal(seen.connections[0].state, 'revoked', 'the other side sees it too');

  const after = m.owner.shareToConnection(a, { connectionId, personaId: personaA.id, kind: 'note', payload: { text: 'x' } });
  assert.equal(after.outcome, 'declined');
  assert.equal(after.reason, 'connection_revoked');
});

test('the agent surface is told nothing about connections', () => {
  const { m, a, b, personaA, personaB } = setup();
  const inv = m.owner.connectionInvite(a, { personaId: personaA.id, label: 'alex' });
  m.owner.connectionAccept(b, { code: inv.code, personaId: personaB.id });
  const agent = m.owner.registerAgent(b, { name: 'helper', tier: 'verified', personasAllowed: [personaB.id], spendCaps: { usd: 1 } });
  const sess = m.owner.createSession(b, { clientId: agent.id, personaId: personaB.id });
  const status = m.agent.moira_status(sess.accessToken);
  assert.equal(JSON.stringify(status).includes('connection'), false,
    'an agent does not learn that its human is connected to anyone');
});

test('two personas of one owner are an alias, not a connection', () => {
  const { m, a, personaA, personaA2 } = setup();
  const inv = m.owner.connectionInvite(a, { personaId: personaA.id });
  const self = m.owner.connectionAccept(a, { code: inv.code, personaId: personaA2.id });
  assert.equal(self.outcome, 'declined');
  assert.equal(self.reason, 'same_owner', 'linking your own hats is not a connection between people');
});
