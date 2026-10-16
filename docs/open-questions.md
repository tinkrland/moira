# open questions

unresolved decisions. agents must not resolve these on their own. add new ones here with a date and a proposed default.

1. series granularity: series-level node with season overrides, or one node per season for tone-shifting shows (sherlock, hannibal)? current default: series-level plus overrides.
2. anglosphere definition: country of origin only, or also language and production base? how are co-productions (uk/us, canada/us) handled? current default: any anglosphere origin country plus english original language.
3. books: unit of tagging for long series (one node per series, or per book when tone shifts)? current default: series-level.
4. who does first-pass tagging: human only, or model-assisted into drafts that a human reviews? current default: model-assisted drafts allowed, human review required.
5. fixed axes vs open vocabulary: how much of motifs and module fields can grow freely without breaking comparability? current default: fixed core axes, motifs added by reviewed proposal.
6. tagging disagreements: when two reviewers disagree on a primary value, who decides, and is the rubric updated every time? current default: rubric is updated, data follows.
7. weights: are per-axis weights global or per-module? are they ever user-adjustable later? current default: global, fixed in v0.
8. adaptation handling: how much do shared source and shared creators count as similarity, if at all? current default: not counted in dna_score, shown as a separate link.
9. cross-medium comparability: do tone, structure and resolution read the same for a novel as for a series? needs a test in phase 4.
10. naming: project name `latent` is a placeholder.
11. "fantasy" axis: single concept or too overloaded? may need splitting into fantasy_of_agency and fantasy_of_belonging.
12. unknown values: how should the score treat `unknown` (skip the axis for that pair, or count as no match)? current default: skip the axis and renormalize.
13. incidental scope default: work-scoped (this work's contribution of the tag) with an explicit global option. confirm this is the right default.
14. priority semantics: lexicographic gate by tier (current default) vs a weight multiplier. the gate keeps a small-share tag at the top of the pyramid; a multiplier would inflate its share.
15. compound affinities: strict all-or-nothing in v0. is partial credit ever wanted?
16. avoid rules: hard exclusion in v0. soft penalty later?
17. strength levels for liked works: loved and liked only, or also a lukewarm and a disliked tier?
18. where do compound affinities come from: user-authored only in v0, or can the engine propose candidates built from tags that always co-occur in the user's liked works (proposal only, never auto-applied)?
19. layer 1 tags in recommend scoring: default lower weights than layer 2. confirm the ratio.
20. engine and app names: `latent` is a placeholder. the chat export used other names for engine and app; left out on purpose.

21. (2026-10-16, phase 0) work yaml link syntax: `work_link` rows need a
    source in the per-work yaml files. proposed default added in phase 0:
    optional `links` list on a work file, entries `{work: <slug>, kind:
    adaptation_of|sequel_of|same_universe|remake_of}`, validated at compile
    time against the catalog. needs owner confirmation.
