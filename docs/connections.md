# connections and permissions: what moira covers

the owner asked for this against ego.ist (the egoist ai passport), which is
the closest published reference for "personal context layer with a
owner-controlled trust loop". this page states, honestly, which connection
types moira implements, which it does not, and how fine the permissions go.
every claim below is traceable to code: transport routes in
`src/transport/`, connector registry in `src/connectors/registry.js`, pass
shape in `src/core/passes.js`.

## connection types

### inbound: how an agent or app reaches moira

| type | ego.ist | moira | notes |
|---|---|---|---|
| mcp (streamable http) | yes (`/mcp`, plus an llms index for agents) | **yes, live** | protocol 2025-11-25, ~30 tools of the agent surface; this is the primary path |
| oidc / oauth sign-in (pkce s256) | yes (standard oidc, drop-in sdk) | **yes (pkce s256 code flow)** | discovery via rfc 8414/9728, `ai-passport-signin`-style drop-in sdk is not built, but the flow is standard |
| device authorization (rfc 8628) | yes | **yes** | `POST /device/code`, `POST /device`, polling `/token` |
| connect code (owner-minted, single agent) | yes | **yes** (`connect_codes` in the core) | pending-connect flow with owner approval |
| deep integration (managed server-to-server api) | yes (onboarding by contact) | **no, deliberately** | moira's answer is the owner api + passes; a second server-to-server integration surface is a different product, not a gap to fill silently |
| directed disclosure (one-shot delivery to an exact https destination, content-free status back) | yes | **no** | closest moira primitive is a one-time handoff pack to an exact recipient agent; true "deliver to a url, return only status" is not built |
| owner session | not public | **yes, reference-grade** | shared-secret verifier for `/authorize` (`MOIRA_OWNER_SECRET`), constant-time, mints a real OwnerContext; passkeys/oidc is the swap-in |

### outbound: how moira reaches the world for a persona

| type | moira | notes |
|---|---|---|
| oauth2 bearer (per provider) | **yes** (drive, dropbox, onedrive registered with per-provider scopes: `drive.readonly`, `Files.Read`, `files.metadata.read`...) | adapters are fixture-verified; live handshakes need your own oauth app credentials |
| session-key / pasted credential | **yes** (mega, honestly not implemented beyond the credential shape) | credentials seal under the persona key, never plaintext |
| api-key connectors | **partly** | the credential envelope is generic (any sealed object), but registered providers are oauth or session-key; an api-key provider is a row + adapter, not a new mechanism |
| ingest (read-only sources, e.g. substack, medium) | **registered, planned** | separate `CONNECTOR_KIND.INGEST` path; taste-block ingest activates with evie, gated honestly (`status: 'evie'`) |
| mcp as a *consumer* (moira calling out to an mcp server) | **no** | moira is an mcp server; consuming someone else's mcp tools is not in scope yet |
| multi-account per provider | **yes** | identities keyed `(persona, connector, account)`, passes can pin an account |

## permission granularity

ego.ist requests **exact fields** with a **purpose** and **duration**
(`read: ["style.preferences", "profile.sizes"]`, `duration: "session"`),
shows the owner company + fields + purpose + duration, allows
approve/edit/deny, accepts **memory-write proposals**, and leaves a
**receipt** for every read and proposed write. revocation is instant.

moira's dials, in the same spirit but not field-addressed:

| dial | moira | compared to ego.ist |
|---|---|---|
| what | **category** (facts categories, `preferences`/`taste`, `stack`, `ai`, `vault`, `voice`, `connector`, `workspace`) + **sets** (named context slices: work, side projects) | ego.ist addresses individual field paths; moira addresses categories and slices. field-level paths would be a category-vocabulary expansion, not a new mechanism |
| detail level | **rung** (`maxRung` per pass; rung authored at write time) | this is moira's finer-grained dial ego.ist does not publish an equivalent for: a pass can read "exists/abstract" without "full canon" |
| why | **purpose** (required, part of the pass key) | same idea |
| how long | **duration**: session / permanent / one-time (consumed by the read) + optional `ttlMs` | same idea, plus one-time reads |
| per-call limits | **uses**, spend caps (`spendCaps.usd`), privacy budgets on bridges | ego.ist does not publish per-call or spend limits |
| connector permissions | **connector passes** separate from memory passes; scope strings per job (`files.list`, `files.read`), account pinning, one-time consumption | ego.ist's analog is per-integration approval; moira keeps a separate pass kind so a memory pass never implies connector access |
| writes | **proposals** (`remember` is a proposal; owner approves) | same idea ("suggest memory writes") |
| audit | **signed, content-free receipts** (op, persona, category, timestamp) | same idea, plus receipts are cryptographically signed and never carry content |
| revocation | next read after revoke fails; persona freeze is a one-way switch | instant, same |

## what moira has that this comparison surfaced as unique

- **rungs**: detail level per pass, so "knows a fact exists" and "knows
  the fact" are different permissions.
- **sets**: connection-time slices of context that span facts, stack, ai
  tools and the vault at once.
- **persona isolation as a hard wall**: `personasAllowed` + per-persona
  key sealing; ego.ist's passport is one memory, moira's is one per hat.
- **bridges with privacy budgets**: two-sided sharing between personas
  with a budget, which a single-passport model has no analog for.
- **one-time passes and per-read consumption.**

## honest gaps against ego.ist (named, not hidden)

1. **field-level addressing.** ego.ist can ask for `profile.sizes`; moira
   asks for a category and a rung. expanding the category vocabulary is
   cheap; per-field addressing would need a schema of fact kinds.
2. **hosted trust surface.** ego.ist ships an iphone app, hosted consent
   screens and a partner program. moira ships api + reference consent.
3. **800+ integrations.** ego.ist advertises 800+ connector sources; moira
   has a registry of blocks/jobs with a handful active and the rest
   `planned` - deliberately honest statuses rather than phantom rows.
4. **directed disclosure and deep integrations** are unbuilt (see above).
5. **live oauth verification** - adapters are fixture-verified only.

none of these change the shape: moira's model is a superset of ego.ist's
consent loop minus the hosted surface, with per-persona sealing and rungs
as the differentiators.
