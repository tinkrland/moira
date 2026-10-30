// the moira server: one node:http server hosting the transport layer.
//
//   get  /.well-known/oauth-protected-resource      rfc 9728 (mcp clients start here)
//   get  /.well-known/oauth-authorization-server  rfc 8414 metadata
//   get  /authorize                               401 until owner-session auth lands
//                                                    (host may wire getOwnerContext to finish it)
//   post /token                                   authorization_code + pkce / refresh / device grants
//   post /device/code                             rfc 8628 start
//   get  /device                                  device verification hint (owner approves out of band)
//   post /tokeninfo                               introspection (rfc 7662 shape)
//   any  /mcp                                     the mcp streamable http endpoint
//
// ownership note: /authorize and /device approval REQUIRE owner authority.
// owner-session authentication is the phase 2 open item (supabase auth vs
// passkeys - proposal pending with the reviewer). until it lands, hosts pass
// a `getOwnerContext(req)` callback that mints the owner context after their
// own owner verification; without it, both answer 401. there is no path
// where the transport mints owner authority itself.
//
// binding: binds 127.0.0.1 by default (spec guidance for local servers).

import http from 'node:http';
import { AuthServer } from './authserver.js';
import { McpServer } from './mcpserver.js';
import { TokenService } from './tokens.js';

export function createMoiraServer({
  moira,
  baseUrl = 'http://127.0.0.:8080',
  tokenKey = undefined,
  getOwnerContext = null,
  allowedOrigins = [],
  endpoint = '/mcp',
  port = 8080,
  host = '127.0.0.1'
} = {}) {
  const tokens = new TokenService({ key: tokenKey ?? process.env.MOIRA_TOKEN_KEY, issuer: new URL(baseUrl).host });
  const auth = new AuthServer({ moira, tokens, baseUrl });
  const mcp = new McpServer({ moira, tokens, allowedOrigins, now: () => moira.now() });

  // static app files live in ui/ at the repo root; read per request (tiny,
  // and it keeps deploys to "drop files in place").
  const UI_DIR = new URL('../../ui/', import.meta.url);
  async function sendFile(res, name, type) {
    try {
      const { readFile } = await import('node:fs/promises');
      const body = await readFile(new URL(name, UI_DIR));
      res.writeHead(200, { 'content-type': type, 'cache-control': 'no-store' });
      res.end(body);
    } catch {
      res.writeHead(404, { 'content-type': 'text/plain' });
      res.end('not found');
    }
  }

  function json(res, status, body, headers = {}) {
    res.writeHead(status, { 'content-type': 'application/json', ...headers });
    res.end(JSON.stringify(body));
  }

  async function readBody(req) {
    let body = '';
    for await (const chunk of req) body += chunk;
    if (!body) return {};
    const ct = req.headers['content-type'] || '';
    if (ct.includes('application/json')) return JSON.parse(body);
    // form-encoded (rfc token endpoints)
    const out = {};
    for (const [k, v] of new URLSearchParams(body)) out[k] = v;
    return out;
  }

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, baseUrl);
      const path = url.pathname;

      // the browser surface: zero-dependency static app + owner-gated json.
      if (path === '/app' || path === '/app/') {
        return sendFile(res, 'index.html', 'text/html; charset=utf-8');
      }
      if (path === '/app/app.js') return sendFile(res, 'app.js', 'text/javascript; charset=utf-8');
      if (path === '/app/ui.css') return sendFile(res, 'ui.css', 'text/css; charset=utf-8');

      if (path === '/api/requests' && req.method === 'GET') {
        const owner = getOwnerContext ? getOwnerContext(req) : null;
        if (!owner) return json(res, 401, { outcome: 'unavailable', reason: 'owner_session_required' });
        return json(res, 200, moira.owner.listAccessRequests(owner, { status: url.searchParams.get('status') ?? 'pending' }));
      }
      if (path === '/api/requests/decide' && req.method === 'POST') {
        const owner = getOwnerContext ? getOwnerContext(req) : null;
        if (!owner) return json(res, 401, { outcome: 'unavailable', reason: 'owner_session_required' });
        const body = await readBody(req);
        if (!body?.requestId || !['approve', 'deny'].includes(body.action)) {
          return json(res, 400, { outcome: 'declined', reason: 'request_id_and_action_required' });
        }
        const out = body.action === 'approve'
          ? moira.owner.approveAccessRequest(owner, { requestId: body.requestId, edits: body.edits ?? {} })
          : moira.owner.denyAccessRequest(owner, { requestId: body.requestId, reason: body.reason ?? null });
        return json(res, out.outcome === 'results' ? 200 : 409, out);
      }

      if (path === '/api/set' && req.method === 'POST') {
        const owner = getOwnerContext ? getOwnerContext(req) : null;
        if (!owner) return json(res, 401, { outcome: 'unavailable', reason: 'owner_session_required' });
        const body = await readBody(req);
        if (!body?.personaId || !body?.name) return json(res, 400, { outcome: 'declined', reason: 'persona_and_name_required' });
        const out = moira.owner.setRemove(owner, { personaId: body.personaId, name: body.name });
        return json(res, out.outcome === 'results' ? 200 : 404, out);
      }

      if (path === '/api/persona' && req.method === 'GET') {
        const owner = getOwnerContext ? getOwnerContext(req) : null;
        if (!owner) return json(res, 401, { outcome: 'unavailable', reason: 'owner_session_required' });
        const id = url.searchParams.get('id');
        if (!id) return json(res, 400, { outcome: 'declined', reason: 'persona_id_required' });
        const out = moira.owner.personaDetail(owner, id);
        return json(res, out.outcome === 'results' ? 200 : 404, out);
      }
      if (path === '/api/persona' && req.method === 'POST') {
        const owner = getOwnerContext ? getOwnerContext(req) : null;
        if (!owner) return json(res, 401, { outcome: 'unavailable', reason: 'owner_session_required' });
        const body = await readBody(req);
        try {
          const persona = moira.owner.createPersona(owner, {
            name: body?.name, identity: body?.identity, email: body?.email ?? null
          });
          return json(res, 200, { outcome: 'results', persona: { id: persona.id, name: persona.name } });
        } catch (err) {
          return json(res, 400, { outcome: 'declined', reason: String(err.message) });
        }
      }
      if (path === '/api/overview' && req.method === 'GET') {
        const owner = getOwnerContext ? getOwnerContext(req) : null;
        if (!owner) return json(res, 401, { outcome: 'unavailable', reason: 'owner_session_required' });
        const out = moira.owner.overview(owner);
        return json(res, 200, out);
      }
      if (path === '/api/pass' && req.method === 'POST') {
        const owner = getOwnerContext ? getOwnerContext(req) : null;
        if (!owner) return json(res, 401, { outcome: 'unavailable', reason: 'owner_session_required' });
        const body = await readBody(req);
        if (!body || !body.personaId || !body.clientId || !body.category || !body.purpose) {
          return json(res, 400, { outcome: 'declined', reason: 'persona_client_category_purpose_required' });
        }
        const out = moira.owner.grantPass(owner, body);
        return json(res, out.outcome === 'results' ? 200 : 409, out);
      }

      if (path === '/.well-known/oauth-protected-resource') {
        return json(res, 200, auth.discovery().protectedResource);
      }
      if (path === '/.well-known/oauth-authorization-server') {
        return json(res, 200, auth.discovery().authorizationServer);
      }
      if (path === endpoint && await mcp.handle(req, res, { endpoint })) return;

      if (req.method === 'GET' && path === '/authorize') {
        const ctx = getOwnerContext ? getOwnerContext(req) : null;
        if (!ctx) {
          return json(res, 401, {
            error: 'owner_session_required',
            error_description: 'the consent screen requires owner authentication; the host must provide getOwnerContext(req) until owner-session auth lands'
          }, { 'www-authenticate': 'Bearer' });
        }
        try {
          const p = Object.fromEntries(url.searchParams);
          const out = auth.mintAuthorizationCode(ctx, {
            clientId: p.client_id,
            personaId: p.persona_id,
            redirectUri: p.redirect_uri,
            codeChallenge: p.code_challenge,
            state: p.state ?? null
          });
          const redirect = new URL(p.redirect_uri);
          redirect.searchParams.set('code', out.code);
          if (p.state) redirect.searchParams.set('state', p.state);
          res.writeHead(302, { location: redirect.toString() });
          return res.end();
        } catch (e) {
          return json(res, 400, { error: 'invalid_request', error_description: e.message });
        }
      }

      if (req.method === 'POST' && path === '/device/code') {
        const p = await readBody(req);
        try {
          return json(res, 200, auth.deviceCode({ clientId: p.client_id, agentName: p.agent_name ?? null }));
        } catch (e) {
          return json(res, 400, { error: 'invalid_client', error_description: e.message });
        }
      }

      if (req.method === 'GET' && path === '/device') {
        return json(res, 200, {
          verification_uri: `${auth.baseUrl}/device`,
          hint: 'the owner approves or denies a pending user_code via ownerapi.approveDeviceCode / denyDeviceCode (owner-session auth pending, phase 2 open item)',
          user_code: url.searchParams.get('user_code')
        });
      }

      if (req.method === 'POST' && path === '/token') {
        const p = await readBody(req);
        const out = auth.token(p);
        const status = out.error ? (out.error === 'authorization_pending' ? 400 : 400) : 200;
        return json(res, status, out, status === 200 ? { 'cache-control': 'no-store', pragma: 'no-cache' } : {});
      }

      if (req.method === 'POST' && path === '/tokeninfo') {
        const p = await readBody(req);
        return json(res, 200, tokens.introspect(p.token, moira));
      }

      res.writeHead(404);
      res.end(JSON.stringify({ error: 'not_found' }));
    } catch (e) {
      if (res.headersSent) { res.destroy(); return; }
      json(res, 500, { error: 'server_error', error_description: e.message });
    }
  });

  return { server, auth, mcp, tokens, listen: (opts = {}) => new Promise((r) => server.listen({ port, host, ...opts }, () => r(server.address()))) };
}
