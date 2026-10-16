-- connectors (spec section 14, phase 3) - 2026-10-16.
--
-- for databases created before 2026-10-16 with the phase 0 schema applied.
-- fresh projects run supabase/schema.sql directly (it already includes
-- these tables and grants).
--
-- what this adds:
--   moira_connector_identities  one row per (persona, connector) link.
--     credentials are sealed envelopes (persona-key aes-256-gcm), never
--     plaintext. revocation kills the identity AND its connector passes.
--   moira_connector_passes      connector passes - a separate concept from
--     memory passes (moira_passes): (client, persona, connector, scope,
--     purpose, duration). agents never reach these rows directly; the
--     connector hub verifies them server-side.
--
-- manual verification steps the offline suite cannot run:
--   1. both tables exist with the standard shape:
--        select table_name from information_schema.tables
--        where table_schema = 'public' and table_name like 'moira_connector%';
--   2. rls is on and default-deny (same posture as every moira table):
--        select relname, relrowsecurity, relforcerowsecurity
--        from pg_class where relname like 'moira_connector%';
--        (relrowsecurity = t)
--   3. anon/authenticated have zero grants:
--        select grantee, privilege_type from information_schema.role_table_grants
--        where table_name = 'moira_connector_identities' and grantee in ('anon','authenticated');
--        (zero rows)
--   4. service_role has full access on both tables (the grant block below
--      must have returned GRANT for each statement).

do $$
declare t text;
begin
  foreach t in array array['connector_identities', 'connector_passes']
  loop
    execute format($f$
      create table if not exists public.moira_%I (
        id text primary key,
        data jsonb not null,
        version integer not null default 0,
        created_at timestamptz not null default now(),
        owner_ref text,
        persona_id text generated always as (data->>'personaId') stored
      ) $f$);
    execute format('alter table public.moira_%I enable row level security', t);
  end loop;
end $$;

grant all on table public.moira_connector_identities to service_role;
revoke all on table public.moira_connector_identities from public, anon, authenticated;
grant all on table public.moira_connector_passes to service_role;
revoke all on table public.moira_connector_passes from public, anon, authenticated;
