# features

status is honest: **live** means built and tested (with the test named),
**planned** means designed and registered in code but not built,
**evie-gated** means it activates with the taste engine on its own
branch. nothing here pretends.

## personas and memory (live)

- persona kinds: linked / pseudonymous / heteronymous, hosted / local
- sealed facts (aes-256-gcm per persona), proposal inbox, taint
  inheritance, circumstance decay
- rungs with authored representations; mechanical `exists` rung only
- shared core with explicit promote/demote (audit-reeipted)
- fact reassignment between personas (through the policy engine)
- persona deletion = key shredding; kill switch per persona

## consent (live)

- passes: (client, persona, category, purpose, duration); one-time
  passes consumed on use
- two-sided bridges with ingress checks, rung caps, privacy budget
- persona switching: request -> approve -> collect; new session minted,
  old sessions never touched
- context packs (signed, expiring, rung-dealt) and handoffs
  (owner-approved, typed returns)

## agents and budgets (live)

- agent registry, persona-bound sessions, rotating refresh with family
  revocation on replay
- resource ledger: sealed account secrets, metering, runway, alerts
- router: eligibility + urgency; leases with four-level caps
  (lowest wins); model binding (confused-deputy defense)

## audit (live)

- signed content-free receipts, append-only at the database level
  (triggers; updates only as deletion stubs, deletes always blocked)
- decoupling monitor (advisory, owner-only, never stored)

## transports and surfaces (live)

- mcp streamable http server (2025-11-25) exposing the agent surface
- oidc-shaped auth: pkce s256, rfc 8628 device flow, discovery,
  introspection; jose-signed tokens wrapping opaque sessions
- cli: the full owner surface from the terminal, over any store

## connectors (files wave live, rest planned)

- **live:** retrieve-your-files job - google drive, onedrive, dropbox
  adapters (fixture-tested; live runs wait on oauth app credentials);
  hub: per-persona sealed identities (MULTIPLE accounts per provider per
  persona - work drive + personal drive; re-authorize replaces only that
  account; reads target an account or default to first-authorized),
  connector passes (optionally pinned to one account), gated reads,
  untrusted tagging
- **planned:** knowledge jobs (projects, time, reading), ai tools,
  lifestyle, utility; tech & dev block (github, gitlab, bitbucket;
  design: figma, kittl, canva, penpot, balsamiq) and academia (zotero,
  mendeley, semantic scholar; api-less sources via export/webhook) -
  tech is onboarding opt-in, not assumed; the people block (meetings:
  calendly, cal.com, z cal, granola; social; networking; family
  and friends CIRCLES - cresca-style, but per-persona: the same
  human can know different personas of yours, so a relationship is
  always (person, persona), never (person, owner) wholesale)
  activates with the people phase
- **honestly missing:** mega (encrypted rpc protocol, its own work
  item; returns documented `not_implemented`)

## taste engine (evie-gated)

- evie: separate branch, plugs into moira, never gates access, never
  writes without owner confirmation. taste providers are registered
  as evie-gated; nothing activates before evie does.

## deliberate non-features

- no payments or booking actions (v2 scope)
- no on-device sovereign mediator (v2; the gateway returns
  `unavailable` rather than guessing)
- no enforcement inside a model's reasoning - enforcement is at the
  retrieval and tool boundary
- no read-time llm synthesis of rungs: representations are authored
  at write time
