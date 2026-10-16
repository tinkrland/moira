# repo.md - the repo map

one backend, zero dependencies, node 20+ (built and tested on node 24). this
file says where everything lives and how it fits together. the readme says
what moira is; technobabble/ says how it works.

## layout

```
moira/
|__ readme.md               the pitch and the core ideas (start here)
|__ repo.md                 this file - the map
|__ roadmap.md             what is shipped, what is next, what is deferred
|__ cli.js                  the owner surface as a terminal tool
|__ src/
|   |__ index.js            public exports
|   |__ core/
|   |   |__ gateway.js      the moira facade - wires services into the two apis
|   |   |__ policy.js       the pure policy engine (taint, rungs, decisions)
|   |   |__ personas.js     persona kinds, defaults, character sheets, kill switch
|   |   |__ facts.js        sealed facts, proposals, taint inheritance, decay
|   |   |__ keyservice.js   per-persona keys, subkeys, receipt signing, shredding
|   |   |__ receipts.js     append-only signed receipts
|   |   |__ agents.js        agent registry, persona-bound sessions
|   |   |__ passes.js        (client, persona, category, purpose, duration)
|   |   |__ bridges.js       two-sided persona bridges, rung-capped reads
|   |   |__ packs.js         signed expiring context packs
|   |   |__ handoffs.js      handoff lifecycle, typed returns
|   |   |__ ledger.js        resource accounts, metering, alerts, runway
|   |   |__ router.js        budget eligibility, urgency, leases, caps
|   |   |__ switching.js     request/approve/collect persona switching
|   |   |__ core.js          shared-core facts across personas
|   |   |__ errors.js        VaultKeyUnavailableError (fails closed)
|   |__ facades/
|   |   |__ agentapi.js      the agent surface (mcp tools) - no owner reach
|   |   |__ ownerapi.js      the owner surface - every method needs OwnerContext
|   |   |__ ownercontext.js  the minted owner capability
|   |__ connectors/
|   |   |__ registry.js      blocks -> jobs -> providers (the connector tree)
|   |   |__ adapters.js      provider adapters (drive/onedrive/dropbox; mega pending)
|   |   |__ hub.js           identities, connector passes, gated reads
|   |__ transport/
|   |   |__ server.js         the http server binding routes
|   |   |__ mcpserver.js      mcp streamable http (2025-11-25)
|   |   |__ mcp-tools.js      tool manifests
|   |   |__ tokens.js         jose-signed tokens (hs256) over opaque sessions
|   |   |__ authserver.js     oidc-style pkce s256 + device flow (rfc 8628)
|   |__ model/constants.js   enums and labels - nothing heuristic
|   |__ util/crypto.js       aes-256-gcm envelopes, canonical-json signing
|   |__ store.js             the narrow store interface + MemoryStore
|   |__ supabasestore.js    the postgrest-backed store (supabase adapter)
|   |__ insforgestore.js    insforge adapter (primary persistent backend)
|__ backend/
|   |__ base.sql              core tables, indexes, the cas rpc (the allowlist)
|   |__ security.sql          role hygiene, rls, append-only receipts triggers
|   |__ connectors.sql        connector identities + passes (own their grants)
|   |__ switchpersona.sql     persona switch requests (own their grants)
|   |__ migrations/           point-in-time migrations for pre-existing databases
|__ scripts/
|   |__ apply-insforge.mjs     applies schema.sql to an insforge project
|   |__ local-verify-stack.mjs local postgres + postgrest verify environment
|   |__ serve.mjs               runs the http server standalone
|__ docs/                    the story: about, explain, problemcase, solution, features, buildplan
|__ test/                    the suite - one file per domain + conformance + cli
|__ technobabble/            the deep docs (see below)
```

## the layers

the codebase has four clean layers, and the dependency direction only goes
downward:

```
cli.js / mcp server                    entry points (thin)
   |
facades (agentapi / ownerapi)          the two permission universes
   |
core services                          all the actual logic, pure + synchronous
   |
store (memory / insforge / supabase)   persistence, the only io boundary
```

- **the core is pure and synchronous.** every policy decision is a
  deterministic function of its inputs - replayable, testable without
  mocks. the core never does io.
- **io lives at the edges.** the store adapters do real http on a worker
  thread and hand results back synchronously; the transports speak mcp and
  oidc. neither leaks inward.
- **the two facades never touch each other.** an agent api instance has no
  owner methods on it at all - not "checks fail", structurally absent.

## the store contract

one narrow interface (`src/store.js`), three implementations:

| store | where | notes |
| --- | --- | --- |
| `MemoryStore` | in-process | the reference implementation; the suite defaults to it |
| `InsForgeStore` | insforge (primary) | postgrest-shaped records api; cas updates via rpc; restart-safe vaults |
| `SupabaseStore` | supabase (alternative) | same contract over supabase's rest/v1 |

`new Moira({})` auto-picks from env: `INSFORGE_URL`+`INSFORGE_ADMIN_KEY`
wins, then supabase env, else memory. the database is defined by
the four topic files under `backend/` (tables, generated persona columns,
the cas rpc, rls default-deny, append-only receipt triggers) - applied to
insforge via `node scripts/apply-insforge.mjs` in order: base, security,
connectors, switchpersona.

## the database, in one breath

22 `moira_` tables (one per store collection), `persona_id` generated columns
for pushdown, hot-path indexes, `moira_cas_update` (security invoker, table
allowlist) for lost-update-free writes, rls on everything with anon locked
out at the grant level, and triggers making receipts append-only - updates
blocked, deletes blocked, period.

## the tests

`npm test` runs everything offline: one file per domain, plus conformance
scenarios, the cli end-to-end, store parity (memory vs a mock postgrest),
and the mcp/auth contracts. the real-project batteries
(`test/real-insforge.test.js`, `test/real-supabase.test.js`) are gated
behind env vars - they only run against a live scratch project when
explicitly asked, and they are where "verified for real" claims come from.

## technobabble/

| file | what is in it |
| --- | --- |
| `underthehood.md` | the mechanics: sync core, key sealing, taint algebra, cas, receipts |
| `system-architecture.md` | components and data flow, request lifecycle |
| `techstack.md` | every technology choice and why |
| `journal.md` | the build log: phases, bugs, live verification runs |
| `technobabble.md` | the design ramble: the why behind the what |
| `inspiredby.md` | lineage and influences |

the evie taste engine is not in this repo's main branch - it lives on the
`evie` branch until it starts. the card kit ui lives on `card-kit`.
