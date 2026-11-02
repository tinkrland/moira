// api keys are not app connectors, and one project is not one token.
//
// the motivating shape: a persona has internal projects (self-created, ours -
// not the provider's workspace). a project has a github PAT and a supabase key.
// and it may have TWO github PATs, because fine-grained tokens are fine-grained:
// one may carry workflow/runners permission and one may not. some projects have
// exactly one of each, some have a second token for a narrow job.
//
// so an identity slot is (persona, connector, PROJECT, workspace, account,
// CREDENTIAL) and capability is what keeps two tokens in one slot distinct. the
// rule is stingy on purpose: when two credentials share a slot, each must say
// what it can do. ambiguity is refused, never guessed. and a read is served by
// the LEAST capable credential that covers the pass - the narrow token wins when
// the broad one is not needed.

import test from 'node:test';
import assert from 'node:assert/strict';
import { Moira } from '../src/index.js';
import { MemoryStore } from '../src/store.js';

const ownerSession = () => ({ kind: 'owner_session', verified: true, ownerRef: 'owner' });

function setup() {
  const seen = [];
  const adapters = {
    drive: {
      id: 'drive',
      async listFiles(creds) { seen.push(creds.t); return { rows: [{ id: 'f1' }] }; },
      async readFile() { return { content: 'x', meta: {} }; }
    }
  };
  const m = new Moira({ store: new MemoryStore(), io: { adapters } });
  const ctx = m.createOwnerContext(ownerSession());
  const persona = m.owner.createPersona(ctx, { name: 'alex', identity: 'linked' });
  const agentId = m.owner.registerAgent(ctx, { name: 'planner', tier: 'verified', personasAllowed: [persona.id], spendCaps: { usd: 5 } }).id;
  const sess = m.owner.createSession(ctx, { clientId: agentId, personaId: persona.id });
  return { m, ctx, persona, agentId, sess, seen };
}

test('two fine-grained tokens can live in one project, distinguished by capability', () => {
  const { m, ctx, persona } = setup();

  const broad = m.owner.connectConnector(ctx, {
    personaId: persona.id, connectorId: 'google_drive', credentials: { t: 'workflow-token' },
    project: 'atlas', credential: 'workflows', capabilities: ['repo:read', 'workflow:write']
  });
  const narrow = m.owner.connectConnector(ctx, {
    personaId: persona.id, connectorId: 'google_drive', credentials: { t: 'read-token' },
    project: 'atlas', credential: 'readonly', capabilities: ['repo:read']
  });
  assert.equal(broad.outcome, 'results');
  assert.equal(narrow.outcome, 'results');
  assert.notEqual(broad.identityId, narrow.identityId, 'a second token in the same project is a second identity');

  const live = m.owner.listConnectors(ctx, { personaId: persona.id }).connectors.filter((c) => c.connectorId === 'google_drive');
  assert.equal(live.length, 2, 'neither token replaced the other');

  // re-authorizing the SAME credential replaces only that slot
  const rotated = m.owner.connectConnector(ctx, {
    personaId: persona.id, connectorId: 'google_drive', credentials: { t: 'read-token-v2' },
    project: 'atlas', credential: 'readonly', capabilities: ['repo:read']
  });
  assert.equal(rotated.outcome, 'results');
  const after = m.owner.listConnectors(ctx, { personaId: persona.id }).connectors.filter((c) => c.connectorId === 'google_drive');
  assert.equal(after.length, 2, 'the other credential survived the replacement');
});

test('stingy: two credentials in one slot must declare capability, or the answer is no', () => {
  const { m, ctx, persona } = setup();
  const first = m.owner.connectConnector(ctx, {
    personaId: persona.id, connectorId: 'google_drive', credentials: { t: 'a' }, project: 'atlas'
  });
  assert.equal(first.outcome, 'results');

  const ambiguous = m.owner.connectConnector(ctx, {
    personaId: persona.id, connectorId: 'google_drive', credentials: { t: 'b' }, project: 'atlas', credential: 'second'
  });
  assert.equal(ambiguous.outcome, 'declined');
  assert.equal(ambiguous.reason, 'capabilities_required_for_multiple_credentials',
    'a slot with two indistinct tokens is refused, not guessed');

  const declared = m.owner.connectConnector(ctx, {
    personaId: persona.id, connectorId: 'google_drive', credentials: { t: 'b' },
    project: 'atlas', credential: 'second', capabilities: ['files:list']
  });
  assert.equal(declared.outcome, 'results', 'declaring capability resolves it');
});

test('the least capable credential that covers the pass is the one that goes out', async () => {
  const { m, ctx, persona, agentId, sess, seen } = setup();
  m.owner.connectConnector(ctx, {
    personaId: persona.id, connectorId: 'google_drive', credentials: { t: 'workflow-token' },
    project: 'atlas', credential: 'workflows', capabilities: ['repo:read', 'workflow:write']
  });
  m.owner.connectConnector(ctx, {
    personaId: persona.id, connectorId: 'google_drive', credentials: { t: 'read-token' },
    project: 'atlas', credential: 'readonly', capabilities: ['repo:read']
  });

  // a pass that only needs repo:read must not be served by the broad token
  const narrowPass = m.owner.grantConnectorPass(ctx, {
    clientId: agentId, personaId: persona.id, connectorId: 'google_drive',
    scope: 'files.list', purpose: 'probe', project: 'atlas', capabilities: ['repo:read']
  });
  assert.equal(narrowPass.outcome, 'results');
  const r1 = await m.agent.connector_read(sess.accessToken, {
    connectorId: 'google_drive', operation: 'list', scope: 'files.list', purpose: 'probe',
    project: 'atlas', capabilities: ['repo:read']
  });
  assert.equal(r1.outcome, 'results');
  assert.deepEqual(seen, ['read-token'], 'the narrow token wins when it is enough');

  // and asking for what only the broad token can do works, on its own pass
  m.owner.grantConnectorPass(ctx, {
    clientId: agentId, personaId: persona.id, connectorId: 'google_drive',
    scope: 'files.list', purpose: 'ci', project: 'atlas', capabilities: ['workflow:write']
  });
  const r2 = await m.agent.connector_read(sess.accessToken, {
    connectorId: 'google_drive', operation: 'list', scope: 'files.list', purpose: 'ci',
    project: 'atlas', capabilities: ['workflow:write']
  });
  assert.equal(r2.outcome, 'results');
  assert.deepEqual(seen, ['read-token', 'workflow-token']);

  // nothing covers this, and the refusal names the gap instead of picking a token
  m.owner.grantConnectorPass(ctx, {
    clientId: agentId, personaId: persona.id, connectorId: 'google_drive',
    scope: 'files.list', purpose: 'admin', project: 'atlas', capabilities: ['admin:org']
  });
  const r3 = await m.agent.connector_read(sess.accessToken, {
    connectorId: 'google_drive', operation: 'list', scope: 'files.list', purpose: 'admin',
    project: 'atlas', capabilities: ['admin:org']
  });
  assert.equal(r3.outcome, 'declined');
  assert.equal(r3.reason, 'capability_not_covered');
});

test('projects are separate even on one connector, and the agent never sees capabilities', async () => {
  const { m, ctx, persona, agentId, sess, seen } = setup();
  m.owner.connectConnector(ctx, {
    personaId: persona.id, connectorId: 'google_drive', credentials: { t: 'atlas' },
    project: 'atlas', capabilities: ['repo:read']
  });
  m.owner.connectConnector(ctx, {
    personaId: persona.id, connectorId: 'google_drive', credentials: { t: 'beacon' },
    project: 'beacon', capabilities: ['repo:read']
  });

  m.owner.grantConnectorPass(ctx, {
    clientId: agentId, personaId: persona.id, connectorId: 'google_drive',
    scope: 'files.list', purpose: 'probe', project: 'atlas', capabilities: ['repo:read']
  });

  const inProject = await m.agent.connector_read(sess.accessToken, {
    connectorId: 'google_drive', operation: 'list', scope: 'files.list', purpose: 'probe',
    project: 'atlas', capabilities: ['repo:read']
  });
  assert.equal(inProject.outcome, 'results');
  assert.deepEqual(seen, ['atlas']);

  // a pass for one project is not a pass for another
  const other = await m.agent.connector_read(sess.accessToken, {
    connectorId: 'google_drive', operation: 'list', scope: 'files.list', purpose: 'probe',
    project: 'beacon', capabilities: ['repo:read']
  });
  assert.notEqual(other.outcome, 'results');
  assert.equal(other.reason, 'no_connector_pass');

  // capability lists are owner metadata, not agent furniture
  const ids = m.owner.listConnectors(ctx, { personaId: persona.id });
  assert.equal(JSON.stringify(ids).includes('capabilities'), false, 'an agent learns no capability list');
  assert.equal(JSON.stringify(ids).includes('repo:read'), false);
});
