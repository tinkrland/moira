# agent-vault, read for what it's worth to moira

reviewed 2026-10-31. source: [Infisical/agent-vault](https://github.com/Infisical/agent-vault)
(Go, ~2.5k stars, 48 MB clone, NOASSERTION licence), docs at docs.agent-vault.dev.

## what it is

a single-binary **credential proxy and vault** for AI agents. credentials live in
the vault; agents get a token that reaches them only *through* a MITM proxy, which
matches outbound requests against per-vault **service rules** (host + optional path
glob) and injects the real credential server-side. the agent can be prompted into
leaking anything it holds, so it is never allowed to hold the credential: dummy
values like `__anthropic_api_key__` go in, real auth headers come out.

supporting machinery worth noting:

- **proposals**: the agent asks for a service/credential it needs; a human
  approves via a link (24h read-only token), approves in the browser, and the
  change merges atomically. pending → applied | rejected | expired (7d).
- **roles on two independent axes**: instance roles (owner/member/no-access) and
  vault roles (admin/member/proxy). `no-access` exists so an agent can proxy
  inside one vault and do nothing at instance scope.
- **netguard**: outbound connections are judged at the IP level after
  resolution. RFC-1918, loopback, link-local, ULA, CGNAT and cloud metadata are
  blocked; `169.254.169.254` and `fd00:ec2::254` stay blocked even when
  allowlisted. the check runs on the address being dialled, so DNS rebinding
  doesn't slip through a one-address check.
- **token discipline**: `av_sess_` / `av_agt_` / `av_appr_` / `av_uinv_`, 256-bit
  from `crypto/rand`, SHA-256 stored, raw value returned exactly once. scoped
  sessions are minted per run (5 min – 7 days).
- **KEK/DEK wrapping**: AES-256-GCM credentials under a DEK, DEK wrapped by an
  Argon2id-derived KEK from a master password that is never stored and wiped
  after use. password change re-wraps the DEK, not every credential.

## where moira already agrees

- **credentials are never returned to the agent.** moira's connectors and
  disclosures already work this way; agent-vault is the same instinct applied to
  outbound auth. the direction is validated, not new.
- **the consent loop.** their proposals are moira's access requests: agent asks,
  human narrows/approves, approval is the only minting path. ours additionally
  refuses widening edits at the API (`edits_widen_the_request`).
- **token honesty.** hash-at-rest, raw-once, per-request minting: same shape as
  passes and device codes.
- **no-access thinking.** our `personasAllowed` wall and unscoped-pass
  acknowledgement play the role their `no-access` role plays.

## where it exposed a real hole in moira

**outbound target policy.** directed disclosure validated `https://` and stopped.
`https://169.254.169.254/latest/meta-data/` passed validation, and a hostname
resolving into a private range passed too. that is a delivery feature turned into
an exfiltration gadget by a five-character change of destination.

fixed same day: `src/util/netguard.js`, wired into `DisclosureService.approve`
before any fact is opened. ip literals judged directly; every resolved address
judged (any blocked address blocks the destination); metadata blocked even when
allowlisted; private ranges gated by `allowPrivate` + `allowlist`; unresolvable
fails closed. knobs are a gateway option. covered by unit tests plus a boundary
test proving nothing is delivered and the app still sees no values.

## what moira should take, and what it should not

take:
- **service rules as a first-class object** (host + path glob + auth kind). moira
  has persona-level egress labels but no notion of "this persona may call exactly
  this endpoint with exactly this account". that is the natural home for
  accounts, and it would make egress reviewable instead of implicit.
- **approval links with a short read-only token TTL** for pending asks, so an
  owner can act on a request from a browser without holding an owner session.
- **the always-block metadata list** as a permanent invariant, already adopted.

do not take:
- **the MITM proxy.** its own security page says `Proxy-Authorization` travels in
  cleartext on the local hop and the broker must sit on a trusted network. moira
  is not a proxy: it makes specific calls itself, which is strictly less attack
  surface.
- **the dependency.** Go binary + SQLite/Postgres + CA management, versus moira's
  zero-dep Node core. the *pattern* transfers for free; the software does not.
- **instance-wide vaults.** agent-vault is organised around organisational
  vaults with members. moira's unit is the persona and the crossing; adopting
  their hierarchy would import an org chart moira deliberately lacks.

## if it is ever wired in

as a **runtime sidecar**, not a library: a persona's account credentials could
live in an agent-vault instance, and moira's egress path would ask it to perform
the authenticated call, receiving status only - the same contract as directed
disclosure's `deliver`. that keeps moira's "never hand over the credential"
guarantee while outsourcing the proxy work to software built for it. the blocker
is operational, not architectural: it needs a machine, a master password, and
trust that its database is not on the agent's host.
