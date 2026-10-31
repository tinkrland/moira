// the ego.ist build, step 4: directed disclosure.
//
// the shape: an app needs selected protected fields delivered to ONE exact
// https destination it does not control the response of. the owner approves.
// moira delivers once, server-to-server, and hands the app a content-free
// status plus a signed attestation. the app never sees the values, not in the
// response, not in an error, and a second delivery is impossible.

import test from 'node:test';
import assert from 'node:assert/strict';
import { Moira } from '../src/index.js';
import { MemoryStore } from '../src/store.js';

function setup() {
  const m = new Moira({ store: new MemoryStore(), netguard: { resolve: async () => ['93.184.216.34'] } });
  const ctx = m.createOwnerContext({ kind: 'owner_session', verified: true, ownerRef: 'owner' });
  const persona = m.owner.createPersona(ctx, { name: 'alexa', identity: 'linked' });
  const agentId = m.owner.registerAgent(ctx, { name: 'shop', tier: 'verified', personasAllowed: [persona.id], spendCaps: { usd: 1 } }).id;
  const token = m.owner.createSession(ctx, { clientId: agentId, personaId: persona.id }).accessToken;
  const p = m.personas.get(persona.id);
  m.facts.add(p, { content: 'size M in outerwear', category: 'preferences', fields: ['sizes'] });
  m.facts.add(p, { content: 'prefers navy over black', category: 'preferences', fields: ['colour'] });
  return { m, ctx, persona, agentId, token };
}

test('disclosure: one exact destination, one delivery, no values to the app', async () => {
  const { m, ctx, persona, token } = setup();

  const ask = m.agent.request_disclosure(token, {
    fields: ['preferences.sizes'],
    destination: 'https://shop.example.com/passport/hook',
    purpose: 'size_recommendation'
  });
  assert.equal(ask.outcome, 'approval_required');
  assert.ok(ask.disclosureId);

  // exact https only, addressed fields only, purpose required
  assert.equal(m.agent.request_disclosure(token, { fields: ['preferences.sizes'], destination: 'http://shop.example.com/h', purpose: 'x' }).reason, 'destination_must_be_exact_https');
  assert.equal(m.agent.request_disclosure(token, { fields: [], destination: 'https://a.b/c', purpose: 'x' }).reason, 'fields_required');
  assert.equal(m.agent.request_disclosure(token, { fields: ['preferences.sizes'], destination: 'https://a.b/c', purpose: '' }).reason, 'purpose_required');

  const inbox = m.owner.listDisclosures(ctx, { status: 'pending' });
  assert.equal(inbox.disclosures.length, 1);

  // the owner approves; the host's delivery function carries the payload
  const sent = [];
  const approved = await m.owner.approveDisclosure(ctx, {
    disclosureId: ask.disclosureId,
    deliver: async (destination, payload) => { sent.push({ destination, payload }); return { ok: true }; }
  });
  assert.equal(approved.outcome, 'results');
  assert.equal(sent.length, 1, 'delivered exactly once');
  assert.equal(sent[0].destination, 'https://shop.example.com/passport/hook');
  assert.deepEqual(sent[0].payload.values, [{ field: 'preferences.sizes', value: 'size M in outerwear' }], 'only the addressed field');

  // the app's view is content-free: status + attestation, never a value
  const status = m.agent.disclosure_status(token, { disclosureId: ask.disclosureId });
  assert.equal(status.status, 'delivered');
  assert.ok(status.attestation, 'signed attestation');
  assert.equal(JSON.stringify(status).includes('size M'), false, 'no value leaks to the app');
  assert.equal(JSON.stringify(status).includes('navy'), false, 'no other value either');

  // one delivery only
  const again = await m.owner.approveDisclosure(ctx, {
    disclosureId: ask.disclosureId,
    deliver: async () => { throw new Error('must not be called'); }
  });
  assert.equal(again.outcome, 'declined');
  assert.equal(again.reason, 'already_delivered');
});

test('disclosure: a destination that resolves inward is refused before anything opens', async () => {
  const m = new Moira({ store: new MemoryStore(), netguard: { resolve: async () => ['169.254.169.254'] } });
  const ctx = m.createOwnerContext({ kind: 'owner_session', verified: true, ownerRef: 'owner' });
  const persona = m.owner.createPersona(ctx, { name: 'alexa', identity: 'linked' });
  m.facts.add(m.personas.get(persona.id), { content: 'size M in outerwear', category: 'preferences', fields: ['sizes'] });
  const agentId = m.owner.registerAgent(ctx, { name: 'styler', tier: 'verified', personasAllowed: [persona.id], spendCaps: { usd: 5 } }).id;
  const token = m.owner.createSession(ctx, { clientId: agentId, personaId: persona.id }).accessToken;

  const ask = m.agent.request_disclosure(token, {
    fields: ['preferences.sizes'],
    destination: 'https://innocent-looking.example/hook', // resolves to imds
    purpose: 'size_recommendation'
  });
  let delivered = 0;
  const res = await m.owner.approveDisclosure(ctx, { disclosureId: ask.disclosureId, deliver: async () => { delivered += 1; return { ok: true }; } });

  assert.equal(res.outcome, 'declined');
  assert.equal(res.reason, 'cloud_metadata_blocked');
  assert.equal(delivered, 0, 'nothing was sent anywhere');
  const app = m.agent.disclosure_status(token, { disclosureId: ask.disclosureId });
  assert.equal(app.status, 'failed');
  assert.equal(app.failure, 'cloud_metadata_blocked');
  assert.equal(JSON.stringify(app).includes('size M'), false, 'still no values');
});

test('disclosure: denial and failed delivery leak nothing either', async () => {
  const { m, ctx, token } = setup();

  const a = m.agent.request_disclosure(token, { fields: ['preferences.colour'], destination: 'https://shop.example.com/h', purpose: 'styling' });
  const denied = m.owner.denyDisclosure(ctx, { disclosureId: a.disclosureId, reason: 'not needed' });
  assert.equal(denied.outcome, 'results');
  assert.equal(m.agent.disclosure_status(token, { disclosureId: a.disclosureId }).status, 'denied');

  const b = m.agent.request_disclosure(token, { fields: ['preferences.colour'], destination: 'https://shop.example.com/h', purpose: 'styling' });
  const failed = await m.owner.approveDisclosure(ctx, {
    disclosureId: b.disclosureId,
    deliver: async () => ({ ok: false, status: 502 })
  });
  assert.equal(failed.outcome, 'results');
  assert.equal(failed.disclosure.status, 'failed');
  const st = m.agent.disclosure_status(token, { disclosureId: b.disclosureId });
  assert.equal(st.status, 'failed');
  assert.equal(JSON.stringify(st).includes('navy'), false);

  // a failed delivery is not retried by the app asking again: a new ask is a new ask
  const receipts = m.owner.exportPersona(ctx, m.owner.overview(ctx).personas[0].id).receipts.filter((r) => r.op === 'disclosure');
  assert.ok(receipts.length >= 4, 'request/deny/deliver/fail are all receipted');
});
