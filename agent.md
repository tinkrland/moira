# agent.md

instructions for any ai agent working in this repo. read `readme.md`, `concept.md`, `schema.md` and `taste-context.md` first. these rules override your defaults.

## prime directives

1. the engine is deterministic. never add randomness, sampling, embeddings, learned weights or model calls to the query path.
2. never invent facts about a work. if you do not know a value, mark it `unknown`. do not guess to fill a field.
3. never invent external ids. ids come from wikidata, tmdb, open library or similar sources, or are left null.
4. never change the schema, axis values, rubrics or scoring weights without being asked. propose changes in `docs/open-questions.md` or in a pull request description instead.
5. frozen data is append-only. to change a tagged work, bump its `tag_version` and keep the history.
6. layer 1 and layer 2 stay separate in `dna_score` and `cousins`: do not use layer 1 fields there. the taste-context recommend path may use both layers, per config.
7. the engine is stateless. never persist user data, taste contexts or request history. never write anything at query time.
8. never infer, suggest or auto-apply incidental marks, priorities or avoid rules. only the user's taste context may contain them.
9. incidental is tag-level. never implement show-level incidental.
10. attribution shares must sum to exactly 100.0. never output a percent-similar between two works.
11. every tag needs evidence. no evidence line, no tag.

## style

- all repo text is lowercase: docs, comments, commit messages, data values, slugs, filenames. no capital letters, including in code identifiers. use `snake_case` for fields and `kebab-case` for slugs and values.
- plain, short, specific. no filler.
- small commits. one logical change each.

## stack (default, change only if asked)

- python 3.12+
- sqlite for storage (single file, easy to version)
- plain sql plus python. no heavy orm.
- data authored as yaml, one file per work, compiled into sqlite by a build script
- pytest for tests
- no network calls at query time. network is allowed only in explicit ingestion scripts.

## repo layout

```
readme.md
concept.md
schema.md
taste-context.md
agent.md
buildplan.md
docs/
  open-questions.md
  rubrics/            one file per axis: definitions, boundaries, counterexamples
data/
  works/              one yaml per work, e.g. psych-2006.yaml
  vocab/              controlled vocabularies, one file per axis
config/
  scoring.v0.yaml     axis weights and thresholds, versioned
src/
  build/              yaml -> sqlite compiler and validator
  query/              similarity, cousins, why, filter, drift, recommend
  ingest/             optional metadata fetchers (network allowed here only)
tests/
```

## tagging rules

when asked to tag a work:

1. read the rubric for each axis in `docs/rubrics/` before assigning any value.
2. assign values only from `data/vocab/`. if nothing fits, set `unknown` and add a note. do not coin new values.
3. each assigned value gets `role` (primary or secondary) and a one-line `evidence` (a concrete thing in the work: a scene, a recurring pattern, a character trait).
4. tag at the series level by default. add a season or volume override only when the rubric's tone or structure axes clearly shift.
5. record `tagged_by` (human or the model name), `tag_version` and `date`.
6. output goes to a draft file flagged `status: draft`. only a human review moves it to `reviewed`. only `reviewed` works enter the query graph.

## query rules

- every result carries an `explanation`: the list of shared trait nodes and each one's contribution to the score.
- ties break by work slug, alphabetically. this keeps output stable.
- scoring reads only `config/scoring.v*.yaml`. never hardcode weights.
- output includes the config version used.

## tests you must keep green

- same input and config twice returns identical output
- layer 1 changes do not alter the layer 2 score
- the validator rejects values not in the vocab
- the validator rejects tags with no evidence
- the working-example check in `buildplan.md` phase 3
- every scenario in `docs/scenarios.md`
- engine handles a request without writing to disk
- shares sum to 100.0 for every recommendation
- unknown refs in a taste context are rejected, not ignored

## when unsure

stop and ask. record the question in `docs/open-questions.md`. do not resolve schema or scope questions by yourself.
