// store. an explicit, narrow persistence interface so a hosted deployment can
// slot postgres behind it without touching any service code.
//
// in-memory implementation for the core build. the interface is intentionally
// CRUD + append-only + scan, nothing clever. row-level shapes are defined by
// the services; this layer only stores records.

export class MemoryStore {
  constructor() {
    this.colls = new Map();
  }

  _coll(name) {
    if (!this.colls.has(name)) this.colls.set(name, new Map());
    return this.colls.get(name);
  }

  put(coll, id, record) {
    this._coll(coll).set(id, { ...record });
    return this.get(coll, id);
  }

  get(coll, id) {
    const r = this._coll(coll).get(id);
    return r === undefined ? null : { ...r };
  }

  has(coll, id) {
    return this._coll(coll).has(id);
  }

  del(coll, id) {
    return this._coll(coll).delete(id);
  }

  // atomic read-modify-write. fn receives a mutable copy and returns the new
  // record, or null to abort.
  update(coll, id, fn) {
    const c = this._coll(coll);
    if (!c.has(id)) return null;
    const next = fn({ ...c.get(id) });
    if (next === null || next === undefined) return null;
    c.set(id, next);
    return { ...next };
  }

  // pred is always authoritative. `where` is an optional equality pushdown
  // hint: async stores (supabase) translate it into server-side filters so
  // persona-scoped reads do not transfer whole tables.
  list(coll, pred = () => true, where = null) {
    return [...this._coll(coll).values()].filter(pred).map((r) => ({ ...r }));
  }

  count(coll, pred = () => true, where = null) {
    return this.list(coll, pred, where).length;
  }

  // append-only collections (receipts, workspace). no update or delete path
  // is exposed for these; deletion goes through the owning service.
  append(coll, record) {
    const c = this._coll(coll);
    const id = record.id;
    if (c.has(id)) throw new Error(`append-only collision on ${coll}:${id}`);
    c.set(id, { ...record });
    return { ...record };
  }
}

// file-backed store: the CLI's persistence. same interface as MemoryStore,
// loaded from a single JSON file at boot and flushed atomically (write
// temp + rename) after every mutation. good for a local, single-process
// owner machine - the sovereign tier's simplest real store. not for
// concurrency: last writer wins across processes, which is fine here
// because the CLI is the only writer on an owner's laptop.
import { readFileSync, writeFileSync, renameSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomBytes } from 'node:crypto';

export class FileStore extends MemoryStore {
  constructor(path) {
    super();
    this.path = path;
    if (existsSync(path)) {
      const saved = JSON.parse(readFileSync(path, 'utf8'));
      for (const [name, rows] of Object.entries(saved)) {
        this._coll(name);
        for (const [id, record] of Object.entries(rows)) this._coll(name).set(id, record);
      }
    }
  }

  _flush() {
    const saved = {};
    for (const [name, coll] of this.colls) saved[name] = Object.fromEntries(coll);
    const tmp = `${this.path}.tmp-${randomBytes(4).toString('hex')}`;
    if (!existsSync(dirname(this.path))) mkdirSync(dirname(this.path), { recursive: true });
    writeFileSync(tmp, JSON.stringify(saved));
    renameSync(tmp, this.path);
  }

  put(coll, id, record) { const r = super.put(coll, id, record); this._flush(); return r; }
  update(coll, id, fn) { const r = super.update(coll, id, fn); this._flush(); return r; }
  del(coll, id) { const r = super.del(coll, id); this._flush(); return r; }
  append(coll, record) { const r = super.append(coll, record); this._flush(); return r; }
}
