// rotation on a calendar vs rotation on quiet
//
// two different questions. "every week / every month / on this date" is a
// CALENDAR: it does not care whether the thing is used. "N days after the repo
// has been unchanged for a week" is ACTIVITY: it waits for quiet, the way a
// hosted database pauses an idle project to save resources.
//
// the trap in activity-driven rotation is that a busy repo is NEVER quiet, so a
// purely idle schedule would never fire - which is backwards for a credential,
// where the point of rotating is that an old secret should not live forever. so
// idle schedules carry a MAX AGE ceiling, and the earliest trigger wins. the
// reason is reported, never guessed.
//
// honest limit, stated in the doc and here: moira observes its own reads and
// whatever the host reports via touchConnection. a human pushing to the repo, or
// CI running, is invisible unless someone says so. idle means "quiet as far as
// this system can see", not "quiet in the world".

import test from 'node:test';
import assert from 'node:assert/strict';
import { Moira } from '../src/index.js';
import { MemoryStore } from '../src/store.js';

const DAY = 24 * 3600 * 1000;
const ownerSession = () => ({ kind: 'owner_session', verified: true, ownerRef: 'owner' });

function setup(start = 1_800_000_000_000) {
  const clock = { t: start };
  const adapters = {
    drive: {
      id: 'drive',
      async listFiles() { return { rows: [{ id: 'f1' }] }; },
      async readFile() { return { content: 'x', meta: {} }; }
    }
  };
  const m = new Moira({ store: new MemoryStore(), io: { adapters }, now: () => clock.t });
  const ctx = m.createOwnerContext(ownerSession());
  const persona = m.owner.createPersona(ctx, { name: 'alex', identity: 'linked' });
  const agentId = m.owner.registerAgent(ctx, { name: 'planner', tier: 'verified', personasAllowed: [persona.id], spendCaps: { usd: 5 } }).id;
  const sess = m.owner.createSession(ctx, { clientId: agentId, personaId: persona.id });
  const conn = m.owner.connectConnector(ctx, {
    personaId: persona.id, connectorId: 'google_drive', credentials: { t: 'v1' },
    project: 'atlas', capabilities: ['repo:read']
  });
  return { m, ctx, persona, agentId, sess, conn, clock };
}

// sessions expire; these tests jump days, so each read mints its own
const readIn = (h, project = 'atlas') => {
  const s = h.m.owner.createSession(h.ctx, { clientId: h.agentId, personaId: h.persona.id });
  return h.m.agent.connector_read(s.accessToken, {
    connectorId: 'google_drive', operation: 'list', scope: 'files.list', purpose: 'probe',
    project, capabilities: ['repo:read']
  });
};

test('calendar: every week, every month, or a set date', () => {
  const h = setup();
  const { m, ctx, conn, clock } = h;
  const t0 = clock.t;

  const weekly = m.owner.setConnectionPolicy(ctx, { identityId: conn.identityId, mode: 'rotating', schedule: { kind: 'every', every: '1w' } });
  assert.equal(weekly.outcome, 'results');
  assert.equal(weekly.nextRotationAt, t0 + 7 * DAY, 'a week is a week');
  clock.t = t0 + 6 * DAY;
  assert.equal(m.owner.dueRotations(ctx).identities.length, 0);
  clock.t = t0 + 8 * DAY;
  assert.equal(m.owner.dueRotations(ctx).identities[0].reason, 'interval');

  const monthly = m.owner.setConnectionPolicy(ctx, { identityId: conn.identityId, mode: 'rotating', schedule: { kind: 'every', every: '1mo' } });
  assert.equal(monthly.nextRotationAt, clock.t + 30 * DAY, 'a month is 30 days here, not a calendar month - said plainly, not pretended');

  const dated = m.owner.setConnectionPolicy(ctx, { identityId: conn.identityId, mode: 'rotating', schedule: { kind: 'at', at: t0 + 10 * DAY } });
  assert.equal(dated.outcome, 'results');
  assert.equal(dated.nextRotationAt, t0 + 10 * DAY);
  clock.t = t0 + 9 * DAY;
  assert.equal(m.owner.dueRotations(ctx).identities.length, 0);
  clock.t = t0 + 10 * DAY;
  assert.equal(m.owner.dueRotations(ctx).identities[0].reason, 'scheduled');

  // a dated rotation is one-shot: after it fires the calendar is empty, not
  // silently rescheduled to the same instant
  const rotated = m.owner.rotateConnection(ctx, { identityId: conn.identityId, credentials: { t: 'v2' } });
  assert.equal(rotated.outcome, 'results');
  assert.equal(rotated.nextRotationAt, null);
  assert.equal(m.owner.connectionPolicy(ctx, { identityId: conn.identityId }).scheduleComplete, true);
  assert.equal(m.owner.dueRotations(ctx).identities.length, 0);

  const bad = m.owner.setConnectionPolicy(ctx, { identityId: conn.identityId, mode: 'rotating', schedule: { kind: 'sometimes' } });
  assert.equal(bad.outcome, 'declined');
  assert.equal(bad.reason, 'schedule_invalid');
});

test('activity: quiet for a week, then N days later - and a ceiling so busy never means never', async () => {
  const h = setup();
  const { m, ctx, conn, clock, persona, agentId, sess } = h;
  const t0 = clock.t;
  // still a session pass (the fine-grained default), but long enough to outlive
  // a test that jumps weeks - a 1h ttl would refuse before the schedule matters
  m.owner.grantConnectorPass(ctx, {
    clientId: agentId, personaId: persona.id, connectorId: 'google_drive',
    scope: 'files.list', purpose: 'probe', project: 'atlas', capabilities: ['repo:read'],
    ttlMs: 60 * DAY
  });

  const idle = m.owner.setConnectionPolicy(ctx, {
    identityId: conn.identityId, mode: 'rotating',
    schedule: { kind: 'idle', idleGraceMs: 7 * DAY, idleAfterMs: 2 * DAY, maxAgeMs: 30 * DAY }
  });
  assert.equal(idle.outcome, 'results');
  assert.equal(idle.nextRotationAt, t0 + 9 * DAY, 'seven quiet days plus two');

  // use is not quiet: a read pushes the trigger out
  clock.t = t0 + 5 * DAY;
  const r = await readIn(h);
  assert.equal(r.outcome, 'results');
  assert.equal(m.owner.connectionPolicy(ctx, { identityId: conn.identityId }).nextRotationAt, t0 + 14 * DAY,
    'the read counted as activity');

  clock.t = t0 + 13 * DAY;
  assert.equal(m.owner.dueRotations(ctx).identities.length, 0, 'not yet quiet long enough');
  clock.t = t0 + 15 * DAY;
  assert.equal(m.owner.dueRotations(ctx).identities[0].reason, 'quiet');

  // the ceiling: a credential in constant use still rotates at max age
  // a read needs a live session, and this loop spans weeks: mint one each time
  for (let d = 0; d <= 33; d += 3) {
    clock.t = t0 + d * DAY;
    const fresh = m.owner.createSession(ctx, { clientId: agentId, personaId: persona.id });
    const r2 = await m.agent.connector_read(fresh.accessToken, {
      connectorId: 'google_drive', operation: 'list', scope: 'files.list', purpose: 'probe',
      project: 'atlas', capabilities: ['repo:read']
    });
    assert.equal(r2.outcome, 'results', `read at day ${d} counts as activity`);
  }
  const policy = m.owner.connectionPolicy(ctx, { identityId: conn.identityId });
  assert.ok(policy.nextRotationAt <= clock.t + 1, 'a perpetually busy credential still comes due');
  const due = m.owner.dueRotations(ctx).identities[0];
  assert.ok(['quiet', 'max_age'].includes(due.reason));

  // and the host can tell moira about activity moira cannot see
  clock.t = t0 + 40 * DAY;
  const touched = m.owner.touchConnection(ctx, { identityId: conn.identityId });
  assert.equal(touched.outcome, 'results');
  assert.equal(touched.lastActivityAt, clock.t, 'a pushed-at-CI is activity, once the host reports it');
});

test('schedules are owner-only, and an agent cannot move its own rotation', () => {
  const h = setup();
  const { m, conn } = h;
  const denied = m.owner.setConnectionPolicy({ kind: 'agent' }, { identityId: conn.identityId, mode: 'rotating', schedule: { kind: 'every', every: '1w' } });
  assert.equal(denied.outcome, 'declined');
  assert.equal(denied.reason, 'owner_context_required');
});
