// the panel's connection controls (owner, 2026-11-05). the transport and the
// hub are pinned elsewhere; what is checked here is that the surface asks the
// right questions and never offers a share it cannot honestly offer.
//
// the panel is a zero-dependency classic script with no dom harness, so these
// are source-level assertions. they are written narrowly on purpose: each one
// pins a decision that would be a real defect (a share control on an account, a
// malformed share list, a revoke that names the wrong field).

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const js = readFileSync(new URL('../ui/app.js', import.meta.url), 'utf8');

test('the panel asks the api what a hat holds before drawing a connection', () => {
  assert.match(js, /\/api\/connectors\?personaId=/, 'the listing is per persona, not global');
  assert.match(js, /connectors: \[\], providers: \[\]/, 'a failed listing degrades to empty, not to a broken view');
});

test('sharing is offered only where the classification says it is honest', () => {
  // the gate is the api's shareable flag. a key for a plan gets plain boxes; an
  // account with a face gets the reason and nothing to tick until the owner
  // acknowledges what is being joined.
  assert.match(js, /hint\.shareable === true/, 'a shareable provider gets the plain list');
  assert.match(js, /input\[name=shareAnyway\]/, 'an account needs an explicit acknowledgement');
  assert.match(js, /it joins the hats at/, 'the acknowledgement names what is joined');
  assert.match(js, /hint\.reason/, 'and a non-shareable provider says why');
});

test('an empty share list is never sent: no boxes ticked means no shareScope', () => {
  assert.match(js, /shared\.length \? \{ sharedWith: shared \} : \{\}/,
    'the list is omitted rather than sent empty, which the hub refuses as malformed');
});

test('revoke names the identity the listing gave it', () => {
  assert.match(js, /\/api\/connectors\/revoke/);
  assert.match(js, /identityId: btn\.dataset\.id/);
  assert.match(js, /it ends for every hat it was shared with/, 'revocation is stated as one act for everyone');
});

test('a planned provider is listed but not offered as connectable', () => {
  assert.match(js, /x\.status === 'active' \? '' : ' disabled'/, 'planned rows are disabled, not hidden');
});
