# latent

a deterministic decomposition engine for fiction. it breaks books, tv shows and movies into explicit, human-readable parts, stores those parts as a queryable graph, and finds connections by shared parts. the user then decides which connections actually represent their taste. no inference at query time. every result can be explained by pointing at the shared nodes.

status: pre-alpha. backend engine only. no consumer interface yet.

## the one-paragraph idea

"you like murder mysteries" is not a taste. a fan of the rookie and blue bloods and a fan of psych, elsbeth, the mentalist, ludwig and high potential both say "i like crime shows," but they want different things. genre tags cannot separate them. this project can, because it stores what a work is made of. and because a connection can be real while the recommendation is still wrong for you, the user can declare which inferred connections are incidental to why they like something.

## the core loop (this is all v0 is)

1. user names works they like.
2. engine returns each work's decomposed tags (what it is made of).
3. user marks specific tags as incidental, and optionally orders what matters most.
4. engine returns recommendations with a provenance map: which tags drove each result, and by how much.

everything else is later.

## scope (v0)

- media: books, tv shows, movies
- region: anglosphere (us, uk, canada, australia, new zealand, ireland), by country of origin and original language
- time: first released 2000 or later
- first domain module: crime / detective / legal
- engine only. stateless. no accounts, no ui.

## deliberately left out for now

- location, events, free local things, drinks, topics, any non-media domain
- imports from other services (letterboxd, goodreads)
- accounts, sync, any stored user profile
- availability, geoblocking, pricing, ads, affiliates, or anything commercial. the engine is availability-blind and business-blind: it only models taste.
- the consumer app

## docs

read in this order:

1. `concept.md` - what this is and why
2. `schema.md` - entities, axes, values, similarity and recommendation scoring (v0 draft)
3. `taste-context.md` - the one user-specific input: how incidental, priority and avoid are declared
4. `docs/scenarios.md` - concrete acceptance scenarios the engine must pass
5. `agent.md` - rules for any ai agent working in this repo. read before touching anything.
6. `buildplan.md` - phased plan with acceptance criteria
7. `docs/open-questions.md` - unresolved decisions. do not silently resolve these.

## principles

1. deterministic at query time. same catalog + same taste context + same config version = same output, always.
2. stateless. the engine stores no user data. the user's taste context travels with each request.
3. explainable. every result carries a provenance map.
4. the system finds connections. the user decides what they mean.
5. explicit over learned. traits are named, defined and frozen, not embedded.
6. classification and composition are separate. what a show is called does not predict what it is made of.
7. the schema is the product. tagging rubrics matter more than code.
8. everything is versioned. data, rubrics and scoring config.

## non-goals

- no collaborative filtering, no user behavior data, no embeddings, no llm calls at query time
- no inferring why a user likes something. the user states it.
- no business / b2b api

## relation to moira's evie

this branch of tinkrland/moira is evie's tree. evie's contract with moira lives in
`docs/evie-contract.md`. this engine is the deterministic catalogue side of that
contract: it decomposes works into explicit parts and never trains on user data.
evie holds the per-persona taste context and reads this catalogue; the engine
itself stays stateless.
