-- moira persona vault (owner direction, 2026-10-26) - applied after base.sql +
-- security.sql + 20261016_04_cas_allowlist.sql.
--
-- the persona vault: collect (wetransfer), mymind, raindrop.io and
-- linkwarden (oss) combined, per persona. capture is frictionless and
-- unfiled; sets are the collections; snapshots preserve against link-rot.
--
--   moira_vault_items   one row per persona vault item. payloads (title,
--     url, note, tags, sets, source, optional snapshot) are sealed
--     envelopes (persona-key aes-256-gcm), never plaintext: the row body
--     is id, persona id, kind, timestamp, and the envelope. removal is a
--     shred - the sealed payload dies with the row.
--
-- cas-updatable: vaultTag re-seals through store.update so a concurrent
-- tag never silently drops the other side's union (tags and sets only
-- ever union). see the allowlist in base.sql.

do $$
declare
  t text;
  tables text[] := array['vault_items'];
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

grant all on table public.moira_vault_items to service_role;
revoke all on table public.moira_vault_items from public, anon, authenticated;
