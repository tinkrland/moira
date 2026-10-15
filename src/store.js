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
