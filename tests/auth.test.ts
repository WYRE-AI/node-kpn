import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import { AuthenticationError, KpnError, KpnTokenProvider, TOKEN_PATHS, TokenCache } from '../src/index.js';
import { gatewayTokenBody, invalidClientBody } from './fixtures/oauth.js';
import { BASE } from './helpers.js';
import { server } from './mocks/server.js';

const TOKEN_URL = `${BASE}${TOKEN_PATHS.gateway}`;

function makeProvider(cache = new TokenCache(), clientSecret = 'secret'): KpnTokenProvider {
  return new KpnTokenProvider({ baseUrl: BASE, tokenPath: TOKEN_PATHS.gateway, clientId: 'id', clientSecret, cache });
}

/** Count mints, optionally answering with a custom body/status. */
function countMints(body: unknown = gatewayTokenBody, status = 200): { count: number } {
  const counter = { count: 0 };
  server.use(
    http.post(TOKEN_URL, () => {
      counter.count += 1;
      return HttpResponse.json(body as never, { status });
    })
  );
  return counter;
}

describe('KpnTokenProvider minting', () => {
  it('POSTs grant_type in the query and a form body with client_id/client_secret (no Basic auth)', async () => {
    let seen: { url: URL; form: URLSearchParams; contentType: string | null; accept: string | null; auth: boolean } | undefined;
    server.use(
      http.post(TOKEN_URL, async ({ request }) => {
        seen = {
          url: new URL(request.url),
          form: new URLSearchParams(await request.text()),
          contentType: request.headers.get('content-type'),
          accept: request.headers.get('accept'),
          auth: request.headers.has('authorization'),
        };
        return HttpResponse.json(gatewayTokenBody);
      })
    );
    expect(await makeProvider().headers()).toEqual({ Authorization: 'Bearer fake-gateway-access-token' });
    expect(seen!.url.searchParams.get('grant_type')).toBe('client_credentials');
    expect(seen!.form.get('client_id')).toBe('id');
    expect(seen!.form.get('client_secret')).toBe('secret');
    expect(seen!.contentType).toBe('application/x-www-form-urlencoded');
    expect(seen!.accept).toBe('application/json');
    expect(seen!.auth).toBe(false);
  });

  it('parses the all-strings Apigee body (expires_in, level, application_name)', async () => {
    const before = Date.now();
    const token = await makeProvider().getToken();
    expect(token.accessToken).toBe('fake-gateway-access-token');
    expect(token.level).toBe('demo');
    expect(token.applicationName).toBe('wyre-test-app');
    expect(token.expiresAt).toBeGreaterThanOrEqual(before + 3_599_000);
  });

  it('accepts a numeric expires_in', async () => {
    countMints({ ...gatewayTokenBody, expires_in: 3599 });
    const token = await makeProvider().getToken();
    expect(token.expiresAt - Date.now()).toBeGreaterThan(3_500_000);
  });

  it('maps token-endpoint 401 {ErrorCode,Error} to AuthenticationError(invalid_client)', async () => {
    countMints(invalidClientBody, 401);
    const err = await makeProvider().getToken().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AuthenticationError);
    expect((err as AuthenticationError).code).toBe('invalid_client');
  });

  it('rejects a 200 without access_token', async () => {
    countMints({ ...gatewayTokenBody, access_token: '' });
    await expect(makeProvider().getToken()).rejects.toBeInstanceOf(KpnError);
  });
});

describe('KpnTokenProvider caching', () => {
  it('reuses a cached token', async () => {
    const mints = countMints();
    const provider = makeProvider();
    await provider.headers();
    await provider.headers();
    expect(mints.count).toBe(1);
  });

  it('shares the cache across providers with the same credentials (process-wide)', async () => {
    const mints = countMints();
    const cache = new TokenCache();
    await makeProvider(cache).headers();
    await makeProvider(cache).headers();
    expect(mints.count).toBe(1);
  });

  it('a rotated secret never reuses a cached token', async () => {
    const mints = countMints();
    const cache = new TokenCache();
    await makeProvider(cache, 'secret-a').headers();
    await makeProvider(cache, 'secret-b').headers();
    expect(mints.count).toBe(2);
  });

  it('re-mints inside the 5-minute safety margin', async () => {
    const mints = countMints({ ...gatewayTokenBody, expires_in: '299' });
    const provider = makeProvider();
    await provider.headers();
    await provider.headers();
    expect(mints.count).toBe(2);
  });

  it('single-flights concurrent mints for the same key', async () => {
    const mints = countMints();
    const cache = new TokenCache();
    await Promise.all(Array.from({ length: 5 }, () => makeProvider(cache).headers()));
    expect(mints.count).toBe(1);
  });

  it('drops a failed in-flight mint so the next call retries', async () => {
    let calls = 0;
    server.use(
      http.post(TOKEN_URL, () => {
        calls += 1;
        return calls === 1
          ? HttpResponse.json({ message: 'boom' }, { status: 500 })
          : HttpResponse.json(gatewayTokenBody);
      })
    );
    const provider = makeProvider();
    await expect(provider.headers()).rejects.toBeInstanceOf(KpnError);
    await expect(provider.headers()).resolves.toEqual({ Authorization: 'Bearer fake-gateway-access-token' });
    expect(calls).toBe(2);
  });

  it('handleUnauthorized evicts the token and returns true', async () => {
    const mints = countMints();
    const provider = makeProvider();
    await provider.headers();
    expect(await provider.handleUnauthorized()).toBe(true);
    await provider.headers();
    expect(mints.count).toBe(2);
  });
});

describe('TokenCache', () => {
  const token = { accessToken: 't', expiresAt: 0 };

  it('evicts the oldest-inserted entry when full', () => {
    const cache = new TokenCache(2);
    cache.set('a', token);
    cache.set('b', token);
    cache.set('c', token);
    expect(cache.get('a')).toBeUndefined();
    expect(cache.get('b')).toBeDefined();
    expect(cache.get('c')).toBeDefined();
    expect(cache.size).toBe(2);
  });

  it('re-setting a key refreshes its position', () => {
    const cache = new TokenCache(2);
    cache.set('a', token);
    cache.set('b', token);
    cache.set('a', token);
    cache.set('c', token);
    expect(cache.get('a')).toBeDefined();
    expect(cache.get('b')).toBeUndefined();
  });

  it('defaults to 500 entries; delete and clear work', () => {
    const cache = new TokenCache();
    for (let i = 0; i < 501; i++) cache.set(String(i), token);
    expect(cache.size).toBe(500);
    expect(cache.get('0')).toBeUndefined();
    cache.delete('1');
    expect(cache.get('1')).toBeUndefined();
    cache.clear();
    expect(cache.size).toBe(0);
  });
});
