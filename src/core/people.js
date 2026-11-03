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
  acceptProposal({ proposalId, personaId, circles = null, importance = null, interaction = null, note = null, name = null }) {
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
    const profiled = this.setProfile({ personaId, personId: person.id, circles, importance, interaction, note });
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
        personas: profiles.map((p) => ({
          personaId: p.personaId, importance: p.importance,
          interaction: p.interaction ?? null, circles: p.circles
        }))
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
  setProfile({ personaId, personId, circles, importance, interaction, note }) {
    const persona = this.personas.get(personaId);
    if (!persona) return { outcome: OUTCOME.UNAVAILABLE, reason: 'persona_not_found' };
    const person = this.getPerson(personId);
    if (!person) return { outcome: OUTCOME.UNAVAILABLE, reason: 'person_not_found' };

    if (importance !== undefined && importance !== null) {
      if (!Number.isInteger(importance) || importance < 1 || importance > 5) {
        return { outcome: OUTCOME.DECLINED, reason: 'importance_out_of_range' };
      }
    }
    // the second axis: how much contact this persona actually has with them.
    // validated on its own, never derived from importance (and vice versa):
    // a parent you speak to twice a month outranks the person you sit beside.
    if (interaction !== undefined && interaction !== null) {
      if (!Number.isInteger(interaction) || interaction < 0 || interaction > 5) {
        return { outcome: OUTCOME.DECLINED, reason: 'interaction_out_of_range' };
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
      interaction: interaction === undefined ? (existing?.interaction ?? null) : interaction,
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
  list({ personaId, circles = null, order = 'importance' } = {}) {
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
          interaction: p.interaction ?? null,
          note: p.note
        };
      });
    // ordering names one axis at a time. there is no composite, deliberately:
    // averaging importance and interaction would let a busy acquaintance
    // outrank a parent, and "who matters" is not "who you deal with".
    const key = order === 'interaction' ? 'interaction' : order === 'importance' ? 'importance' : null;
    if (!key) return { outcome: OUTCOME.DECLINED, reason: 'order_invalid' };
    // a rated 0 means "never", an unrated person means "unknown": they must not
    // sort as the same thing. nulls last, then high-to-low, then name.
    const rank = (row) => (row[key] === null || row[key] === undefined ? null : row[key]);
    rows.sort((a, b) => {
      const av = rank(a);
      const bv = rank(b);
      if (av === null && bv === null) return String(a.name).localeCompare(String(b.name));
      if (av === null) return 1;
      if (bv === null) return -1;
      return bv - av || String(a.name).localeCompare(String(b.name));
    });
    return { outcome: OUTCOME.RESULTS, people: rows };
  }

  // --- open loops -----------------------------------------------------------
  // a promise is the thing you said you would do for a human. it belongs to
  // (person, persona) like every other relationship fact, it is owner-declared
  // (capture can propose people, never obligations), and nothing notifies:
  // due() is a pull, so moira cannot become a nag. == cresca's gentle nudge,
  // with the nudge left to the owner.

  addPromise({ personaId, personId, text, dueAt = null }) {
    const persona = this.personas.get(personaId);
    if (!persona) return { outcome: OUTCOME.UNAVAILABLE, reason: 'persona_not_found' };
    const person = this.getPerson(personId);
    if (!person) return { outcome: OUTCOME.UNAVAILABLE, reason: 'person_not_found' };
    // you cannot owe something to someone this persona has never met
    const profile = this.store.list('personaPeople',
      (p) => p.personaId === personaId && p.personId === personId)[0];
    if (!profile) return { outcome: OUTCOME.DECLINED, reason: 'person_not_in_this_persona' };

    const clean = String(text ?? '').trim();
    if (!clean) return { outcome: OUTCOME.DECLINED, reason: 'promise_text_required' };
    if (clean.length > 280) return { outcome: OUTCOME.DECLINED, reason: 'promise_text_too_long' };
    if (dueAt !== null && dueAt !== undefined && !Number.isFinite(dueAt)) {
      return { outcome: OUTCOME.DECLINED, reason: 'promise_due_invalid' };
    }

    const promise = {
      id: randomId('prm'),
      personaId,
      personId,
      text: clean,
      dueAt: dueAt ?? null,
      state: 'open',
      createdAt: this.now(),
      closedAt: null
    };
    this.store.put('personPromises', promise.id, promise);
    this.receipts.write({ actor: 'owner', personaId, op: RECEIPT_OP.PEOPLE, reason: 'promise_open' });
    return { outcome: OUTCOME.RESULTS, promise };
  }

  promises({ personaId, includeClosed = false } = {}) {
    if (!this.personas.get(personaId)) return { outcome: OUTCOME.UNAVAILABLE, reason: 'persona_not_found' };
    const rows = this.store.list('personPromises', (p) => p.personaId === personaId)
      .filter((p) => includeClosed || p.state === 'open')
      .map((p) => ({ ...p, personName: this.getPerson(p.personId)?.name ?? null }))
      .sort((a, b) => (a.dueAt ?? Infinity) - (b.dueAt ?? Infinity) || String(a.personName).localeCompare(String(b.personName)));
    return { outcome: OUTCOME.RESULTS, promises: rows };
  }

  due({ personaId, now = this.now() } = {}) {
    if (!this.personas.get(personaId)) return { outcome: OUTCOME.UNAVAILABLE, reason: 'persona_not_found' };
    const owed = this.store.list('personPromises',
      (p) => p.personaId === personaId && p.state === 'open' && p.dueAt !== null && p.dueAt <= now)
      .map((p) => ({
        ...p,
        personName: this.getPerson(p.personId)?.name ?? null,
        overdueByMs: now - p.dueAt
      }))
      .sort((a, b) => a.dueAt - b.dueAt || String(a.personName).localeCompare(String(b.personName)));
    return { outcome: OUTCOME.RESULTS, promises: owed };
  }

  closePromise({ promiseId, state }) {
    const promise = this.store.get('personPromises', promiseId);
    if (!promise) return { outcome: OUTCOME.UNAVAILABLE, reason: 'promise_not_found' };
    if (promise.state !== 'open') return { outcome: OUTCOME.DECLINED, reason: 'promise_already_closed' };
    this.store.update('personPromises', promiseId, (p) => ({ ...p, state, closedAt: this.now() }));
    // a receipt records that a loop closed, never what was promised in it
    this.receipts.write({
      actor: 'owner', personaId: promise.personaId, op: RECEIPT_OP.PEOPLE,
      reason: state === 'kept' ? 'promise_kept' : 'promise_dropped'
    });
    return { outcome: OUTCOME.RESULTS, promise: this.store.get('personPromises', promiseId) };
  }

  // --- the brief ------------------------------------------------------------
  // composed from what is stored. it lists what it does not know instead of
  // inventing a warm sentence, because a brief that guesses is worse than none.

  brief({ personaId, personId }) {
    const persona = this.personas.get(personaId);
    if (!persona) return { outcome: OUTCOME.UNAVAILABLE, reason: 'persona_not_found' };
    const person = this.getPerson(personId);
    if (!person) return { outcome: OUTCOME.UNAVAILABLE, reason: 'person_not_found' };
    const profile = this.store.list('personaPeople',
      (p) => p.personaId === personaId && p.personId === personId)[0];
    if (!profile) return { outcome: OUTCOME.DECLINED, reason: 'person_not_in_this_persona' };

    const openPromises = this.store.list('personPromises',
      (p) => p.personaId === personaId && p.personId === personId && p.state === 'open')
      .sort((a, b) => (a.dueAt ?? Infinity) - (b.dueAt ?? Infinity))
      .map((p) => ({ text: p.text, dueAt: p.dueAt }));

    const importance = profile.importance ?? null;
    const interaction = profile.interaction ?? null;
    const unknown = [];
    if (interaction === null) unknown.push('no interaction recorded');
    if (!profile.note) unknown.push('no note yet');
    if (!person.handles?.email && !person.handles?.phone) unknown.push('no handle');
    unknown.push('no capture history'); // true until sightings are attached to people

    const bits = [
      person.name,
      profile.circles.length ? profile.circles.join(' + ') : 'no circles',
      `importance ${importance === null ? 'unrated' : importance}`,
      `interaction ${interaction === null ? 'unrated' : interaction}`,
      openPromises.length ? `${openPromises.length} open promise${openPromises.length === 1 ? '' : 's'}` : 'nothing owed'
    ];
    const summary = [bits.join(' · '), profile.note ? `note: ${profile.note}` : null]
      .filter(Boolean).join(' | ');

    return {
      outcome: OUTCOME.RESULTS,
      personId,
      name: person.name,
      aliases: person.aliases ?? [],
      handles: person.handles ?? {},
      circles: profile.circles,
      importance,
      interaction,
      note: profile.note ?? null,
      openPromises,
      unknown,
      summary
    };
  }

  // circles are implicit and soft: derived from profiles, never a table
  circleList({ personaId }) {
    const persona = this.personas.get(personaId);
    if (!persona) return { outcome: OUTCOME.UNAVAILABLE, reason: 'persona_not_found' };
    const byTag = new Map();
    for (const profile of this.store.list('personaPeople', (p) => p.personaId === personaId)) {
      for (const tag of profile.circles) {
        const key = tag.toLowerCase();
        const entry = byTag.get(key) ?? { name: tag, count: 0, importance: 0, interaction: 0 };
        entry.count += 1;
        entry.importance += profile.importance ?? 0;
        entry.interaction += profile.interaction ?? 0;
        byTag.set(key, entry);
      }
    }
    return {
      outcome: OUTCOME.RESULTS,
      circles: [...byTag.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
    };
  }
}
