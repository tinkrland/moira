// supabase adapter integration tests.
//
// runs the full moira core against a mock postgrest server (spawned as a
// child process so its event loop stays alive while the test thread blocks
// in the store's atomics handshake). pins the adapter's http contract and
// proves store parity: identical scenarios produce identical outcomes over
// memorystore and supabasestore.
//
// a real deployment replaces the mock with SUPABASE_URL +
// SUPABASE_SERVICE_ROLE_KEY after running the backend/ topic sql files.

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { Moira, MemoryStore, SupabaseStore } from '../src/index.js';
import { MockServer, withMock } from './helpers/mock-harness.mjs';
import { fullScenario, restartScenario, restartAssertions, pushdownScenario, ownerCtx } from './helpers/adapter-scenarios.mjs';

const INSTANCE_KEY = Buffer.from('11'.repeat(32), 'hex');


test('store parity: identical scenarios over memorystore and supabasestore', async () => {
  const memM = new Moira({ instanceKey: INSTANCE_KEY });
  const memOut = fullScenario(memM, ownerCtx(memM));
  const supOut = await withMock(async (mock, store) => {
    const supM = new Moira({ store, instanceKey: INSTANCE_KEY });
    return fullScenario(supM, ownerCtx(supM));
  });
  assert.deepEqual(supOut, memOut);
  assert.equal(memOut.read.outcome, 'results');
  assert.equal(memOut.bridge.rung, 'conclusion');
  assert.equal(memOut.delete, 'results');
});

test('restart parity: wrapped keys survive a new gateway over the same store', async () => {
  await withMock(async (mock, store) => {
    const { personaId, agentId } = restartScenario(store, INSTANCE_KEY);
    const b = new Moira({ store, instanceKey: INSTANCE_KEY });
    restartAssertions(b, { personaId, agentId });
  });
});

test('cas update retries on version conflict; append refuses duplicates', async () => {
  await withMock(async (mock, store) => {
    store.put('facts', 'f1', { id: 'f1', personaId: 'p1', status: 'proposed', n: 1 });
    // simulate a concurrent writer by bumping the row version out-of-band
    await mock.corruptVersion('moira_facts', 'f1');
    const updated = store.update('facts', 'f1', (r) => ({ ...r, n: 2 }));
    assert.equal(updated.n, 2);
    assert.equal(store.get('facts', 'f1').n, 2);

    store.append('receipts', { id: 'r1', op: 'read', ts: 1 });
    assert.throws(() => store.append('receipts', { id: 'r1', op: 'read', ts: 1 }), /collision/);
  });
});

test('where pushdown filters server-side: other personas rows never transfer', async () => {
  await withMock(async (mock, store) => {
    const ids = pushdownScenario(store);
    assert.deepEqual(ids, ['f1', 'f3']);
    // the pushdown actually hit the wire
    const log = await mock.filterLog();
    assert.ok(log.some((f) => f.includes('persona_id: eq: pa') || f.includes('persona_id:eq:pa') || f.includes('pa')));
  });
});

test('env wiring: store selection follows the environment', async () => {
  const saved = {
    url: process.env.SUPABASE_URL, key: process.env.SUPABASE_SERVICE_ROLE_KEY,
    inst: process.env.MOIRA_INSTANCE_KEY
  };
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  try {
    const m = new Moira({}); // no env, no explicit store -> memory store
    assert.equal(m.store.constructor.name, 'MemoryStore');
    process.env.SUPABASE_URL = 'http://127.0.0.1:1';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'k';
    // a persistent store without an instance key refuses to start (keysafety.test.js pins that);
    // here we just verify store selection with a key present.
    process.env.MOIRA_INSTANCE_KEY = Buffer.alloc(32, 1).toString('hex');
    const m2 = new Moira({}); // env present -> supabase store (no requests yet)
    assert.equal(m2.store.constructor.name, 'SupabaseStore');
    await m2.store.close();
  } finally {
    if (saved.inst) process.env.MOIRA_INSTANCE_KEY = saved.inst; else delete process.env.MOIRA_INSTANCE_KEY;
    if (saved.url) process.env.SUPABASE_URL = saved.url; else delete process.env.SUPABASE_URL;
    if (saved.key) process.env.SUPABASE_SERVICE_ROLE_KEY = saved.key; else delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  }
});
