import { describe, expect, it } from 'vitest';

import {
  GREXX_EXPIRY_MARGIN_MS,
  GREXX_TOKEN_SCOPE,
  GrexxAuthenticationError,
  GrexxConfigError,
  GrexxServerError,
  GrexxTokenCache,
  GrexxTokenProvider,
} from '../src/index.js';
import { TOKEN_BODY, TOKEN_URL, installFetch, jsonResponse } from './grexx-fetch.js';

function provider(overrides: Partial<ConstructorParameters<typeof GrexxTokenProvider>[0]> = {}): GrexxTokenProvider {
  return new GrexxTokenProvider({
    tokenUrl: TOKEN_URL,
    clientId: 'test-user',
    clientSecret: 'test-secret',
    cache: new GrexxTokenCache(),
    ...overrides,
  });
}

function decodedBasic(header: string | null): { clientId: string; clientSecret: string; raw: string } {
  expect(header).toMatch(/^Basic [A-Za-z0-9+/]+=*$/);
  const raw = Buffer.from(header!.slice('Basic '.length), 'base64').toString('utf8');
  const colon = raw.indexOf(':');
  expect(colon).toBeGreaterThan(0);
  return {
    raw,
    clientId: decodeURIComponent(raw.slice(0, colon).replace(/\+/g, '%20')),
    clientSecret: decodeURIComponent(raw.slice(colon + 1).replace(/\+/g, '%20')),
  };
}

describe('Grexx OAuth client_credentials', () => {
  it('sends HTTP Basic first with grant_type=client_credentials and scope=all', async () => {
    const calls = installFetch(() => jsonResponse(TOKEN_BODY));
    const header = await provider({ clientId: "id !*'():", clientSecret: 'sec&ret=1 +' }).authorizationHeader();
    expect(header).toBe('Bearer test-access-token');
    expect(calls).toHaveLength(1);
    const call = calls[0]!;
    expect(call.method).toBe('POST');
    expect(call.url).toBe(TOKEN_URL);
    expect(call.headers.get('content-type')).toBe('application/x-www-form-urlencoded');
    expect(call.redirect).toBe('error');
    const basic = decodedBasic(call.headers.get('authorization'));
    expect(basic.clientId).toBe("id !*'():");
    expect(basic.clientSecret).toBe('sec&ret=1 +');
    expect(basic.raw).toBe("id+%21%2A%27%28%29%3A:sec%26ret%3D1+%2B");
    expect(basic.raw).not.toContain('%20');
    expect(basic.raw).toContain('+');
    const form = new URLSearchParams(call.body);
    expect(form.get('grant_type')).toBe('client_credentials');
    expect(form.get('scope')).toBe(GREXX_TOKEN_SCOPE);
    expect(form.get('client_id')).toBeNull();
    expect(form.get('client_secret')).toBeNull();
    expect(call.body).not.toContain('sec&ret');
    expect(call.body).not.toContain('test-secret');
  });

  it('falls back to form-body client credentials after Basic returns 401 invalid_client', async () => {
    let attempts = 0;
    const calls = installFetch(() => {
      attempts += 1;
      if (attempts === 1) {
        return jsonResponse({ error: 'invalid_client', error_description: 'client is invalid' }, 401);
      }
      return jsonResponse(TOKEN_BODY);
    });
    const token = await provider({ clientSecret: 'sec&ret=1' }).getToken();
    expect(token.accessToken).toBe('test-access-token');
    expect(calls).toHaveLength(2);

    const basic = calls[0]!;
    expect(basic.headers.get('authorization')).toMatch(/^Basic /);
    expect(new URLSearchParams(basic.body).get('client_secret')).toBeNull();
    expect(new URLSearchParams(basic.body).get('grant_type')).toBe('client_credentials');
    expect(new URLSearchParams(basic.body).get('scope')).toBe('all');

    const formCall = calls[1]!;
    expect(formCall.headers.get('authorization')).toBeNull();
    const form = new URLSearchParams(formCall.body);
    expect(form.get('grant_type')).toBe('client_credentials');
    expect(form.get('client_id')).toBe('test-user');
    expect(form.get('client_secret')).toBe('sec&ret=1');
    expect(form.get('scope')).toBe(GREXX_TOKEN_SCOPE);
    expect(formCall.body).toContain('client_secret=sec%26ret%3D1');
  });

  it('fails with a clear error when Basic and form-body credentials are both rejected', async () => {
    const calls = installFetch((call) => {
      if (call.headers.get('authorization')?.startsWith('Basic ')) {
        return new Response('Invalid client: client is invalid', { status: 400 });
      }
      return jsonResponse({ error: 'invalid_client', error_description: 'client is invalid' }, 401);
    });
    const err = await provider().getToken().catch((error: unknown) => error);
    expect(calls).toHaveLength(2);
    expect(err).toBeInstanceOf(GrexxAuthenticationError);
    const authError = err as GrexxAuthenticationError;
    expect(authError.code).toBe('invalid_client');
    expect(authError.statusCode).toBe(401);
    expect(authError.message).toContain('HTTP Basic');
    expect(authError.message).toContain('form-body');
    expect(authError.message).toContain('client is invalid');
    expect(authError.message).toContain('Refusing to call /realtime');
    expect(authError.message).toContain('rejected');
    expect(authError.message).not.toContain('test-secret');
    expect(JSON.stringify(authError)).not.toContain('test-secret');
  });

  it('reports a form-body 5xx as unavailable and keeps the redacted vendor reason', async () => {
    const calls = installFetch((call) => {
      if (call.headers.get('authorization')?.startsWith('Basic ')) {
        return jsonResponse({ error: 'invalid_client' }, 401);
      }
      return jsonResponse({ error: 'server_error', error_description: 'upstream exploded with test-secret' }, 503);
    });
    const err = await provider().getToken().catch((error: unknown) => error);
    expect(calls).toHaveLength(2);
    expect(err).toBeInstanceOf(GrexxServerError);
    const serverError = err as GrexxServerError;
    expect(serverError.statusCode).toBe(503);
    expect(serverError.code).toBe('server_error');
    expect(serverError.message).toMatch(/unavailable/i);
    expect(serverError.message).toContain('upstream exploded with [redacted]');
    expect(serverError.message).toContain('form-body');
    expect(serverError.message).not.toMatch(/rejected/i);
    expect(JSON.stringify(serverError)).not.toContain('test-secret');
  });

  it('redacts 1-3 character secrets and does not rewrite an empty secret', async () => {
    installFetch(() =>
      jsonResponse({ error: 'invalid_client', error_description: 'echo p@s in the body' }, 400),
    );
    const short = await provider({ clientSecret: 'p@s' }).getToken().catch((error: unknown) => error);
    expect(short).toBeInstanceOf(GrexxAuthenticationError);
    expect((short as GrexxAuthenticationError).message).toContain('echo [redacted] in the body');
    expect((short as GrexxAuthenticationError).message).not.toContain('p@s');
    expect(JSON.stringify(short)).not.toContain('p@s');

    installFetch(() => jsonResponse({ error: 'invalid_client', error_description: 'client is invalid' }, 401));
    const empty = await provider({ clientId: 'test-user', clientSecret: '' }).getToken().catch((error: unknown) => error);
    expect(empty).toBeInstanceOf(GrexxAuthenticationError);
    expect((empty as GrexxAuthenticationError).message).toContain('client is invalid');
    expect((empty as GrexxAuthenticationError).message).not.toContain('[redacted]');
  });

  it('rejects a non-HTTPS token URL before sending the Basic header', async () => {
    const calls = installFetch(() => jsonResponse(TOKEN_BODY));
    const cleartext = await provider({ tokenUrl: 'http://token.example/oauth/access_token' })
      .getToken()
      .catch((error: unknown) => error);
    expect(cleartext).toBeInstanceOf(GrexxConfigError);
    expect((cleartext as Error).message).toMatch(/https/);
    expect((cleartext as Error).message).not.toContain('test-secret');

    const localhost = await provider({ tokenUrl: 'http://localhost/oauth/access_token' })
      .getToken()
      .catch((error: unknown) => error);
    expect(localhost).toBeInstanceOf(GrexxConfigError);
    expect(calls).toHaveLength(0);
  });

  it('does not fall back when Basic fails with something other than invalid_client', async () => {
    const calls = installFetch(() => jsonResponse({ error: 'invalid_token' }, 401));
    const err = await provider().getToken().catch((error: unknown) => error);
    expect(calls).toHaveLength(1);
    expect(err).toBeInstanceOf(GrexxAuthenticationError);
    expect((err as GrexxAuthenticationError).message).not.toContain('form-body');
  });

  it('accepts numeric and string expires_in', async () => {
    let now = 1_700_000_000_000;
    installFetch(() => jsonResponse({ ...TOKEN_BODY, expires_in: 3599 }));
    const numeric = await provider({ now: () => now }).getToken();
    expect(numeric.expiresAt).toBe(now + 3599 * 1000);
    expect(numeric.tokenType).toBe('Bearer');

    installFetch(() => jsonResponse({ ...TOKEN_BODY, expires_in: '3599' }));
    const text = await provider({ now: () => now, cache: new GrexxTokenCache() }).getToken();
    expect(text.expiresAt).toBe(now + 3599 * 1000);
  });

  it('reuses a cached token until 60 seconds before expiry', async () => {
    let now = 1_700_000_000_000;
    let mints = 0;
    installFetch(() => {
      mints += 1;
      return jsonResponse(TOKEN_BODY);
    });
    const cache = new GrexxTokenCache();
    const first = provider({ cache, now: () => now });
    await first.getToken();
    now += 3599 * 1000 - GREXX_EXPIRY_MARGIN_MS - 1_000;
    await provider({ cache, clientSecret: 'test-secret', now: () => now }).getToken();
    expect(mints).toBe(1);

    now += 1_000;
    await provider({ cache, now: () => now }).getToken();
    expect(mints).toBe(2);
  });

  it('does not reuse a token after the secret changes', async () => {
    let mints = 0;
    installFetch(() => {
      mints += 1;
      return jsonResponse(TOKEN_BODY);
    });
    const cache = new GrexxTokenCache();
    await provider({ cache, clientSecret: 'secret-a' }).getToken();
    await provider({ cache, clientSecret: 'secret-b' }).getToken();
    expect(mints).toBe(2);
  });

  it('single-flights concurrent mints', async () => {
    let mints = 0;
    installFetch(async () => {
      mints += 1;
      await new Promise((resolve) => setTimeout(resolve, 20));
      return jsonResponse(TOKEN_BODY);
    });
    const cache = new GrexxTokenCache();
    const tokens = await Promise.all(Array.from({ length: 5 }, () => provider({ cache }).getToken()));
    expect(mints).toBe(1);
    expect(new Set(tokens.map((token) => token.accessToken)).size).toBe(1);
  });

  it('fails closed on token HTTP errors and does not cache them', async () => {
    installFetch(() => jsonResponse({ error: 'invalid_client', error_description: 'client is invalid' }, 400));
    const cache = new GrexxTokenCache();
    const err = await provider({ cache }).getToken().catch((error: unknown) => error);
    expect(err).toBeInstanceOf(GrexxAuthenticationError);
    expect((err as GrexxAuthenticationError).code).toBe('invalid_client');
    expect((err as GrexxAuthenticationError).message).toContain('Refusing to call /realtime');
    expect((err as GrexxAuthenticationError).message).not.toContain('test-secret');
    expect(cache.size).toBe(0);
  });

  it('fails closed when the token endpoint redirects', async () => {
    installFetch(() => {
      // Node fetch (`redirect: 'error'`) shape: message is "fetch failed",
      // and the redirect text is on `cause`.
      throw new TypeError('fetch failed', { cause: new Error('unexpected redirect: https://evil.example/oauth/access_token') });
    });
    const err = await provider().getToken().catch((error: unknown) => error);
    expect(err).toBeInstanceOf(GrexxAuthenticationError);
    expect((err as GrexxAuthenticationError).code).toBe('token_endpoint_redirect');
    expect((err as GrexxAuthenticationError).message).not.toContain('evil.example');
    expect((err as GrexxAuthenticationError).message).not.toContain('test-secret');
  });

  it('redacts access_token and refresh_token on a rejected token response', async () => {
    installFetch(() =>
      jsonResponse({
        access_token: 'live-bearer-token',
        refresh_token: 'live-refresh-token',
        expires_in: 'soon',
        token_type: 'Bearer',
      }),
    );
    const err = await provider().getToken().catch((error: unknown) => error);
    expect(err).toBeInstanceOf(GrexxAuthenticationError);
    const response = (err as GrexxAuthenticationError).response as Record<string, unknown>;
    expect(response['access_token']).toBe('[redacted]');
    expect(response['refresh_token']).toBe('[redacted]');
    expect(JSON.stringify(err)).not.toContain('live-bearer-token');
    expect(JSON.stringify(err)).not.toContain('live-refresh-token');
  });

  it('fails closed when the token endpoint times out', async () => {
    installFetch((_call) => {
      throw Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' });
    });
    const err = await provider().getToken().catch((error: unknown) => error);
    expect(err).toBeInstanceOf(GrexxAuthenticationError);
    expect((err as GrexxAuthenticationError).code).toBe('token_endpoint_timeout');
    expect((err as GrexxAuthenticationError).statusCode).toBe(0);
  });

  it('fails closed when access_token is missing, token_type is not Bearer, or the token contains a newline', async () => {
    installFetch(() => jsonResponse({ expires_in: 3599, token_type: 'Bearer' }));
    await expect(provider().getToken()).rejects.toBeInstanceOf(GrexxAuthenticationError);

    installFetch(() => jsonResponse({ access_token: 'tok', expires_in: 3599, token_type: 'mac' }));
    await expect(provider({ cache: new GrexxTokenCache() }).getToken()).rejects.toMatchObject({
      code: 'invalid_token_response',
    });

    installFetch(() => jsonResponse({ access_token: 'tok\r\nAuthorization: Basic dXNlcjpwYXNz', expires_in: 3599 }));
    await expect(provider({ cache: new GrexxTokenCache() }).getToken()).rejects.toBeInstanceOf(GrexxAuthenticationError);
  });

  it('drops a failed mint so the next call can retry', async () => {
    let mints = 0;
    installFetch(() => {
      mints += 1;
      if (mints <= 2) return jsonResponse({ error: 'invalid_client' }, 401);
      return jsonResponse(TOKEN_BODY);
    });
    const cache = new GrexxTokenCache();
    await expect(provider({ cache }).getToken()).rejects.toBeInstanceOf(GrexxAuthenticationError);
    await expect(provider({ cache }).getToken()).resolves.toMatchObject({ accessToken: 'test-access-token' });
    expect(mints).toBe(3);
  });
});
