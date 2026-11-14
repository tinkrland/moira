# the id card: what a persona card is, what it may show, and where the logo goes

written 2026-11-14. this is the design contract for the card as the *identity
artifact* - the thing the owner actually holds and turns over - as opposed to the
detail panel behind it. it strengthens the `card-kit` line's premise without
making main depend on it.

**branch note, stated first because it is a standing rule:** `main`, `evie` and
`viola` are decoupled, and `card-kit` is the frontend line. main does not import
card-kit and card-kit does not import main. this document is a *contract* both
can be measured against; it is not a dependency between them. everything here is
described twice where it matters: once as the anatomy, once as the selector or
field that already exists in `ui/` (the vanilla compile that ships) or in
`card-kit/` (the react reference that is parked).

---

## 1. what the card is, in one sentence

a card is **one persona's identity on the front and that persona's consent state
on the back**, flippable, where the back is not a settings page but the answer to
"who can read this and what could they work out instead".

three things the card is *not*:

- not a dashboard. it never shows a fact. it shows the **shape** of what exists
  (counts, categories, sets, rungs) because the card is held in front of other
  people and a dashboard leaks by being looked at.
- not an account switcher. switching persona swaps the whole active context
  (`card-kit/data/personas.ts` says it plainly: "switching swaps the whole active
  context, never blends"). the card is what you see after the swap, not the swap.
- not a badge of authenticity. nothing on a card proves the persona is the owner;
  that is `linked` vs `pseudonymous` vs `heteronymous`, and it is a *claim the
  owner makes*, declared at create time and shown as a kind line, not a seal.

---

## 2. one anatomy, two surfaces

the same card, described in the shipped vanilla surface and in the parked react
kit. the mapping is the contract: if a change lands in one and cannot be named in
the other, it is not part of the card yet.

| anatomy | `ui/` (ships) | `card-kit/` (parked) | data |
|---|---|---|---|
| the card itself | `.card` with `.flip` inner, 1.58:1, `#1c1c1c → #0d0d0d`, Space Mono | `MoiraCardBuilder` (framer-motion, pointer tilt ±6°) | `GET /api/overview` → `personas[]` |
| front face | name, email, identity kind, accent ring | `CardData.front` | persona `name`, `email`, `identity` |
| back face | consent side: who can read, standing expiry, lend | `CardData.back` | `GET /api/persona?id` → `passes` |
| accent chips | `.chip.p1…p5` (`#d9a441`, `#7fa87a`, `#8f8ac9`, `#6fa5c9`, `#c98a8a`) | `accent: 'p1'…'p5'` per category | sets + fact categories |
| the detail panel | `detailSection()` × 14 | `MindmapPreview` radial sections | one owner endpoint each, §7 |
| the mark | `.brand .mark` in the header | kit chrome | `/app/logo-mark.png` |

noise, spotlight and the kit's flip easing `cubic-bezier(.34,1.56,.64,1)` at
`.7s` are pinned by tests in `ui/` so they cannot drift from the kit by accident.

---

## 3. the front: identity, and the shape of what exists

the front answers three questions and refuses the fourth:

1. **who is this** - name, handle/email, and the kind line: `linked · you, on the
   record`, `pseudonymous · a stable alias`, `heteronymous · a character`. the
   kind is not decoration. it decides what the back is allowed to claim (a
   heteronym can never inherit core context, so its card cannot show a "shared
   core" row at all).
2. **what is in here, in outline** - sections, not contents. a section is a
   category or a set with a count and a rung ceiling. `preferences · 7 notes ·
   up to full` is honest; the seven notes are not on the card.
3. **how alive it is** - last activity, and whether anything is pending (an ask
   waiting, a proposal waiting). pending things are the reason to flip.

the fourth question, "what does it say", is refused on the front face by design:
the front is the side that can be shown to someone.

### sectioning rule

a section is **derived, never authored**. sections come from three existing
sources and nothing else:

- **categories** - the vocabulary facts already use (`preferences`, `work`,
  `health`, `people`, `stack`, `ai`, `vault` …).
- **sets** - named groupings that span facts, stack, ai tools and vault items
  (`work = supabase + firecrawl + the deployment notes`). sets are implicit: they
  exist because entries reference them (`src/core/sets.js`).
- **rung ceiling per section** - the highest rung anything in that section can
  serve at. this is what makes a section read as "shallow" or "deep" rather than
  "big" or "small".

a hand-authored section (a free-text label someone types on the card) is not in
this spec. it would be a fourth taxonomy competing with the three that already
enforce something.

---

## 4. isolation vs sharing vs inference: three columns, never one number

this is the part the card has to get right, because it is the part people
misread. **isolation and sharing are not two ends of one slider.** they are
different questions with different mechanisms, and a card that shows one "shared:
40%" bar is lying by aggregation.

the back of the card carries three columns:

### 4.1 exists (isolation)

what is in this persona at all. guaranteed structurally, not by policy:

- every persona has its own key (`KeyService.personaKey` → `deriveKey` per
  category), so a store dump holds ciphertext per hat.
- an agent can only reach a persona listed in its `personasAllowed` wall, and
  that wall is checked before any service is consulted.
- a heteronym never inherits core context, forced at create and guarded at serve.
- shredding a persona deletes its facts and accounts, revokes bridges, packs and
  leases, and shreds the key.

card line: `exists · 7 sections · 41 notes · sealed`. the word "sealed" is a
mechanism, not a mood: it means the store holds no plaintext for this hat.

### 4.2 shared (permeability, and it is always a slice)

sharing in moira never moves data. it narrows **one read** to a scope:

- **a pass** = categories + optional sets + optional field addresses + rung +
  purpose + duration (+ uses). a scoped pass sees exactly its sets and excludes
  unfiled facts; a fields-addressed pass cannot match a fact that never authored
  that address.
- **a bridge** moves facts between two personas with a budget and taint rules.
- **a pack / handoff / directed disclosure** is a one-shot object with a rung
  ceiling and an outcome.
- **a room** is shared memory that is explicitly *not* a shared persona: it never
  mints a fact and never carries importance, interaction or circles.
- **a standing rule** is pre-consent for a shape the owner has already answered
  three times.

so the card's shared column is a **list of readers**, not a percentage:

```
shared
  planner (agent · verified)   preferences [work]   summary   session · 4h left
  the studio (room)            counts only · 3 items
  dave (person)                delivery unopened
```

every row names a reader, a slice, a rung and an end. a row without an end is a
standing pass and says `standing · 90d max`, because nothing here is indefinite.

### 4.3 inferable (the part that is nobody's fault and everybody's risk)

a pass blocks retrieval, not inference. the card states what an agent could work
out from the slice it was given:

```
inferable
  planner: 2 sections collide with withheld notes (threshold 0.6)
  grade: no direct leaks · 2 inference risks
```

this comes from `leakageGrade` and the per-persona `inferenceGuard`
(`off` / `coarsen`). the card must never render this column as a score out of
100, and must never fold it into the shared column: one is what you granted, the
other is what could be reconstructed from the grant. keeping them apart is the
whole point of the third column.

**the rule the card enforces in one line: a reader who is not in the shared
column is not in the inferable column either, because it was never served
anything to collide with.** if that sentence stops being true, the card is
wrong before the engine is.

---

## 5. the logo: chrome, not content

the mark is `logo.png` (1024×1024 RGBA, canonical, repo root). two renders ship
with it: `ui/logo-mark.png` (128, header and favicon) and `ui/logo-256.png` (256,
`og:image` and `apple-touch-icon`). all three are served by the transport at
`/app/logo.png`, `/app/logo-mark.png`, `/app/logo-256.png` and pinned by
`test/app-surface.test.js` (status, `image/png`, PNG magic bytes).

**the placement rule, and the reason for it:** the mark identifies **moira**, so
it belongs to the chrome and never to the persona. on the card:

| surface | mark? | why |
|---|---|---|
| header brand (`.brand` + `.mark`, 26px) | yes | it is the product's letterhead |
| card **front** face | **no** | the front is the persona's identity; a product mark there reads as their avatar or their endorsement of us |
| card **back** (consent side) footer, 14px | yes | the back is a product surface: it is moira telling you what moira will do |
| detail panel header | yes, 16px | same letterhead argument |
| heteronym card, either face | back only | the character is fiction, and the fiction should not have to carry our brand on its face |

mechanics, so no one has to guess:

- **clear space** = 25% of the mark's width on all four sides. the shape is a
  plant in a ring and it needs air or it reads as a smudge.
- **minimum sizes** 20px in the header (current 26px), 14px on the card back,
  32px for the touch icon. below 20px alone, the fine stems go; pair it with the
  wordmark or drop it.
- **one shadow, not two.** `.mark` already carries
  `drop-shadow(0 0 8px rgba(111,165,201,.28))`. do not add a glow, a gradient, a
  bevel or an outline on top of that.
- **no recolour, no stretch.** there is no monochrome or light-background variant
  in the repo yet. on a light surface, put the mark on the existing dark chip
  (`#121212`, rounded), do not invert it. if a light variant is ever drawn it is a
  new asset with its own test, not a CSS `filter`.
- **never the 663KB canonical on a page.** it exists to be the source of the two
  renders.
- **never in the flip's content layer.** the mark lives in chrome so it does not
  rotate, tilt with the pointer, or pick up the spotlight.

---

## 6. states a card must be able to be in

a card that only has one state is a picture, not an instrument. six, each with
its own words:

| state | front | back |
|---|---|---|
| **empty** (new hat) | name, kind, `nothing yet` | `nobody can read this · nothing is shared by default` |
| **populated** | sections with counts | the three columns |
| **frozen** | frosted, `frozen · no new access` | `thaw to resume`; existing passes shown but marked `inert` |
| **shredded** | `shredded · key destroyed` | `the receipts remain, content-free` |
| **heteronym** | kind line forces `no shared core` | disclosure mode + red lines from the character sheet |
| **waiting** | a pending marker with a count | the ask/proposal, with the link or the panel as the two ways to answer |

the frozen state matters more than it looks: `personas.locked` already makes
writes fail closed, and a card that still looks live while nothing can be written
would teach the owner to distrust the whole surface.

---

## 7. data binding: every card field names its source

no card field may be computed by the surface. if a number is on the card, an
owner endpoint produced it.

| card field | endpoint | field |
|---|---|---|
| name, email, kind, accent | `GET /api/overview` | `personas[]` |
| sections + counts + rung ceiling | `GET /api/persona?id` | `facts` (grouped), `sets`, `stack`, `ai` |
| shared rows | `GET /api/persona?id` | `passes[]` (+ `connections`, `rooms` when present) |
| inferable column | `GET /api/leakage/grade` | `{direct, inferred, verdict}` |
| guard mode | `GET /api/persona?id` | `persona.inferenceGuard` |
| pending count | `GET /api/requests` | `requests[]` |
| service rules (egress) | `GET /api/service-rules` | `rules[]` |
| control state | `GET /api/persona?id` | `persona.status` |

the panel already fails this in one direction and it is worth naming: it renders
a section per concern rather than per card face, so the card's three-column back
is currently *fourteen* sections deep in a drawer. the card is the summary; the
drawer is the evidence. keeping that split explicit is what stops the card from
becoming a dashboard one feature at a time.

---

## 8. what a card must never show (each one pinned by a test when it lands)

- a fact's content, on either face.
- an avatar or a photograph. there is no such field on a persona, and the mark is
  not a substitute for one.
- a bio on a non-heteronym: `characterSheet` is stored only for heteronyms and is
  never served to a client.
- a single "shared" percentage. three columns, or nothing.
- an inference figure as a probability or a score out of 100.
- a pass row with no end, without the word `standing`.
- the raw token of an approval link, a connect code, or a credential fingerprint.

---

## 9. what the card-kit line has to gain to meet this contract

not a rewrite, four additions, in this order:

1. **the third column.** `CardData.back` needs `inferable`, fed by the leakage
   grade. without it the kit shows what you granted and hides what it implies.
2. **a state field.** `front`/`back` are labels today; they need `state:
   empty | populated | frozen | shredded | heteronym | waiting` so the kit can
   render §6 rather than inventing its own language.
3. **the mark in chrome.** the kit's card is currently a single component, so
   there is no chrome layer for the header mark to live in. that layer is the
   structural change, and it is the one that keeps §5 true.
4. **the binding table as types.** §7 as a `CardSource` type, so a field that has
   no endpoint cannot be added without noticing.

and one thing the kit already gets right that `ui/` should not lose: the front
face is a *card*, not a panel. everything the panel adds has to earn its place on
a surface that was designed to be flipped, not scrolled.

---

## 10. open questions for the owner

1. **does the front face ever show a count of what is withheld?** honest, and it
   leaks the existence of a section to anyone looking. this spec says no.
2. **should the back expire visibly?** a pass whose row shows `4h left` invites
   the owner to watch a clock. the alternative is `today` / `this week`. finer
   grain is more honest and more anxious.
3. **is the wordmark load-bearing?** the header currently pairs mark + wordmark;
   the card back has room for the mark only. if the wordmark is part of the
   identity, the card back needs a 20px variant of it.
