# people: the book, and how it fills

a relationship is (person, persona). one address book holds the humans; each
persona holds its own profile of a human - circles (soft tags, overlap welcome),
importance (1..5, never inherited), and a note. no persona is the "real you", so
no profile is privileged and an unprofiled persona does not see the person at
all.

## capture proposes, it does not populate (2026-11-03)

the book should fill itself without anything landing in it uninvited. a calendar
says someone attended a meeting; that is a **signal**, not a relationship, and a
connector cannot vouch for a human. so capture produces **proposals**:

- `peopleIngest({ events, source })` takes `{ kind, handle, name, at }` rows and
  nothing else. **it never creates a person** and never profiles anyone on a
  persona. the book is byte-identical until an accept.
- one handle is one proposal. the key is a normalized email or phone (casing and
  whitespace do not fork a person), sightings count up, `firstSeenAt` and
  `lastSeenAt` are kept, and a repeated capture adds to `kinds` rather than
  making a second row.
- **disagreeing names are kept as candidates**, not resolved by guessing. "nina"
  and "Nina Rao" both sit on the proposal until a human picks one.
- captured names are untrusted **text**: links and `@handles` are stripped before
  anything is shown, and the proposal is marked `untrusted: true`. stripping a
  link is not the same as trusting what is left.
- `peopleProposalAccept({ proposalId, personaId, circles, importance, note,
  name })` creates or reuses the person (matched by the captured handle) and
  writes a profile **for that persona only**. accepting the same proposal on a
  second persona makes a second profile with `importance: null` - no
  inheritance, which is the whole model.
- `peopleProposalDecline({ proposalId })` closes it and leaves the book alone.

receipts record `captured:N`, `capture_accepted`, `capture_declined` and never a
handle or a name. capture mints no facts: a connector still cannot assert that
someone matters.

surface: `POST /api/people/ingest`, `GET /api/people/proposals`,
`POST /api/people/proposal` (`action: 'accept' | 'decline'`).

honest limit: nothing calls ingest on a schedule. a host wires its own adapter
(calendar read, mail read) into the endpoint. the alternative - a daemon that
watches a mailbox - is a decision about standing access, not a feature.


## the wiring: a connector feeds capture (2026-11-03)

three thin links, because the alternative is a daemon that quietly reads a
mailbox:

1. **the adapter** exposes `listPeopleSignals(creds, params)` and returns
   `{ kind, handle, name, at }` rows. it is the only part that knows a provider's
   shape.
2. **the hub** (`captureSignals({personaId, connectorId, project, workspace,
   account})`) resolves the identity, unseals the credential, calls the adapter,
   and returns **normalized rows only**. the credential never leaves that method,
   so nothing downstream can leak a token it never held. an adapter without the
   method returns `adapter_cannot_feed_people`, because "could not look" must
   never read like "found nothing".
3. **the feed** (`peopleFeed.capture`) maps rows to events and calls
   `people.ingest`. it reports `captured`, `proposed`, `repeated`, `rejected`
   and `populated: false`.

surface: `POST /api/people/capture` (`{ personaId, connectorId, project?,
workspace?, account?, params? }`). owner-only: an agent context throws like every
other owner method, and no pass turns an agent into a calendar reader for the
address book.

counts are split on purpose: `proposed` is new proposals, `repeated` is repeat
sightings of a handle already known. "found two people" and "saw one person
twice" are different facts and the caller should not have to infer which.

**still not scheduled.** a host calls the endpoint from whatever clock it owns
(cron, a workflow, a button). building a watcher would decide standing mailbox
access on the owner's behalf, which is the one decision this layer refuses to
make.


## two axes, per persona (2026-11-04)

a relationship is not one number. each profile carries two independent axes:

- **importance** (1..5) - a judgement: how much this person matters to *this*
  persona.
- **interaction** (0..5) - contact: how much this persona actually deals with
  them.

the worksona's boss is high on both; the private layer's view of the same human
is low on both, and neither is the "real" one. the axes also come apart *inside*
one persona: a parent can be importance 5, interaction 1. no validation ties them
together, because the whole point is that they disagree.

**there is no composite, deliberately.** averaging the two would let a busy
acquaintance outrank a parent, and "who matters most" is not "who you deal with
most". ordering names its criterion instead: `peopleList({ order: 'importance' })`
(default) or `{ order: 'interaction' }`, each sorting high-to-low with unrated
profiles last and a name tie-break so the result is deterministic. an unknown
order is refused (`order_invalid`) rather than defaulted silently.

both axes are **never inherited**: the same person is rated separately by every
persona that knows them, and a persona that has never met them does not see them
at all. `peopleCircles` sums both axes per circle, so a circle reads as "3 people,
importance 11, interaction 9" - a shape, not a verdict.

**capture cannot rate anyone.** a calendar sighting may become a proposal, but
accepting one leaves both axes `null`: a connector cannot claim someone matters,
and it cannot claim the contact meant anything either.

## open loops and briefs, taken from cresca (2026-11-04)

cresca's site (read 2026-11-04) is a personal assistant for people: capture
anything, file it automatically, and bring it back before you meet someone. its
real thesis is not the address book - every personal crm has one - it is that a
relationship carries **open loops** (the thing you said you would do) and that
the loop should surface before it goes cold.

**taken:**
- **promises** are loops with a human, owned by (person, persona): `promiseAdd`,
  `promises`, `due`, `promiseKeep`, `promiseDrop`. undated promises are open,
  not due. `due` reports `overdueByMs` as an age, not a scolding, and it is a
  *pull* - nothing notifies, so moira cannot become a nag.
- **the brief** composes from what is stored: circles, both axes, note, open
  promises. it lists what it does *not* know (`unknown`) instead of writing a
  warm sentence, because a brief that guesses is worse than none. a rated
  interaction of 0 is knowledge ("never"), so it is not reported as a gap;
  unrated is.
- **capture-anything** was already the shape here (vault + capture proposals).

**refused, on purpose:** nfc cards and event badges (a hardware funnel, not a
model problem), gifting and affiliate links (commerce in the relationship
layer), bill splitting, and model-written messages. cresca says "the words stay
yours"; moira goes further and writes no words at all - summarising a person
into prose is exactly the fabrication `unknown` exists to prevent.

**already aligned, structurally:** private by default, never trained on, no
paid rankings. cresca's "ai assists, never pretends, never speaks as you" is a
promise they make; in moira it is a property - an agent acts under a pass, its
reads are receipted, and there is no code path where an agent speaks as a
persona.

**still open:** groups as shared memory (cresca's strongest remaining idea - "a
group is a shared memory for the people you do things with"), and attaching
capture sightings to people so `unknown` can lose its "no capture history".

## rooms: a shared memory that is not a shared persona (2026-11-04)

cresca's last good idea, and the one that needs the most care in moira: "a group
is a shared memory - it remembers things as one, like a person or a topic".

the danger is obvious. a room full of people who each hold private judgements is
a machine for laundering them: importance, circles, notes, who owes whom, all
pooled into a single score. so a room here is deliberately dumb:

- **nothing enters except an item a member posted.** a room has no read path into
  facts, notes, circles, importance or interactions. `roomTimeline` returns
  `{itemId, kind, from, at, body}` and nothing else, and a test fails if the
  word `importance` or a circle tag ever appears in that payload.
- **kind is declared, not inferred**: `note`, `link`, `decision`, `file`. the
  vocabulary is closed so a room cannot become free-text gossip that later gets
  read as a claim.
- **a room item is not a fact.** posting does not touch the fact ledger, and
  nothing in a room can be promoted into one by a connector.
- **membership is consented and re-checked.** a connected persona is *invited*
  (an invite grants no read) and must accept. every read re-checks the row, so a
  right is per-request rather than cached.
- **items are sealed at rest** with a key derived from the instance key and the
  room id.

the honest limit, stated in the code and not just here: leaving stops the room,
it does not unshare it. `leave()` records `leftAt` and stops future reads, and
the summary keeps counting the history for the members who remain. a shared
memory whose past could be withdrawn would be a lie about consent; the truthful
version is that history belongs to everyone who was there.

and the limit under that one: sealing protects the *store*, not a running
service. per-member cryptography would be a stronger claim than this build makes,
so the doc does not make it.
