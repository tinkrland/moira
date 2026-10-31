# the sandbox problem, answered in two halves

mapped against memorium's framing (research/the-sandbox-problem): isolation is
the declarative easy half, orchestration and coordination across boundaries are
the behavioral hard half. this doc states what moira actually does in each, with
the file that does it, and names the two places where moira is thin rather than
implying coverage it does not have.

## half one: isolation (declarative, fails closed)

| wall | how | where |
| --- | --- | --- |
| per-persona keys | every persona gets its own key; facts and vault payloads are sealed under `category:<cat>` subkeys derived from it. reading persona B's rows with A's key yields ciphertext | `src/core/keyservice.js` (personaKey, deriveKey) |
| shred | deleting a persona destroys its wrapped key; ciphertext without a key is a locked read, never "no memories" | keyservice wrap/unwrap, `facts.open` locked branch |
| agent scope wall | an agent only reaches personas in its `personasAllowed` list; anything else is refused before any service is called | `src/core/agents.js:106` |
| heteronym core ban | heteronyms are forced `inheritsCore: false` at create and update; serve guards it again because the core is the one place a boundary could silently widen | `src/core/personas.js`, `facts.serve` |
| kill switch | a frozen persona declines writes and agent reads | `personas.locked`, enforced in `policy.js`, `router.js`, `bridges.js` and the fact write path |
| fail closed | no pass means `approval_required`, not content; unknown budget means `unknown`, not unlimited; a missing vault key is `unavailable`, not empty | 28 `approval_required` occurrences across the suite, incl. the golden conformance tests |
| inference across the wall | nothing in a pass prevents reconstruction, so leakage is *measured* instead: rung_gap, slice_gap, cross_persona with containment scores and printed threshold | `src/core/leakage.js` |

isolation is verifiable by inspection: every row above is a static rule checked
at read time, and each has a failing-test-first regression behind it.

## half two: permeability (declarative, narrow by default)

permeability is not the absence of walls, it is the set of gates. all of them
are owner-minted, receipted, and bounded:

- **passes** carry category, sets, fields, rung, purpose, duration, uses. an
  unscoped grant is refused unless the owner explicitly acknowledges full scope
  (`full_scope_requires_acknowledgement`), `permanent` means standing with a
  90-day cap (`STANDING_PASS_MAX_MS`), and every pass records `scope: sets|full`.
- **narrowing only** for app-initiated asks: an approval may shorten duration,
  lower the rung, or cut sets/fields; anything widening returns
  `edits_widen_the_request` (`src/core/requests.js`).
- **bridges** are two-sided, runged, purposed, expiring, carry a per-pair
  privacy budget and taint algebra (most-restrictive-wins across linkability,
  allowedPurposes, relevance duration).
- **directed disclosure** posts selected fields to one exact https destination,
  once, with a signed attestation and a content-free status back; failure is
  terminal rather than retried into a leak.
- **ingress allowlists** gate what may flow *into* a persona; pseudonymous
  personas default to deny plus strip-linkable, and linkable facts never cross
  into them.

## where moira is thin (named, not hidden)

**1. no orchestrator, so no privileged sandbox.** memorium asks who orchestrates
the orchestrator. moira's answer is structural: there is no coordinator. agents
are flat clients holding passes, the owner surface is the only authority, and
that authority is minted per request (`OwnerContext` is not constructible from a
plain object). the cost is that moira cannot run multi-step work on its own; the
benefit is there is no above-the-sandbox role to constrain.

**2. no shared mutable state, so no stale shared nodes.** bridges are
read-through and imports create a *new* fact in the destination carrying
provenance and inherited taint (`bridges.importPropose`). two personas cannot
hold competing versions of one shared record because there is no shared record.
the cost is duplication; the benefit is that "which write wins" cannot arise.

**3. the action log is not yet a chain.** receipts are append-only and
content-free, and they answer "who saw what" (actor, personaId, op, categories,
rung, factCount, bridge/pack/handoff ids, reason, amount). they do not yet
answer memorium's sharper question: "who did what, on whose behalf, in what
order, with what outcome." there is no correlation id stitching one unit of
delegated work across several receipts, so ordering is timestamp-only and
"on whose behalf" is inferable rather than recorded. this is the real gap in the
second half and it is a feature, not a bug report: a trace id on receipts plus
an owner-side trace export would close it.

**4. concurrency is atomic per record, not transactional across a crossing.**
writes go through CAS (`moira_cas_update` on hosted, `store.update` locally), so
no torn records. a crossing that touches two personas is two atomic writes, not
one transaction. today that is safe because crossings are read-through or
one-shot (disclosure delivers once, packs are strict-rung handoffs), but a
future multi-step crossing would need the transactional boundary memorium
describes.

## the honest summary

isolation: enforced, fails closed, and measured for the inference it cannot
prevent. permeability: single-vocabulary (categories, sets, fields, rungs,
purpose, duration, budget) with narrowing-only edits and expiry. coordination:
deliberately absent as an orchestrator, deliberately stateless across personas,
with the action-log-as-chain and transactional-crossing gaps named above and in
`docs/isolation-permeability.md`.
