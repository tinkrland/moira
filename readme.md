# evie

entertainment vocabulary indexing engine. that is the docs name; the
tagline is entertainment variable intersection engine: each work is a
set of variables, your taste is the intersection of the variables in
the works you love, and recommendations are works that maximize that
intersection.

a deterministic decomposition engine for fiction. it breaks tv shows,
movies and books into explicit, human-readable parts, stores those
parts as a queryable graph, and finds connections by shared parts. the
user then decides which connections actually represent their taste. no
inference at query time. every result can be explained by pointing at
the shared nodes.

status: pre-alpha. the core engine loop is built and tested (build,
tags, recommend; 55 tests). no consumer interface yet, no real
catalogue yet: the seed corpus is the current work.

## the one-paragraph idea

"you like murder mysteries" is not a taste. a fan of the rookie and
blue bloods and a fan of psych, elsbeth, the mentalist, ludwig and
high potential both say "i like crime shows," but they want different
things. genre tags cannot separate them. this project can, because it
stores what a work is made of. and because a connection can be real
while the recommendation is still wrong for you, the user can declare
which connections are incidental to why they like something.

## the core loop

1. user names works they like.
2. engine returns each work's decomposed tags (what it is made of).
3. user marks specific tags as incidental, and optionally orders what
   matters most.
4. engine returns recommendations with a provenance map: which tags
   drove each result, and by how much.

the loop is real and runnable today:

```sh
# build the catalogue from authored work files
python3 -m src.cli build --works data/works --db build/latent.db

# what the engine sees when it looks at a work
python3 -m src.cli tags elsbeth-2024 --db build/latent.db

# recommendations from a taste context (deterministic, read-only)
python3 -m src.cli recommend context.yaml --db build/latent.db
```

the query path never writes. the same catalogue, taste context and
config always produce the same answer, byte for byte.

## scope (v0)

- media: tv shows, movies, fiction
- region: anglosphere (us, uk, canada, australia, new zealand,
  ireland), by country of origin and original language
- time: first released 2000 or later
- first domain module: crime / detective / legal
- engine only. stateless. no accounts, no ui.

## deliberately left out for now

- location, events, free local things, drinks, topics, any non-media
  domain
- imports from other services (letterboxd, goodreads)
- accounts, sync, any stored user profile
- availability, geoblocking, pricing, ads, affiliates, or anything
  commercial. the engine is availability-blind and business-blind: it
  only models taste.
- the consumer app

## principles

1. deterministic at query time. same catalog + same taste context +
   same config version = same output, always.
2. stateless. the engine stores no user data. the user's taste context
   travels with each request.
3. explainable. every result carries a provenance map.
4. the system finds connections. the user decides what they mean.
5. explicit over learned. traits are named, defined and frozen, not
   embedded.
6. classification and composition are separate. what a show is called
   does not predict what it is made of.
7. the schema is the product. tagging rubrics matter more than code.
8. everything is versioned. data, rubrics and scoring config.

## non-goals

- no collaborative filtering, no user behavior data, no embeddings,
  no llm calls at query time
- no inferring why a user likes something. the user states it.
- no business / b2b api

## how it works, briefly

- **vocab**: 22 axes in `data/vocab/`. 14 core layer 2 axes every work
  carries (tone, fantasy, authority_stance, romantic arc and friends),
  one proposal-only axis (motifs, wrangled ao3-style with alias
  provenance), and layer 1 classification (genre tradition, the crime
  module) kept deliberately separate from composition.
- **works**: authored as yaml, one file per work, every tag carrying a
  human-written evidence line. drafts and reviewed works are distinct;
  only reviewed works enter the query graph.
- **engine**: builds works into sqlite, then scores recommendations by
  intersecting the traits of the works you love, minus what you marked
  incidental, gated by your avoid rules and priority order. every
  recommendation comes with attribution shares that sum to exactly
  100.0.

## docs

read in this order:

1. `concept.md` - what this is and why
2. `schema.md` - entities, axes, values, similarity and recommendation
   scoring (v0 draft)
3. `taste-context.md` - the one user-specific input: how incidental,
   priority and avoid are declared
4. `docs/rubrics/` - tagging rubrics. the schema is the product, and
   rubrics are how the schema stays honest. five drafted so far:
   fantasy, authority_stance, lead_flaw_treatment, romantic_arc,
   romance_dynamic.
5. `docs/motifs-wrangling.md` - ao3-style motif governance:
   canonical values, alias tables, provenance preserved, reviewed
   proposals only
6. `docs/scenarios.md` - concrete acceptance scenarios the engine
   must pass
7. `docs/agreement/` - the rubric agreement test: two taggers, same
   five works, 80 percent gate before phase 2 tagging starts
8. `agent.md` - rules for any ai agent working in this repo. read
   before touching anything.
9. `buildplan.md` - phased plan with acceptance criteria
10. `docs/open-questions.md` - unresolved decisions. do not silently
    resolve these.

## relation to moira's evie

this branch of tinkrland/moira is evie's tree. evie's contract with
moira lives in `docs/evie-contract.md`. this engine is the
deterministic catalogue side of that contract: it decomposes works
into explicit parts and never trains on user data. evie holds the
per-persona taste context and reads this catalogue; the engine itself
stays stateless.
