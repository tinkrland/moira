// the persona vault (owner direction, 2026-10-26): mymind's capture-anything
// meets linkwarden's preservation, sealed per persona.
//
// design rules, in one breath:
// - capture is frictionless: a link, a note, an image, a file. no folder is
//   required, no tag is required. mymind's promise, kept deterministically.
// - organize later, only by union: tags and sets are added after capture and
//   never replace what is already there.
// - saving is not liking: an item is evidence of a save, never a taste
//   claim. connector captures stay untrusted with provenance attached.
// - preservation beats link-rot: an optional snapshot fetched at capture time
//   rests sealed in the vault, with a digest for integrity. agents get the
//   digest; the archive belongs to the owner.
// - absent means absent: no snapshot fetch, no snapshot field. no phantom
//   measurement, no phantom archive.
// - sealing is structural: payloads (title, url, note, tags, sets, snapshot)
//   live under the persona's vault key; the store row holds only id, kind
//   and timestamps.
// - heteronym isolation is free: every row is keyed by persona and sealed
//   under that persona's key. the vault of one persona never opens for
//   another, by construction.

import { createHash } from 'node:crypto';
import { randomId } from '../util/crypto.js';
import { OUTCOME, VAULT_CATEGORY, VAULT_KINDS, RECEIPT_OP } from '../model/constants.js';
import { entriesForPass } from './sets.js';

const SNAPSHOT_CAP = 128 * 1024; // bytes; a page body, not a mirror of the web

export class VaultService {
  constructor({ store, personas, keys, receipts, now = () => Date.now() }) {
    this.store = store;
    this.personas = personas;
    this.keys = keys;
    this.receipts = receipts;
    this.now = now;
  }

  // owner-side capture. snapshot fetching is injectable (same discipline as
  // the connector adapters): the core stays deterministic and offline.
  async add(personaId, spec = {}, fetcher = null) {
    const persona = this.personas.get(personaId);
    if (!persona) return { outcome: OUTCOME.UNAVAILABLE, reason: 'persona_not_found' };
    const kind = spec.kind;
    if (!VAULT_KINDS.includes(kind)) return { outcome: OUTCOME.DECLINED, reason: 'unknown_kind' };
    if (kind === 'note' && !spec.note) return { outcome: OUTCOME.DECLINED, reason: 'note_required' };
    if (kind !== 'note' && !spec.url) return { outcome: OUTCOME.DECLINED, reason: 'url_required' };

    const source = spec.source && typeof spec.source === 'object'
      ? { ...spec.source }
      : { via: 'owner' };
    // a connector capture is untrusted by construction (usage is not liking)
    if (source.via === 'connector') source.untrusted = true;

    const payload = {
      url: spec.url ?? null,
      title: spec.title ?? (kind === 'note' ? null : spec.url),
      note: spec.note ?? null,
      tags: [...new Set((spec.tags ?? []).map(String))],
      sets: [...new Set((spec.sets ?? []).map(String))],
      source
    };

    // linkwarden's half: preserve at capture time, sealed. failures are
    // honest: no snapshot rather than a broken one.
    if (spec.snapshot && spec.url && fetcher) {
      try {
        const res = await fetcher(spec.url);
        if (res && res.ok) {
          const text = await res.text();
          if (text) {
            payload.snapshot = text.slice(0, SNAPSHOT_CAP);
            payload.snapshotDigest = createHash('sha256').update(text).digest('hex').slice(0, 16);
            payload.snapshotAt = this.now();
          }
        }
      } catch {
        /* absent means absent */
      }
    }

    const id = randomId();
    const sealed = this.keys.sealPayload(personaId, VAULT_CATEGORY, `item:${id}`, payload);
    this.store.put('vaultItems', id, { id, personaId, kind, createdAt: this.now(), sealed });
    this.receipts.write({ actor: 'owner', personaId, op: RECEIPT_OP.VAULT, reason: 'vault_add' });
    return { outcome: OUTCOME.RESULTS, item: { id, kind } };
  }

  // open the persona's items in-process. only ever called for the owner or
  // under a verified pass.
  _open(personaId) {
    return this.store.list('vaultItems', (r) => r.personaId === personaId)
      .sort((a, b) => a.createdAt - b.createdAt)
      .map((r) => {
        const p = this.keys.openPayload(personaId, VAULT_CATEGORY, `item:${r.id}`, r.sealed) ?? {};
        return { id: r.id, kind: r.kind, createdAt: r.createdAt, ...p };
      });
  }

  list(personaId, { kinds = null, tags = null } = {}) {
    const persona = this.personas.get(personaId);
    if (!persona) return { outcome: OUTCOME.UNAVAILABLE, reason: 'persona_not_found' };
    let items = this._open(personaId);
    if (kinds) items = items.filter((i) => kinds.includes(i.kind));
    if (tags) items = items.filter((i) => tags.some((t) => i.tags.includes(t)));
    return { outcome: OUTCOME.RESULTS, items };
  }

  // organize later: tags and sets UNION, never replace. a mistag is undone
  // by vaultUntag, not by silently losing earlier organization.
  tag(personaId, id, { tags = [], sets = [] } = {}) {
    const row = this.store.list('vaultItems', (r) => r.personaId === personaId && r.id === id)[0];
    if (!row) return { outcome: OUTCOME.UNAVAILABLE, reason: 'item_not_found' };
    // re-seal through the store's atomic update path (cas on hosted stores):
    // a concurrent tag can never silently drop the other side's union.
    const next = this.store.update('vaultItems', row.id, (rec) => {
      const p = this.keys.openPayload(personaId, VAULT_CATEGORY, `item:${row.id}`, rec.sealed) ?? {};
      p.tags = [...new Set([...(p.tags ?? []), ...tags.map(String)])];
      p.sets = [...new Set([...(p.sets ?? []), ...sets.map(String)])];
      rec.sealed = this.keys.sealPayload(personaId, VAULT_CATEGORY, `item:${row.id}`, p);
      return rec;
    });
    if (!next) return { outcome: OUTCOME.DECLINED, reason: 'tag_conflict' };
    const p = this.keys.openPayload(personaId, VAULT_CATEGORY, `item:${row.id}`, next.sealed) ?? {};
    this.receipts.write({ actor: 'owner', personaId, op: RECEIPT_OP.VAULT, reason: 'vault_tag' });
    return { outcome: OUTCOME.RESULTS, tags: p.tags ?? [], sets: p.sets ?? [] };
  }

  // removal is a shred: the sealed payload dies with the row.
  remove(personaId, id) {
    const row = this.store.list('vaultItems', (r) => r.personaId === personaId && r.id === id)[0];
    if (!row) return { outcome: OUTCOME.UNAVAILABLE, reason: 'item_not_found' };
    this.store.del('vaultItems', row.id);
    this.receipts.write({ actor: 'owner', personaId, op: RECEIPT_OP.VAULT, reason: 'vault_remove' });
    return { outcome: OUTCOME.RESULTS, removed: id };
  }

  // agent side: pass-gated, sets-scoped (connection-time choice, same as
  // stack/ai), deterministic substring match. the snapshot itself stays
  // sealed; the agent receives the digest and the metadata.
  serve(personaId, pass, { q = null, kinds = null, tags = null } = {}) {
    let items = entriesForPass(this._open(personaId), pass);
    if (kinds) items = items.filter((i) => kinds.includes(i.kind));
    if (tags) items = items.filter((i) => tags.some((t) => i.tags.includes(t)));
    if (q) {
      const needle = String(q).toLowerCase();
      items = items.filter((i) =>
        [i.title, i.note, i.url, ...(i.tags ?? [])].some((f) => f && String(f).toLowerCase().includes(needle)));
    }
    return {
      outcome: OUTCOME.RESULTS,
      items: items.map((i) => {
        const { snapshot, ...meta } = i; // eslint-disable-line no-unused-vars
        return meta;
      })
    };
  }
}
