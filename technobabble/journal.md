# journal - the build log

dated, honest, and never rewritten to look tidier than it was. "verified"
here always means a test or a live run, never "should work".

## 2026-10-15 - phase 0: the core

policy engine, personas, facts, passes, bridges, packs, handoffs, ledger,
router, receipts, key shredding. 107 tests. the foundation decisions:

- **no pass = approval link, not an error, not data** (9.1).
- **bridges are two-sided**: a matching bridge record AND explicit ingress.
  no bridge = `not_available`, never a hint that anything exists (9.2).
- **taint algebra**: most restrictive label per dimension; purposes
  intersect; summarization is label-preserving so summaries cannot launder
  provenance (9.3).
- **ledger events are circumstances, never taste** (8.9): preference
  proposals backed only by ledger events are refused
  (`preference_poisoning`); availability-driven facts decay with their
  circumstance; router choices write receipts with `reason: availability`
  and never preference facts.
- **rungs**: served at the highest rung the pass allows, never above the
  fact's `max_rung`. the `exists` rung is mechanically derived (no
  inference); higher rungs must be authored.
- **keys never leave the broker** (8.4): secrets sealed under a separate
  ledger key domain; agents hold capped leases bound to (agent, persona,
  account, max_spend, ttl, allowed_models).
- **caps at four levels, lowest binding wins** (8.5): persona, agent,
  handoff, task. hard caps refuse, soft caps return `approval_required`.
- **delete persona = key shredding** (16): random per-persona keys (never
  derived, so shredding is irreversible), severed bridges/packs/leases,
  destroyed ledger secrets, content-free receipt stubs.
- **pairwise subs** per (persona, client); pseudonymous/heteronymous
  personas default to `link_visibility: device_only`.
- **decoupling monitor** (22.4): `monitorScan` is a pure owner-side
  function over keyed hashes. findings are advisory, never stored, never
  agent visible. "no finding does not mean safe."

explicit non-goals carried from the spec: no enforcement of information flow
inside a model's reasoning (enforcement is at the retrieval and tool
boundary); no payments/booking (v2), no taste engine (v3 - later evie), no
on-device mediator (v2); no adjudication of provider terms; rung generation
above `exists` is authored at write time in this build.

## 2026-10-15 - phase 0.5: security hardening

append-only receipts (update trigger allows only signed deletion stubs;
delete always blocked), rls default-deny policies, role hygiene
(authenticated/anon revoked), pairwise sub collision fix. pinned in
`schema-safety.test.js` and `keysafety.test.js`.

## 2026-10-15 - phase 1: persistence (supabase adapter)

the postgrest-backed store: a synchronous facade over a worker thread (the
core stays deterministic), atomic cas updates via the `moira_cas_update`
rpc, range pagination, `where` pushdown so persona-scoped reads never
transfer whole tables. since hosted credentials were not yet available,
the verification ran against a local stack: real postgres 15 + postgrest in
the sandbox (`scripts/local-verify-stack.mjs`).

**two real adapter bugs found by that stack, each with a failing test
written first:**

1. platform default grants: locally, `postgres`-owned tables were readable
   by anon unless grants were explicit. the schema moved from dynamic sql
   blocks to explicit GRANT/REVOKE statements - and the real-stack run
   proved the fix, not just the mock.
2. filter quoting: the adapter quoted `data->>x=eq.value` filter values,
   which postgrest treats as a literal string match against a jsonb path -
   zero rows, silently. fixed and pinned with a mock-server test whose
   records now match real postgrest semantics.

store parity became a suite-level invariant: identical scenarios over
memorystore and the adapter store must produce identical outcomes.

## 2026-10-15 - phase 2: transport and auth

mcp streamable http (protocol 2025-11-25), oidc-style pkce (s256 with test
vectors from rfc 7636), rfc 8628 device flow, discovery metadata (rfc
8414), token introspection. jose-signed hs256 tokens wrap the core's
opaque session ids; refresh reads claims from the token now. the auth
endpoints live in `src/transport/authserver.js`, mcp in `mcpserver.js`.

## 2026-10-16 - phase 3a: the connector hub

`src/connectors/`: registry (blocks), adapters (drive/onedrive/dropbox rest
over injectable fetch), hub (per-persona identities with credentials sealed
by the persona key; connector passes as a separate pass kind; gated reads
tagging rows `{ untrusted: true, source }`; receipts on every read;
revocation kills passes; one-time passes consumed). schema:
`moira_connector_identities` + `moira_connector_passes`.

**honest scope:** the three rest adapters are fixture-tested; a live
provider run waits on oauth app credentials. **mega is not implemented** -
its protocol is encrypted rpc, not rest, and that client is its own work
item (it returns a documented `not_implemented`).

## 2026-10-16 - persona switching + shared core + cli

switching is a new consent, never a mutation: request -> approve -> collect
mints a NEW session bound to the target persona; the old session is never
touched. `reassignFact` moves facts between personas through the full
policy engine (unseal -> taint/provenance review -> re-seal under the
target key). canon facts are protected. promotion to a shared core shipped
as `src/core/core.js` with promote/demote and cli commands.

## 2026-10-16 - the insforge migration

backend persistence moved to insforge (postgrest-shaped records api over
hosted postgres). the migration hit real transport friction, all of it
solved in `scripts/apply-insforge.mjs` (transport-level adaptations, same
proven schema):

- their rawsql endpoint splits on bare semicolons, so the script splits
  statements itself, dollar-quote-aware.
- their sql validator rejects semicolons/parens inside `$$` dollar-quoted
  bodies - the schema's `$f$` format-string bodies are rewritten to
  escaped single-quoted strings (the schema source keeps `$f$`; only the
  transported text changes).
- role management is forbidden - `service_role` becomes `project_admin`,
  which is the runtime role and table owner. owners bypass rls, so the
  semantics match supabase's service_role. anon is revoked from everything.
- fresh installs need only `supabase/schema.sql` - the migrations exist for
  pre-2026-10-15 databases.

**live verification (2026-10-16, `moira_real_insforge=1 node --test
test/real-insforge.test.js`): 6/6.** preflight (22 tables, cas rpc security
invoker, rls on all tables, triggers present), store parity vs memorystore,
restart parity (vaults unwrap in a fresh gateway), pushdown (other personas'
rows never transfer), receipts append-only under direct http attack, anon
denied at the grant level (pg 42501). plus a cli end-to-end over the live
project (personas list/create, fact add). honest gap: the cas
conflict-retry path needs an injected concurrent writer - it is
mock-verified; the live run exercised the rpc's happy path (insforge
returns 200 + json `null` on a miss, which `_casMiss` handles).

a cli regression found during the migration, fixed failing-test-first: the
cli ignored the insforge env and silently used the local file store; now it
errors loudly against the configured url instead of answering from nowhere.

## 2026-10-16 - the registry becomes job-node shaped

the connector registry restructured from flat blocks to
block -> job -> provider. jobs are the consent unit (pass scopes come from
the job, not the provider); providers are swappable under a job without
re-consenting anyone. knowledge now holds four jobs (retrieve your files,
manage projects, plan your time, write & publish); slack left the tree
(deliberate - comms is not a knowledge job in this model; it can return
under a future job if wanted).

## 2026-10-16 - the schema becomes topic files (and a real bug surfaced)

the sql moved from `supabase/schema.sql` to `backend/` as topic files -
base.sql (core tables, indexes, cas rpc), security.sql (role hygiene, rls,
append-only receipts), connectors.sql and switchpersona.sql (each owning
its tables completely: creation + grants + rls). migrations live under
`backend/migrations/` for databases created before the split. apply order
is now explicit: base, security, connectors, switchpersona.

splitting the schema forced the allowlist question, and it caught a real
bug: `moira_cas_update`'s table allowlist named only the core 19 tables -
connector_identities, connector_passes and persona_switches were missing,
so connector revocation, one-time pass consumption, and switch
approval/collection would throw "table not allowed" against any real
database. the mock postgrest cannot execute the rpc body, so the parity
tests could not see it. fixed (allowlist == created tables), pinned with a
new schema-safety invariant so the two lists can never drift again, and a
migration (20261016_04) carries the fix to pre-existing databases.

also: .gitignore untracked from the repo (patterns kept locally in
.git/info/exclude), and the docs/ folder added: about, explain,
problemcase, solution, features, buildplan - the story for humans,
separate from technobabble/ (the story for builders).

## 2026-10-16 - the tree grows: reading, tech, academia, people, multi-account

registry expanded per owner direction. the reading axis renamed publish ->
reading ('read & write'): a substack or medium account can be pure
consumption - subscriptions and reading history are the axis's main
signal; writers ride the same job. new blocks, all registered planned (no
phantom features): tech & dev (developer: github, gitlab, bitbucket;
design: figma, kittl, canva, penpot, balsamiq) with an onboarding opt-in
flag - onboarding asks whether the block is needed at all, because a
developer persona wants it and an artistry persona may not; academia
(research: zotero, mendeley, semantic scholar connected; arxiv ingest;
google scholar via the export/webhook fallback for providers with no
public api - rows arrive ingest-style, untrusted-tagged); and people
(meetings: calendly, cal.com, z cal, granola, zoom, google meet; social
media; networking) - block-level planned, activating with the people
phase. provider lists are examples, not the universe; the tree grows by
addition.

the hub went multi-account: identities are keyed per (persona, connector,
account) - one persona can hold work drive + personal drive on the same
provider. re-authorizing an account replaces only that account; reads
target an account explicitly or default to the first-authorized
(deterministic: stable sort on createdAt, insertion order breaks
same-millisecond ties - the first attempt used random ids as tiebreak
and the tests caught the nondeterminism). connector passes can pin to
one account. failing tests first; suite 172 tests, 160 pass, 12 gated.

