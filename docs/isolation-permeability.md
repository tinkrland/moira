# isolation, and deliberate permeability

two forces, one design. personas are isolated by default, and the ways
context crosses between them (or out to an agent) are explicit, narrow, and
revocable. "lending, not handing over" is the whole grammar.

## the hard walls (isolation)

- **per-persona keys.** every persona's vault is sealed under its own key.
  a fact, a capture, a voice corpus physically cannot open for another
  persona without a re-seal through an authorized path.
- **`personasAllowed`.** an agent registered for one persona can never
  reach another, whatever pass it holds.
- **heteronyms never inherit.** a heteronymous persona gets no core facts,
  no shared core, and its canon refuses to leave. there is no bridge it can
  be dragged across.
- **crypto shedding.** freezing a persona stops activity without destroying
  anything; deletion shreds the key and the records with it.

## the permeable parts (by design, not by accident)

| path | what crosses | the limit |
|---|---|---|
| **pass grants** | one category, one purpose, one duration, optionally one set slice, optionally named fields (`preferences.writing_style`) | never widens; expires; can be one-time; revoked on next read; an address can never leave its category |
| **sets** | named slices (work, side projects) spanning stack, ai tools, facts and the vault, one vocabulary everywhere | scoped at connection time; setless entries are excluded from a scoped pass; removing a set untags its holders and deletes nothing |
| **core** | facts a linked persona promotes to the shared core | promote/demote are audited; heteronyms never see core |
| **bridges** | two-sided sharing between personas | privacy budget, most-restrictive taint wins, both sides declared |
| **handoffs / packs** | a strict, pre-declared bundle to a named recipient agent | rung is the strict deal; one-time; expires |
| **people** | one address book; a relationship is (person, persona) with circles + importance + note | a `people` pass serves only that persona's people, sliced by its circles; notes need a full-rung pass; importance never inherits across personas; a human unknown to a persona is invisible there |
| **directed disclosure** | selected addressed fields delivered once to one exact https destination | owner-approved; delivered server-to-server; the app only ever sees status + a signed attestation, never values; a failure is a failure, not a retry loop |
| **switching** | moving an agent between personas | owner approves, teardown is explicit, the old context does not follow silently |
| **ingress allow** | letting another persona's content in | owner-allowlisted pairwise; not global |

## what the surface enforces (2026-10-29 build)

the browser surface renders the walls and the lending side by side:

- **isolation is the default state**: a card says "nobody yet" until a
  pass exists, and the bar says "nothing is shared by default".
- **no indefinite access**: a "permanent" grant is a *standing* pass. it is
  marked, it expires at 90 days (`STANDING_PASS_MAX_MS`), and renewal is
  the owner's hand, not a refresh.
- **no implicit full access**: an unscoped grant is the whole hat. the api
  refuses it (`full_scope_requires_acknowledgement`) unless the owner
  explicitly ticks the acknowledgement; the pass records `scope: 'full'`
  and the card paints it in warning color. scoped grants record
  `scope: 'sets'` with their slices.
- **every grant is receipted**, content-free, and revocation is one call
  (or freeze the persona, which declines everything without destroying).

## two kinds of leak (since 2026-10-31)

they need different answers, and conflating them is how a system ends up
claiming a defence it does not have.

**direct leakage** is a *serving bug*: content crosses a boundary the pass does
not cover - the wrong category, a set outside the slice, a rung above
`maxRung`, an address the pass never named, a persona the client may not read.
it must never happen. because the serve path and the checker would otherwise be
the same code agreeing with itself, `checkServedAgainstPass` re-derives every
constraint from the *pass record* and is deliberately independent of
`facts.serve`. `owner.leakageGrade({personaId, clientId})` returns it as
`direct: []`. an empty list is a real assertion; a non-empty one is a bug with
the offending pass named.

**inferred leakage** is *not* a bug. every served fact was served legally and
the withheld thing is still reconstructible from the set of them. no permission
check catches it, so it gets measurement and, at most, an explicit mitigation:

- measured: `inferred` in the same grade, plus `leakageAudit` with its
  `rung_gap` / `slice_gap` / `cross_persona` findings and scores.
- **effort, not just overlap.** how inferable something is depends on how much
  someone is *looking*: a colleague skimming one summary and an agent that
  ingests everything and diffs it are not the same adversary, and the gap is
  attention, not permission. so every finding carries `minObservations` - the
  size of the smallest set of served facts that must be read and **combined** -
  with a `tier` (`glance` = 1 read, `attentive` = 2-3, `exhaustive` = 4+).
  `observationBudget` filters to one assumed reader: findings above it move to
  `latent` with `latentReason: 'above_budget'` rather than vanishing. the cover
  is greedy, so it is an upper bound on parsimony - stated in `method`, never
  implied optimal. this also closed a real blind spot: two served facts at 0.5
  each, union 1.0, previously scored below threshold and reported *nothing*,
  while an attentive observer saw the whole thing.
- mitigated, opt-in per persona: the **inference guard**
  (`owner.setInferenceGuard({personaId, mode})`, `off` by default). when a
  served fact collides with a withheld one above threshold, it degrades to its
  `exists` rung - "there is a note in <category>" - and says so: the response
  carries `coarsened: [{factId, reason, score}]` and a `coarsened_inference`
  receipt is written. it removes the material being inferred from. it does not
  stop inference, and nothing here will claim it does.

direct is enforced; inferred is measured, and coarsened only when the owner
asks. surface: `GET /api/leakage/grade`, `POST /api/leakage/guard`, and the mode
selector under the inference check in the detail panel.

### the coarsest giveaway is not inference at all

a profile picture, a display name, a bio deanonymise a persona in one glance.
no token overlap, no combination of reads, nothing for this audit to measure -
which is exactly why it is worth stating what is served rather than trusting
that nobody widened it.

current truth, pinned by `test/identity-giveaway.test.js`:

- no avatar or photo field exists on a persona.
- a bio (`characterSheet`) exists on heteronymous personas and is **never**
  served to a client.
- `email` is owner-side only (the card face). it is not client-facing.
- the display **name** is served, deliberately: it is the handle an agent
  addresses, and for a pseudonymous persona it is the pseudonym, not the
  linked identity's real name.
- the client-facing persona block is a closed set - `name`, `identity`,
  `storage`, `sub` - so adding a field is a decision, not a spread operator
  away. `sub` is the per-client subject, derived, never the record id.

## inference is not retrieval (measured since 2026-10-31)

every wall in this document governs *retrieval*. none of them governs
*inference*, and that is the honest hole: a pass that blocks a fact can still
leave it reconstructible from what it allows. `owner.leakageAudit({personaId,
clientId})` measures that instead of claiming it away - deterministic, no
model: normalize both sides to distinctive tokens (stopwords dropped, length
>= 3), score containment of the withheld text inside the served text, flag at
0.6 (the threshold is printed on every finding).

three finding kinds: `rung_gap` (a served rung reproduces the same fact's
fuller rung), `slice_gap` (a withheld fact is reconstructible from a served
one in the same persona - wrong set, off scope), `cross_persona` (content that
was served also exists under a persona this client cannot read - isolation
failing in practice, not on paper). the report carries ids, categories, kinds
and scores, never content, because a leak report that quotes the secret is
itself a leak. it names its caveats too: vault payloads and people notes are
not served as facts and are out of scope, and text overlap does not model
common knowledge.

a detector, not a fix. the fix is the owner's: narrow the pass, split the
fact, or accept the leak knowingly.

## outbound targets are judged, not trusted (2026-10-31)

isolation governs what leaves; it says nothing about *where it goes*. any
outbound call moira makes on a persona's behalf runs through
`src/util/netguard.js` first:

- ip literals are judged directly (no resolver to fool)
- a name is resolved, and **every** returned address is judged - any private
  or metadata address blocks the destination (the DNS-rebinding shape)
- cloud metadata (`169.254.169.254`, `fd00:ec2::254`) is blocked even when
  the operator allowlists it; there is no legitimate POST of persona fields
  into IMDS
- loopback, RFC-1918, link-local, CGNAT and ULA are blocked unless
  `allowPrivate`, and `allowlist` CIDRs/hosts can open narrow holes
- anything that does not resolve fails closed

knobs live on the gateway (`new Moira({ netguard: { allowPrivate, allowlist,
resolve } })`). this closes a gap the agent-vault read exposed: directed
disclosure validated `https://` and stopped there, so a delivery endpoint that
resolved inward was an exfiltration gadget with our own feature's name on it.

## the rule of thumb

default to the narrowest slice that does the job, name it, and let it
expire. if a persona needs to be reachable forever, that is a series of
decisions the owner makes, not one permission that never ends.
