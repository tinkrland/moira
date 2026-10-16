# technobabble - the design ramble

why moira is shaped the way it is. the how is in `underthehood.md`; this
is the why.

## one person, many contexts

every system you use flattens you into a single profile. your study
notes, your investor updates, your half-finished novel, your customer
support smile - one account, one context, one gray blend. the blending
isn't a bug the apps will fix; it is the product. you are the training
data.

moira starts from the opposite assumption: **just because you're one
person doesn't mean you have the same context.** the student and the
founder are both you, but what the student is learning is not what the
investors need to know, and your creative side is not your customer
service voice. so the persona is the primitive - not the account, not the
"workspace". a persona has its own memory, keys, connectors, and budget,
and the separation is enforced by the policy engine, not by convention.

## passes: the answer to "just give me access"

when an app wants your context, the industry answer is oauth: hand over a
long-lived token to everything, forever. moira's answer is a **pass**: a
narrow grant of (persona, category, purpose, duration) that an agent
presents per read. it is closer to a ticket than a key - a ticket to one
wing of one building, for one afternoon, and every use is stamped.

this is also why "no pass" is not an error but an **approval link**: the
agent learns nothing except that it should ask. absence of consent leaks
nothing, not even the existence of what it wanted.

## taint: provenance that survives rephrasing

the moment you can summarize a memory, you can launder it: "the user
often talks about X" sounds softer than the raw fact, but it carries the
same linkability. moira's taint algebra makes labels combine
most-restrictive-wins and forces summarization to be label-preserving.
the only way to remove a label is an explicit owner act. provenance is
physics, not metadata.

## rungs: you author what gets said about you

a fact can be served at increasing levels of detail: that something
exists, an outline, its content, a conclusion about it. moira derives
only the lowest rung mechanically; every higher representation must be
**authored** at write time. the system will never invent a conclusion
about you and attribute it to your data. if llm-generated rungs arrive
later, they arrive as authored artifacts subject to the same algebra, not
as on-the-fly spin.

## determinism as a security property

the policy engine is pure functions. no clocks, no randomness, no io in
decisions. that is usually framed as an engineering convenience; here it
is the security story: the same inputs always produce the same decision,
so decisions can be replayed, audited, and pinned by tests. an llm in
the decision path would make moira's guarantees probabilistic. the llm
belongs in the connectors (reading provider text) and eventually in evie
(reasoning over taste) - never between a pass and a fact.

## connectors: consent to the job, not the provider

the connector tree is organized by **jobs** - retrieve your files, manage
projects, track your films - because the job is what you actually want
done. the provider is interchangeable fulfillment underneath. your
consent attaches to the job: swapping dropbox for drive changes one
array, not your relationship with moira.

and everything from a connector is **untrusted at ingress**: provider
text is data, not truth. it never becomes a preference without owner
confirmation. your taste is what you say it is; a platform's engagement
metrics are someone else's model of you.

## evie: taste, decoupled

the taste engine is a separate component with its own branch, plugged in
rather than intertwined. it reads facts and signals, never gates access
decisions, never writes without confirmation. the deterministic core
stays deterministic, and the taste block in the connector tree is
registered but gated: the status field says `evie` in the code itself.
no phantom features.

## bridges: relationships, not merges

sharing between two personas is not "sync". a bridge is a two-sided,
rung-capped, budgeted channel with explicit ingress on each side - and
nothing ever auto-merges across it. the same shape will model
person-to-person context sharing later: a relationship between two
people is consented structure, not a merged profile.

## deletion must be real

a persona's keys are random, never derived. deleting the persona shreds
them, severs the bridges and packs, destroys the ledger secrets, and
leaves content-free receipt stubs. it is irreversible because the
ciphertext becomes undecryptable by anyone, including us. "delete"
that survives in an archive is not deletion, it is storage with a
costume.

## outcomes are honest or they are nothing

every tool call returns an explicit outcome - `results`, `empty`,
`approval_required`, `declined`, `expired`, `locked`, `unavailable`. a
locked database is never reported as "no memories found"; unknown
budget state is never "no limits". ambiguity is how systems lie, and a
context engine that lies about its own state is a liability in a way
nothing else in the stack can be.

## modality follows the model

browser first, command line native, cards potentially: the pass model
(scope, purpose, duration, receipt) is exactly the shape of "tap my card
so i share this much with you, here, now, on the record". the surfaces
change; the consent semantics never do.
