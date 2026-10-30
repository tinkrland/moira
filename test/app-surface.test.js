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

test('app surface: serve and seed share the MOIRA_STATE file store', async () => {
  const { readFileSync } = await import('node:fs');
  for (const f of ['../scripts/serve.mjs', '../scripts/seed-demo.mjs']) {
    const src = readFileSync(new URL(f, import.meta.url), 'utf8');
    assert.match(src, /MOIRA_STATE/, `${f} honors MOIRA_STATE`);
    assert.match(src, /FileStore/, `${f} uses the file store`);
    assert.match(src, /INSFORGE_URL/, `${f} keeps hosted-first selection`);
  }
});

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

  // the card opens: detail endpoint returns the inventory, owner-gated
  assert.equal((await fetch(`${base}/api/persona?id=${persona.id}`)).status, 401);
  const detail = await (await fetch(`${base}/api/persona?id=${persona.id}`, { headers: owner })).json();
  assert.equal(detail.outcome, 'results');
  assert.equal(detail.persona.name, 'alexa');
  assert.ok(detail.stack.some((s) => s.tool === 'supabase'), 'declared stack shows');
  assert.deepEqual(detail.passes, [], 'isolated until lent');
  assert.equal((await fetch(`${base}/api/persona?id=psn_nope`, { headers: owner })).status, 404);

  // persona creation from the surface: validated, receipted, then visible
  const created = await fetch(`${base}/api/persona`, {
    method: 'POST', headers: { ...owner, 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'night desk', identity: 'linked', email: 'desk@dearagent.shop' })
  });
  assert.equal(created.status, 200);
  const bad = await fetch(`${base}/api/persona`, {
    method: 'POST', headers: { ...owner, 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'x', identity: 'linked', email: 'nope' })
  });
  assert.equal(bad.status, 400, 'bad email is refused, not stored');

  // set editing from the surface: untag everywhere, nothing deleted
  const setPost = await fetch(`${base}/api/set`, {
    method: 'POST', headers: { ...owner, 'content-type': 'application/json' },
    body: JSON.stringify({ personaId: persona.id, name: 'work' })
  });
  assert.equal(setPost.status, 200);
  const afterSet = await (await fetch(`${base}/api/persona?id=${persona.id}`, { headers: owner })).json();
  assert.equal(afterSet.sets.length, 0, 'set gone');
  assert.ok(afterSet.stack.length === 1, 'the declaration survives, untagged');
  const missing = await fetch(`${base}/api/set`, {
    method: 'POST', headers: { ...owner, 'content-type': 'application/json' },
    body: JSON.stringify({ personaId: persona.id, name: 'nope' })
  });
  assert.equal(missing.status, 404, 'unknown set is honest');

  // the card kit is compiled in: kit values are pinned (no drift)
  const js = await (await fetch(`${base}/app/app.js`)).text();
  const css = await (await fetch(`${base}/app/ui.css`)).text();
  assert.match(css, /aspect-ratio: 1\.58 \/ 1/, 'kit aspect');
  assert.match(css, /Space Mono/, 'kit typeface');
  assert.match(css, /feTurbulence/, 'kit noise overlay');
  assert.match(css, /cubic-bezier\(\.34, 1\.56, \.64, 1\)/, 'kit flip easing');
  assert.match(js, /\* 6/, 'kit ±6° tilt');
  assert.match(js, /0\.7s|--ry/, 'tilt applied through css vars');

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
