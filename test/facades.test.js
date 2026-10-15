// facade split (phase 0 item 5): the agent surface cannot reach owner
// authority, and owner authority is a minted capability, not a flag.

import test from 'node:test';
import assert from 'node:assert/strict';
import { Moira } from '../src/index.js';

const ownerSession = () => ({ kind: 'owner_session', verified: true, ownerRef: 'owner' });
const ownerCtx = (m) => m.createOwnerContext(ownerSession());

const AGENT_TOOLS = [
  'moira_status', 'persona_context', 'remember', 'forget', 'bridge_request', 'bridge_list',
  'bridge_keep', 'bridge_revoke', 'workspace_read', 'workspace_append', 'budget_status',
  'budget_route', 'lease_request', 'lease_revoke', 'ledger_propose', 'context_pack_create',
  'context_pack_redeem', 'handoff_create', 'handoff_accept', 'handoff_return', 'handoff_cancel',
  'voice_get', 'voice_check', 'voice_feedback', 'audit_receipts', 'request_disclosure'
];

const OWNER_METHODS = [
  'createPersona', 'registerAgent', 'createSession', 'grantPass', 'revokePass', 'createBridge',
  'allowIngress', 'approveProposal', 'rejectProposal', 'approveHandoff', 'addAccount', 'killSwitch',
  'mintConnectCode', 'approveConnect', 'approveDisclosure', 'declareLinkageIntention',
  'deletePersona', 'exportPersona', 'monitorScan'
];

test('AgentApi exposes the tool surface and no owner methods', () => {
  const m = new Moira({});
  const protoMethods = Object.getOwnPropertyNames(Object.getPrototypeOf(m.agent)).filter((k) => k !== 'constructor');
  for (const tool of AGENT_TOOLS) {
    assert.ok(protoMethods.includes(tool), `agent api missing tool ${tool}`);
  }
  for (const owner of OWNER_METHODS) {
    assert.ok(!protoMethods.includes(owner), `agent api must not expose ${owner}`);
    assert.equal(typeof m.agent[owner], 'undefined', `agent api must not reach ${owner} even by lookup`);
  }
  // and no way to mint owner authority from the agent surface
  assert.equal(typeof m.agent.createOwnerContext, 'undefined');
});

test('OwnerApi exposes the owner surface and no agent tools', () => {
  const m = new Moira({});
  const protoMethods = Object.getOwnPropertyNames(Object.getPrototypeOf(m.owner)).filter((k) => k !== 'constructor' && !k.startsWith('_'));
  for (const owner of OWNER_METHODS) {
    assert.ok(protoMethods.includes(owner), `owner api missing ${owner}`);
  }
  for (const tool of AGENT_TOOLS) {
    assert.ok(!protoMethods.includes(tool), `owner api must not expose agent tool ${tool}`);
  }
});

test('owner-gated methods reject a plain { owner: true } object', () => {
  const m = new Moira({});
  const ctx = ownerCtx(m);
  const p = m.owner.createPersona(ctx, { name: 'student', identity: 'linked' });
  const fake = { owner: true };

  for (const call of [
    () => m.owner.createPersona(fake, { name: 'x', identity: 'linked' }),
    () => m.owner.registerAgent(fake, { name: 'a' }),
    () => m.owner.createSession(fake, { clientId: 'c', personaId: p.id }),
    () => m.owner.grantPass(fake, { clientId: 'c', personaId: p.id, category: 'notes', purpose: 'research' }),
    () => m.owner.revokePass(fake, 'x'),
    () => m.owner.createBridge(fake, { src: p.id, dst: p.id, purpose: 'x' }),
    () => m.owner.allowIngress(fake, p.id, p.id),
    () => m.owner.approveProposal(fake, 'f'),
    () => m.owner.rejectProposal(fake, 'f'),
    () => m.owner.approveHandoff(fake, 'h'),
    () => m.owner.addAccount(fake, p.id, { provider: 'x' }),
    () => m.owner.killSwitch(fake, p.id),
    () => m.owner.mintConnectCode(fake, { personaId: p.id }),
    () => m.owner.approveConnect(fake, 'x'),
    () => m.owner.approveDisclosure(fake, 'd'),
    () => m.owner.declareLinkageIntention(fake, { personaIds: [p.id, p.id] }),
    () => m.owner.deletePersona(fake, p.id),
    () => m.owner.exportPersona(fake, p.id),
    () => m.owner.monitorScan(fake, { linkageHashes: [] })
  ]) {
    assert.throws(call, /OwnerContext/, 'a plain { owner: true } must never pass');
  }
  // undefined / null are rejected too
  assert.throws(() => m.owner.deletePersona(undefined, p.id), /OwnerContext/);
  assert.throws(() => m.owner.killSwitch(null, p.id), /OwnerContext/);
});

test('createOwnerContext rejects anything that is not a verified owner session', () => {
  const m = new Moira({});
  for (const bad of [null, undefined, {}, { owner: true }, { verified: true }, { kind: 'owner_session' }, { kind: 'agent', verified: true, ownerRef: 'x' }]) {
    assert.throws(() => m.createOwnerContext(bad), /verified owner session/);
  }
  const ctx = m.createOwnerContext({ kind: 'owner_session', verified: true, ownerRef: 'owner', sessionId: 's1' });
  const p = m.owner.createPersona(ctx, { name: 'student', identity: 'linked' });
  assert.equal(p.identity, 'linked');
});

test('the OwnerContext class is not exported: authority is unforgeable from outside', async () => {
  const mod = await import('../src/index.js');
  for (const key of Object.keys(mod)) {
    assert.notEqual(key, 'OwnerContext', 'OwnerContext must not be a public export');
  }
  // and minted contexts from two gateways are not interchangeable tokens in
  // string form: they are instances, checked by identity
  const m = new Moira({});
  const ctx = m.createOwnerContext(ownerSession());
  const forged = { ...ctx }; // spread copy is not an instance
  assert.throws(() => m.owner.killSwitch(forged, 'x'), /OwnerContext/);
});
