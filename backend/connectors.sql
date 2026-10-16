-- moira connectors (spec section 14) - applied after base.sql + security.sql.
--
-- the connector hub's own tables. a topic file owns its tables completely:
-- creation, grants, and rls live here, not in security.sql.
--
--   moira_connector_identities  one row per (persona, connector) link.
--     credentials are sealed envelopes (persona-key aes-256-gcm), never
--     plaintext. revocation kills the identity AND its connector passes.
--   moira_connector_passes      connector passes - a separate concept from
--     memory passes (moira_passes): (client, persona, connector, scope,
--     purpose, duration). agents never reach these rows directly; the
--     connector hub verifies them server-side.
--
-- both tables are cas-updatable (see the allowlist in base.sql): the hub
-- revokes identities and passes, and consumes one-time passes, through
-- store.update.

do $$
declare
  t text;
  tables text[] := array['connector_identities', 'connector_passes'];
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

grant all on table public.moira_connector_identities to service_role;
revoke all on table public.moira_connector_identities from public, anon, authenticated;
grant all on table public.moira_connector_passes to service_role;
revoke all on table public.moira_connector_passes from public, anon, authenticated;
