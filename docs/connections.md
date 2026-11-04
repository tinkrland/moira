# connections and permissions: what moira covers

the owner asked for this against ego.ist (the egoist ai passport), which is
the closest published reference for "personal context layer with a
owner-controlled trust loop". this page states, honestly, which connection
types moira implements, which it does not, and how fine the permissions go.
every claim below is traceable to code: transport routes in
`src/transport/`, connector registry in `src/connectors/registry.js`, pass
shape in `src/core/passes.js`.

## connection types

### the consent loop (shipped 2026-10-30)

apps ask, the owner decides, nothing is readable meanwhile. `request_access`
takes categories, a purpose, a duration and an optional note; the owner sees
the ask in the inbox and may **narrow** it (shorten the duration, lower the
rung, cut the sets) or deny it. approval is the only path from a request to a
pass, edits can only tighten (`edits_widen_the_request`), and the ask plus
the decision are receipted content-free. that is ego.ist's loop, built on
moira's pass instead of a passport.

### the inference check (shipped 2026-10-31)

a pass blocks reads, not inference. `GET /api/leakage?personaId=&clientId=`
reports which withheld facts are reconstructible from what that agent is
served, with the containment score, the threshold used, and its caveats - and
never quotes content. method in docs/isolation-permeability.md.

### inbound: how an agent or app reaches moira

| type | ego.ist | moira | notes |
|---|---|---|---|
| mcp (streamable http) | yes (`/mcp`, plus an llms index for agents) | **yes, live** | protocol 2025-11-25, ~30 tools of the agent surface; this is the primary path |
| oidc / oauth sign-in (pkce s256) | yes (standard oidc, drop-in sdk) | **yes (pkce s256 code flow)** | discovery via rfc 8414/9728, `ai-passport-signin`-style drop-in sdk is not built, but the flow is standard |
| device authorization (rfc 8628) | yes | **yes** | `POST /device/code`, `POST /device`, polling `/token` |
| connect code (owner-minted, single agent) | yes | **yes** (`connect_codes` in the core) | pending-connect flow with owner approval |
| deep integration (managed server-to-server api) | yes (onboarding by contact) | **no, deliberately** | moira's answer is the owner api + passes; a second server-to-server integration surface is a different product, not a gap to fill silently |
| directed disclosure (one-shot delivery to an exact https destination, content-free status back) | yes | **no** | closest moira primitive is a one-time handoff pack to an exact recipient agent; true "deliver to a url, return only status" is not built |
| owner session | not public | **yes, reference-grade** | shared-secret verifier for `/authorize` (`MOIRA_OWNER_SECRET`), constant-time, mints a real OwnerContext; passkeys/oidc is the swap-in |

### outbound: how moira reaches the world for a persona

| type | moira | notes |
|---|---|---|
| oauth2 bearer (per provider) | **yes** (drive, dropbox, onedrive registered with per-provider scopes: `drive.readonly`, `Files.Read`, `files.metadata.read`...) | adapters are fixture-verified; live handshakes need your own oauth app credentials |
| session-key / pasted credential | **yes** (mega, honestly not implemented beyond the credential shape) | credentials seal under the persona key, never plaintext |
| api-key connectors | **partly** | the credential envelope is generic (any sealed object), but registered providers are oauth or session-key; an api-key provider is a row + adapter, not a new mechanism |
| ingest (read-only sources, e.g. substack, medium) | **registered, planned** | separate `CONNECTOR_KIND.INGEST` path; taste-block ingest activates with evie, gated honestly (`status: 'evie'`) |
| mcp as a *consumer* (moira calling out to an mcp server) | **no** | moira is an mcp server; consuming someone else's mcp tools is not in scope yet |
| multi-account per provider | **yes** | identities keyed `(persona, connector, account)`, passes can pin an account |

## permission granularity

ego.ist requests **exact fields** with a **purpose** and **duration**
(`read: ["style.preferences", "profile.sizes"]`, `duration: "session"`),
shows the owner company + fields + purpose + duration, allows
approve/edit/deny, accepts **memory-write proposals**, and leaves a
**receipt** for every read and proposed write. revocation is instant.

moira's dials, in the same spirit but not field-addressed:

| dial | moira | compared to ego.ist |
|---|---|---|
| what | **category** (facts categories, `preferences`/`taste`, `stack`, `ai`, `vault`, `voice`, `connector`, `workspace`) + **sets** (named context slices: work, side projects) | ego.ist addresses individual field paths; moira addresses categories and slices. field-level paths would be a category-vocabulary expansion, not a new mechanism |
| detail level | **rung** (`maxRung` per pass; rung authored at write time) | this is moira's finer-grained dial ego.ist does not publish an equivalent for: a pass can read "exists/abstract" without "full canon" |
| why | **purpose** (required, part of the pass key) | same idea |
| how long | **duration**: session / permanent / one-time (consumed by the read) + optional `ttlMs` | same idea, plus one-time reads |
| per-call limits | **uses**, spend caps (`spendCaps.usd`), privacy budgets on bridges | ego.ist does not publish per-call or spend limits |
| connector permissions | **connector passes** separate from memory passes; scope strings per job (`files.list`, `files.read`), account pinning, one-time consumption | ego.ist's analog is per-integration approval; moira keeps a separate pass kind so a memory pass never implies connector access |
| writes | **proposals** (`remember` is a proposal; owner approves) | same idea ("suggest memory writes") |
| audit | **signed, content-free receipts** (op, persona, category, timestamp) | same idea, plus receipts are cryptographically signed and never carry content |
| revocation | next read after revoke fails; persona freeze is a one-way switch | instant, same |

## what moira has that this comparison surfaced as unique

- **rungs**: detail level per pass, so "knows a fact exists" and "knows
  the fact" are different permissions.
- **sets**: connection-time slices of context that span facts, stack, ai
  tools and the vault at once.
- **persona isolation as a hard wall**: `personasAllowed` + per-persona
  key sealing; ego.ist's passport is one memory, moira's is one per hat.
- **bridges with privacy budgets**: two-sided sharing between personas
  with a budget, which a single-passport model has no analog for.
- **one-time passes and per-read consumption.**

## honest gaps against ego.ist (named, not hidden)

1. ~~field-level addressing~~ **closed 2026-10-30.** facts author `fields`
   at write time; passes, requests and approvals can address
   `category.field` exactly (`preferences.writing_style`). an addressed pass
   cannot reach a fact that never named a field, an address cannot leave its
   category, and an owner can only cut fields from an ask, never add them.
2. **hosted trust surface.** ego.ist ships an iphone app, hosted consent
   screens and a partner program. moira ships api + reference consent.
3. **800+ integrations.** ego.ist advertises 800+ connector sources; moira
   has a registry of blocks/jobs with a handful active and the rest
   `planned` - deliberately honest statuses rather than phantom rows.
4. ~~directed disclosure~~ **shipped 2026-10-31** (request → owner decision →
   exactly one server-to-server delivery to the exact https destination →
   content-free status with a signed attestation; values never returned to
   the app, at any status). **deep integrations** (managed server-to-server
   onboarding) remain deliberately unbuilt.
5. **live oauth verification** - adapters are fixture-verified only.

none of these change the shape: moira's model is a superset of ego.ist's
consent loop minus the hosted surface, with per-persona sealing and rungs
as the differentiators.


## a connection is a place, and a permission that can end (2026-11-02)

three things were wrong with "connect google drive": it collapsed workspaces, it
could link two personas through one credential, and it granted standing access
by default. all three are now structural.

**platform + workspace + account.** one google account can hold two work
spaces; one slack login can reach two teams. keying an identity on
(persona, connector, account) silently merged them, which is how the wrong
workspace gets read. identities are keyed on all four, a pass may pin a
workspace, and re-authorizing replaces only that one pair. a pass records what
the owner *chose* to pin: `null` means unpinned, and pinning later is an
explicit act, never a side effect of authorization order.

**no cross-persona credential reuse.** if two personas authorize the same
credential, the provider sees one human wearing two hats, which is exactly what
persona separation denies. authorization fingerprints the credentials (HMAC over
canonical json, never the value, never reversible) and, on a match under another
persona, refuses with `approval_required` / `credential_linkage` before the
identity exists. an owner may override with `acknowledgeLinkage: true`, which
writes a permanent link record readable only through
`owner.listConnectionLinks` - never on any surface an agent can reach.

**fine-grained by default.** a connector pass now defaults to `session` with an
expiry, not a standing grant; `permanent` requires
`acknowledgeStanding: true`. the same rule memory passes already followed.

**revocable always, rotating on request.** every identity carries a policy,
default `{ mode: 'revocable' }`. `setConnectionPolicy({ mode: 'rotating',
everyMs })` schedules rotation; `dueRotations()` lists what a host should
rotate; `rotateConnection({ identityId, credentials })` replaces the sealed
material in place, keeps the identity and its live passes working, bumps
`rotationCount`, and overwrites the old secret rather than archiving it.
rotation is never a reason to lose revocability: `revokeConnector` kills the
identity and its passes regardless of policy.

honest limits: rotation is a call, not a daemon - someone (a host, a cron, an
owner) has to make it. nothing here re-negotiates with the provider, so a
rotated credential is only as real as the value supplied. live oauth adapter
verification remains the stated gap.


## api keys, projects, and two tokens in one place (2026-11-02)

app-level oauth is not the only shape. a persona with api keys has internal
**projects** - self-created buckets like `atlas` and `beacon` - and a project
may hold several credentials for the same provider, because fine-grained tokens
are fine-grained: one github PAT with workflow and runners permission, one
without. some projects have one of each, some have a second token for a narrow
job.

so an identity slot is
**(persona, connector, project, workspace, account, credential)**:

- a **project is ours**, a **workspace is theirs**. both dimensions, never
  synonyms: one google account can hold two workspaces, one persona can hold two
  projects, and neither collapses into the other.
- a second token on the same account in the same project is a **second
  identity**, not a replacement. re-authorizing replaces only its own slot.
- a pass names the project it belongs to. a pass for `atlas` is not a pass for
  `beacon`.

**capability is the declaration, not an introspection.** a PAT does not announce
its scopes, so the owner reads them off the token screen and states them
(`capabilities: ['repo:read', 'workflow:write']`). the hub never infers them.

stingy by construction, in three places:

1. **an undeclared second token is refused.** joining a slot that already holds
   another credential requires declaring what you can do
   (`capabilities_required_for_multiple_credentials`), and two credentials with
   the same capability signature are refused as indistinguishable. an older
   undeclared credential is grandfathered as the plain fallback and can never
   claim a capability-scoped pass.
2. **the least capable credential that covers the pass is what goes out.** ask
   for `repo:read` and the narrow token is used even when a broad one is
   connected; the broad token is reserved for passes that actually need it.
3. **no coverage is a named refusal**, `capability_not_covered`, with the wanted
   list. never a silent substitution and never a fallback to a wider token.

capability lists stay owner-side: `listConnectors` carries project and credential
slugs (the agent needs to target the right one) but no capabilities, so an agent
cannot enumerate what the owner's tokens are permitted to do.

honest limit: capability labels are the owner's declaration, not a provider
check. a token whose real scopes are wider than declared will behave wider, and
that is a declaration bug this layer cannot detect.


## rotation on a calendar vs rotation on quiet (2026-11-02)

two different questions, so two schedule kinds.

**calendar** - `{ kind: 'every', every: '1w' | '1mo' | '30d' | ms }` or
`{ kind: 'at', at: <timestamp or ISO date> }`. an interval is measured from the
last rotation, or from when the schedule was **set** if it has never rotated
(setting "every month" today means a month from today, not a month from when the
connection was authorized). a month is 30 days here: calendar months are not
modelled, and pretending otherwise would make a rotation date quietly wrong. a
dated rotation is **one-shot**: after it fires, `scheduleComplete: true` and the
calendar is empty rather than silently re-armed to the same instant.

**activity** - `{ kind: 'idle', idleGraceMs, idleAfterMs, maxAgeMs }`. fires
`idleAfterMs` after the connection has been quiet for `idleGraceMs`. this is the
shape of a hosted database pausing an unused project - except the purpose is
inverted: pausing a project saves resources, while rotating a credential exists
so an old secret does not live forever. that inversion is why the ceiling is not
optional:

- **`maxAgeMs` is mandatory in spirit**, and a schedule whose ceiling is shorter
  than its own quiet window is refused (`schedule_max_age_too_short`). without a
  ceiling, a credential in constant use would never come due - the busiest
  connections would keep the oldest secrets, which is exactly backwards.
- the earliest trigger wins, and `dueRotations()` reports **why**:
  `interval` | `scheduled` | `quiet` | `max_age`, with `overdueByMs`.

**what counts as activity.** moira sees its own reads, and a read moves the
quiet clock. it cannot see a human pushing to the repo or CI running, so the host
reports those with `touchConnection({ identityId, at })`, owner-only, and a
future timestamp is clamped to now. idle means "quiet as far as this system can
see", never "quiet in the world" - an activity-driven rotation that assumes
omniscience would be guessing about the one thing it cannot observe.


## people, connecting: the social half as an authorization flow (2026-11-03)

the address book keeps a persona's people private. the other direction, borrowed
from cresca, is a consented link between two humans made through the personas
they choose. that is authorization, not ingestion, so it is built like one.

**the code is a bearer secret.** `connectionInvite({personaId, label})` mints a
readable code (`abcd-efgh`, no 0/o/1/l/i), returns it once, and stores only an
HMAC of it. unknown, expired and already-spent codes are refused with the same
`invite_unusable` - a distinguishable refusal is a guessing oracle.
`connectionAccept({code, personaId})` consumes it: one code, one use, one
persona.

**the invite declares what the recipient may learn.** `label` is the only thing
that crosses about the inviter. omit it and the peer shows as `null` rather than
as an inferred name, and the accept payload never carries the inviter's other
personas.

**a share is a discrete act.** `shareToConnection({connectionId, personaId,
kind, payload})` seals the payload to the *recipient persona key*, records a
`disclosure` receipt that says something moved and not what, and puts an
envelope in `connectionInbox`. `openDelivery` returns the payload exactly once
(`already_opened` after), and opening requires the connection to still be
active.

**revocation is unilateral.** either side revokes; unopened deliveries are
cancelled rather than left waiting, because consent withdrawn is not consent
pending. both sides see `state: 'revoked'`.

two honest limits, stated rather than papered over:

- **personas belong to the instance today** (every record reads
  `ownerRef: 'owner'`), so per-person ownership cannot be enforced inside one
  instance. the real boundary is the ownerRef on the invite, and the
  `same_owner` guard refuses linking two personas of the same owner - that is an
  alias, not a connection. two humans on two instances is what a code is for.
- **connections are owner-only.** no agent tool reaches them, and `moira_status`
  carries nothing about them: an agent learning that its human is connected to
  someone is exactly the cross-persona fact this whole design keeps out.

surface: `GET /api/connections`, `GET /api/connections/inbox`,
`POST /api/connections/{invite,accept,share,open,revoke}`.

## isolated by default, shared on purpose (2026-11-05)

the same decision appears at two layers, and this build makes both of them
explicit instead of accidental.

### a credential: persona-scoped, or declared shared

every identity is sealed under its AUTHORING persona's key. that stays true even
when it is shared: a borrower unwraps the owner's envelope rather than getting a
copy under its own key, so there is exactly one secret at rest and one place to
revoke it.

`connectConnector({ sharedWith: [personaId] })` is the only way a credential
crosses. it exists because the linkage guard, left alone, taught the owner to
paste the same key twice - producing the very link it was preventing, minus the
record. sharing is a record: `shareScope: 'shared'`, a bounded list, and:

- **sharing a credential is not sharing a permission.** each persona still needs
  its own connector pass; the identity is usable, not readable.
- **a borrower cannot change it.** revoke and rotate belong to the authoring
  persona; `ownerOf({identityId})` exists so a caller checks instead of guessing.
- **a borrower is told it is shared, never with whom.** `listConnectors` returns
  `shared: true, mine: false` and never another persona's id, so the surface
  cannot become a map of the owner's hats.
- **revocation is one act for everyone**, because it is one secret.
- `sharedWith` must be a non-empty, duplicate-free list that does not contain the
  author: `shared_with_invalid`, capped at 12 (`shared_with_too_many`).

### a bucket: which tools can even be shared

src/connectors/scopes.js answers "which tool buckets, mcps, apis and oauths"
from the credential's nature, not from taste:

| what it is | example | scope | why |
|---|---|---|---|
| oauth account | google drive, notion, linear | persona | the credential IS an account with a face; sharing joins the hats at the provider |
| session key | mega | persona | same, signed in |
| mcp server | any mcp endpoint | persona | the server config is the owner's own secrets and tools |
| ingest | substack, medium | persona | reads what is already public; nothing to share |
| api key | claude, chatgpt, firecrawl | shareable | a key identifies a plan, not a person; one key across hats is billing, not disclosure |

this is a HINT. nothing in it shares anything, and an unclassified provider
returns `scope: 'unknown'`, which callers must treat as persona - guessing
"shareable" is the one mistake that cannot be taken back. `owner.connectorSharing`
serves the table so the surface can say why, not just what.

### context: liking vs availability vs constraint

the "usage is not liking" rule had a write half only: `BASIS` recorded *why* a
fact was believed, and `serve()` ignored it, so an ask about taste could be
answered with a work-mandated tool or a free-credit service. reads now filter:

- `basis: 'liking'` -> `stated`, `chosen_freely`
- `basis: 'constraint'` -> `chosen_under_constraint` (work pays, family plan)
- `basis: 'availability'` -> `availability_driven` (free credits, free tier)
- `basis: 'inferred'` -> `inferred` (saving is not liking)

an explicit list of BASIS values works too; an unknown one THROWS rather than
being ignored, because a dropped filter serves more than was asked. a pass may
carry `basis`, and the agent read path honours it; a pass with no basis still
sees everything, which keeps the old behaviour available as a choice rather than
a silent default. an inferred fact never satisfies a liking ask even when its
content says "likes".
