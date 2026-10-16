// run the moira server locally (transport layer): mcp endpoint + auth server.
//
//   MOIRA_TOKEN_KEY=$(openssl rand -hex 32) node scripts/serve.mjs
//
// binds 127.0.0.1 only (spec guidance for local servers). requires
// MOIRA_TOKEN_KEY; pass MOIRA_BASE_URL when the server is reachable under a
// different host/port (that base url goes into the discovery metadata).

import { Moira } from '../src/index.js';
import { createMoiraServer } from '../src/transport/server.js';

if (!process.env.MOIRA_TOKEN_KEY) {
  console.error('MOIRA_TOKEN_KEY required: generate one with `openssl rand -hex 32`');
  process.exit(2);
}

const PORT = Number(process.env.MOIRA_PORT || 8080);
const BASE = process.env.MOIRA_BASE_URL || `http://127.0.0.1:${PORT}`;
const moira = new Moira({ instanceKey: process.env.MOIRA_INSTANCE_KEY && Buffer.from(process.env.MOIRA_INSTANCE_KEY, 'hex') || undefined });

const moiraServer = createMoiraServer({
  moira,
  baseUrl: BASE,
  port: PORT,
  host: '127.0.0.1',
  // owner-session auth is the phase 2 open item: hosts wire their own owner
  // verification here until it lands. without it, /authorize answers 401.
  getOwnerContext: null,
  allowedOrigins: (process.env.MOIRA_ALLOWED_ORIGINS || '').split(',').filter(Boolean)
});

await moiraServer.listen();
console.log(`moira server on ${BASE}`);
console.log(`  mcp endpoint:          ${BASE}/mcp`);
console.log(`  authorization server: ${BASE}/.well-known/oauth-authorization-server`);
console.log(`  device flow:          ${BASE}/device/code`);
console.log('note: /authorize requires an owner session (getOwnerContext); wire owner auth first.');
