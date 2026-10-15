// supabase-backed store (persistence adapter).
//
// implements the same narrow store interface as memorystore, but backed by a
// supabase/postgres database through its postgrest endpoint. zero
// dependencies: node's built-in fetch only.
//
// the whole moira core is deliberately synchronous (deterministic, replayable
// policy decisions). to keep that interface while doing real network i/o, the
// http work runs on a worker thread and the calling thread blocks on an
// atomics handshake (the standard make-synchronous pattern). each store owns
// exactly one worker; requests are sequential from the calling thread.
//
// concurrency: update() uses an atomic compare-and-swap rpc
// (public.moira_cas_update in supabase/schema.sql) on a version column, with
// a bounded retry loop. no read-modify-write is ever lost silently.
//
// configuration:
//   SUPABASE_URL                 https://<project>.supabase.co
//   SUPABASE_SERVICE_ROLE_KEY    service role key (server-side only, never
//                                shipped to a client). RLS is enabled on all
//                                moira_ tables; the service role bypasses it.
//
// before first use, run supabase/schema.sql in the sql editor (or via the
// migration directory) to create the moira_ tables, indexes and the CAS rpc.

import { Worker } from 'node:worker_threads';

const HEADER_BYTES = 1024;
const REQUEST_BYTES = 8 * 1024 * 1024; // 8 MB request region
const RESPONSE_BYTES = 24 * 1024 * 1024; // 24 MB response region
const TOTAL_BYTES = HEADER_BYTES + REQUEST_BYTES + RESPONSE_BYTES;
const CTX = { HEADER: 0, REQ_LEN: 1, RESP_LEN: 2 }; // control ints
const ST = { IDLE: 0, REQ: 1, BUSY: 2, RESP: 3, ACK: 4 };
const PAGE = 500;

const WORKER_SRC = `
const { workerData } = require('node:worker_threads');
const sab = workerData.sab;
const HEADER_BYTES = workerData.headerBytes;
const REQ_OFFSET = HEADER_BYTES;
const RESP_OFFSET = HEADER_BYTES + workerData.requestBytes;
const ctl = new Int32Array(sab, 0, 8);
const enc = new TextEncoder();
const dec = new TextDecoder();

async function handle(req) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), req.timeoutMs || 15000);
  try {
    const res = await fetch(req.url, {
      method: req.method,
      headers: req.headers,
      body: req.body === undefined ? undefined : req.body,
      signal: ctrl.signal
    });
    const text = await res.text();
    let json = null;
    if (text) { try { json = JSON.parse(text); } catch { json = null; } }
    const headers = {};
    res.headers.forEach((v, k) => { headers[k] = v; });
    return { ok: res.ok, status: res.status, json, headers };
  } catch (e) {
    return { ok: false, status: 0, error: String((e && e.message) || e) };
  } finally {
    clearTimeout(t);
  }
}

(async function loop() {
  for (;;) {
    // idle: block until the main thread posts a request (state -> REQ)
    while (Atomics.wait(ctl, 0, 0) === 'ok') break;
    if (Atomics.load(ctl, 0) !== 1) continue;
    const reqLen = Atomics.load(ctl, 1);
    const req = JSON.parse(dec.decode(new Uint8Array(sab, REQ_OFFSET, reqLen)));
    Atomics.store(ctl, 0, 2); // BUSY; main thread is waiting for RESP
    Atomics.notify(ctl, 0);
    const resp = await handle(req);
    const bytes = enc.encode(JSON.stringify(resp));
    const cap = sab.byteLength - RESP_OFFSET;
    if (bytes.length > cap) {
      const err = enc.encode(JSON.stringify({ ok: false, status: 0, error: 'response exceeds shared buffer capacity' }));
      new Uint8Array(sab, RESP_OFFSET).set(err);
      Atomics.store(ctl, 2, err.length);
    } else {
      new Uint8Array(sab, RESP_OFFSET).set(bytes);
      Atomics.store(ctl, 2, bytes.length);
    }
    Atomics.store(ctl, 0, 3); // RESP
    Atomics.notify(ctl, 0);
    // wait for the main thread to acknowledge (state -> ACK), then go idle
    Atomics.wait(ctl, 0, 3);
    Atomics.store(ctl, 0, 0); // IDLE
    Atomics.notify(ctl, 0);
  }
})();
`;

function snake(name) {
  return name.replace(/([A-Z])/g, '_$1').toLowerCase();
}


export class SupabaseStore {
  constructor({ url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY, timeoutMs = 15000, now = Date.now } = {}) {
    if (!url || !key) {
      throw new Error('SupabaseStore requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY');
    }
    this.url = url.replace(/\/$/, '') + '/rest/v1';
    this.apiKey = key;
    // marks this store as persistent: the gateway refuses to start without
    // MOIRA_INSTANCE_KEY (vault wraps must survive restarts)
    this.persistent = true;
    this.timeoutMs = timeoutMs;
    this.now = now;
    this._worker = null;
    this._sab = null;
    this._enc = new TextEncoder();
    this._dec = new TextDecoder();
  }

  static fromEnv() {
    return new SupabaseStore({});
  }

  // --- worker plumbing -------------------------------------------------------

  _ensureWorker() {
    if (this._worker) return;
    this._sab = new SharedArrayBuffer(TOTAL_BYTES);
    const ctl = new Int32Array(this._sab, 0, 8);
    Atomics.store(ctl, CTX.HEADER, ST.IDLE);
    this._worker = new Worker(WORKER_SRC, {
      eval: true,
      workerData: { sab: this._sab, headerBytes: HEADER_BYTES, requestBytes: REQUEST_BYTES }
    });
    this._worker.unref?.();
  }

  _request(method, path, { query = [], headers = {}, body = undefined, prefer = null } = {}) {
    this._ensureWorker();
    const ctl = new Int32Array(this._sab, 0, 8);
    const req = {
      url: `${this.url}${path}${query.length ? '?' + query.join('&') : ''}`,
      method,
      timeoutMs: this.timeoutMs,
      headers: {
        apikey: this.apiKey,
        authorization: `Bearer ${this.apiKey}`,
        'content-type': 'application/json',
        ...(prefer ? { prefer } : {}),
        ...headers
      },
      body: body === undefined ? undefined : JSON.stringify(body)
    };

    const bytes = this._enc.encode(JSON.stringify(req));
    if (bytes.length > REQUEST_BYTES - HEADER_BYTES) {
      throw new Error('request exceeds shared buffer capacity');
    }
    new Uint8Array(this._sab, HEADER_BYTES).set(bytes);
    Atomics.store(ctl, CTX.REQ_LEN, bytes.length);
    Atomics.store(ctl, CTX.HEADER, ST.REQ);
    Atomics.notify(ctl, CTX.HEADER);
    // the worker walks IDLE -> REQ -> BUSY -> RESP; wait for RESP.
    Atomics.wait(ctl, CTX.HEADER, ST.REQ);
    while (Atomics.load(ctl, CTX.HEADER) === ST.BUSY) {
      Atomics.wait(ctl, CTX.HEADER, ST.BUSY);
    }
    if (Atomics.load(ctl, CTX.HEADER) !== ST.RESP) {
      throw new Error('store worker protocol error');
    }
    const respLen = Atomics.load(ctl, CTX.RESP_LEN);
    const resp = JSON.parse(this._dec.decode(new Uint8Array(this._sab, HEADER_BYTES + REQUEST_BYTES, respLen)));
    Atomics.store(ctl, CTX.HEADER, ST.ACK);
    Atomics.notify(ctl, CTX.HEADER);
    // wait for the worker to go idle before the next request reuses the buffer
    Atomics.wait(ctl, CTX.HEADER, ST.ACK);

    if (!resp.ok) {
      const detail = resp.json?.message || resp.error || `http ${resp.status}`;
      throw new Error(`supabase request failed (${path}): ${detail}`);
    }
    return resp;
  }

  _table(coll) {
    return `moira_${snake(coll)}`;
  }

  _first(resp) {
    const json = resp.json;
    return Array.isArray(json) ? (json.length ? json[0] : null) : json;
  }

  _rows(resp) {
    return Array.isArray(resp.json) ? resp.json : [];
  }

  // --- store interface ---------------------------------------------------------

  put(coll, id, record) {
    const resp = this._request('POST', `/${this._table(coll)}`, {
      prefer: 'resolution=merge-duplicates,return=representation',
      body: { id, data: record }
    });
    const row = this._first(resp);
    return row ? { ...row.data } : null;
  }

  get(coll, id) {
    const resp = this._request('GET', `/${this._table(coll)}`, {
      query: [`select=data`, `id=eq.${encodeURIComponent(id)}`]
    });
    const row = this._first(resp);
    return row ? row.data : null;
  }

  // row with version, for the CAS update path.
  _getRow(coll, id) {
    const resp = this._request('GET', `/${this._table(coll)}`, {
      query: [`select=data,version`, `id=eq.${encodeURIComponent(id)}`]
    });
    const row = this._first(resp);
    return row ? { data: row.data, version: row.version } : null;
  }

  has(coll, id) {
    const resp = this._request('GET', `/${this._table(coll)}`, {
      query: [`select=id`, `id=eq.${encodeURIComponent(id)}`]
    });
    return this._rows(resp).length > 0;
  }

  del(coll, id) {
    const resp = this._request('DELETE', `/${this._table(coll)}`, {
      query: [`id=eq.${encodeURIComponent(id)}`],
      prefer: 'return=representation'
    });
    return this._rows(resp).length > 0;
  }

  // atomic read-modify-write via the server-side CAS rpc. fn receives a
  // mutable copy and returns the new record, or null to abort. a version
  // conflict (another process updated the row) retries; updates are never
  // lost silently.
  update(coll, id, fn) {
    for (let attempt = 0; attempt < 8; attempt++) {
      const current = this._getRow(coll, id);
      if (!current) return null;
      const next = fn({ ...current.data });
      if (next === null || next === undefined) return null;
      const resp = this._request('POST', '/rpc/moira_cas_update', {
        body: { p_table: snake(coll), p_id: id, p_version: current.version, p_data: next }
      });
      if (resp.status === 204) continue; // cas miss: concurrent update, retry
      const updated = resp.json;
      if (updated && typeof updated === 'object' && updated.data !== undefined) {
        return { ...updated.data };
      }
      if (updated !== null && updated !== undefined) return { ...updated };
      continue;
    }
    throw new Error(`update contention on ${coll}:${id} (8 cas retries)`);
  }

  // append-only: refuses to overwrite an existing id.
  append(coll, record) {
    const resp = this._request('POST', `/${this._table(coll)}`, {
      prefer: 'resolution=ignore-duplicates,return=representation',
      body: { id: record.id, data: record }
    });
    const rows = this._rows(resp);
    if (rows.length === 0) {
      throw new Error(`append-only collision on ${coll}:${record.id}`);
    }
    return { ...rows[0].data };
  }

  // pred is authoritative; `where` is translated into server-side equality
  // filters so persona-scoped reads do not transfer whole tables. results
  // are paginated server-side (range requests) and ordered by created_at
  // (insertion order), matching the memory store's ordering contract.
  list(coll, pred = () => true, where = null) {
    const query = ['select=data', 'order=created_at.asc'];
    if (where) {
      for (const [k, v] of Object.entries(where)) {
        if (v === null || v === undefined) continue;
        const col = k === 'personaId' ? 'persona_id' : `data->>${k}`;
        query.push(`${col}=eq.${encodeURIComponent(v)}`);
      }
    }
    const rows = [];
    let offset = 0;
    for (let page = 0; page < 200; page++) {
      const resp = this._request('GET', `/${this._table(coll)}`, {
        query,
        headers: { range: `items=${offset}-${offset + PAGE - 1}` },
        prefer: 'count=exact'
      });
      const batch = this._rows(resp);
      rows.push(...batch);
      const range = resp.headers['content-range'];
      const total = range ? parseInt(range.split('/')[1], 10) : NaN;
      offset += PAGE;
      if (batch.length < PAGE || (!Number.isNaN(total) && offset >= total)) break;
    }
    return rows.map((r) => r.data).filter(pred).map((r) => ({ ...r }));
  }

  count(coll, pred = () => true, where = null) {
    return this.list(coll, pred, where).length;
  }

  async close() {
    if (this._worker) {
      await this._worker.terminate();
      this._worker = null;
      this._sab = null;
    }
  }
}
