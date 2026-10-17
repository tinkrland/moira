# inspiredby - lineage and influences

nothing here is built in a vacuum. this is what moira draws from, and what
it deliberately does differently.

## the measured voice

the answer to "what is a voice" comes from the yaptel ecosystem
(yaptele, the measurement side; regent, the delivery side): a voice is
three independently-measured layers (languages, words, delivery), not a
paragraph of adjectives, with per-medium registers, delta-scoped tuning,
absent-not-invented for unsampled media, and a mid-conversation disclosure
rule. moira's divergence: yaptele measures public figures' speech as
research; moira's profiles are the owner's own hats, sealed per persona,
pass-gated, and the cross-contamination detector exists to keep hats from
sounding like each other, not to clone anyone. see voice.md.

## the connector-block pattern

the idea of organizing a personal agent's world into blocks of connected
services (ego.ist popularized this shape) is the visible ancestor of the
connector tree. moira's divergence is structural: blocks there are
marketing categories over a flat provider list; here the **job is the
consent unit** and providers are swappable fulfillment under it. the
tree renders the consent screen, the settings page, and the registry from
one source of truth.

## cresca.ai-style persona-wise connections

the "people connections" item on the roadmap - relationships modeled
per-persona, where a person-connection is a consented bridge scoped to
two specific personas - follows cresca's insight that you relate to
people differently as different selves. moira already has the primitives
(bridges, rungs, budgets); the product surface is deliberately later.

## the csv-export culture

goodreads, storygraph, letterboxd, last.fm, tv time: the platforms
where people record deliberate acts of taste are mostly the platforms
without apis - they live on csv exports and imports. that constraint
shaped the taste block's adapter kind: **ingest**, the owner brings the
export, every row tagged untrusted with source attribution. the data is
richer than api pings anyway - a rating is a preference statement someone
chose to write down.

## archive of our own, and pi.fyi

ao3's import culture and pi.fyi's "rooms" of favorites share something
worth keeping: taste expressed deliberately, in public, with structure -
not inferred from clicks. the stories job and the shares job are direct
descendants of that philosophy.

## capability-based security

passes, owner contexts, packs, and leases are all capabilities - narrow
tokens that carry their own authority, unforgeable by construction. this
is decades of capability-model thinking applied to personal context.
the "no pass = approval link" behavior comes from the same place: the
absence of a capability is a request, never a failure that leaks state.

## append-only ledgers

receipts are append-only and signed, in the tradition of audit logs and
blockchain thinking, minus the blockchain: no global consensus, just
"what was shared, by whom, when" being an immutable record owned by the
person it describes. content-free by design - the receipt proves sharing
happened without containing what was shared.

## key shredding / crypto-shredding

deleting a persona by destroying its keys (rather than marking rows
gone) is the standard crypto-shredding pattern: random per-persona keys,
wrapped under one instance key, deleted on request. the deletion is real
because the math makes it so.

## the deterministic-core pattern

pure policy engines behind a thin io shell is an old idea (database
kernels, kernel design, functional cores / imperative shells). moira
applies it to personal privacy: the guarantees you care about should be
replayable and testable, so the interesting logic takes no inputs it
cannot recompute from.

## what moira deliberately rejects

- **engagement-ping "taste"**: consumption telemetry is not preference;
  a connector row is untrusted data until the owner says otherwise.
- **auto-merging profiles**: the whole point is refusing the gray blend.
- **read-time synthesis**: the system never invents representations of
  you; rungs above `exists` are authored, not generated.
- **the llm in the decision path**: judgment lives in the owner; taste
  reasoning lives in evie, outside the deterministic core.
