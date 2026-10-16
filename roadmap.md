# moira roadmap

the build order and where things are going. status is honest: what exists,
what is planned, what is deliberately deferred.

## phase status (as of october 16, 2026)

- [x] **phase 0 - core**: policy engine, personas, facts, passes, bridges,
  packs, handoffs, ledger, router, receipts, key shredding. 107 tests.
- [x] **phase 1 - persistence**: supabase adapter (cas rpc, rls, triggers),
  verified against a local real-postgres/postgrest stack. two real adapter
  bugs found and fixed with regression tests (explicit role grants; filter
  quoting). 2026-10-16: backend target moved to insforge - `insforgestore.js`
  (subclass), `scripts/apply-insforge.mjs` (role/tag transport adaptations),
  and the full phase 1 battery run live against the insforge project:
  6/6 (parity, restart, pushdown, append-only triggers, anon denial, cli
  e2e). cas conflict-retry remains mock-verified only; the live run exercised
  the rpc happy path.
- [x] **phase 2 - transport and auth**: mcp streamable http (2025-11-25),
  jose-signed tokens, pkce s256, rfc 8628 device flow, discovery metadata.
- [ ] **phase 2.5 - owner session auth**: proposal made (passkeys + recovery
  code, recommended, vs supabase auth). awaiting the call. /authorize stays
  401 until it lands.
- [x] **shared core + promotion/demotion (section 5/17)**: core entity with
  reserved id, inheritance-by-reference reads for linked personas, canon
  containment, audited promote/demote, and cli.js making the whole owner
  surface scriptable (FileStore local state). shipped 2026-10-16.
- [x] **persona switching (section 17)**: request/approve/collect with full
  session isolation, per-client default personas, the wrong-persona escape
  hatch (re-seal + taint review + provenance), canon containment. shipped
  2026-10-16. shared-core promotion deliberately deferred (no core entity yet).
- [~] **phase 3 - connector hub**: the block model in the readme. **phase 3a
  shipped (2026-10-16, commit d99bca8)**: hub, files block (drive/dropbox/
  onedrive fixture-verified; mega honestly not built; live runs need oauth
  app credentials), connector passes, sealed identities, untrusted tagging -
  143-test suite green. still ahead: ingest skeleton (taste/lifestyle),
  onedrive/drive/dropbox live verification, mega client. build
  order suggested: hub + files block (connected), taste ingest skeleton;
  ai-tools sub-blocks next; lifestyle/knowledge/utility after.
- [ ] **phase 4 - v2 commerce + actions** (payments, bookings): after the
  connector hub.

## evie

the taste engine is **evie** - and it is deliberately decoupled. the policy
engine is pure, deterministic, replayable; access decisions are math, not
vibes. evie is the opposite kind of component: inferential, evolving,
opinionated about what you like. it plugs into moira (it reads facts and
signal kinds, it never writes without owner confirmation) but it is never
part of the deterministic core and never gates an access decision.

evie lives on its own branch (`evie`) until it starts. per spec section 18:
no taste connectors before v3 - the taste block registers with the hub in
phase 3, activates with evie.

## later, deliberately not built yet

- **persona-wise people connections** (cresca.ai-style): relationships
  tracked per persona - the people your founder hat knows are not the
  people your student hat studies with, and they never get confused. friend
  follows, shared rooms, group context (the social side the tracker apps
  like repov and pi.fyi already prove people want). moira's personas and
  passes are the natural substrate: a person connection is just a
  persona-scoped, consented bridge between two humans. **this is for after
  the connector hub** - the primitives (bridges, passes, receipts) are
  ready; the product surface is not built.
- sovereign tier (decentralized identity), device mesh, marketplace of
  personas. all out of scope until the core phases land.
