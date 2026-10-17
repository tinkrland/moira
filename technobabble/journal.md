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

## 2026-10-16 - people block: family and friends circles

family and friends jobs added to the people block (planned, people
phase). the distinction from cresca.ai written into the contract: the
context of knowing is per-persona. the same human can be connected to
several of your personas - family relates to one of you, friends from
music another - so a relationship is always (person, persona), never
(person, owner) wholesale. circle providers: life360, familywall,
google family link, groupme, discord; find my joins via the
export/webhook fallback (no public api, ingest-style). failing test
first.

## 2026-10-16 - circles refined: soft tags, per-persona importance, no "real you"

owner pinned two refinements on the family/friends circles. one: circles
are soft tags, not rigid buckets - tagging a friend as basically family
is fine; fuzz is welcome, not an error. two: what differs across personas
is the importance profile of the relationship, not which persona is
"real". someone can be very high on professional-alex's axis and nearly
absent from your personal life. crucially: no persona is the real you
with the others playing roles - they are all the real you. written into
the registry comment, features, buildplan, readme.

## 2026-10-16 - readme: keeberia voice reverted, structured sections instead

owner rejected the keeberia-style narrative rewrite (reverted 4567044 +
journal note) and asked for the opposite shape: MORE sections and
subheadings. new readme structure: hats (what a hat is, wearing many, hats
are different personas, what apps do instead - the "personal context" mush
is utterly useless), personas more than a sandbox (isolation is only the
EASY half of the sandbox problem; permissive permeability is the other
half - bridges need consent on both ends, no hint without one), identity
kinds (linked / pseudonymous / heteronymous with character sheets, canon
that never leaves the character), planned decentral profiles (storage
tier: hosted/local/decentral, planned not built), then passes, facts,
connectors, the tree, cli, modality. owner explicit: NO under-the-hood
and NO repo structure/doc map in the readme at all - the where-to-go-
deeper table is gone.

## 2026-10-16 - readme: ascii connector tree removed

owner: the ascii tree "looks soooo ai written". connectors now live in one
prose paragraph (job-first, providers interchangeable, spans named in
sentences). also scrubbed every hyphen-as-dash separator from the readme:
no em dashes anywhere, punctuation is periods/commas/colons/parens. the
tree itself still lives in registry.js, features.md, and the cli help where
a table is the honest format. suite green.

## 2026-10-16 - readme v4: table, preferences section, no cli block

owner: drop the "how you use it" section entirely, make the sections longer
and better explained, and render the connector hierarchy as a real markdown
table (block | job | providers, each column narrowing one level) instead of
ascii. added the preferences section the owner pinned earlier: usage is not
liking. free usage is not preference (autoplay, family plans, work-mandated
tools); signals enter untrusted with source attached, preferences only exist
where the owner confirms them, and taint labels keep provenance even after
confirmation. sections expanded throughout; still no em dashes, no dash
separators, no under-the-hood, no repo map.

## 2026-10-16 - readme v5: merged-cell connector table

owner clarified the table shape: like google docs merged cells. the flat
markdown table is now an html table with rowspan: the block cell spans all
its job rows, and a job cell spans its provider sub-rows where access
splits (academia: connected zotero/mendeley/semantic scholar vs export/
webhook arxiv + google scholar). corrected a stale row while at it: arxiv
was missing from the readme's research providers. the registry remains the
source of truth and matches row for row.

## 2026-10-16 - readme v6: illustrative intro, blob wording

owner: first paragraph should be more illustrative, and the "what apps do
instead" section should say apps combine everything, in the name of
"personal context", into one single blob fundamentally diluted to
nothingness. intro now walks a day (founder at nine, student by noon,
character at midnight). metaphor unified on "blob" throughout (intro,
hats, permeability), since the section now defines it; still no dashes.

## 2026-10-16 - persona freeze/thaw shipped; mem0 pinned for persona memory

freeze/thaw (section 16 sibling of deletion) is live: freezePersona/
thawPersona on the owner surface, PERSONA_STATUS active/frozen on the
persona record, gates at the agent surface (_ctx), router.route,
switching.request (target side), bridges.request (either side),
facts.propose (so add too), packs.create, handoff pack-reshare, and
ledger.add (no new credentials on ice). facade freeze reaps standing
leases WITHOUT the kill switch (that flips the panic `locked` flag;
freeze is its own state) and writes persona_freeze / persona_thaw
receipts (new RECEIPT_OP entries). new ops surfaced in the cli
(persona freeze/thaw --id). failing-tests-first: test/freeze.test.js
pinned status flips, all-surface declines, switch-out-from-frozen also
locked, switch-into-frozen declined, facts preserved (frozen is not
deletion), thaw resumes exactly with keys intact. 177 tests: 165 pass,
12 gated.

owner decision: persona memory persistence (beyond the sealed vault)
runs on mem0, open source, behind the scenes - one isolated memory
space per persona; the deterministic core never depends on it directly
and taint/consent rules still gate what may enter a memory. recorded
in techstack.md.

## 2026-10-16 - mem0 considered and rejected

looked up mem0 (open source memory layer, mem0ai/mem0) as the candidate
for per-persona memory persistence. verdict: dropped. its core loop is
llm-driven (extract, consolidate, retrieve via embedder + vector store),
which cuts against three moira principles: (1) persistence is already
solved by the sealed per-persona fact vault on insforge, (2) mem0
auto-writes model-inferred memories - inverting the propose/approve/taint
gate that governs what enters memory, (3) it is exactly the
training-adjacent preference inference moira rejects ("usage is not
liking", deterministic core). the one real gap it names (semantic recall,
history consolidation) belongs to evie's latent-similarity approach, and
a plaintext vector index would sit outside the sealed vault anyway.
techstack.md pin removed same day it was added.

## 2026-10-17 - linkage hooks (22.4 v1) + stack context declarations

finished the persona context isolation wave. linkage service
(src/core/linkage.js): pre-link check at addAccount on the ledger's
existing keyed payer hashes (plaintext never stored or compared;
findings carry kinds, never values). an undeclared shared payer across
decoupled personas returns approval_required with the finding BEFORE
the account exists; declaredLink marks the pair declared (permanent),
acknowledgeLinkUntil accepts time-boxed (expiry reactivates findings;
monitorScan now respects expiry too). linkage-aware routing: accounts
whose payer links a decoupled persona to another are demoted below
clean accounts; the flag list is opt-in owner view (route linkage: true)
and NEVER on the agent surface (budget_route has no linkage field).
test moment-of-risk semantics note: an undeclared shared pair can only
exist behind a time-boxed ack, because the second addAccount is gated,
so the routing test drives the clock past an ack's expiry.

stack context declarations (src/core/stack.js): owner-stated,
per-persona stack as tool + multiple uses (the nested multiselect
shape from the owner's reference zip: one supabase entry, uses
auth/postgres/storage selected independently; re-declaring unions,
removal takes the whole tool or single uses). served to agents via
stack_get, pass-gated (category 'stack', purpose 'context'), receipt
written, structured output so agents stop hallucinating the stack.
frozen personas decline stack writes like every other activity.
cli: stack add/remove/list. suite: 189 tests, 177 pass, 12 gated.

## 2026-10-17 - stack: add-then-describe flow (owner's reference zip)

read the full stack-selection quest from the owner's reference zip
(incoming_files/4d8707d31_src.zip: ProjectSection + TechStackPills +
techToolsData). the pill flow adds the tool FIRST with empty useCases,
expands a "what are you using it for?" panel, then toggles uses on;
custom tools and custom use cases are both allowed. moira's stackAdd now
matches: uses may be empty (a declared tool with no uses yet implies
nothing), and an empty re-add is a quiet no-op that never wipes existing
uses. suite: 190 tests, 178 pass, 12 gated.

## 2026-10-17 - ai tool declarations (job-first, like the stack)

owner: build the same anti-hallucination surface for ai tools, job-first.
src/core/aitools.js: per-persona ai tool declarations where the JOB is the
required primary axis (mirroring the connector registry's job shape):
{ job, tools: [{ tool, uses }] } batches (all-or-nothing) or single
{ job, tool, uses } adds. competing providers under one job accumulate
(firecrawl/brightdata/querit/tavily is a valid full house), uses union on
re-declare, the same tool may serve several jobs (tavily under scraping
and search), removal takes a use, a tool, or a whole job. agents read via
ai_get pass-gated (new category 'ai'), structured { job, tools }
grouping, receipted, per-persona isolation. frozen personas decline.
cli: ai add/remove/list. suite: 198 tests, 186 pass, 12 gated.

## 2026-10-17 - context sets: connection-time set choice

owner clarification: declarations are context broadly, not
project-specific, organized in named SETS; one persona has several, and
at connection time the owner picks which set to share with which agent.
src/core/sets.js: sets are implicit (a set exists because entries
reference it; first declaration creates it), names normalize (trim,
case-insensitive match, first-seen display form), and one set spans
stack and ai entries (work = supabase + firecrawl). entries carry
sets[] that unions across adds; grantPass gained a sets scope; the
stack_get/ai_get read paths filter entries by the PASS's sets (a
scoped pass exposes exactly its sets, setless entries excluded; an
unscoped pass keeps the whole persona context). setList/setRemove owner
actions; removal untags, entries survive. batch ai adds take
batch-level sets, per-entry sets, or both. cli: sets list/remove, --sets
flag on stack/ai add. suite: 204 tests, 192 pass, 12 gated.

