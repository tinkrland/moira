# system-architecture - components and data flow

## the layer diagram

```
                    ┌──────────────────────────────┐
   entry points     │ cli.js        transport/     │
                    │ (owner)      mcp + oidc      │
                    └───────┬──────────┬──────────┘
                            │          │
                    ┌───────▼──────────▼──────────┐
   facades          │ ownerapi          agentapi  │
                    │ (needs OwnerCtx)  (tokens)  │   ← the two universes
                    └───────┬──────────┬──────────┘     never touch
                            │          │
                    ┌───────▼──────────▼──────────┐
   core             │ gateway.js  (the facade)     │
                    │ personas facts passes bridges │
                    │ packs handoffs ledger router  │
                    │ switching core keyservice     │
                    │ receipts policy  connectors/ │
                    │                                │   pure, synchronous,
                    │        no io, no clocks        │   deterministic
                    └───────────────┬──────────────┘
                                    │ store interface
                    ┌───────────────▼──────────────┐
   persistence      │ memorystore  insforgestore   │
                    │              supabasestore   │
                    │ worker thread ─► http ─►     │
                    │ postgres (postgrest-shaped) │
                    └──────────────────────────────┘
```

arrows only point downward. the facades do not import each other; the core
does not import the adapters; the adapters do not import each other.

## a memory read, end to end

```
agent calls moira_status with its token
  → transport resolves the token → session id (opaque, in the store)
  → agentapi resolves the session → (agent, persona) fixed at grant time
  → passes.find the active pass for (client, persona, category, purpose)
  → facts.serve: taint check → rung selection (pass cap ∧ fact max_rung)
  → serve representation to the agent
  → receipt written: actor, persona, op, categories, count (no content)
  → explicit outcome: results | empty | declined | expired | ...
```

if any step is unavailable the outcome says which - a locked store is
`locked`, not "no memories".

## a cas write, end to end

```
service calls store.update(coll, id, fn)
  → get row (data, version)
  → fn mutates a copy; null aborts
  → rpc moira_cas_update(p_table, p_id, p_version, p_data)
      server-side: allowlist check → version match → write, bump version
  → on version conflict (another writer won): retry (bounded)
  → on success: the new data comes back; the caller's update is never lost
```

## a connector read, end to end

```
agent calls connector_read(persona, connector, purpose)
  → hub: does this persona have an identity for the connector? else declined
  → hub: does it hold a live connector pass with the right scope+purpose?
        one-time passes are consumed here
  → adapter call with the credential, opened only inside the call
  → every returned row tagged { untrusted: true, source }
  → receipt written; credential material never appears in any result
```

## a persona switch

```
agent calls requestPersonaSwitch(target)
  → request sits in the owner inbox                     (nothing changes yet)
owner calls approveSwitch(id)
  → agent's allowed personas extended; a NEW session is minted
    bound to the target persona
agent collects one-time
  → the old session is untouched and keeps working on the old persona
```

no mutation of existing sessions, ever - switching is a new consent.

## the database shape

22 moira_ tables, one per store collection, plus:

- `persona_id` generated columns (`(data->>'personaId')`) so reads push
  persona scoping down to the database and the index catches it.
- `moira_cas_update`: the only write path for updates; security invoker,
  explicit table allowlist, execute revoked from authenticated/anon.
- rls enabled on every table, default-deny; anon has no grants at all.
- receipt triggers: update allows only the signed deletion-stub shape,
  delete always raises. append-only is enforced by the database, not the
  code's good behavior.

## deployment views

- **insforge (primary):** `node scripts/apply-insforge.mjs` applies
  schema.sql; the store speaks their postgrest-shaped records api
  (`/api/database/records`, `/api/database/rpc`). env: `INSFORGE_URL`,
  `INSFORGE_ADMIN_KEY`, `MOIRA_INSTANCE_KEY`.
- **supabase (alternative):** same schema via their sql editor; env:
  `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`.
- **local:** no env at all - a MemoryStore, everything in-process (dev and
  the test suite).

`new Moira({})` picks in that order: insforge env, supabase env, memory.

## the tool inventory

the facades expose every capability as named tools. **the agent tool surface** (what the mcp gateway exposes; every call resolves an
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

**the owner surface** (requires an owner-authenticated context the agent never
holds; a poisoned agent cannot approve itself):

`createPersona`, `registerAgent`, `createSession` (consent screen persona
choice), `grantPass` (tier-gated), `revokePass`, `createBridge`,
`allowIngress`, `approveProposal`, `rejectProposal`, `addAccount`,
`mintConnectCode` / `redeemConnectCode` / `approveConnect`, `killSwitch`,
`approveDisclosure`, `deletePersona`, `exportPersona`, `monitorScan`.

