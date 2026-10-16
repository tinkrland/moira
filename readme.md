# moira

you are one person, but you are not one profile. the student, the founder, the
character, the alter ego: each has its own context, and today every app blends
them into one gray mush. moira refuses to blend.

moira is a **context engine with personas**: one place where your context
lives, split into personas you fully control, shared only through explicit
consent, and fed from the apps and services each persona actually uses.

## hats

### what a hat is

a hat is a version of you that you put on deliberately. the student, the
founder, the musician, the character you write: these are not moods or
filters, they are contexts. each one has its own files, its own people, its
own taste, its own history, and its own idea of what matters. the founder's
wednesday and the student's wednesday can happen on the same day and still
have almost nothing to do with each other.

### you wear many at once

nobody wears one hat. you move between several in a single day, sometimes in
the same hour: the founder takes a call, the student opens a paper, the
character gets a new scene. and the number only grows over a life. what makes
this bearable today is that humans are good at keeping hats apart without
thinking about it. what makes it unbearable online is that no software even
tries.

### hats are different personas

in moira, a hat becomes a persona: a first-class object with its own memory,
its own sealed keys, its own connectors, and its own budget. this is not a
folder, not a label, not a "mode". a persona is a real boundary that software
has to respect: persona a's memory is physically invisible to persona b,
because they are sealed under different keys. when you delete a persona its
keys are shredded, which means the deletion is real and not a flag flip.

### what apps do instead

every app today does the opposite. it melts all your hats together into one
"personal context": one profile, one recommendation feed, one ad identity,
one engagement score. it calls this personalization, but a blend of the
student, the founder, and the character is context about nobody. the mush is
utterly useless. it cannot serve any single hat well, because it answers to
the average of all of them. it cannot be split back apart, because nothing
was ever kept separate. and it cannot be deleted hat by hat, because there
is only one thing. moira exists because the mush is not the only option.

## personas, more than a sandbox

### isolation is only the easy half of the sandbox problem

the easy half is keeping hats apart. persona a's memory is invisible to
persona b. personas never leak into each other accidentally. deleting a
persona shreds its keys so the deletion is real. most tools that even try
to model multiple yous stop here, at isolation, and isolation alone is easy:
it is just careful bookkeeping.

### permissive permeability is the other half

the hard half: hats are still one human's life, so they sometimes need to
share. deliberately, narrowly, and reversibly. maybe the founder needs the
student's schedule. maybe two hats share a set of facts about a project. the
answer cannot be "they can always see each other", because that recreates the
mush with extra steps. it also cannot be "they can never see each other",
because then you have built silos, not a life.

moira's answer is the bridge. a bridge is a persona-to-persona connection
that requires a matching bridge on both ends AND explicit ingress on each
side, so consent is doubled and revocable on either end. no bridge means
"not available", with never a hint that anything exists on the other side:
absence is indistinguishable from emptiness, on purpose. sharing is a built,
audited act. never a default, never a leak. isolation without permeability
is just another set of silos; permeability without consent is the mush again.
moira does both, on purpose.

### personas are not just you

a persona does not have to be attached to your legal self. moira personas
come in identity kinds, and the kind is a first-class property:

- **linked**: your real-world self. the one that can inherit shared core
  facts from your other linked personas, because those facts genuinely belong
  to the person behind them.
- **pseudonymous**: a stable alias with its own context. it is not connected
  to your legal identity, and it gets the same first-class care as every
  other persona: its own keys, memory, connectors, and budget.
- **heteronymous**: a character, another person entirely. it requires a
  character sheet (name, backstory, voice, beliefs, expertise, red lines,
  canon rules), it never inherits your core facts, and its canon cannot
  leave the character. bridges from a heteronym can carry themes and
  interests, never biographical facts.

all of them are the real you in the way that matters here: none is a "master
profile" and none is a role being played by the "real" one. they are different
contexts, kept honestly different.

### planned: decentral profiles

persona storage tiers exist in the model for a reason: hosted, local, and
decentral. the decentral tier means profiles you control on infrastructure
you choose, movable, with no single home that can be subpoenaed, breached, or
simply shut down. it is planned, not built, and it is not pretended otherwise.

## usage is not liking

apps today treat every tap as an endorsement. you watched it, so you like
it. you have the app, so you wanted it. but free usage is not preference:
you watch what autoplay served you, you use the family plan, you keep the
tool your work mandates, you read the link your friend sent. consuming
something for free tells almost nothing about whether you actually like it.

moira keeps the two apart:

- **signals** are what services report: plays, reads, purchases, clicks.
  every signal enters the system tagged untrusted, with its source attached.
  a signal is evidence of what happened, never a statement of what you like.
- **preferences** are what you confirm. nothing becomes a preference without
  your explicit confirmation, so no engagement metric can quietly decide
  your taste for you.
- and even a confirmed preference keeps its provenance: every fact carries a
  taint label recording where it came from, how linkable it is to you, and
  how long it stays relevant. labels combine by most-restrictive-wins, so
  summaries cannot launder what a fact really is.

this split matters most for taste, the block that feeds the decoupled taste
engine (evie, on its own branch). evie never trains on your data and never
absorbs signals into weights: your ratings, logs, and shares only position
you in an existing catalogue space. keeping usage and liking separate is
what makes that positioning honest.

## the rest of the model

### passes, not raw access

when an app or agent wants context, it never gets your keys. it gets a pass:
scoped to one persona, one category, one purpose, one duration. passes can
be one-time, and every read leaves a signed receipt you can audit. this is
also what a tap should be: a pass is exactly the shape of "let this person,
for this reason, until tonight, see this much".

### connectors feed personas on their own terms

each persona connects its own accounts, and can hold several accounts per
provider: work drive and personal drive on the same hat is a normal case.
provider text is tagged untrusted at ingress and never becomes a preference
without your confirmation (the same split as above).

connectors are organized by the job you want done. you approve the job, and
the providers under it are interchangeable: swap dropbox for drive and
nobody re-consents, because the consent attached to the job, not the brand.

<table>
  <tr><th>block</th><th>job</th><th>providers</th></tr>
  <tr><td rowspan="4">knowledge</td><td>retrieve your files</td><td>google drive, onedrive, dropbox, mega (live, connected)</td></tr>
  <tr><td>manage projects</td><td>linear, craft docs, notion</td></tr>
  <tr><td>plan your time</td><td>google calendar, notion calendar</td></tr>
  <tr><td>read & write</td><td>substack, medium (ingest)</td></tr>
  <tr><td rowspan="2">tech & dev (opt-in)</td><td>develop software</td><td>github, gitlab, bitbucket</td></tr>
  <tr><td>design & prototype</td><td>figma, kittl, canva, penpot, balsamiq</td></tr>
  <tr><td rowspan="2">academia</td><td rowspan="2">manage research</td><td>connected: zotero, mendeley, semantic scholar</td></tr>
  <tr><td>export/webhook: arxiv, google scholar</td></tr>
  <tr><td rowspan="5">people (later phase)</td><td>meet & schedule</td><td>calendly, cal.com, z cal, granola, zoom, google meet</td></tr>
  <tr><td>social media</td><td>instagram, x, threads, bluesky, tiktok</td></tr>
  <tr><td>networking</td><td>linkedin, polywork</td></tr>
  <tr><td>family circle</td><td>life360, familywall, google family link</td></tr>
  <tr><td>friends circle</td><td>groupme, discord, find my (export/webhook)</td></tr>
  <tr><td rowspan="4">ai tools</td><td>talk to assistants</td><td>chatgpt, claude, gemini, perplexity</td></tr>
  <tr><td>build apps</td><td>lovable, base44, bolt, v0</td></tr>
  <tr><td>code with agents</td><td>cursor, windsurf, claude code, github copilot</td></tr>
  <tr><td>work from specs</td><td>kiro, ibm bob</td></tr>
  <tr><td rowspan="6">taste</td><td>track books</td><td>goodreads, storygraph, fable, pagebound</td></tr>
  <tr><td>track film</td><td>letterboxd</td></tr>
  <tr><td>track tv</td><td>serializd, tv time, repov</td></tr>
  <tr><td>track music</td><td>last.fm, stats.fm, musicboard, superfan</td></tr>
  <tr><td>read & write stories</td><td>archive of our own (import), wattpad</td></tr>
  <tr><td>share taste</td><td>pi.fyi, tastify</td></tr>
  <tr><td rowspan="2">lifestyle</td><td>dress & shop</td><td>depop, ltk, pinterest, whering</td></tr>
  <tr><td>log your life</td><td>anylog, retro</td></tr>
  <tr><td rowspan="3">utility</td><td>watch</td><td>youtube</td></tr>
  <tr><td>places</td><td>maps</td></tr>
  <tr><td>health</td><td>health platforms</td></tr>
</table>

every row's status is explicit in the code. only the file adapters exist and
are tested today; everything else is registered but not built yet, and
nothing pretends to work. provider lists are examples, not the universe: the
tree grows by addition. the people block is soft-tagged by design (a friend
tagged as basically family is fine, overlap is welcome), and how much someone
matters to you is tracked per persona, never for the owner wholesale: every
persona is the real you, and none is a role.

## modality

moira is designed to be reached the way you actually live:

- **browser first.** the primary experience is a web app: personas, passes,
  bridges, receipts, and connectors as visible, touchable things you manage
  directly, not settings buried four menus deep.
- **command line native.** the cli is not a debug tool; it is a first-class
  surface. everything the owner can do is scriptable, and the same
  deterministic core runs behind it.
- **nfc tappable cards (potentially).** a persona as a physical card you tap
  to share context in person; the pass model (scope, purpose, duration,
  receipt) is exactly what a tap needs. deliberately still a "potentially":
  nothing is built, and it will not be pretended otherwise.
