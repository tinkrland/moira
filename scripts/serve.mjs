// run the moira server locally (transport layer): mcp endpoint + auth server.
//
//   MOIRA_TOKEN_KEY=$(openssl rand -hex 32) node scripts/serve.mjs
//
// binds 127.0.0.1 only (spec guidance for local servers). requires
// MOIRA_TOKEN_KEY; pass MOIRA_BASE_URL when the server is reachable under a
// different host/port (that base url goes into the discovery metadata).

import { Moira } from '../src/index.js';
import { createMoiraServer } from '../src/transport/server.js';
import { createOwnerSessionVerifier } from '../src/transport/ownersession.js';
import { FileStore } from '../src/store.js';

if (!process.env.MOIRA_TOKEN_KEY) {
  console.error('MOIRA_TOKEN_KEY required: generate one with `openssl rand -hex 32`');
  process.exit(2);
}

const PORT = Number(process.env.MOIRA_PORT || 8080);
const BASE = process.env.MOIRA_BASE_URL || `http://127.0.0.1:${PORT}`;
// store selection mirrors cli.js: hosted env wins, then MOIRA_STATE file,
// else the in-memory default (a demo that vanishes on restart, honestly).
const hosted = (process.env.INSFORGE_URL && process.env.INSFORGE_ADMIN_KEY) || (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
const store = hosted ? undefined : (process.env.MOIRA_STATE ? new FileStore(process.env.MOIRA_STATE) : undefined);
const moira = new Moira({
  store,
  instanceKey: process.env.MOIRA_INSTANCE_KEY && Buffer.from(process.env.MOIRA_INSTANCE_KEY, 'hex') || undefined
});

// directed disclosure needs someone to actually make the call: one POST, no
// redirects followed (a redirect is a different destination than the approved
// one), bounded by a timeout.
const deliver = async (destination, payload) => {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 8000);
  try {
    const res = await fetch(destination, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'user-agent': 'moira-disclosure/1' },
      body: JSON.stringify(payload),
      redirect: 'error',
      signal: ac.signal
    });
    return { ok: res.ok, status: res.status };
  } catch {
    return { ok: false };
  } finally {
    clearTimeout(timer);
  }
};

const moiraServer = createMoiraServer({
  moira,
  deliver,
  baseUrl: BASE,
  port: PORT,
  host: '127.0.0.1',
  // turnkey: set MOIRA_OWNER_SECRET and /authorize accepts that secret
  // (x-moira-owner header, bearer, or moira_owner cookie). without it,
  // /authorize answers 401 until a host wires its own owner verification.
  // a shared secret is turnkey for single-host deployments, not final auth.
  getOwnerContext: process.env.MOIRA_OWNER_SECRET
    ? createOwnerSessionVerifier({ moira, secret: process.env.MOIRA_OWNER_SECRET })
    : null,
  allowedOrigins: (process.env.MOIRA_ALLOWED_ORIGINS || '').split(',').filter(Boolean)
});

await moiraServer.listen();
console.log(`moira server on ${BASE}`);
console.log(`  mcp endpoint:          ${BASE}/mcp`);
console.log(`  authorization server: ${BASE}/.well-known/oauth-authorization-server`);
console.log(`  device flow:          ${BASE}/device/code`);
console.log(process.env.MOIRA_OWNER_SECRET
  ? 'owner session: MOIRA_OWNER_SECRET set (x-moira-owner header, bearer, or moira_owner cookie)'
  : 'note: /authorize requires an owner session; set MOIRA_OWNER_SECRET for turnkey access.');
