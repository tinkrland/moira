// context sets: declarations are context broadly, organized in named sets
// per persona. sets are IMPLICIT: a set exists because entries reference it
// (first declaration creates it, no orphan bookkeeping), names are normalized
// (trim, case-insensitive match, first-seen display form kept), and one set
// can hold stack tools and ai tools together. the connection-time choice
// lives on the pass: a set-scoped pass exposes exactly its sets' entries, an
// unscoped pass keeps the whole persona context.

import { OUTCOME } from '../model/constants.js';

const norm = (name) => String(name).trim();

export class SetsService {
  constructor({ store, personas }) {
    this.store = store;
    this.personas = personas;
  }

  _entries(personaId) {
    const stack = this.store.list('stackEntries', (e) => e.personaId === personaId, { personaId });
    const ai = this.store.list('aiToolEntries', (e) => e.personaId === personaId, { personaId });
    const facts = this.store.list('facts', (e) => e.personaId === personaId && e.status === 'active', { personaId });
    // vault items keep sets inside the sealed payload; the vault service
    // opens them for this persona and hands back only the set names.
    const vault = this.vault ? this.vault.setEntries(personaId) : [];
    return [...stack, ...ai, ...facts, ...vault];
  }

  list(personaId) {
    const persona = this.personas.get(personaId);
    if (!persona) return { outcome: OUTCOME.UNAVAILABLE, reason: 'persona_not_found' };
    const byName = new Map(); // lowercase key -> { name, count }
    for (const e of this._entries(personaId)) {
      for (const raw of e.sets ?? []) {
        const name = norm(raw);
        if (!name) continue;
        const key = name.toLowerCase();
        if (!byName.has(key)) byName.set(key, { name, count: 0 });
        byName.get(key).count++;
      }
    }
    const sets = [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
    return { outcome: OUTCOME.RESULTS, sets };
  }

  // removing a set untags its entries; entries survive
  remove(personaId, name) {
    const persona = this.personas.get(personaId);
    if (!persona) return { outcome: OUTCOME.UNAVAILABLE, reason: 'persona_not_found' };
    const target = norm(name ?? '');
    if (!target) return { outcome: OUTCOME.DECLINED, reason: 'set_name_required' };
    const key = target.toLowerCase();
    const kinds = [
      { kind: 'stackEntries', field: 'stack' },
      { kind: 'aiToolEntries', field: 'ai' },
      { kind: 'facts', field: 'facts' }
    ];
    let touched = 0;
    for (const { kind } of kinds) {
      for (const e of this.store.list(kind, (x) => x.personaId === personaId, { personaId })) {
        if (!(e.sets ?? []).some((s) => norm(s).toLowerCase() === key)) continue;
        const kept = (e.sets ?? []).filter((s) => norm(s).toLowerCase() !== key);
        this.store.update(kind, e.id, (x) => ({ ...x, sets: kept, updatedAt: this.now?.() ?? x.updatedAt }));
        touched++;
      }
    }
    if (this.vault) touched += this.vault.untagSet(personaId, target);
    if (touched === 0) return { outcome: OUTCOME.UNAVAILABLE, reason: 'set_not_found' };
    return { outcome: OUTCOME.RESULTS, untagged: touched };
  }
}

// shared filter: which entries does a pass see?
export function entriesForPass(entries, pass) {
  const scope = pass?.sets;
  if (!Array.isArray(scope) || scope.length === 0) return entries; // unscoped: whole persona context
  const allowed = new Set(scope.map((s) => norm(s).toLowerCase()));
  return entries.filter((e) => (e.sets ?? []).some((s) => norm(s).toLowerCase() && allowed.has(norm(s).toLowerCase())));
}
