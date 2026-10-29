// the browser surface (owner direction 2026-10-29): the proper build of the
// ui, served by the transport itself, zero dependencies. the card kit's
// flippable anatomy is ported to plain css/js; the api behind it only ever
// lints consent (scoped sets, or an explicit full-hat acknowledgement).

import test from 'node:test';
import assert from 'node:assert/strict';
import { Moira } from '../src/index.js';
import { MemoryStore } from '../src/store.js';
import { createOwnerSessionVerifier } from '../src/transport/ownersession.js';
import { createMoiraServer } from '../src/transport/server.js';

const SECRET = 'correct horse battery staple 42';

async function boot() {
  const m = new Moira({ store: new MemoryStore() });
  const ctx = m.createOwnerContext({ kind: 'owner_session', verified: true, ownerRef: 'owner' });
  const persona = m.owner.createPersona(ctx, { name: 'alexa', identity: 'linked' });
  m.owner.stackAdd(ctx, { personaId: persona.id, tool: 'supabase', uses: ['auth', 'postgres'], sets: ['work'] });
  const agentId = m.owner.registerAgent(ctx, { name: 'app', tier: 'verified', personasAllowed: [persona.id], spendCaps: { usd: 1 } }).id;
  const verify = createOwnerSessionVerifier({ moira: m, secret: SECRET });
  const server = createMoiraServer({ moira: m, baseUrl: 'http://127.0.0.1:8080', tokenKey: 'ab'.repeat(32), getOwnerContext: verify, port: 0 });
  const bound = await server.listen();
  return { m, ctx, persona, agentId, base: `http://127.0.0.1:${bound.port}`, server };
}

test('app surface: served, owner-gated, and never silently full', async (t) => {
  const { persona, agentId, base, server } = await boot();
  t.after(() => new Promise((r) => server.server.close(r)));
  const owner = { 'x-moira-owner': SECRET };

  // the page is served with its assets
  const page = await fetch(`${base}/app`);
  assert.equal(page.status, 200);
  const html = await page.text();
  assert.match(html, /moira/, 'brand present');
  assert.match(html, /whole hat/i, 'the full-scope acknowledgement is in the ui');
  for (const asset of ['/app/app.js', '/app/ui.css']) {
    assert.equal((await fetch(base + asset)).status, 200, `${asset} served`);
  }

  // overview: 401 without the owner, shape with it
  assert.equal((await fetch(`${base}/api/overview`)).status, 401);
  const ov = await (await fetch(`${base}/api/overview`, { headers: owner })).json();
  assert.equal(ov.outcome, 'results');
  assert.equal(ov.personas.length, 1);
  assert.equal(ov.personas[0].name, 'alexa');
  assert.deepEqual(ov.personas[0].sets.map((s) => s.name), ['work'], 'sets feed the card face');
  assert.deepEqual(ov.personas[0].passes, [], 'isolation is the default');

  // lending: full scope without acknowledgement is refused at the api
  const post = (body) => fetch(`${base}/api/pass`, { method: 'POST', headers: { ...owner, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const silent = await post({ personaId: persona.id, clientId: agentId, category: 'stack', purpose: 'context', duration: 'session' });
  assert.equal(silent.status, 409);
  assert.equal((await silent.json()).reason, 'full_scope_requires_acknowledgement');

  // scoped lending works and shows up on the card
  const scoped = await post({ personaId: persona.id, clientId: agentId, category: 'stack', purpose: 'context', duration: 'session', sets: ['work'] });
  assert.equal(scoped.status, 200);
  const after = await (await fetch(`${base}/api/overview`, { headers: owner })).json();
  const pass = after.personas[0].passes[0];
  assert.equal(pass.scope, 'sets');
  assert.deepEqual(pass.sets, ['work']);

  // acknowledged full lending is allowed and labeled on the card
  const full = await post({ personaId: persona.id, clientId: agentId, category: 'stack', purpose: 'context', duration: 'permanent', acknowledgeFull: true });
  assert.equal(full.status, 200);
  const fullPass = (await full.json()).pass;
  assert.equal(fullPass.scope, 'full');
  assert.equal(fullPass.standing, true, 'standing, and it expires');

});
