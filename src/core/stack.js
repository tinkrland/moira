// stack context declarations: the owner tells moira what their stack IS,
// tool by tool, use by use, so agents stop hallucinating it. the shape is
// the nested multiselect: one tool entry, many independently selected uses
// (supabase: auth + postgres, but NOT storage unless declared). entries are
// owner-stated (basis 'stated'), persona-scoped, and served to agents
// structured - tool + sorted uses - never as prose to paraphrase.

import { randomId } from '../util/crypto.js';
import { OUTCOME, PERSONA_STATUS } from '../model/constants.js';

export class StackService {
  constructor({ store, personas, receipts, now = Date.now }) {
    this.store = store;
    this.personas = personas;
    this.receipts = receipts;
    this.now = now;
  }

  _list(personaId) {
    return this.store.list('stackEntries', (e) => e.personaId === personaId, { personaId });
  }

  _usable(personaId) {
    const persona = this.personas.get(personaId);
    if (!persona) return { outcome: OUTCOME.UNAVAILABLE, reason: 'persona_not_found' };
    if (persona.status === PERSONA_STATUS.FROZEN) return { outcome: OUTCOME.DECLINED, reason: 'persona_frozen' };
    return null;
  }

  // upsert: declaring a tool again unions the uses into one entry (the point
  // of the multiselect: multiple uses of supabase accumulate, they never
  // spawn duplicate rows and never silently replace earlier uses). the pill
  // flow adds the tool FIRST and describes its uses after, so an empty uses
  // list is a valid "not described yet" state, and an empty re-add is a
  // quiet no-op, never a wipe.
  // two declaration flows, the owner's choice:
  //   tool-first (the pill flow): { tool, uses }
  //   category-first: { category, tools: [{ tool, uses }] } - define
  //   "frontend" with its corresponding stuff in one call
  // a tool is a tool either way: re-declaring through either flow unions
  // uses and never drops the recorded category. category batches are
  // all-or-nothing: an invalid entry declines the whole call, so nothing
  // half-applies.
  add(personaId, spec) {
    const hasTool = spec.tool !== undefined && spec.tool !== null;
    const hasTools = spec.tools !== undefined && spec.tools !== null;
    if (hasTool && hasTools) return { outcome: OUTCOME.DECLINED, reason: 'pick_one_flow' };
    if (hasTools) {
      if (typeof spec.category !== 'string' || spec.category.trim() === '') {
        return { outcome: OUTCOME.DECLINED, reason: 'category_required' };
      }
      if (!Array.isArray(spec.tools) || spec.tools.length === 0) {
        return { outcome: OUTCOME.DECLINED, reason: 'tools_required' };
      }
      if (!spec.tools.every((e) => e && typeof e === 'object' && typeof e.tool === 'string')) {
        return { outcome: OUTCOME.DECLINED, reason: 'tools_entries_invalid' };
      }
      // validate every entry first, then apply: all-or-nothing
      const gate = this._usable(personaId);
      if (gate) return gate;
      const results = [];
      for (const e of spec.tools) {
        const res = this._upsert(personaId, { tool: e.tool, uses: e.uses, category: spec.category.trim(), sets: e.sets });
        if (res.outcome !== OUTCOME.RESULTS) return res;
        results.push(res.entry);
      }
      return { outcome: OUTCOME.RESULTS, entries: results };
    }
    const res = this._upsert(personaId, { tool: spec.tool, uses: spec.uses, category: spec.category ?? null, sets: spec.sets });
    if (res.outcome === OUTCOME.RESULTS && Array.isArray(res.entry)) {
      return { outcome: OUTCOME.RESULTS, entry: res.entry }; // shape parity
    }
    return res;
  }

  _upsert(personaId, { tool, uses, category = null, sets = null }) {
    const gate = this._usable(personaId);
    if (gate) return gate;
    const t = typeof tool === 'string' ? tool.trim() : '';
    if (!t) return { outcome: OUTCOME.DECLINED, reason: 'tool_required' };
    const cat = typeof category === 'string' && category.trim() !== '' ? category.trim() : null;
    if (sets !== undefined && sets !== null && (!Array.isArray(sets) || !sets.every((x) => typeof x === 'string' && x.trim() !== ''))) {
      return { outcome: OUTCOME.DECLINED, reason: 'sets_invalid' };
    }
    const setList = Array.isArray(sets) ? [...new Set(sets.map((x) => x.trim()))].filter(Boolean).sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase())) : [];
    if (uses !== undefined && uses !== null && (!Array.isArray(uses) || !uses.every((u) => typeof u === 'string' && u.trim() !== ''))) {
      return { outcome: OUTCOME.DECLINED, reason: 'uses_required' };
    }
    const given = Array.isArray(uses) ? uses : [];
    if (given.length === 0) {
      const bare = this._list(personaId).find((e) => e.tool.toLowerCase() === t.toLowerCase());
      if (bare) return { outcome: OUTCOME.RESULTS, entry: bare }; // no-op: empty add never wipes
      const entry = {
        id: randomId('stack'),
        personaId,
        tool: t,
        category: cat,
        uses: [],
        basis: 'stated', // owner-stated, never inferred
        createdAt: this.now(),
        updatedAt: this.now()
      };
      this.store.put('stackEntries', entry.id, entry);
      this.receipts.write({ actor: 'owner', personaId, op: 'read', reason: 'stack_declared' });
      return { outcome: OUTCOME.RESULTS, entry };
    }
    const normalized = [...new Set(given.map((u) => u.trim()))].sort();
    const existing = this._list(personaId).find((e) => e.tool.toLowerCase() === t.toLowerCase());
    if (existing) {
      const merged = [...new Set([...existing.uses, ...normalized])].sort();
      // the category already recorded is never dropped by a later add;
      // set membership unions the same way
      const keepCat = existing.category ?? cat;
      const keepSets = [...new Set([...(existing.sets ?? []), ...setList])].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
      this.store.update('stackEntries', existing.id, (e) => ({ ...e, uses: merged, category: keepCat, sets: keepSets, updatedAt: this.now() }));
      return { outcome: OUTCOME.RESULTS, entry: { ...existing, uses: merged, category: keepCat, sets: keepSets } };
    }
    const entry = {
      id: randomId('stack'),
      personaId,
      tool: t,
      category: cat,
      sets: setList,
      uses: normalized,
      basis: 'stated', // owner-stated, never inferred
      createdAt: this.now(),
      updatedAt: this.now()
    };
    this.store.put('stackEntries', entry.id, entry);
    this.receipts.write({ actor: 'owner', personaId, op: 'read', reason: 'stack_declared' });
    return { outcome: OUTCOME.RESULTS, entry };
  }

  // remove the whole tool, or just some of its uses
  remove(personaId, { tool, uses = null }) {
    const gate = this._usable(personaId);
    if (gate) return gate;
    const existing = this._list(personaId).find((e) => e.tool.toLowerCase() === String(tool ?? '').trim().toLowerCase());
    if (!existing) return { outcome: OUTCOME.UNAVAILABLE, reason: 'stack_entry_not_found' };
    if (uses == null) {
      this.store.del('stackEntries', existing.id);
      return { outcome: OUTCOME.RESULTS, removed: 'all' };
    }
    if (!Array.isArray(uses) || uses.length === 0) {
      return { outcome: OUTCOME.DECLINED, reason: 'uses_required' };
    }
    const drop = new Set(uses.map((u) => u.trim().toLowerCase()));
    const kept = existing.uses.filter((u) => !drop.has(u.toLowerCase())).sort();
    if (kept.length === 0) {
      this.store.del('stackEntries', existing.id);
      return { outcome: OUTCOME.RESULTS, removed: 'all' };
    }
    this.store.update('stackEntries', existing.id, (e) => ({ ...e, uses: kept, updatedAt: this.now() }));
    return { outcome: OUTCOME.RESULTS, entry: { ...existing, uses: kept } };
  }

  list(personaId) {
    const persona = this.personas.get(personaId);
    if (!persona) return { outcome: OUTCOME.UNAVAILABLE, reason: 'persona_not_found' };
    const entries = this._list(personaId)
      .map((e) => ({ tool: e.tool, category: e.category ?? null, sets: e.sets ?? [], uses: e.uses }))
      .sort((a, b) => a.tool.localeCompare(b.tool));
    return { outcome: OUTCOME.RESULTS, entries };
  }
}
