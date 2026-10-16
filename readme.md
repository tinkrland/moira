# moira

you are one person, but you are not one profile. the student, the founder, the
character, the alter ego - each has its own context, and today every app
blends them into one gray mush. moira refuses to blend.

moira is a **context engine with personas**: one place where your context
lives, split into personas you fully control, shared only through explicit
consent, and fed from the apps and services each persona actually uses.

## hats

### what a hat is

a hat is a version of you that you put on deliberately: the student, the
founder, the musician, the character you write. it has its own context - its
own files, people, taste, history - and its own idea of what matters.

### you wear many at once

nobody wears one hat. you move between several in a single day, and the
number only grows: the founder's calendar means nothing to the student, the
student's papers mean nothing to the character. the hats coexist.

### hats are different personas

in moira, a hat becomes a persona: a first-class object with its own memory,
its own keys, its own connectors, and its own budget. not a folder, not a
label - a real boundary that software has to respect.

### what apps do instead

every app today does the opposite. it melts all your hats together into one
"personal context" - one profile, one recommendation feed, one ad identity -
and calls it personalization. but a blend of the student, the founder, and the
character is context about nobody. that mush is utterly useless: it can't
serve any one hat well, it can't be split back apart, and it can't be deleted
hat by hat. moira exists because the mush is not the only option.

## personas, more than a sandbox

### isolation is only the easy half of the sandbox problem

the easy half is keeping hats apart: persona a's memory is invisible to
persona b, personas never leak into each other, deleting a persona shreds its
keys so the deletion is real. most tools that even try, stop here.

### permissive permeability is the other half

the hard half: hats are still one human's life, so they sometimes need to
share - deliberately, narrowly, and reversibly. moira's answer is the bridge:
a persona-to-persona connection that needs a matching bridge AND explicit
ingress on each side. no bridge means "not available", with never a hint that
anything exists on the other side. sharing is a built, audited act - never a
default, never a leak. isolation without permeability is just another set of
silos; permeability without consent is the mush again. moira does both, on
purpose.

### personas are not just you

a persona does not have to be attached to your legal self. moira personas
come in identity kinds:

- **linked** - your real-world self. the one that can inherit shared core
  facts from your other linked personas.
- **pseudonymous** - a stable alias with its own context. not connected to
  your legal identity; treated with the same first-class care.
- **heteronymous** - a character, another person entirely. requires a
  character sheet (name, backstory, voice, beliefs, expertise, red lines,
  canon rules), never inherits your core facts, and its canon cannot leave
  the character. bridges from a heteronym can carry themes and interests,
  never biographical facts.

all of them are the real you in the way that matters here: none is a "master
profile" and none is a role being played by the "real" one. they are just
different contexts, kept honestly different.

### planned: decentral profiles

persona storage tiers exist in the model for a reason: hosted, local, and
decentral. the decentral tier - profiles you control on infrastructure you
choose, movable, no single home - is planned, not built, and is not pretended
otherwise.

## the rest of the model

### passes, not raw access

when an app or agent wants context, it never gets your keys. it gets a pass:
scoped to one persona, one category, one purpose, one duration. passes can be
one-time, and every read leaves a signed receipt you can audit.

### facts carry their provenance

every memory is sealed and labeled (its taint): where it came from, how
linkable it is, how long it stays relevant. labels combine by
most-restrictive-wins, so summaries cannot launder what a fact really is.

### connectors feed personas on their own terms

each persona connects its own accounts - several accounts per provider, even
(work drive and personal drive on the same hat). provider text is tagged
untrusted at ingress and never becomes a preference without your
confirmation.

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

```
# run the suite (offline, no network, no services)
npm test

# script the owner surface from the terminal
node cli.js personas list
node cli.js persona create --name founder --identity linked
node cli.js fact add --persona <id> --content "..." --category notes
```

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
