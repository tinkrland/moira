# host quickstart: plug moira in, end to end

for a host app or agent that wants to use moira as its context backend.
everything below is the turnkey path: one process, one secret, real passes.

## 1. boot the server

    MOIRA_TOKEN_KEY=$(openssl rand -hex 32) \
    MOIRA_OWNER_SECRET=$(openssl rand -base64 32) \
    node scripts/serve.mjs

persistence picks itself in this order:

- `INSFORGE_URL` + `INSFORGE_ADMIN_KEY`
- `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`
- otherwise the local file store at `~/.moira/state.json`

what is now listening:

| endpoint | what |
|---|---|
| `/mcp` | streamable http mcp endpoint (the agent surface) |
| `/.well-known/oauth-protected-resource` | rfc 9728 resource metadata |
| `/.well-known/oauth-authorization-server` | rfc 8414 server metadata |
| `/authorize` | pkce consent step (owner session required) |
| `/token` | code and refresh exchange |
| `/device/code`, `/device` | rfc 8628 device flow |
| `/tokeninfo` | token introspection |

## 2. register your agent once (owner side, node api)

the cli covers personas, facts, stack, ai tools and sets today; agent
registration and pass grants are the node api for now:

```js
import { Moira } from 'moira-backend/src/index.js';

const moira = new Moira({}); // same env as the server
const ctx = moira.createOwnerContext({ kind: 'owner_session', verified: true, ownerRef: 'owner' });

const persona = moira.owner.createPersona(ctx, { name: 'alexa', identity: 'linked' });
const agent = moira.owner.registerAgent(ctx, {
  name: 'my app',
  tier: 'verified',
  personasAllowed: [persona.id],
  spendCaps: { usd: 5 }
});
console.log(agent.id, persona.id);
```

`personasAllowed` is a hard wall: the agent can never see another persona,
no matter what pass it holds.

## 3. the agent connects (pkce)

the agent discovers the authorization server from the protected-resource
document, then runs a standard pkce s256 flow. the consent step needs the
owner session: `MOIRA_OWNER_SECRET` as an `x-moira-owner` header, a bearer
token, or a `moira_owner` cookie.

    # 1. discovery
    curl -s $BASE/.well-known/oauth-protected-resource

    # 2. the owner approves (browser or scripted with the secret)
    open "$BASE/authorize?client_id=$AGENT_ID&persona_id=$PERSONA_ID&redirect_uri=http://app.local/cb&code_challenge=$CHALLENGE&code_challenge_method=S256&state=s1"

    # 3. exchange the code (verifier = the pkce secret)
    curl -s -X POST $BASE/token -d grant_type=authorization_code \
      -d code=$CODE -d code_verifier=$VERIFIER -d client_id=$AGENT_ID \
      -d redirect_uri=http://app.local/cb

headless agents use the device flow instead (`POST /device/code`, then
`POST /token` with `grant_type=urn:ietf:params:oauth:grant-type:device_code`
until approved), and an owner can mint a connect code for a single agent.

## 4. first mcp call

`/mcp` speaks streamable http (protocol 2025-11-25). `initialize` first,
then `tools/list`, then `tools/call` with `Authorization: Bearer $TOKEN`.

the agent will see the tool surface but no content: every read is
approval-first by design. a `remember` call is a proposal, not a write.

## 5. grant the first pass

```js
moira.owner.grantPass(ctx, {
  clientId: agent.id,
  personaId: persona.id,
  category: 'preferences',   // or a fact category, 'stack', 'ai', 'vault', 'voice', 'connector'
  purpose: 'personalization',
  duration: 'session',       // or 'permanent', or one-time reads
  sets: ['work']             // optional: share only this context slice
});
```

now the agent's reads work, and each read is receipted (content-free:
op, persona, category, timestamp). revocation takes effect on the next
read, and a one-time pass is consumed by the read it authorizes.

## 6. optional: connector-fed capture and vault recall

```js
moira.owner.connectConnector(ctx, { personaId, connectorId: 'drive', credentials: {...} }); // credentials from your host's oauth callback
moira.owner.grantConnectorPass(ctx, { clientId: agent.id, personaId, connectorId: 'drive', scope: 'files.read', purpose: 'research' });
```

`connector_read` returns rows tagged `{untrusted, source}`; the owner can
save any of them into the persona vault in one step with `vaultCapture`.

## the honest gaps

- **owner auth is a reference implementation.** the shared secret is
  turnkey for a single host, not final auth; passkeys/oidc is the swap-in
  and the verifier is built to be replaced.
- **connector adapters are fixture-verified.** live oauth handshakes need
  per-provider app credentials you register yourself.
- **no hosted console yet.** everything above is api/curl; the browser ui
  is a separate build.
