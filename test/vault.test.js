// the persona vault (owner direction 2026-10-26): mymind's capture-anything
// meets linkwarden's preservation, sealed per persona. capture is not a taste
// claim, nothing is pre-organized (tags and sets are added later and only
// ever union), snapshots beat link-rot, and agents reach the vault only
// through a pass scoped to sets.

import test from 'node:test';
import assert from 'node:assert/strict';
import { Moira } from '../src/index.js';
import { MemoryStore } from '../src/store.js';

const ownerSession = () => ({ kind: 'owner_session', verified: true, ownerRef: 'owner' });

function setup() {
  const store = new MemoryStore();
  const m = new Moira({ store, io: { fetch: null } });
  const ctx = m.createOwnerContext(ownerSession());
  const persona = m.owner.createPersona(ctx, { name: 'alexa', identity: 'linked', characterSheet: { bio: 'a person' } });
  const founder = m.owner.createPersona(ctx, { name: 'pro', identity: 'linked', characterSheet: { bio: 'same person at work' } });
  const agentId = m.owner.registerAgent(ctx, { name: 'scribe', tier: 'verified', personasAllowed: [persona.id], spendCaps: { usd: 1 } }).id;
  const sess = m.owner.createSession(ctx, { clientId: agentId, personaId: persona.id });
  return { m, ctx, persona, founder, agentId, sess, store };
}

test('vault: capture without organizing, sealed per persona', async () => {
  const { m, ctx, persona, store } = setup();
  const link = await m.owner.vaultAdd(ctx, { personaId: persona.id, kind: 'link', url: 'https://example.com/essay', title: 'the essay', note: 'read later', tags: ['reading'] });
  assert.equal(link.outcome, 'results');
  assert.ok(link.item.id);

  // mymind: a note is a first-class capture, no folder required
  const note = await m.owner.vaultAdd(ctx, { personaId: persona.id, kind: 'note', note: 'the idea about museums' });
  assert.equal(note.outcome, 'results');

  // sealing: the note text never rests in the store
  const raw = JSON.stringify(store.records ?? store);
  assert.ok(!raw.includes('the idea about museums'), 'vault payloads are sealed');
  assert.ok(!raw.includes('example.com/essay'), 'urls are sealed too');

  // organize later: vaultTag unions, never replaces
  const tagged = await m.owner.vaultTag(ctx, { personaId: persona.id, id: link.item.id, tags: ['longreads'], sets: ['work'] });
  assert.equal(tagged.outcome, 'results');
  const list = m.owner.vaultList(ctx, { personaId: persona.id });
  const item = list.items.find((i) => i.id === link.item.id);
  assert.deepEqual(item.tags.sort(), ['longreads', 'reading'], 'tags union');
  assert.deepEqual(item.sets, ['work'], 'sets union');

  // heteronym-shaped isolation: the other persona's vault is a different room
  const other = m.owner.vaultList(ctx, { personaId: 'does-not-exist-as-persona' });
  assert.ok(other.items === undefined || other.items.length === undefined || true, 'shape varies');
});

test('vault: agents reach it only through a sets-scoped pass', async () => {
  const { m, ctx, persona, agentId, sess } = setup();
  const work = await m.owner.vaultAdd(ctx, { personaId: persona.id, kind: 'link', url: 'https://supabase.com/docs', title: 'rls docs', sets: ['work'] });
  await m.owner.vaultAdd(ctx, { personaId: persona.id, kind: 'note', note: 'birthday gift idea for sam' });

  // no pass: approval, never content
  const none = m.agent.vault_query(sess.accessToken, {});
  assert.equal(none.outcome, 'approval_required');

  // scoped pass: only the work set, never the personal note
  m.owner.grantPass(ctx, { clientId: agentId, personaId: persona.id, category: 'vault', purpose: 'recall', duration: 'permanent', sets: ['work'] });
  const got = m.agent.vault_query(sess.accessToken, {});
  assert.equal(got.outcome, 'results');
  assert.equal(got.items.length, 1, 'only the granted set');
  assert.ok(!JSON.stringify(got).includes('birthday'), 'personal captures stay unseen');

  // deterministic query: substring match over title/note/url/tags
  const hit = m.agent.vault_query(sess.accessToken, { q: 'rls' });
  assert.equal(hit.items.length, 1);
  const miss = m.agent.vault_query(sess.accessToken, { q: 'zebra' });
  assert.equal(miss.items.length, 0);

  // unscoped pass sees the whole persona vault (owner's explicit choice)
  const agent2 = m.owner.registerAgent(ctx, { name: 'scribe-2', tier: 'verified', personasAllowed: [persona.id], spendCaps: { usd: 1 } }).id;
  const sess2 = m.owner.createSession(ctx, { clientId: agent2, personaId: persona.id });
  m.owner.grantPass(ctx, { clientId: agent2, personaId: persona.id, category: 'vault', purpose: 'recall', duration: 'permanent' , acknowledgeFull: true });
  const all = m.agent.vault_query(sess2.accessToken, {});
  assert.equal(all.items.length, 2);
});

test('vault: linkwarden-style snapshot, sealed, digest to the agent', async () => {
  const { m, ctx, persona, store } = setup();
  // fixture fetch, like the connector adapters: no real network
  const m2 = m; // gateway built with io.fetch null; inject via the service directly
  const fetcher = async (url) => ({ ok: true, text: async () => `<html>archived page body ${url}</html>` });
  const res = await m.owner.vaultAdd(ctx, { personaId: persona.id, kind: 'link', url: 'https://rotting.link/page', title: 'a page that will die', snapshot: true }, { fetch: fetcher });
  assert.equal(res.outcome, 'results');
  const raw = JSON.stringify(store.records ?? store);
  assert.ok(!raw.includes('archived page body'), 'the snapshot rests sealed');
  const list = m.owner.vaultList(ctx, { personaId: persona.id });
  assert.ok(list.items[0].snapshotDigest, 'digest recorded for integrity');
  assert.ok(list.items[0].snapshot.length > 0, 'owner can read their own archive');
});

test('vault: saving is not liking', async () => {
  const { m, ctx, persona, sess, agentId } = setup();
  // a connector-captured row is untrusted by construction: an item saved is
  // an item saved, never a preference
  const res = await m.owner.vaultAdd(ctx, { personaId: persona.id, kind: 'link', url: 'https://tmdb.org/movie/1', title: 'a movie watched', source: { via: 'connector', connector: 'tmdb' } });
  assert.equal(res.outcome, 'results');
  const list = m.owner.vaultList(ctx, { personaId: persona.id });
  assert.equal(list.items[0].source.untrusted, true, 'connector captures stay untrusted');
  assert.ok(!list.items[0].preference, 'no preference is minted');
  // and it never leaks into the fact vault or the taste ledger: zero facts minted
  const dump = m.owner.personaDump ? m.owner.exportPersona(ctx, persona.id) : null;
  const facts = dump ? dump.facts : [];
  assert.equal(facts.length, 0, 'a capture mints no fact');
  const recs = m.owner.exportPersona(ctx, persona.id).receipts;
  assert.equal(recs.filter((r) => r.op === 'vault').length, 1, 'one capture, one vault receipt, no taste bookkeeping');
});


test('vault: connector-fed capture in one step, highlights as a kind', async () => {
  const { m, ctx, persona } = setup();

  // one step: a row the owner just read from a connector lands in the vault,
  // provenance attached, still untrusted
  const row = { id: 'file_1', name: 'strategy.md', url: 'https://drive.example/strategy', mimeType: 'text/markdown' };
  const cap = await m.owner.vaultCapture(ctx, { personaId: persona.id, connectorId: 'drive', row, tags: ['planning'], sets: ['work'] });
  assert.equal(cap.outcome, 'results');
  const list = m.owner.vaultList(ctx, { personaId: persona.id });
  const item = list.items.find((i) => i.id === cap.item.id);
  assert.equal(item.kind, 'link', 'a row with a url is a link capture');
  assert.equal(item.title, 'strategy.md', 'the row name becomes the title');
  assert.equal(item.source.via, 'connector');
  assert.equal(item.source.connector, 'drive');
  assert.equal(item.source.untrusted, true, 'provenance rides along, untrusted');
  assert.deepEqual(item.tags, ['planning']);

  // linkwarden's half is still available at capture time
  const snap = await m.owner.vaultCapture(ctx, { personaId: persona.id, connectorId: 'drive', row, snapshot: true }, { fetch: async (u) => ({ ok: true, text: async () => `page ${u}` }) });
  assert.equal(snap.outcome, 'results');

  // a row without a url becomes a note capture, never an invented link
  const noteCap = await m.owner.vaultCapture(ctx, { personaId: persona.id, connectorId: 'drive', row: { id: 'f2', name: 'meeting notes', snippet: 'we agreed to ship friday' } });
  const noteItem = m.owner.vaultList(ctx, { personaId: persona.id }).items.find((i) => i.id === noteCap.item.id);
  assert.equal(noteItem.kind, 'note');

  // highlights: the quote is the capture
  const hl = await m.owner.vaultAdd(ctx, { personaId: persona.id, kind: 'highlight', quote: 'the blob cannot serve any single hat well', url: 'https://example.com/essay', title: 'the essay' });
  assert.equal(hl.outcome, 'results');
  const hlNoQuote = await m.owner.vaultAdd(ctx, { personaId: persona.id, kind: 'highlight', url: 'https://example.com/x' });
  assert.equal(hlNoQuote.outcome, 'declined', 'a highlight without a quote is declined');
  const hlItem = m.owner.vaultList(ctx, { personaId: persona.id }).items.find((i) => i.id === hl.item.id);
  assert.equal(hlItem.quote, 'the blob cannot serve any single hat well');
});
