// passes, sessions, agents (sections 7.1, 11)
import test from 'node:test';
import assert from 'node:assert/strict';
import { Moira } from '../src/index.js';

// verified owner session + context mint: in phase 0 the host application
// performs owner verification itself; phase 2 replaces this with supabase
// auth or passkeys (owner's choice pending).
const ownerSession = () => ({ kind: 'owner_session', verified: true, ownerRef: 'owner' });
const ownerCtx = (m) => m.createOwnerContext(ownerSession());


const setup = () => {
  const m = new Moira({});
  const ctx = ownerCtx(m);
  const p = m.owner.createPersona(ctx, { name: 'founder', identity: 'linked' });
  const agent = m.owner.registerAgent(ctx, { name: 'research-helper', tier: 'verified', personasAllowed: [p.id] });
  return { ctx, m, p, agent };
};

test('no pass means approval_required, never an error and never data (9.1)', () => {
  const { ctx, m, p, agent } = setup();
  const session = m.owner.createSession(ctx, { clientId: agent.id, personaId: p.id });
  const res = m.agent.persona_context(session.accessToken, { categories: ['schedule'], purpose: 'research' });
  assert.equal(res.outcome, 'approval_required');
  assert.deepEqual(res.approvals, [{ category: 'schedule', action: 'approval_required' }]);
});

test('read with a pass serves at the pass rung and writes a receipt', () => {
  const { ctx, m, p, agent } = setup();
  m.facts.add(p, {
    content: 'midterm thursday at 9', category: 'schedule',
    rungs: { summary: 'busy thursday morning', exists: 'busy this week' }
  });
  m.owner.grantPass(ctx, { clientId: agent.id, personaId: p.id, category: 'schedule', purpose: 'research', maxRung: 3 , acknowledgeFull: true });
  const session = m.owner.createSession(ctx, { clientId: agent.id, personaId: p.id });
  const res = m.agent.persona_context(session.accessToken, { categories: ['schedule'], purpose: 'research' });
  assert.equal(res.outcome, 'results');
  assert.equal(res.categories.schedule.served[0].rung, 'summary');
  const receipts = m.receipts.query({ personaId: p.id, op: 'read' });
  assert.ok(receipts.length >= 1);
  assert.ok(receipts.every((r) => r.valid));
});

test('fact max_rung caps what a pass can serve', () => {
  const { ctx, m, p, agent } = setup();
  m.facts.add(p, {
    content: 'full detail', category: 'schedule',
    rungs: { summary: 'busy', exists: 'busy this week' },
    policy: { maxRung: 2 }
  });
  m.owner.grantPass(ctx, { clientId: agent.id, personaId: p.id, category: 'schedule', purpose: 'research', maxRung: 4 , acknowledgeFull: true });
  const session = m.owner.createSession(ctx, { clientId: agent.id, personaId: p.id });
  const res = m.agent.persona_context(session.accessToken, { categories: ['schedule'], purpose: 'research' });
  assert.equal(res.categories.schedule.served[0].rung, 'conclusion' in res.categories.schedule.served[0] ? 'conclusion' : res.categories.schedule.served[0].rung);
  // cap is min(pass 4, fact 2) -> conclusion if present else exists
  assert.ok(['conclusion', 'exists'].includes(res.categories.schedule.served[0].rung));
});

test('revocation takes effect on the next read (16)', () => {
  const { ctx, m, p, agent } = setup();
  m.facts.add(p, { content: 'fact', category: 'schedule' });
  const granted = m.owner.grantPass(ctx, { clientId: agent.id, personaId: p.id, category: 'schedule', purpose: 'research' , acknowledgeFull: true });
  const session = m.owner.createSession(ctx, { clientId: agent.id, personaId: p.id });
  const first = m.agent.persona_context(session.accessToken, { categories: ['schedule'], purpose: 'research' });
  assert.equal(first.outcome, 'results');
  m.owner.revokePass(ctx, granted.pass.id);
  const second = m.agent.persona_context(session.accessToken, { categories: ['schedule'], purpose: 'research' });
  assert.equal(second.outcome, 'approval_required');
});

test('one-time pass is consumed by a single read', () => {
  const { ctx, m, p, agent } = setup();
  m.facts.add(p, { content: 'fact', category: 'schedule' });
  m.owner.grantPass(ctx, { clientId: agent.id, personaId: p.id, category: 'schedule', purpose: 'research', duration: 'one_time' , acknowledgeFull: true });
  const session = m.owner.createSession(ctx, { clientId: agent.id, personaId: p.id });
  assert.equal(m.agent.persona_context(session.accessToken, { categories: ['schedule'], purpose: 'research' }).outcome, 'results');
  assert.equal(m.agent.persona_context(session.accessToken, { categories: ['schedule'], purpose: 'research' }).outcome, 'approval_required');
});

test('session is bound to one persona at grant time; other personas are unreachable', () => {
  const m = new Moira({});
  const ctx = ownerCtx(m);
  const p1 = m.owner.createPersona(ctx, { name: 'student', identity: 'linked' });
  const p2 = m.owner.createPersona(ctx, { name: 'founder', identity: 'linked' });
  const agent = m.owner.registerAgent(ctx, { name: 'a', tier: 'verified', personasAllowed: [p1.id] });
  const res = m.owner.createSession(ctx, { clientId: agent.id, personaId: p2.id });
  assert.equal(res.outcome, 'declined');
});

test('refresh tokens rotate; replay revokes the family (11)', () => {
  const { ctx, m, p, agent } = setup();
  const s = m.owner.createSession(ctx, { clientId: agent.id, personaId: p.id });
  const r1 = m.refreshSession(s.refreshToken);
  assert.equal(r1.outcome, 'results');
  const r2 = m.refreshSession(s.refreshToken); // replay of rotated token
  assert.equal(r2.outcome, 'declined');
  assert.equal(r2.reason, 'replay_detected_family_revoked');
  // the whole family is dead now, including the fresh rotation
  const r3 = m.refreshSession(r1.refreshToken);
  assert.equal(r3.outcome, 'declined');
});

test('one-tap agent revoke kills sessions and passes on the next request', () => {
  const { ctx, m, p, agent } = setup();
  m.facts.add(p, { content: 'fact', category: 'schedule' });
  m.owner.grantPass(ctx, { clientId: agent.id, personaId: p.id, category: 'schedule', purpose: 'research' , acknowledgeFull: true });
  const s = m.owner.createSession(ctx, { clientId: agent.id, personaId: p.id });
  m.agents.revoke(agent.id);
  const res = m.sessions.resolve(s.accessToken);
  assert.equal(res.outcome, 'declined');
});

test('tier gating: unverified agents cannot get voice passes (7.1, 7.5)', () => {
  const m = new Moira({});
  const ctx = ownerCtx(m);
  const p = m.owner.createPersona(ctx, { name: 'student', identity: 'linked' });
  const agent = m.owner.registerAgent(ctx, { name: 'random-cli', tier: 'unverified', personasAllowed: [p.id] });
  const res = m.owner.grantPass(ctx, { clientId: agent.id, personaId: p.id, category: 'voice', purpose: 'writing' , acknowledgeFull: true });
  assert.equal(res.outcome, 'declined');
  assert.equal(res.reason, 'tier_gated_category');
});

test('pairwise subs: same persona, different subs per client (13)', () => {
  const m = new Moira({});
  const ctx = ownerCtx(m);
  const p = m.owner.createPersona(ctx, { name: 'alias', identity: 'pseudonymous' });
  const sub1 = m.personas.sub(p.id, 'client_a');
  const sub2 = m.personas.sub(p.id, 'client_b');
  assert.notEqual(sub1, sub2);
  assert.equal(sub1, m.personas.sub(p.id, 'client_a')); // stable
});
