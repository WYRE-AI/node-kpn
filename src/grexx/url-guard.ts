import dns from 'node:dns';
import net from 'node:net';

import { Agent, fetch as undiciFetch } from 'undici';

import { GrexxConfigError } from './errors.js';

/**
 * Exact Grexx API hostnames a per-connection API or token URL may point at.
 * No wildcard: other Grexx customers' portals live on `*.grexx.today`.
 * `service-accept.grexx.today` is acceptatie (confirmed); `service.grexx.today`
 * is production (inferred, not yet confirmed from a production portal).
 * Add a host here to allow it.
 */
export const GREXX_ALLOWED_HOSTS: readonly string[] = Object.freeze([
  'service.grexx.today',
  'service-accept.grexx.today',
]);

/** Token URL path, exactly. */
export const GREXX_TOKEN_PATH = '/oauth/access_token';
/** API (interface root) path prefix. */
export const GREXX_API_PATH_PREFIX = '/interfaces/kpn/';

/** Per-connection API URL header (interface root, without `/realtime`). */
export const GREXX_API_URL_HEADER = 'x-grexx-api-url';
/** Per-connection OAuth token endpoint header. */
export const GREXX_TOKEN_URL_HEADER = 'x-grexx-token-url';

export type GrexxLookupAddress = { address: string; family: number };
/** Resolve every A/AAAA record for a hostname. Overridable for tests. */
export type GrexxLookup = (hostname: string) => Promise<GrexxLookupAddress[]>;

export const defaultGrexxLookup: GrexxLookup = (hostname) =>
  dns.promises.lookup(hostname, { all: true, verbatim: true });

function normalizeHost(hostname: string): string {
  let host = hostname.toLowerCase();
  if (host.endsWith('.')) host = host.slice(0, -1);
  return host;
}

/** True when `hostname` exactly equals one of {@link GREXX_ALLOWED_HOSTS} (case-insensitive). */
export function isGrexxAllowedHost(hostname: string, hosts: readonly string[] = GREXX_ALLOWED_HOSTS): boolean {
  const host = normalizeHost(hostname);
  if (host === '') return false;
  return hosts.some((entry) => normalizeHost(entry) === host);
}

/** Which per-connection URL is being checked: the interface root or the OAuth token endpoint. */
export type GrexxUrlKind = 'api' | 'token';

/**
 * Synchronous checks for a per-connection Grexx URL: absolute, `https:`,
 * no userinfo, no fragment, no query, port 443 only, host exactly on
 * {@link GREXX_ALLOWED_HOSTS}, and the path rule for its kind (token:
 * exactly `/oauth/access_token`; api: starts with `/interfaces/kpn/`).
 * Errors never echo the URL.
 */
export function assertGrexxAllowedUrl(value: string, label: string, kind: GrexxUrlKind): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new GrexxConfigError(`${label} must be an absolute URL.`);
  }
  if (url.protocol !== 'https:') throw new GrexxConfigError(`${label} must use https.`);
  if (url.username !== '' || url.password !== '') {
    throw new GrexxConfigError(`${label} must not include URL credentials.`);
  }
  if (url.hash !== '' || value.includes('#')) throw new GrexxConfigError(`${label} must not include a fragment.`);
  if (url.search !== '' || value.includes('?')) throw new GrexxConfigError(`${label} must not include a query string.`);
  // WHATWG URL drops the default port, so `:443` reads as ''. Anything else is explicit.
  if (url.port !== '' && url.port !== '443') throw new GrexxConfigError(`${label} must use port 443.`);
  if (!isGrexxAllowedHost(url.hostname)) {
    throw new GrexxConfigError(`${label} host is not an allowed Grexx host (allowed: ${GREXX_ALLOWED_HOSTS.join(', ')}).`);
  }
  const path = url.pathname;
  if (/%(2e|2f|5c)/i.test(path) || path.includes('\\') || path.includes('//')) {
    throw new GrexxConfigError(`${label} path must not contain encoded separators or empty segments.`);
  }
  if (kind === 'token' && path !== GREXX_TOKEN_PATH) {
    throw new GrexxConfigError(`${label} path must be exactly ${GREXX_TOKEN_PATH}.`);
  }
  if (kind === 'api' && (!path.startsWith(GREXX_API_PATH_PREFIX) || path.length <= GREXX_API_PATH_PREFIX.length)) {
    throw new GrexxConfigError(`${label} path must start with ${GREXX_API_PATH_PREFIX}.`);
  }
  return url;
}

function ipv4ToInt(ip: string): number {
  return ip.split('.').reduce((acc, octet) => (acc << 8) + Number(octet), 0) >>> 0;
}

const BLOCKED_V4: Array<[string, number]> = [
  ['0.0.0.0', 8], // "this" network / unspecified
  ['10.0.0.0', 8], // private
  ['100.64.0.0', 10], // CGNAT
  ['127.0.0.0', 8], // loopback
  ['169.254.0.0', 16], // link-local, incl. 169.254.169.254 metadata
  ['172.16.0.0', 12], // private
  ['192.0.0.0', 24], // IETF protocol assignments
  ['192.0.2.0', 24], // TEST-NET-1
  ['192.88.99.0', 24], // 6to4 relay
  ['192.168.0.0', 16], // private
  ['198.18.0.0', 15], // benchmarking
  ['198.51.100.0', 24], // TEST-NET-2
  ['203.0.113.0', 24], // TEST-NET-3
  ['224.0.0.0', 4], // multicast
  ['240.0.0.0', 4], // reserved + broadcast
  ['168.63.129.16', 32], // Azure wireserver / IMDS host
];

function v4Blocked(ip: string): boolean {
  const n = ipv4ToInt(ip);
  return BLOCKED_V4.some(([base, bits]) => {
    const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
    return (n & mask) === (ipv4ToInt(base) & mask);
  });
}

function expandV6(ip: string): number[] | undefined {
  let addr = ip.toLowerCase().replace(/%.*$/, '');
  const lastColon = addr.lastIndexOf(':');
  const maybeV4 = addr.slice(lastColon + 1);
  if (net.isIPv4(maybeV4)) {
    const n = ipv4ToInt(maybeV4);
    addr = `${addr.slice(0, lastColon + 1)}${((n >>> 16) & 0xffff).toString(16)}:${(n & 0xffff).toString(16)}`;
  }
  const halves = addr.split('::');
  if (halves.length > 2) return undefined;
  const parse = (part: string | undefined): number[] =>
    part === undefined || part === '' ? [] : part.split(':').map((h) => (/^[0-9a-f]{1,4}$/.test(h) ? parseInt(h, 16) : NaN));
  const left = parse(halves[0]);
  const right = parse(halves[1]);
  let groups: number[];
  if (halves.length === 1) {
    groups = left;
  } else {
    const fill = 8 - left.length - right.length;
    if (fill < 1) return undefined;
    groups = [...left, ...Array<number>(fill).fill(0), ...right];
  }
  if (groups.length !== 8 || groups.some((g) => Number.isNaN(g))) return undefined;
  return groups;
}

function v6Blocked(ip: string): boolean {
  const g = expandV6(ip);
  if (!g) return true; // unparseable: fail closed
  const embeddedV4 = `${g[6]! >>> 8}.${g[6]! & 0xff}.${g[7]! >>> 8}.${g[7]! & 0xff}`;
  if (g.every((x) => x === 0)) return true; // ::
  if (g.slice(0, 7).every((x) => x === 0) && g[7] === 1) return true; // ::1
  // IPv4-mapped ::ffff:a.b.c.d and IPv4-compatible ::a.b.c.d
  if (g.slice(0, 5).every((x) => x === 0) && (g[5] === 0xffff || g[5] === 0)) return v4Blocked(embeddedV4);
  // NAT64 64:ff9b::/96
  if (g[0] === 0x64 && g[1] === 0xff9b && g.slice(2, 6).every((x) => x === 0)) return v4Blocked(embeddedV4);
  const first = g[0]!;
  if ((first & 0xfe00) === 0xfc00) return true; // fc00::/7 ULA (incl. fd00:ec2::254)
  if ((first & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  if ((first & 0xffc0) === 0xfec0) return true; // fec0::/10 site-local (deprecated)
  if ((first & 0xff00) === 0xff00) return true; // ff00::/8 multicast
  if (first === 0x2001 && g[1] === 0x0db8) return true; // documentation
  if (first === 0x0100 && g.slice(1, 4).every((x) => x === 0)) return true; // discard-only 100::/64
  if (first === 0x2002) return v4Blocked(`${g[1]! >>> 8}.${g[1]! & 0xff}.${g[2]! >>> 8}.${g[2]! & 0xff}`); // 6to4
  return false;
}

/**
 * True for loopback, private, link-local, CGNAT, unspecified, multicast,
 * reserved, documentation, benchmark, ULA, metadata, and IPv4-in-IPv6 forms of
 * those. Anything that is not a valid IP is treated as blocked.
 */
export function isBlockedGrexxAddress(address: string): boolean {
  const kind = net.isIP(address.replace(/%.*$/, ''));
  if (kind === 4) return v4Blocked(address);
  if (kind === 6) return v6Blocked(address);
  return true;
}

/**
 * Resolve `hostname` and fail closed when it has no addresses or any of them is
 * blocked (a mixed answer is a rebinding/split-horizon signal, not a fallback).
 */
export async function assertGrexxHostResolvesPublic(
  hostname: string,
  label: string,
  lookup: GrexxLookup = defaultGrexxLookup,
): Promise<void> {
  let addresses: GrexxLookupAddress[];
  try {
    addresses = await lookup(hostname);
  } catch (err) {
    // The resolver error goes on `cause`; the message never names the host.
    throw new GrexxConfigError(`${label} host could not be resolved.`, { cause: err });
  }
  if (addresses.length === 0) throw new GrexxConfigError(`${label} host could not be resolved.`);
  if (addresses.some((a) => isBlockedGrexxAddress(a.address))) {
    throw new GrexxConfigError(`${label} host resolves to a private, internal, or reserved address.`);
  }
}

type ConnectLookupCallback = (
  err: NodeJS.ErrnoException | null,
  address: string | GrexxLookupAddress[],
  family?: number,
) => void;

/**
 * `net.connect` lookup that re-applies the address guard at connect time, so a
 * DNS answer that changes between the pre-check and the socket (rebinding)
 * still cannot reach an internal address.
 */
export function guardedConnectLookup(lookup: GrexxLookup = defaultGrexxLookup) {
  return (hostname: string, options: { all?: boolean } | number | undefined, callback: ConnectLookupCallback): void => {
    lookup(hostname).then(
      (addresses) => {
        if (addresses.length === 0 || addresses.some((a) => isBlockedGrexxAddress(a.address))) {
          const err = new Error('Grexx host resolves to a blocked address') as NodeJS.ErrnoException;
          err.code = 'EGREXXBLOCKED';
          callback(err, '', 0);
          return;
        }
        if (typeof options === 'object' && options?.all) callback(null, addresses);
        else callback(null, addresses[0]!.address, addresses[0]!.family);
      },
      (err: NodeJS.ErrnoException) => callback(err, '', 0),
    );
  };
}

const agents = new WeakMap<GrexxLookup, Agent>();

/** Shared undici dispatcher whose sockets only connect to public addresses. */
export function guardedGrexxDispatcher(lookup: GrexxLookup = defaultGrexxLookup): Agent {
  let agent = agents.get(lookup);
  if (!agent) {
    agent = new Agent({ connect: { lookup: guardedConnectLookup(lookup) as never } });
    agents.set(lookup, agent);
  }
  return agent;
}

function stripRealtime(endpoint: string): string {
  return endpoint.replace(/\/realtime$/, '');
}

/** Fetch signature used on the guarded path. */
export type GrexxFetch = (url: string, init: RequestInit & { dispatcher?: Agent }) => Promise<Response>;

/**
 * undici's own `fetch`. Node's global `fetch` is a bundled undici whose version
 * need not match the `Agent` from the `undici` package, so the guarded
 * dispatcher is only ever handed to the fetch from the same package.
 */
export const undiciGrexxFetch: GrexxFetch = (url, init) =>
  undiciFetch(url, init as Parameters<typeof undiciFetch>[1]) as unknown as Promise<Response>;

/** Fetch bound to the guarded dispatcher: every socket passes the connect-time DNS check. */
export function guardedGrexxFetch(
  lookup: GrexxLookup = defaultGrexxLookup,
  baseFetch: GrexxFetch = undiciGrexxFetch,
): GrexxFetch {
  const dispatcher = guardedGrexxDispatcher(lookup);
  return (url, init) => baseFetch(url, { ...init, dispatcher });
}

export interface GrexxUrlGuardOptions {
  /** DNS override for tests. */
  lookup?: GrexxLookup;
  /**
   * @internal Test seam. Receives the request with the guarded `dispatcher` in
   * its init. Defaults to undici's own `fetch` ({@link undiciGrexxFetch}).
   */
  fetch?: GrexxFetch;
}

export interface GrexxRequestGuard {
  /** The guarded dispatcher (connect-time DNS recheck). */
  dispatcher: Agent;
  /** Fetch to use for this request: undici `fetch` bound to {@link dispatcher}. */
  fetch: GrexxFetch;
}

/**
 * Full check before a request to a caller-supplied URL: the sync rules, then
 * DNS. Returns the fetch to use (undici `fetch` with the guarded dispatcher).
 */
export async function guardGrexxRequest(
  value: string,
  label: string,
  kind: GrexxUrlKind | 'realtime',
  options: GrexxUrlGuardOptions = {},
): Promise<GrexxRequestGuard> {
  const url =
    kind === 'realtime' ? assertGrexxAllowedUrl(stripRealtime(value), label, 'api') : assertGrexxAllowedUrl(value, label, kind);
  const lookup = options.lookup ?? defaultGrexxLookup;
  await assertGrexxHostResolvesPublic(url.hostname, label, lookup);
  const dispatcher = guardedGrexxDispatcher(lookup);
  const baseFetch = options.fetch ?? undiciGrexxFetch;
  return { dispatcher, fetch: (url, init) => baseFetch(url, { ...init, dispatcher }) };
}
