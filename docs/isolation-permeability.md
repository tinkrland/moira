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

## the rule of thumb

default to the narrowest slice that does the job, name it, and let it
expire. if a persona needs to be reachable forever, that is a series of
decisions the owner makes, not one permission that never ends.
