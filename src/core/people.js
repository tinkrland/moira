// people: human context, per persona.
//
// the model is the owner's, stated twice in the docs and worth restating here
// because every wrong version of this feature starts by breaking it:
//
//   a relationship is (person, persona), never (person, owner) wholesale.
//   a person is one human in the address book; a relationship is the profile a
//   PERSONA holds of that human - its circles (soft tags, overlap welcome), its
//   importance (1..5, per persona, never inherited), and its note.
//   circles are not buckets: "friends" and "basically family" on one person is
//   exactly right, and the tags are implicit - a circle exists because a
//   profile carries it, like sets.
//   no persona is the "real you" with others playing roles, so no profile is
//   privileged: work-alex's 5 and sable's 2 are both true, and neither is the
//   fallback for an unprofiled persona. a person unknown to a persona does not
//   appear there at all.
//
// nothing here mints facts: importance and circles are owner-declared context,
// and a connector can never assert that someone matters.

import { randomId } from '../util/crypto.js';
import { OUTCOME, RECEIPT_OP } from '../model/constants.js';

const normTag = (tag) => String(tag).trim().replace(/\s+/g, ' ');

// an email or a phone is a key; anything else is not a handle we can dedupe on
function normalizeHandle(value) {
  if (typeof value !== 'string') return null;
  const s = value.trim().toLowerCase();
  if (!s) return null;
  if (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s)) return s.slice(0, 200);
  const digits = s.replace(/[^0-9+]/g, '');
  if (/^\+?[0-9]{7,15}$/.test(digits)) return digits;
  return null;
}

// a captured name is untrusted TEXT: links and @handles are not part of a name,
// and stripping them is not the same as trusting what is left
function sanitizeName(value) {
  if (typeof value !== 'string') return null;
  const cleaned = value
    .replace(/https?:\/\/\S+/gi, ' ')
    .replace(/@[a-z0-9_.-]+/gi, ' ')
    .replace(/[<>\[\]{}|\\^~`]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
  return cleaned || null;
}

export class PeopleService {
  constructor({ store, personas, receipts, now = Date.now }) {
    this.store = store;
    this.personas = personas;
    this.receipts = receipts;
    this.now = now;
  }

  // --- address book (owner-level: one row per human) ---------------------------

  addPerson({ name, aliases = [], handles = {} }) {
    const clean = normTag(name);
    if (!clean) return { outcome: OUTCOME.DECLINED, reason: 'name_required' };
    const dupe = this.store.list('people').find((p) => p.name.toLowerCase() === clean.toLowerCase());
    if (dupe) return { outcome: OUTCOME.DECLINED, reason: 'person_exists' };

    const person = {
      id: randomId('ppl'),
      name: clean,
      aliases: Array.isArray(aliases) ? aliases.map(normTag).filter(Boolean) : [],
      handles: {
        email: handles?.email ? String(handles.email).trim() : null,
        phone: handles?.phone ? String(handles.phone).trim() : null
      },
      createdAt: this.now()
    };
    this.store.put('people', person.id, person);
    this.receipts.write({ actor: 'owner', personaId: null, op: RECEIPT_OP.PEOPLE, reason: 'person_added' });
    return { outcome: OUTCOME.RESULTS, person };
  }

  // --- capture: signals arrive as proposals, never as people -----------------
  //
  // a calendar says someone attended a meeting. that is a signal, not a
  // relationship, and a connector cannot vouch for a human. so captured handles
  // land in a proposal list, counted and deduped, and only an owner accept
  // creates a person and a per-persona profile.

  ingest({ events = [], source = {} } = {}) {
    if (!Array.isArray(events)) return { outcome: OUTCOME.DECLINED, reason: 'events_required' };
    const accepted = [];
    const created = [];
    const rejected = [];
    for (const ev of events.slice(0, 500)) {
      const handle = normalizeHandle(ev?.handle);
      if (!handle) { rejected.push({ handle: ev?.handle ?? null, reason: 'handle_unusable' }); continue; }
      const name = sanitizeName(ev?.name);
      const at = Number.isFinite(ev?.at) ? ev.at : this.now();
      const existing = this.store.list('peopleProposals', (p) => p.key === handle && !p.declined && !p.closed, {})[0];
      if (existing) {
        const names = new Set(existing.nameCandidates ?? []);
        if (name) names.add(name);
        this.store.update('peopleProposals', existing.id, (p) => ({
          ...p,
          nameCandidates: [...names],
          sightings: (p.sightings ?? 1) + 1,
          lastSeenAt: Math.max(p.lastSeenAt ?? 0, at),
          kinds: [...new Set([...(p.kinds ?? []), String(ev?.kind ?? 'unknown').slice(0, 40)])]
        }));
        accepted.push(existing.id);
        continue;
      }
      const proposal = {
        id: randomId('ppp'),
        key: handle,
        nameCandidates: name ? [name] : [],
        kinds: [String(ev?.kind ?? 'unknown').slice(0, 40)],
        // provenance, and an explicit statement that it is not a claim
        source: { connectorId: source?.connectorId ?? null, project: source?.project ?? null },
        untrusted: true,
        sightings: 1,
        firstSeenAt: at,
        lastSeenAt: at,
        acceptedBy: [],
        declined: false,
        closed: false,
        createdAt: this.now()
      };
      this.store.put('peopleProposals', proposal.id, proposal);
      accepted.push(proposal.id);
      created.push(proposal.id);
    }
    this.receipts.write({ actor: 'connector', personaId: null, op: RECEIPT_OP.PEOPLE, reason: `captured:${accepted.length}` });
    // a repeat sighting is not a new proposal: the caller needs to be able to
    // tell "found two people" from "saw the same person twice"
    return {
      outcome: OUTCOME.RESULTS,
      proposed: created.length,
      repeated: accepted.length - created.length,
      rejected: rejected.length,
      proposalIds: accepted
    };
  }

  proposals({ includeDeclined = false } = {}) {
    const list = this.store.list('peopleProposals', (p) => includeDeclined || (!p.declined && !p.closed), {})
      .map((p) => ({
        id: p.id, key: p.key, nameCandidates: p.nameCandidates ?? [],
        sightings: p.sightings ?? 1, kinds: p.kinds ?? [],
        source: p.source ?? { connectorId: null, project: null },
        untrusted: true, firstSeenAt: p.firstSeenAt, lastSeenAt: p.lastSeenAt,
        acceptedBy: p.acceptedBy ?? []
      }))
      .sort((a, b) => (b.sightings - a.sightings) || (b.lastSeenAt - a.lastSeenAt));
    return { outcome: OUTCOME.RESULTS, proposals: list };
  }

  // accepting is the owner's judgement, and it is per persona: the person may
  // already exist (same human, another hat), so this reuses the record and only
  // adds a profile - with the circles and importance the OWNER chose here.
  acceptProposal({ proposalId, personaId, circles = null, importance = null, note = null, name = null }) {
    const p = this.store.get('peopleProposals', proposalId);
    if (!p) return { outcome: OUTCOME.UNAVAILABLE, reason: 'proposal_not_found' };
    if (p.declined || p.closed) return { outcome: OUTCOME.DECLINED, reason: 'proposal_closed' };
    if (!this.personas.get(personaId)) return { outcome: OUTCOME.UNAVAILABLE, reason: 'persona_not_found' };
    if ((p.acceptedBy ?? []).includes(personaId)) return { outcome: OUTCOME.DECLINED, reason: 'already_accepted' };

    const chosen = sanitizeName(name) ?? p.nameCandidates?.[0] ?? p.key;
    const handleKind = p.key.includes('@') ? 'email' : (/^\+?[0-9]+$/.test(p.key) ? 'phone' : null);
    // reuse an existing human matched by the captured handle, else create one
    let person = this.store.list('people').find((x) => handleKind && x.handles?.[handleKind]
      && String(x.handles[handleKind]).toLowerCase() === p.key);
    if (!person) {
      const created = this.addPerson({ name: chosen, handles: handleKind ? { [handleKind]: p.key } : {} });
      if (created.outcome !== OUTCOME.RESULTS) {
        // name collision: attach the handle to the person that already has it
        person = this.store.list('people').find((x) => x.name.toLowerCase() === String(chosen).toLowerCase());
        if (!person) return created;
      } else {
        person = created.person;
      }
    }
    const profiled = this.setProfile({ personaId, personId: person.id, circles, importance, note });
    if (profiled.outcome !== OUTCOME.RESULTS) return profiled;

    const acceptedBy = [...new Set([...(p.acceptedBy ?? []), personaId])];
    const closed = acceptedBy.length >= 2 ? true : p.closed;
    this.store.update('peopleProposals', proposalId, (x) => ({ ...x, acceptedBy, closed }));
    this.receipts.write({ actor: 'owner', personaId, op: RECEIPT_OP.PEOPLE, reason: 'capture_accepted' });
    return { outcome: OUTCOME.RESULTS, personId: person.id, personaId, reused: !!person.createdAt && (p.acceptedBy ?? []).length > 0 };
  }

  declineProposal({ proposalId }) {
    const p = this.store.get('peopleProposals', proposalId);
    if (!p) return { outcome: OUTCOME.UNAVAILABLE, reason: 'proposal_not_found' };
    this.store.update('peopleProposals', proposalId, (x) => ({ ...x, declined: true, declinedAt: this.now() }));
    this.receipts.write({ actor: 'owner', personaId: null, op: RECEIPT_OP.PEOPLE, reason: 'capture_declined' });
    return { outcome: OUTCOME.RESULTS, proposalId };
  }

  getPerson(personId) {
    return this.store.get('people', personId);
  }

  // the whole address book, with the personas that actually know each human
  all() {
    return this.store.list('people').map((person) => {
      const profiles = this.store.list('personaPeople', (p) => p.personId === person.id);
      return {
        ...person,
        personas: profiles.map((p) => ({ personaId: p.personaId, importance: p.importance, circles: p.circles }))
      };
    });
  }

  removePerson(personId) {
    const person = this.getPerson(personId);
    if (!person) return { outcome: OUTCOME.UNAVAILABLE, reason: 'person_not_found' };
    for (const profile of this.store.list('personaPeople', (p) => p.personId === personId)) {
      this.store.del('personaPeople', profile.id);
    }
    this.store.del('people', personId);
    this.receipts.write({ actor: 'owner', personaId: null, op: RECEIPT_OP.PEOPLE, reason: 'person_removed' });
    return { outcome: OUTCOME.RESULTS };
  }

  // --- the relationship: (person, persona) ------------------------------------

  // sets the persona's profile of a human. omitted fields are left alone; an
  // explicit null clears (importance null = unrated, note null = no note).
  setProfile({ personaId, personId, circles, importance, note }) {
    const persona = this.personas.get(personaId);
    if (!persona) return { outcome: OUTCOME.UNAVAILABLE, reason: 'persona_not_found' };
    const person = this.getPerson(personId);
    if (!person) return { outcome: OUTCOME.UNAVAILABLE, reason: 'person_not_found' };

    if (importance !== undefined && importance !== null) {
      if (!Number.isInteger(importance) || importance < 1 || importance > 5) {
        return { outcome: OUTCOME.DECLINED, reason: 'importance_out_of_range' };
      }
    }
    let tags = null;
    if (circles !== undefined) {
      if (circles !== null && (!Array.isArray(circles) || !circles.every((c) => typeof c === 'string' && c.trim() !== ''))) {
        return { outcome: OUTCOME.DECLINED, reason: 'circles_invalid' };
      }
      // soft tags: union-preserving, case-insensitive, first-seen display kept
      tags = circles === null ? [] : [...new Set(circles.map(normTag).filter(Boolean))];
    }

    const existing = this.store.list('personaPeople', (p) => p.personaId === personaId && p.personId === personId)[0];
    const id = existing?.id ?? randomId('prf');

    // circles merge case-insensitively but keep the owner's casing per tag
    const mergedCircles = (() => {
      if (tags === null) return existing?.circles ?? [];
      const seen = new Map(((existing?.circles ?? [])).map((c) => [c.toLowerCase(), c]));
      for (const t of tags) seen.set(t.toLowerCase(), t);
      return [...seen.values()];
    })();
    // setProfile with an explicit circles array replaces (an owner edit), so
    // only grow when the caller means to add: `circles` replaces, `addCircle`
    // appends. keep replace semantics and expose addCircle separately.
    const nextCircles = tags === null ? (existing?.circles ?? []) : tags;

    const profile = {
      id,
      personaId,
      personId,
      circles: nextCircles,
      importance: importance === undefined ? (existing?.importance ?? null) : importance,
      note: note === undefined ? (existing?.note ?? null) : (note === null ? null : String(note).slice(0, 2000)),
      createdAt: existing?.createdAt ?? this.now(),
      updatedAt: this.now()
    };
    this.store.put('personaPeople', id, profile);
    this.receipts.write({ actor: 'owner', personaId, op: RECEIPT_OP.PEOPLE, reason: 'relationship_set' });
    return { outcome: OUTCOME.RESULTS, profile: { ...profile, name: person.name } };
  }

  // soft means additive: a friend can also become basically family
  addCircle({ personaId, personId, circle }) {
    const existing = this.store.list('personaPeople', (p) => p.personaId === personaId && p.personId === personId)[0];
    if (!existing) return { outcome: OUTCOME.UNAVAILABLE, reason: 'relationship_not_found' };
    const tag = normTag(circle);
    if (!tag) return { outcome: OUTCOME.DECLINED, reason: 'circle_required' };
    if (existing.circles.some((c) => c.toLowerCase() === tag.toLowerCase())) {
      return { outcome: OUTCOME.RESULTS, profile: existing, unchanged: true };
    }
    return this.setProfile({ personaId, personId, circles: [...existing.circles, tag] });
  }

  removeProfile({ personaId, personId }) {
    const existing = this.store.list('personaPeople', (p) => p.personaId === personaId && p.personId === personId)[0];
    if (!existing) return { outcome: OUTCOME.UNAVAILABLE, reason: 'relationship_not_found' };
    this.store.del('personaPeople', existing.id);
    this.receipts.write({ actor: 'owner', personaId, op: RECEIPT_OP.PEOPLE, reason: 'relationship_removed' });
    return { outcome: OUTCOME.RESULTS };
  }

  // one persona's people: only the humans IT knows, richest first
  list({ personaId, circles = null } = {}) {
    const persona = this.personas.get(personaId);
    if (!persona) return { outcome: OUTCOME.UNAVAILABLE, reason: 'persona_not_found' };
    const wanted = Array.isArray(circles) && circles.length
      ? new Set(circles.map((c) => normTag(c).toLowerCase()))
      : null;
    const rows = this.store.list('personaPeople', (p) => p.personaId === personaId)
      .filter((p) => !wanted || p.circles.some((c) => wanted.has(c.toLowerCase())))
      .map((p) => {
        const person = this.getPerson(p.personId);
        return {
          personId: p.personId,
          name: person?.name ?? null,
          aliases: person?.aliases ?? [],
          handles: person?.handles ?? {},
          circles: p.circles,
          importance: p.importance,
          note: p.note
        };
      })
      .sort((a, b) => (b.importance ?? 0) - (a.importance ?? 0) || String(a.name).localeCompare(String(b.name)));
    return { outcome: OUTCOME.RESULTS, people: rows };
  }

  // circles are implicit and soft: derived from profiles, never a table
  circleList({ personaId }) {
    const persona = this.personas.get(personaId);
    if (!persona) return { outcome: OUTCOME.UNAVAILABLE, reason: 'persona_not_found' };
    const byTag = new Map();
    for (const profile of this.store.list('personaPeople', (p) => p.personaId === personaId)) {
      for (const tag of profile.circles) {
        const key = tag.toLowerCase();
        const entry = byTag.get(key) ?? { name: tag, count: 0, importance: 0 };
        entry.count += 1;
        entry.importance += profile.importance ?? 0;
        byTag.set(key, entry);
      }
    }
    return {
      outcome: OUTCOME.RESULTS,
      circles: [...byTag.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
    };
  }
}
