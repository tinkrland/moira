# rubric agreement test (phase 1 gate)

the schema is the product, and the product is only as good as two
people reading the same rubric and landing on the same tag. this is
that check.

## the five works

chosen to span both clusters from the readme's one-paragraph idea,
plus the romance axes:

1. ludwig (2024)
2. the mentalist (2008)
3. high potential (2024)
4. ncis (2003)
5. blue bloods (2010)

## the five rubric axes

the axes with drafted rubrics (docs/rubrics/):

- fantasy (multi: pick 1-2)
- authority_stance (single: pick 1)
- lead_flaw_treatment (single: pick 1)
- romantic_arc (single: pick 1)
- romance_dynamic (multi: pick 0-2, skip if the arc is none)

## how to run it

1. read the five rubrics in docs/rubrics/ (fantasy, authority_stance,
   lead_flaw_treatment, romantic_arc, romance_dynamic).
2. fill in `form.md` for the five works, independently. do not read
   `agent/` first. that is the sealed envelope.
3. hand the form back. agreement is computed per slot: a slot is one
   axis value for one work (fantasy and romance_dynamic compare
   primary sets). a match means both taggers put the same value in
   the slot.
4. the gate is 80 percent of comparable slots. disagreements are not
   failures of a tagger: they are rubric defects or genuine ambiguity,
   and each one is either fixed in the rubric or logged in
   docs/open-questions.md before phase 2 tagging starts.

## status

started 2026-10-16. agent tags sealed in `agent/` (do not peek).
owner form pending.
