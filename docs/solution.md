# the solution

moira's answer to the problem, piece by piece.

## personas: separation with structure

every hat you wear becomes a persona with its own memory, keys,
connectors, and budget. not separate accounts - one owner, many
personas, with switching as an explicit consent (`request ->
approve -> collect`, never a silent flip) and a shared core you
opt into per persona. heteronyms (fully separate characters) never
inherit the core at all.

## passes: granularity by default

an app or agent never holds your keys. it holds a pass:
(persona, category, purpose, duration). one shelf, one reason, one
afternoon. no pass does not error - it produces an approval link, so
absence of consent leaks nothing. passes are separate from connectors
passess: a memory pass and a connector pass are different grants with
the same philosophy.

## receipts: the audit spine

every read leaves a signed, content-free receipt - who, what kind,
when, how much - that you can query anytime. append-only, enforced by
the database itself: updates blocked (except signed deletion stubs),
deletes always blocked. you finally own the record of what was shared.

## rungs and taint: representations you authored

a fact can be served at increasing detail - that something exists, an
outline, the content, a conclusion. moira derives only the lowest rung
mechanically; higher rungs must be authored. every fact carries its
provenance (taint), labels combine most-restrictive-wins, and
summarization preserves labels. rephrasing cannot launder what a fact
is; only an explicit owner act can.

## bridges: relationships, not merges

persona-to-persona sharing is a two-sided bridge with explicit ingress
on each side, capped at a rung, metered by a privacy budget. nothing
auto-syncs across a bridge. the same shape models person-to-person
context sharing later.

## connectors: context in, untrusted by default

each persona connects its own accounts (files, calendars, assistants).
provider text is tagged untrusted at ingress and never becomes a
preference without owner confirmation. consent attaches to the job
("retrieve your files"), so providers are swappable without
re-consent.

## shredding: deletion that is real

persona keys are random and wrapped under one instance key. deleting a
persona deletes its wrap: the ciphertext becomes undecryptable by
anyone, including moira. bridges, packs, leases severed; receipts
stubbed in place.

## the ledger: your resources, capped

resource accounts with sealed secrets; agents get leases with explicit
caps (spend, ttl, allowed models), four cap levels where the lowest
always wins, and a kill switch. runaway spend lowers an agent's
auto-approval; nothing spends silently.

## how the pieces answer the failures

| the failure | moira's answer |
| --- | --- |
| no separation | personas + explicit switching + shared core opt-in |
| no granularity | passes, connector passes, leases |
| no memory of sharing | signed append-only receipts |
| no real deletion | key shredding (crypto-deletion) |
| provider text as truth | untrusted tagging, owner confirmation |
| no audit spine | receipt queries per persona |
