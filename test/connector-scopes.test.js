// the sharing classification (2026-11-05): which buckets can cross personas.
// this is a hint for the owner surface, never an action - and an unknown
// provider fails closed.

import test from 'node:test';
import assert from 'node:assert/strict';
import { shareHint, shareScopeFor } from '../src/connectors/scopes.js';
import { REGISTRY } from '../src/connectors/registry.js';

test('an oauth account is persona-scoped, and says why', () => {
  const drive = shareHint('google_drive');
  assert.equal(drive.auth, 'oauth');
  assert.equal(drive.scope, 'persona');
  assert.match(drive.reason, /account/);
});

test('an api key is shareable, because a key is not a face', () => {
  const llm = shareHint('claude');
  assert.equal(llm.auth, 'api_key');
  assert.equal(llm.shareable, true);
  assert.match(llm.reason, /not a person|plan/);
});

test('unknown providers fail closed instead of being guessed shareable', () => {
  const weird = shareHint('some_new_thing');
  assert.equal(weird.scope, 'unknown');
  assert.equal(weird.shareable, false);
  assert.equal(shareScopeFor('some_new_thing'), 'persona');
});

test('every connectable provider has a classification', () => {
  // REGISTRY is already the flat provider list, so walking it a second time as
  // if it were blocks made this assertion vacuously true. it asserts on ids now.
  const active = REGISTRY.filter((p) => p.status === 'active').map((p) => p.id);
  assert.ok(active.length >= 4, 'the registry actually contains active providers');
  const unclassified = active.filter((id) => shareHint(id).scope === 'unknown');
  assert.deepEqual(unclassified, [], 'a provider you can connect today must be classified');
});

test('a provider that declares its auth style is classified by it, not left unknown', () => {
  // mega is declared in the table, but the point is the fallback: a registry
  // row carrying an auth style answers without needing a hand-written entry.
  const mega = shareHint('mega');
  assert.equal(mega.auth, 'session');
  assert.equal(mega.scope, 'persona');
});

test('an ingest provider has no credential, so there is nothing to share', () => {
  // not in the declared table: the registry's kind is what answers
  const books = shareHint('goodreads');
  assert.equal(books.auth, 'none');
  assert.equal(books.scope, 'persona');
  assert.equal(books.shareable, false);
});

test('a planned provider that declares nothing stays unknown rather than guessed', () => {
  // github is connected but declares no auth style yet, so the honest answer is
  // "unclassified", not either scope. unknown fails closed at the call site.
  const gh = shareHint('github');
  assert.equal(gh.scope, 'unknown');
  assert.equal(shareScopeFor('github'), 'persona');
});
