# underthehood - how moira actually works

the mechanics, in dependency order. the design reasoning behind them is in
`technobabble.md`; the component map is in `system-architecture.md`.

## 1. the synchronous core

the entire policy engine is pure, deterministic functions. no io, no
clocks, no randomness inside decisions - every decision is a replayable
function of its inputs. this is why the suite needs no mocks for core
logic and why "same inputs, same answers" is a test invariant, not a hope.

the store is where io exists, and the core refuses to be async for it.
the adapters (`supabasestore.js`, `insforgestore.js`) do real http on a
**worker thread** and hand results back through a SharedArrayBuffer +
`Atomics.wait/notify` handshake - the standard make-synchronous pattern.
the core never knows http exists.

## 2. keys: sealed, wrapped, shredded

- every persona gets a **random** key (never derived from anything), so
  deleting it is irreversible shredding, not a permission change.
- facts and connector credentials are sealed with aes-256-gcm envelope
  encryption under per-category **subkeys** derived from the persona key.
- persona keys themselves are wrapped under `MOIRA_INSTANCE_KEY` and stored
  in `moira_keywraps` - a fresh gateway over the same database unwraps
  them, so vaults survive restarts. shredding a persona deletes its wrap;
  the ciphertext is then unreadable by anyone, forever.
- ledger secrets use a separate key domain; agents never see keys at all -
  they hold capped leases (see 7).
- receipts are signed with canonical-json signatures (a stable byte
  encoding before hashing - no parser-dependent ambiguity).

## 3. facts and the taint algebra

a fact is three layers: record (content + reference), representation (how
it may be served), policy (what may be done with it). it carries a taint:
where it came from, how linkable it is, its basis (whether it is a real
preference or an inferred one), and a circumstance window (availability-
driven facts decay with their circumstance).

taint combines by **most restrictive wins** per dimension, and purposes
intersect. summaries are label-preserving: a summary of a high-linkability
fact is high-linkability. provenance cannot be laundered by rephrasing -
it can only be removed by an explicit owner act.

## 4. rungs: how much of a fact gets served

facts serve at rungs - `exists` (there is something), `outline`, `content`,
`conclusion`... the `exists` rung is mechanically derived from every fact;
higher rungs must be **authored** at write time. a read serves at the
highest rung the pass allows, capped by the fact's `max_rung`. nothing
invents a representation of you that you did not write.

## 5. passes and receipts

a pass is (client, persona, category, purpose, duration) - a grant, not a
key. reading with a pass leaves a signed, **content-free** receipt (actor,
persona, op, categories, fact count - never fact content). receipts are
append-only at the database level: an update trigger allows only signed
deletion stubs, deletes are always refused. one-time passes are consumed
by the read that uses them; passes revoke on next use.

## 6. bridges: two-sided consent

a bridge is a pairing between two personas (or two people) capped at a
rung. it requires a matching record AND explicit ingress on the receiving
side. reads through a bridge are mediated and rung-capped; nothing
auto-merges across a bridge; a privacy budget meters it. no bridge means
`not_available` - the absent bridge leaks nothing about what exists.

## 7. the ledger, the router, leases

resource accounts (with sealed secrets) track money and time. the router
decides eligibility and ranks urgency; leases are the only way an agent
touches an account - capped by (agent, persona, account, max_spend, ttl,
allowed_models). caps bind at four levels and the lowest wins; hard caps
refuse, soft caps escalate to the owner. overrun writes a receipt and
lowers the agent's auto-approval level; the kill switch freezes every
lease for a persona instantly.

## 8. the store and cas

writes go through `moira_cas_update`: an atomic compare-and-swap on a
`version` column, server-side, with an explicit table allowlist (security
invoker - no role tricks). the client retries on version conflict, so two
processes can share one database without lost updates. reads push `where`
equality hints down to the database (`persona_id`, `data->>`) but the
in-memory predicate stays authoritative - the pushdown is an optimization,
never the policy.

## 9. the connector hub

each persona authorizes its own identities per provider; credentials are
sealed like facts. a connector read needs an identity and then a
**connector pass** - a separate kind from memory passes, scoped
(client, persona, connector, scope, purpose). the hub opens credentials
only inside the adapter call, tags every returned row
`{ untrusted: true, source }`, writes a receipt, and consumes one-time
passes. revoking an identity kills its passes. provider text never becomes
a preference without owner confirmation.

the registry is block -> job -> provider. the **job is the consent unit**:
pass scopes attach to jobs ("retrieve your files"), so providers are
interchangeable fulfillment - swap dropbox for drive without re-consenting
anyone.

## 10. the two facades

- **agentapi**: the mcp tool surface. every call resolves a token to one
  persona fixed at grant time. it has no owner methods - structurally,
  not "checked". outcomes are explicit: `results`, `empty`,
  `approval_required`, `declined`, `expired`, `locked`, `unavailable` - a
  locked store is never reported as "no memories".
- **ownerapi**: every method takes an `OwnerContext`, a capability minted
  by the gateway (`createOwnerContext`). a forged `{ owner: true }` object
  is rejected; only the minted capability works, and the agent never holds
  one.

## 11. transport

mcp streamable http (2025-11-25) on one endpoint; oidc-style authorization
with pkce (s256, rfc 7636 test vectors pinned) and the rfc 8628 device
flow for devices without a browser. tokens are jose hs256 signed,
wrapping the core's opaque session ids - the token is presentation, the
session is the truth. discovery metadata per rfc 8414; introspection per
rfc 7662 semantics.
