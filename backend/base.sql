-- moira base schema (postgres 15+; applied first)
--
-- the schema lives in topic files under backend/, applied in order:
--   base.sql          core tables, indexes, the cas rpc (this file)
--   security.sql      role hygiene, rls, append-only receipts enforcement
--   connectors.sql    connector identities + passes (their own file)
--   switchpersona.sql persona switch requests (their own file)
--
-- table shape: id (primary key, minted by the backend), data (the record as
-- written by the backend), version (cas counter), created_at (insertion
-- order, also the listing order), owner_ref (tenancy anchor). persona_id is
-- a generated column extracted from data so persona-scoped queries hit a
-- real index without the backend maintaining a second source of truth.
--
-- topic files create their own tables AND carry their grants/rls, so a
-- topic never depends on a statement it does not ship.

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
  end loop;
end $$;

-- hot-path indexes (beyond persona_id)
create index if not exists moira_facts_status_idx on public.moira_facts (persona_id, (data->>'status'));
create index if not exists moira_receipts_ts_idx on public.moira_receipts (persona_id, ((data->>'ts')::bigint));
create index if not exists moira_receipts_op_idx on public.moira_receipts (persona_id, (data->>'op'));
create index if not exists moira_passes_client_idx on public.moira_passes (persona_id, (data->>'clientId'));
create index if not exists moira_tokens_session_idx on public.moira_tokens ((data->>'sessionId'));
create index if not exists moira_tokens_family_idx on public.moira_tokens ((data->>'family'));
create index if not exists moira_sessions_client_idx on public.moira_sessions ((data->>'clientId'));
create index if not exists moira_leases_status_idx on public.moira_leases (persona_id, (data->>'status'));
create index if not exists moira_bridges_src_idx on public.moira_bridges ((data->>'src'));
create index if not exists moira_bridges_dst_idx on public.moira_bridges ((data->>'dst'));
create index if not exists moira_handoffs_status_idx on public.moira_handoffs (persona_id, (data->>'status'));
create index if not exists moira_workspace_ts_idx on public.moira_workspace (persona_id, ((data->>'ts')::bigint));
create index if not exists moira_packs_status_idx on public.moira_packs (persona_id, (data->>'status'));
create index if not exists moira_accounts_provider_idx on public.moira_accounts (persona_id, (data->>'provider'));

-- atomic compare-and-swap update used by the store adapter: no
-- read-modify-write is ever lost silently across processes.
--
-- the allowlist is a safety property, not a burden: only tables the backend
-- actually updates through cas() may appear here. it is pinned by
-- schema-safety.test.js against the created-table arrays, after the
-- connector/switch tables were initially forgotten here (2026-10-16) and
-- hub.js revocations threw against real databases.
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
