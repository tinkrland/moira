# moira

you are one person, but you are not one profile. the student, the founder, the
character, the alter ego - each has its own context, and today every app
blends them into one gray mush. moira refuses to blend.

moira is a **context engine with personas**: one place where your context
lives, split into personas you fully control, shared only through explicit
consent, and fed from the apps and services each persona actually uses.

## the core ideas

**personas, not one profile.** a persona is one of your hats: its own memory,
its own keys, its own connectors, its own budget. personas never leak into
each other unless you build an explicit bridge. deleting a persona shreds
its keys - the deletion is real, not a flag flip.

**passes, not raw access.** when an app or agent wants context, it never gets
your keys. it gets a pass: scoped to one persona, one category, one purpose,
one duration. every read leaves a signed receipt you can audit.

**a bridge is consent on both ends.** sharing between two personas needs a
matching bridge AND explicit ingress on each side. no bridge means
"not available" - never a hint that anything exists.

**facts carry their provenance.** every memory is sealed and labeled (taint):
where it came from, how linkable it is, how long it stays relevant. labels
combine by most-restrictive-wins, so summaries cannot launder what a fact
really is.

**connectors feed personas on their own terms.** each persona connects its
own accounts; provider text is tagged untrusted at ingress and never becomes
a preference without your confirmation.

## the connector tree

connectors are organized by the job you want done - you approve the job, and
the providers under it are interchangeable:

```
knowledge          (what you know, make, and keep)
|__ retrieve your files      google drive, onedrive, dropbox, mega   [live]
|__ manage projects          linear, craft docs, notion
|__ plan your time           google calendar, notion calendar
|__ read & write            substack, medium (readers count too - a
|                             subscription history is this axis's main signal)
|__ tech & dev               onboarding opt-in: github, gitlab, bitbucket;
|                             design: figma, kittl, canva, penpot, balsamiq
|__ academia                 zotero, mendeley, semantic scholar; api-less
|                             sources join via export/webhook (ingest)
|__ people (later phase)    meetings (calendly, cal.com, z cal, granola),
|                             social media, networking, family + friends
|                             circles (soft tags - a friend tagged as
|                             family is fine). per-persona importance: how
|                             much someone matters can differ per persona.
|                             every persona is the real you; none is a role

ai tools           (what you build and how you work with machines)
|__ talk to assistants       chatgpt, claude, gemini, perplexity
|__ build apps               lovable, base44, bolt, v0
|__ code with agents         cursor, windsurf, claude code, github copilot
|__ work from specs          kiro, ibm bob

taste              (deliberate acts of taste - ingested, evie-gated)
|__ track books              goodreads, storygraph, fable, pagebound
|__ track film               letterboxd
|__ track tv                 serializd, tv time, repov
|__ track music              last.fm, stats.fm, musicboard, superfan
|__ read & write stories     ao3 (import), wattpad
|__ share taste              pi.fyi, tastify

lifestyle          (how you live and present - ingested)
|__ dress & shop             depop, ltk, pinterest, whering
|__ log your life            anylog, retro

utility            (plumbing)
|__ watch                    youtube
|__ places                   maps
|__ health                   health platforms
```

`[live]` means the adapter exists and is tested; everything else is
registered but not built yet (the status is explicit in the code - nothing
pretends to work). the taste block is the fuel line for **evie**, the
decoupled taste engine that lives on its own branch and activates only when
it does - moira's deterministic core never depends on it.

## how you use it

**two surfaces, one rule:** the agent surface (what an mcp server or app
calls) can never reach an owner action. the owner surface requires a minted
owner context - a poisoned agent cannot approve itself into anything.

```
# run the suite (offline, no network, no services)
npm test

# script the owner surface from the terminal
node cli.js personas list
node cli.js persona create --name founder --identity linked
node cli.js fact add --persona <id> --content "..." --category notes
```

for the story in plain words, start with `docs/about.md` and
`docs/explain.md`. for deployment, hosting, and the database, see `repo.md`
and `technobabble/journal.md`.

## modality

moira is designed to be reached the way you actually live:

- **browser first.** the primary experience is a web app: personas, passes,
  receipts, and connectors as visible, touchable things you manage directly.
- **command line native.** the cli is not a debug tool - it is a first-class
  surface. everything the owner can do is scriptable, and the same core runs
  behind it.
- **nfc tappable cards (potentially).** a persona as a physical card you tap
  to share context in person - the pass model (scope, purpose, duration,
  receipt) is exactly what a tap needs. deliberately still a "potentially":
  nothing is built, and it will not be pretended otherwise.

## where to go deeper

| doc | what is in it |
| --- | --- |
| `repo.md` | the repo map: every folder, what lives where, how it fits together |
| `docs/about.md` | what moira is and the beliefs underneath it |
| `docs/explain.md` | how moira works, for a person (the house metaphor) |
| `docs/problemcase.md` | the problem in detail |
| `docs/solution.md` | the answer, piece by piece |
| `docs/features.md` | the feature inventory with honest status |
| `docs/buildplan.md` | what is next and in what order |
| `roadmap.md` | what is shipped, what is next, what is deliberately deferred |
| `technobabble/underthehood.md` | how moira actually works: sync core, key sealing, taint algebra, cas, the store contract |
| `technobabble/system-architecture.md` | the components and how data flows between them |
| `technobabble/techstack.md` | every technology choice and why it was made |
| `technobabble/journal.md` | the build log: phases, bugs found, live-verification runs |
| `technobabble/technobabble.md` | the design ramble: why personas, why passes, why determinism |
| `technobabble/inspiredby.md` | what moira draws from |
