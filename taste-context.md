# taste context

the only user-specific input to the engine. a plain document sent with each request. the engine never stores it.

## shape (yaml shown, json equivalent)

```yaml
taste_context_version: 1
liked:
  - work: elsbeth-2024
    strength: loved            # loved | liked
  - work: psych-2006
    strength: liked
incidental:
  - work: elsbeth-2024         # work-scoped: only this work's contribution of the tag is ignored
    trait: {axis: mystery_mechanism, value: howdunnit}
  - work: gilmore-girls-2000
    trait: {axis: tone, value: cozy}
  - work: null                 # global: this tag is ignored for every liked work
    trait: {axis: world, value: period}
affinities:                    # compound: all_of traits must be present on the same work to count
  - id: allowed-to-stay-abrasive
    all_of:
      - {axis: lead_manner, value: abrasive}
      - {axis: lead_gender, value: female}
      - {axis: lead_flaw_treatment, value: flaw-tolerated}
priority:                      # top to bottom; items are trait refs or affinity ids
  - affinity: allowed-to-stay-abrasive
  - {axis: authority_stance, value: outsider-underestimated}
avoid:                         # hard exclusion: a candidate matching any entry is dropped
  - all_of:
      - {axis: lead_manner, value: abrasive}
      - {axis: lead_gender, value: male}
```

## rules

- every `work` and `trait` reference must exist in the catalog. unknown refs are an error, never ignored silently.
- `incidental` is tag-level. there is no show-level incidental. to remove a work entirely, drop it from `liked`.
- default scope of incidental is the work. `work: null` means global and must be explicit.
- the engine never adds, removes or suggests incidental marks. it only surfaces tags so the user can.
- an affinity counts for a candidate only if every `all_of` trait is present on that candidate. no partial credit in v0.
- a trait that is marked incidental for a work cannot be used to build that work's contribution, but can still be part of a compound affinity if the user lists it there.
- priority is independent of contribution. see schema.md for how it affects ranking.
- the response echoes the taste context version and the config version used.

## output: recommendation record

```yaml
candidate: the-mentalist-2008
score: 0.71
provenance:
  contributions:               # shares of score by tag, sum to 100.0
    - {trait: {axis: authority_stance, value: outsider-underestimated}, share: 31.4}
    - {trait: {axis: fantasy, value: underdog-vindication}, share: 22.0}
    - {affinity: allowed-to-stay-abrasive, share: 5.0}
    - ...
  priority_pyramid:            # user order, independent of share
    - {rank: 1, item: allowed-to-stay-abrasive, matched: false}
    - {rank: 2, item: authority_stance/outsider-underestimated, matched: true}
  ignored_as_incidental:       # shown so the user can see what was withheld
    - {work: elsbeth-2024, trait: mystery_mechanism/howdunnit}
config_version: scoring.v0
```
