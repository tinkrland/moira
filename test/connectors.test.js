// connectors (spec section 14): registry integrity, the hub's gate, credential
// isolation, untrusted tagging, receipts, adapter fixtures.
//
// the hub io (adapters/fetch) is injected everywhere, so nothing here touches
// a real provider. live adapter verification against real oauth apps is a
// stated gap in the readme, not something these tests claim.

import test from 'node:test';
import assert from 'node:assert/strict';
import { Moira } from '../src/index.js';
import { MemoryStore } from '../src/store.js';
import { REGISTRY, BLOCKS, connectorsByBlock, providersForJob, jobOf, CONNECTOR_STATUS, CONNECTOR_KIND } from '../src/connectors/registry.js';
import { driveAdapter, dropboxAdapter, megaAdapter } from '../src/connectors/adapters.js';

const ownerSession = () => ({ kind: 'owner_session', verified: true, ownerRef: 'owner' });

// a fake files adapter: returns fixture rows without any network
function fakeAdapter(rows = []) {
  return {
    id: 'drive',
    async listFiles() { return { rows }; },
    async readFile() { return { content: 'fixture file body', meta: { id: 'file_1' } }; }
  };
}

function setup({ adapters } = {}) {
  const m = new Moira({ store: new MemoryStore(), io: { adapters } });
  const ctx = m.createOwnerContext(ownerSession());
  const persona = m.owner.createPersona(ctx, { name: 'student', identity: 'linked' });
  const agentId = m.owner.registerAgent(ctx, {
    name: 'helper', tier: 'verified', personasAllowed: [persona.id], spendCaps: { usd: 15 }
  }).id;
  const sess = m.owner.createSession(ctx, { clientId: agentId, personaId: persona.id });
  return { m, ctx, persona, agentId, sess };
}

function authorizeDrive(s) {
  return s.m.owner.connectConnector(s.ctx, {
    personaId: s.persona.id,
    connectorId: 'google_drive',
    credentials: { accessToken: 'REAL_SECRET_DRIVE_TOKEN' }
  });
}

// --- registry ------------------------------------------------------------------

// the registry is job-node shaped: blocks contain jobs, jobs carry the
// consent (pass scopes), providers hang under jobs and are swappable
// without re-consenting. a provider serves exactly the jobs it is listed
// under - a swap of dropbox for drive touches one array, no scope changes.

test('registry: retrieve-your-files job is the first wave - all four providers active + connected', () => {
  const files = providersForJob('knowledge', 'files');
  assert.equal(files.length, 4);
  assert.deepEqual(files.map((f) => f.id).sort(), ['dropbox', 'google_drive', 'mega', 'onedrive']);
  for (const f of files) {
    assert.equal(f.status, CONNECTOR_STATUS.ACTIVE);
    assert.equal(f.kind, CONNECTOR_KIND.CONNECTED);
    assert.equal(f.block, 'knowledge');
    assert.equal(f.job, 'files');
  }
});

test('registry: jobs are the consent unit - pass scopes live on the job node', () => {
  const job = jobOf('knowledge', 'files');
  assert.equal(job.label, 'retrieve your files');
  assert.ok(job.passScopes.includes('files.list'));
  assert.ok(job.passScopes.includes('files.read'));
  // scopes are job-level: no provider row needs to restate them
  for (const p of providersForJob('knowledge', 'files')) {
    assert.equal(p.passScopes, undefined, `${p.id}: pass scopes belong to the job, not the provider`);
  }
});

test('registry: knowledge jobs - projects, time, publish (planned, connected or ingest)', () => {
  const projects = providersForJob('knowledge', 'projects');
  assert.deepEqual(projects.map((p) => p.id).sort(), ['craft_docs', 'linear', 'notion']);
  const time = providersForJob('knowledge', 'time');
  assert.deepEqual(time.map((p) => p.id).sort(), ['google_calendar', 'notion_calendar']);
  const publish = providersForJob('knowledge', 'publish');
  assert.deepEqual(publish.map((p) => p.id).sort(), ['medium', 'substack']);
  for (const p of [...projects, ...time, ...publish]) {
    assert.equal(p.status, CONNECTOR_STATUS.PLANNED);
  }
  for (const p of publish) {
    assert.equal(p.kind, CONNECTOR_KIND.INGEST);
  }
});

test('registry: taste block entries are evie-gated, never "active" before evie lands', () => {
  const taste = connectorsByBlock('taste');
  assert.ok(taste.length >= 10);
  for (const t of taste) {
    assert.equal(t.status, CONNECTOR_STATUS.EVIE, `${t.id} must be evie-gated`);
    assert.equal(t.kind, CONNECTOR_KIND.INGEST);
  }
});

test('registry: every flattened provider row references a real block+job', () => {
  const validPairs = new Set(BLOCKS.flatMap((b) => b.jobs.map((j) => `${b.id}/${j.id}`)));
  const ids = REGISTRY.map((c) => c.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const c of REGISTRY) {
    assert.ok(validPairs.has(`${c.block}/${c.job}`), `${c.id} points at unknown block/job ${c.block}/${c.job}`);
  }
});

// --- owner authorize / seal ------------------------------------------------------

test('connectors: owner authorize seals credentials; list shows no credential material', () => {
  const s = setup({ adapters: { drive: fakeAdapter([{ id: 'file_1', name: 'notes.md' }]) } });
  const res = authorizeDrive(s);
  assert.equal(res.outcome, 'results');
  const listed = s.m.owner.listConnectors(s.ctx, { personaId: s.persona.id });
  assert.equal(listed.connectors.length, 1);
  assert.equal(listed.connectors[0].connectorId, 'google_drive');
  const leaked = JSON.stringify(listed).includes('REAL_SECRET_DRIVE_TOKEN');
  assert.ok(!leaked, 'credential material must never appear in a listing');
});

test('connectors: re-authorize replaces the identity (old one revoked)', () => {
  const s = setup({ adapters: { drive: fakeAdapter() } });
  const first = authorizeDrive(s);
  const second = authorizeDrive(s);
  assert.equal(first.outcome, 'results');
  assert.equal(second.outcome, 'results');
  const listed = s.m.owner.listConnectors(s.ctx, { personaId: s.persona.id });
  assert.equal(listed.connectors.length, 1, 'one live identity per (persona, connector)');
  assert.notEqual(listed.connectors[0].identityId, first.identityId);
});

test('connectors: authorize gates - no owner ctx, unknown, inactive, ingest', () => {
  const s = setup({ adapters: { drive: fakeAdapter() } });
  // no owner context
  const noCtx = s.m.connectors.authorize(null, { personaId: s.persona.id, connectorId: 'google_drive', credentials: { x: 1 } });
  assert.equal(noCtx.outcome, 'declined');
  // unknown connector
  const unknown = s.m.owner.connectConnector(s.ctx, { personaId: s.persona.id, connectorId: 'nope', credentials: { x: 1 } });
  assert.equal(unknown.outcome, 'unavailable');
  // planned (not yet active) connector
  const planned = s.m.owner.connectConnector(s.ctx, { personaId: s.persona.id, connectorId: 'notion', credentials: { x: 1 } });
  assert.equal(planned.outcome, 'declined');
  // evie-gated taste connector
  const evie = s.m.owner.connectConnector(s.ctx, { personaId: s.persona.id, connectorId: 'goodreads', credentials: { x: 1 } });
  assert.equal(evie.outcome, 'declined');
  // ingest connector has no authorize path at all
  const ingest = s.m.owner.connectConnector(s.ctx, { personaId: s.persona.id, connectorId: 'depop', credentials: { x: 1 } });
  assert.equal(ingest.outcome, 'declined');
});

// --- connector passes ------------------------------------------------------------

test('connectors: pass grant requires an active identity for the persona', () => {
  const s = setup({ adapters: { drive: fakeAdapter() } });
  const noIdentity = s.m.owner.grantConnectorPass(s.ctx, {
    clientId: s.agentId, personaId: s.persona.id, connectorId: 'google_drive',
    scope: 'files.list', purpose: 'research'
  });
  assert.equal(noIdentity.outcome, 'unavailable');
  authorizeDrive(s);
  const ok = s.m.owner.grantConnectorPass(s.ctx, {
    clientId: s.agentId, personaId: s.persona.id, connectorId: 'google_drive',
    scope: 'files.list', purpose: 'research'
  });
  assert.equal(ok.outcome, 'results');
  assert.ok(ok.passId.startsWith('cpass_'));
});

test('connectors: connector passes are separate from memory passes', () => {
  const s = setup({ adapters: { drive: fakeAdapter() } });
  authorizeDrive(s);
  s.m.owner.grantConnectorPass(s.ctx, {
    clientId: s.agentId, personaId: s.persona.id, connectorId: 'google_drive',
    scope: 'files.list', purpose: 'research'
  });
  // the memory-pass verifier must not see it: category 'google_drive' has
  // no memory pass
  const memoryView = s.m.passes.verify({ clientId: s.agentId, personaId: s.persona.id, category: 'google_drive', purpose: 'research' });
  assert.equal(memoryView, null, 'connector pass must not satisfy a memory-pass check');
});

// --- the read gate ---------------------------------------------------------------

async function readDrive(s, args = {}) {
  return s.m.agent.connector_read(s.sess.accessToken, {
    connectorId: 'google_drive', operation: 'list',
    scope: 'files.list', purpose: 'research', ...args
  });
}

test('connectors: read goes through the gate and tags rows untrusted', async () => {
  const s = setup({ adapters: { drive: fakeAdapter([{ id: 'file_1', name: 'notes.md', mimeType: 'text/markdown' }]) } });
  authorizeDrive(s);
  s.m.owner.grantConnectorPass(s.ctx, {
    clientId: s.agentId, personaId: s.persona.id, connectorId: 'google_drive',
    scope: 'files.list', purpose: 'research'
  });
  const res = await readDrive(s);
  assert.equal(res.outcome, 'results');
  assert.equal(res.rows.length, 1);
  assert.equal(res.rows[0].untrusted, true, 'provider rows are untrusted-tagged');
  assert.equal(res.rows[0].source, 'google_drive');
  assert.equal(res.untrusted, true);
  // receipt written, content-free
  const receipts = s.m.receipts.query({ personaId: s.persona.id, op: 'connector' });
  assert.ok(receipts.length >= 2, 'authorize + read receipts');
  assert.ok(receipts.every((r) => !JSON.stringify(r).includes('REAL_SECRET_DRIVE_TOKEN')));
});

test('connectors: read declines without pass, wrong scope, wrong purpose', async () => {
  const s = setup({ adapters: { drive: fakeAdapter() } });
  authorizeDrive(s);
  const noPass = await readDrive(s);
  assert.equal(noPass.outcome, 'declined');
  assert.equal(noPass.reason, 'no_connector_pass');
  s.m.owner.grantConnectorPass(s.ctx, {
    clientId: s.agentId, personaId: s.persona.id, connectorId: 'google_drive',
    scope: 'files.read', purpose: 'research'
  });
  const wrongScope = await readDrive(s); // asks files.list, pass is files.read
  assert.equal(wrongScope.outcome, 'declined');
  s.m.owner.grantConnectorPass(s.ctx, {
    clientId: s.agentId, personaId: s.persona.id, connectorId: 'google_drive',
    scope: 'files.list', purpose: 'drafting'
  });
  const wrongPurpose = await readDrive(s); // asks research
  assert.equal(wrongPurpose.outcome, 'declined');
});

test('connectors: revoked identity declines reads and kills its passes', async () => {
  const s = setup({ adapters: { drive: fakeAdapter() } });
  const auth = authorizeDrive(s);
  s.m.owner.grantConnectorPass(s.ctx, {
    clientId: s.agentId, personaId: s.persona.id, connectorId: 'google_drive',
    scope: 'files.list', purpose: 'research'
  });
  s.m.owner.revokeConnector(s.ctx, { identityId: auth.identityId });
  const res = await readDrive(s);
  assert.equal(res.outcome, 'declined');
  assert.equal(res.reason, 'no_active_identity');
  // a NEW identity needs a NEW pass: the old pass died with the identity
  authorizeDrive(s);
  const res2 = await readDrive(s);
  assert.equal(res2.outcome, 'declined');
  assert.equal(res2.reason, 'no_connector_pass');
});

test('connectors: one-time connector passes are consumed by the read', async () => {
  const s = setup({ adapters: { drive: fakeAdapter() } });
  authorizeDrive(s);
  s.m.owner.grantConnectorPass(s.ctx, {
    clientId: s.agentId, personaId: s.persona.id, connectorId: 'google_drive',
    scope: 'files.list', purpose: 'research',
    duration: 'one_time'
  });
  const first = await readDrive(s);
  assert.equal(first.outcome, 'results');
  const second = await readDrive(s);
  assert.equal(second.outcome, 'declined', 'one-time pass consumed by the first read');
});

test('connectors: credentials never appear in any read result', async () => {
  const s = setup({ adapters: { drive: fakeAdapter([{ id: 'file_1', name: 'x.md' }]) } });
  authorizeDrive(s);
  s.m.owner.grantConnectorPass(s.ctx, {
    clientId: s.agentId, personaId: s.persona.id, connectorId: 'google_drive',
    scope: 'files.list', purpose: 'research'
  });
  const res = await readDrive(s);
  const serialized = JSON.stringify(res);
  assert.ok(!serialized.includes('REAL_SECRET_DRIVE_TOKEN'), 'credential must never leak through a read');
});

// --- adapter fixtures --------------------------------------------------------------

test('adapter: drive normalizes list results (fixture fetch)', async () => {
  const fetchImpl = async () => new Response(JSON.stringify({
    files: [{ id: 'a1', name: 'a.md', mimeType: 'text/markdown', modifiedTime: '2026-10-16T10:00:00Z', size: '10' }]
  }), { status: 200, headers: { 'content-type': 'application/json' } });
  const res = await driveAdapter.listFiles({ accessToken: 't' }, {}, { fetch: fetchImpl });
  assert.equal(res.rows.length, 1);
  assert.equal(res.rows[0].name, 'a.md');
  assert.equal(res.rows[0].modifiedAt, '2026-10-16T10:00:00Z');
});

test('adapter: dropbox reads file content (fixture fetch)', async () => {
  const fetchImpl = async () => new Response('dropbox file body', { status: 200 });
  const res = await dropboxAdapter.readFile({ accessToken: 't' }, { fileId: 'id:xyz' }, { fetch: fetchImpl });
  assert.equal(res.content, 'dropbox file body');
});

test('adapter: mega is honestly not implemented (no phantom feature)', async () => {
  const res = await megaAdapter.listFiles({ sessionKey: 'k' });
  assert.equal(res.outcome, 'not_implemented');
});
