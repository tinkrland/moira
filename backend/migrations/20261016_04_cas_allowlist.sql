-- cas allowlist fix - 2026-10-16.
--
-- for databases created before 2026-10-16 with the phase 0 schema applied.
-- fresh projects run the backend/ topic files directly (base.sql already
-- ships the corrected allowlist).
--
-- the bug: moira_cas_update's allowlist named only the core 19 tables.
-- connector_identities, connector_passes and persona_switches were added
-- as tables (migrations 02/03) but never to the allowlist, so any
-- store.update() on those rows - connector revocation, one-time pass
-- consumption, switch approval/collection - threw
-- "moira_cas_update: table not allowed" against a real database.
-- the mock postgrest cannot execute the rpc body, so parity tests could
-- not catch it. schema-safety.test.js now pins the invariant
-- (allowlist set == created-table set) so the lists can never drift again.
--
-- this migration replaces the function with the corrected version (same
-- definition as backend/base.sql).

create or replace function public.moira_cas_update(
  p_table text,
  p_id text,
  p_version integer,
  p_data jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_result jsonb;
begin
  if p_table not in (
    'personas', 'facts', 'agents', 'sessions', 'tokens', 'passes',
    'bridges', 'packs', 'handoffs', 'accounts', 'leases', 'receipts',
    'workspace', 'privacy_budgets', 'disclosures', 'connect_codes',
    'pending_connects', 'keywraps', 'linkage_declarations',
    'connector_identities', 'connector_passes', 'persona_switches'
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

-- manual verification steps the offline suite cannot run:
--   1. the allowlist in the live function source now names the three
--      tables:
--        select prosrc from pg_proc where proname = 'moira_cas_update';
--        (must contain 'connector_identities', 'connector_passes',
--         'persona_switches')
--   2. the function is still security invoker and execute is service-only:
--        select prosecdef from pg_proc where proname = 'moira_cas_update';
--        (false)
