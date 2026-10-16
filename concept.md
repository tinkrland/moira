# concept

## problem

recommendation systems conflate surface labels with taste. "crime" is a setting label, not an experience. two people who both love "crime shows" can have almost nothing in common, and two works with different settings, professions, eras and even media can be near-identical in what they deliver.

there is a second, subtler failure: even a correct similarity can produce a wrong recommendation. you can love a show for a reason that has nothing to do with its genre, its structure or its most obvious traits. systems that infer preferences from behavior cannot know the motivation, so they flatten it.

## thesis

1. if you decompose each work into explicit parts first, you can rebuild similarity from the parts. the decomposition is the intelligence. the matching is arithmetic.
2. the engine finds real connections. only the user knows which connections represent their taste. so the user declares it, explicitly, per tag.

## three things kept separate

| thing | question | who decides |
|---|---|---|
| structural similarity | what do these works share? | the catalog (fixed, user-independent) |
| personal relevance | which of those shared things do i actually care about? | the user, explicitly |
| provenance | why was this recommended? | the engine, from the two above |

the connection can be real and the recommendation still wrong for you. the engine never conflates the first two.

## the two layers of a work

### layer 1: classification dimensions ("the parents")

explicit metadata about what a work is classified as. filterable. in the crime module: genre tradition, mystery mechanism (whodunit, howdunnit...), investigative lens (cop, forensic, consultant, amateur...), subject of the detecting (murder, financial...), legal role.

### layer 2: compositional traits ("the dna")

what the work is actually made of, often cross-genre: attitude toward authority, protagonist archetype and manner, how the narrative treats the protagonist's flaws, tone, the fantasy being sold, structure, stakes, relationship to technology, motifs.

### the independence claim

layer 1 does not predict layer 2. this is the core claim and it must stay testable. if analysis shows layer 1 predicts layer 2 well, the second layer is redundant and the premise needs revisiting.

## surface trait vs meaningful affinity

a surface trait is "abrasive protagonist." the meaningful affinity may be "a woman who is abrasive and whose story never demands she be corrected." the first is easy to detect and wrong to recommend on, because a show with an abrasive male lead shares the surface trait and misses the point entirely.

so the decomposition must capture what the narrative does with a trait, not just that the trait exists. and affinities must be able to be compound: several traits that only count together.

## incidental

the user can mark an inferred tag as incidental. rules:

- incidental is algorithmic, not emotional. it does not mean unimportant. it means "do not build my taste profile from this."
- it is applied per tag, not per show. the show stays a positive signal. only the marked tag stops contributing.
- default scope is the work: "cozy" is incidental for this show, but still counts when it comes from a different show. a global scope is possible.
- reasons it is needed (all real cases):
  - nostalgia or provenance: a favorite because of who you watched it with. its cozy, small-town, family tags are incidental.
  - a tag from a show you watch for another reason: you only like whodunits, but you watch a howdunit for the lead. "howdunit" is incidental.
  - a surface trait that is only meaningful in combination: "abrasive protagonist" is incidental on its own, while the compound affinity is kept.
- the engine never guesses incidental. it only surfaces the tags. the user toggles.

## provenance map

every recommendation can show:

- contribution: the share of the score attributable to each shared tag. shares sum to 100. this is attribution across tags, never a "these two works are 87% similar" number.
- priority: a separate user-ordered hierarchy (a pyramid) of what matters most. a tag with a 5 percent contribution can still sit at the top of the pyramid, because priority is not contribution.

## the graph

- nodes: works, trait values, optionally people and series
- edges: work -> trait value (role, evidence), work -> work (adaptation, sequel, same-universe)
- similarity and recommendation are fixed, versioned formulas over shared trait nodes
- queries are traversals: cousins (high layer 2 overlap, low layer 1 overlap), why, profile, recommend, drift, exclude

## statelessness

the engine stores no user data. every request carries the user's taste context: liked works, incidental marks, priority order, avoid rules. same catalog + same taste context + same config = same answer. a device can keep the taste context locally and send it per call. this keeps the engine simple, cheap and free of identity-level profiles.

## what "deterministic" means here

given the same stored catalog, the same taste context and the same scoring config version, a query returns the same ranked results with the same provenance. nothing is sampled, learned or estimated at query time.

it does not mean tagging is objective. tagging is human judgment (or model-assisted judgment) against a written rubric, then reviewed and frozen. the engine is deterministic. the catalog is curated. never blur these.

## the working example

| cluster | examples | authority comes from | fantasy | tone |
|---|---|---|---|---|
| institutional | the rookie, blue bloods | the badge, the system, family legacy | the system works and good people run it | earnest |
| outsider-lens | psych, the mentalist, elsbeth, ludwig, high potential | a quirk or gift, being underestimated | the overlooked person wins by seeing differently | warm-comedic |

the engine should separate these clusters even though both are filed under "crime / procedural."

## future: consumer side

a thin layer over the engine. the user names works, sees what the engine decomposed, marks what is incidental, sets priorities, and gets recommendations with provenance. out of scope until the engine passes the checks in `buildplan.md`.
