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
  // spawn duplicate rows and never silently replace earlier uses)
  add(personaId, { tool, uses }) {
    const gate = this._usable(personaId);
    if (gate) return gate;
    const t = typeof tool === 'string' ? tool.trim() : '';
    if (!t) return { outcome: OUTCOME.DECLINED, reason: 'tool_required' };
    if (!Array.isArray(uses) || uses.length === 0 || !uses.every((u) => typeof u === 'string' && u.trim() !== '')) {
      return { outcome: OUTCOME.DECLINED, reason: 'uses_required' };
    }
    const normalized = [...new Set(uses.map((u) => u.trim()))].sort();
    const existing = this._list(personaId).find((e) => e.tool.toLowerCase() === t.toLowerCase());
    if (existing) {
      const merged = [...new Set([...existing.uses, ...normalized])].sort();
      this.store.update('stackEntries', existing.id, (e) => ({ ...e, uses: merged, updatedAt: this.now() }));
      return { outcome: OUTCOME.RESULTS, entry: { ...existing, uses: merged } };
    }
    const entry = {
      id: randomId('stack'),
      personaId,
      tool: t,
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
      .map((e) => ({ tool: e.tool, uses: e.uses }))
      .sort((a, b) => a.tool.localeCompare(b.tool));
    return { outcome: OUTCOME.RESULTS, entries };
  }
}
