// constants and enums. spec v0.5 sections 4, 5, 7, 8, 9.
// all policy decisions are made over these enums; nothing here is heuristic.

// rung ladder (section 4: "rung ladder"). higher rank = more information.
export const RUNG = {
  NOTHING: 0,
  EXISTS: 1,   // "there is something busy about thursday morning"
  CONCLUSION: 2, // "low bandwidth this week"
  SUMMARY: 3,  // "busy thursday morning"
  FULL: 4      // "midterm thursday at 9"
};
export const RUNG_BY_NAME = { nothing: 0, exists: 1, conclusion: 2, summary: 3, full: 4 };
export const RUNG_NAME_BY_RANK = ['nothing', 'exists', 'conclusion', 'summary', 'full'];

// explicit outcomes. never collapse any of these into "empty" (section 11).
export const OUTCOME = {
  RESULTS: 'results',
  EMPTY: 'empty',                 // healthy search, nothing matched
  APPROVAL_REQUIRED: 'approval_required', // owner must approve out of band
  DECLINED: 'declined',           // policy refused
  EXPIRED: 'expired',
  LOCKED: 'locked',               // store reachable but sealed/kill switch
  UNAVAILABLE: 'unavailable',     // store unreachable (e.g. sovereign device offline)
  NOT_AVAILABLE: 'not_available'   // cross-persona: a bridge would be needed; existence never revealed
};

export const IDENTITY = {
  LINKED: 'linked',
  PSEUDONYMOUS: 'pseudonymous',
  HETERONYMOUS: 'heteronymous'
};

// freeze/thaw (section 16 sibling of deletion): a frozen persona is on ice.
// unlike deletion nothing is shredded; activity declines while frozen and
// thaw resumes the persona exactly.
export const PERSONA_STATUS = {
  ACTIVE: 'active',
  FROZEN: 'frozen'
};

export const STORAGE = {
  HOSTED: 'hosted',
  LOCAL: 'local',
  DECENTRAL: 'decentral' // "sovereign"
};

// why a preference/inferred fact is believed (section 8.9). travels with the fact.
export const BASIS = {
  STATED: 'stated',
  CHOSEN_FREELY: 'chosen_freely',
  CHOSEN_UNDER_CONSTRAINT: 'chosen_under_constraint',
  AVAILABILITY_DRIVEN: 'availability_driven',
  INFERRED: 'inferred'
};

export const AGENT_TIER = {
  VERIFIED: 'verified',   // domain-controlled cimd client
  UNVERIFIED: 'unverified', // device-flow or connect-code self-named
  INTERNAL: 'internal'
};

export const CORE_PERSONA_ID = 'core'; // reserved id: the shared core (spec 5/17)

export const FACT_STATUS = {
  PROPOSED: 'proposed',
  ACTIVE: 'active',
  SUPERSEDED: 'deleted'
};

export const PASS_DURATION = {
  ONE_TIME: 'one_time',
  SESSION: 'session',
  PERMANENT: 'permanent'
};

export const LINK_VISIBILITY = {
  BROKER: 'broker',
  DEVICE_ONLY: 'device_only',
  NONE: 'none'
};

export const DISCLOSURE_MODE = { SECRET: 'secret', OPEN_SECRET: 'open_secret', DECLARED: 'declared' };

// receipt op kinds (section 16). receipts are content-free.
export const RECEIPT_OP = {
  READ: 'read',
  PROPOSE: 'propose',
  APPROVE: 'approve',
  SESSION: 'session',
  BRIDGE: 'bridge',
  PASS_GRANT: 'pass_grant',
  PASS_REVOKE: 'pass_revoke',
  PACK: 'pack',
  HANDOFF: 'handoff',
  LEASE: 'lease',
  SPEND: 'spend',
  DISCLOSURE: 'disclosure',
  DELETE: 'delete',
  CONNECTOR: 'connector',
  MOVE: 'move',
  PROMOTE: 'promote',
  DEMOTE: 'demote',
  LINKAGE: 'linkage',
  VOICE_SAMPLE_ADDED: 'voice_sample_added',
  PERSONA_FREEZE: 'persona_freeze',
  PERSONA_THAW: 'persona_thaw'
};

// linkage findings (spec 22): kinds only, never values
export const LINKAGE_KIND = {
  PAYER: 'payer'
};

export const RESHARE = {
  NO_RESHARE: 'no_reshare',
  NAMED: 'reshare_to_named_agents',
  HOP_LIMIT: 'reshare_with_hop_limit'
};

export const BRIDGE_EXPOSURE = {
  DST_SEES_SRC: 'dst_sees_src',
  DST_SEES_ANON: 'dst_sees_anon', // origin hidden from destination
  SRC_HIDDEN: 'src_hidden'
};

export const RESOURCE_KIND = {
  FREE_TRIAL: 'free_trial',
  FREE_TIER: 'free_tier',
  CREDITS: 'credits',
  PREPAID: 'prepaid',
  PAID_PLAN: 'paid_plan',
  PAY_AS_YOU_GO: 'pay_as_you_go'
};

// kind order for the "free before paid" router rule (section 8.3).
export const FREE_KINDS = [RESOURCE_KIND.FREE_TRIAL, RESOURCE_KIND.CREDITS, RESOURCE_KIND.FREE_TIER];

export const DATA_POLICY = {
  NO_RETENTION: 'no_retention',
  RETAINS: 'retains',
  TRAINS: 'trains'
};

export const TRUST = {
  UNSPECIFIED: 'unspecified',
  TRUSTED: 'trusted',
  UNTRUSTED_IMPORTED: 'untrusted-imported' // tag for bridge results and connector data (section 14)
};

export const HANDOFF_STATUS = {
  PENDING: 'pending',
  ACCEPTED: 'accepted',
  RETURNED: 'returned',
  CANCELLED: 'cancelled',
  EXPIRED: 'expired'
};

export const LEASE_STATUS = { ACTIVE: 'active', REVOKED: 'revoked', EXPIRED: 'expired', SPENT: 'spent' };

// label dimension orders (most -> least restrictive) for taint merging (section 9.3).
export const SENSITIVITY_ORDER = ['special_category', 'sensitive', 'normal'];
export const LINKABILITY_ORDER = ['high', 'low', 'none'];
export const STYLOMETRY_ORDER = ['high', 'low', 'none'];

export const VOICE_CATEGORY = 'voice';
export const STACK_CATEGORY = 'stack';
export const AI_CATEGORY = 'ai';
export const WORKSPACE_CATEGORY = 'workspace';
export const PREFERENCE_CATEGORIES = ['preferences', 'taste'];

// heteronym bridge templates (section 13): only themes/interests, never biographical facts.
export const INSPIRATION_CATEGORIES = ['interests', 'themes'];
export const ATTRIBUTION_CATEGORIES = ['works'];
