// connector registry (spec section 14; the job-node block model).
//
// a connector is a source of context behind a persona. the tree is:
//
//   block          the category of life ("knowledge", "taste", ...)
//     job          THE CONSENT UNIT. what the owner actually wants done
//       provider   swappable fulfillment (google drive, dropbox, ...)
//
// jobs are what the owner approves; pass scopes come from the job, not the
// provider, so swapping dropbox for drive never re-consents anyone. a
// provider can serve several jobs - it is listed under each, with its own
// per-job scopes when they differ.
//
// two adapter kinds:
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

// scope vocabulary. the files job is the first (and so far only) job with
// mcp-visible pass scopes; the vocabulary lives here so the hub and the
// registry never drift.
export const CONNECTOR_PASS_SCOPE = {
  FILES_LIST: 'files.list',
  FILES_READ: 'files.read'
};

// provider rows carry only what is genuinely per-provider (kind, status,
// label, adapter/auth/scopes). block/job are stamped on at flatten time.
const files = {
  id: 'files',
  label: 'retrieve your files',
  passScopes: [CONNECTOR_PASS_SCOPE.FILES_LIST, CONNECTOR_PASS_SCOPE.FILES_READ],
  providers: [
    {
      id: 'google_drive',
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
      kind: CONNECTOR_KIND.CONNECTED,
      status: CONNECTOR_STATUS.ACTIVE,
      label: 'onedrive',
      adapter: 'onedrive',
      auth: 'oauth2-bearer',
      scopes: ['Files.Read']
    },
    {
      id: 'dropbox',
      kind: CONNECTOR_KIND.CONNECTED,
      status: CONNECTOR_STATUS.ACTIVE,
      label: 'dropbox',
      adapter: 'dropbox',
      auth: 'oauth2-bearer',
      scopes: ['files.metadata.read', 'files.content.read']
    },
    {
      id: 'mega',
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
  ]
};

const projects = {
  id: 'projects',
  label: 'manage projects',
  providers: [
    { id: 'linear', kind: CONNECTOR_KIND.CONNECTED, status: CONNECTOR_STATUS.PLANNED, label: 'linear' },
    { id: 'craft_docs', kind: CONNECTOR_KIND.CONNECTED, status: CONNECTOR_STATUS.PLANNED, label: 'craft docs' },
    { id: 'notion', kind: CONNECTOR_KIND.CONNECTED, status: CONNECTOR_STATUS.PLANNED, label: 'notion' }
  ]
};

const time = {
  id: 'time',
  label: 'plan your time',
  providers: [
    { id: 'google_calendar', kind: CONNECTOR_KIND.CONNECTED, status: CONNECTOR_STATUS.PLANNED, label: 'google calendar' },
    { id: 'notion_calendar', kind: CONNECTOR_KIND.CONNECTED, status: CONNECTOR_STATUS.PLANNED, label: 'notion calendar' }
  ]
};

const publish = {
  id: 'publish',
  label: 'write & publish',
  providers: [
    { id: 'substack', kind: CONNECTOR_KIND.INGEST, status: CONNECTOR_STATUS.PLANNED, label: 'substack' },
    { id: 'medium', kind: CONNECTOR_KIND.INGEST, status: CONNECTOR_STATUS.PLANNED, label: 'medium' }
  ]
};

const assistants = {
  id: 'assistants',
  label: 'talk to assistants',
  providers: [
    { id: 'chatgpt', kind: CONNECTOR_KIND.CONNECTED, status: CONNECTOR_STATUS.PLANNED, label: 'chatgpt' },
    { id: 'claude', kind: CONNECTOR_KIND.CONNECTED, status: CONNECTOR_STATUS.PLANNED, label: 'claude' },
    { id: 'gemini', kind: CONNECTOR_KIND.CONNECTED, status: CONNECTOR_STATUS.PLANNED, label: 'gemini' },
    { id: 'perplexity', kind: CONNECTOR_KIND.CONNECTED, status: CONNECTOR_STATUS.PLANNED, label: 'perplexity' }
  ]
};

const appBuilders = {
  id: 'app-builders',
  label: 'build apps',
  providers: [
    { id: 'lovable', kind: CONNECTOR_KIND.CONNECTED, status: CONNECTOR_STATUS.PLANNED, label: 'lovable' },
    { id: 'base44', kind: CONNECTOR_KIND.CONNECTED, status: CONNECTOR_STATUS.PLANNED, label: 'base44' },
    { id: 'bolt', kind: CONNECTOR_KIND.CONNECTED, status: CONNECTOR_STATUS.PLANNED, label: 'bolt' },
    { id: 'v0', kind: CONNECTOR_KIND.CONNECTED, status: CONNECTOR_STATUS.PLANNED, label: 'v0' }
  ]
};

const agents = {
  id: 'agents',
  label: 'code with agents',
  providers: [
    { id: 'cursor', kind: CONNECTOR_KIND.CONNECTED, status: CONNECTOR_STATUS.PLANNED, label: 'cursor' },
    { id: 'windsurf', kind: CONNECTOR_KIND.CONNECTED, status: CONNECTOR_STATUS.PLANNED, label: 'windsurf' },
    { id: 'claude_code', kind: CONNECTOR_KIND.CONNECTED, status: CONNECTOR_STATUS.PLANNED, label: 'claude code' },
    { id: 'copilot', kind: CONNECTOR_KIND.CONNECTED, status: CONNECTOR_STATUS.PLANNED, label: 'github copilot' }
  ]
};

const specs = {
  id: 'specs',
  label: 'work from specs',
  providers: [
    { id: 'kiro', kind: CONNECTOR_KIND.CONNECTED, status: CONNECTOR_STATUS.PLANNED, label: 'kiro' },
    { id: 'ibm_bob', kind: CONNECTOR_KIND.CONNECTED, status: CONNECTOR_STATUS.PLANNED, label: 'ibm bob (bob.ibm.com)' }
  ]
};

const taste = (id, label, providers) => ({
  id,
  label,
  providers: providers.map((p) => ({ kind: CONNECTOR_KIND.INGEST, status: CONNECTOR_STATUS.EVIE, ...p }))
});

const books = taste('books', 'track books', [
  { id: 'goodreads', label: 'goodreads' },
  { id: 'storygraph', label: 'storygraph' },
  { id: 'fable', label: 'fable' },
  { id: 'pagebound', label: 'pagebound' }
]);

const film = taste('film', 'track film', [
  { id: 'letterboxd', label: 'letterboxd' }
]);

const tv = taste('tv', 'track tv', [
  { id: 'serializd', label: 'serializd' },
  { id: 'tvtime', label: 'tv time' },
  { id: 'repov', label: 'repov' }
]);

const music = taste('music', 'track music', [
  { id: 'lastfm', label: 'last.fm' },
  { id: 'statsfm', label: 'stats.fm' },
  { id: 'musicboard', label: 'musicboard' },
  { id: 'superfan', label: 'superfan' }
]);

const stories = taste('stories', 'read & write stories', [
  { id: 'ao3', label: 'archive of our own (import)' },
  { id: 'wattpad', label: 'wattpad' }
]);

const shares = taste('shares', 'share taste', [
  { id: 'pi_fyi', label: 'pi.fyi' },
  { id: 'tastify', label: 'tastify' }
]);

const lifestyle = (id, label, providers) => ({
  id,
  label,
  providers: providers.map((p) => ({ kind: CONNECTOR_KIND.INGEST, status: CONNECTOR_STATUS.PLANNED, ...p }))
});

const dressShop = lifestyle('dress-shop', 'dress & shop', [
  { id: 'depop', label: 'depop' },
  { id: 'ltk', label: 'ltk' },
  { id: 'pinterest', label: 'pinterest' },
  { id: 'whering', label: 'whering' }
]);

const logLife = lifestyle('log-life', 'log your life', [
  { id: 'anylog', label: 'anylog' },
  { id: 'retro', label: 'retro' }
]);

const utility = (id, label, providers) => ({
  id,
  label,
  providers: providers.map((p) => ({ kind: CONNECTOR_KIND.INGEST, status: CONNECTOR_STATUS.PLANNED, ...p }))
});

const watch = utility('watch', 'watch', [
  { id: 'youtube', label: 'youtube' }
]);

const places = utility('places', 'places', [
  { id: 'maps', label: 'maps' }
]);

const health = utility('health', 'health', [
  { id: 'health', label: 'health platforms' }
]);

export const BLOCKS = [
  { id: 'knowledge', label: 'knowledge', jobs: [files, projects, time, publish] },
  { id: 'ai-tools', label: 'ai tools', jobs: [assistants, appBuilders, agents, specs] },
  { id: 'taste', label: 'taste', jobs: [books, film, tv, music, stories, shares] },
  { id: 'lifestyle', label: 'lifestyle', jobs: [dressShop, logLife] },
  { id: 'utility', label: 'utility', jobs: [watch, places, health] }
];

// stamp every provider row with its block and job, in place, so job nodes
// and the flattened registry expose the same row shape. job is the consent
// handle; block/job always resolve back to a real node.
for (const block of BLOCKS) {
  for (const job of block.jobs) {
    for (const p of job.providers) {
      p.block = block.id;
      p.job = job.id;
    }
  }
}

export const REGISTRY = BLOCKS.flatMap((b) => b.jobs.flatMap((j) => [...j.providers]));

const byId = new Map(REGISTRY.map((c) => [c.id, c]));

export function connectorDef(id) {
  return byId.get(id) ?? null;
}

export function connectorsByBlock(block) {
  return REGISTRY.filter((c) => c.block === block);
}

export function jobOf(block, job) {
  return BLOCKS.find((b) => b.id === block)?.jobs.find((j) => j.id === job) ?? null;
}

export function providersForJob(block, job) {
  return jobOf(block, job)?.providers ?? [];
}
