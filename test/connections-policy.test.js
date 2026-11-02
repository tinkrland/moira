// a connection is not "gmail". it is a platform, a WORKSPACE on that platform,
// and an account inside it - and it is not a fact about the owner forever, it is
// a permission that must stay revocable and can be made self-rotating.
//
// three rules this file pins:
//
// 1. WORKSPACE is a first-class dimension. one google account can hold two
//    work spaces, one slack login can reach two teams, one notion account can
//    see three workspaces. keying on (persona, connector, account) silently
//    collapses those into one, which is how the wrong workspace gets read.
//
// 2. NO CROSS-PERSONA CREDENTIAL REUSE, by default. if two personas authorize
//    the same credential, the PROVIDER sees one human wearing two hats - the
//    exact thing persona separation exists to prevent. the check is a
//    fingerprint (never the credential), it refuses by default, it is
//    owner-only, and an agent can never observe it.
//
// 3. FINE-GRAINED BY DEFAULT. a connector pass is a session, not a standing
//    grant, and standing needs an explicit acknowledgement. a connection is
//    revocable by default and may be made rotating; rotation keeps the identity
//    and its passes alive while replacing the sealed material.

import test from 'node:test';
import assert from 'node:assert/strict';
import { Moira } from '../src/index.js';
import { MemoryStore } from '../src/store.js';

const ownerSession = () => ({ kind: 'owner_session', verified: true, ownerRef: 'owner' });

function setup({ adapters = {}, now } = {}) {
  const m = new Moira({ store: new MemoryStore(), io: { adapters }, ...(now ? { now } : {}) });
  const ctx = m.createOwnerContext(ownerSession());
  const persona = m.owner.createPersona(ctx, { name: 'alex', identity: 'linked' });
  const agentId = m.owner.registerAgent(ctx, { name: 'planner', tier: 'verified', personasAllowed: [persona.id], spendCaps: { usd: 5 } }).id;
  const sess = m.owner.createSession(ctx, { clientId: agentId, personaId: persona.id });
  return { m, ctx, persona, agentId, sess };
}

const driveAdapter = (seen) => ({
  id: 'drive',
  async listFiles(creds) { seen.push(creds.t); return { rows: [{ id: 'f1' }] }; },
  async readFile() { return { content: 'x', meta: {} }; }
});

test('a connection is keyed by workspace as well as account, and both stay separate', async () => {
  const seen = [];
  const { m, ctx, persona, agentId, sess } = setup({ adapters: { drive: driveAdapter(seen) } });

  // one google account, two workspaces: the case that used to collapse
  const first = m.owner.connectConnector(ctx, {
    personaId: persona.id, connectorId: 'google_drive', credentials: { t: 'acme' },
    account: 'me@acme.dev', workspace: 'acme'
  });
  const second = m.owner.connectConnector(ctx, {
    personaId: persona.id, connectorId: 'google_drive', credentials: { t: 'personal' },
    account: 'me@acme.dev', workspace: 'personal'
  });
  assert.equal(first.outcome, 'results');
  assert.equal(second.outcome, 'results');
  assert.notEqual(first.identityId, second.identityId, 'two workspaces are two identities, not a replacement');

  // re-authorizing one workspace replaces only that one
  const again = m.owner.connectConnector(ctx, {
    personaId: persona.id, connectorId: 'google_drive', credentials: { t: 'acme-v2' },
    account: 'me@acme.dev', workspace: 'acme'
  });
  const live = m.owner.listConnectors(ctx, { personaId: persona.id });
  assert.equal(live.connectors.filter((c) => c.connectorId === 'google_drive').length, 2, 'the other workspace survived');

  m.owner.grantConnectorPass(ctx, {
    clientId: agentId, personaId: persona.id, connectorId: 'google_drive',
    scope: 'files.list', purpose: 'probe', workspace: 'personal'
  });
  const read = await m.agent.connector_read(sess.accessToken, {
    connectorId: 'google_drive', operation: 'list', scope: 'files.list', purpose: 'probe', workspace: 'personal'
  });
  assert.equal(read.outcome, 'results');
  assert.deepEqual(seen, ['personal'], 'the pass pinned one workspace, and it was the one read');
  assert.ok(again.identityId);
});

test('the same credential on two personas is refused, because the provider would see one human', () => {
  const { m, ctx, persona } = setup();
  const other = m.owner.createPersona(ctx, { name: 'work-ghost', identity: 'pseudonymous' });

  const a = m.owner.connectConnector(ctx, {
    personaId: persona.id, connectorId: 'google_drive', credentials: { t: 'shared-token' }, account: 'me@acme.dev'
  });
  assert.equal(a.outcome, 'results');

  const b = m.owner.connectConnector(ctx, {
    personaId: other.id, connectorId: 'google_drive', credentials: { t: 'shared-token' }, account: 'me@acme.dev'
  });
  assert.equal(b.outcome, 'approval_required', 'linkage stops the connection before it exists');
  assert.equal(b.reason, 'credential_linkage');
  assert.ok(b.linkId, 'the finding is recorded, owner-visible');
  assert.equal(JSON.stringify(b).includes('shared-token'), false, 'the finding never carries the credential');

  // a declared link lets it through, and it is a permanent record of the risk
  const c = m.owner.connectConnector(ctx, {
    personaId: other.id, connectorId: 'google_drive', credentials: { t: 'shared-token' },
    account: 'me@acme.dev', acknowledgeLinkage: true
  });
  assert.equal(c.outcome, 'results');
  const links = m.owner.listConnectionLinks(ctx);
  assert.equal(links.links.length, 1);
  assert.equal(links.links[0].personaIds.length, 2);

  // the agent surface never learns any of this
  const ids = m.owner.listConnectors(ctx, { personaId: other.id });
  assert.equal(JSON.stringify(ids).includes('link'), false, 'no linkage on a surface an agent can read');
});

test('a connector pass is a session by default, and standing needs an acknowledgement', () => {
  const { m, ctx, persona, agentId } = setup();
  m.owner.connectConnector(ctx, { personaId: persona.id, connectorId: 'google_drive', credentials: { t: 'x' }, account: 'a' });

  const narrow = m.owner.grantConnectorPass(ctx, {
    clientId: agentId, personaId: persona.id, connectorId: 'google_drive', scope: 'files.list', purpose: 'probe'
  });
  assert.equal(narrow.outcome, 'results');
  assert.equal(narrow.duration, 'session', 'fine-grained by default: not a standing grant');
  assert.ok(narrow.expiresAt, 'a session pass expires');

  const standing = m.owner.grantConnectorPass(ctx, {
    clientId: agentId, personaId: persona.id, connectorId: 'google_drive', scope: 'files.list',
    purpose: 'probe', duration: 'permanent'
  });
  assert.equal(standing.outcome, 'declined');
  assert.equal(standing.reason, 'standing_requires_acknowledgement');

  const acknowledged = m.owner.grantConnectorPass(ctx, {
    clientId: agentId, personaId: persona.id, connectorId: 'google_drive', scope: 'files.list',
    purpose: 'probe', duration: 'permanent', acknowledgeStanding: true
  });
  assert.equal(acknowledged.outcome, 'results');
  assert.equal(acknowledged.expiresAt, null);
});

test('a connection is revocable by default and can be made to rotate itself', async () => {
  let clock = 1_800_000_000_000;
  const seen = [];
  const { m, ctx, persona, agentId, sess } = setup({ adapters: { drive: driveAdapter(seen) }, now: () => clock });

  const conn = m.owner.connectConnector(ctx, {
    personaId: persona.id, connectorId: 'google_drive', credentials: { t: 'v1' }, account: 'me@acme.dev', workspace: 'acme'
  });
  const policy = m.owner.connectionPolicy(ctx, { identityId: conn.identityId });
  assert.equal(policy.mode, 'revocable', 'revocable is the default, not an opt-in');
  assert.equal(policy.rotationEveryMs, null);

  // rotation must be asked for
  const refused = m.owner.rotateConnection(ctx, { identityId: conn.identityId, credentials: { t: 'v2' } });
  assert.equal(refused.outcome, 'declined');
  assert.equal(refused.reason, 'not_a_rotating_connection');

  const set = m.owner.setConnectionPolicy(ctx, { identityId: conn.identityId, mode: 'rotating', everyMs: 24 * 3600 * 1000 });
  assert.equal(set.outcome, 'results');
  assert.equal(m.owner.dueRotations(ctx).identities.length, 0, 'not due yet');

  // a live pass, granted before rotation, must survive it
  m.owner.grantConnectorPass(ctx, {
    clientId: agentId, personaId: persona.id, connectorId: 'google_drive',
    scope: 'files.list', purpose: 'probe', workspace: 'acme'
  });

  const rotated = m.owner.rotateConnection(ctx, { identityId: conn.identityId, credentials: { t: 'v2' } });
  assert.equal(rotated.outcome, 'results');
  assert.equal(rotated.rotationCount, 1);

  const read = await m.agent.connector_read(sess.accessToken, {
    connectorId: 'google_drive', operation: 'list', scope: 'files.list', purpose: 'probe', workspace: 'acme'
  });
  assert.equal(read.outcome, 'results');
  assert.deepEqual(seen, ['v2'], 'the new material is what goes out, and the old value is gone');

  clock += 25 * 3600 * 1000;
  assert.equal(m.owner.dueRotations(ctx).identities.length, 1, 'the clock makes it due');

  // and it stays revocable no matter what the rotation policy says. grant a
  // FRESH pass first, so the refusal below is about revocation and not the
  // clock having expired the old one.
  m.owner.grantConnectorPass(ctx, {
    clientId: agentId, personaId: persona.id, connectorId: 'google_drive',
    scope: 'files.list', purpose: 'probe', workspace: 'acme'
  });
  const revoked = m.owner.revokeConnector(ctx, { identityId: conn.identityId });
  assert.equal(revoked.outcome, 'results');
  // the 25h clock jump also expired the agent's SESSION, so take a new one:
  // otherwise the refusal below would be about the session, not the connection
  const freshSession = m.owner.createSession(ctx, { clientId: agentId, personaId: persona.id });
  const after = await m.agent.connector_read(freshSession.accessToken, {
    connectorId: 'google_drive', operation: 'list', scope: 'files.list', purpose: 'probe', workspace: 'acme'
  });
  assert.equal(after.outcome, 'declined');
  assert.equal(after.reason, 'no_active_identity', 'a revoked identity takes its passes with it');
});
