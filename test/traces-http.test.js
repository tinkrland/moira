// the chain existed and nobody could read it (2026-11-13).
//
// traces.js shipped: a sequence stamped onto every receipt, an open trace
// attached per request, and owner methods to begin, end, list and read back.
// there was no route, no panel view and no export, so "one unit of delegated
// work, stitched in order" was a promise the surface could not keep.

import test from 'node:test';
import assert from 'node:assert/strict';
import { Moira } from '../src/index.js';
import { MemoryStore } from '../src/store.js';
import { createOwnerSessionVerifier } from '../src/transport/ownersession.js';
import { createMoiraServer } from '../src/transport/server.js';

const SECRET = 'a-long-enough-owner-secret-57';

async function boot() {
  const m = new Moira({ store: new MemoryStore() });
  const a = m.createOwnerContext({ kind: 'owner_session', verified: true, ownerRef: 'owner-a' });
  const p = m.owner.createPersona(a, { name: 'alex-work', identity: 'pseudonymous' });
  const fact = m.facts.add(p, { content: 'ships on fridays', category: 'preferences', rungs: { summary: 'ships fridays' } }).fact;
  const agent = m.owner.registerAgent(a, { name: 'writer', tier: 'verified', personasAllowed: [p.id], spendCaps: { usd: 1 } });
  const verify = createOwnerSessionVerifier({ moira: m, secret: SECRET });
  const server = createMoiraServer({ moira: m, baseUrl: 'http://127.0.0.1:8081', tokenKey: 'ab'.repeat(32), getOwnerContext: verify, port: 0 });
  const bound = await server.listen();
  return { m, a, p, fact, agent, server, base: `http://127.0.0.1:${bound.port}`, H: { 'content-type': 'application/json', 'x-moira-owner': SECRET } };
}

const post = (base, H, path, body) => fetch(base + path, { method: 'POST', headers: H, body: JSON.stringify(body ?? {}) });
const get = (base, H, path) => fetch(base + path, { headers: H });

test('traces: the routes exist and are owner-gated', async (t) => {
  const { base, server } = await boot();
  t.after(() => new Promise((r) => server.server.close(r)));
  const anon = { 'content-type': 'application/json' };
  for (const path of ['/api/traces', '/api/traces/trc_nope', '/api/traces/export']) {
    const res = await get(base, anon, path);
    assert.equal(res.status, 401, `${path} refuses an anonymous caller`);
  }
  const begun = await post(base, anon, '/api/traces', { label: 'x' });
  assert.equal(begun.status, 401);
});

test('traces: a unit of work reads back in order, refusals included', async (t) => {
  const { base, server, m, p, H } = await boot();
  t.after(() => new Promise((r) => server.server.close(r)));

  const begun = await post(base, H, '/api/traces', { label: 'draft the migration', personaId: p.id });
  assert.equal(begun.status, 200);
  const { traceId } = await begun.json();
  assert.ok(traceId);

  // one granted act and one refused act, both under the same trace: a refused
  // read belongs in the story as much as a granted one. the scope is explicit -
  // a host opens it, does the work, clears it - so the test opens it the same way.
  m.useTrace(traceId);
  m.receipts.write({ actor: 'owner', personaId: p.id, op: 'read', categories: ['preferences'] });
  m.receipts.write({ actor: 'agent_x', personaId: p.id, op: 'read', reason: 'approval_required' });
  m.clearTrace();

  const chain = await get(base, H, `/api/traces/${traceId}`);
  assert.equal(chain.status, 200);
  const body = await chain.json();
  assert.equal(body.outcome, 'results');
  assert.equal(body.traceId, traceId);
  assert.ok(body.receipts.length >= 2, 'the chain carries every entry');
  const seqs = body.receipts.map((r) => r.seq);
  assert.deepEqual([...seqs].sort((x, y) => x - y), seqs, 'ordered by sequence, never by clock');
  assert.ok(body.receipts.some((r) => r.reason === 'approval_required'), 'the refusal is in it');

  const ended = await post(base, H, `/api/traces/${traceId}/end`, { outcome: 'completed' });
  assert.equal(ended.status, 200);

  const listed = await get(base, H, '/api/traces?status=completed');
  const listBody = await listed.json();
  assert.ok(listBody.traces.some((x) => x.id === traceId && x.status === 'completed'));
});

test('traces: export is one file, and a missing trace is a 404 not an empty story', async (t) => {
  const { base, server, H, m, p } = await boot();
  t.after(() => new Promise((r) => server.server.close(r)));

  const { traceId } = await (await post(base, H, '/api/traces', { label: 'day one', personaId: p.id })).json();
  m.useTrace(traceId);
  m.receipts.write({ actor: 'owner', personaId: p.id, op: 'read', categories: ['preferences'] });
  m.clearTrace();

  const file = await get(base, H, `/api/traces/export?traceId=${traceId}`);
  assert.equal(file.status, 200);
  assert.match(file.headers.get('content-disposition') ?? '', /attachment; filename="trace-/);
  const body = await file.json();
  assert.equal(body.outcome, 'results');
  assert.equal(body.traceId, traceId);
  assert.ok(body.receipts.length >= 1, 'an export of nothing is not an export');

  const missing = await get(base, H, '/api/traces/export?traceId=trc_nope');
  assert.equal(missing.status, 404);
  const missingChain = await get(base, H, '/api/traces/trc_nope');
  assert.equal(missingChain.status, 404);
});

test('traces: the panel can read a chain and download it', async () => {
  const { readFileSync } = await import('node:fs');
  const js = readFileSync(new URL('../ui/app.js', import.meta.url), 'utf8');
  assert.match(js, /\/api\/traces/, 'the panel asks for the list');
  assert.match(js, /traces\/export/, 'and can take one away as a file');
  assert.match(js, /x-moira-owner/, 'with the owner header, since a download cannot carry it');
});
