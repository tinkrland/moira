-- moira persona switching (spec section 17) - applied after base.sql + security.sql.
--
-- the switching layer's own table. a topic file owns its tables completely:
-- creation, grants, and rls live here.
--
--   moira_persona_switches  agent requests to operate as another persona:
--     request -> owner approve -> agent collects (one-time). approval mints
--     a NEW session bound to the target persona; existing sessions are
--     never mutated. the row's status moves pending -> approved -> collected
--     (and denied/cancelled), all through store.update - so this table is
--     cas-updatable (see the allowlist in base.sql).

do $$
declare
  t text;
  tables text[] := array['persona_switches'];
begin
  foreach t in array tables loop
    execute format($f$
      create table if not exists public.moira_%I (
        id text primary key,
        persona_id text generated always as (data->>'personaId') stored,
        data jsonb not null default '{}'::jsonb,
        version integer not null default 1,
        owner_ref text not null default 'owner',
        created_at timestamptz not null default now()
      );
    $f$, t);
    execute format($f$
      create index if not exists moira_%I_persona_idx on public.moira_%I (persona_id);
    $f$, t, t);
    execute format('alter table public.moira_%I enable row level security;', t);
  end loop;
end $$;

grant all on table public.moira_persona_switches to service_role;
revoke all on table public.moira_persona_switches from public, anon, authenticated;
