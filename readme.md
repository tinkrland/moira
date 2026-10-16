# moira ✧

> a context engine with personas: your memory, split by the hats you actually wear, shared only through explicit consent»

## what is this

moira is basically me being tired of the same dance.

for context: i'm not exactly one person. nobody is. there's the student me,
the founder me, the character me, the alter ego me - and they don't want the
same things. the student wants its papers and its pdfs. the founder wants its
calendar, its people, its money. the character wants its stories.

and every single app i touch does this:

- builds one profile.
- blends everything into it.
- watches what i do "for a better experience".
- shares it with whoever asks nicely.
- and then...
- the study playlist shows up in my work account.
- the ads follow me across all of it.
- and deleting any one of these pieces is, of course, impossible.

none of these things are difficult individually. the annoying part is that
there is no place where "the student" is a first-class thing that software
has to respect. the profile is always the product, and it's always ONE
profile.

so... why not?

---

## the problem

your context currently lives in a weird collection of tools that each know
one part of you.

you might use:

- google drive for the files
- notion or craft for the projects
- a calendar app for time
- chatgpt, claude, whoever for thinking
- letterboxd, goodreads, last.fm for taste
- the list goes on

and each of them builds its own little profile of you. on its own terms.
with its own settings you'll never find.

- the drive knows what you keep.
- the calendar knows where you'll be.
- the assistant knows how you think.
- letterboxd knows what moves you.

but they don't know about each other, and - the actual point - they don't
know about your hats.

so the human becomes the sync layer between all of them, while each of them
quietly becomes a product about you.

that feels backwards.

---

## the repetitive part

this is the part that really bothers me.

- you sign up somewhere new.
- you hand over your whole drive, or your whole inbox, because granular
  access barely exists.
- the app reads everything.
- you can't tell what it read.
- you can't undo what it keeps.
- you switch projects, or moods, or jobs...
- and the profile follows you anyway.

these are not exotic demands:

- access should be scoped to one hat, one purpose, one duration.
- every read should leave a receipt you can audit.
- revoking should actually revoke.
- deleting should actually delete.

they're relationships. and computers are very good at relationships.

- if i hand an app a pass that says "read these files, for this purpose,
  until friday", it should get exactly that and nothing else.
- if i delete a persona, its keys should be shredded. not flagged. shredded.
- if two of my hats want to share something, that should be a bridge i
  built on purpose, not a default.

---

## what moira is trying to do

moira is a place where your context lives, split into personas you fully
control, fed from the apps each persona actually uses, and shared only
through explicit consent.

instead of starting with:

*"sign in with google and let me see everything"*

you start with:

«these are my hats»

- «this one is the student»
- «this one is the founder»
- «this one is a character, actually»
- «they don't see each other unless i say so»

and moira holds the lines.

---

# the views

moira is split into a few major views.

they aren't separate programs. they're ways of looking at the same context.

```
personas
  ↓
facts
  ↓
passes
  ↓
bridges
  ↓
connectors
```

you can jump between them whenever you want.

- if i change what a fact is allowed to mix with, the policy engine reacts.
- if i revoke a pass, the reads stop.
- if i delete a bridge, "not available" comes back - with no hint that
  anything ever existed.

the context is one object. the views are just different windows into it.

---

## the first view — personas

this is the "who is asking" part.

a persona is one of your hats, as a first-class thing:

- its own memory
- its own sealed keys
- its own connectors
- its own budget

and one rule i want pinned in writing: none of your personas is the "real
you" with the others playing roles. they are all the real you. what differs
between them is what they know and who they matter to - someone can be very
high on your founder's axis and nearly absent from your personal life, and
that's just how knowing works.

switching personas is deliberately heavy: you don't mutate a profile in
place, you request a switch, approve it, and get a freshly minted session for
the new hat. the old one keeps its own memories.

deleting a persona is real. the keys are shredded; sealed facts become noise
forever. the deletion is not a flag flip.

---

## the second view — facts

facts are what a persona remembers, and they carry their papers.

every fact is sealed and labeled (we call the label its taint):

- where it came from
- how linkable it is to you
- how long it stays relevant

labels combine by most-restrictive-wins, so a summary of a private thing
can't launder itself into a public one. a fact can move between personas
only by being unsealed and re-sealed under the new persona's key, in front
of the policy engine, provenance intact.

---

## the third view — passes

when an app or an agent wants context, it never gets your keys.

it gets a pass: scoped to one persona, one category, one purpose, one
duration. passes can be one-time. every read burns a signed receipt you can
audit later.

this is also what a tap should be: a pass is exactly the shape of "let this
person, for this reason, until tonight, see this much."

---

## the fourth view — bridges

a persona never leaks into another one by accident. sharing needs a matching
bridge AND explicit ingress on each side.

no bridge means "not available" - never a hint that anything exists on the
other side. absence is indistinguishable from emptiness, on purpose.

---

## the fifth view — connectors

this is where the context actually comes in.

connectors are organized by the job you want done - you approve the job,
and the providers under it are interchangeable (swap dropbox for drive and
nobody re-consents). each persona connects its own accounts - several
accounts per provider, even (work drive + personal drive on the same hat) -
and provider text is tagged untrusted at ingress. it is evidence, never
truth, and never becomes a preference without your confirmation.

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

`[live]` means the adapter exists and is tested. everything else is
registered but not built yet - the status is explicit in the code, and
nothing here will pretend otherwise.

---

## under the hood

**the core is deterministic and boring on purpose.** zero dependencies,
node 24, one process. the policy engine is pure logic - same inputs, same
answers - which is the only reason any of the promises above can be tested
instead of trusted.

**two surfaces, one rule.** the agent surface (what an mcp server or an app
calls) can never reach an owner action. owner actions require a minted owner
context. a poisoned agent cannot approve itself into anything.

**evie, the taste engine, never trains on you.** the taste block is her fuel
line; she lives on her own branch and activates only when she does. she is
deterministic: latent elements come from catalogues that already exist (tmdb
for film and tv, per-axis equivalents elsewhere), and your ratings, logs and
shares only position you in that space - nothing of you is ever absorbed
into weights. recommendations map onto a per-persona graph by latent
similarity, not the overt "because you watched" kind, and they explain
themselves.

**the deletion is real, one more time, because it matters.** personas shred
their keys. unsealed-without-the-key is noise. this is the difference
between "deleted" and hidden behind a flag, and moira only claims the first.

```
# run the suite (offline, no network, no services)
npm test

# script the owner surface from the terminal
node cli.js personas list
node cli.js persona create --name founder --identity linked
node cli.js fact add --persona <id> --content "..." --category notes
```

---

## what i want moira to feel like

- not a password manager for your personality.
- not another dashboard with a dark mode.
- not a form where you surrender your drive and pray.

i want it to feel like:

"i have a weird little hat i wear"

and then just start wearing it.

- give the student its own drive.
- give the founder its own people.
- hand out passes that expire tonight.
- watch every read leave a receipt.
- build a bridge when two hats actually want to talk.
- delete a hat when it's done, and mean it.

and reach it the way you live: a browser, first (personas and passes as
visible, touchable things), the command line as a first-class citizen, and -
potentially, deliberately still just potentially - an nfc card you tap to
hand someone a pass in person.

because if the computer can already hold the boring, paranoid relationships
between who-knows-what, i would much rather let it do that, and spend my time
being several people on purpose.

---

## where to go deeper

| doc | what is in it |
| --- | --- |
| `repo.md` | the repo map: every folder, what lives where |
| `docs/about.md` | what moira is and the beliefs underneath it |
| `docs/explain.md` | how moira works, for a person (the house metaphor) |
| `docs/problemcase.md` | the problem in detail |
| `docs/solution.md` | the answer, piece by piece |
| `docs/features.md` | the feature inventory with honest status |
| `docs/buildplan.md` | what is next and in what order |
| `roadmap.md` | what is shipped, what is deferred, and why |
| `technobabble/underthehood.md` | sync core, key sealing, taint algebra, cas |
| `technobabble/system-architecture.md` | components and data flow |
| `technobabble/techstack.md` | every technology choice and why |
| `technobabble/journal.md` | the build log: phases, bugs, live runs |
| `technobabble/technobabble.md` | the design ramble: why personas, why determinism |
| `technobabble/inspiredby.md` | what moira draws from |
