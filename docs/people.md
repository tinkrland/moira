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
