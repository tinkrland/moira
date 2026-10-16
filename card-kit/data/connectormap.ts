// connector map: the taxonomy (block -> job -> provider) that both the
// consent surface and the radial constellation render from. one source of
// truth; the mindmap consumes toSections()/toConnectorMap() output.
//
// metadata lives in PROVIDER_META keyed by provider id so the strict Sub/Cat
// shapes stay clean for the renderer; state (connected, pass) is applied by
// the host from the registry/hub at runtime, not baked here.

import type { Cat, Sub } from '../builder.js';

export type AdapterKind = 'connected' | 'ingest';
export type ProviderStatus = 'active' | 'planned' | 'evie'; // evie = gated on the taste engine

export type Provider = { id: string; label: string };
export type Job = { id: string; label: string; iconName: string; providers: Provider[] };
export type Block = { id: string; label: string; iconName: string; accent: 'p1' | 'p2' | 'p3' | 'p4' | 'p5'; jobs: Job[] };

// provider metadata: adapter kind and build status per the registry in main.
export const PROVIDER_META: Record<string, { kind: AdapterKind; status: ProviderStatus; block: string; job: string }> = {
  // knowledge / retrieve your files
  google_drive: { kind: 'connected', status: 'active', block: 'knowledge', job: 'retrieve_files' },
  onedrive: { kind: 'connected', status: 'active', block: 'knowledge', job: 'retrieve_files' },
  dropbox: { kind: 'connected', status: 'active', block: 'knowledge', job: 'retrieve_files' },
  mega: { kind: 'connected', status: 'active', block: 'knowledge', job: 'retrieve_files' },
  // knowledge / manage projects
  linear: { kind: 'connected', status: 'planned', block: 'knowledge', job: 'manage_projects' },
  craft: { kind: 'connected', status: 'planned', block: 'knowledge', job: 'manage_projects' },
  notion: { kind: 'connected', status: 'planned', block: 'knowledge', job: 'manage_projects' },
  // knowledge / write & publish
  substack: { kind: 'ingest', status: 'planned', block: 'knowledge', job: 'write_publish' },
  medium: { kind: 'ingest', status: 'planned', block: 'knowledge', job: 'write_publish' },
  // ai tools
  chatgpt: { kind: 'connected', status: 'planned', block: 'ai_tools', job: 'talk' },
  claude: { kind: 'connected', status: 'planned', block: 'ai_tools', job: 'talk' },
  gemini: { kind: 'connected', status: 'planned', block: 'ai_tools', job: 'talk' },
  perplexity: { kind: 'connected', status: 'planned', block: 'ai_tools', job: 'talk' },
  lovable: { kind: 'connected', status: 'planned', block: 'ai_tools', job: 'build_apps' },
  base44: { kind: 'connected', status: 'planned', block: 'ai_tools', job: 'build_apps' },
  bolt: { kind: 'connected', status: 'planned', block: 'ai_tools', job: 'build_apps' },
  v0: { kind: 'connected', status: 'planned', block: 'ai_tools', job: 'build_apps' },
  cursor: { kind: 'connected', status: 'planned', block: 'ai_tools', job: 'code_agents' },
  windsurf: { kind: 'connected', status: 'planned', block: 'ai_tools', job: 'code_agents' },
  claude_code: { kind: 'connected', status: 'planned', block: 'ai_tools', job: 'code_agents' },
  copilot: { kind: 'connected', status: 'planned', block: 'ai_tools', job: 'code_agents' },
  kiro: { kind: 'connected', status: 'planned', block: 'ai_tools', job: 'work_specs' },
  ibm_bob: { kind: 'connected', status: 'planned', block: 'ai_tools', job: 'work_specs' },
  // taste (ingest; evie-gated per spec 18)
  goodreads: { kind: 'ingest', status: 'evie', block: 'taste', job: 'track_books' },
  storygraph: { kind: 'ingest', status: 'evie', block: 'taste', job: 'track_books' },
  fable: { kind: 'ingest', status: 'evie', block: 'taste', job: 'track_books' },
  pagebound: { kind: 'ingest', status: 'evie', block: 'taste', job: 'track_books' },
  letterboxd: { kind: 'ingest', status: 'evie', block: 'taste', job: 'track_film' },
  serializd: { kind: 'ingest', status: 'evie', block: 'taste', job: 'track_tv' },
  tvtime: { kind: 'ingest', status: 'evie', block: 'taste', job: 'track_tv' },
  repov: { kind: 'ingest', status: 'evie', block: 'taste', job: 'track_tv' },
  lastfm: { kind: 'ingest', status: 'evie', block: 'taste', job: 'track_music' },
  statsfm: { kind: 'ingest', status: 'evie', block: 'taste', job: 'track_music' },
  musicboard: { kind: 'ingest', status: 'evie', block: 'taste', job: 'track_music' },
  superfan: { kind: 'ingest', status: 'evie', block: 'taste', job: 'track_music' },
  ao3: { kind: 'ingest', status: 'evie', block: 'taste', job: 'read_write_stories' },
  wattpad: { kind: 'ingest', status: 'evie', block: 'taste', job: 'track_books' },
  pi_fyi: { kind: 'ingest', status: 'evie', block: 'taste', job: 'share_taste' },
  tastify: { kind: 'ingest', status: 'evie', block: 'taste', job: 'share_taste' },
  // lifestyle
  depop: { kind: 'ingest', status: 'planned', block: 'lifestyle', job: 'dress_shop' },
  ltk: { kind: 'ingest', status: 'planned', block: 'lifestyle', job: 'dress_shop' },
  pinterest: { kind: 'ingest', status: 'planned', block: 'lifestyle', job: 'dress_shop' },
  whering: { kind: 'ingest', status: 'planned', block: 'lifestyle', job: 'dress_shop' },
  anylog: { kind: 'ingest', status: 'planned', block: 'lifestyle', job: 'log_life' },
  retro: { kind: 'ingest', status: 'planned', block: 'lifestyle', job: 'log_life' },
  // utility
  youtube: { kind: 'ingest', status: 'planned', block: 'utility', job: 'watch' },
  maps: { kind: 'ingest', status: 'planned', block: 'utility', job: 'places' },
  health: { kind: 'ingest', status: 'planned', block: 'utility', job: 'health' }
};

const P = (id: string, label: string): Provider => ({ id, label });

export const BLOCKS: Block[] = [
  {
    id: 'knowledge', label: 'knowledge', iconName: 'BookOpen', accent: 'p1',
    jobs: [
      { id: 'retrieve_files', label: 'retrieve your files', iconName: 'FileText', providers: [P('google_drive', 'google drive'), P('onedrive', 'onedrive'), P('dropbox', 'dropbox'), P('mega', 'mega')] },
      { id: 'manage_projects', label: 'manage projects', iconName: 'Layers', providers: [P('linear', 'linear'), P('craft', 'craft docs'), P('notion', 'notion')] },
      { id: 'write_publish', label: 'write & publish', iconName: 'PenTool', providers: [P('substack', 'substack'), P('medium', 'medium')] }
    ]
  },
  {
    id: 'ai_tools', label: 'ai tools', iconName: 'Cpu', accent: 'p2',
    jobs: [
      { id: 'talk', label: 'talk to assistants', iconName: 'Radio', providers: [P('chatgpt', 'chatgpt'), P('claude', 'claude'), P('gemini', 'gemini'), P('perplexity', 'perplexity')] },
      { id: 'build_apps', label: 'build apps', iconName: 'LayoutGrid', providers: [P('lovable', 'lovable'), P('base44', 'base44'), P('bolt', 'bolt'), P('v0', 'v0')] },
      { id: 'code_agents', label: 'code with agents', iconName: 'Zap', providers: [P('cursor', 'cursor'), P('windsurf', 'windsurf'), P('claude_code', 'claude code'), P('copilot', 'copilot')] },
      { id: 'work_specs', label: 'work from specs', iconName: 'FileText', providers: [P('kiro', 'kiro'), P('ibm_bob', 'ibm bob')] }
    ]
  },
  {
    id: 'taste', label: 'taste', iconName: 'Heart', accent: 'p3',
    jobs: [
      { id: 'track_books', label: 'track books', iconName: 'BookOpen', providers: [P('goodreads', 'goodreads'), P('storygraph', 'storygraph'), P('fable', 'fable'), P('pagebound', 'pagebound'), P('wattpad', 'wattpad')] },
      { id: 'track_film', label: 'track film', iconName: 'Film', providers: [P('letterboxd', 'letterboxd')] },
      { id: 'track_tv', label: 'track tv', iconName: 'Tv', providers: [P('serializd', 'serializd'), P('tvtime', 'tv time'), P('repov', 'repov')] },
      { id: 'track_music', label: 'track music', iconName: 'Music', providers: [P('lastfm', 'last.fm'), P('statsfm', 'stats.fm'), P('musicboard', 'musicboard'), P('superfan', 'superfan')] },
      { id: 'read_write_stories', label: 'read & write stories', iconName: 'Star', providers: [P('ao3', 'ao3')] },
      { id: 'share_taste', label: 'share taste', iconName: 'Globe', providers: [P('pi_fyi', 'pi.fyi'), P('tastify', 'tastify')] }
    ]
  },
  {
    id: 'lifestyle', label: 'lifestyle', iconName: 'Coffee', accent: 'p4',
    jobs: [
      { id: 'dress_shop', label: 'dress & shop', iconName: 'Tag', providers: [P('depop', 'depop'), P('ltk', 'ltk'), P('pinterest', 'pinterest'), P('whering', 'whering')] },
      { id: 'log_life', label: 'log your life', iconName: 'Camera', providers: [P('anylog', 'anylog'), P('retro', 'retro')] }
    ]
  },
  {
    id: 'utility', label: 'utility', iconName: 'Cloud', accent: 'p5',
    jobs: [
      { id: 'watch', label: 'watch', iconName: 'Tv', providers: [P('youtube', 'youtube')] },
      { id: 'places', label: 'places', iconName: 'Globe', providers: [P('maps', 'maps')] },
      { id: 'health', label: 'health', iconName: 'Leaf', providers: [P('health', 'health')] }
    ]
  }
];

// the constellation: block (ring 1) -> job (ring 2) -> provider (ring 3),
// shaped exactly like the card's Cat -> Sub -> Sub so MindmapPreview renders
// it without modification. state decoration is the host's job (see readme).
export function toConnectorMap(connected: string[] = [], passed: string[] = []): { front: Cat[]; back: Cat[] } {
  const mk = (blocks: Block[]): Cat[] => blocks.map((b) => ({
    id: b.id, label: b.label, iconName: b.iconName, accent: b.accent,
    subtypes: b.jobs.map((j): Sub => ({
      id: j.id, label: j.label, iconName: j.iconName,
      children: j.providers.map((p) => ({
        id: p.id, label: connected.includes(p.id) ? `${p.label} ✓` : p.label, iconName: 'Disc'
      }))
    }))
  }));
  return { front: mk(BLOCKS.slice(0, 3)), back: mk(BLOCKS.slice(3)) };
}
