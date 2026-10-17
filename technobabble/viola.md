# viola

viola is moira's voice engine, and it lives on this branch the way evie
lives on hers: a decoupled component with its own line of development,
until it starts. evie is opinionated about what you like; viola is
opinionated about how you sound.

## the question viola answers

what makes the unique dna of a persona's voice in a cyber context: speech
style, cadence, prosody (in text, its measurable shadow: punctuation as
tone, sentence-length spread, lowercase style, emoji density), typing
patterns and quirks. the answer is used to define the CONTEXT an agnostic
agent works from, so any model can write as this persona seamlessly.

**this is not training.** the owner's direction, verbatim in intent: not
training, but defining the context for the agent. no model absorbs persona
signals (evie's rule, generalized). the corpus is measured, never learned
from.

## what exists on this branch

- **corpus** (`voicedna.js`): owner-added writing samples per persona,
  medium-tagged, sealed under the persona's voice category key. plaintext
  never rests in the store.
- **measurement**: pure functions over the corpus, in regent's three layers:
  - **lingvist**: scripts drawn on, their shares, mixed-script utterances.
    scripts are exact; dialects are never guessed.
  - **lexica**: fillers, hedges, signature phrases, counted from the corpus.
    counted, not described.
  - **lingvica**: avg words per sentence, sentence-length spread (cadence),
    exclamation/question/ellipsis rates, lowercase ratio, emoji density.
- **quirks**: owner-declared, never inferred. measurement counts what is
  there; the owner states what it means.
- **handoff**: `voice_dna_get` gives agents the layers + quirks + digest,
  pass-gated under the voice category. the corpus itself never reaches an
  agent. context, not data.
- **digest**: sha256 of the canonical layers. same corpus, same digest,
  every time. if two measurements disagree, something is broken.

## the rules viola keeps

1. **context, not training.** the profile is a handoff object, and the
   agent's side does the replication. viola never trains anything.
2. **absent means absent.** a medium with no samples is recorded absent,
   never zero-filled, never invented.
3. **counted, not described.** every field is traceable to a measurement or
   an owner declaration, per regent's glossary discipline. "sounds casual"
   is a vibe pretending to be a measurement; "0.8 lowercase ratio" is a
   measurement.
4. **one layer at a time.** per voice.md's delta rule: an owner edit moves
   a layer and says which. layers stay independently debuggable all the way
   to the agent.
5. **sealed corpus, open profile.** raw samples live in the vault; layers
   and quirks are the shareable shape.

## what the yaptele research wing changes here (critique, stylometry, platform-shift)

the owner's reference docs land three rules on viola, after dropping the
spoken/audio half (acoustic cloning is not moira's problem; text is):

- **a voice is not one static thing** (critique): viola measures per
  medium and reports the shift between mediums as first-class signal,
  never averaged into one flattened profile. a texting register, a slack
  register and a twitter register for the same persona are separate
  measurements. a tuning that cannot move one parameter without dragging
  others is not controllable, so every delta is per field.
- **stylometry is the feature checklist** (stylometry.md): function words
  are the field's workhorse (grammar, not topic: style stays orthogonal
  to topic and viola never claims topics), sentence-length distribution
  and punctuation habits are precedented, and code-switch rate is a
  validated stylometric feature in published authorship work, not a
  novelty. a proposed viola field maps to something stylometry already
  measures or it does not ship.
- **fragmentation is signal** (platform-shift): each medium-persona
  combination is its own sample set. thin corpora (fewer than three
  samples) are flagged lowSample rather than silently confident, absent
  mediums stay absent, and the open question (how many medium-persona
  combos are worth tracking) is answered operationally: mediums are free
  tags, measurement follows the tags, nothing is pre-merged.

honest limits, stated rather than papered over: no prosody ground truth
exists for text (lingvica measures typing rhythm's shadow: punctuation,
cadence spread, casing, emoji), no channel-shift correction, and no
authorship-attribution claims. viola's measurements define context for
agents; they do not certify identity.

## later, deliberately not built yet

- connector-fed corpus: scraping a persona's own public feed is a connector
  job (registry's scrape lineage, firecrawl/tavily shaped), feeding
  sampleAdd. not built.
- sandbox simulation and scoring (regent's steps 3-4) happen outside moira:
  they are model work, and moira is the deterministic side.
- prosody proper (audio) is a channel problem for the day voice calls exist.
