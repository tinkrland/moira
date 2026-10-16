# motifs wrangling (ao3-style, deterministic)

governance for the motifs axis: controlled free-ish tags, wrangled
like archive of our own canonical tags, but deterministic. concepts
adapted from the owner's memorium/substrate tag-wrangling research.

## the model

ao3 wrangles by hand: volunteers map messy human tags onto canonical
tags with aliases. evie does the same, but the resolution is a rule,
not a judgment call:

1. canonical motifs live in the vocab (`data/vocab/motifs.yaml`),
   added by reviewed proposal only. a canonical value never appears
   without an owner review.
2. each canonical motif carries an explicit alias table (a list of
   phrasings that resolve to it). example:
   `will-they-wont-they-marathon` aliases: "eight seasons of will
   they wont they", "excruciating slow burn", "dragged out romance".
3. resolution at build time is exact match on a normalized alias
   (lowercase, trimmed, punctuation-folded). same input, same output,
   always. no fuzzy scoring in v0.
4. alias provenance is preserved: the authored phrasing is stored as
   written, and the resolution to the canonical motif is recorded.
   the alias is preserved as provenance; the canonical tag is the
   resolution, not a replacement.
5. an unresolved phrasing never becomes a tag. it enters the proposal
   queue for review. nothing auto-applies, ever.

## where the model is allowed to touch this

per the determinism contract, no model output ever enters the catalog
unreviewed. an assistant model (adaptionlabs credits are available if
useful) may pre-suggest canonical resolutions for queued proposals
with a confidence score, exactly the "ambiguous tail" split from the
substrate research: rules handle everything the alias table covers,
the model only drafts suggestions for what it does not, and a human
approves or rejects. the suggestion is never the resolution.

this keeps the contract intact: same catalog, same context, same
answers, because the alias table and canonical vocab are the only
inputs to resolution, and both change only by review.

## degree nuance lives here

axes carry shape, motifs carry degree and flavor. "slow-burn" is a
romantic_arc value; "eight seasons of shawn/jules-grade pining" is the
motif `will-they-wont-they-marathon`. rubrics (docs/rubrics/) define
axes; wrangling defines motifs; neither bleeds into the other.
