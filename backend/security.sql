-- moira security posture (postgres 15+; applied after base.sql)
--
-- role hygiene, row level security, and the append-only receipts
-- enforcement for the CORE tables. the connector and switch tables ship
-- their own grants and rls inside their topic files.
--
-- the backend speaks to these tables through the service/admin role key
-- (server-side only). RLS is enabled on every table with a default-deny
-- posture: authenticated/anon keys get nothing unless the owner policy
-- matches (see the commented policy at the bottom).

-- execute: service role only. authenticated and anon must never reach this.
-- explicit role grants (phase 1 finding: supabase's platform default
-- privileges are not portable. a scratch project and a self-hosted postgrest
-- stack must both get service access from this file, never from the platform.
-- posture unchanged: anon and authenticated get nothing on tables; rls is the
-- second layer, not the first.

grant all on table public.moira_personas to service_role;
revoke all on table public.moira_personas from public, anon, authenticated;
grant all on table public.moira_facts to service_role;
revoke all on table public.moira_facts from public, anon, authenticated;
grant all on table public.moira_agents to service_role;
revoke all on table public.moira_agents from public, anon, authenticated;
grant all on table public.moira_sessions to service_role;
revoke all on table public.moira_sessions from public, anon, authenticated;
grant all on table public.moira_tokens to service_role;
revoke all on table public.moira_tokens from public, anon, authenticated;
grant all on table public.moira_passes to service_role;
revoke all on table public.moira_passes from public, anon, authenticated;
grant all on table public.moira_bridges to service_role;
revoke all on table public.moira_bridges from public, anon, authenticated;
grant all on table public.moira_packs to service_role;
revoke all on table public.moira_packs from public, anon, authenticated;
grant all on table public.moira_handoffs to service_role;
revoke all on table public.moira_handoffs from public, anon, authenticated;
grant all on table public.moira_accounts to service_role;
revoke all on table public.moira_accounts from public, anon, authenticated;
grant all on table public.moira_leases to service_role;
revoke all on table public.moira_leases from public, anon, authenticated;
grant all on table public.moira_receipts to service_role;
revoke all on table public.moira_receipts from public, anon, authenticated;
grant all on table public.moira_workspace to service_role;
revoke all on table public.moira_workspace from public, anon, authenticated;
grant all on table public.moira_privacy_budgets to service_role;
revoke all on table public.moira_privacy_budgets from public, anon, authenticated;
grant all on table public.moira_disclosures to service_role;
revoke all on table public.moira_disclosures from public, anon, authenticated;
grant all on table public.moira_connect_codes to service_role;
revoke all on table public.moira_connect_codes from public, anon, authenticated;
grant all on table public.moira_pending_connects to service_role;
revoke all on table public.moira_pending_connects from public, anon, authenticated;
grant all on table public.moira_keywraps to service_role;
revoke all on table public.moira_keywraps from public, anon, authenticated;
grant all on table public.moira_linkage_declarations to service_role;
revoke all on table public.moira_linkage_declarations from public, anon, authenticated;

revoke all on function public.moira_cas_update(text, text, integer, jsonb) from public, anon, authenticated;
grant execute on function public.moira_cas_update(text, text, integer, jsonb) to service_role;

-- row level security: enabled everywhere, default-deny. the service role
-- bypasses RLS; that key lives server-side only.
do $$
declare
  t text;
  tables text[] := array[
    'personas', 'facts', 'agents', 'sessions', 'tokens', 'passes',
    'bridges', 'packs', 'handoffs', 'accounts', 'leases', 'receipts',
    'workspace', 'privacy_budgets', 'disclosures', 'connect_codes',
    'pending_connects', 'keywraps', 'linkage_declarations'
  ];
begin
  foreach t in array tables loop
    execute format('alter table public.moira_%I enable row level security;', t);
  end loop;
end $$;

-- owner access policy for JWT-authenticated callers. enable by uncommenting
-- when the backend writes owner_ref as the owner's user id:
--
-- do $$
-- declare t text;
-- begin
--   foreach t in array array[
--     'personas','facts','agents','sessions','tokens','passes','bridges',
--     'packs','handoffs','accounts','leases','receipts','workspace',
--     'privacy_budgets','disclosures','connect_codes','pending_connects','keywraps'
--   ] loop
--     execute format($f$
--       create policy moira_owner_all on public.moira_%I
--         for all
--         using (owner_ref = (select auth.uid())::text)
--         with check (owner_ref = (select auth.uid())::text);
--     $f$, t);
--   end loop;
-- end $$;

-- receipts are the audit spine: append-only, enforced by the database.
--
-- CONFLICT FLAGGED (spec 16 vs phase 0 item 4): persona deletion stubs
-- receipts IN PLACE (an update: content dropped, op/ts/actor kept). a
-- blanket before-update raise would break delete_persona. the trigger below
-- raises on every update EXCEPT rows whose exact shape is a deletion stub
-- (personaId nulled, categories emptied, reason nulled). anything else
-- raises. pending reviewer confirmation of this exception.
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

-- no deletes ever, even for the service role. (stubbed rows stay forever.)
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
