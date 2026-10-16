# moira backend

moira is a **context sharing engine with persona switching**. you wear many
hats, and moira is built around exactly that: one place where your context
lives, personas that keep your hats separate, and controlled sharing of each
one with the people, apps and agents that need it.

what that means in practice:

- **persona switching.** student, founder, alter-ego, character: each persona
  has its own memory, its own keys, its own connectors, its own budget. moira
  never blends them unless you build an explicit bridge.
- **context sharing.** apps and agents get passes, not raw access: a pass is
  scoped to one persona, one category, one purpose, one duration, and every
  read leaves a signed receipt.
- **your context, everywhere.** a connector hub organized like ego.ist's
  blocks - files (google drive, onedrive, dropbox, mega), ai assistants
  (chatgpt, claude, ...), lifestyle, knowledge, utility - feeds each persona
  on its own terms. provider text is always tagged untrusted; moira's memory
  stays yours.

backend core implementing spec **v0.5 (october 15, 2026)**: mvp scope (section
18) plus the v1 resource-ledger/router core, with the policy engine as pure
deterministic functions and the gateway facade an mcp server can expose
directly.

zero dependencies. node 20+ (built and tested on node 24). `npm test` runs the
suite (61 tests: unit per domain + golden conformance scenarios).

```
npm test
```

## what is here

| module | spec | role |
| --- | --- | --- |
| `src/model/constants.js` | 4, 5, 7, 8, 9 | rungs, outcomes, basis labels, enums. policy decisions are made over these; nothing heuristic |
| `src/util/crypto.js` | 6, 12, 13, 22 | envelope encryption (aes-256-gcm), canonical-json signing, pairwise subs, device-keyed linkage hashes |
| `src/store.js` | — | narrow persistence interface (in-memory impl; postgres slots in behind it) |
| `src/core/keyservice.js` | 6, 16 | per-persona keys, per-category subkeys, sealed ledger secrets, receipt signing, **key shredding** |
| `src/core/receipts.js` | 16 | append-only, signed, content-free receipts. queryable per persona; stubs on persona delete |
| `src/core/policy.js` | 9 | **the pure policy engine**: taint algebra, rung selection, read/write decisions, router eligibility + urgency scoring. deterministic and replayable |
| `src/core/personas.js` | 5, 10, 13, 17 | persona kinds (linked / pseudonymous / heteronymous x hosted / local / decentral), kind defaults, character sheets, kill switch |
| `src/core/facts.js` | 4, 9.3, 10, 16 | sealed facts with the three-layer split (record / representation / policy), proposal inbox, taint inheritance, circumstance decay |
| `src/core/agents.js` | 7.1, 11 | agent registry (tiers, personas allowed, spend caps, standing rules), persona-bound sessions, rotating refresh with family revocation on replay |
| `src/core/passes.js` | 4, 9.1 | passes: (client, persona, category, purpose, duration). one-time consumption, revocation on next read |
| `src/core/bridges.js` | 4, 9.2, 9.5, 13 | two-sided bridges, rung-capped mediated reads, ingress/egress checks, privacy budget, no auto-merge |
| `src/core/packs.js` | 7.2 | signed, expiring context packs bound to one recipient; strict rung deals; handoff-authorized delivery |
| `src/core/handoffs.js` | 7.3, 8.5 | handoff lifecycle, owner approval vs standing rules, typed returns, overrun -> auto-approval decay |
| `src/core/ledger.js` | 8.1, 8.2, 8.6 | resource accounts with sealed secrets, metering, window-aware headroom, t-7/t-2/conversion alerts, runway view |
| `src/core/router.js` | 8.3, 8.4, 8.5, 9.4 | budget_route eligibility + urgency ranking, leases (agents never see keys), caps (lowest binding wins), kill switch |
| `src/core/gateway.js` | 6, 11, 7.4.1, 7.5, 8.7, 22.4 | the moira facade: mints owner capability (`createOwnerContext`), wires services into the two apis |
| `src/facades/agentapi.js` | 6 | **agent surface**: the 27 MCP tools. no owner method is reachable from here |
| `src/facades/ownerapi.js` | 6 | **owner surface**: every method takes an `OwnerContext` (a minted capability). a plain `{ owner: true }` is rejected |
| `src/core/errors.js` | 16 | `VaultKeyUnavailableError`: an unreadable key wrap fails closed, never crashes or re-keys |
| `src/supabasestore.js` | — | **supabase adapter**: postgrest-backed store. sync facade over a worker thread (the core stays deterministic/synchronous), atomic cas updates via rpc, range pagination, `where` pushdown |
| `supabase/schema.sql` | — | the database: moira_ tables, generated persona_id columns, hot-path indexes, the cas rpc (security invoker, explicit table allowlist, service-role-only execute), RLS default-deny, append-only receipts triggers |
| `supabase/migrations/` | — | point-in-time migrations for databases created before 2026-10-15, with the manual verification steps the mock cannot run |
| `src/index.js` | — | exports `Moira`, `AgentApi`, `OwnerApi`, `MemoryStore`, `SupabaseStore`, `constants`, `policy`, `VaultKeyUnavailableError` |

## the two surfaces

**agent tool surface** (what the mcp gateway exposes; every call resolves an
access token to one persona, fixed at grant time):

`moira_status`, `persona_context`, `remember`, `forget`, `bridge_request`,
`bridge_list`, `bridge_keep`, `bridge_revoke`, `workspace_read`,
`workspace_append`, `budget_status`, `budget_route`, `lease_request`,
`lease_revoke`, `ledger_propose`, `context_pack_create`, `context_pack_redeem`,
`handoff_create`, `handoff_accept`, `handoff_return`, `handoff_cancel`,
`voice_get`, `voice_check`, `voice_feedback`, `audit_receipts`,
`request_disclosure`.

every tool returns an **explicit outcome**: `results`, `empty`,
`approval_required`, `declined`, `expired`, `locked`, `unavailable`,
`not_available`. a locked or unavailable store is never reported as "no
memories"; unknown budget state is never "no limits".

**owner surface** (requires an owner-authenticated context the agent never
holds; a poisoned agent cannot approve itself):

`createPersona`, `registerAgent`, `createSession` (consent screen persona
choice), `grantPass` (tier-gated), `revokePass`, `createBridge`,
`allowIngress`, `approveProposal`, `rejectProposal`, `addAccount`,
`mintConnectCode` / `redeemConnectCode` / `approveConnect`, `killSwitch`,
`approveDisclosure`, `deletePersona`, `exportPersona`, `monitorScan`.

## decisions encoded (and where the tests pin them)

- **no pass = approval link, not an error, not data** (9.1). pinned in
  `agents-sessions.test.js`.
- **bridges are two-sided**: a matching bridge record AND explicit ingress.
  no bridge = `not_available`, never a hint that anything exists (9.2).
- **taint algebra**: most restrictive label per dimension; purposes intersect;
  summarization is label-preserving so summaries cannot launder provenance
  (9.3, open question 2 resolved). pinned in `facts.test.js`.
- **ledger events are circumstances, never taste** (8.9): preference proposals
  backed only by ledger events/key grants/lease use are refused
  (`preference_poisoning`); missing basis defaults to `inferred`;
  availability-driven facts decay with their circumstance; router choices
  write receipts with `reason: availability` and never preference facts.
- **linkability**: facts labeled `linkability: high` never flow into a
  pseudonymous persona; canon facts never leave a heteronym as true
  statements; heteronyms accept inspiration-template content only (13).
- **rungs**: served at the highest rung the pass allows, never above the fact's
  `max_rung`. the `exists` rung is mechanically derived (no inference) so every
  fact can serve at the lowest rung; higher rungs must be authored. open
  question 1 is answered conservatively.
- **keys never leave the broker** (8.4): secrets sealed under a separate ledger
  key domain; agents hold capped leases bound to (agent, persona, account,
  max_spend, ttl, allowed_models). model binding enforced (confused deputy).
- **caps at four levels, lowest binding wins** (8.5): persona, agent, handoff,
  task. hard caps refuse, soft caps return `approval_required`.
- **runaway spend**: overruns write a receipt and lower the agent's
  `autoApprovalLevel`; the kill switch freezes every lease for a persona.
- **delete persona = key shredding** (16): random per-persona keys (never
  derived, so shredding is irreversible), severed bridges/packs/leases,
  destroyed ledger secrets, content-free receipt stubs.
- **pairwise subs** per (persona, client); pseudonymous/heteronymous personas
  default to `link_visibility: device_only`.
- **decoupling monitor (v1 hook, 22.4)**: `monitorScan` is a pure owner-side
  function over keyed hashes. findings are advisory, never stored, never agent
  visible. "no finding does not mean safe."

## explicit non-goals carried over from the spec

- no enforcement of information flow inside a model's reasoning; enforcement
  is at the retrieval and tool boundary.
- no payments/booking actions (v2), no taste engine (v3), no sovereign
  on-device mediator (v2) — the gateway reports `unavailable` for decentral
  personas rather than guessing.
- no adjudication of provider terms; the ledger shows owner-confirmed dates
  and marks unconfirmed ones `estimated`.
- rung generation above `exists` (summaries, conclusions) is authored at write
  time in this build. read-time llm transforms are a v1+ decision; the
  `serveRung` fallback keeps it deterministic either way.

## supabase deployment (the default persistent backend)

1. run `supabase/schema.sql` once (sql editor or a migration). it creates the
   `moira_` tables (one per store collection, generated `persona_id` columns),
   indexes, the `moira_cas_update` rpc (security invoker, explicit table
   allowlist, execute revoked from authenticated/anon), RLS (default-deny;
   enable the commented owner policy for JWT access), and triggers that make
   receipts append-only at the database level (updates blocked except signed
   deletion stubs; deletes always blocked). existing databases: run
   `supabase/migrations/20261015_01_phase0_security.sql` instead, which carries
   the same protections plus the manual verification steps (the mock postgrest
   used by the test suite cannot execute postgres).
2. set the environment:

   ```
   SUPABASE_URL=https://<project>.supabase.co
   SUPABASE_SERVICE_ROLE_KEY=<service key>   # server-side only, never ships to a client
   MOIRA_INSTANCE_KEY=<openssl rand -hex 32> # stable across restarts
   ```

3. `new Moira({})` picks the supabase store automatically when the env is
   present; pass `{ store }` explicitly otherwise.

why this shape:

- **the core stays synchronous.** the whole policy engine is deterministic and
  replayable; making every service async for i/o would trade that away. the
  adapter does real http on a worker thread and hands results back through an
  atomics handshake (the standard make-synchronous pattern). one worker per
  store, sequential requests, per-request timeouts.
- **no lost updates.** `update()` is an atomic compare-and-swap against a
  `version` column, server-side in `moira_cas_update`, with a bounded client
  retry. two processes can share one database safely.
- **persona-scoped reads do not scan tables.** services pass equality hints
  (`where`) that the adapter translates into server-side filters
  (`persona_id` / `data->>`), then the in-memory predicate stays
  authoritative. results are range-paginated and ordered by insertion.
- **vaults survive restarts.** persona keys are random per persona, wrapped
  under `MOIRA_INSTANCE_KEY`, and stored in `moira_keywraps`; a fresh gateway
  over the same database unwraps them. shredding a persona deletes the wrap,
  so deletion stays irreversible. the ledger/payer domains are derived
  deterministically, so sealed account secrets and payer hashes also survive.
- the integration tests run the full core against a mock postgrest (spawned
  child process, `test/helpers/mock-server.mjs`) and assert **store parity**:
  identical scenarios over memorystore and supabasestore produce identical
  outcomes, plus cas-retry, append-collision, pushdown, restart and
  env-wiring behavior.

## production notes (honest gaps)

- `MemoryStore` remains the reference implementation (tests default to it);
  the supabase adapter is the persistent deployment path.
- persona keys are random and wrapped under the instance key here. in
  production they can be passkey-derived instead; the derive/shred interface
  is identical, and the tests assert shredding makes ciphertext unreadable.
- service role only, server-side only. the owner-JWT RLS policy ships
  commented out until the backend stamps `owner_ref` on writes.
- the mock postgrest in tests covers the adapter's contract surface
  (tables, filters, prefer headers, range pagination, the cas rpc). against a
  real project, run the suite with `SUPABASE_URL` +
  `SUPABASE_SERVICE_ROLE_KEY` pointed at a scratch schema if you want
  end-to-end confirmation; the core suite does not need network.
- access/refresh tokens are opaque ids in the store. production would use
  signed jose tokens with the same token-info resolution semantics.
- the mcp transport (streamable http, protocol 2025-11-25) and the oidc code
  flow (pkce s256, cimd client identity, rfc 8628 device flow) are outside this
  core: the gateway's tool dispatch is the surface they call into.
- billing-mail extraction and provider usage polling arrive as owner-confirmed
  proposals; `ledger_propose` + `approveProposal` is the whole loop.

## phase 0 (security and correctness hardening, 2026-10-15)

all six items from the spec v0.5 review, each driven by failing tests first.
suite: 107/107.

1. **taint algebra** (`src/core/policy.js`, `test/policy-taint.test.js`):
   `mergeTaint` now treats `null` allowed-purposes as "all purposes" and
   intersects across parents (one unrestricted parent can no longer launder
   another parent's restriction); disjoint sets yield `[]` (deny everything);
   `derivePolicy` can only narrow, never widen.
2. **decoupling monitor** (`src/facades/ownerapi.js`, `test/monitor.test.js`):
   findings are identity-based (spec 22.4): a shared identifier between a
   linked persona and a pseudonymous/heteronymous one is a hard finding,
   quasi-only matches are soft, `linked<->linked` sharing is intended,
   owner-declared intentional pairs are skipped. results are owner-only:
   never stored, never agent-visible.
3. **router + ledger safety** (`src/core/ledger.js`, `src/core/policy.js`,
   `src/core/router.js`, `test/router-safety.test.js`): expired accounts are
   ineligible (reason `expired`); headroom is per unit (a usd estimate is
   never measured against a requests cap); an account with no limits entered
   is **unknown, not unlimited** -> routing returns `approval_required /
   unknown_budget` unless the owner explicitly marked the account
   `unmetered`; `remainingValueOf` never silently defaults to 1.
4. **supabase schema** (`supabase/schema.sql`, the migration, static tests in
   `test/schema-safety.test.js`): cas rpc is security invoker with an explicit
   table allowlist (no regex); execute revoked from authenticated/anon and
   granted to service_role only; receipts block updates and deletes at the
   database level. **flagged conflict**: spec 16 stubs receipts in place on
   persona deletion (an update), so the update trigger permits exactly the
   signed stub shape (`personaId` nulled, `categories` empty, `reason`
   nulled, `stubbed` marker present) and raises on everything else - pending
   reviewer confirmation. new `moira_linkage_declarations` table backs the
   monitor's declared-intentional pairs.
5. **facade split** (`src/facades/`, `test/facades.test.js`): one gateway,
   two surfaces. every owner-gated method takes a minted `OwnerContext`;
   `createOwnerContext` is the only mint and requires a verified owner
   session; a plain `{ owner: true }` (or a spread copy of a context) is
   rejected everywhere. the `OwnerContext` class is not exported.
6. **key safety on startup** (`src/core/keyservice.js`, `src/core/errors.js`,
   `src/core/gateway.js`, `test/keysafety.test.js`): a persistent store
   without `MOIRA_INSTANCE_KEY` refuses to start; a stored key wrap that
   cannot be unwrapped (tampered, or a changed instance key) raises
   `VaultKeyUnavailableError` instead of crashing on `Buffer.from(null)`,
   and the backend never generates a replacement key over an existing wrap
   (no silent re-keying: every sealed record under the old key stays
   unreachable, which is the honest failure).

## phase 1: verify against a real supabase project

status update (2026-10-15): the battery below now runs green against a local
real-postgres stack (postgres 15 + postgrest v12, `scripts/local-verify-stack.mjs`
mirrors the supabase layout: /rest/v1 prefix, service_role + anon role pinning).
run it with:

   ```
   MOIRA_LOCAL_VERIFY=1 PGRST_BIN=<path to postgrest> node scripts/local-verify-stack.mjs
   ```

that run is real postgres and real postgrest (no mocks) but NOT a
supabase-hosted project; the hosted run below is still the remaining step.

findings fixed during the local run (each with a regression test first):

- `schema.sql` relied on supabase's platform default privileges for table
  access. on vanilla postgres the service role had none. schema.sql now
  carries explicit grant/revoke lines for all 19 tables (posture unchanged).
- the store's filter values were quote-wrapped (`eq."active"`). real postgrest
  takes `->>` text values literally, so quoted values silently matched nothing.
  values are now url-encoded and unquoted; the mock postgrest was hardened to
  real postgrest semantics (no quote stripping) so the offline suite catches
  any regression.

the offline suite proves parity against a mock postgrest. phase 1 runs the
same battery against a real scratch project:

1. create a scratch project at supabase.com (throwaway, nothing real in it).
2. in the sql editor, run `supabase/schema.sql` (fresh project) or
   `supabase/migrations/20261015_01_phase0_security.sql` (existing tables).
3. set the environment and run only the gated file:

   ```
   export SUPABASE_URL=https://<project>.supabase.co
   export SUPABASE_SERVICE_ROLE_KEY=<service key>
   export SUPABASE_ANON_KEY=<anon key, optional>          # rls denial check
   export MOIRA_REAL_SUPABASE=1
   node --test test/real-supabase.test.js
   ```

   without those variables every test in the file skips; the default suite
   never touches the network.

the scenarios live in `test/helpers/adapter-scenarios.mjs` so the real run
exercises exactly what the mock run exercises. verified for real: the http
contract against actual postgrest, store parity, restart parity (key wraps
unwrapped from the database), receipts append-only triggers firing on update
and delete, and anon reads denied when an anon key is given. stated gaps:
the cas conflict-retry path still needs a concurrent writer and is verified
only against the mock; rls under a real owner jwt waits for phase 2 auth;
receipt rows (and other rows created by the run) stay in the scratch project
afterwards, since the delete trigger is the point.

test infrastructure note: the mock postgrest harness moved to
`test/helpers/mock-harness.mjs` (shared, with a startup timeout so a crashed
mock can never hang the suite).

## phase 2: transport and auth

built (2026-10-16) in `src/transport/` - zero dependencies, node 24 built-ins
only (`node:http`, `node:crypto`). `scripts/serve.mjs` runs a local instance:

```
MOIRA_TOKEN_KEY=$(openssl rand -hex 32) node scripts/serve.mjs
```

- `tokens.js` - JOSE-signed JWTs (HS256) wrapping the core's opaque session
  tokens. the transport never invents its own identity: every jwt carries the
  core token id, and revocation/rotation stays in the core (session service).
  rfc 7636 appendix b is the known-answer test vector for pkce s256.
- `mcpserver.js` - MCP streamable http transport, protocol 2025-11-25.
  single `/mcp` endpoint, JSON responses (no server-initiated streams),
  `Mcp-Session-Id` lifecycle with 404 on unknown sessions, `DELETE /mcp`
  terminates a session, origin validation, `MCP-Protocol-Version` checking,
  JSON-RPC error codes per the spec. all 26 agentapi tools are exposed via the
  manifest in `mcp-tools.js`; tools/call requires a valid access jwt and maps
  error outcomes to mcp `isError: true` results.
- `authserver.js` - oauth 2.1-style authorization server for mcp clients:
  pkce s256 code flow (`/authorize`, `/token`), rfc 8628 device flow
  (`/device/code`, `grant_type=...device_code`), rfc 8414/9728 discovery
  metadata, rfc 7662-style introspection at `/tokeninfo`. refresh rotation,
  replay detection and family revocation are the core session service's,
  exercised end to end over http in the tests.
- `server.js` - composition: one http server mounting everything; hosts
  provide `getOwnerContext(req)` for the owner-consent step.

owner-session authentication (supabase auth vs passkeys) is deliberately
unbuilt: the review asked for a proposal first. `/authorize` answers 401
until the host wires `getOwnerContext`.

core contracts worth knowing: an access token lives out its short ttl even
after its refresh family is revoked (access tokens carry no family); the
device flow stores its records in `pendingConnects` with `kind: 'device_flow'`.

tests: 127 total, 121 pass offline, 0 fail, 6 gated on a real supabase
project (verified green against the local postgres + postgrest stack).

## phase 3 design: the connector hub (ego.ist-style blocks)

connectors are organized into blocks - a block is a category of context
sources, and each persona connects its own identities inside a block. the hub
itself is provider-agnostic; every provider is an adapter behind one
interface.

| block | providers (first wave) | what it feeds |
| --- | --- | --- |
| files | google drive, onedrive, dropbox, mega | documents and notes a persona wants remembered |
| ai tools | subdivided by how they work, because they hold different context: assistants (chatgpt, claude, gemini, perplexity - conversation and learned preferences) - app builders (lovable, base44, bolt, v0 - what you're building and how) - vibecoding (cursor, windsurf, claude code, copilot - your coding patterns) - spec-driven (kiro, ibm bob - bob.ibm.com, agentic dev partner - specs, tasks, guardrails before code) |
| taste | books: goodreads, storygraph, fable, pagebound, wattpad - film: letterboxd - tv: serializd, tvtime, repov - music: last.fm, stats.fm, musicboard, superfan - stories: ao3 (import), wattpad - shares: pi.fyi, tastify (rooms of favourite things, taste archived over time) | ratings, reviews, consumption history: deliberate acts of taste as v3 taste-graph signals |
| lifestyle | depop, ltk, pinterest, whering - retro (weekly photo journals, group albums) - anylog (custom life log: coffees, routines) | how a persona presents and lives: fashion, shopping discovery, photo memories, daily life signals - taste-adjacent, not consumption ratings |
| knowledge | notion, google calendar, slack - substack, medium | work products, schedules, references - and the reading/writing axis: essays and papers a persona reads and writes. deliberately NOT entertainment taste: this context shapes what you think, not what you consume |
| utility | youtube, maps, health | media consumption, places, bookings |

hub rules (per spec section 14, unchanged by the block model):

- per-persona identities: each persona authorizes its own accounts; a
  connector identity never crosses personas.
- credential isolation: provider tokens are sealed per persona with the same
  envelope encryption as facts; leases never expose raw credentials.
- connector passes are separate from memory passes: a connector read is
  (persona, connector, purpose, duration), not a memory pass.
- all provider text is tagged untrusted at ingress; nothing from a connector
  becomes a preference basis without owner confirmation.
- mega is the one non-oauth provider (login + session key), so its adapter
  keeps the same interface but its credential ceremony differs.
- the ai-tools block subdivides by how a tool works, not just who makes it:
  a chat assistant holds conversation and preferences; an app builder holds
  what you are building; a vibecoding agent holds your coding patterns; a
  spec-driven tool holds your requirements. different context shapes,
  different rungs - so they are separate sub-blocks with their own adapters.
- the taste block is the taste engine's fuel line, and its providers are
  deliberate acts of taste (a rating is a preference statement), not the
  shallow app pings ego.ist's lifestyle block collects. almost none of them
  have public apis: goodreads, storygraph, letterboxd and tv time live on
  csv exports; serializd and musicboard have no export at all; ao3 is an
  import. so the taste block's adapter kind is ingest - the owner brings an
  export or paste, moira tags every row untrusted with source attribution -
  rather than the oauth polling the files and ai-assistant blocks use.
  per spec section 18 the taste block registers with the hub in phase 3 but
  activates with the v3 taste engine - the fact schema already carries typed
  entity references and signal kinds, so v3 extends rather than rewrites.
