// phase 1: verify against a real scratch supabase project.
//
// this file is INERT in the default offline suite: every test skips unless
//   MOIRA_REAL_SUPABASE=1
//   SUPABASE_URL=https://<project>.supabase.co
//   SUPABASE_SERVICE_ROLE_KEY=<service key>
// are set, and supabase/schema.sql has been applied in the sql editor.
//
// run: MOIRA_REAL_SUPABASE=1 node --test test/real-supabase.test.js
//
// what this verifies for real:
//   - the adapter's http contract against actual postgrest (pagination,
//     filters, prefer headers, the cas rpc)
//   - store parity: the shared scenario battery over memorystore vs the real
//     store produces identical outcomes
//   - restart parity: wrapped persona keys survive a fresh gateway
//   - receipts append-only triggers actually fire (updates and deletes raise)
//   - anonymous reads are denied (rls), when SUPABASE_ANON_KEY is provided
//
// what it cannot verify (report, never claim):
//   - the cas conflict-retry path needs an injected concurrent writer; it is
//     verified only against the mock. here the cas rpc runs its happy path.
//   - rls under a real owner jwt (phase 2 auth), and policies left commented
//     out in schema.sql.
//   - receipt rows cannot be deleted after the run (append-only trigger, by
//     design); the run leaves its receipts in the scratch project.

import test from 'node:test';
import assert from 'node:assert/strict';
import { Moira, MemoryStore, SupabaseStore } from '../src/index.js';
import { fullScenario, restartScenario, restartAssertions, pushdownScenario, ownerCtx } from './helpers/adapter-scenarios.mjs';

const ENABLED = process.env.MOIRA_REAL_SUPABASE === '1' && !!process.env.SUPABASE_URL && !!process.env.SUPABASE_SERVICE_ROLE_KEY;
const opts = ENABLED ? {} : {
  skip: 'phase 1 real-project run: needs MOIRA_REAL_SUPABASE=1, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and schema.sql applied'
};

// stable within this scratch project so reruns unwrap previously written wraps.
// scratch projects only: this key is not for any real deployment.
const INSTANCE_KEY = Buffer.from(process.env.MOIRA_TEST_INSTANCE_KEY || '22'.repeat(32), 'hex');

const EXPECTED_TABLES = [
  'moira_personas', 'moira_facts', 'moira_agents', 'moira_sessions', 'moira_tokens',
  'moira_passes', 'moira_bridges', 'moira_packs', 'moira_handoffs', 'moira_accounts',
  'moira_leases', 'moira_receipts', 'moira_workspace', 'moira_privacy_budgets',
  'moira_disclosures', 'moira_connect_codes', 'moira_pending_connects',
  'moira_keywraps', 'moira_linkage_declarations'
];

test('preflight: migration applied, tables and cas rpc exist', opts, async () => {
  const res = await fetch(`${process.env.SUPABASE_URL}/rest/v1/`, {
    headers: {
      apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
      authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`
    }
  });
  assert.ok(res.ok, `postgrest root unreachable: http ${res.status}`);
  const openapi = await res.json();
  const defs = Object.keys(openapi.definitions || {});
  for (const t of EXPECTED_TABLES) {
    assert.ok(defs.includes(t), `table ${t} missing: apply supabase/schema.sql in the sql editor first`);
  }
  const paths = Object.keys(openapi.paths || {});
  assert.ok(paths.includes('/rpc/moira_cas_update'), 'moira_cas_update rpc missing: schema.sql not fully applied');
});

test('store parity: shared scenarios over memorystore vs the real project', opts, async () => {
  const memM = new Moira({ instanceKey: INSTANCE_KEY });
  const memOut = fullScenario(memM, ownerCtx(memM));
  const store = new SupabaseStore({ url: process.env.SUPABASE_URL, key: process.env.SUPABASE_SERVICE_ROLE_KEY });
  try {
    const supM = new Moira({ store, instanceKey: INSTANCE_KEY });
    const supOut = fullScenario(supM, ownerCtx(supM));
    assert.deepEqual(supOut, memOut);
    assert.equal(memOut.read.outcome, 'results');
    assert.equal(memOut.bridge.rung, 'conclusion');
    assert.equal(memOut.delete, 'results');
  } finally {
    await store.close();
  }
});

test('restart parity: fresh gateway unwraps keys from the real database', opts, async () => {
  const store = new SupabaseStore({ url: process.env.SUPABASE_URL, key: process.env.SUPABASE_SERVICE_ROLE_KEY });
  try {
    const { personaId, agentId } = restartScenario(store, INSTANCE_KEY);
    const b = new Moira({ store, instanceKey: INSTANCE_KEY });
    restartAssertions(b, { personaId, agentId });
  } finally {
    await store.close();
  }
});

test('where pushdown: other personas rows never transfer from the real project', opts, async () => {
  const store = new SupabaseStore({ url: process.env.SUPABASE_URL, key: process.env.SUPABASE_SERVICE_ROLE_KEY });
  try {
    assert.deepEqual(pushdownScenario(store), ['f1', 'f3']);
  } finally {
    await store.close();
  }
});

test('receipts are append-only in the real database (triggers fire)', opts, async () => {
  const store = new SupabaseStore({ url: process.env.SUPABASE_URL, key: process.env.SUPABASE_SERVICE_ROLE_KEY });
  try {
    const m = new Moira({ store, instanceKey: INSTANCE_KEY });
    const p = m.owner.createPersona(ownerCtx(m), { name: 'triggercheck', identity: 'linked' });
    // mint a receipt through the real ledger (the trigger test only needs a
    // genuine, signed row to attack; facts.add alone mints no receipt - that
    // happens on the owner approveProposal path).
    m.receipts.write({ actor: 'owner', personaId: p.id, op: 'approve', categories: ['notes'], factCount: 1 });
    const receipts = m.receipts.query({ personaId: p.id });
    assert.ok(receipts.length >= 1, 'expected at least one receipt row');
    const id = receipts[0].id;

    // a direct update must raise (anything but the signed deletion-stub shape)
    const upd = await fetch(`${process.env.SUPABASE_URL}/rest/v1/moira_receipts?id=eq.${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: {
        apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
        authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
        'content-type': 'application/json',
        prefer: 'return=minimal'
      },
      body: JSON.stringify({ version: 999, owner_ref: 'tampered' })
    });
    assert.ok(!upd.ok, 'update on moira_receipts must be rejected by the trigger');
    const body = await upd.text();
    assert.match(body, /append-only|updates are not allowed|stub/i);

    // a direct delete must raise as well
    const del = await fetch(`${process.env.SUPABASE_URL}/rest/v1/moira_receipts?id=eq.${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers: {
        apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
        authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
        prefer: 'return=minimal'
      }
    });
    assert.ok(!del.ok, 'delete on moira_receipts must be rejected by the trigger');
  } finally {
    await store.close();
  }
});

test('anonymous reads are denied (rls), when an anon key is provided', opts, async (t) => {
  if (!process.env.SUPABASE_ANON_KEY) {
    t.skip('SUPABASE_ANON_KEY not provided; rls denial under anon not verified here');
    return;
  }
  const res = await fetch(`${process.env.SUPABASE_ANON_URL || process.env.SUPABASE_URL}/rest/v1/moira_facts?select=id`, {
    headers: {
      apikey: process.env.SUPABASE_ANON_KEY,
      authorization: `Bearer ${process.env.SUPABASE_ANON_KEY}`
    }
  });
  // either posture is a correct denial: permission denied (schema revokes
  // table access from anon; postgrest surfaces this as 401/403) or an empty
  // list (rls default-deny under a platform that re-grants select).
  // the invariant is that no rows leak.
  if (res.ok) {
    const rows = await res.json();
    assert.equal(Array.isArray(rows) ? rows.length : 0, 0, 'anon must see zero rows (rls default-deny)');
  } else {
    assert.ok(res.status === 401 || res.status === 403, `anon read returned http ${res.status}: expected an authorization-level denial`);
    const body = await res.text();
    assert.match(body, /permission denied|rls|row-level security|jwt|role/i, `anon denial reason unclear: ${body.slice(0, 200)}`);
  }
});
