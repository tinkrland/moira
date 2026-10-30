// the ego.ist build, step 1: the consent loop, app-initiated.
//
// ego.ist's whole shape is: an app ASKS for exact context, with a purpose and
// a duration; the owner sees who/why/how long, and approves, narrows or
// denies. moira had the pass (owner-minted) but no request. now: an agent asks,
// the owner decides, and approval is the only thing that mints a pass.

import test from 'node:test';
import assert from 'node:assert/strict';
import { Moira } from '../src/index.js';
import { MemoryStore } from '../src/store.js';

function setup() {
  const m = new Moira({ store: new MemoryStore() });
  const ctx = m.createOwnerContext({ kind: 'owner_session', verified: true, ownerRef: 'owner' });
  const persona = m.owner.createPersona(ctx, { name: 'alexa', identity: 'linked' });
  m.owner.stackAdd(ctx, { personaId: persona.id, tool: 'supabase', uses: ['auth'], sets: ['work'] });
  m.facts.add(m.personas.get(persona.id), { content: 'ships on fridays', category: 'preferences', sets: ['work'] });
  const agentId = m.owner.registerAgent(ctx, { name: 'planner', tier: 'verified', personasAllowed: [persona.id], spendCaps: { usd: 1 } }).id;
  const sess = m.owner.createSession(ctx, { clientId: agentId, personaId: persona.id });
  return { m, ctx, persona, agentId, token: sess.accessToken };
}

test('requests: an agent asks, the owner decides, approval mints the pass', () => {
  const { m, ctx, persona, token } = setup();

  // 1. the ask: exact categories, a purpose, a duration. nothing is readable yet.
  const ask = m.agent.request_access(token, {
    categories: ['preferences'], purpose: 'sub_gap_analysis', duration: 'session',
    note: 'need your stack so i can scaffold the auth migration'
  });
  assert.equal(ask.outcome, 'results');
  assert.equal(ask.request.status, 'pending');
  assert.deepEqual(ask.request.categories, ['preferences']);

  // 2. reading is still impossible while pending (approval-first, not notify-later)
  const blocked = m.agent.persona_context(token, { categories: ['preferences'], purpose: 'sub_gap_analysis' });
  assert.equal(blocked.outcome, 'approval_required');

  // 3. the owner sees who/why/how long, and narrows it on approval
  const inbox = m.owner.listAccessRequests(ctx, { status: 'pending' });
  assert.equal(inbox.requests.length, 1);
  assert.equal(inbox.requests[0].purpose, 'sub_gap_analysis');
  assert.equal(inbox.requests[0].clientId, ask.request.clientId);

  const approved = m.owner.approveAccessRequest(ctx, {
    requestId: ask.request.id,
    edits: { sets: ['work'], maxRung: 2, duration: 'one_time' }
  });
  assert.equal(approved.outcome, 'results');
  assert.equal(approved.passes.length, 1);
  const pass = approved.passes[0];
  assert.deepEqual(pass.sets, ['work'], 'owner narrowed the scope');
  assert.equal(pass.maxRung, 2, 'owner lowered the rung');
  assert.equal(pass.duration, 'one_time', 'owner shortened the duration');
  assert.equal(pass.scope, 'sets');

  // 4. the narrowed pass is what the agent gets (one read, then consumed)
  const read = m.agent.persona_context(token, { categories: ['preferences'], purpose: 'sub_gap_analysis' });
  assert.equal(read.outcome, 'results');
  const again = m.agent.persona_context(token, { categories: ['preferences'], purpose: 'sub_gap_analysis' });
  assert.equal(again.outcome, 'approval_required', 'one_time is one read');

  // 5. receipts record the ask and the grant
  const recs = m.owner.exportPersona(ctx, persona.id).receipts;
  assert.ok(recs.some((r) => r.op === 'access_request'), 'the ask is receipted');
  assert.ok(recs.some((r) => r.op === 'pass_grant'), 'the grant is receipted');
});

test('requests: denial mints nothing, edits cannot widen, agents cannot approve', () => {
  const { m, ctx, token } = setup();

  const ask = m.agent.request_access(token, { categories: ['preferences'], purpose: 'audit', duration: 'permanent' });
  const denied = m.owner.denyAccessRequest(ctx, { requestId: ask.request.id, reason: 'not needed' });
  assert.equal(denied.outcome, 'results');
  assert.equal(denied.request.status, 'denied');
  assert.equal(m.owner.listPasses?.length ?? 0, 0);
  const read = m.agent.persona_context(token, { categories: ['preferences'], purpose: 'audit' });
  assert.equal(read.outcome, 'approval_required', 'denial grants nothing');

  // an approved request can be narrowed but never widened past the ask
  const ask2 = m.agent.request_access(token, { categories: ['preferences'], purpose: 'audit2', duration: 'session', sets: ['work'] });
  const approved = m.owner.approveAccessRequest(ctx, {
    requestId: ask2.request.id,
    edits: { sets: null, duration: 'permanent' } // try to widen to the whole hat + standing
  });
  assert.equal(approved.outcome, 'declined');
  assert.equal(approved.reason, 'edits_widen_the_request');

  // agents have no approval path at all
  assert.equal(typeof m.agent.approveAccessRequest, 'undefined');
});
