import { describe, expect, it } from 'vitest';

import {
  GREXX_ALLOWED_HOSTS,
  GrexxClient,
  GrexxConfigError,
  GrexxTokenCache,
  assertGrexxAllowedUrl,
  assertGrexxHostResolvesPublic,
  guardedConnectLookup,
  isBlockedGrexxAddress,
  resolveGrexxConfig,
  type GrexxLookup,
} from '../src/index.js';
import { BASE_URL, SUCCESS_XML, TOKEN_BODY, installFetch, jsonResponse, xmlResponse } from './grexx-fetch.js';

const PROD_API = 'https://service.grexx.today/interfaces/kpn/kpn_partners/abc123';
const PROD_TOKEN = 'https://service.grexx.today/oauth/access_token';
const ACC_TOKEN = 'https://service-accept.grexx.today/oauth/access_token';
const ENV = { KPN_GREXX_USERNAME: 'env-user', KPN_GREXX_PASSWORD: 'env-secret', KPN_GREXX_BASE_URL: BASE_URL };
const CREDS = { 'X-KPN-Grexx-Username': 'tenant-user', 'X-KPN-Grexx-Password': 'tenant-secret' };
const ZIP = { portfolio: 'All' as const, zipCode: '1012JS', houseNumber: 1, isRoomNumberKnown: false };

const publicLookup: GrexxLookup = async () => [{ address: '203.0.114.10', family: 4 }];
const lookupTo =
  (...addresses: string[]): GrexxLookup =>
  async () =>
    addresses.map((address) => ({ address, family: address.includes(':') ? 6 : 4 }));

describe('GREXX_ALLOWED_HOSTS', () => {
  it('is exactly the production and acceptatie API hosts', () => {
    expect(GREXX_ALLOWED_HOSTS).toEqual(['service.grexx.today', 'service-accept.grexx.today']);
    expect(Object.isFrozen(GREXX_ALLOWED_HOSTS)).toBe(true);
  });
});

describe('assertGrexxAllowedUrl', () => {
  it('accepts the production and acceptatie shapes', () => {
    expect(assertGrexxAllowedUrl(PROD_API, 'api', 'api').hostname).toBe('service.grexx.today');
    expect(assertGrexxAllowedUrl(`${PROD_API}/`, 'api', 'api').pathname).toBe('/interfaces/kpn/kpn_partners/abc123/');
    expect(assertGrexxAllowedUrl(PROD_TOKEN, 'token', 'token').pathname).toBe('/oauth/access_token');
    expect(assertGrexxAllowedUrl(ACC_TOKEN, 'token', 'token').hostname).toBe('service-accept.grexx.today');
    expect(assertGrexxAllowedUrl('https://SERVICE.grexx.today.:443/oauth/access_token', 't', 'token').port).toBe('');
  });

  it.each([
    ['http scheme', 'http://service.grexx.today/oauth/access_token', /https/],
    ['userinfo', 'https://u:p@service.grexx.today/oauth/access_token', /credentials/],
    ['user only', 'https://u@service.grexx.today/oauth/access_token', /credentials/],
    ['port 8443', 'https://service.grexx.today:8443/oauth/access_token', /port 443/],
    ['fragment', 'https://service.grexx.today/oauth/access_token#x', /fragment/],
    ['query', 'https://service.grexx.today/oauth/access_token?a=1', /query/],
    ['other grexx.today portal', 'https://routit.grexx.today/oauth/access_token', /allowed Grexx host/],
    ['subdomain of allowed', 'https://evil.service.grexx.today/oauth/access_token', /allowed Grexx host/],
    ['suffix confusion', 'https://service.grexx.today.evil.example/oauth/access_token', /allowed Grexx host/],
    ['bare domain', 'https://grexx.today/oauth/access_token', /allowed Grexx host/],
    ['ip literal', 'https://203.0.114.10/oauth/access_token', /allowed Grexx host/],
    ['ipv6 literal', 'https://[::1]/oauth/access_token', /allowed Grexx host/],
    ['wrong token path', 'https://service.grexx.today/oauth/access_token/x', /exactly \/oauth\/access_token/],
    ['token path trailing slash', 'https://service.grexx.today/oauth/access_token/', /exactly/],
    ['encoded traversal', 'https://service.grexx.today/oauth/%2e%2e/access_token', /path must be exactly/],
    ['encoded slash', 'https://service.grexx.today/oauth%2faccess_token', /encoded/],
    ['not a url', 'service.grexx.today/oauth/access_token', /absolute URL/],
  ])('rejects %s for the token URL', (_name, url, pattern) => {
    expect(() => assertGrexxAllowedUrl(url, 'X-Grexx-Token-Url', 'token')).toThrow(pattern);
  });

  it.each([
    ['token path as api', PROD_TOKEN],
    ['non-kpn interface', 'https://service.grexx.today/interfaces/routit/abc'],
    ['bare prefix', 'https://service.grexx.today/interfaces/kpn/'],
    ['prefix without slash', 'https://service.grexx.today/interfaces/kpnx/abc'],
    ['traversal out of prefix', 'https://service.grexx.today/interfaces/kpn/../../oauth/access_token'],
    ['encoded slash', 'https://service.grexx.today/interfaces/kpn/a%2f..%2f..%2foauth'],
    ['double slash', 'https://service.grexx.today/interfaces/kpn//abc'],
  ])('rejects %s for the API URL', (_name, url) => {
    expect(() => assertGrexxAllowedUrl(url, 'X-Grexx-Api-Url', 'api')).toThrow(GrexxConfigError);
  });

  it('never echoes the rejected URL', () => {
    try {
      assertGrexxAllowedUrl('https://u:hunter2@evil.example/x', 'X-Grexx-Token-Url', 'token');
      expect.unreachable();
    } catch (err) {
      expect((err as Error).message).not.toContain('hunter2');
      expect((err as Error).message).not.toContain('evil.example');
    }
  });
});

describe('isBlockedGrexxAddress', () => {
  it.each([
    '127.0.0.1', '127.255.255.254', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.1',
    '169.254.169.254', '169.254.0.1', '100.64.0.1', '0.0.0.0', '224.0.0.1', '255.255.255.255',
    '198.18.0.1', '198.19.255.255', '192.0.2.1', '168.63.129.16',
    '::', '::1', 'fe80::1', 'fe80::1%eth0', 'fc00::1', 'fd00:ec2::254', 'ff02::1',
    '::ffff:127.0.0.1', '::ffff:7f00:1', '::ffff:169.254.169.254', '::127.0.0.1', '64:ff9b::a9fe:a9fe',
    '2002:7f00:1::', '2001:db8::1', 'not-an-ip', '',
  ])('blocks %s', (ip) => {
    expect(isBlockedGrexxAddress(ip)).toBe(true);
  });

  it.each(['203.0.114.10', '8.8.8.8', '172.32.0.1', '100.128.0.1', '2a00:1450:4001:80b::200e', '::ffff:8.8.8.8'])(
    'allows public %s',
    (ip) => {
      expect(isBlockedGrexxAddress(ip)).toBe(false);
    },
  );
});

describe('assertGrexxHostResolvesPublic (mocked resolver)', () => {
  it('passes a public answer', async () => {
    await expect(assertGrexxHostResolvesPublic('service.grexx.today', 'api', publicLookup)).resolves.toBeUndefined();
  });

  it('blocks when any answer is internal, and on resolver failure or empty answers', async () => {
    await expect(
      assertGrexxHostResolvesPublic('service.grexx.today', 'api', lookupTo('203.0.114.10', '10.0.0.5')),
    ).rejects.toThrow(/private, internal, or reserved/);
    await expect(
      assertGrexxHostResolvesPublic('service.grexx.today', 'api', lookupTo('169.254.169.254')),
    ).rejects.toThrow(GrexxConfigError);
    await expect(assertGrexxHostResolvesPublic('service.grexx.today', 'api', lookupTo())).rejects.toThrow(
      /could not be resolved/,
    );
    await expect(
      assertGrexxHostResolvesPublic('service.grexx.today', 'api', async () => {
        throw new Error('ENOTFOUND');
      }),
    ).rejects.toThrow(/could not be resolved/);
  });

  it('re-checks at socket connect time (rebinding)', async () => {
    const lookup = guardedConnectLookup(lookupTo('127.0.0.1'));
    const err = await new Promise<NodeJS.ErrnoException | null>((resolve) =>
      lookup('service.grexx.today', { all: true }, (e) => resolve(e)),
    );
    expect(err?.code).toBe('EGREXXBLOCKED');
    const ok = await new Promise<unknown>((resolve) =>
      guardedConnectLookup(publicLookup)('service.grexx.today', { all: true }, (_e, addrs) => resolve(addrs)),
    );
    expect(ok).toEqual([{ address: '203.0.114.10', family: 4 }]);
    const single = await new Promise<unknown[]>((resolve) =>
      guardedConnectLookup(publicLookup)('service.grexx.today', {}, (_e, addr, family) => resolve([addr, family])),
    );
    expect(single).toEqual(['203.0.114.10', 4]);
  });
});

describe('resolveGrexxConfig with X-Grexx-Api-Url / X-Grexx-Token-Url', () => {
  it('uses both headers and turns the SSRF guard on', () => {
    const config = resolveGrexxConfig({
      env: ENV,
      headers: { ...CREDS, 'X-Grexx-Api-Url': PROD_API, 'X-Grexx-Token-Url': PROD_TOKEN },
      lookup: publicLookup,
    });
    expect(config).toMatchObject({
      username: 'tenant-user',
      baseUrl: PROD_API,
      tokenUrl: PROD_TOKEN,
      ssrfGuard: true,
    });
  });

  it('falls back to the environment when both are absent or empty', () => {
    for (const extra of [{}, { 'X-Grexx-Api-Url': '', 'X-Grexx-Token-Url': '  ' }]) {
      const config = resolveGrexxConfig({ env: ENV, headers: { ...CREDS, ...extra } });
      expect(config.baseUrl).toBe(BASE_URL);
      expect(config.tokenUrl).toBe(ACC_TOKEN);
      expect(config.ssrfGuard).toBeUndefined();
    }
  });

  it('does not require KPN_GREXX_BASE_URL when the headers carry the URLs', () => {
    const { KPN_GREXX_BASE_URL: _drop, ...envNoBase } = ENV;
    expect(
      resolveGrexxConfig({
        env: envNoBase,
        headers: { ...CREDS, 'X-Grexx-Api-Url': PROD_API, 'X-Grexx-Token-Url': PROD_TOKEN },
      }).baseUrl,
    ).toBe(PROD_API);
  });

  it('rejects exactly one URL header (no prod API with an acceptatie token)', () => {
    expect(() => resolveGrexxConfig({ env: ENV, headers: { ...CREDS, 'X-Grexx-Api-Url': PROD_API } })).toThrow(
      /provided together/,
    );
    expect(() =>
      resolveGrexxConfig({ env: ENV, headers: { ...CREDS, 'X-Grexx-Api-Url': '', 'X-Grexx-Token-Url': PROD_TOKEN } }),
    ).toThrow(/provided together/);
  });

  it('refuses URL headers without the credential headers (env secret never leaves for a header host)', () => {
    expect(() =>
      resolveGrexxConfig({ env: ENV, headers: { 'X-Grexx-Api-Url': PROD_API, 'X-Grexx-Token-Url': PROD_TOKEN } }),
    ).toThrow(/require X-KPN-Grexx-Username/);
  });

  it('validates each header', () => {
    expect(() =>
      resolveGrexxConfig({
        env: ENV,
        headers: { ...CREDS, 'X-Grexx-Api-Url': PROD_API, 'X-Grexx-Token-Url': 'https://evil.example/oauth/access_token' },
      }),
    ).toThrow(/X-Grexx-Token-Url host is not an allowed Grexx host/);
    expect(() =>
      resolveGrexxConfig({
        env: ENV,
        headers: { ...CREDS, 'X-Grexx-Api-Url': 'http://service.grexx.today/interfaces/kpn/a', 'X-Grexx-Token-Url': PROD_TOKEN },
      }),
    ).toThrow(/X-Grexx-Api-Url must use https/);
  });
});

describe('GrexxClient with per-connection URLs', () => {
  function client(lookup: GrexxLookup) {
    const config = resolveGrexxConfig({
      env: ENV,
      headers: { ...CREDS, 'X-Grexx-Api-Url': PROD_API, 'X-Grexx-Token-Url': PROD_TOKEN },
      lookup,
    });
    return new GrexxClient({ ...config, tokenCache: new GrexxTokenCache(), maxRetries: 0 });
  }

  it('mints at the header token URL and posts to the header API URL with redirects refused', async () => {
    const calls = installFetch((call) => (call.url === PROD_TOKEN ? jsonResponse(TOKEN_BODY) : xmlResponse(SUCCESS_XML)));
    await client(publicLookup).zipCodeCheck(ZIP);
    expect(calls.map((c) => c.url)).toEqual([PROD_TOKEN, `${PROD_API}/realtime`]);
    expect(calls.every((c) => c.redirect === 'error')).toBe(true);
  });

  it('sends nothing when the token host resolves internal', async () => {
    const calls = installFetch(() => jsonResponse(TOKEN_BODY));
    await expect(client(lookupTo('10.0.0.7')).zipCodeCheck(ZIP)).rejects.toThrow(GrexxConfigError);
    expect(calls).toHaveLength(0);
  });

  it('does not post /realtime when the API host turns internal after the mint', async () => {
    let n = 0;
    const flipping: GrexxLookup = async () => [{ address: n++ === 0 ? '203.0.114.10' : '127.0.0.1', family: 4 }];
    const calls = installFetch(() => jsonResponse(TOKEN_BODY));
    await expect(client(flipping).zipCodeCheck(ZIP)).rejects.toThrow(/private, internal, or reserved/);
    expect(calls.map((c) => c.url)).toEqual([PROD_TOKEN]);
  });

  it('applies the allowlist when ssrfGuard is set on a hand-built config', () => {
    expect(
      () =>
        new GrexxClient({
          username: 'u',
          password: 'p',
          baseUrl: 'https://service.grexx.today/interfaces/kpn/a',
          tokenUrl: 'https://auth.grexx.test/oauth/access_token',
          ssrfGuard: true,
        }),
    ).toThrow(/tokenUrl host is not an allowed Grexx host/);
  });

  it('leaves environment URLs unguarded (operator-set, box smoke unaffected)', async () => {
    let lookups = 0;
    const counting: GrexxLookup = async () => {
      lookups += 1;
      return [{ address: '198.18.0.1', family: 4 }];
    };
    const calls = installFetch((call) => (call.url.endsWith('/oauth/access_token') ? jsonResponse(TOKEN_BODY) : xmlResponse(SUCCESS_XML)));
    const config = resolveGrexxConfig({ env: ENV, headers: CREDS, lookup: counting });
    await new GrexxClient({ ...config, tokenCache: new GrexxTokenCache() }).zipCodeCheck(ZIP);
    expect(lookups).toBe(0);
    expect(calls).toHaveLength(2);
  });
});
