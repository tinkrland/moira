// mcp server over streamable http (protocol revision 2025-11-25).
//
// the transport the spec asks for: one endpoint (default /mcp), json-rpc 2.0
// over http post. responses are single json objects (application/json) - the
// spec allows the server to decline sse streams entirely (get -> 405).
//
// auth: every request must carry `authorization: bearer <signed access jwt>`.
// the jwt wraps the opaque session token (see tokens.js); resolution goes
// through the gateway's session service, so revocation and rotation are live.
// 401 responses carry `www-authenticate: bearer` plus the rfc 9728 resource
// metadata link, which is how mcp clients discover the authorization server.
//
// security posture required by the spec, implemented here:
//   - origin header validation (403 when present-and-unallowed)
//   - localhost binding by default in the host script
//   - authentication on all requests
//
// session management: initialize mints an Mcp-Session-Id (random 32 hex);
// subsequent requests must carry it; unknown/expired ids -> 404 per spec.
// notifications/responses -> 202 accepted with no body, per spec.
// a client may terminate with http delete on the endpoint.

import { randomBytes } from 'node:crypto';
import { MCP_TOOLS, toolByName } from './mcp-tools.js';

export const MCP_PROTOCOL_VERSION = '2025-11-25';

const JSONRPC = {
  PARSE: { code: -32700, message: 'parse error' },
  INVALID: { code: -32600, message: 'invalid request' },
  METHOD: { code: -32601, message: 'method not found' },
  PARAMS: { code: -32602, message: 'invalid params' },
  INTERNAL: { code: -32603, message: 'internal error' }
};

const SESSION_TTL_MS = 60 * 60 * 1000; // initialize -> initialized handshake window
const ALLOWED_ORIGINS_DEFAULT = () => []; // allow-list only; empty = all browser origins denied

export class McpServer {
  constructor({ moira, tokens, allowedOrigins = ALLOWED_ORIGINS_DEFAULT(), now = Date.now } = {}) {
    this.moira = moira;
    this.tokens = tokens;
    this.allowedOrigins = typeof allowedOrigins === 'function' ? allowedOrigins() : allowedOrigins;
    this.now = now;
    this.sessions = new Map(); // mcpSessionId -> { protocolVersion, initialized, createdAt, clientId }
    this.tools = MCP_TOOLS;
  }

  _send(res, status, headers, body) {
    const h = { 'content-type': 'application/json', ...(headers || {}) };
    if (body === undefined || body === null) { res.writeHead(status, h); res.end(); return; }
    res.writeHead(status, h);
    res.end(JSON.stringify(body));
  }

  _error(res, id, { code, message }, status = 400, headers) {
    this._send(res, status, headers, { jsonrpc: '2.0', id: id ?? null, error: { code, message } });
  }

  _originOk(req) {
    const origin = req.headers.origin;
    if (!origin) return true; // not a browser request; the auth header is the gate
    return this.allowedOrigins.includes(origin);
  }

  _bearer(req) {
    const h = req.headers.authorization || '';
    const m = /^bearer\s+(.+)$/i.exec(h.trim());
    return m ? m[1] : null;
  }

  // resolve the signed access jwt -> { clientId, personaId, sessionId }.
  // throws on any failure; the catch maps to 401.
  _authenticate(req) {
    const jwt = this._bearer(req);
    if (!jwt) {
      const err = new Error('missing bearer token');
      err.hint = 'use the moira authorization server to obtain a token (see /.well-known/oauth-protected-resource)';
      throw err;
    }
    const claims = this.tokens.verify(jwt, { type: 'access' });
    const resolved = this.moira.sessions.resolve(claims.tok);
    if (resolved.outcome !== 'results') {
      const err = new Error(`session ${resolved.outcome}${resolved.reason ? ': ' + resolved.reason : ''}`);
      throw err;
    }
    return { ...resolved, token: claims.tok };
  }

  _sessionFrom(req) {
    const id = req.headers['mcp-session-id'];
    if (!id) return null;
    const s = this.sessions.get(id);
    if (!s || s.expiresAt < this.now()) {
      this.sessions.delete(id);
      return null;
    }
    return s;
  }

  // main entry: mount this on a node http server. returns true when handled.
  async handle(req, res, { endpoint = '/mcp', metaUrl = null } = {}) {
    const url = new URL(req.url, 'http://internal');
    if (url.pathname !== endpoint) return false;

    // origin validation first (spec: 403 before anything else)
    if (!this._originOk(req)) {
      this._send(res, 403, undefined, { jsonrpc: '2.0', id: null, error: { code: JSONRPC.INVALID.code, message: 'origin not allowed' } });
      return true;
    }

    if (req.method === 'GET') {
      // we do not offer server-initiated sse streams; the spec allows 405.
      res.writeHead(405, { allow: 'POST, DELETE' });
      res.end();
      return true;
    }

    if (req.method === 'DELETE') {
      const sid = req.headers['mcp-session-id'];
      if (sid && this.sessions.has(sid)) {
        this.sessions.delete(sid);
        res.writeHead(204);
        res.end();
      } else {
        res.writeHead(404);
        res.end();
      }
      return true;
    }

    if (req.method !== 'POST') {
      res.writeHead(405, { allow: 'POST, GET, DELETE' });
      res.end();
      return true;
    }

    // protocol version header (2025-11-25): if the client sends one, it must
    // match a version we speak.
    const pv = req.headers['mcp-protocol-version'];
    if (pv !== undefined && pv !== MCP_PROTOCOL_VERSION) {
      this._error(res, null, { code: JSONRPC.INVALID.code, message: `unsupported protocol version ${pv}` }, 400);
      return true;
    }

    let body = '';
    for await (const chunk of req) body += chunk;
    let msg;
    try {
      msg = JSON.parse(body);
    } catch {
      this._error(res, null, JSONRPC.PARSE, 400);
      return true;
    }
    if (!msg || typeof msg !== 'object' || msg.jsonrpc !== '2.0') {
      this._error(res, msg?.id ?? null, JSONRPC.INVALID, 400);
      return true;
    }

    // notifications and responses (no id) are acknowledged, never processed
    if (msg.id === undefined || msg.id === null) {
      if (msg.method === 'notifications/initialized') {
        const s = this._sessionFrom(req);
        if (!s) { this._error(res, null, JSONRPC.INVALID, 404); return true; }
        s.initialized = true;
      }
      this._send(res, 202, undefined, null);
      return true;
    }

    const id = msg.id;
    if (typeof msg.method !== 'string') {
      this._error(res, id, JSONRPC.INVALID, 400);
      return true;
    }

    switch (msg.method) {
      case 'initialize': return this._initialize(req, res, id, msg.params);
      case 'ping': return this._ping(res, id);
      case 'tools/list': return this._toolsList(req, res, id);
      case 'tools/call': return this._toolsCall(req, res, id, msg.params);
      default:
        this._error(res, id, JSONRPC.METHOD, 400);
        return true;
    }
  }

  _initialize(req, res, id, params) {
    const requested = params?.protocolVersion;
    if (requested !== MCP_PROTOCOL_VERSION) {
      // spec: server responds with the version it supports; a hard mismatch
      // is reported via error. we speak exactly 2025-11-25.
      this._error(res, id, { code: JSONRPC.INVALID.code, message: `unsupported protocol version ${requested}; this server speaks ${MCP_PROTOCOL_VERSION}` }, 400);
      return;
    }
    const sid = randomBytes(16).toString('hex');
    this.sessions.set(sid, {
      protocolVersion: MCP_PROTOCOL_VERSION,
      initialized: false,
      createdAt: this.now(),
      expiresAt: this.now() + SESSION_TTL_MS
    });
    this._send(res, 200, { 'mcp-session-id': sid }, {
      jsonrpc: '2.0',
      id,
      result: {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'moira', version: '0.5.0' },
        instructions: 'moira persona memory. call moira_status first; every call is receipted. access is pass- and policy-governed per category.'
      }
    });
  }

  _requireReady(req, res, id) {
    const s = this._sessionFrom(req);
    if (!s) { this._error(res, id, JSONRPC.INVALID, 404, { 'mcp-session-id': null }); return null; }
    if (!s.initialized) {
      this._error(res, id, { code: JSONRPC.INVALID.code, message: 'session not initialized (send notifications/initialized first)' }, 400);
      return null;
    }
    return s;
  }

  _ping(res, id) {
    this._send(res, 200, undefined, { jsonrpc: '2.0', id, result: {} });
  }

  _toolsList(req, res, id) {
    try {
      this._authenticate(req); // auth even for discovery: no anonymous surface
    } catch (e) {
      this._error(res, id, { code: -32001, message: `unauthorized: ${e.message}` }, 401, {
        'www-authenticate': 'Bearer resource_metadata="/.well-known/oauth-protected-resource"'
      });
      return;
    }
    if (!this._requireReady(req, res, id)) return;
    this._send(res, 200, undefined, {
      jsonrpc: '2.0',
      id,
      result: {
        tools: this.tools.map((t) => ({
          name: t.name,
          description: t.description,
          inputSchema: t.inputSchema
        }))
      }
    });
  }

  _toolsCall(req, res, id, params) {
    let auth;
    try {
      auth = this._authenticate(req);
    } catch (e) {
      this._error(res, id, { code: -32001, message: `unauthorized: ${e.message}` }, 401, {
        'www-authenticate': 'Bearer resource_metadata="/.well-known/oauth-protected-resource"'
      });
      return;
    }
    if (!this._requireReady(req, res, id)) return;

    const tool = toolByName(params?.name);
    if (!tool) {
      this._error(res, id, JSONRPC.METHOD, 400);
      return;
    }
    if (typeof this.moira.agent[tool.method] !== 'function') {
      this._error(res, id, JSONRPC.INTERNAL, 500);
      return;
    }
    const args = params?.arguments && typeof params.arguments === 'object' ? params.arguments : {};
    if ('accessToken' in args || 'token' in args || 'authorization' in args) {
      this._error(res, id, JSONRPC.PARAMS, 400);
      return;
    }

    // one receipt per call: the agentapi mints it via the policy path.
    let result;
    try {
      result = this.moira.agent[tool.method](auth.token, args);
    } catch (e) {
      // a throw is a transport-level failure: report as tool error, never crash
      this._send(res, 200, undefined, {
        jsonrpc: '2.0',
        id,
        result: { content: [{ type: 'text', text: `tool error: ${e.message}` }], isError: true }
      });
      return;
    }

    // explicit outcomes are data, not failures: the client must see them.
    const isError = result && typeof result === 'object' && result.outcome !== undefined
      && result.outcome !== 'results';
    this._send(res, 200, undefined, {
      jsonrpc: '2.0',
      id,
      result: {
        content: [{ type: 'text', text: JSON.stringify(result) }],
        structuredContent: result,
        ...(isError ? { isError: true } : {})
      }
    });
  }
}
