// personas: the switching layer. spec section 5 kinds - linked (tied to your
// real identity), pseudonymous (a stable alias that is not you), heteronymous
// (a character you write as) - crossed with hosting (hosted / local /
// decentral). each persona owns its own card data; switching swaps the whole
// active context, never blends.
//
// storage: localStorage 'moira-personas-v1' ({ personas, activeId }). the host
// replaces these helpers with the moira api client when the backend lands.

import type { CardData } from '../builder.js';

export type PersonaKind = 'linked' | 'pseudonymous' | 'heteronymous';
export type PersonaHost = 'hosted' | 'local' | 'decentral';

export type Persona = {
  id: string;
  name: string;
  handle: string;
  kind: PersonaKind;
  host: PersonaHost;
  accentRing: 'p1' | 'p2' | 'p3' | 'p4' | 'p5';
  cardData: CardData;
};

export const KIND_LABEL: Record<PersonaKind, string> = {
  linked: 'linked · you, on the record',
  pseudonymous: 'pseudonymous · a stable alias',
  heteronymous: 'heteronymous · a character'
};

export const KIND_SHORT: Record<PersonaKind, string> = {
  linked: 'linked', pseudonymous: 'pseudo', heteronymous: 'hetero'
};

function uid() { return `per_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`; }

function starterCard(front: CatLite[], back: CatLite[]): CardData {
  return { front: front.map(toCat), back: back.map(toCat) };
}
type CatLite = { label: string; iconName: string; accent: 'p1' | 'p2' | 'p3' | 'p4' | 'p5'; subs: { label: string; iconName: string }[] };
function toCat(c: CatLite, i: number) {
  return {
    id: `c${i}`, label: c.label, iconName: c.iconName, accent: c.accent,
    subtypes: c.subs.map((s, j) => ({ id: `c${i}s${j}`, label: s.label, iconName: s.iconName }))
  };
}

// starter personas: three hats, three kinds, so switching demos itself.
const STARTERS: Persona[] = [
  {
    id: 'per_student', name: 'filmosophy', handle: '@filmosophy', kind: 'linked', host: 'hosted', accentRing: 'p1',
    cardData: starterCard(
      [{ label: 'studies', iconName: 'BookOpen', accent: 'p1', subs: [{ label: 'classes', iconName: 'Layers' }, { label: 'deadlines', iconName: 'FileText' }] },
       { label: 'projects', iconName: 'Cpu', accent: 'p2', subs: [{ label: 'moira', iconName: 'Zap' }, { label: 'sculptura', iconName: 'Palette' }] }],
      [{ label: 'files', iconName: 'FileText', accent: 'p3', subs: [{ label: 'google drive', iconName: 'Disc' }, { label: 'dropbox', iconName: 'Disc' }] }]
    )
  },
  {
    id: 'per_alias', name: 'tastemaker', handle: '@tastemaker', kind: 'pseudonymous', host: 'local', accentRing: 'p3',
    cardData: starterCard(
      [{ label: 'taste', iconName: 'Heart', accent: 'p3', subs: [{ label: 'film', iconName: 'Film' }, { label: 'music', iconName: 'Music' }, { label: 'tv', iconName: 'Tv' }] },
       { label: 'shares', iconName: 'Globe', accent: 'p4', subs: [{ label: 'pi.fyi', iconName: 'Disc' }, { label: 'tastify', iconName: 'Disc' }] }],
      [{ label: 'trackers', iconName: 'Star', accent: 'p5', subs: [{ label: 'letterboxd', iconName: 'Disc' }, { label: 'serializd', iconName: 'Disc' }, { label: 'stats.fm', iconName: 'Disc' }] }]
    )
  },
  {
    id: 'per_character', name: 'captain quill', handle: '@captainquill', kind: 'heteronymous', host: 'decentral', accentRing: 'p5',
    cardData: starterCard(
      [{ label: 'stories', iconName: 'PenTool', accent: 'p5', subs: [{ label: 'ao3', iconName: 'Disc' }, { label: 'wattpad', iconName: 'Disc' }] },
       { label: 'worlds', iconName: 'Globe', accent: 'p2', subs: [{ label: 'lore', iconName: 'BookOpen' }, { label: 'maps', iconName: 'Anchor' }] }],
      []
    )
  }
];

const KEY = 'moira-personas-v1';

export function loadPersonas(): { personas: Persona[]; activeId: string } {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '');
    if (raw && Array.isArray(raw.personas) && raw.personas.length) return raw;
  } catch { /* fall through to starters */ }
  return { personas: STARTERS, activeId: STARTERS[0].id };
}

export function savePersonas(state: { personas: Persona[]; activeId: string }) {
  localStorage.setItem(KEY, JSON.stringify(state));
}

export function newPersona(kind: PersonaKind): Persona {
  const base: Record<PersonaKind, Partial<Persona>> = {
    linked: { name: 'your name', handle: '@handle', host: 'hosted', accentRing: 'p1' },
    pseudonymous: { name: 'alias', handle: '@alias', host: 'local', accentRing: 'p3' },
    heteronymous: { name: 'character', handle: '@character', host: 'decentral', accentRing: 'p5' }
  };
  return {
    id: uid(), kind, name: base[kind].name!, handle: base[kind].handle!,
    host: base[kind].host as PersonaHost, accentRing: base[kind].accentRing as Persona['accentRing'],
    cardData: { front: [], back: [] }
  };
}
