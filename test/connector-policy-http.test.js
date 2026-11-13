// connection policy and the rotation clock (2026-11-13).
//
// the rotation maths was built and then never reached: setConnectionPolicy had
// no route and no panel control, and nothing called dueRotations, so a
// credential past its deadline was only found by a host that remembered to ask.
// these tests pin the surface and the clock a host can actually run.

import test from 'node:test';
import assert from 'node:assert/strict';
import { Moira } from '../src/index.js';
import { MemoryStore } from '../src/store.js';
import { createOwnerSessionVerifier } from '../src/transport/ownersession.js';
import { createMoiraServer } from '../src/transport/server.js';

const SECRET = 'correct horse battery staple 42';
const DAY = 86_400_000;

async function boot() {
  let t = 1_900_000_000_000;
  const m = new Moira({ store: new MemoryStore(), now: () => t });
  const a = m.createOwnerContext({ kind: 'owner_session', verified: true, ownerRef: 'owner-a' });
  const workA = m.owner.createPersona(a, { name: 'alex-work', identity: 'pseudonymous' });
  const conn = m.owner.connectConnector(a, {
    personaId: workA.id, connectorId: 'google_drive', credentials: { token: 'tok-1' }, account: 'alex@work.example'
  });
  const verify = createOwnerSessionVerifier({ moira: m, secret: SECRET });
  const server = createMoiraServer({ moira: m, baseUrl: 'http://127.0.0.1:8080', tokenKey: 'ab'.repeat(32), getOwnerContext: verify, port: 0 });
  const bound = await server.listen();
  return {
    m, a, workA, identityId: conn.identityId ?? conn.id, server,
    base: `http://127.0.0.1:${bound.port}`,
    owner: { 'content-type': 'application/json', 'x-moira-owner': SECRET },
    advance: (ms) => { t += ms; return t; }
  };
}

const get = (base, owner, path) => fetch(base + path, { headers: owner });
const post = (base, owner, path, body) => fetch(base + path, { method: 'POST', headers: owner, body: JSON.stringify(body) });

test('connector policy: routes are owner-gated', async (t) => {
  const { base, server, identityId } = await boot();
  t.after(() => new Promise((r) => server.server.close(r)));
  const anon = { 'content-type': 'application/json' };
  for (const [method, path, body] of [
    ['GET', `/api/connectors/policy?identityId=${identityId}`, null],
    ['GET', '/api/connectors/due', null],
    ['POST', '/api/connectors/policy', { identityId, mode: 'rotating', everyMs: DAY }],
    ['POST', '/api/connectors/rotate', { identityId, credentials: { token: 'x' } }]
  ]) {
    const res = method === 'GET' ? await get(base, anon, path) : await post(base, anon, path, body);
    assert.equal(res.status, 401, `${method} ${path.split('?')[0]} refuses an anonymous caller`);
  }
});

test('connector policy: a schedule can be set, read back, and comes due', async (t) => {
  const { base, server, owner, identityId, advance } = await boot();
  t.after(() => new Promise((r) => server.server.close(r)));

  const before = await (await get(base, owner, `/api/connectors/policy?identityId=${identityId}`)).json();
  assert.equal(before.mode, 'revocable', 'revocable is the default, not an accident');

  const set = await post(base, owner, '/api/connectors/policy', { identityId, mode: 'rotating', everyMs: 30 * DAY });
  assert.equal(set.status, 200);
  const applied = await set.json();
  assert.equal(applied.outcome, 'results');
  assert.equal(applied.schedule.kind, 'every');
  assert.ok(applied.nextRotationAt > 0, 'a schedule that computes no deadline is not a schedule');

  const readBack = await (await get(base, owner, `/api/connectors/policy?identityId=${identityId}`)).json();
  assert.equal(readBack.mode, 'rotating');
  assert.equal(readBack.rotationEveryMs, 30 * DAY);

  const dueNow = await (await get(base, owner, '/api/connectors/due')).json();
  assert.deepEqual(dueNow.identities, [], 'nothing is due the moment a schedule is set');

  advance(31 * DAY);
  const due = await (await get(base, owner, '/api/connectors/due')).json();
  assert.equal(due.identities.length, 1);
  assert.equal(due.identities[0].identityId, identityId);
  assert.ok(due.identities[0].overdueByMs > 0);
  assert.equal(due.identities[0].account, 'alex@work.example', 'the due list names what to rotate');

  const bad = await post(base, owner, '/api/connectors/policy', { identityId, mode: 'sometimes' });
  assert.equal(bad.status, 400);
  assert.equal((await bad.json()).reason, 'mode_invalid');

  const missing = await get(base, owner, '/api/connectors/policy?identityId=ci_missing');
  assert.equal(missing.status, 404);
});

test('connector policy: rotating keeps the identity and re-arms an interval', async (t) => {
  const { base, server, owner, identityId, advance, m, workA } = await boot();
  t.after(() => new Promise((r) => server.server.close(r)));

  await post(base, owner, '/api/connectors/policy', { identityId, mode: 'rotating', everyMs: 30 * DAY });
  advance(31 * DAY);

  const noMaterial = await post(base, owner, '/api/connectors/rotate', { identityId });
  assert.equal(noMaterial.status, 400, 'a rotation without new material is a no-op, not a success');

  const rotated = await post(base, owner, '/api/connectors/rotate', { identityId, credentials: { token: 'tok-2' } });
  assert.equal(rotated.status, 200);
  const out = await rotated.json();
  assert.equal(out.rotationCount, 1);
  assert.equal(out.scheduleComplete, false, 'an interval re-arms');
  assert.ok(out.nextRotationAt > 0);

  const after = await (await get(base, owner, '/api/connectors/due')).json();
  assert.deepEqual(after.identities, [], 'a rotated credential is no longer due');

  // the identity survived the rotation, so a live pass still works
  const held = m.owner.listConnectors(m.a ?? m.createOwnerContext({ kind: 'owner_session', verified: true, ownerRef: 'owner-a' }), { personaId: workA.id });
  assert.equal(held.connectors.length, 1);
  assert.equal(held.connectors[0].identityId, identityId);
});

test('the sweep script sweeps asks and reports due rotations, and rotates nothing', async () => {
  // the clock ships as a command a host can cron, because a scheduler inside the
  // process would decide on its own authority when credentials must rotate.
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('../scripts/sweep.mjs', import.meta.url), 'utf8');
  assert.match(src, /sweepAccessRequests/, 'the sweep stamps stale asks');
  assert.match(src, /dueRotations/, 'and reports what is due');
  assert.equal(/rotateConnection|\.rotate\(/.test(src), false, 'it rotates nothing: that needs a person');
  assert.match(src, /MOIRA_OWNER_CONFIRMED/, 'and it refuses to run unowned');
});

test('the panel shows a deadline and offers exactly two acts', async () => {
  const { readFileSync } = await import('node:fs');
  const js = readFileSync(new URL('../ui/app.js', import.meta.url), 'utf8');
  const css = readFileSync(new URL('../ui/ui.css', import.meta.url), 'utf8');
  assert.match(js, /\/api\/connectors\/policy\?identityId=/, 'the policy is read per connection');
  assert.match(js, /\/api\/connectors\/due/, 'and the due list is asked once, not guessed per row');
  assert.match(js, /\/api\/connectors\/rotate/, 'new material is a control, not a cli-only act');
  assert.match(js, /revocable · stays until you revoke it/, 'the default is stated in words');
  assert.match(js, /due now/, 'an overdue credential is visible on the surface');
  assert.match(css, /\.pol\b/);
  // the panel must never hold or echo a credential: it posts one and forgets it
  assert.equal(/localStorage|sessionStorage/.test(js), false, 'no credential is cached in the browser');
});
