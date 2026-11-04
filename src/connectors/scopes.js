// which tool buckets can be shared, and which cannot (owner, 2026-11-05).
//
// the question: "which tool buckets, mcps, apis and oauths" stay persona-scoped
// vs shared across personas. the answer is NOT a preference - it follows from
// what the credential IS:
//
//   oauth / session  -> an ACCOUNT. a google drive is a person's drive, with a
//                       display name, a face and a history. sharing it across
//                       hats makes the provider the join key between them.
//   api key          -> a KEY for a service. it has no identity of its own, so
//                       two hats using one key is a billing arrangement, not a
//                       disclosure. shareable, and worth declaring.
//   mcp server       -> a running endpoint, usually holding the owner's own
//                       secrets and tools. persona, because the server's
//                       config is the secret.
//   ingest           -> no credential at all; the persona reads what the owner
//                       already published. persona by default.
//
// this module is a HINT, never an action: nothing here shares anything. the
// hub only shares when the owner says sharedWith. an unknown provider is
// treated as persona (fail closed), because guessing "shareable" is the one
// mistake that cannot be taken back.

const AUTH = { OAUTH: 'oauth', API_KEY: 'api_key', SESSION: 'session', MCP: 'mcp', NONE: 'none' };

const BY_PROVIDER = {
  google_drive: { auth: AUTH.OAUTH, scope: 'persona' },
  onedrive: { auth: AUTH.OAUTH, scope: 'persona' },
  dropbox: { auth: AUTH.OAUTH, scope: 'persona' },
  mega: { auth: AUTH.SESSION, scope: 'persona' },
  linear: { auth: AUTH.OAUTH, scope: 'persona' },
  craft_docs: { auth: AUTH.OAUTH, scope: 'persona' },
  notion: { auth: AUTH.OAUTH, scope: 'persona' },
  google_calendar: { auth: AUTH.OAUTH, scope: 'persona' },
  notion_calendar: { auth: AUTH.OAUTH, scope: 'persona' },
  substack: { auth: AUTH.NONE, scope: 'persona' },
  medium: { auth: AUTH.NONE, scope: 'persona' },
  // llm providers bill by key, and the key is not the account
  chatgpt: { auth: AUTH.API_KEY, scope: 'shareable' },
  claude: { auth: AUTH.API_KEY, scope: 'shareable' },
  gemini: { auth: AUTH.API_KEY, scope: 'shareable' },
  perplexity: { auth: AUTH.API_KEY, scope: 'shareable' }
};

// the buckets named by auth style rather than by provider brand, so a new
// provider is classified by what it is instead of needing a table entry.
const BY_AUTH = {
  [AUTH.OAUTH]: 'persona',
  [AUTH.SESSION]: 'persona',
  [AUTH.MCP]: 'persona',
  [AUTH.NONE]: 'persona',
  [AUTH.API_KEY]: 'shareable'
};

const REASON = {
  persona: {
    [AUTH.OAUTH]: 'an oauth credential is an account with a face; sharing it joins the personas at the provider',
    [AUTH.SESSION]: 'a session key is a signed-in account; same problem as oauth',
    [AUTH.MCP]: 'an mcp server endpoint usually runs on the owner\'s own tools and secrets',
    [AUTH.NONE]: 'ingest reads what is already public for one persona; nothing to share'
  },
  shareable: {
    [AUTH.API_KEY]: 'an api key identifies a service plan, not a person; two hats on one key is billing, not disclosure'
  }
};

export function shareHint(providerId) {
  const known = BY_PROVIDER[providerId] ?? null;
  if (!known) {
    // fail closed: an unknown provider is assumed to be an account
    return {
      providerId, auth: null, scope: 'unknown', shareable: false,
      reason: 'unknown provider: assumed persona-scoped until its auth style is declared'
    };
  }
  const scope = BY_AUTH[known.auth] ?? 'persona';
  return {
    providerId,
    auth: known.auth,
    scope,
    shareable: scope === 'shareable',
    reason: REASON[scope]?.[known.auth] ?? 'persona by default'
  };
}

// the scope a caller may act on. unknown never means shareable.
export function shareScopeFor(providerId) {
  const hint = shareHint(providerId);
  return hint.scope === 'shareable' ? 'shareable' : 'persona';
}
