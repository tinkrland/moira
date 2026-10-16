# evie

evie is moira's taste engine - the component that learns what a persona
likes, tracks how their taste evolves, and answers "would this person
enjoy this?". it is deliberately **decoupled** from moira's
deterministic core.

this branch is an **orphan**: it shares no history with main and carries
no moira code. the taste engine is a standalone tree that plugs into
moira; the contract below is all there is here until evie starts being
built.

## the contract

- moira's policy engine is pure, deterministic, replayable. access
  decisions are math. **evie never gates an access decision.**
- evie reads facts and signal kinds (ratings, logs, shares - the taste
  block's ingest, tagged untrusted with source attribution) and builds
  taste graphs per persona.
- evie never writes a fact without owner confirmation, same as every
  other proposing component.
- evie can be unplugged and moira loses nothing but taste features. it
  can be replaced - it's a plugin, not a limb.

## the axes: where taste comes from

taste is not one signal; it is a shape that appears across many
deliberate acts of recording. evie takes from these apps, on every
axis, to define the latent similarities between what a persona loves:
cross-axis affinities are the whole point - a book connecting to a
film, a share connecting to a song.

### entertainment taste (consumption, then reflection)

- **books**: goodreads, storygraph, fable, pagebound - ratings,
  shelves, reading history
- **film**: letterboxd - ratings, watchlists, diary entries
- **tv**: serializd, tv time, repov - episode logs, rankings,
  rewatches
- **music**: last.fm, stats.fm, musicboard, superfan - scrobbles,
  streaming stats, ratings, favorite artists
- **stories**: archive of our own (import), wattpad - kudos, bookmarks,
  subscriptions (what you read when nobody's watching: the strongest
  latent signal on the tree)
- **shares**: pi.fyi, tastify - rooms of favorite things, favorites
  lists, archived monthly. tastify is the reference shape: taste as a
  snapshot over time, not a single moment

### lifestyle taste (what you choose to wear, buy, keep, do)

- **dress/shop**: depop, ltk, pinterest, whering - purchases, saves,
  boards
- **life log**: retro (weekly photo journals, group albums,
  postcards), anylog (custom life logs - coffees, habits; the kind of
  small repeated choice that is taste without anyone calling it taste)

### reading as thinking (deliberately a different axis)

substack, medium - the essays and publications a persona follows are
not entertainment consumption; they shape thinking. evie treats the
reading axis as its own dimension: it informs what a persona is
becoming, not just what they enjoy. (registered under the knowledge
block's publish/reading job, distinct from the taste block.)

## how the latent similarities get built

- every signal enters tagged untrusted with source attribution, per
  persona - platform telemetry is data, never truth
- entities (books, films, shows, albums, essays, products) link into
  one per-persona taste graph; affinities connect across axes
- taste evolution is first-class: month-over-month change, with
  tastify-style archived rooms as the time-series anchor
- recommendations are explainable ("because you rated X, shared Y"),
  persona-scoped, and never written anywhere without owner
  confirmation

per moira spec section 18: no taste connectors before v3. the taste
block registers with the connector hub in phase 3; evie activates
when it does.

nothing is built on this branch yet - this document is the contract.
