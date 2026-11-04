// shared credentials (owner, 2026-11-05): "persona focussed isolated vs cross
// persona shared credentials".
//
// the linkage guard refuses the same secret under two personas because the
// provider sees one human in two hats. but some credentials ARE one key for
// several hats - a personal api key, a paid llm plan - and refusing them just
// teaches the owner to paste the secret twice, which is the same link with extra
// steps. so sharing is a DECLARED act: one identity, listed personas, each still
// needing its own pass. sharing a credential is not sharing a permission.

import test from 'node:test';
import assert from 'node:assert/strict';
import { Moira } from '../src/index.js';
import { MemoryStore } from '../src/store.js';

const ownerSession = () => ({ kind: 'owner_session', verified: true, ownerRef: 'owner' });

function setup() {
  const seen = [];
  const drive = {
    id: 'drive',
    async listFiles(creds) { seen.push(creds.t); return { rows: [{ id: 'f1' }] }; },
    async readFile() { return { content: 'x', meta: {} }; }
  };
  const m = new Moira({ store: new MemoryStore(), io: { adapters: { drive } } });
  const ctx = m.createOwnerContext(ownerSession());
  const work = m.owner.createPersona(ctx, { name: 'work', identity: 'linked' });
  const priv = m.owner.createPersona(ctx, { name: 'private', identity: 'linked' });
  const other = m.owner.createPersona(ctx, { name: 'other', identity: 'linked' });
  const agentFor = (personaId) => m.owner.registerAgent(ctx, {
    name: `agent-${personaId}`, tier: 'verified', personasAllowed: [personaId], spendCaps: { usd: 5 }
  }).id;
  return { m, ctx, seen, work: work.id, priv: priv.id, other: other.id, agentFor };
}

const pass = (h, personaId, clientId) => h.m.owner.grantConnectorPass(h.ctx, {
  clientId, personaId, connectorId: 'google_drive', scope: 'files.list', purpose: 'probe'
});

test('one declared credential serves several personas, each with its own pass', async () => {
  const h = setup();
  const made = h.m.owner.connectConnector(h.ctx, {
    personaId: h.work, connectorId: 'google_drive', credentials: { t: 'one-key' }, sharedWith: [h.priv]
  });
  assert.equal(made.outcome, 'results');
  assert.equal(made.shareScope, 'shared');

  const workAgent = h.agentFor(h.work);
  const privAgent = h.agentFor(h.priv);
  pass(h, h.work, workAgent);
  pass(h, h.priv, privAgent);

  for (const [personaId, clientId] of [[h.work, workAgent], [h.priv, privAgent]]) {
    const session = h.m.owner.createSession(h.ctx, { clientId, personaId });
    const out = await h.m.agent.connector_read(session.accessToken, {
      connectorId: 'google_drive', operation: 'list', scope: 'files.list', purpose: 'probe'
    });
    assert.equal(out.outcome, 'results', JSON.stringify(out));
  }
  assert.deepEqual(h.seen, ['one-key', 'one-key'], 'one secret, used twice, never copied');
});

test('sharing a credential is not sharing a permission', async () => {
  const h = setup();
  h.m.owner.connectConnector(h.ctx, {
    personaId: h.work, connectorId: 'google_drive', credentials: { t: 'one-key' }, sharedWith: [h.priv]
  });
  const privAgent = h.agentFor(h.priv);
  const session = h.m.owner.createSession(h.ctx, { clientId: privAgent, personaId: h.priv });
  const out = await h.m.agent.connector_read(session.accessToken, {
    connectorId: 'google_drive', operation: 'list', scope: 'files.list', purpose: 'probe'
  });
  assert.equal(out.outcome, 'declined');
  assert.equal(out.reason, 'no_connector_pass', 'the identity is shared; the pass is still per persona');
  assert.deepEqual(h.seen, []);
});

test('a persona not on the list gets nothing, and hears nothing about who is', async () => {
  const h = setup();
  h.m.owner.connectConnector(h.ctx, {
    personaId: h.work, connectorId: 'google_drive', credentials: { t: 'one-key' }, sharedWith: [h.priv]
  });
  const outsider = h.agentFor(h.other);
  const session = h.m.owner.createSession(h.ctx, { clientId: outsider, personaId: h.other });
  const out = await h.m.agent.connector_read(session.accessToken, {
    connectorId: 'google_drive', operation: 'list', scope: 'files.list', purpose: 'probe'
  });
  assert.equal(out.reason, 'no_active_identity');
});

test('the agent surface marks shared without naming the other persona', async () => {
  const h = setup();
  h.m.owner.connectConnector(h.ctx, {
    personaId: h.work, connectorId: 'google_drive', credentials: { t: 'one-key' }, sharedWith: [h.priv]
  });
  const listed = h.m.owner.listConnectors(h.ctx, { personaId: h.priv });
  assert.equal(listed.connectors.length, 1);
  assert.equal(listed.connectors[0].shared, true);
  assert.equal(listed.connectors[0].mine, false, 'the borrower is told it is not theirs');
  const asJson = JSON.stringify(listed);
  assert.equal(asJson.includes('sharedWith'), false);
  assert.equal(asJson.includes(h.work), false, 'the other hat is not named');
});

test('revoking the shared identity ends it for everyone at once', async () => {
  const h = setup();
  const made = h.m.owner.connectConnector(h.ctx, {
    personaId: h.work, connectorId: 'google_drive', credentials: { t: 'one-key' }, sharedWith: [h.priv]
  });
  const privAgent = h.agentFor(h.priv);
  pass(h, h.priv, privAgent);
  const revoked = h.m.owner.revokeConnector(h.ctx, { identityId: made.identityId });
  assert.equal(revoked.outcome, 'results');
  const session = h.m.owner.createSession(h.ctx, { clientId: privAgent, personaId: h.priv });
  const out = await h.m.agent.connector_read(session.accessToken, {
    connectorId: 'google_drive', operation: 'list', scope: 'files.list', purpose: 'probe'
  });
  assert.equal(out.reason, 'no_active_identity');
});

test('a malformed share list is refused rather than guessed', () => {
  const h = setup();
  const bad = h.m.owner.connectConnector(h.ctx, {
    personaId: h.work, connectorId: 'google_drive', credentials: { t: 'k' }, sharedWith: h.priv
  });
  assert.equal(bad.outcome, 'declined');
  assert.equal(bad.reason, 'shared_with_invalid');

  const self = h.m.owner.connectConnector(h.ctx, {
    personaId: h.work, connectorId: 'google_drive', credentials: { t: 'k' }, sharedWith: [h.work]
  });
  assert.equal(self.reason, 'shared_with_invalid', 'sharing with yourself is not sharing');
});
