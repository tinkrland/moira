# scenarios

acceptance scenarios for the engine. each is a concrete case the engine must handle. tag assignments below are illustrative; the real values come from reviewed catalog data.

## s1: incidental mechanism on a liked show

given: a user likes mostly whodunits and also likes elsbeth, which is a howdunnit, because of the lead and how she is written.
when: the user marks `mystery_mechanism/howdunnit` incidental, scoped to elsbeth.
then:
- elsbeth stays in the liked set.
- its other tags still contribute.
- howdunnit does not contribute to the profile from elsbeth.
- recommendations do not rank higher just for being howdunnits.
- the provenance output lists the withheld tag under `ignored_as_incidental`.

## s2: nostalgia

given: a user's most-talked-about show is a favorite because they watched it with a parent.
when: the user marks cozy, small-town and mother-daughter-relationship incidental, scoped to that show.
then:
- those three tags stop contributing from that show.
- the show remains a positive signal for its remaining tags.
- cozy still counts if it comes from a different liked show where it was not marked.

## s3: surface trait vs compound affinity

given: a user loves a show with an abrasive woman lead whose flaws the narrative never corrects. they hate the same personality on a male lead.
when: the user marks the generic abrasive-lead tag incidental and declares a compound affinity of abrasive manner + female lead + flaw tolerated by the narrative. they add an avoid rule for abrasive manner + male lead.
then:
- a candidate with an abrasive male lead scores nothing on that affinity and is dropped by the avoid rule.
- a candidate with an abrasive female lead whose flaws are corrected by the story does not match the compound affinity.
- a candidate matching all three traits scores on the compound affinity.

## s4: provenance is attribution, not similarity

given: any recommendation.
then:
- contributions are shares of the score across tags and sum to exactly 100.0.
- no output field presents a "percent similar" between two works.
- the priority pyramid shows the user's order, and an item with a small share can sit at the top.

## s5: determinism and statelessness

- the same request twice returns identical bytes, including order and shares.
- the engine writes nothing to the catalog or any user store when handling a request.
- two different taste contexts against the same catalog give different results, with no state carried between calls.

## s6: cousins across surface genres

- the engine returns at least one work pair with zero shared genre_tradition values and a high dna_score, and the `why` output makes the kinship legible.

## s7: the working example

- the rookie and blue bloods are closer to each other than either is to psych.
- psych, elsbeth, the mentalist, ludwig and high potential cluster together on dna_score while sharing most layer 1 fields with the institutional cluster.
