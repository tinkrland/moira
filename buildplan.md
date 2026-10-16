# buildplan

phased and deliberately small. do not start a phase until the previous one's acceptance checks pass. a human signs off each phase.

v0 goal: the core loop works end to end on a small corpus. works in, tags out, incidental and priority declared, recommendations with provenance out. nothing else.

## phase 0: foundations

deliverables
- repo skeleton as in `agent.md`
- sqlite schema for works, work_links, trait_values, work_traits
- yaml loader and validator (vocab check, evidence check, scope check: anglosphere origin, english language, release >= 2000)
- taste context loader and validator (`taste-context.md`)

accept when
- invalid works and invalid taste contexts are rejected with clear messages
- a valid work round-trips yaml -> sqlite -> yaml unchanged

## phase 1: rubrics and vocab

deliverables
- one rubric per layer 2 core axis in `docs/rubrics/`: definition of each value, boundary cases, one counterexample each
- crime module rubrics (mechanism, lens, subject, legal role)
- vocab files in `data/vocab/`

accept when
- a human can read any rubric and tag a sample show without questions
- a human and the agent independently tag the same 5 works and agree on at least 80 percent of primary values. fix the rubric, not the data.

write first: `fantasy`, `authority_stance`, `lead_flaw_treatment`. these carry the most weight and the most subjectivity.

## phase 2: seed corpus (small)

deliverables
- 24 works tagged and reviewed:
  - institutional: the rookie, blue bloods, the closer, will trent
  - outsider-lens: psych, the mentalist, elsbeth, ludwig, high potential, monk
  - cozy and tone-adjacent: death in paradise, return to paradise, gilmore girls (as a non-crime nostalgia case)
  - vigilante and criminal: leverage, white collar, lucifer
  - legal: suits
  - 3 books and 3 movies in the same territory, plus 2 controls from unrelated territory
- external ids where available

accept when
- all reviewed and valid
- no axis has more than 80 percent of works on one value (it must discriminate)
- every work in `docs/scenarios.md` exists in the corpus

## phase 3: the core loop

deliverables
- `tags(work)`: returns the decomposed tags with evidence, so the user can see what the engine sees
- `recommend(taste_context)` with incidental (work-scoped and global), compound affinities, avoid, priority, attribution
- `config/scoring.v0.yaml`
- cli examples: `latent tags elsbeth-2024`, `latent recommend context.yaml`

accept when
- scenarios s1 to s5 in `docs/scenarios.md` pass
- identical output on repeated runs, byte for byte
- no writes at query time

## phase 4: similarity and kinship

deliverables
- `similar`, `cousins`, `why`, `profile`, `exclude`

accept when
- scenarios s6 and s7 pass
- at least 3 cousin pairs with zero shared genre_tradition values that a human agrees are real kin

## phase 5: stress and honesty

deliverables
- expand to about 100 works across more territory to exercise core axes beyond crime
- layer independence test: measure how well layer 1 predicts layer 2. report the number.
- weight sensitivity report: how rankings shift when weights move by 25 percent
- priority semantics comparison (gate vs multiplier) on the scenarios

accept when
- the independence test supports the premise or `concept.md` is revised
- rankings are stable enough that the provenance still makes sense

## later (not planned yet)

- ingestion helpers (tmdb, open library, wikidata ids and basic metadata only)
- model-assisted draft tagging, always against rubrics, always human-reviewed
- second domain module (romance or sci-fi) to test the core axes outside crime
- consumer layer over `tags`, `recommend` and `why`
- import adapters, other media, location and events: not before the engine is solid
