# gaps: what is specced and not built

written 2026-11-13, after the sharing/basis/connector-panel wave. status is
honest and each line names its evidence, so this is a list of holes rather
than a list of promises. three buckets: **gating decisions**, **buildable
now** (the code seam already exists and nothing else blocks it), and
**deliberately deferred**.

the distinction that matters: several things below are *declared in code and
inert*. those are the dangerous ones, because a declaration reads like a
guarantee. they are marked **[inert]**.

---

## gating decisions (waiting on you)

### 1. owner session auth (phase 2.5)

today an owner capability is minted after the host's own verification: a
shared secret checked in constant time (`src/transport/ownersession.js`,
wired by `scripts/serve.mjs` from `MOIRA_OWNER_SECRET`). that is a reference
implementation, not an auth story. every hosted deployment needs the real
one.

the proposal on the table is passkeys + recovery codes, no passwords.
the word "passkey" appears in `gateway.js`, `keyservice.js`,
`ownercontext.js`, `ownersession.js` and `server.js` only in comments - there
is no webauthn code, no recovery flow, no credential registration. until this
is decided, `/authorize` depends on the shared secret.

deciding this unblocks: hosted use, per-device owner sessions, and removing
the secret from the boot command.

---

## buildable now (the seam exists, the code does not)

### 2. service rules as a first-class object — **shipped 2026-11-13**

`docs/agent-vault-review.md` named this as the one thing worth taking from
agent-vault. there was no object saying "this hat may call exactly this endpoint
with exactly this account": the account was a sealed credential and egress was
implicit in whichever adapter happened to be installed.

`src/core/services.js` now holds the rule: **host + path glob + methods? +
authKind + accountId?**, owner-stated (never inferred from traffic, like the
stack and the ai tools), receipted as `service_rule` on add, remove and every
refusal.

**judged where the call happens.** `hub.egressFetch({ personaId, accountId })`
wraps fetch with `services.match`, and the file adapters now receive that
wrapper instead of raw fetch, so a call to a host nobody declared is refused
before the socket opens and the adapter never sees a credential it may not use.
the refusal is raised as an error with `code: 'egress_not_allowed'` because an
adapter expects a Response or a throw, never a verdict object.

**two decisions worth stating, because they are arguable:**

- **glob semantics.** `*` stops at a slash, `**` crosses it. `/repos/o/r/*` is
  the repo; `/repos/o/r/**` is anything inside it. a prefix guess would have
  made the first form a silent superset.
- **what "no rules" means.** not "refuse everything" - a hat that never declared
  anything would have stopped working the day this shipped - but "nothing
  declared, nothing narrowed", reported as `no_rules_declared`. the moment one
  rule exists for that hat, egress closes to everything it does not name.
  declaring a boundary makes it a boundary; silence does not.
- **account binding** bites when the caller names an account id. a caller that
  names none is not silently borrowing a forbidden one; the pass/lease seam
  covers that path, and the adapter path does not yet carry a ledger account id.

surface: `GET /api/service-rules`, `POST /api/service-rules`, `DELETE
/api/service-rules/:id`, owner-gated, and a panel section per hat that writes
the sentence in a form and says what an empty list means.

### 3. approval links with a short read-only token — **expiry shipped 2026-11-13, the link is still open**

an ask now carries a deadline: `ASK_TTL_MS` is 7 days (agent-vault's number),
`request()` stores `expiresAt` once rather than recomputing it, and
`requests.view()` reports a pending row past its deadline as `expired` even
before a sweep touches it. `approve`/`deny` refuse with `request_expired` and
mint nothing; `sweep()` flips the rows and receipts each expiry exactly once,
idempotently. the route sweeps before listing, so "pending" never includes a
ghost, and the inbox says how long is left.

~~no expiry~~ closed. **still open: the read-only link.** an owner still needs
an authenticated owner session to say no, which is the wrong ergonomic ask for
"reply to this one question". the token discipline it needs already exists here
(hash at rest, raw once, single use) in `connect.js` and the device flow.

### 4. connection policy has no surface and no clock — **shipped 2026-11-13**

closed on all three counts. routes: `GET/POST /api/connectors/policy`,
`GET /api/connectors/due`, `POST /api/connectors/rotate`, owner-gated, results
200 / missing 404 / refused 400. panel: each held connection shows its deadline
in words ("revocable · stays until you revoke it" or "rotating · next 2026-12-13"),
a `due now` marker when it is overdue, a schedule picker (30/90 days, quiet 14)
and one "new credential…" act.

the clock is `scripts/sweep.mjs`: it stamps expired asks and prints the due
rotations as json for cron. it rotates nothing, on purpose - rotation needs new
material from the provider, which is a person's act, not a timer's. refusal: it
will not run without `MOIRA_OWNER_CONFIRMED=1`.

**and the idle hazard was smaller than this doc claimed.** connector reads and
people captures already stamp `lastActivityAt` internally (`hub.js` read path),
so "quiet" is measured from real use, not only from a host's `touchConnection`.
`touch` remains for activity moira cannot see. verified against a 40-day-old
credential: `dueRotations` reports `reason: interval, overdueByMs: 864000085`.

### 5. traces exist, the export does not — **shipped 2026-11-13**

the action-log chain shipped: `src/core/traces.js`, a sequence stamped onto
every receipt, an open trace attached per request, and owner methods
`traceBegin` / `traceEnd` / `traceReceipts` / `tracesList`. there was no route,
no panel view and no export, so the stitching was a promise the owner could not
check.

routes now: `POST /api/traces` (open), `GET /api/traces` (list, filterable),
`GET /api/traces/:id` (the chain, ordered by sequence), `POST
/api/traces/:id/end`, and `GET /api/traces/export` as an attachment. all
owner-gated; an unknown trace is 404 rather than an empty story.

panel: a traces section listing recent units of work, each opening into its
ordered chain - sequence number leading, because the sequence is the story - and
a download that fetches with the owner header into a blob.

**the scope is explicit, and that shaped the test.** receipts are stamped with
the trace in scope on the gateway (`useTrace` / `clearTrace`), not by passing a
`traceId` to `write`; the first version of this test passed a field that is
ignored and got an empty chain. the test now opens scope, writes a granted read
and a refused one, clears, and asserts both appear in order with the refusal
included - a refused read belongs in the story as much as a granted one.

### 6. rooms, attendance and the group brief have no surface — **shipped 2026-11-13**

~~the panel contains zero room code.~~ closed: the persona detail carries a
rooms section (list, create, join, decline, open), and the room view is a
timeline plus item and attendance forms with the count-vs-name rule stated
where the choice is made. `rooms.list({personaId})` was the missing read.

**and the audit was too kind.** the routes were not merely "HTTP only": every
`/api/rooms*` handler referenced an `owner` and a `send` that lived in another
block, so the whole room api answered 500. no test covered the routes because
the room tests drove the facade. `test/rooms-http.test.js` now drives them, and
`docs/people.md` keeps the story. the lesson worth carrying: a service test is
not an endpoint test, and a surface is not decoration - building one is how
these were found.

### 7. freeze/thaw, kill switch and persona export are code-only — **shipped 2026-11-13**

`ownerapi.js` carried `freezePersona`, `thawPersona`, `killSwitch` and
`exportPersona` with no route and no button, so the two acts a worried owner
most wants - "stop everything" and "give me my data" - were reachable only from
the Node api. a control with no surface is a control for the person who wrote
it, not for the person who owns the data.

routes now: `POST /api/personas/{freeze,thaw,kill}`, `GET /api/personas/export`,
all owner-gated, mapped results 200 / a missing persona 404 / a refused act 400.
export is served as `content-disposition: attachment` and carries the persona,
its facts, its accounts **and its receipts** - the receipts half is what makes
an export honest rather than decorative.

panel: a `control` section at the top of the persona card, with the state in
words ("frozen · nothing new is served" or "active"), and exactly three acts.
freeze is labelled reversible; the kill switch states its own limit in the
confirm ("nothing is deleted, and a lease cannot be un-stopped - it has to be
re-requested") because that limit is the thing an owner is afraid of getting
wrong.

**one defect found by the test:** the kill switch answers `frozenLeases` as a
*count*, not a list. the first test asserted an array and failed, which is the
right way round - the test now creates a live lease and asserts the switch
reports exactly one thing stopped.

export in the panel fetches with the owner header and hands the browser a blob;
a bare `<a href>` would arrive unauthenticated and quietly export nothing.### 8. `reshare_with_hop_limit` promises a hop limit it does not count — **enforced 2026-11-13**

`packs.create` accepted the option and stored `hopsUsed: 0`, and no path let a
holder re-issue a pack, so a hop-limited pack and a no-reshare pack behaved
identically at every seam. the option had **no number in it either**, which is
the part that made it pure decoration.

closed by building the path it described. `packs.reshare` re-issues a pack
forward under the pack's own policy: `no_reshare` refuses with
`reshare_not_allowed`, a named-recipient policy refuses with
`reshare_needs_the_owner` (a borrower cannot widen a grant by re-issuing it),
and a hop-limited pack is copied with `hopsUsed + 1` and refused at the limit
with `hop_limit_reached`. `create` now requires an integer `hopLimit` for that
policy and refuses `hop_limit_invalid` otherwise.

the child is a new signed pack: same contents (copied, not re-derived), its own
recipient binding, no inherited budget lease, a ttl **clamped to the parent's
remaining life**, and a recorded chain (`parentPackId`, `rootPackId`). revocation
now walks the chain, because a consent that survives its own withdrawal is not
consent. every hop is receipted with `reshare:hop_N_of_M`.

agent surface: `context_pack_reshare`, so the holder is the actor and the count
is enforced where the act happens.

### 9. people capture had no adapter that feeds it — **calendar feeder shipped 2026-11-13**

the ingest pipeline was complete and tested and unreachable: hub reads signals
through `adapter.listPeopleSignals`, and all four adapters were file readers.

`google_calendar` is the first feeder, and the registry row is `active` because
code shipped, not because a plan exists. it reads events with
`singleEvents=true` and normalizes attendees to `{kind:'calendar', handle, name,
at}`, excluding three things on purpose:

- **the owner** (`self: true`). the owner is not a contact.
- **rooms and resources** (`resource: true`). a room is not a person.
- **declines** (`responseStatus: 'declined'`). a decline is not an appearance.

a cancelled event is skipped, an all-day event still dates its people, and an
attendee with no address is dropped rather than guessed at from a display name,
since handle is what dedupe runs on. names pass through raw: sanitizing is the
ingest's job, because captured names are untrusted text.

verified over HTTP against a fixture provider: connect returns an identity,
`POST /api/people/capture` reports `proposed: 2` (the owner and the room
excluded), proposals are `untrusted: true` with `sightings: 1` and the event
date, and the address book is still empty. drive, dropbox and onedrive still
answer `adapter_cannot_feed_people` - "could not look" never reads as "found
nothing". a mailbox feeder is the next cheap one; the plumbing is now shared.

**live limit, stated rather than implied:** the calendar adapter is exercised
against documented-shape fixtures, not a real Google account, exactly like the
three file adapters. that needs the owner's oauth app.

### 10. the ledger cannot learn

`src/core/ledger.js` states its own contract in the header: manual entry and
owner-confirmed proposals here, and "provider usage polling and billing-mail
extraction are connector-fed and arrive as owner-confirmed proposals".

neither is built. `add()` takes a manual spec, `spend()` meters what moira
itself routes, `alerts()` and `runway()` compute from stored dates. there is
no poller, no gmail-metadata reader, and no proposal type for "your trial
ends in 3 days, confirm". spec v1's billing-mail extraction is untouched.

related and smaller: `rankFor` takes `burnRateFraction` as an argument.
nothing learns it, so the "spend forecasting with burn-rate learning" item is
also open (`burn` in `src/core/` is only this knob).

### 11. standing-rule suggestions — **shipped 2026-11-13**

agents carried `standingRules` and `agents.js` matched them, but nothing
suggested one: the owner had to know the api to stop being asked.

`requests.suggest()` groups **approved** asks by shape (agent, hat, the sorted
categories, the duration) and offers a shape at three approvals. the suggestion
id is derived from the shape, so asking twice does not invent two, and a shape
already covered by a rule is not offered again. a **denied** shape is never
suggested: a no three times is still a no.

`standingRuleAccept` appends the rule with `basedOn: <n>` and receipts it as
`standing_rule`, which is now a receipt op - a standing rule is a consent act,
so it belongs in the ledger like every other.

**and the ask path consults it.** `request_access` still records and receipts
the ask, then approves it at once when a rule covers the shape, returning
`autoApproved: true, reason: 'standing_rule'` with the minted pass. coverage is
set containment, not equality: a rule for `preferences` answers an ask for
`preferences`, and an ask for `preferences, health` goes back to the owner. a
pattern is not a blank cheque.

surface: `GET /api/standing-rules/suggestions`, `GET /api/standing-rules`,
`POST /api/standing-rules`, owner-gated; a panel section per hat that names the
pattern ("you have answered this shape 3 times"), offers one act, lists what is
standing, and says in words that a wider ask still comes back.

---

## connectors: registered, not built

the registry is deliberately wider than the adapters, and every unbuilt row
says `PLANNED` rather than pretending. the honest inventory:

- **built:** google drive, dropbox, onedrive (fixture-tested only).
- **stub:** mega returns `{ outcome: 'not_implemented' }` with its reason
  (encrypted rpc, no oauth).
- **registered, no adapter:** projects (linear, craft docs, notion), time
  (google calendar, notion calendar), reading (substack, medium), ai tools,
  the whole tech & dev block, academia, and the people block's
  meetings/social/networking providers.
- **live verification:** none of the three file adapters has been run against
  a real provider. each needs an oauth app registration and credentials.
  until then "fixture-tested" is the strongest true sentence.

---

## deliberately deferred (v2/v3), listed so nothing looks forgotten

- payments and booking actions
- sovereign storage tier, on-device mediator, device mesh
- partner / relying-party api with lifecycle events
- `link_attest`, action passes, reshare-to-named-agents enforcement
- v3 taste connectors (everything under the taste blocks is evie-gated)
- evie (taste engine) and viola (voice engine): both live on their own
  decoupled branches and merge only on the owner's call

---

## the order i would build them in

1. **rooms in the panel** (6) - the layer is done and dark; a surface is the
   difference between a feature and a test file.
2. ~~**policy + clock** (4)~~ shipped: routes, panel controls, and
   `scripts/sweep.mjs` for a host's cron.
3. **approval links** (3) - the expiry half is shipped; the read-only link is
   still the ergonomic gap, and it reuses token discipline that already exists.
4. **people adapter** (9) - one calendar reader turns the whole ingest path
   from "tested" into "used".
5. **traces export** (5) and **persona export** (7) - both are routes over
   facades that already compose the answer.
6. ~~**service rules** (2)~~ shipped: a rule the owner can read, judged at the
   socket. the largest of these, and the one that makes egress
   reviewable instead of implicit.
7. **hop-limit honesty** (8) - either enforce or delete; it is a small change
   and it removes a declared guarantee that does not exist.
8. **owner auth** (1) - blocked on your decision, not on code.
9. **connector waves + live oauth** - each is an oauth registration and an
   adapter, not an architectural question.
