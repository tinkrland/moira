// the connector surface over http (owner, 2026-11-05): the panel needs a place
// to connect with a share list, to see what is shared, and to revoke. every
// route here is owner-only, and one of them hands a credential to a second hat,
// so the transport is pinned rather than assumed.

import test from 'node:test';
import assert from 'node:assert/strict';
import { createMoiraServer } from '../src/transport/server.js';
import { Moira } from '../src/index.js';
import { MemoryStore } from '../src/store.js';

const KEY = '33'.repeat(32);

async function boot() {
  const io = {
    adapters: { google_drive: { id: 'google_drive', async listFiles() { return { rows: [] }; }, async readFile() { return { content: '', meta: {} }; } } }
  };
  const m = new Moira({ store: new MemoryStore(), io });
  const ctx = m.createOwnerContext({ kind: 'owner_session', verified: true, ownerRef: 'owner' });
  const work = m.owner.createPersona(ctx, { name: 'work', identity: 'linked' });
  const priv = m.owner.createPersona(ctx, { name: 'private', identity: 'linked' });
  const srv = createMoiraServer({
    moira: m, baseUrl: 'http://127.0.0.1:0', tokenKey: KEY, port: 0,
    getOwnerContext: (req) => (req.headers['x-moira-owner'] === 'owner-secret'
      ? m.createOwnerContext({ kind: 'owner_session', verified: true, ownerRef: 'owner' })
      : null)
  });
  const addr = await srv.listen();
  const base = `http://127.0.0.1:${addr.port}`;
  const call = async (path, init = {}) => {
    const res = await fetch(`${base}${path}`, {
      ...init,
      headers: { 'content-type': 'application/json', 'x-moira-owner': 'owner-secret', ...(init.headers ?? {}) }
    });
    return { status: res.status, body: await res.json() };
  };
  // the server surface exposes `server`, not `close`; keep-alive sockets from
  // fetch would otherwise hold the test process open after the last assertion
  const close = () => {
    srv.server.closeAllConnections?.();
    srv.server.close();
  };
  return { m, ctx, work, priv, call, url: base, close };
}

test('the panel can list what is connected, marked shared without naming the other hat', async (t) => {
  const h = await boot();
  t.after(() => h.close());
  const { ctx, work, priv, call } = h;
  const made = await call('/api/connectors/connect', {
    method: 'POST',
    body: JSON.stringify({ personaId: work.id, connectorId: 'google_drive', credentials: { t: 'k' }, sharedWith: [priv.id] })
  });
  assert.equal(made.status, 200, JSON.stringify(made.body));
  assert.equal(made.body.shareScope, 'shared');

  const listed = await call(`/api/connectors?personaId=${priv.id}`);
  assert.equal(listed.status, 200, JSON.stringify(listed.body));
  assert.equal(listed.body.connectors.length, 1);
  assert.equal(listed.body.connectors[0].shared, true);
  assert.equal(listed.body.connectors[0].mine, false);
  assert.equal(JSON.stringify(listed.body).includes(work.id), false,
    'a borrower is never told which hat lent it');

  // the classification travels with the surface, so the panel can offer the
  // share control only where it is honest to offer it
  const kinds = Object.fromEntries((listed.body.providers ?? []).map((p) => [p.id, p]));
  assert.equal(kinds.google_drive.scope, 'persona');
  assert.ok(Object.keys(kinds).length > 0);
  void ctx;
});

test('a malformed share list is refused at the edge, not stored and sorted out later', async (t) => {
  const h = await boot();
  t.after(() => h.close());
  const { work, call } = h;
  const bad = await call('/api/connectors/connect', {
    method: 'POST',
    body: JSON.stringify({ personaId: work.id, connectorId: 'google_drive', credentials: { t: 'k' }, sharedWith: [work.id] })
  });
  assert.equal(bad.status, 400, JSON.stringify(bad.body));
  assert.equal(bad.body.reason, 'shared_with_invalid');
});

test('revoking over http ends the credential for the borrower too', async (t) => {
  const h = await boot();
  t.after(() => h.close());
  const { work, priv, call } = h;
  const made = await call('/api/connectors/connect', {
    method: 'POST',
    body: JSON.stringify({ personaId: work.id, connectorId: 'google_drive', credentials: { t: 'k' }, sharedWith: [priv.id] })
  });
  const gone = await call('/api/connectors/revoke', {
    method: 'POST', body: JSON.stringify({ identityId: made.body.identityId })
  });
  assert.equal(gone.status, 200, JSON.stringify(gone.body));
  const listed = await call(`/api/connectors?personaId=${priv.id}`);
  assert.equal(listed.body.connectors.length, 0);
});

test('without an owner session every connector route refuses before touching a secret', async () => {
  const { work, url, close } = await boot();
  try {
    const listed = await fetch(`${url}/api/connectors?personaId=${work.id}`);
    assert.equal(listed.status, 401);
    const body = await listed.json();
    assert.equal(body.reason, 'owner_session_required');

    const connect = await fetch(`${url}/api/connectors/connect`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ personaId: work.id, connectorId: 'google_drive', credentials: { t: 'k' } })
    });
    assert.equal(connect.status, 401, 'an unauthenticated caller cannot deposit a secret');
  } finally {
    close();
  }
});
