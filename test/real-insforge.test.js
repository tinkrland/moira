// phase 1 verify, insforge target: the same battery as real-supabase.test.js,
// run against an insforge project with scripts/apply-insforge.mjs applied.
//
// INERT in the default offline suite: every test skips unless
//   MOIRA_REAL_INSFORGE=1
//   INSFORGE_URL=https://<project>.insforge.app
//   INSFORGE_ADMIN_KEY=<ik_... key>
// are set.
//
// run: MOIRA_REAL_INSFORGE=1 node --test test/real-insforge.test.js
// optional: INSFORGE_ANON_KEY=<anon key> enables the anon-denial check.
//
// what this verifies for real (same honest scope as the supabase run):
//   - the insforgestore http contract against insforge's live postgrest-shaped
//     records api (pagination, json-path filters, prefer headers, the cas rpc)
//   - store parity: shared scenario battery, memorystore vs the real project
//   - restart parity: wrapped persona keys survive a fresh gateway
//   - receipts append-only triggers actually fire (updates and deletes raise)
//   - anonymous reads are denied (grant/rls posture), when an anon key is set
//
// what it cannot verify (report, never claim):
//   - the cas conflict-retry path needs an injected concurrent writer; it is
//     verified only against the mock. here the cas rpc runs its happy path.
//     (insforge's rpc returns 200 + json null on a miss; _casMiss handles it,
//     but no real concurrent writer is spawned in this run.)
//   - receipt rows cannot be deleted after the run (append-only by design);
//     the run leaves its receipts in the scratch project.

import test from 'node:test';
import assert from 'node:assert/strict';
import { Moira, MemoryStore, InsForgeStore } from '../src/index.js';
import { fullScenario, restartScenario, restartAssertions, pushdownScenario, ownerCtx } from './helpers/adapter-scenarios.mjs';

const ENABLED = process.env.MOIRA_REAL_INSFORGE === '1' && !!process.env.INSFORGE_URL && !!process.env.INSFORGE_ADMIN_KEY;
const opts = ENABLED ? {} : {
  skip: 'phase 1 insforge run: needs MOIRA_REAL_INSFORGE=1, INSFORGE_URL, INSFORGE_ADMIN_KEY and scripts/apply-insforge.mjs applied'
};

const BASE = () => process.env.INSFORGE_URL.replace(/\/$/, '');
const ADMIN = () => process.env.INSFORGE_ADMIN_KEY;

// stable within this scratch project so reruns unwrap previously written wraps.
// scratch projects only: this key is not for any real deployment.
const INSTANCE_KEY = Buffer.from(process.env.MOIRA_TEST_INSTANCE_KEY || '22'.repeat(32), 'hex');

// insforge has no postgrest openapi root; preflight over its rawsql endpoint.
async function rawsql(query) {
  const res = await fetch(`${BASE()}/api/database/advance/rawsql`, {
    method: 'POST',
    headers: { authorization: `Bearer ${ADMIN()}`, 'content-type': 'application/json' },
    body: JSON.stringify({ query })
  });
  assert.ok(res.ok, `rawsql preflight unreachable: http ${res.status}`);
  return res.json();
}

test('preflight: migration applied, tables and cas rpc exist', opts, async () => {
  const t = await rawsql(`select table_name from information_schema.tables
    where table_schema = 'public' and table_name like 'moira_%' order by 1`);
  const names = t.rows.map((r) => r.table_name);
  const expected = [
    'moira_personas', 'moira_facts', 'moira_agents', 'moira_sessions', 'moira_tokens',
    'moira_passes', 'moira_bridges', 'moira_packs', 'moira_handoffs', 'moira_accounts',
    'moira_leases', 'moira_receipts', 'moira_workspace', 'moira_privacy_budgets',
    'moira_disclosures', 'moira_connect_codes', 'moira_pending_connects',
    'moira_keywraps', 'moira_linkage_declarations', 'moira_connector_identities',
    'moira_connector_passes', 'moira_persona_switches'
  ];
  for (const table of expected) {
    assert.ok(names.includes(table), `table ${table} missing: run node scripts/apply-insforge.mjs first`);
  }
  const rpc = await rawsql(`select prosecdef from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'moira_cas_update'`);
  assert.equal(rpc.rows.length, 1, 'moira_cas_update rpc missing');
  assert.equal(rpc.rows[0].prosecdef, false, 'cas rpc must be security invoker');
});

test('store parity: shared scenarios over memorystore vs the real project', opts, async () => {
  const memM = new Moira({ instanceKey: INSTANCE_KEY });
  const memOut = fullScenario(memM, ownerCtx(memM));
  const store = new InsForgeStore({});
  try {
    const insM = new Moira({ store, instanceKey: INSTANCE_KEY });
    const insOut = fullScenario(insM, ownerCtx(insM));
    assert.deepEqual(insOut, memOut);
    assert.equal(memOut.read.outcome, 'results');
    assert.equal(memOut.bridge.rung, 'conclusion');
    assert.equal(memOut.delete, 'results');
  } finally {
    await store.close();
  }
});

test('restart parity: fresh gateway unwraps keys from the real database', opts, async () => {
  const store = new InsForgeStore({});
  try {
    const { personaId, agentId } = restartScenario(store, INSTANCE_KEY);
    const b = new Moira({ store, instanceKey: INSTANCE_KEY });
    restartAssertions(b, { personaId, agentId });
  } finally {
    await store.close();
  }
});

test('where pushdown: other personas rows never transfer from the real project', opts, async () => {
  const store = new InsForgeStore({});
  try {
    assert.deepEqual(pushdownScenario(store), ['f1', 'f3']);
  } finally {
    await store.close();
  }
});

test('receipts are append-only in the real database (triggers fire)', opts, async () => {
  const store = new InsForgeStore({});
  try {
    const m = new Moira({ store, instanceKey: INSTANCE_KEY });
    const p = m.owner.createPersona(ownerCtx(m), { name: 'triggercheck-insforge', identity: 'linked' });
    m.receipts.write({ actor: 'owner', personaId: p.id, op: 'approve', categories: ['notes'], factCount: 1 });
    const receipts = m.receipts.query({ personaId: p.id });
    assert.ok(receipts.length >= 1, 'expected at least one receipt row');
    const id = receipts[0].id;

    const upd = await fetch(`${BASE()}/api/database/records/moira_receipts?id=eq.${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: {
        authorization: `Bearer ${ADMIN()}`,
        'content-type': 'application/json',
        prefer: 'return=minimal'
      },
      body: JSON.stringify({ version: 999, owner_ref: 'tampered' })
    });
    assert.ok(!upd.ok, 'update on moira_receipts must be rejected by the trigger');
    const updBody = await upd.text();
    assert.match(updBody, /append-only|updates are not allowed|stub/i);

    const del = await fetch(`${BASE()}/api/database/records/moira_receipts?id=eq.${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers: {
        authorization: `Bearer ${ADMIN()}`,
        prefer: 'return=minimal'
      }
    });
    assert.ok(!del.ok, 'delete on moira_receipts must be rejected by the trigger');
  } finally {
    await store.close();
  }
});

test('anonymous reads are denied, when an anon key is provided', opts, async (t) => {
  if (!process.env.INSFORGE_ANON_KEY) {
    t.skip('INSFORGE_ANON_KEY not provided; anon denial not verified here');
    return;
  }
  const res = await fetch(`${BASE()}/api/database/records/moira_facts?select=id`, {
    headers: { authorization: `Bearer ${process.env.INSFORGE_ANON_KEY}` }
  });
  // either posture is a correct denial: a grant-level refusal (pg 42501
  // permission denied, verified live on insforge) or an empty list. the
  // invariant is that no rows leak.
  if (res.ok) {
    const rows = await res.json();
    assert.equal(Array.isArray(rows) ? rows.length : 0, 0, 'anon must see zero rows');
  } else {
    const body = await res.text();
    assert.ok(/permission denied|rls|row-level security/i.test(body), `anon denial reason unclear: ${body.slice(0, 200)}`);
  }
});
