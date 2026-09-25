import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import {
  AuthenticationError,
  ForbiddenError,
  HttpClient,
  KpnTokenProvider,
  RateLimitError,
  RateLimiter,
  ServerError,
  TOKEN_PATHS,
  TokenCache,
  type AuthProvider,
  type BinaryResponse,
  type QuotaInfo,
} from '../src/index.js';
import { gatewayTokenBody, invalidClientBody, invalidTokenFault } from './fixtures/oauth.js';
import { BASE } from './helpers.js';
import { server } from './mocks/server.js';

const staticAuth: AuthProvider = { headers: async () => ({ Authorization: 'Bearer static' }) };

function makeHttp(opts: { maxRetries?: number; baseUrl?: string; auth?: AuthProvider; onQuota?: (q: QuotaInfo) => void } = {}): HttpClient {
  return new HttpClient({
    baseUrl: opts.baseUrl ?? BASE,
    rateLimiter: new RateLimiter(1000, 1000),
    auth: opts.auth ?? staticAuth,
    maxRetries: opts.maxRetries ?? 0,
    onQuota: opts.onQuota,
  });
}

/** Count hits on /probe (any method) and answer with the given responses in order (last repeats). */
function probe(method: 'get' | 'post', ...responses: Array<() => Response>): { calls: number } {
  const counter = { calls: 0 };
  server.use(
    http[method](`${BASE}/probe`, () => {
      counter.calls += 1;
      return responses[Math.min(counter.calls, responses.length) - 1]!();
    })
  );
  return counter;
}

const ok = () => HttpResponse.json({ ok: true });
const status = (s: number, body: unknown = {}, headers?: Record<string, string>) => () =>
  HttpResponse.json(body as never, { status: s, headers });

describe('HttpClient requests', () => {
  it('sends Accept + auth, Content-Type only with a body, and extra headers', async () => {
    const seen: Array<Record<string, string | null>> = [];
    server.use(
      http.all(`${BASE}/probe`, ({ request }) => {
        seen.push({
          accept: request.headers.get('accept'),
          auth: request.headers.get('authorization'),
          contentType: request.headers.get('content-type'),
          lang: request.headers.get('content-language'),
          apiVersion: request.headers.get('api-version'),
        });
        return HttpResponse.json({});
      })
    );
    await makeHttp().request('/probe', { headers: { 'Content-Language': 'nl' } });
    await makeHttp().request('/probe', { method: 'POST', body: { a: 1 } });
    expect(seen[0]).toEqual({ accept: 'application/json', auth: 'Bearer static', contentType: null, lang: 'nl', apiVersion: null });
    expect(seen[1]!.contentType).toBe('application/json');
  });

  it('JSON-encodes the body', async () => {
    let body: unknown;
    server.use(
      http.post(`${BASE}/probe`, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({});
      })
    );
    await makeHttp().request('/probe', { method: 'POST', body: { contractId: 1, referenceNumber: 'R' } });
    expect(body).toEqual({ contractId: 1, referenceNumber: 'R' });
  });

  it('serializes array params as repeated keys and drops undefined', async () => {
    let url = new URL(BASE);
    server.use(
      http.get(`${BASE}/probe`, ({ request }) => {
        url = new URL(request.url);
        return HttpResponse.json({});
      })
    );
    await makeHttp().request('/probe', {
      params: { status: ['NEW', 'IN_PROGRESS'], from: 0, to: 20, userOnly: false, skipped: undefined },
    });
    expect(url.searchParams.getAll('status')).toEqual(['NEW', 'IN_PROGRESS']);
    expect(url.search).toContain('status=NEW&status=IN_PROGRESS');
    expect(url.searchParams.get('from')).toBe('0');
    expect(url.searchParams.get('userOnly')).toBe('false');
    expect(url.searchParams.has('skipped')).toBe(false);
  });

  it('normalizes trailing slashes on baseUrl and path', async () => {
    let path = '';
    server.use(
      http.get(`${BASE}/probe`, ({ request }) => {
        path = new URL(request.url).pathname;
        return HttpResponse.json({});
      })
    );
    await makeHttp({ baseUrl: `${BASE}/` }).request('probe/');
    expect(path).toBe('/probe');
  });
});

describe('HttpClient responses', () => {
  it('parses text as JSON regardless of content-type', async () => {
    probe('get', () => new HttpResponse('{"parsed":true}', { headers: { 'Content-Type': 'text/plain' } }));
    expect(await makeHttp().request('/probe')).toEqual({ parsed: true });
  });

  it('returns raw text for a non-JSON body and undefined for an empty one', async () => {
    probe('get', () => new HttpResponse('plain'), () => new HttpResponse(null, { status: 204 }));
    expect(await makeHttp().request('/probe')).toBe('plain');
    expect(await makeHttp().request('/probe')).toBeUndefined();
  });

  it('returns binary data, content type and Content-Disposition filename', async () => {
    const bytes = new Uint8Array([0x25, 0x50, 0x44, 0x46]);
    probe(
      'get',
      () => new HttpResponse(bytes, { headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': 'attachment; filename="INV-1.pdf"' } }),
      () => new HttpResponse(bytes, { headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': "attachment; filename*=UTF-8''INV%202.pdf" } }),
      () => new HttpResponse(bytes)
    );
    const first = await makeHttp().request<BinaryResponse>('/probe', { responseType: 'binary' });
    expect(Array.from(first.data)).toEqual([0x25, 0x50, 0x44, 0x46]);
    expect(first.contentType).toBe('application/pdf');
    expect(first.filename).toBe('INV-1.pdf');
    expect((await makeHttp().request<BinaryResponse>('/probe', { responseType: 'binary' })).filename).toBe('INV 2.pdf');
    expect((await makeHttp().request<BinaryResponse>('/probe', { responseType: 'binary' })).filename).toBeUndefined();
  });

  it('records quota headers in lastQuota and reports them via onQuota', async () => {
    const seen: QuotaInfo[] = [];
    probe('get', () =>
      HttpResponse.json({}, {
        headers: {
          'quota-limit': '1000', 'quota-used': '7', 'quota-interval': '1', 'quota-time-unit': 'month',
          'quota-reset-UTC': '2026-10-01T00:00:00Z', sunset: 'Wed, 01 Sep 2027 00:00:00 GMT',
        },
      })
    );
    const client = makeHttp({ onQuota: (q) => seen.push(q) });
    expect(client.lastQuota).toBeUndefined();
    await client.request('/probe');
    const expected = {
      limit: 1000, used: 7, interval: '1', timeUnit: 'month',
      resetUtc: '2026-10-01T00:00:00Z', sunset: 'Wed, 01 Sep 2027 00:00:00 GMT',
    };
    expect(client.lastQuota).toEqual(expected);
    expect(seen).toEqual([expected]);
  });

  it('maps errors through parseKpnError and attaches quota to RateLimitError', async () => {
    probe('get', status(403, { error: { message: 'Access denied' } }));
    await expect(makeHttp().request('/probe')).rejects.toBeInstanceOf(ForbiddenError);

    probe('get', status(429, {}, { 'quota-reset-UTC': '2026-10-01T00:00:00Z' }));
    const err = await makeHttp().request('/probe').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RateLimitError);
    expect((err as RateLimitError).quota?.resetUtc).toBe('2026-10-01T00:00:00Z');
  });
});

describe('HttpClient retry policy (safety-critical)', () => {
  it('retries an idempotent GET on 500 and succeeds', async () => {
    const hits = probe('get', status(500), ok);
    expect(await makeHttp({ maxRetries: 1 }).request('/probe')).toEqual({ ok: true });
    expect(hits.calls).toBe(2);
  }, 10_000);

  it('retries a 429 honouring Retry-After', async () => {
    const hits = probe('get', status(429, {}, { 'retry-after': '0' }), ok);
    expect(await makeHttp({ maxRetries: 1 }).request('/probe')).toEqual({ ok: true });
    expect(hits.calls).toBe(2);
  });

  it('retries network errors on idempotent requests', async () => {
    const hits = probe('get', () => HttpResponse.error(), ok);
    expect(await makeHttp({ maxRetries: 1 }).request('/probe')).toEqual({ ok: true });
    expect(hits.calls).toBe(2);
  }, 10_000);

  it('exhausts retries and throws the last ServerError', async () => {
    const hits = probe('get', status(503));
    const err = await makeHttp({ maxRetries: 1 }).request('/probe').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ServerError);
    expect((err as ServerError).statusCode).toBe(503);
    expect(hits.calls).toBe(2);
  }, 10_000);

  it('NEVER retries a non-idempotent POST on 502, even with maxRetries', async () => {
    const hits = probe('post', status(502), ok);
    await expect(makeHttp({ maxRetries: 3 }).request('/probe', { method: 'POST', body: {} })).rejects.toBeInstanceOf(ServerError);
    expect(hits.calls).toBe(1);
  });

  it('NEVER retries a non-idempotent POST on 429 or a network error', async () => {
    const limited = probe('post', status(429, {}, { 'retry-after': '0' }), ok);
    await expect(makeHttp({ maxRetries: 3 }).request('/probe', { method: 'POST' })).rejects.toBeInstanceOf(RateLimitError);
    expect(limited.calls).toBe(1);

    const dropped = probe('post', () => HttpResponse.error(), ok);
    await expect(makeHttp({ maxRetries: 3 }).request('/probe', { method: 'POST' })).rejects.toThrow();
    expect(dropped.calls).toBe(1);
  });

  it('retries a read-only POST that opts in with idempotent: true', async () => {
    const hits = probe('post', status(502), ok);
    expect(await makeHttp({ maxRetries: 1 }).request('/probe', { method: 'POST', idempotent: true })).toEqual({ ok: true });
    expect(hits.calls).toBe(2);
  }, 10_000);

  it('can opt a GET out with idempotent: false', async () => {
    const hits = probe('get', status(500), ok);
    await expect(makeHttp({ maxRetries: 3 }).request('/probe', { idempotent: false })).rejects.toBeInstanceOf(ServerError);
    expect(hits.calls).toBe(1);
  });
});

describe('HttpClient 401 refresh-and-retry-once', () => {
  function tokenAuth(): KpnTokenProvider {
    return new KpnTokenProvider({
      baseUrl: BASE, tokenPath: TOKEN_PATHS.gateway, clientId: 'id', clientSecret: 'secret', cache: new TokenCache(),
    });
  }

  function countMints(): { count: number } {
    const counter = { count: 0 };
    server.use(
      http.post(`${BASE}${TOKEN_PATHS.gateway}`, () => {
        counter.count += 1;
        return HttpResponse.json({ ...gatewayTokenBody, access_token: `token-${counter.count}` });
      })
    );
    return counter;
  }

  it('re-mints and retries once on 401 — even a non-idempotent POST with maxRetries 0', async () => {
    const mints = countMints();
    const tokens: Array<string | null> = [];
    server.use(
      http.post(`${BASE}/probe`, ({ request }) => {
        tokens.push(request.headers.get('authorization'));
        return tokens.length === 1 ? HttpResponse.json({}, { status: 401 }) : HttpResponse.json({ ok: true });
      })
    );
    expect(await makeHttp({ auth: tokenAuth() }).request('/probe', { method: 'POST' })).toEqual({ ok: true });
    expect(tokens).toEqual(['Bearer token-1', 'Bearer token-2']);
    expect(mints.count).toBe(2);
  });

  it('treats an Apigee invalid-token fault on a non-401 status as unauthorized', async () => {
    countMints();
    const hits = probe('get', status(500, invalidTokenFault), ok);
    expect(await makeHttp({ auth: tokenAuth() }).request('/probe')).toEqual({ ok: true });
    expect(hits.calls).toBe(2);
  });

  it('a second 401 is terminal', async () => {
    countMints();
    const hits = probe('get', status(401, invalidTokenFault));
    await expect(makeHttp({ auth: tokenAuth(), maxRetries: 3 }).request('/probe')).rejects.toBeInstanceOf(AuthenticationError);
    expect(hits.calls).toBe(2);
  });

  it('a 401 from the token endpoint is terminal and the API is never called', async () => {
    let mints = 0;
    server.use(
      http.post(`${BASE}${TOKEN_PATHS.gateway}`, () => {
        mints += 1;
        return HttpResponse.json(invalidClientBody, { status: 401 });
      })
    );
    const hits = probe('get', ok);
    const err = await makeHttp({ auth: tokenAuth(), maxRetries: 3 }).request('/probe').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AuthenticationError);
    expect((err as AuthenticationError).code).toBe('invalid_client');
    expect(mints).toBe(1);
    expect(hits.calls).toBe(0);
  });

  it('without handleUnauthorized a 401 is thrown immediately', async () => {
    const hits = probe('get', status(401));
    await expect(makeHttp().request('/probe')).rejects.toBeInstanceOf(AuthenticationError);
    expect(hits.calls).toBe(1);
  });
});
