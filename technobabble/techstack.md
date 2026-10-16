# techstack - every choice and why

## the stack, in one line

**node 24, zero runtime dependencies, one postgres database behind a
postgrest-shaped api, one worker thread, hand-rolled jose.**

## node 20+ (built on 24), zero dependencies

the whole backend imports nothing from npm. not because dependency-free is
a virtue in itself, but because:

- every security-relevant primitive here (aes-256-gcm, canonical-json
  signing, jwt/jws, pkce s256) is small enough to implement directly, and
  small enough to **audit in one sitting**. a supply-chain attacker has no
  surface.
- the node standard library is genuinely enough in 2026: crypto,
  WebCrypto-grade primitives, worker_threads, test runner, fetch.
- upgrades are boring: node's own stability is the only external thing to
  track.

the trade-off is honest: hand-rolled crypto code must be correct. that is
why the suite pins it with test vectors from the rfcs (pkce s256 from rfc
7636) and why canonical json has its own conformance tests.

## postgres + a postgrest-shaped api (insforge primary, supabase alternative)

the store needs exactly three things from persistence: rows with jsonb
payloads, atomic compare-and-swap, and queryable filters. a
postgrest-shaped records api provides all three over plain http with no
client library - which is why **one store implementation** (`supabasestore.js`)
covers both hosts and the insforge adapter is a thin subclass (path
mapping + one response-shape difference), verified against both.

- **cas in the database**, not the app: `moira_cas_update` is a
  security-invoker function with an explicit table allowlist. two
  processes can share one database and never lose an update.
- **rls default-deny + grant hygiene**: the runtime role owns the tables
  (owners bypass rls); anon has no grants; policies are in the schema for
  a future jwt-access path.
- **generated `persona_id` columns**: persona-scoped reads filter and
  index server-side; pushdown is an optimization, the in-memory predicate
  stays the policy.

## persona memory persistence: mem0 (open source, behind the scenes)

each persona's long-lived memory (beyond the sealed fact vault) is persisted
through **mem0, the open-source memory layer** (mem0ai/mem0), one isolated
memory space per persona. it sits behind the scenes: the store interface and
the deterministic core never depend on it directly, persona isolation is
preserved by scoping every mem0 call to the persona's own memory (its user
id / namespace), and moira's taint rules still govern what is allowed into
a memory at all. chosen because memory extraction, consolidation and
recall are a solved problem worth adopting rather than rebuilding, while
the trust model (untrusted ingress, confirmed preferences, per-persona
boundaries) stays ours.

## the worker-thread store

node is single-threaded; the core is synchronous. rather than make every
core function async (trading determinism and simplicity for io), the
adapters post the http request to a worker thread over a
SharedArrayBuffer and block on `Atomics.wait` for the response. this is
the standard make-synchronous pattern (same idea libs like sync-rpc use,
hand-rolled, ~80 lines). one worker per store, sequential requests,
per-request timeouts; the core never sees a promise.

## hand-rolled jose (hs256 tokens)

jwt/jws per rfc 7519 implemented directly in `transport/tokens.js`:
hs256 over a canonical header.payload.signature, base64url without
padding ambiguity. tokens wrap the core's **opaque** session ids - the
signature is presentation and expiry; the session row in the store is the
truth. revocation is deleting a session, not praying a token expires.
introspection is a store lookup, not a crypto claim.

## mcp streamable http (2025-11-25)

the agent surface is an mcp server because the consumers of moira's
context are agents, and mcp is the wire they already speak. one endpoint,
json-rpc over http with server-sent notifications, tool manifests in
`mcp-tools.js`. no sdk - the protocol subset moira needs is small and
pinned by `transport-mcp.test.js`.

## oidc-shaped auth, pkce + rfc 8628 device flow

not a full oidc provider - an oidc-*shaped* authorization server: code
flow with pkce (s256, rfc 7636 vectors pinned) for browser clients, rfc
8628 device flow for devices without keyboards, discovery metadata per
rfc 8414. deliberately shaped-not-full: the spec's auth story ends at
"token → session", and inventing an identity provider is out of scope.

## aes-256-gcm envelopes

facts, credentials, and account secrets are sealed, not encrypted at rest
by the platform: authenticated encryption under per-persona keys, with
the per-category subkey derivation keeping blast radius small. gcm (not
just cbc) because tampering must fail, not decrypt to garbage.

## the test runner

`node --test`, no jest/vitest: the suite is 165 tests, each file per
domain, plus golden conformance scenarios and a full cli end-to-end.
gated real-project batteries (`real-insforge.test.js`,
`real-supabase.test.js`) hold the live-verification runs so "verified"
always names the battery that proved it.

## what is deliberately NOT in the stack

- no web framework (the transport routes by hand; the surface is small).
- no orm (jsonb rows via a narrow store interface; the schema is one
  reviewed sql file).
- no background job system (leases and decays are computed from
  timestamps deterministically, not swept by cron).
- no rate limiter, no metrics, no container in the box - hosting concerns
  belong to the host, and pretending otherwise would be phantom features.
