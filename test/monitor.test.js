// decoupling monitor (phase 0 item 2, spec 22.4): a shared identifier between
// a linked persona and a decoupled one breaks the decoupling; linked<->linked
// sharing is intended. declared-intentional pairs are skipped by the owner.

import test from 'node:test';
import assert from 'node:assert/strict';
import { Moira } from '../src/index.js';

const ownerSession = () => ({ kind: 'owner_session', verified: true, ownerRef: 'owner' });

function world(m) {
  const ctx = m.createOwnerContext(ownerSession());
  const linked = m.owner.createPersona(ctx, { name: 'student', identity: 'linked' });
  const linked2 = m.owner.createPersona(ctx, { name: 'founder', identity: 'linked' });
  const alias = m.owner.createPersona(ctx, { name: 'alias', identity: 'pseudonymous' });
  const hetero = m.owner.createPersona(ctx, {
    name: 'poet', identity: 'heteronymous',
    characterSheet: { name: 'the poet', backstory: 'x', voice: 'x', beliefs: 'x', expertise: 'x', redLines: 'x', canonRules: 'x' }
  });
  return { ctx, linked, linked2, alias, hetero };
}

test('linked + pseudonymous sharing a payer hash gives a hard finding', () => {
  const m = new Moira({});
  const { ctx, linked, alias } = world(m);
  const res = m.owner.monitorScan(ctx, {
    linkageHashes: [
      { personaId: linked.id, kind: 'payer', hash: 'h1', specificity: 'unique' },
      { personaId: alias.id, kind: 'payer', hash: 'h1', specificity: 'unique' }
    ]
  });
  assert.equal(res.findings.length, 1);
  assert.equal(res.findings[0].kind, 'hard');
  assert.deepEqual(res.findings[0].personas.sort(), [alias.id, linked.id].sort());
  assert.deepEqual(res.findings[0].evidenceKinds, ['payer']);
  assert.equal(res.agentVisible, false);
  assert.equal(res.stored, false);
});

test('two linked personas sharing a hash give no finding (intended)', () => {
  const m = new Moira({});
  const { ctx, linked, linked2 } = world(m);
  const res = m.owner.monitorScan(ctx, {
    linkageHashes: [
      { personaId: linked.id, kind: 'payer', hash: 'h1', specificity: 'unique' },
      { personaId: linked2.id, kind: 'payer', hash: 'h1', specificity: 'unique' }
    ]
  });
  assert.equal(res.findings.length, 0);
});

test('pseudonymous + heteronymous sharing a hash gives a finding', () => {
  const m = new Moira({});
  const { ctx, alias, hetero } = world(m);
  const res = m.owner.monitorScan(ctx, {
    linkageHashes: [
      { personaId: alias.id, kind: 'email', hash: 'h2', specificity: 'unique' },
      { personaId: hetero.id, kind: 'email', hash: 'h2', specificity: 'unique' }
    ]
  });
  assert.equal(res.findings.length, 1);
  assert.equal(res.findings[0].kind, 'hard');
});

test('quasi-identifier-only matches give a soft finding', () => {
  const m = new Moira({});
  const { ctx, linked, alias } = world(m);
  const res = m.owner.monitorScan(ctx, {
    linkageHashes: [
      { personaId: linked.id, kind: 'postcode', hash: 'h3', specificity: 'quasi' },
      { personaId: alias.id, kind: 'postcode', hash: 'h3', specificity: 'quasi' }
    ]
  });
  assert.equal(res.findings.length, 1);
  assert.equal(res.findings[0].kind, 'soft');
});

test('a pair the owner marked declared_intentional is skipped', () => {
  const m = new Moira({});
  const { ctx, linked, alias } = world(m);
  const declared = m.owner.declareLinkageIntention(ctx, { personaIds: [linked.id, alias.id], note: 'same shop card' });
  assert.equal(declared.outcome, 'results');
  const res = m.owner.monitorScan(ctx, {
    linkageHashes: [
      { personaId: linked.id, kind: 'payer', hash: 'h1', specificity: 'unique' },
      { personaId: alias.id, kind: 'payer', hash: 'h1', specificity: 'unique' }
    ]
  });
  assert.equal(res.findings.length, 0);
});

test('declaring one pair does not silence a third persona on the same hash', () => {
  const m = new Moira({});
  const { ctx, linked, alias, hetero } = world(m);
  m.owner.declareLinkageIntention(ctx, { personaIds: [linked.id, alias.id] });
  const res = m.owner.monitorScan(ctx, {
    linkageHashes: [
      { personaId: linked.id, kind: 'payer', hash: 'h1', specificity: 'unique' },
      { personaId: alias.id, kind: 'payer', hash: 'h1', specificity: 'unique' },
      { personaId: hetero.id, kind: 'payer', hash: 'h1', specificity: 'unique' }
    ]
  });
  assert.equal(res.findings.length, 1);
  assert.ok(res.findings[0].personas.includes(hetero.id));
});

test('no finding does not mean safe: the advisory note stays', () => {
  const m = new Moira({});
  const { ctx } = world(m);
  const res = m.owner.monitorScan(ctx, { linkageHashes: [] });
  assert.equal(res.findings.length, 0);
  assert.equal(res.agentVisible, false);
  assert.equal(res.stored, false);
});
