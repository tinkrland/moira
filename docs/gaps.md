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

### 2. service rules as a first-class object

`docs/agent-vault-review.md` names this as the one thing worth taking from
agent-vault and it is still absent. moira has persona-level egress labels and
a per-connector account pin, but no "this persona may call exactly this
endpoint with exactly this account" object: host + path glob + auth kind,
reviewable by the owner, enforced at the call.

evidence: no `serviceRule` / `service_rule` anywhere in `src/`.

why it matters: it is the natural home for accounts. right now the account is
a sealed credential with scopes, and egress is implicit in whichever adapter
happens to be installed. a service rule makes egress a sentence the owner can
read.

### 3. approval links with a short read-only token

an access request is decided over an authenticated owner session
(`POST /api/requests/decide`). there is no link, no read-only token, and no
expiry: `src/core/requests.js` has no `ttl`, no `expiresAt`, and nothing
sweeps stale asks.

two consequences worth naming:

- an ask that nobody answers stays pending forever. agent-vault's proposals
  expire in 7 days; ours do not. reads stay `approval_required` while
  pending, so this fails closed, but the inbox inflates.
- an owner has to hold an owner session to say no. a short-lived read-only
  approval link is the ergonomic fix, and the token discipline already exists
  in this repo (hash-at-rest, raw once, single use) in `connect.js` and the
  device flow.

### 4. connection policy has no surface and no clock

`setConnectionPolicy` / `connectionPolicy` / `dueRotations` /
`rotateConnection` all exist in `src/core/connectors/hub.js` and the owner
facade, and the rotation reasons (interval, scheduled, idle, max_age) are
computed properly. but:

- the panel has no control for policy mode (`grep policy ui/app.js` is empty),
  so mode and schedule are reachable only through the Node API.
- nothing calls `dueRotations`. there is no `setInterval`, no cron, no
  scheduler in `src/` - by design the clock is the host's. that means a
  credential past its rotation deadline is only discovered by a host that
  remembers to ask, which is the same as not rotating.

**[inert] one part is a real hazard:** an "idle" policy is supposed to fire
when the connection goes quiet, but idleness is only knowable from
`touchConnection`, which the host must call. nothing calls it. so activity
policies silently never trigger until a host integrates.

### 5. traces exist, the export does not

the action-log chain shipped: `src/core/traces.js`, a sequence stamped onto
every receipt, an open trace attached per request via `x-moira-trace`, and
owner methods `traceBegin` / `traceEnd` / `traceReceipts` / `tracesList`.

what is missing is the owner-side reading: no `/api/traces` route, no panel
view, no export. docs/sandbox-problem.md says "an owner-side trace export
that stitches one unit of delegated work in order" - the stitching exists in
code and is unreachable from the surface.

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

### 7. freeze/thaw, kill switch and persona export are code-only

`ownerapi.js` carries `freezePersona`, `thawPersona`, `killSwitch` and
`exportPersona`; the panel has none of them and there are no routes for
export. spec v1 lists "per-persona export and delete with key shredding" -
delete/shred is reachable, export is not.

export is small: the facade already composes persona + facts + accounts +
receipts into one object. it needs a route and a signed download, and the
receipts half is what makes it honest.

### 8. `reshare_with_hop_limit` promises a hop limit it does not count

**[inert]** `packs.create` accepts `RESHARE.HOP_LIMIT` and stores
`hopsUsed: 0`. nothing increments `hopsUsed`, and no path lets a recipient
re-issue a pack, so a hop-limited pack and a no-reshare pack behave
identically at every seam. it is not exploitable (only the owner creates
packs), but it is a declared policy with no enforcement - exactly the shape
this repo refuses elsewhere.

either enforce it (a re-pack path that carries `hopsUsed + 1` and refuses at
the limit) or delete the option. leaving it declared is the worst of the
three.

### 9. people capture has no adapter that feeds it

the ingest pipeline is complete and tested: hub reads signals through
`adapter.listPeopleSignals`, dedupes by handle, counts sightings, keeps
disagreeing names as candidates, strips links and handles, marks everything
untrusted, and lands proposals that mint no facts. `POST /api/people/capture`
works.

no adapter implements `listPeopleSignals`. `src/connectors/adapters.js`
exports four adapters (drive, dropbox, onedrive, mega-stub) and all four are
file readers. so the address book cannot fill itself: a caller has to hand
the hub a signal array it built elsewhere. the missing piece is one host
adapter that actually reads a calendar or a mailbox (google calendar events
with attendees is the cheapest honest start).

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

### 11. standing-rule suggestions

agents carry `standingRules` and `agents.js` matches them, but nothing
suggests one. spec v1's "standing-rule suggestions" (the owner approves a
pattern once and stops being asked) is absent: no proposal kind, no detector
over repeated asks.

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
2. **policy + clock** (4) - either a scheduler calls `dueRotations`, or the
   rotation story is prose. a credential rotation nobody runs is not a
   rotation.
3. **approval links + ask expiry** (3) - small, closes an unbounded inbox,
   and reuses token discipline that already exists.
4. **people adapter** (9) - one calendar reader turns the whole ingest path
   from "tested" into "used".
5. **traces export** (5) and **persona export** (7) - both are routes over
   facades that already compose the answer.
6. **service rules** (2) - the largest of these, and the one that makes egress
   reviewable instead of implicit.
7. **hop-limit honesty** (8) - either enforce or delete; it is a small change
   and it removes a declared guarantee that does not exist.
8. **owner auth** (1) - blocked on your decision, not on code.
9. **connector waves + live oauth** - each is an oauth registration and an
   adapter, not an architectural question.
