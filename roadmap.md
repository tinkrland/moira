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
- [x] **persona isolation hooks (2026-10-17)**: moment-of-risk linkage
  warnings (22.4 v1: shared payer across decoupled personas, declared vs
  time-boxed acknowledgement, expiry reactivates), linkage-aware routing
  (owner-view flags only, agent surface clean), and stack context
  declarations (anti-hallucination: per-persona tool + uses, pass-gated
  structured agent read).
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

## branch topology: three decoupled lines

main, evie, and viola are mutually decoupled: main never imports either
engine, evie never imports viola, and no branch merges into another
without the owner's call. main knows the other two only as pointers
below. if either engine starts, it merges in the way the owner directs,
not by drift.

## the sandbox problem, audited (2026-10-31)

`docs/sandbox-problem.md` maps moira onto both halves (isolation declarative and
fail-closed; permeability as gates; coordination deliberately thin). it names
two open gaps as work rather than prose:

- **the action log is not a chain.** receipts answer "who saw what" but not "who
  did what, on whose behalf, in what order, with what outcome". next: a
  correlation id on every crossing receipt, plus an owner-side trace export that
  stitches one unit of delegated work in order. timestamp ordering is not
  accountability.
- **crossing atomicity.** writes are CAS-atomic per record; a crossing that
  touches two personas is two atomic writes. safe today because crossings are
  read-through or one-shot (disclosure delivers once, packs are strict-rung
  handoffs). a multi-step crossing would need the transactional boundary named
  in the source doc.

## inference check (2026-10-31)

shipped: owner.leakageAudit + GET /api/leakage + a surface line per connected
agent. deterministic containment scoring, three finding kinds (rung_gap,
slice_gap, cross_persona), content-free findings with stated caveats. a
detector, not a fix - narrowing the pass stays the owner's call.

## people / human context (2026-10-31)

shipped: owner + agent surfaces for per-persona human context - one address
book, relationships as (person, persona), soft overlapping circles,
importance 1-5 per persona with no inheritance, notes at full rung, a
people pass sliced by its circles. next in this phase: connector-fed
meetings/social capture, and accept/decline around connect codes for
persona-to-persona bridges between two owners.

## ego.ist build (2026-10-30)

step 1: access requests (agent asks with categories/purpose/duration/note,
owner approves, narrows or denies; edits only tighten; approval mints the
pass; ask + decision receipted). step 2: the inbox face in /app with live
count and per-ask narrowing controls; seed-demo carries one pending ask.
step 4: directed disclosure (request -> owner decision -> exactly one
server-to-server delivery to the exact https destination -> content-free
status + signed attestation; no deliver, no delivery). step 3: field-level addressing (`preferences.writing_style`) across facts,
passes, requests and approvals - addresses can only narrow. next: directed
disclosure (one-shot delivery to an exact destination with a content-free
status back).

## card detail + creation (2026-10-30)

cards open into an honest inventory (facts by category, vault, stack, ai,
sets, who can read), owner-gated via /api/persona; "+ persona" creates
from the surface with validation. note for demo runs: seed and serve must
share MOIRA_INSTANCE_KEY or vaults refuse to unwrap (by design).

## card kit compiled (2026-10-29)

ui/ is now the card kit compiled to vanilla css/js (kit geometry, type,
tilt, spotlight, noise, flip easing, accent chips) - no react, no build
step. demo card: `node scripts/seed-demo.mjs` -> "moira airidian" /
moira@dearagent.shop. personas carry a first-class email. next: sections
open into detail (facts by category, vault, voice), persona creation and
set editing from the surface.

## surface, first build (2026-10-29)

ui/ lives: flippable persona cards served at /app by the transport, owner
-gated /api/overview + /api/pass, zero dependencies, full-hat lending
gated behind an explicit acknowledgement. the react card kit stays parked
on the card-kit branch as the design reference. next: open a card into
the real detail panels (facts by category, vault captures, voice/quirk
summary), then persona creation and set editing from the surface.

## pass guardrails (2026-10-29)

no indefinite access (standing passes cap at 90 days and renew by hand),
no implicit full access (unscoped grants need acknowledgeFull; scope is
recorded and shown). see docs/isolation-permeability.md.

## host quickstart + connections audit (2026-10-29)

docs/host-quickstart.md is the turnkey host path; docs/connections.md is
the coverage matrix against ego.ist (connection types and permission
granularity, honest gaps). next candidates surfaced by the audit:
field-level fact addressing (if it earns its schema), directed-disclosure
-style one-shot delivery, and live oauth verification for the registered
adapters.

## turnkey plug-in (step 1 shipped 2026-10-29)

one command boots the backend: `node scripts/serve.mjs` with
MOIRA_TOKEN_KEY + MOIRA_OWNER_SECRET serves mcp, discovery, pkce/device
flows, and a working /authorize (constant-time secret -> real
OwnerContext). store auto-picks insforge, then supabase, then local
file. next steps: passkeys/oidc as the real owner auth (the shared
secret is a reference implementation to swap out), then a host quickstart
walkthrough in docs/.

## the vault (shipped 2026-10-26)

the persona vault is live on main: collect (wetransfer), mymind,
raindrop.io and linkwarden combined, per persona. capture without
filing, organize later by union (tags + sets), snapshots beat link-rot,
saving is not liking, pass-gated sets-scoped agent recall
(`vault_query`), heteronym isolation structural. later: connector-fed
capture (a read saved to the vault in one step) and highlights as a
capture kind.

## viola

the voice engine is **viola** - and like evie it is deliberately decoupled
and lives on its own branch (`viola`) until it starts. its question is the
unique dna of a persona's voice in a cyber context (style, cadence,
prosody's measurable shadow, typing quirks), and its answer is agent
CONTEXT, not training: sealed corpus, deterministic three-layer
measurement, owner-declared quirks, pass-gated handoff. contract:
technobabble/viola.md on the branch.

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
