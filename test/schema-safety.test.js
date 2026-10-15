// supabase schema safety (phase 0 item 4): these are static checks on the
// sql text. the mock postgrest cannot execute postgres, so real verification
// runs in phase 1 against a scratch project (steps documented in the
// migration file and the readme). the tests below pin the required
// protections so a future edit cannot silently drop one.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const schema = readFileSync(new URL('../supabase/schema.sql', import.meta.url), 'utf8');
const migration = readFileSync(new URL('../supabase/migrations/20261015_01_phase0_security.sql', import.meta.url), 'utf8');

const COLLECTIONS = [
  'personas', 'facts', 'agents', 'sessions', 'tokens', 'passes',
  'bridges', 'packs', 'handoffs', 'accounts', 'leases', 'receipts',
  'workspace', 'privacy_budgets', 'disclosures', 'connect_codes',
  'pending_connects', 'keywraps', 'linkage_declarations'
];

test('schema.sql: table grants to service_role are explicit, not platform defaults', () => {  // found by phase 1 local verification: on vanilla postgres (or any postgrest
  // outside supabase) the service role had no table access at all, because
  // schema.sql relied on supabase's default privileges. the grants must be in
  // the schema itself.
  assert.match(
    schema,
    /grant all on table public\.moira_personas to service_role/i,
    'schema.sql must grant moira_ tables to service_role explicitly'
  );
});

for (const [name, sql] of [['schema.sql', schema], ['migration', migration]]) {
  test(`${name}: moira_cas_update is security invoker, not definer`, () => {
    const start = sql.indexOf('create or replace function public.moira_cas_update');
    assert.ok(start >= 0, 'cas function definition required');
    const fn = sql.slice(start, sql.indexOf('as $$', start));
    assert.ok(/security invoker/i.test(fn), 'cas function must be security invoker');
    assert.ok(!/security definer/i.test(fn), 'cas function must not be security definer');
  });

  test(`${name}: cas table check is an explicit allowlist, not a regex`, () => {
    assert.ok(!sql.includes("!~"), 'regex table validation is forbidden');
    const start = sql.indexOf('create or replace function public.moira_cas_update');
    assert.ok(start >= 0, 'cas function definition required');
    const fn = sql.slice(start, sql.indexOf('revoke', start));
    for (const coll of COLLECTIONS) {
      assert.ok(fn.includes(`'${coll}'`), `allowlist must name ${coll}`);
    }
    assert.ok(/not in \(/.test(fn), 'the check must be an explicit not-in allowlist');
  });

  test(`${name}: execute is revoked from authenticated and granted to service_role only`, () => {
    const revoke = sql.match(/revoke[^\n]*moira_cas_update[^\n]*;/i);
    assert.ok(revoke, 'revoke statement required');
    assert.ok(/authenticated/.test(revoke[0]), 'revoke must name authenticated');
    assert.ok(/anon/.test(revoke[0]), 'revoke must name anon');
    const grant = sql.match(/grant execute[^\n]*moira_cas_update[^\n]*;/i);
    assert.ok(grant, 'grant statement required');
    assert.ok(/service_role/.test(grant[0]), 'grant must name service_role');
    assert.ok(!/authenticated/.test(grant[0]), 'grant must NOT include authenticated');
  });

  test(`${name}: receipts block updates (append-only) with the delete trigger still present`, () => {
    assert.ok(/before update on public\.moira_receipts/.test(sql), 'before-update trigger required');
    assert.ok(/before delete on public\.moira_receipts/.test(sql), 'delete trigger must remain');
  });

  test(`${name}: the receipts update trigger allows ONLY deletion stubs (spec 16 conflict, flagged)`, () => {
    const fn = sql.slice(sql.indexOf('moira_block_receipt_update'), sql.indexOf('$$;', sql.indexOf('moira_block_receipt_update')));
    assert.ok(/raise/.test(fn), 'the trigger must raise');
    // spec section 16: persona deletion stubs receipts in place. the trigger
    // may only allow exactly stub-shaped rows (personaId nulled, no
    // categories, no reason); every other update raises.
    assert.ok(/personaId/.test(fn) && /categories/.test(fn) && /reason/.test(fn) && /stubbed/.test(fn), 'stub exception must be narrowly shape-checked');
  });
}

test('schema.sql creates a table for every collection the backend stores, including linkage_declarations', () => {
  const createBlock = schema.slice(0, schema.indexOf('-- hot-path indexes'));
  for (const coll of COLLECTIONS) {
    assert.ok(createBlock.includes(`'${coll}'`), `schema must create moira_${coll}`);
  }
  // RLS is enabled for every table too
  const rlsBlock = schema.slice(schema.indexOf('row level security'));
  for (const coll of COLLECTIONS) {
    assert.ok(rlsBlock.includes(`'${coll}'`), `RLS must be enabled for moira_${coll}`);
  }
});

test('migration documents manual verification steps (mock postgrest cannot run sql)', () => {
  assert.ok(/verificat/i.test(migration), 'migration must document verification steps');
  assert.ok(/pg_roles|bypassrls/i.test(migration), 'must include the service_role bypassrls check');
});
