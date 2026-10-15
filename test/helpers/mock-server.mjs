// standalone mock postgrest server for the supabase adapter tests.
// spawned as a child process so its event loop keeps serving http while the
// test's main thread blocks in the store's atomics handshake.
//
// usage: node test/helpers/mock-server.mjs
// prints {"port": <n>} on stdout once listening.
//
// test control endpoints (never part of the postgrest contract):
//   GET  /_test/filterlog        -> { log: [...] }
//   POST /_test/corrupt-version  -> { table, id }   bumps a row's version
//   POST /_test/reset            -> wipes all tables and logs

import http from 'node:http';

const unquote = (v) => {
  if (v.startsWith('"') && v.endsWith('"')) {
    return v.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, '\\');
  }
  return v;
};

const tables = new Map(); // table -> Map(id -> row)
const filterLog = [];
let seq = 0;

const tableOf = (name) => {
  if (!tables.has(name)) tables.set(name, new Map());
  return tables.get(name);
};

function matches(row, filters) {
  for (const [key, op, value] of filters) {
    if (op !== 'eq') throw new Error(`mock only supports eq, got ${op}`);
    let actual;
    if (key === 'id') actual = row.id;
    else if (key === 'version') actual = row.version;
    else if (key === 'persona_id') actual = row.data?.personaId ?? null;
    else if (key.startsWith('data->>')) actual = row.data?.[key.slice(7)] ?? null;
    else throw new Error(`mock cannot filter on ${key}`);
    if (actual !== value) return false;
  }
  return true;
}

function parseFilters(searchParams) {
  // postgrest filter params: key=op.value. the value is taken literally
  // (phase 1 finding: real postgrest does not strip quotes from ->> text
  // filters, so eq."v" matches the literal string "v" - with quotes - and
  // silently returns zero rows. the mock must mirror that, so any quoted
  // value in the adapter's wire format fails here like it would for real).
  const filters = [];
  for (const [k, rest] of searchParams.entries()) {
    if (['select', 'order', 'limit'].includes(k)) continue;
    const dot = rest.indexOf('.');
    filters.push([k, rest.slice(0, dot), rest.slice(dot + 1)]);
  }
  return filters;
}

const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    try {
      handle(req, res, body);
    } catch (e) {
      res.writeHead(500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ message: String(e) }));
    }
  });
});

function handle(req, res, body) {
  const u = new URL(req.url, 'http://localhost');
  const prefer = req.headers.prefer || '';

  if (u.pathname === '/_test/filterlog') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ log: filterLog }));
    return;
  }
  if (u.pathname === '/_test/corrupt-version') {
    const { table, id } = JSON.parse(body);
    const row = tableOf(table).get(id);
    if (row) row.version += 1;
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end('{}');
    return;
  }
  if (u.pathname === '/_test/reset') {
    tables.clear();
    filterLog.length = 0;
    seq = 0;
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end('{}');
    return;
  }

  if (req.method === 'POST' && u.pathname === '/rest/v1/rpc/moira_cas_update') {
    const { p_table, p_id, p_version, p_data } = JSON.parse(body);
    const t = tableOf(`moira_${p_table}`);
    const row = t.get(p_id);
    if (!row || row.version !== p_version) {
      res.writeHead(204);
      res.end();
      return;
    }
    row.data = p_data;
    row.version += 1;
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(row.data));
    return;
  }

  const m = u.pathname.match(/^\/rest\/v1\/moira_([a-z_]+)$/);
  if (!m) {
    res.writeHead(404).end('{}');
    return;
  }
  const t = tableOf(u.pathname.slice('/rest/v1/'.length));
  const filters = parseFilters(u.searchParams);
  if (filters.length) filterLog.push(filters.map((f) => f.join(':')).join(','));
  const wantsRepresentation = prefer.includes('return=representation');

  if (req.method === 'POST') {
    const payload = JSON.parse(body);
    const rows = Array.isArray(payload) ? payload : [payload];
    const out = [];
    const ignore = prefer.includes('ignore-duplicates');
    const merge = prefer.includes('merge-duplicates');
    for (const r of rows) {
      const existing = t.get(r.id);
      if (existing && ignore) continue;
      if (existing && merge) {
        existing.data = r.data;
        existing.version += 1;
        out.push(existing);
      } else if (!existing) {
        const row = { id: r.id, data: r.data, version: 1, created_at: ++seq };
        t.set(r.id, row);
        out.push(row);
      } else {
        res.writeHead(409, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ message: 'duplicate key violates unique constraint' }));
        return;
      }
    }
    res.writeHead(201, { 'content-type': 'application/json' });
    res.end(JSON.stringify(wantsRepresentation ? out : []));
    return;
  }

  if (req.method === 'DELETE') {
    const out = [];
    for (const [id, row] of [...t]) {
      if (matches(row, filters)) {
        t.delete(id);
        out.push(row);
      }
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(wantsRepresentation ? out : []));
    return;
  }

  if (req.method === 'GET') {
    const matched = [...t.values()]
      .filter((row) => matches(row, filters))
      .sort((a, b) => a.created_at - b.created_at);
    const range = req.headers.range;
    const countExact = prefer.includes('count=exact');
    let slice = matched;
    let status = 200;
    const headers = { 'content-type': 'application/json' };
    if (range) {
      const [start, end] = range.replace('items=', '').split('-').map(Number);
      slice = matched.slice(start, end + 1);
      if (countExact) {
        headers['content-range'] = matched.length === 0 || slice.length === 0
          ? `*/${matched.length}`
          : `${start}-${start + slice.length - 1}/${matched.length}`;
        status = 206;
      }
    }
    res.writeHead(status, headers);
    res.end(JSON.stringify(slice));
    return;
  }

  res.writeHead(405).end('{}');
}

server.listen(0, '127.0.0.1', () => {
  process.stdout.write(JSON.stringify({ port: server.address().port }) + '\n');
});
