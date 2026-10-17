# voice: what it is, and how it stays separate

this answers the standing open question: what constitutes a "voice" for a
persona, and how is it kept separate? references: the yaptel ecosystem
(yaptel/yaptel, yaptele the measurement side and regent the delivery side)
laid this out better than we had.

## the mistake to avoid

a voice is not a paragraph of adjectives ("witty, sarcastic 25-year-old")
applied identically everywhere. that is a vibe, not a measurement, and it
collapses the two things that matter most:

- a real voice SHIFTS by medium and audience (text to a friend vs a work
  message vs a post), usually without the speaker noticing
- when a reconstructed voice sounds off, a collapsed vibe cannot tell you
  WHAT is off. you can only shrug.

## voice has three separately-measured layers

keeping the layers separate is the whole trick, because "sounds off"
becomes actionable:

- **lingvist (languages)**: which language(s), code-switching and WHY
  (emphasis, a joke that only works there, no clean translation, signaling
  who is being addressed), transliteration habits, go-to loanwords.
- **lexica (words)**: vocabulary only. regular slang, generational markers,
  which fillers specifically, hedges, default idioms. not tone, not grammar.
- **lingvica (delivery)**: how it is said. formality per medium, warmth /
  sarcasm / playfulness / confidence as SCORES not adjectives,
  punctuation-as-tone (a period reads cold, "..." reads hesitant), emoji
  density.

in moira terms: a persona's voiceProfile is structured, traceable, and
layer-aware, and registers (already keyed per medium in v0) are exactly
where per-medium shifts live. a voice is the measured object; the register
is the medium-specific displacement of it.

## the delta rule

a tuning change must be able to move one layer without dragging the others,
and every change reports a delta vector: which layers moved, by how much.
in moira this becomes an auditability requirement on owner voice edits: an
edit to a persona's voiceProfile is recorded as a layer-scoped delta in the
receipts, so "we adjusted the tone for slack" never silently rewrites the
slang usage too. a tool that cannot move one trait without moving three is
not under control; it is guessing.

## absent, not invented

if the target has no material in a medium, that medium is recorded as
absent. a missing data point is a correct, honest result; an invented one
is not. this is already a moira principle everywhere else (no phantom
verification, unknown is never unlimited), and the voice layer gets the same
rule: no samples in a medium means the register for that medium is absent,
not filled with a plausible guess.

## the honesty rule

a reconstructed voice discloses that it is a reconstruction when asked,
mid-conversation, no exceptions. this is what separates studying how voice
works from building an impersonation tool, and it matches what moira already
enforces structurally: the red lines (never invent experiences, credentials
or quotes), and the heteronym authorship disclosure modes (secret, open
secret, declared). a heteronym is a declared reconstruction of a person that
does not exist; the disclosure mode is the honesty rule, as a first-class
property.

## how this keeps personas' voices separate

isolation stops being just "different profiles per persona, sealed and
pass-gated" and becomes measurable per layer:

- a pseudonymous persona's deliberatelyDistinct flag becomes a per-layer
  distance: the goal is hiding that the same author wrote it, so the layers
  that carry authorship (filler choice, hedging rhythm, punctuation-tone)
  must be far from the owner's, not merely labeled different.
- the heteronym cross-contamination detector (spec 13/18) gets a real job:
  flag output that matches the OWNER's lexica or lingvica instead of the
  character's, and say which layer leaked. "the voice is a bit off" becomes
  "vocabulary drifted toward the owner; canon and tone are clean".
- per-persona exemplars stay pass-gated: exemplars are a stylometric
  fingerprint, and now the fingerprint has structure instead of being a pile
  of prose.

## the delivery half (regent)

a voice profile is a handoff object: yaptele measures it, something else
lives it. moira is already that shape: the profile is per persona, sealed
in the vault, and voice_get hands it to agents through a pass, scoped to a
register. what regent adds to the picture is the reason a persona needs one
continuous voice across every channel it is reachable on: the same person
calls, texts, or messages, and the persona must not forget itself between
channels. moira's persona is the continuous identity; the voice profile is
what makes it sound like the same hat everywhere it speaks.
