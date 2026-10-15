// taint algebra regression (phase 0 item 1): a derived fact must never be
// able to launder a purpose restriction through an unrestricted parent.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeTaint, derivePolicy, decideRead } from '../src/core/policy.js';
import { Moira } from '../src/index.js';

const ownerSession = () => ({ kind: 'owner_session', verified: true, ownerRef: 'owner' });

test('mergeTaint: one null parent does not launder a restricted parent (null = all purposes)', () => {
  const merged = mergeTaint([
    { sensitivity: 'normal', linkability: 'none', stylometryRisk: 'none', maxRung: 4, allowedPurposes: null },
    { sensitivity: 'normal', linkability: 'none', stylometryRisk: 'none', maxRung: 4, allowedPurposes: ['research'] }
  ]);
  assert.deepEqual(merged.allowedPurposes, ['research']);
});

test('mergeTaint: all parents null stays null (unrestricted)', () => {
  const merged = mergeTaint([
    { sensitivity: 'normal', linkability: 'none', stylometryRisk: 'none', maxRung: 4, allowedPurposes: null },
    { sensitivity: 'normal', linkability: 'none', stylometryRisk: 'none', maxRung: 4, allowedPurposes: null }
  ]);
  assert.equal(merged.allowedPurposes, null);
});

test('mergeTaint: multiple restricted parents intersect', () => {
  const merged = mergeTaint([
    { sensitivity: 'normal', linkability: 'none', stylometryRisk: 'none', maxRung: 4, allowedPurposes: ['research', 'writing'] },
    { sensitivity: 'normal', linkability: 'none', stylometryRisk: 'none', maxRung: 4, allowedPurposes: ['research', 'planning'] }
  ]);
  assert.deepEqual(merged.allowedPurposes, ['research']);
});

test('mergeTaint: disjoint parent purposes produce an empty intersection (deny everything)', () => {
  const merged = mergeTaint([
    { sensitivity: 'normal', linkability: 'none', stylometryRisk: 'none', maxRung: 4, allowedPurposes: ['research'] },
    { sensitivity: 'normal', linkability: 'none', stylometryRisk: 'none', maxRung: 4, allowedPurposes: ['writing'] }
  ]);
  assert.deepEqual(merged.allowedPurposes, []);
});

test('derivePolicy: a proposal may only narrow, never widen inherited purposes', () => {
  const narrowed = derivePolicy(
    [{ sensitivity: 'normal', linkability: 'none', stylometryRisk: 'none', maxRung: 2, allowedPurposes: ['research'] }],
    { allowedPurposes: ['research', 'marketing'] }
  );
  assert.deepEqual(narrowed.allowedPurposes, ['research']);

  // requested narrower stays narrower
  const tighter = derivePolicy(
    [{ sensitivity: 'normal', linkability: 'none', stylometryRisk: 'none', maxRung: 4, allowedPurposes: ['research', 'writing'] }],
    { allowedPurposes: ['research'] }
  );
  assert.deepEqual(tighter.allowedPurposes, ['research']);

  // unrestricted request inherits the inherited set exactly
  const inherited = derivePolicy(
    [{ sensitivity: 'normal', linkability: 'none', stylometryRisk: 'none', maxRung: 4, allowedPurposes: ['research'] }],
    {}
  );
  assert.deepEqual(inherited.allowedPurposes, ['research']);
});

test('derivePolicy: widening past an unrestricted taint is allowed (null means all)', () => {
  const wide = derivePolicy(
    [{ sensitivity: 'normal', linkability: 'none', stylometryRisk: 'none', maxRung: 4, allowedPurposes: null }],
    { allowedPurposes: ['research', 'marketing'] }
  );
  assert.deepEqual(wide.allowedPurposes, ['research', 'marketing']);
});

test('end to end: a fact derived from a purpose-restricted parent cannot be read for other purposes', () => {
  const m = new Moira({});
  const ctx = m.createOwnerContext(ownerSession());
  const p = m.owner.createPersona(ctx, { name: 'student', identity: 'linked' });

  const restricted = m.facts.add(p, {
    content: 'secret project note', category: 'notes',
    policy: { allowedPurposes: ['research'] },
    rungs: { summary: 'a project note' }
  }).fact;

  // derived from the restricted parent, requesting wider purposes
  const derived = m.facts.propose(p, {
    content: 'derived project note', category: 'notes',
    derivedFrom: [restricted.id],
    policy: { allowedPurposes: ['research', 'marketing'] }
  }, { actor: 'owner', clientId: null });
  assert.equal(derived.outcome, 'results');
  assert.deepEqual(derived.fact.policy.allowedPurposes, ['research']); // narrowed

  // reading the derived fact for marketing: denied, purpose not allowed
  const agent = m.owner.registerAgent(ctx, { name: 'a', tier: 'verified', personasAllowed: [p.id] });
  m.owner.grantPass(ctx, { clientId: agent.id, personaId: p.id, category: 'notes', purpose: 'marketing', maxRung: 3 });
  const session = m.owner.createSession(ctx, { clientId: agent.id, personaId: p.id });
  const res = m.agent.persona_context(session.accessToken, { categories: ['notes'], purpose: 'marketing' });
  assert.equal(res.outcome, 'empty'); // the restricted parent is not served for marketing
  assert.ok(res.categories.notes.skipped.some((s) => s.reason === 'purpose_not_allowed'));
});
