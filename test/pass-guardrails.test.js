// no indefinite access, no implicit full access (owner direction 2026-10-29:
// "moira should not hand over indefinite access or full access").
//
// 1. a "permanent" pass is a STANDING pass: it renews by the owner's hand,
//    not by itself. it expires after STANDING_PASS_MAX_MS (90 days) unless
//    the owner grants again.
// 2. every pass records its scope: 'sets' when context was sliced at grant
//    time, 'full' when the whole persona is exposed. a full pass must be
//    asked for out loud (acknowledgeFull), never acquired by omission.

import test from 'node:test';
import assert from 'node:assert/strict';
import { Moira } from '../src/index.js';
import { MemoryStore } from '../src/store.js';

const owner = () => ({ kind: 'owner_session', verified: true, ownerRef: 'owner' });

function setup() {
  const m = new Moira({ store: new MemoryStore() });
  const ctx = m.createOwnerContext(owner());
  const persona = m.owner.createPersona(ctx, { name: 'alexa', identity: 'linked' });
  const agentId = m.owner.registerAgent(ctx, { name: 'app', tier: 'verified', personasAllowed: [persona.id], spendCaps: { usd: 1 } }).id;
  return { m, ctx, persona, agentId };
}

test('guardrails: standing passes expire and renew only by owner hand', () => {
  const { m, ctx, persona, agentId } = setup();
  const res = m.owner.grantPass(ctx, { clientId: agentId, personaId: persona.id, category: 'preferences', purpose: 'personalization', duration: 'permanent', maxRung: 2 , acknowledgeFull: true });
  assert.equal(res.outcome, 'results');
  const p = res.pass;
  assert.equal(p.standing, true, 'permanent is a standing pass, marked as such');
  assert.ok(typeof p.expiresAt === 'number', 'standing is never indefinite');
  const days = (p.expiresAt - p.createdAt) / (24 * 60 * 60 * 1000);
  assert.ok(Math.abs(days - 90) < 1.5, 'standing passes cap at 90 days');

  // a session pass is short by default and not standing
  const s = m.owner.grantPass(ctx, { clientId: agentId, personaId: persona.id, category: 'preferences', purpose: 'personalization', duration: 'session', maxRung: 2 , acknowledgeFull: true });
  assert.equal(s.pass.standing, undefined);
  assert.ok(s.pass.expiresAt - s.pass.createdAt <= 60 * 60 * 1000, 'session stays short');
});

test('guardrails: full scope must be asked for out loud, and is recorded', () => {
  const { m, ctx, persona, agentId } = setup();
  // a sets-scoped pass is scoped by construction
  const scoped = m.owner.grantPass(ctx, { clientId: agentId, personaId: persona.id, category: 'preferences', purpose: 'personalization', duration: 'session', sets: ['work'], maxRung: 1 });
  assert.equal(scoped.pass.scope, 'sets');
  assert.deepEqual(scoped.pass.sets, ['work']);

  // unscoped without acknowledgement: declined, never silent
  const silent = m.owner.grantPass(ctx, { clientId: agentId, personaId: persona.id, category: 'preferences', purpose: 'personalization', duration: 'session', maxRung: 1  });
  assert.equal(silent.outcome, 'declined');
  assert.equal(silent.reason, 'full_scope_requires_acknowledgement');

  // unscoped WITH acknowledgement: allowed, recorded as full, receipted
  const full = m.owner.grantPass(ctx, { clientId: agentId, personaId: persona.id, category: 'preferences', purpose: 'personalization', duration: 'session', maxRung: 1, acknowledgeFull: true });
  assert.equal(full.outcome, 'results');
  assert.equal(full.pass.scope, 'full');
  const recs = m.owner.exportPersona(ctx, persona.id).receipts.filter((r) => r.op === 'pass_grant');
  assert.ok(recs.length >= 2, 'grants are receipted');
});
