// connector registry (spec section 14; readme block model).
//
// a connector is a source of context behind a persona. two adapter kinds:
//
//   connected - the persona's account is linked (oauth or session key) and
//     the adapter fetches live. credentials are sealed per persona and are
//     never returned by any read.
//   ingest - the persona brings an export or paste; rows are ingested
//     untrusted-tagged with source attribution. no live fetch ever happens.
//
// the taste block is evie's fuel line and activates with her (v3, own
// branch); it is registered here so identities can exist early, but its
// ingest path lands when evie does. status field says so explicitly - no
// phantom features.

export const CONNECTOR_STATUS = {
  ACTIVE: 'active',
  PLANNED: 'planned', // registered, adapter lands with its phase
  EVIE: 'evie' // taste-engine-gated: activates with evie (v3), not before
};

export const CONNECTOR_KIND = {
  CONNECTED: 'connected',
  INGEST: 'ingest'
};

export const CONNECTOR_PASS_SCOPE = {
  FILES_LIST: 'files.list',
  FILES_READ: 'files.read'
};

// blocks mirror the readme table. adapter files only for the first wave
// (files); every other entry documents the block model without pretending
// to fetch anything.

const filesBlock = [
  {
    id: 'google_drive',
    block: 'files',
    kind: CONNECTOR_KIND.CONNECTED,
    status: CONNECTOR_STATUS.ACTIVE,
    label: 'google drive',
    adapter: 'drive',
    auth: 'oauth2-bearer',
    scopes: ['drive.readonly'],
    scopesHint: 'readonly scope only: a connector never widens (section 9.3 applies to connectors too)'
  },
  {
    id: 'onedrive',
    block: 'files',
    kind: CONNECTOR_KIND.CONNECTED,
    status: CONNECTOR_STATUS.ACTIVE,
    label: 'onedrive',
    adapter: 'onedrive',
    auth: 'oauth2-bearer',
    scopes: ['Files.Read']
  },
  {
    id: 'dropbox',
    block: 'files',
    kind: CONNECTOR_KIND.CONNECTED,
    status: CONNECTOR_STATUS.ACTIVE,
    label: 'dropbox',
    adapter: 'dropbox',
    auth: 'oauth2-bearer',
    scopes: ['files.metadata.read', 'files.content.read']
  },
  {
    id: 'mega',
    block: 'files',
    kind: CONNECTOR_KIND.CONNECTED,
    status: CONNECTOR_STATUS.ACTIVE,
    label: 'mega',
    adapter: 'mega',
    auth: 'session-key',
    // mega has no oauth: login yields a session key the owner pastes at
    // authorize time. the protocol is a custom rpc with aes-encrypted
    // payloads, so this adapter ships last in the files wave.
    scopes: ['read']
  }
];

const aiToolsBlock = [
  { id: 'chatgpt', block: 'ai-tools', sub: 'assistants', kind: CONNECTOR_KIND.CONNECTED, status: CONNECTOR_STATUS.PLANNED, label: 'chatgpt' },
  { id: 'claude', block: 'ai-tools', sub: 'assistants', kind: CONNECTOR_KIND.CONNECTED, status: CONNECTOR_STATUS.PLANNED, label: 'claude' },
  { id: 'gemini', block: 'ai-tools', sub: 'assistants', kind: CONNECTOR_KIND.CONNECTED, status: CONNECTOR_STATUS.PLANNED, label: 'gemini' },
  { id: 'perplexity', block: 'ai-tools', sub: 'assistants', kind: CONNECTOR_KIND.CONNECTED, status: CONNECTOR_STATUS.PLANNED, label: 'perplexity' },
  { id: 'lovable', block: 'ai-tools', sub: 'app-builders', kind: CONNECTOR_KIND.CONNECTED, status: CONNECTOR_STATUS.PLANNED, label: 'lovable' },
  { id: 'base44', block: 'ai-tools', sub: 'app-builders', kind: CONNECTOR_KIND.CONNECTED, status: CONNECTOR_STATUS.PLANNED, label: 'base44' },
  { id: 'bolt', block: 'ai-tools', sub: 'app-builders', kind: CONNECTOR_KIND.CONNECTED, status: CONNECTOR_STATUS.PLANNED, label: 'bolt' },
  { id: 'v0', block: 'ai-tools', sub: 'app-builders', kind: CONNECTOR_KIND.CONNECTED, status: CONNECTOR_STATUS.PLANNED, label: 'v0' },
  { id: 'cursor', block: 'ai-tools', sub: 'vibecoding', kind: CONNECTOR_KIND.CONNECTED, status: CONNECTOR_STATUS.PLANNED, label: 'cursor' },
  { id: 'windsurf', block: 'ai-tools', sub: 'vibecoding', kind: CONNECTOR_KIND.CONNECTED, status: CONNECTOR_STATUS.PLANNED, label: 'windsurf' },
  { id: 'claude_code', block: 'ai-tools', sub: 'vibecoding', kind: CONNECTOR_KIND.CONNECTED, status: CONNECTOR_STATUS.PLANNED, label: 'claude code' },
  { id: 'copilot', block: 'ai-tools', sub: 'vibecoding', kind: CONNECTOR_KIND.CONNECTED, status: CONNECTOR_STATUS.PLANNED, label: 'github copilot' },
  { id: 'kiro', block: 'ai-tools', sub: 'spec-driven', kind: CONNECTOR_KIND.CONNECTED, status: CONNECTOR_STATUS.PLANNED, label: 'kiro' },
  { id: 'ibm_bob', block: 'ai-tools', sub: 'spec-driven', kind: CONNECTOR_KIND.CONNECTED, status: CONNECTOR_STATUS.PLANNED, label: 'ibm bob (bob.ibm.com)' }
];

const tasteBlock = [
  { id: 'goodreads', block: 'taste', sub: 'books', kind: CONNECTOR_KIND.INGEST, status: CONNECTOR_STATUS.EVIE, label: 'goodreads' },
  { id: 'storygraph', block: 'taste', sub: 'books', kind: CONNECTOR_KIND.INGEST, status: CONNECTOR_STATUS.EVIE, label: 'storygraph' },
  { id: 'fable', block: 'taste', sub: 'books', kind: CONNECTOR_KIND.INGEST, status: CONNECTOR_STATUS.EVIE, label: 'fable' },
  { id: 'pagebound', block: 'taste', sub: 'books', kind: CONNECTOR_KIND.INGEST, status: CONNECTOR_STATUS.EVIE, label: 'pagebound' },
  { id: 'wattpad_books', block: 'taste', sub: 'books', kind: CONNECTOR_KIND.INGEST, status: CONNECTOR_STATUS.EVIE, label: 'wattpad' },
  { id: 'letterboxd', block: 'taste', sub: 'film', kind: CONNECTOR_KIND.INGEST, status: CONNECTOR_STATUS.EVIE, label: 'letterboxd' },
  { id: 'serializd', block: 'taste', sub: 'tv', kind: CONNECTOR_KIND.INGEST, status: CONNECTOR_STATUS.EVIE, label: 'serializd' },
  { id: 'tvtime', block: 'taste', sub: 'tv', kind: CONNECTOR_KIND.INGEST, status: CONNECTOR_STATUS.EVIE, label: 'tv time' },
  { id: 'repov', block: 'taste', sub: 'tv', kind: CONNECTOR_KIND.INGEST, status: CONNECTOR_STATUS.EVIE, label: 'repov' },
  { id: 'lastfm', block: 'taste', sub: 'music', kind: CONNECTOR_KIND.INGEST, status: CONNECTOR_STATUS.EVIE, label: 'last.fm' },
  { id: 'statsfm', block: 'taste', sub: 'music', kind: CONNECTOR_KIND.INGEST, status: CONNECTOR_STATUS.EVIE, label: 'stats.fm' },
  { id: 'musicboard', block: 'taste', sub: 'music', kind: CONNECTOR_KIND.INGEST, status: CONNECTOR_STATUS.EVIE, label: 'musicboard' },
  { id: 'superfan', block: 'taste', sub: 'music', kind: CONNECTOR_KIND.INGEST, status: CONNECTOR_STATUS.EVIE, label: 'superfan' },
  { id: 'ao3', block: 'taste', sub: 'stories', kind: CONNECTOR_KIND.INGEST, status: CONNECTOR_STATUS.EVIE, label: 'archive of our own (import)' },
  { id: 'wattpad', block: 'taste', sub: 'stories', kind: CONNECTOR_KIND.INGEST, status: CONNECTOR_STATUS.EVIE, label: 'wattpad' },
  { id: 'pi_fyi', block: 'taste', sub: 'shares', kind: CONNECTOR_KIND.INGEST, status: CONNECTOR_STATUS.EVIE, label: 'pi.fyi' },
  { id: 'tastify', block: 'taste', sub: 'shares', kind: CONNECTOR_KIND.INGEST, status: CONNECTOR_STATUS.EVIE, label: 'tastify' }
];

const lifestyleBlock = [
  { id: 'depop', block: 'lifestyle', kind: CONNECTOR_KIND.INGEST, status: CONNECTOR_STATUS.PLANNED, label: 'depop' },
  { id: 'ltk', block: 'lifestyle', kind: CONNECTOR_KIND.INGEST, status: CONNECTOR_STATUS.PLANNED, label: 'ltk' },
  { id: 'pinterest', block: 'lifestyle', kind: CONNECTOR_KIND.INGEST, status: CONNECTOR_STATUS.PLANNED, label: 'pinterest' },
  { id: 'whering', block: 'lifestyle', kind: CONNECTOR_KIND.INGEST, status: CONNECTOR_STATUS.PLANNED, label: 'whering' },
  { id: 'retro', block: 'lifestyle', kind: CONNECTOR_KIND.INGEST, status: CONNECTOR_STATUS.PLANNED, label: 'retro' },
  { id: 'anylog', block: 'lifestyle', kind: CONNECTOR_KIND.INGEST, status: CONNECTOR_STATUS.PLANNED, label: 'anylog' }
];

const knowledgeBlock = [
  { id: 'notion', block: 'knowledge', kind: CONNECTOR_KIND.CONNECTED, status: CONNECTOR_STATUS.PLANNED, label: 'notion' },
  { id: 'google_calendar', block: 'knowledge', kind: CONNECTOR_KIND.CONNECTED, status: CONNECTOR_STATUS.PLANNED, label: 'google calendar' },
  { id: 'slack', block: 'knowledge', kind: CONNECTOR_KIND.CONNECTED, status: CONNECTOR_STATUS.PLANNED, label: 'slack' },
  { id: 'substack', block: 'knowledge', sub: 'reading', kind: CONNECTOR_KIND.INGEST, status: CONNECTOR_STATUS.PLANNED, label: 'substack' },
  { id: 'medium', block: 'knowledge', sub: 'reading', kind: CONNECTOR_KIND.INGEST, status: CONNECTOR_STATUS.PLANNED, label: 'medium' }
];

const utilityBlock = [
  { id: 'youtube', block: 'utility', kind: CONNECTOR_KIND.INGEST, status: CONNECTOR_STATUS.PLANNED, label: 'youtube' },
  { id: 'maps', block: 'utility', kind: CONNECTOR_KIND.INGEST, status: CONNECTOR_STATUS.PLANNED, label: 'maps' },
  { id: 'health', block: 'utility', kind: CONNECTOR_KIND.INGEST, status: CONNECTOR_STATUS.PLANNED, label: 'health' }
];

export const REGISTRY = [
  ...filesBlock,
  ...aiToolsBlock,
  ...tasteBlock,
  ...lifestyleBlock,
  ...knowledgeBlock,
  ...utilityBlock
];

const byId = new Map(REGISTRY.map((c) => [c.id, c]));

export function connectorDef(id) {
  return byId.get(id) ?? null;
}

export function connectorsByBlock(block) {
  return REGISTRY.filter((c) => c.block === block);
}
