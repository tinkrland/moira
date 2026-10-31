// the gap the agent-vault read exposed: moira's own outbound call (directed
// disclosure delivery) had no target guard at all. https was checked and that
// was it, so `https://169.254.169.254/latest/meta-data/` passed - in a cloud
// deployment that is a credential-theft endpoint.
//
// the guard is pure, deterministic, and takes its resolver as an argument, so
// every case below is a fact about the policy rather than about the network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkDestination } from '../src/util/netguard.js';

const resolves = (...addresses) => async () => addresses;
const publicDns = resolves('93.184.216.34');

test('netguard: metadata endpoints are blocked even with every escape hatch open', async () => {
  const v4 = await checkDestination('https://169.254.169.254/latest/meta-data/', {
    resolve: publicDns, allowPrivate: true, allowlist: ['169.254.169.254/32']
  });
  assert.equal(v4.allowed, false);
  assert.equal(v4.reason, 'cloud_metadata_blocked');

  // aws imdsv2 over ipv6
  const v6 = await checkDestination('https://[fd00:ec2::254]/latest/meta-data/', { resolve: publicDns, allowPrivate: true });
  assert.equal(v6.allowed, false);
  assert.equal(v6.reason, 'cloud_metadata_blocked');
});

test('netguard: loopback and private ranges are refused by default', async () => {
  const loop = await checkDestination('https://127.0.0.1:8443/x', { resolve: publicDns });
  assert.equal(loop.allowed, false);
  assert.equal(loop.reason, 'private_address_blocked');

  const priv = await checkDestination('https://internal.example/x', { resolve: resolves('10.4.2.9') });
  assert.equal(priv.allowed, false);
  assert.equal(priv.reason, 'private_address_blocked');

  const cgnat = await checkDestination('https://example.com/x', { resolve: resolves('100.64.1.2') });
  assert.equal(cgnat.allowed, false);
});

test('netguard: public destinations are allowed', async () => {
  const ok = await checkDestination('https://partner.example.com/hook', { resolve: publicDns });
  assert.equal(ok.allowed, true);
  assert.deepEqual(ok.addresses, ['93.184.216.34']);
});

test('netguard: a name resolving to more than one address is blocked if ANY is private (rebinding)', async () => {
  const mixed = await checkDestination('https://sneaky.example/hook', {
    resolve: resolves('93.184.216.34', '192.168.1.10')
  });
  assert.equal(mixed.allowed, false);
  assert.equal(mixed.reason, 'private_address_blocked');
  assert.deepEqual(mixed.blockedAddresses, ['192.168.1.10']);
});

test('netguard: allowPrivate opens private ranges; the allowlist narrows to exact hosts/CIDRs', async () => {
  const open = await checkDestination('https://internal.example/x', { resolve: resolves('10.4.2.9'), allowPrivate: true });
  assert.equal(open.allowed, true);

  const narrowDeny = await checkDestination('https://other.internal/x', { resolve: resolves('10.9.9.9'), allowlist: ['10.4.0.0/16'] });
  assert.equal(narrowDeny.allowed, false);

  const narrowAllow = await checkDestination('https://internal.example/x', { resolve: resolves('10.4.2.9'), allowlist: ['10.4.0.0/16'] });
  assert.equal(narrowAllow.allowed, true);
});

test('netguard: only https, and a name that does not resolve fails closed', async () => {
  const http = await checkDestination('http://partner.example.com/hook', { resolve: publicDns });
  assert.equal(http.allowed, false);
  assert.equal(http.reason, 'not_https');

  const gone = await checkDestination('https://nope.example/hook', { resolve: resolves() });
  assert.equal(gone.allowed, false);
  assert.equal(gone.reason, 'unresolvable');

  const junk = await checkDestination('not a url', { resolve: publicDns });
  assert.equal(junk.allowed, false);
  assert.equal(junk.reason, 'bad_url');
});
