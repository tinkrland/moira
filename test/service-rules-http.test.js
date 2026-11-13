// a boundary the owner cannot see is a boundary they cannot trust
// (2026-11-13).

import test from 'node:test';
import assert from 'node:assert/strict';
import { Moira } from '../src/index.js';
import { MemoryStore } from '../src/store.js';
import { createOwnerSessionVerifier } from '../src/transport/ownersession.js';
import { createMoiraServer } from '../src/transport/server.js';

const SECRET = 'a-long-enough-owner-secret-71';

async function boot() {
  const m = new Moira({ store: new MemoryStore() });
  const a = m.createOwnerContext({ kind: 'owner_session', verified: true, ownerRef: 'owner-a' });
  const p = m.owner.createPersona(a, { name: 'alex-work', identity: 'pseudonymous' });
  const verify = createOwnerSessionVerifier({ moira: m, secret: SECRET });
  const server = createMoiraServer({ moira: m, baseUrl: 'http://127.0.0.1:8083', tokenKey: 'ef'.repeat(32), getOwnerContext: verify, port: 0 });
  const bound = await server.listen();
  return { m, p, server, base: `http://127.0.0.1:${bound.port}`, H: { 'content-type': 'application/json', 'x-moira-owner': SECRET } };
}

test('service rules over http: declared, listed, enforced, removed', async (t) => {
  const { base, server, H, m, p } = await boot();
  t.after(() => new Promise((r) => server.server.close(r)));

  assert.equal((await fetch(base + '/api/service-rules?personaId=' + p.id)).status, 401, 'owner-gated');

  const added = await fetch(base + '/api/service-rules', {
    method: 'POST', headers: H,
    body: JSON.stringify({ personaId: p.id, host: 'api.anthropic.com', pathGlob: '/v1/*', methods: ['POST'] })
  });
  assert.equal(added.status, 200);
  const { rule } = await added.json();
  assert.match(rule.id, /^svc_/);

  const listed = await (await fetch(base + `/api/service-rules?personaId=${p.id}`, { headers: H })).json();
  assert.equal(listed.rules.length, 1);
  assert.equal(m.services.match({ personaId: p.id, url: 'https://api.anthropic.com/v1/messages', method: 'POST' }).allowed, true);
  assert.equal(m.services.match({ personaId: p.id, url: 'https://api.openai.com/v1/chat', method: 'POST' }).allowed, false);

  const removed = await fetch(base + `/api/service-rules/${rule.id}`, { method: 'DELETE', headers: H });
  assert.equal(removed.status, 200);
  assert.equal((await (await fetch(base + `/api/service-rules?personaId=${p.id}`, { headers: H })).json()).rules.length, 0);

  // refusals carry their reason, so the panel can say what is wrong
  const bad = await fetch(base + '/api/service-rules', {
    method: 'POST', headers: H, body: JSON.stringify({ personaId: p.id, host: 'https://api.x.com/v1', pathGlob: '/*' })
  });
  assert.equal(bad.status, 400);
  assert.equal((await bad.json()).reason, 'host_must_be_a_host');

  const gone = await fetch(base + '/api/service-rules/svc_nope', { method: 'DELETE', headers: H });
  assert.equal(gone.status, 404);
});

test('service rules: the panel writes the sentence, and says what silence means', async () => {
  const { readFileSync } = await import('node:fs');
  const js = readFileSync(new URL('../ui/app.js', import.meta.url), 'utf8');
  assert.match(js, /\/api\/service-rules/);
  assert.match(js, /declare one endpoint and everything else closes/,
    'an empty list is not safety, and the panel has to say so');
  assert.match(js, /refused at the socket/, 'the enforcement point is named where the rule is written');
});
