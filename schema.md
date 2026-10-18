# schema (v0 draft)

a first draft to be attacked, not a final answer. every value needs a written definition and a counterexample in `docs/rubrics/` before it is used for tagging.

## entities

### work
one node per work. series-level by default.

```
id               internal slug, e.g. psych-2006
title
medium           book | tv | movie
unit             series | standalone | season_override | volume_override
first_release    year (must be >= 2000 for v0)
origin           list of country codes (must include an anglosphere country)
language         original language (must be english for v0)
creators         list (names only, optional)
external_ids     wikidata, tmdb, openlibrary, isbn (nullable, never invented)
status           draft | reviewed
tag_version      integer, increments on any retag
```

### work_link
```
from_work, to_work
kind             adaptation_of | sequel_of | same_universe | remake_of
```
linked works are tagged separately. adaptations often change tone, stakes and structure.

### trait_value
a node in the vocab. belongs to exactly one axis.
```
axis, value (kebab-case), layer (1 or 2), definition, counterexample
```

### work_trait (the edge)
```
work_id, axis, value
role             primary | secondary
evidence         one line, concrete
```
rules: single-select axes allow exactly one primary and no secondary. multi-select axes allow up to 2 primary and up to 3 secondary.

## layer 2 core axes (every work gets these)

these drive similarity.

| axis | select | values |
|---|---|---|
| tone | multi | warm-comedic, dry-satirical, cozy, earnest, grounded-gritty, stylized-dark, paranoid-tense, absurdist, melancholic |
| authority_stance | single | institution-believer, institution-cynic, adjacent-consultant, outsider-underestimated, adversarial-vigilante, criminal-protagonist |
| protagonist_gift | multi | puzzle-intellect, people-reading, social-manipulation, physical-tactical, procedural-craft, moral-authority, charm, supernatural |
| ensemble_shape | single | solo, odd-couple, workplace-team, found-family, literal-family |
| fantasy | multi | competence, justice, puzzle, belonging, comfort, transgression, underdog-vindication |
| structure | single | standalone, episodic-closed, hybrid-arc, serialized |
| resolution | single | always-closed, mostly-closed, often-open, open |
| stakes | single | low, medium, high, existential |
| world | single | realist, heightened, supernatural-overlay, scifi-overlay, period |
| tech_mediation | single | low, medium, high |
| lead_gender | single | female, male, nonbinary, mixed-ensemble, unknown |
| lead_manner | multi | abrasive, eccentric, charming, earnest, deadpan, overzealous, reserved |
| lead_flaw_treatment | single | flaw-corrected, flaw-tolerated, flaw-celebrated, no-flaw-focus |
| romantic_arc | single | none, slow-burn, on-off-cycle, early-resolved, central-premise |
| motifs | multi | controlled free-ish tags, added by reviewed proposal only |

notes:
- `structure` and `resolution` must read sensibly for a novel: episodic-closed means each book or story resolves its own case; serialized means the arc spans volumes.
- `fantasy` is the most important and the hardest axis. write its rubric first.
- `lead_flaw_treatment` records what the narrative does with the lead's flaws, not whether flaws exist. this is what separates a surface trait (abrasive lead) from a meaningful affinity (an abrasive lead the story never demands be fixed). it must be defined by observable narrative behavior in the rubric.
- `lead_gender` and `lead_manner` are factual protagonist fields. they exist so compound affinities and avoid rules can be expressed.
- `romantic_arc` is core (every work carries it, `none` included). the optional
  axis `romance_dynamic` (partners-to-lovers, friends-to-lovers, enemies-to-lovers,
  forbidden, reunion, second-chance) is tagged only when a romance exists. degree
  nuance ("eight seasons of will-they-wont-they") is not more values: it lives in
  wrangled motifs (see docs/motifs-wrangling.md).
- motifs are governed ao3-style: canonical values with aliases, alias provenance
  preserved, reviewed proposals only, nothing auto-applied (see docs/motifs-wrangling.md).
- `authority_stance` is where the rookie and psych separate. it is about the protagonist's relationship to power, not their job title.

## layer 1 classification fields (filter and label only)

### core layer 1
```
genre_tradition  multi   crime, noir, cozy-mystery, legal, thriller, spy, fantasy, sci-fi, romance, horror, drama, comedy ...
setting_geo      single  country or region of the story world
setting_scale    single  rural | small-town | island | suburban | urban | metropolis
setting_era      range   years the story is set in
creators         multi   names (never part of dna_score)
lead_performers  multi   names (never part of dna_score; enables 'watched for the actor' cases)
```

### crime module (active when genre_tradition includes crime, noir, cozy-mystery, legal or thriller)

```
crime_relation     single  solving | committing | defending | combination

gift_origin        single  none | nature | nurture | both | acquired      (core layer 2)
gift_kind          multi   eidetic-memory | hyperthymesia | high-iq | hyper-observation | supernatural-gift  (optional: tagged when an endowment exists)
gift_cover         single  none | skill-as-supernatural | supernatural-as-mundane  (optional: tagged when a gift is masked)
mystery_mechanism  multi   whodunit | howdunnit | whydunnit | proving-it | inverted | caper | none
lens               multi   cop | sheriff | fed | intelligence | spy | private-eye | consulting-detective | criminal-consultant | forensic-scientist | forensic-support | amateur | journalist | military | firefighter | legal
detecting_subject  multi   murder | financial | disappearance | fraud | cybercrime | organized-crime | cold-case | espionage | other
legal_role         multi   (only if crime_relation includes defending) prosecution | public-defense | criminal-defense | civil | white-collar-legal
```

notes:
- `lens` is the job or vantage point. `authority_stance` is the relationship to power. keep them separate: a consulting-detective lens can pair with several stances. lens is multi-select: psych is private-eye and consulting-detective at once.
- the consultant value is split: `criminal-consultant` is a criminal consulting for law enforcement (white collar); `consulting-detective` is a civilian detective (sherlock, ludwig, monk). `sheriff` covers rural county law enforcement, which is a different institution than an urban precinct. forensic splits the same way: `forensic-scientist` is the protagonist focus (bones); `forensic-support` is the accompanying csi-style role inside law enforcement.
- `setting_scale` matters because the community changes the show: rural means sheriffs and spread-out jurisdictions, metropolis means precincts, and small-town means a recurring community cast (stars hollow, brokenwood mysteries), and island is its own texture: a water-bound community where geography shapes everything (death in paradise, shetland).
- `proving-it` marks the later, evidence-and-courtroom phase of the case rather than the discovery phase.
- `combination` is for works that mix solving, committing or defending in the same run.

## modules planned later

romance, fantasy, sci-fi, horror, literary. each adds its own layer 1 fields. core layer 2 axes stay shared so cross-module similarity still works.

## similarity (v0)

```
dna_score(a, b) = sum over layer 2 axes of weight[axis] * overlap(a, b, axis)
```

- single-select axis: overlap = 1 if equal, else 0
- multi-select axis: weighted jaccard, primary = 1.0, secondary = 0.5
- weights live in `config/scoring.v0.yaml`, initial default 1.0 for every axis except `fantasy` and `authority_stance`, which start at 2.0 (to be tested, not trusted)
- normalize by the sum of weights so scores range 0 to 1
- layer 1 is never part of dna_score

### explanation
the result is the sorted list of (axis, value, contribution) for every shared node. this is the answer to "why".

### query forms
- `similar(work, k, filters)` rank by dna_score after optional layer 1 filters
- `cousins(work, k)` dna_score >= threshold and layer 1 overlap <= max_layer1
- `why(a, b)` shared nodes with contributions, plus layer 1 overlap for contrast
- `profile(works[])` intersect layer 2 traits across several works (the "what you actually like" view)
- `exclude(traits)` any query plus a negative trait filter
- `drift(trait, by)` how a trait or archetype distribution changes by year, country or medium

## example data file (illustrative, not canonical)

```yaml
id: psych-2006
title: psych
medium: tv
unit: series
first_release: 2006
origin: [us]
language: english
status: draft
tag_version: 1
tags:
  authority_stance:
    - value: outsider-underestimated
      role: primary
      evidence: protagonist is dismissed by police until results prove him right
  tone:
    - value: warm-comedic
      role: primary
      evidence: case-of-the-week plots built around running jokes and banter
  fantasy:
    - value: underdog-vindication
      role: primary
      evidence: the doubted outsider is proven right at the end of most episodes
    - value: belonging
      role: secondary
      evidence: central friendship anchors every episode
crime_module:
  crime_relation: solving
  lens: [consulting-detective, private-eye]
```

## recommendation scoring (taste context)

separate from work-to-work `dna_score`. this is the path used with a taste context (see `taste-context.md`).

### profile
for every trait value t (and every compound affinity a) build a support value from the liked works:

```
support(t) = sum over liked works w that carry t, unless (w, t) is marked incidental
             or t is globally incidental, of  role_weight(w, t) * strength(w)
```

- role_weight: primary 1.0, secondary 0.5
- strength: loved 1.0, liked 0.6 (config)
- a compound affinity a has support = sum over liked works that carry every all_of trait of strength(w)
- all axes are eligible, layer 1 and layer 2. which axes matter more is set by config axis weights, with layer 1 axes defaulting lower than layer 2. incidental marks apply to any axis.

### candidate score
```
contribution(c, t) = axis_weight[axis(t)] * normalized_support(t) * present(c, t)
score(c) = sum of contributions, normalized to 0..1
```
- candidates in `avoid` are dropped before scoring
- liked works are excluded from results

### attribution (provenance)
```
share(t) = 100 * contribution(c, t) / sum of contributions
```
- shares are rounded to one decimal with largest-remainder so they sum to exactly 100.0
- shares are attribution across tags. never output a percent-similar between two works.

### priority
priority is the user's ordered must-have hierarchy and is independent of share. v0 rule (config-driven, see open questions):
1. rank candidates first by how many top-tier priority items they match (lexicographic by tier, top first)
2. then by score
3. then by slug

so a tag worth 5 percent of the score can still sit at the top of the pyramid and gate the ranking.

### explanation outputs
- contributions (tag shares)
- priority pyramid with matched or not
- `ignored_as_incidental`: tags withheld, so the user sees what they excluded
