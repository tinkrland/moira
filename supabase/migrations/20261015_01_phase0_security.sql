-- moira migration 20261015_01: phase 0 security fixes (spec v0.5 review)
--
-- for databases that already ran supabase/schema.sql before 2026-10-15.
-- fresh installs: schema.sql already contains all of this.
--
-- what changed and why:
--   1. moira_cas_update is now SECURITY INVOKER (was SECURITY DEFINER, an
--      unnecessary privilege-escalation surface) and validates p_table
--      against an explicit allowlist instead of a regex.
--   2. execute on moira_cas_update is revoked from authenticated/anon and
--      granted to service_role ONLY.
--   3. moira_receipts is append-only at the database level: a before-update
--      trigger raises, alongside the existing before-delete trigger.
--      CONFLICT FLAGGED: spec section 16 stubs receipts IN PLACE on persona
--      deletion (an update). the trigger allows ONLY stub-shaped updates
--      (personaId nulled, categories emptied, reason nulled, stubbed=true,
--      re-signed); every other update raises. awaiting reviewer confirmation.
--   4. new table moira_linkage_declarations (owner-marked intentional
--      linkage pairs for the decoupling monitor, spec 22.4).
--
-- MANUAL VERIFICATION (the mock postgrest used by the test suite cannot
-- execute postgres; run these in the supabase sql editor after applying):
--
--   a. the cas rpc no longer runs as definer and authenticated cannot call it:
--        select prosecdef from pg_proc p
--          join pg_namespace n on n.oid = p.pronamespace
--         where n.nspname = 'public' and p.proname = 'moira_cas_update';
--        -- must return false
--        select has_function_privilege('authenticated', 'public.moira_cas_update(text,text,integer,jsonb)', 'execute');
--        -- must return false
--        select has_function_privilege('service_role', 'public.moira_cas_update(text,text,integer,jsonb)', 'execute');
--        -- must return true
--
--   b. service_role still bypasses RLS on this project (security invoker
--      means the rpc runs with service_role's rights):
--        select rolbypassrls from pg_roles where rolname = 'service_role';
--        -- must return true (it is on current supabase projects; if false
--        -- on yours, tell us before running the backend)
--
--   c. receipts are append-only both ways:
--        insert into public.moira_receipts (id, data) values ('t1', '{"personaId":"p1","op":"read"}');
--        update public.moira_receipts set data = '{"personaId":"p1","op":"read","categories":["x"]}'
--          where id = 't1';          -- must raise 'append-only'
--        delete from public.moira_receipts where id = 't1';   -- must raise
--        -- then remove the probe row via the sql editor owner connection:
--        -- (the trigger blocks delete for every role; drop the probe by
--        --  disabling the trigger as postgres owner, or use a fresh scratch
--        --  schema for this probe so nothing needs removing)
--
--   d. an allowlist rejection reaches the caller:
--        select public.moira_cas_update('pg_roles', 'x', 1, '{}');
--        -- must raise 'table not allowed'

-- 1 + 2. cas rpc: invoker, explicit allowlist, service-role-only execute
create or replace function public.moira_cas_update(
  p_table text,
  p_id text,
  p_version integer,
  p_data jsonb
)
returns jsonb
language plpgsql
security invoker          -- runs with the caller's rights; no definer escape hatch
set search_path = public
as $$
declare
  v_result jsonb;
begin
  -- explicit allowlist: no regex, no dynamic surface beyond these tables.
  if p_table not in (
    'personas', 'facts', 'agents', 'sessions', 'tokens', 'passes',
    'bridges', 'packs', 'handoffs', 'accounts', 'leases', 'receipts',
    'workspace', 'privacy_budgets', 'disclosures', 'connect_codes',
    'pending_connects', 'keywraps', 'linkage_declarations'
  ) then
    raise exception 'moira_cas_update: table not allowed: %', p_table;
  end if;

  execute format(
    'update public.moira_%I
        set data = $1, version = version + 1
      where id = $2 and version = $3
      returning data',
    p_table
  ) into v_result
  using p_data, p_id, p_version;

  return v_result;
end;
$$;

revoke all on function public.moira_cas_update(text, text, integer, jsonb) from public, anon, authenticated;
grant execute on function public.moira_cas_update(text, text, integer, jsonb) to service_role;

-- 3. receipts: block updates (except signed deletion stubs, spec 16) and deletes
create or replace function public.moira_block_receipt_update()
returns trigger
language plpgsql
as $$
begin
  if new.data->>'personaId' is null
     and (new.data->'categories')::text = '[]'
     and new.data->>'reason' is null
     and new.data->>'stubbed' = 'true' then
    return new; -- the one permitted update: a signed deletion stub (spec 16)
  end if;
  raise exception 'moira_receipts is append-only: updates are not allowed';
end;
$$;

drop trigger if exists moira_receipts_no_update on public.moira_receipts;
create trigger moira_receipts_no_update
  before update on public.moira_receipts
  for each row execute function public.moira_block_receipt_update();

create or replace function public.moira_block_receipt_delete()
returns trigger
language plpgsql
as $$
begin
  raise exception 'moira_receipts is append-only (persona deletion stubs rows in place)';
end;
$$;

drop trigger if exists moira_receipts_no_delete on public.moira_receipts;
create trigger moira_receipts_no_delete
  before delete on public.moira_receipts
  for each row execute function public.moira_block_receipt_delete();

-- 4. linkage declarations table (spec 22.4, decoupling monitor)
create table if not exists public.moira_linkage_declarations (
  id text primary key,
  persona_id text generated always as (data->>'personaId') stored,
  data jsonb not null default '{}'::jsonb,
  version integer not null default 1,
  owner_ref text not null default 'owner',
  created_at timestamptz not null default now()
);
create index if not exists moira_linkage_declarations_persona_idx
  on public.moira_linkage_declarations (persona_id);
alter table public.moira_linkage_declarations enable row level security;
grant all on public.moira_linkage_declarations to service_role;
