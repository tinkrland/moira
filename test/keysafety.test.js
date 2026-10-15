import test from 'node:test';
import assert from 'node:assert/strict';
import { Moira, SupabaseStore } from '../src/index.js';
import { withMock } from './helpers/mock-harness.mjs';

const ownerSession = () => ({ kind: 'owner_session', verified: true, ownerRef: 'owner' });
const INSTANCE_KEY = Buffer.alloc(32, 7).toString('hex');
const OTHER_KEY = Buffer.alloc(32, 9).toString('hex');

test('constructing with a persistent store and no MOIRA_INSTANCE_KEY throws', () => {
  const store = new SupabaseStore({ url: 'http://localhost:54321', key: 'testkey' });
  assert.throws(() => new Moira({ store }), /MOIRA_INSTANCE_KEY/);
});

test('a MemoryStore still works without an instance key (ephemeral keys)', () => {
  const m = new Moira({ store: undefined });
  const ctx = m.createOwnerContext(ownerSession());
  const p = m.owner.createPersona(ctx, { name: 'x', identity: 'linked' });
  assert.equal(p.identity, 'linked');
});

test('an existing key wrap that fails to unwrap throws VaultKeyUnavailableError, never a crash', async () => {
  await withMock(async (_mock, store) => {
    const a = new Moira({ store, instanceKey: INSTANCE_KEY });
    const ctxA = a.createOwnerContext(ownerSession());
    const p = a.owner.createPersona(ctxA, { name: 'student', identity: 'linked' });
    assert.ok(store.get('keywraps', p.id), 'wrap must exist after persona creation');

    // corrupt the wrap in the database
    store.put('keywraps', p.id, { id: p.id, sealed: 'garbage-ciphertext' });

    // a fresh gateway (restart) must NOT crash, NOT generate a replacement
    // key over the existing wrap, and must surface the corruption
    const b = new Moira({ store, instanceKey: INSTANCE_KEY });
    assert.throws(
      () => b.keys.personaKey(p.id),
      (err) => err.name === 'VaultKeyUnavailableError' && err.personaId === p.id
    );
    // the wrap was not overwritten by a fresh key
    assert.equal(store.get('keywraps', p.id).sealed, 'garbage-ciphertext');
  });
});

test('a changed MOIRA_INSTANCE_KEY surfaces the same error (no silent re-keying)', async () => {
  await withMock(async (_mock, store) => {
    const a = new Moira({ store, instanceKey: INSTANCE_KEY });
    const ctxA = a.createOwnerContext(ownerSession());
    const p = a.owner.createPersona(ctxA, { name: 'student', identity: 'linked' });

    // restart with a DIFFERENT instance key: the old wraps are unreadable
    const b = new Moira({ store, instanceKey: OTHER_KEY });
    assert.throws(() => b.keys.personaKey(p.id), (err) => err.name === 'VaultKeyUnavailableError');
    // no replacement wrap was written under the new key
    const wrap = store.get('keywraps', p.id);
    const reloaded = new Moira({ store, instanceKey: OTHER_KEY });
    assert.throws(() => reloaded.keys.personaKey(p.id), /VaultKeyUnavailable/);
    assert.deepEqual(store.get('keywraps', p.id).sealed, wrap.sealed);
  });
});
