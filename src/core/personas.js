// personas (spec sections 5, 13, 17). a persona is a named context with its own
// key material, memory partition, connector identities, policy set and kind.
//
// persona kind is two independent choices: identity depth (linked,
// pseudonymous, heteronymous) and storage tier (hosted, local, decentral).
// defaults per kind come from the section 5 table and are enforced here, not
// left to callers.

import { randomId } from '../util/crypto.js';
import {
  IDENTITY, STORAGE, LINK_VISIBILITY, DISCLOSURE_MODE, RUNG, OUTCOME, PERSONA_STATUS
} from '../model/constants.js';

export class PersonaService {
  constructor({ store, keys, now = Date.now }) {
    this.store = store;
    this.keys = keys;
    this.now = now;
  }

  create({ name, identity, storage = STORAGE.HOSTED, ownerRef = 'owner', inheritsCore = null, characterSheet = null, voiceProfile = null, linkVisibility = null, disclosure = null, ingress = null, egress = null, sensitive = false, email = null }) {
    if (!Object.values(IDENTITY).includes(identity)) throw new Error(`unknown identity kind: ${identity}`);
    if (!Object.values(STORAGE).includes(storage)) throw new Error(`unknown storage tier: ${storage}`);

    // a persona can carry its own reachable address (owner-stated, for every
    // identity kind: linked personas have emails too). never inferred.
    const cleanEmail = typeof email === 'string' && email.trim() !== '' ? email.trim() : null;
    if (cleanEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      throw new Error('persona email must look like an address');
    }

    const id = randomId('psn');

    // kind defaults (section 5 table)
    const isLinked = identity === IDENTITY.LINKED;
    const isHeteronym = identity === IDENTITY.HETERONYMOUS;

    if (isHeteronym && !characterSheet) {
      throw new Error('heteronymous personas require a character_sheet (name, backstory, voice, beliefs, expertise, red_lines, canon_rules)');
    }

    const persona = {
      id,
      ownerRef,
      name,
      identity,
      storage,
      status: PERSONA_STATUS.ACTIVE,
      // heteronyms never inherit the shared core (forced false, section 10)
      inheritsCore: isHeteronym ? false : (inheritsCore ?? isLinked),
      characterSheet: isHeteronym ? characterSheet : null,
      email: cleanEmail,
      voiceProfile: voiceProfile ?? defaultVoiceProfile(identity),
      // pseudonymous and heteronymous personas hide the owner-join from the
      // broker unless the owner explicitly chooses broker visibility.
      linkVisibility: linkVisibility ?? (isLinked ? LINK_VISIBILITY.BROKER : LINK_VISIBILITY.DEVICE_ONLY),
      disclosure: disclosure ?? (isHeteronym ? DISCLOSURE_MODE.SECRET : DISCLOSURE_MODE.DECLARED),
      ingress: ingress ?? defaultIngress(identity),
      egress: egress ?? defaultEgress(identity),
      sensitive,
      locked: false, // kill switch (section 8.5)
      createdAt: this.now()
    };

    this.keys.personaKey(id); // mint key material now
    this.store.put('personas', id, persona);
    return persona;
  }

  get(id) {
    return this.store.get('personas', id);
  }

  list() {
    return this.store.list('personas');
  }

  // owner-side updates. never widens protections: deny-by-default fields can
  // be tightened freely, loosened only through explicit owner intent.
  update(id, patch) {
    const persona = this.get(id);
    if (!persona) return null;
    const next = typeof patch === 'function' ? patch(persona) : { ...persona, ...patch };
    if (persona.identity === IDENTITY.HETERONYMOUS) {
      next.inheritsCore = false; // forced, always
    }
    if (next.inheritsCore === true && persona.identity === IDENTITY.PSEUDONYMOUS && persona.inheritsCore === false) {
      // pseudonymous personas opt in explicitly; record that as an auditable choice
      next.inheritsCoreOptIn = true;
    }
    return this.store.update('personas', id, () => next);
  }

  setKillSwitch(id, locked) {
    return this.store.update('personas', id, (p) => ({ ...p, locked: !!locked }));
  }

  // per-persona export (section 16): full json of the persona's own data.
  export(id, { facts, accounts, passes }) {
    const persona = this.get(id);
    if (!persona) return { outcome: OUTCOME.UNAVAILABLE, reason: 'persona_not_found' };
    const exported = {
      persona: { ...persona },
      facts: facts.map((f) => ({ ...f })),
      accounts: accounts.map((a) => ({ ...a, secret: undefined, secretSealed: undefined })),
      passes: passes.map((p) => ({ ...p })),
      exportedAt: this.now()
    };
    // redact persona name from map-style exports happens client-side (22.5);
    // the owner export keeps it.
    return exported;
  }

  // pairwise sub per (persona, client) (section 13)
  sub(personaId, clientId) {
    return this.keys.pairwiseSub(personaId, clientId);
  }

  // deletion (section 16): key shredding + severing bridges/packs/leases is
  // orchestrated by the moira facade; this only removes the persona record.
  // the facade must call keys.shredPersona(id) alongside this.
  remove(id) {
    return this.store.del('personas', id);
  }

  // freeze/thaw (section 16 sibling of deletion): put a persona on ice
  // instead of deleting it. the keys are NOT shredded and no record is
  // destroyed; activity surfaces decline while frozen and thaw puts the
  // persona back exactly as it was.
  freeze(id) {
    const persona = this.get(id);
    if (!persona) return { outcome: OUTCOME.UNAVAILABLE, reason: 'persona_not_found' };
    if (persona.status === PERSONA_STATUS.FROZEN) return { outcome: OUTCOME.DECLINED, reason: 'persona_frozen' };
    this.store.update('personas', id, (x) => ({ ...x, status: PERSONA_STATUS.FROZEN, frozenAt: this.now() }));
    return { outcome: OUTCOME.RESULTS, frozen: true };
  }

  thaw(id) {
    const persona = this.get(id);
    if (!persona) return { outcome: OUTCOME.UNAVAILABLE, reason: 'persona_not_found' };
    if (persona.status !== PERSONA_STATUS.FROZEN) return { outcome: OUTCOME.DECLINED, reason: 'persona_not_frozen' };
    this.store.update('personas', id, (x) => ({ ...x, status: PERSONA_STATUS.ACTIVE, frozenAt: null, thawedAt: this.now() }));
    return { outcome: OUTCOME.RESULTS, thawed: true };
  }
}

function defaultVoiceProfile(identity) {
  const base = {
    // voice profile v0 (section 18 mvp): guidelines, ai-tells, registers.
    guidelines: null,
    aiTells: [],
    redLines: [
      'never invent personal experiences, credentials or quotes',
      'never claim things the persona did not do'
    ],
    registers: {},
    exemplars: [], // pass-gated, off by default for third-party agents
    stylometryRisk: 'high',
    learnedFrom: 'pasted'
  };
  if (identity === IDENTITY.PSEUDONYMOUS) {
    base.deliberatelyDistinct = true; // doubles as style normalizer (section 13)
  }
  if (identity === IDENTITY.HETERONYMOUS) {
    base.ownedByCharacter = true; // voice lives in the character sheet
  }
  return base;
}

function defaultIngress(identity) {
  if (identity === IDENTITY.LINKED) {
    // linked personas bridge cheaply (section 5), but inbound flow still
    // requires an explicit bridge record (two-sided, auditable).
    return { acceptFrom: [], trustLevel: 'trusted', sanitize: false };
  }
  if (identity === IDENTITY.PSEUDONYMOUS) {
    return { acceptFrom: [], trustLevel: 'untrusted', sanitize: true }; // deny by default + strip linkable
  }
  return { acceptFrom: [], trustLevel: 'untrusted', sanitize: true, template: 'inspiration_only' }; // heteronym
}

function defaultEgress(identity) {
  if (identity === IDENTITY.LINKED) {
    return { defaultRung: RUNG.SUMMARY, denyLabels: [] };
  }
  if (identity === IDENTITY.PSEUDONYMOUS) {
    return { defaultRung: RUNG.SUMMARY, denyLabels: [], allowToLinked: true };
  }
  return { defaultRung: RUNG.CONCLUSION, denyLabels: [], template: 'attribution_only' }; // heteronym
}
