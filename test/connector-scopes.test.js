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

test('every registered provider has a classification', () => {
  const ids = [];
  for (const block of REGISTRY) for (const provider of block.providers ?? []) ids.push(provider.id);
  const unclassified = ids.filter((id) => shareHint(id).scope === 'unknown');
  assert.deepEqual(unclassified, [], 'a new provider must be classified, not inherited as unknown');
});
