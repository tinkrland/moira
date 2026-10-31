-- people + per-persona relationships (the people phase, 2026-10-31).
-- applied after base.sql + security.sql + 20261026_02.
--
-- moira_people          : one row per human in the owner's address book
-- moira_persona_people  : one row per (persona, person) - the relationship.
--                         circles + importance + note live here, because
--                         importance is per persona and inherited by nobody.
-- both are cas-updatable (profiles are edited in place).

do $$
declare
  t text;
  tables text[] := array['people', 'persona_people'];
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

grant all on table public.moira_people to service_role;
grant all on table public.moira_persona_people to service_role;
revoke all on table public.moira_people from public, anon, authenticated;
revoke all on table public.moira_persona_people from public, anon, authenticated;
