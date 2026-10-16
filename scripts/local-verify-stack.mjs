// local verification stack (phase 1): real postgres + real postgrest,
// mirroring the supabase layout a scratch project would give you:
//   - kong-style /rest/v1 prefix (tiny reverse proxy below)
//   - role-pinned postgrest instances (service_role / anon), credentials
//     dropped at the proxy like supabase's gateway drops kong keys
//
// this is a scratch/throwaway stack for verification only. it never holds
// real data: the roles, the authenticator password and the jwt secret it
// prints are for the local database alone.
//
// prerequisites (documented, not installed by this script):
//   apt-get install -y --no-install-recommends postgresql-15 postgresql-contrib-15
//   curl -L -o /tmp/postgrest https://github.com/postgrest/postgrest/releases/... (static x64)
//   (psql) create roles anon, authenticated, service_role (bypassrls),
//          authenticator with a password; grant the three to authenticator;
//          createdb moira_scratch; apply the backend/ topic files
//
// run from the repo root:
//   MOIRA_LOCAL_VERIFY=1 PGRST_BIN=/tmp/postgrest node scripts/local-verify-stack.mjs
//
// it prints the SUPABASE_* env vars, runs the gated real-project suite
// (test/real-supabase.test.js) against the local stack, forwards the exit
// code, and always cleans up its children. the result is real postgres
// verification of schema.sql, the cas rpc, triggers and rls under anon -
// it is NOT a run against a supabase-hosted project; report it as such.

import { spawn, spawnSync } from 'node:child_process';
import { createHmac, randomBytes } from 'node:crypto';
import http from 'node:http';

const PORT = Number(process.env.MOIRA_LOCAL_VERIFY_PORT || 54321);
const PGRST_PORT = PORT + 1;
const DB = process.env.MOIRA_LOCAL_VERIFY_DB || 'moira_scratch';
const PGRST_BIN = process.env.PGRST_BIN || '/tmp/postgrest';

if (process.env.MOIRA_LOCAL_VERIFY !== '1') {
  console.error('refusing to run without MOIRA_LOCAL_VERIFY=1 (this starts local servers)');
  process.exit(2);
}

// --- two postgrest instances, one per role (no jwt needed locally) ------------
// instance A (service): every request runs as service_role (bypassrls) - this
// is what the store talks to. instance B (anon): every request runs as anon,
// for the rls default-deny check. on a real supabase project the same split
// happens via jwt role claims; locally the role is pinned per instance.
const serviceKey = 'local-verify-service-key';
const anonKey = 'local-verify-anon-key';

// --- postgrest (two instances) -----------------------------------------------
function startPostgrest(port, role) {
  const p = spawn(PGRST_BIN, [], {
    env: {
      ...process.env,
      PGRST_DB_URI: `postgres://authenticator:${process.env.PGRST_DB_PASSWORD || 'local_scratch_only'}@127.0.0.1:5432/${DB}`,
      PGRST_DB_SCHEMAS: 'public',
      PGRST_DB_ANON_ROLE: role,
      PGRST_DB_CONFIG: 'false',
      PGRST_SERVER_PORT: String(port)
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  p.on('error', (e) => { console.error(`postgrest (${role}) failed to start:`, e.message); process.exit(2); });
  return p;
}
const pgrstService = startPostgrest(PGRST_PORT, 'service_role');
const pgrstAnon = startPostgrest(PGRST_PORT + 1, 'anon');

// --- /rest/v1 reverse proxy (supabase layout) --------------------------------
function startProxy(port, upstreamPort) {
  const proxy = http.createServer((req, res) => {
    let path = req.url;
    const headers = { ...req.headers };
    delete headers.host;
    delete headers.connection;
    delete headers['content-length'];
    // postgrest v12 rejects any bearer header when no jwt secret is set; the
    // proxy is the auth boundary here (like supabase's gateway): it drops the
    // credentials and each instance's pinned role applies.
    delete headers.authorization;
    delete headers.apikey;
    if (path === '/rest/v1/' || path === '/rest/v1') {
      // postgrest serves the openapi root for application/openapi+json
      headers.accept = 'application/openapi+json';
    }
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const body = chunks.length ? Buffer.concat(chunks) : undefined;
      if (body) headers['content-length'] = String(body.length);
      const upstream = http.request(
        { host: '127.0.0.1', port: upstreamPort, method: req.method, path: path.replace(/^\/rest\/v1/, ''), headers },
        (ur) => { res.writeHead(ur.statusCode, ur.headers); ur.pipe(res); }
      );
      upstream.on('error', () => { res.writeHead(502); res.end('local postgrest unreachable'); });
      if (body) upstream.write(body);
      upstream.end();
    });
  });
  return new Promise((r) => proxy.listen(port, '127.0.0.1', () => r(proxy)));
}
const proxies = [];

// --- wait for postgrest, run the suite, clean up -------------------------------
const ANON_BASE_PORT = PORT + 10;
async function waitForPostgrest(port, tries = 50) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/`, { headers: { accept: 'application/openapi+json' } });
      if (res.ok) return;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error('postgrest did not come up');
}

async function main() {
  // self-heal the local cluster (the sandbox may have stopped it between runs)
  spawnSync('pg_ctlcluster', ['15', 'main', 'start'], { stdio: 'ignore' });
  await waitForPostgrest(PGRST_PORT);
  await waitForPostgrest(PGRST_PORT + 1);
  proxies.push(await startProxy(PORT, PGRST_PORT));
  proxies.push(await startProxy(ANON_BASE_PORT, PGRST_PORT + 1));
  const base = `http://127.0.0.1:${PORT}`;
  const anonBase = `http://127.0.0.1:${ANON_BASE_PORT}`;
  console.log('local verification stack up (scratch only):');
  console.log(`  SUPABASE_URL=${base}`);
  console.log(`  SUPABASE_ANON_URL=${anonBase}   # role-pinned anon instance (rls check)`);
  console.log(`  SUPABASE_SERVICE_ROLE_KEY=${serviceKey}`);
  console.log(`  SUPABASE_ANON_KEY=${anonKey}`);

  const test = spawn('node', ['--test', 'test/real-supabase.test.js'], {
    env: {
      ...process.env,
      MOIRA_REAL_SUPABASE: '1',
      SUPABASE_URL: base,
      SUPABASE_ANON_URL: anonBase,
      SUPABASE_SERVICE_ROLE_KEY: serviceKey,
      SUPABASE_ANON_KEY: anonKey
    },
    stdio: 'inherit'
  });
  const code = await new Promise((r) => test.on('close', r));
  proxies.forEach((p) => p.close());
  pgrstService.kill();
  pgrstAnon.kill();
  process.exit(code);
}
main().catch((e) => { console.error(e.message); pgrstService.kill(); pgrstAnon.kill(); process.exit(2); });
