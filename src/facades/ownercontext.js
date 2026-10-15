// owner capability (spec section 6: poisoned-agent protection).
//
// owner authority is a capability object, minted only by
// moira.createOwnerContext(verifiedOwnerSession). the verifiedOwnerSession is
// produced by the owner authenticator (phase 2: supabase auth or passkeys,
// owner's choice pending). no agent code path can mint one, and a plain
// { owner: true } object is rejected by every owner-gated method.
//
// the class is deliberately not re-exported from index.js: facade methods
// accept instances, and the constructor is only reachable through the mint.

export class OwnerContext {
  constructor(session) {
    this.kind = 'owner_context';
    this.ownerRef = session.ownerRef ?? 'owner';
    this.sessionId = session.sessionId ?? null;
    this.mintedAt = session.mintedAt ?? Date.now();
  }
}

export function isValidOwnerSession(session) {
  return Boolean(
    session &&
    typeof session === 'object' &&
    session.kind === 'owner_session' &&
    session.verified === true &&
    typeof session.ownerRef === 'string' &&
    session.ownerRef.length > 0
  );
}

export { VaultKeyUnavailableError } from '../core/errors.js';
