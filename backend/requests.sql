-- access requests (ego.ist-shaped consent loop, 2026-10-30): the app asks,
-- the owner decides. applied after base.sql + security.sql + 20261026_02.
--
-- one row per ask: persona, client, categories, purpose, duration, optional
-- sets, a note, and the decision. content-free by construction (categories
-- and metadata, never data). cas-updatable because approve/deny transition
-- status through store.update.

do $$
declare
  t text;
  tables text[] := array['access_requests'];
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

grant all on table public.moira_access_requests to service_role;
revoke all on table public.moira_access_requests from public, anon, authenticated;
