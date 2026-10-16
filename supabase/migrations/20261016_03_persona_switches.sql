-- persona switching (spec section 17) - 2026-10-16.
--
-- for databases created before 2026-10-16 with the phase 0 schema applied.
-- fresh projects run supabase/schema.sql directly (it already includes this
-- table and its grants).
--
-- what this adds:
--   moira_persona_switches  agent requests to operate as another persona:
--     request -> owner approve/deny -> agent collects a new session bound to
--     the target persona. the old session is never mutated. rows carry no
--     plaintext persona_id beyond the from/to ids inside the sealed data
--     envelope; receipts hold the audit trail.
--
-- manual verification steps the offline suite cannot run:
--   1. table exists with the standard shape:
--        select table_name from information_schema.tables
--        where table_schema = 'public' and table_name = 'moira_persona_switches';
--   2. rls is on (same posture as every moira table):
--        select relname, relrowsecurity from pg_class
--        where relname = 'moira_persona_switches';
--        (relrowsecurity = t)
--   3. anon/authenticated have zero grants:
--        select grantee, privilege_type from information_schema.role_table_grants
--        where table_name = 'moira_persona_switches' and grantee in ('anon','authenticated');
--        (zero rows)
--   4. service_role has full access (the grant block below must return GRANT).

do $$
declare t text;
begin
  foreach t in array array['persona_switches']
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

grant all on table public.moira_persona_switches to service_role;
revoke all on table public.moira_persona_switches from public, anon, authenticated;
