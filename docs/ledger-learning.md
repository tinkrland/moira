# how the ledger learns: a spec written without live keys

written 2026-11-14. spec, not a report. nothing in here is built yet, and every
claim about the present tense carries a file so it can be checked.

the gap it closes is `docs/gaps.md` item 10: `src/core/ledger.js` says in its own
header that "provider usage polling and billing-mail extraction are
connector-fed and arrive as owner-confirmed proposals", and neither exists.
`add()` takes a manual spec, `spend()` meters what moira itself routes, and
`alerts()`/`runway()` compute from dates already stored. there is no poller, no
mailbox reader, and no proposal type for "your trial ends in three days".

this document is deliberately written **before** any provider account exists.
the reason is not caution for its own sake: a poller written against a live key
encodes one account's quirks and calls them the provider's contract. writing the
shape first means the first live key is a *test* of the spec rather than its
author.

---

## 1. what the ledger can honestly claim today

| claim | where | true? |
|---|---|---|
| an account can be added with limits, expiry, conversion and cancel-by dates | `ledger.add` (`src/core/ledger.js`) | yes |
| what moira routes itself is metered | `ledger.spend` | yes |
| alerts fire at t-7 and t-2 from stored dates | `ledger.alerts` (`ALERT_WINDOWS`) | yes, from dates only |
| an owner can mark an account unmetered on purpose | `add({ unmetered: true })` | yes |
| usage against a provider is known | nowhere | **no** |
| a trial that ends without the owner telling moira | nowhere | **no** |
| burn rate is learned | `rankFor(burnRateFraction)` takes it as an argument | **no**, nothing supplies it |

so the ledger is a well-formed record of what the owner **declared**, and
nothing it **observed**. that distinction is the spine of this spec: declared
facts are authoritative and cheap; observed facts are cheap to get wrong, and
are the only place a proposal is needed.

---

## 2. three sources, and what each can prove

**source A: moira's own metering.** every call moira routes through the router is
already counted. this stays the most authoritative source for spend, because it
needs no provider and no key. nothing in this spec may displace it.

**source B: provider usage endpoints.** a provider that exposes usage (credits
remaining, tokens this period, spend to date) can be read on a schedule. what it
can prove: **usage against one account, per period**, as the provider states it.
what it cannot prove: what the owner intends, whether the account still exists
after the reading, or whether a number is money or credits (many providers
report both and label neither consistently).

**source C: billing mail.** a mailbox is the only source that sees *changes*: a
price rise, a trial ending, a subscription cancelled, a card declined. what it
can prove: **an event the provider told the owner about**, with the mail's own
date and sender. what it cannot prove: current balance, or anything about an
account whose mail never arrives (transactional mail lands in spam, and "no
mail" is not "no change").

the three compose in one direction only: A beats B beats C for *spend numbers*,
C beats B beats A for *events*. a spec that ranked them in a single order would
be wrong in one of those two directions.

---

## 3. the proposal object

one shape for everything learned, whether observed or extrapolated:

```js
{
  id: 'prop_…',
  kind: 'usage_reading' | 'event' | 'trial_ending' | 'price_change' | 'exhausted',
  accountId,                 // the ledger account this speaks about
  personaId,                 // denormalised for the inbox, never for policy
  source: 'metered' | 'provider' | 'mail',
  provider: 'anthropic',     // the connector or sender that produced it
  confidence: 1 | 2 | 3,     // see §4
  observedAt,                // when the reading was taken
  covers: { from, to },      // the period the statement is about (null for events)
  payload: {…},              // kind-specific, documented below
  evidence: {                // what a person could check by hand
    ref: 'usage-endpoint' | 'invoice-mail',
    subject: 'Your receipt',
    digest: 'sha256:…'       // of the bytes read, so the same mail is the same proposal
  },
  state: 'pending' | 'confirmed' | 'dismissed' | 'superseded',
  decidedAt, decidedBy: 'owner'
}
```

three rules that make this object safe rather than merely descriptive:

1. **a proposal never edits an account.** it is a claim beside the record.
   confirming it writes; that is the only path from observation to ledger. the
   same discipline as `request_access` → `approve`, and for the same reason: an
   observation that could edit a limit would let a mail server change a spending
   cap.
2. **the same reading twice is one proposal.** identity is
   `(accountId, kind, source, covers.from, covers.to)` for readings and
   `(accountId, kind, evidence.digest)` for events. seeing the invoice again is
   not news, and a poller that re-ran on restart must not double the inbox.
3. **supersession, not amendment.** a newer reading of the same period makes the
   older one `superseded` rather than deleting it. the history of what the
   provider said, and when, is part of the ledger's value.

### payload per kind

- `usage_reading`: `{ remaining, limit, unit: 'usd' | 'credits' | 'tokens', periodEndsAt }`.
  missing fields stay missing. never derive `remaining` as `limit` minus
  something moira counted: moira's count is source A and may cover a different
  period.
- `event`: `{ summary, providerSaidAt, amount?, currency? }`.
- `trial_ending`: `{ endsAt, convertsToPaidAt, amount? }`.
- `price_change`: `{ from, to, currency, effectiveAt }`.
- `exhausted`: `{ at, which: 'credits' | 'limit' }`.

---

## 4. confidence, and what each tier is allowed to do

three tiers. the numbers are **not** probabilities and are never shown to anyone
as a percentage.

| tier | means | the ledger may | the ledger may not |
|---|---|---|---|
| 3 · stated | the provider said it, in a machine-readable field, for this account | pre-fill a confirmation; count it in `runway()` as estimated, and say so | change a limit, drive an irreversible action, silence an alert |
| 2 · parsed | a person reading the evidence would agree (an invoice line, a usage page) | the same, and show the extracted sentence beside the number | the same |
| 1 · guessed | inferred from something adjacent (a "welcome to your trial" mail with no date) | appear in the inbox as a question, "is this right?" | count in `runway()` at all, or pre-fill anything |

**the one irreversible action in this area is a spend-cap change**, and no tier
performs it. confirmation is always a person's click, and the confirm reads back
what it will write, in words.

---

## 5. the polling contract

not a daemon. the rotation sweep already chose the alternative: a clock the host
runs (`scripts/sweep.mjs`). polling follows the same discipline, because a
library that starts timers fights its host's shutdown.

```
ledgerPoll({ accountId?, source: 'auto', now })
  → { polled: n, proposals: [ids], skipped: [{ accountId, reason }] }
```

- **who calls it.** a host, or `scripts/poll.mjs` on a cron, with the same receipt
  discipline as the sweep.
- **cadence.** per account, `policy.pollEveryMs`, default 6h for usage and 24h for
  mail. a minimum interval, not a promise: two calls inside the window return
  `skipped: ['too_soon']` and cost nothing.
- **single flight.** two concurrent polls of one account must not both read. a
  soft claim record (`pollClaims`) with a five-minute ceiling, released on finish
  or expiry. a claim that is never released must expire, or a crashed poll stops
  the account forever.
- **backoff.** on a provider error, `nextPollAt` doubles from the interval up to
  24h and resets on the first success. an error is **never** recorded as a
  reading: "could not look" must not read as "found nothing", the rule the people
  feeders already follow.
- **ordering.** proposals carry `observedAt` from the provider where it exists,
  and from the poll clock otherwise. the inbox orders by `observedAt`, not by
  insertion, because a mail can arrive describing last week.
- **idempotency.** the identity rules in §3 are the whole mechanism. a poller
  re-running after a crash writes the same proposal ids and changes nothing else.
- **budget.** one outbound call per account per source. the poller stops a run
  after `maxPolls` (default 20) and reports what it did not reach, rather than
  silently truncating.

---

## 6. credentials: the poller never holds a key

this is the part that must not be improvised. a poller reading a usage endpoint
is an outbound call like any other, so it goes through the mechanisms already
built rather than around them:

1. **a connector identity, sealed.** the credential lives where every connector
   credential lives (`hub.authorize`), sealed under the persona key; the poller
   receives a lease, never the value.
2. **a service rule.** the endpoint the poller may call is declared by the owner
   as host + path glob + methods, and the call is refused at the socket if it is
   not declared. a poller that grows a second endpoint without a rule fails
   loudly rather than quietly widening.
3. **a capability label.** `usage:read` on the identity, so a poller cannot borrow
   a token that also has write power. the least-capable-credential rule in
   `src/connectors/hub.js` applies unchanged.
4. **a receipt per poll:** `actor: 'host'`, `op: 'ledger'`, reason
   `poll:<provider>:<source>`, content-free: counts and account ids, never
   balances, never mail text.

billing mail is the sharper case and gets a narrower rule: the reader may have
`gmail.metadata` (headers only) **plus** the body of messages matching a declared
invoice query. it may not list a mailbox, may not read a thread, and may not store
a mail body anywhere: the digest and the extracted sentence are the record, and
the mail stays in the mailbox where the owner can read it.

---

## 7. what "no live keys" means, concretely

three artefacts, and the third is the one people skip:

1. **contract fixtures.** one JSON per provider, copied from that provider's
   *documented* response, stored under `docs/fixtures/ledger/<provider>.json` with
   the doc url and the date read in a header comment. the adapter is written
   against them. exactly what the file adapters did, with the honest label that
   goes with it: *exercised against documented shape, never against a live
   account.*
2. **a probe the owner can run.** `node scripts/probe-ledger.mjs <accountId>` with
   the owner's own identity: one call, printed verbatim, proposing nothing. its job
   is to answer "does the documented shape match what my account actually
   returns?" without any of it entering the store. the first live key should
   change *fixtures*, and only then adapters.
3. **a verification ledger.** `docs/verified.md` gets a row per integration:
   `provider | shape matches live? | checked on | by whom`. until a row says yes,
   every sentence about that provider says "fixture-verified" and no more. this
   is the rule the file adapters already carry in a header comment, made into a
   page, because a comment is easy to stop reading.

**what this spec explicitly does not claim:** that any provider's usage endpoint
returns anything in particular. the shapes are named as *expected* in the
fixtures, and the fixtures are the thing under test.

---

## 8. the burn rate, and what learning it requires

`rankFor` takes `burnRateFraction`; nothing supplies it. the honest source is
**spend moira metered itself** (source A), not provider polls:

```
burnRateFraction(accountId) = metered spend over the window / limit, window = period
```

guards, because a naive version is worse than none:

- fewer than three distinct metering days in the period → return `null`, and the
  router treats null as unknown, never as zero (it already refuses on unknown
  budget; this keeps that behaviour).
- a poll reading may *corroborate* a burn rate but may not set one: the provider
  knows usage, not what the owner is likely to spend it on.
- the number is stored per `(accountId, periodKey)` so a period boundary resets it
  without arithmetic. no rolling average, because a rolling average hides the
  spike a cap exists to catch.

---

## 9. acceptance tests, named before they are written

each fails first, per the standing rule.

```
ledger-learning: a documented shape produces a proposal, and no account changes
ledger-learning: the same reading twice is one proposal, and the newer supersedes the older
ledger-learning: "could not look" is an error, never a reading
ledger-learning: a tier-1 guess cannot reach runway() and cannot pre-fill a cap
ledger-learning: no tier changes a spend cap, and confirmation names what it will write
ledger-learning: a poll refuses when no service rule declares the endpoint
ledger-learning: a poll uses the least capable credential, and a write-capable token is refused
ledger-learning: two concurrent polls of one account: one reads, one skips
ledger-learning: a crashed poll's claim expires instead of stopping the account forever
ledger-learning: a mail reader that lists a mailbox is refused, and no mail body is stored
ledger-learning: burn rate returns null under three metering days, never zero
ledger-learning: poll receipts are content-free (no balance, no subject, no address)
```

---

## 10. decisions this spec needs from the owner

1. **which provider first.** one, chosen because the owner actually pays for it.
   the second is a different project: every provider's usage page is its own
   negotiation.
2. **mail: separate pass or same one?** this spec assumes a second, narrower
   connector pass (`gmail`) for mail extraction, because a usage pass and a mailbox
   pass should not be the same grant.
3. **does a tier-3 reading silence a t-7 alert?** the spec says no: an alert is
   the owner's reminder, and a reading that says "you already know" argues for a
   *different* alert, not for silencing this one. arguable, and cheap to flip.
4. **how long to keep proposals.** assumed 90 days, then dismissed, then nothing:
   an inbox that grows forever stops being read.

---

## 11. build order, once a key exists

1. `docs/fixtures/` for the chosen provider, the adapter, the proposal write.
2. `ledgerPoll` with claims, backoff and receipts (no mail yet).
3. the inbox surface: proposals in the panel beside the asks, each with its
   evidence sentence and a confirm that reads back what it writes.
4. burn rate from metering only.
5. mail extraction, with the narrow pass, as its own wave.
6. `scripts/poll.mjs`, so a host can cron it like `scripts/sweep.mjs`.

the order matters: steps 1–3 are provable with no key at all, and step 5 is the
only one that genuinely waits on the owner's mailbox.
