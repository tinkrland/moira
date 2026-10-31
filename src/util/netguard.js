// outbound target policy: one pure function, no dependency, no dial.
//
// why this exists: moira makes outbound calls on the owner's behalf (directed
// disclosure delivery, and any host-injected deliverer). checking `https://`
// was never enough. a public URL that resolves to a private address, or to a
// cloud metadata endpoint, turns our own delivery into a credential-theft
// gadget - the classic SSRF shape, borrowed from agent-vault's netguard.
//
// the rule: resolve, then judge every address the name actually resolves to.
// any blocked address blocks the destination, because a name-to-many-addresses
// record is exactly how DNS rebinding gets through a single-address check.
// cloud metadata stays blocked even when the operator allowlists it: there is
// no legitimate reason for moira to POST a persona's fields to IMDS.
import { promises as dns } from 'node:dns';

export const REASON = {
  BAD_URL: 'bad_url',
  NOT_HTTPS: 'not_https',
  UNRESOLVABLE: 'unresolvable',
  CLOUD_METADATA: 'cloud_metadata_blocked',
  PRIVATE: 'private_address_blocked'
};

// never deliverable, allowlist or not.
const METADATA_V4 = ['169.254.169.254'];
const METADATA_V6 = ['fd00:ec2::254'];

const PRIVATE_V4 = [
  [/^10\./, '10.0.0.0/8'],
  [/^192\.168\./, '192.168.0.0/16'],
  [/^172\.(1[6-9]|2\d|3[01])\./, '172.16.0.0/12'],
  [/^127\./, '127.0.0.0/8'],
  [/^169\.254\./, '169.254.0.0/16'],
  [/^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./, '100.64.0.0/10'],
  [/^0\.0\.0\.0$/, '0.0.0.0/32']
];

const PRIVATE_V6 = [
  [/^::1$/, '::1/128'],
  [/^fe80:/i, 'fe80::/10'],
  [/^fc[0-9a-f]{2}:/i, 'fc00::/7'],
  [/^fd[0-9a-f]{2}:/i, 'fc00::/7'],
  [/^::$/, '::/128']
];

const stripBrackets = (address) => address.replace(/^\[|\]$/g, '');

function isMetadata(address) {
  const a = stripBrackets(address).toLowerCase();
  return METADATA_V4.includes(a) || METADATA_V6.includes(a);
}

function isPrivate(address) {
  const a = stripBrackets(address);
  if (a.includes(':')) return PRIVATE_V6.some(([re]) => re.test(a));
  return PRIVATE_V4.some(([re]) => re.test(a));
}

// "10.4.0.0/16" or a bare address. ipv4 only; an ipv6 allowlist entry must be
// an exact address, which is the honest limit of this parser.
function inAllowlist(address, allowlist) {
  const a = stripBrackets(address);
  for (const entry of allowlist ?? []) {
    const [net, bitsRaw] = String(entry).split('/');
    if (bitsRaw === undefined) {
      if (stripBrackets(net) === a) return true;
      continue;
    }
    const bits = Number(bitsRaw);
    if (!Number.isInteger(bits) || bits < 0 || bits > 32) continue;
    const toInt = (ip) => ip.split('.').reduce((acc, part) => (acc << 8) + Number(part), 0) >>> 0;
    if (!a.includes('.') || !net.includes('.')) continue;
    if (Number.isNaN(toInt(net)) || Number.isNaN(toInt(a))) continue;
    const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
    if ((toInt(a) & mask) === (toInt(net) & mask)) return true;
  }
  return false;
}

/**
 * Judge one outbound destination before it is dialled.
 *
 * @param {string} destination  absolute https url
 * @param {object} [options]
 * @param {Function} [options.resolve]  async (hostname) -> string[] (injectable;
 *   defaults to node's dns.lookup with { all: true }, so the check runs on the
 *   addresses actually returned, not on a second lookup)
 * @param {boolean} [options.allowPrivate=false]
 * @param {string[]} [options.allowlist=[]]
 * @returns {Promise<{allowed:boolean, reason?:string, addresses?:string[], blockedAddresses?:string[]}>}
 */
export async function checkDestination(destination, { resolve, allowPrivate = false, allowlist = [] } = {}) {
  let url;
  try {
    url = new URL(destination);
  } catch {
    return { allowed: false, reason: REASON.BAD_URL };
  }
  if (url.protocol !== 'https:') return { allowed: false, reason: REASON.NOT_HTTPS };

  // an ip literal needs no resolver, and must never be handed to one: a
  // destination of https://169.254.169.254/ is the whole attack, no DNS needed.
  const literal = stripBrackets(url.hostname);
  const isLiteral = /^\d{1,3}(\.\d{1,3}){3}$/.test(literal) || literal.includes(':');
  if (isLiteral) return judge([literal], url);

  let addresses;
  try {
    if (resolve) {
      addresses = await resolve(url.hostname);
    } else {
      const records = await dns.lookup(stripBrackets(url.hostname), { all: true });
      addresses = records.map((r) => r.address);
    }
  } catch {
    addresses = null;
  }
  if (!Array.isArray(addresses) || addresses.length === 0) {
    return { allowed: false, reason: REASON.UNRESOLVABLE };
  }

  return judge(addresses, url);

  function judge(addresses, _url) {
    // metadata first, unconditionally: an allowlist must never reach it.
    const metadata = addresses.filter(isMetadata);
    if (metadata.length > 0) {
      return { allowed: false, reason: REASON.CLOUD_METADATA, addresses, blockedAddresses: metadata };
    }

    const blocked = addresses.filter((a) => {
      if (inAllowlist(a, allowlist)) return false;
      return !allowPrivate && isPrivate(a);
    });
    if (blocked.length > 0) {
      return { allowed: false, reason: REASON.PRIVATE, addresses, blockedAddresses: blocked };
    }

    return { allowed: true, addresses };
  }
}
