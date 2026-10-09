import { describe, expect, it } from 'vitest';

import {
  GrexxAuthenticationError,
  GrexxForbiddenError,
  GrexxServerError,
  GrexxValidationError,
} from '../src/index.js';
import { rateLimiterForAccount } from '../src/grexx/client.js';
import {
  BASE_URL,
  REALTIME_URL,
  SUCCESS_XML,
  TOKEN_BODY,
  TOKEN_URL,
  ZIP_INPUT,
  installFetch,
  jsonResponse,
  makeGrexx,
  realtimeCalls,
  tokenCalls,
  xmlResponse,
} from './grexx-fetch.js';

const VALIDATION_XML = `<?xml version="1.0" encoding="utf-8"?>
<ZipCodeCheckResponse_V5>
  <Status>
    <Messages><string>Invalid zip</string></Messages>
    <Code>ValidationError</Code>
  </Status>
</ZipCodeCheckResponse_V5>`;

describe('GrexxClient /realtime', () => {
  it('mints a token and POSTs ZipCodeCheck XML with a Bearer token', async () => {
    const calls = installFetch((call) => {
      if (call.url === TOKEN_URL) return jsonResponse(TOKEN_BODY, 200, { 'x-request-id': 'token-req' });
      return xmlResponse(SUCCESS_XML, 200, { 'x-request-id': 'rt-req' });
    });

    const result = await makeGrexx().zipCodeCheck(ZIP_INPUT);

    expect(tokenCalls(calls)).toHaveLength(1);
    expect(realtimeCalls(calls)).toHaveLength(1);
    const realtime = realtimeCalls(calls)[0]!;
    expect(realtime.method).toBe('POST');
    expect(realtime.url).toBe(REALTIME_URL);
    expect(realtime.headers.get('authorization')).toBe('Bearer test-access-token');
    expect(realtime.headers.get('content-type')).toContain('text/xml');
    expect(realtime.headers.get('authorization')).not.toMatch(/Basic/i);
    expect(realtime.body).toContain('<ZipCodeCheckRequest_V6>');
    expect(realtime.body).toContain('<Portfolio>All</Portfolio>');
    expect(realtime.body).toContain('<ZipCode>1012JS</ZipCode>');
    expect(realtime.body).toContain('<HouseNr>1</HouseNr>');
    expect(realtime.body).toContain('<IsRoomNumberKnown>false</IsRoomNumberKnown>');
    expect(realtime.body).not.toContain('test-secret');
    expect(realtime.body).not.toContain('Envelope');
    expect(realtime.redirect).toBe('error');
    expect(result.code).toBe('Success');
    expect(result.requestId).toBe('rt-req');
    expect(result.suppliers.map((supplier) => supplier.name)).toEqual(['KPN', 'KPNWEAS', 'Tele2Fiber']);
    expect(result.suppliers[0]?.speeds[0]).toMatchObject({
      technology: 'FTTH',
      nlsType: 'Nls1',
      remarks: ['remark'],
    });
  });

  it('reuses the cached token across realtime calls', async () => {
    const calls = installFetch((call) => (call.url === TOKEN_URL ? jsonResponse(TOKEN_BODY) : xmlResponse(SUCCESS_XML)));
    const client = makeGrexx();
    await client.zipCodeCheck(ZIP_INPUT);
    await client.postRealtime('ZipCodeCheckRequest_V6', {
      Portfolio: 'All',
      ZipCode: '1012JS',
      HouseNr: 1,
      IsRoomNumberKnown: false,
    });
    expect(tokenCalls(calls)).toHaveLength(1);
    expect(realtimeCalls(calls)).toHaveLength(2);
  });

  it('remints once after HTTP 401 and retries with the new Bearer token', async () => {
    let tokens = 0;
    let realtime = 0;
    const calls = installFetch((call) => {
      if (call.url === TOKEN_URL) {
        tokens += 1;
        return jsonResponse({ ...TOKEN_BODY, access_token: `token-${tokens}` });
      }
      realtime += 1;
      if (realtime === 1) return jsonResponse({ error: 'invalid_token' }, 401);
      return xmlResponse(SUCCESS_XML);
    });

    const result = await makeGrexx().zipCodeCheck(ZIP_INPUT);
    expect(result.code).toBe('Success');
    expect(tokenCalls(calls)).toHaveLength(2);
    expect(realtimeCalls(calls).map((call) => call.headers.get('authorization'))).toEqual([
      'Bearer token-1',
      'Bearer token-2',
    ]);
  });

  it('does not call /realtime when the token endpoint fails', async () => {
    const calls = installFetch(() => jsonResponse({ error: 'invalid_client', error_description: 'nope' }, 401));
    const err = await makeGrexx().zipCodeCheck(ZIP_INPUT).catch((error: unknown) => error);
    expect(err).toBeInstanceOf(GrexxAuthenticationError);
    expect((err as GrexxAuthenticationError).message).toContain('Refusing to call /realtime');
    expect((err as GrexxAuthenticationError).message).not.toContain('test-secret');
    expect(realtimeCalls(calls)).toHaveLength(0);
    expect(tokenCalls(calls)).toHaveLength(2);
  });

  it('does not call /realtime when the token endpoint times out', async () => {
    const calls = installFetch(
      (call) =>
        new Promise((resolve, reject) => {
          const timer = setTimeout(() => resolve(jsonResponse(TOKEN_BODY)), 1_000);
          const abort = () => {
            clearTimeout(timer);
            const reason = call.signal?.reason;
            reject(reason instanceof Error ? reason : Object.assign(new Error('timeout'), { name: 'TimeoutError' }));
          };
          if (call.signal?.aborted) abort();
          else call.signal?.addEventListener('abort', abort, { once: true });
        }),
    );
    const err = await makeGrexx({ tokenTimeoutMs: 30 }).zipCodeCheck(ZIP_INPUT).catch((error: unknown) => error);
    expect(err).toBeInstanceOf(GrexxAuthenticationError);
    expect((err as GrexxAuthenticationError).code).toBe('token_endpoint_timeout');
    expect(realtimeCalls(calls)).toHaveLength(0);
    expect(tokenCalls(calls)).toHaveLength(1);
  });

  it('fails closed when remint after 401 fails', async () => {
    let tokens = 0;
    const calls = installFetch((call) => {
      if (call.url === TOKEN_URL) {
        tokens += 1;
        if (tokens === 1) return jsonResponse(TOKEN_BODY);
        return jsonResponse({ error: 'invalid_client' }, 503);
      }
      return jsonResponse({ error: 'expired' }, 401);
    });
    const err = await makeGrexx().zipCodeCheck(ZIP_INPUT).catch((error: unknown) => error);
    expect(err).toBeInstanceOf(GrexxAuthenticationError);
    expect(realtimeCalls(calls)).toHaveLength(1);
    expect(tokenCalls(calls)).toHaveLength(2);
    expect(realtimeCalls(calls).some((call) => call.headers.get('authorization')?.startsWith('Basic'))).toBe(false);
  });

  it('throws ValidationError for a business code and does not retry it', async () => {
    const calls = installFetch((call) => (call.url === TOKEN_URL ? jsonResponse(TOKEN_BODY) : xmlResponse(VALIDATION_XML)));
    const err = await makeGrexx({ maxRetries: 3 }).zipCodeCheck(ZIP_INPUT).catch((error: unknown) => error);
    expect(err).toBeInstanceOf(GrexxValidationError);
    expect((err as GrexxValidationError).code).toBe('ValidationError');
    expect((err as GrexxValidationError).message).toContain('Invalid zip');
    expect(realtimeCalls(calls)).toHaveLength(1);
  });

  it('retries IRMA code 108 and then returns success', async () => {
    let realtime = 0;
    const calls = installFetch((call) => {
      if (call.url === TOKEN_URL) return jsonResponse(TOKEN_BODY);
      realtime += 1;
      if (realtime === 1) {
        return xmlResponse(
          `<ZipCodeCheckResponse_V5><Status><Code>108</Code><Messages><string>Too Many Requests</string></Messages></Status></ZipCodeCheckResponse_V5>`,
          200,
          { 'retry-after': '0' },
        );
      }
      return xmlResponse(SUCCESS_XML);
    });
    const result = await makeGrexx({ maxRetries: 1 }).zipCodeCheck(ZIP_INPUT);
    expect(result.code).toBe('Success');
    expect(realtimeCalls(calls)).toHaveLength(2);
    expect(tokenCalls(calls)).toHaveLength(1);
  });

  it('maps HTTP 403 JSON to ForbiddenError and does not fall back to Basic', async () => {
    const calls = installFetch((call) => {
      if (call.url === TOKEN_URL) return jsonResponse(TOKEN_BODY);
      return jsonResponse({ error: 'Auth method Basic not allowed on this endpoint' }, 403, { 'x-request-id': 'deny-1' });
    });
    const err = await makeGrexx().zipCodeCheck(ZIP_INPUT).catch((error: unknown) => error);
    expect(err).toBeInstanceOf(GrexxForbiddenError);
    expect((err as GrexxForbiddenError).requestId).toBe('deny-1');
    expect((err as GrexxForbiddenError).message).toContain('Auth method Basic not allowed');
    expect(realtimeCalls(calls).every((call) => !String(call.headers.get('authorization')).startsWith('Basic'))).toBe(true);
  });

  it('retries HTTP 502 for zipCodeCheck and not for postRealtime by default', async () => {
    let hits = 0;
    installFetch((call) => {
      if (call.url === TOKEN_URL) return jsonResponse(TOKEN_BODY);
      hits += 1;
      if (hits === 1) return xmlResponse('<ZipCodeCheckResponse_V5><Status><Code>UnknownError</Code></Status></ZipCodeCheckResponse_V5>', 502);
      return xmlResponse(SUCCESS_XML);
    });
    await expect(makeGrexx({ maxRetries: 1 }).zipCodeCheck(ZIP_INPUT)).resolves.toMatchObject({ code: 'Success' });

    let once = 0;
    installFetch((call) => {
      if (call.url === TOKEN_URL) return jsonResponse(TOKEN_BODY);
      once += 1;
      return new Response('bad gateway', { status: 502 });
    });
    const err = await makeGrexx({ maxRetries: 3 })
      .postRealtime('ZipCodeCheckRequest_V6', '<Portfolio>All</Portfolio>')
      .catch((error: unknown) => error);
    expect(err).toBeInstanceOf(GrexxServerError);
    expect(once).toBe(1);
  });

  it('keeps the vendor status when an error body is HTML', async () => {
    let realtime = 0;
    installFetch((call) => {
      if (call.url === TOKEN_URL) return jsonResponse(TOKEN_BODY);
      realtime += 1;
      return new Response('<!DOCTYPE html><html><body>bad gateway</body></html>', {
        status: 503,
        headers: { 'content-type': 'text/html' },
      });
    });
    const err = await makeGrexx({ maxRetries: 3 })
      .postRealtime('ZipCodeCheckRequest_V6', '<Portfolio>All</Portfolio>')
      .catch((error: unknown) => error);
    expect(err).toBeInstanceOf(GrexxServerError);
    expect((err as GrexxServerError).statusCode).toBe(503);
    expect((err as GrexxServerError).code).not.toBe('invalid_xml');
    expect(realtime).toBe(1);
  });

  it('classifies a realtime redirect reported on error.cause', async () => {
    installFetch((call) => {
      if (call.url === TOKEN_URL) return jsonResponse(TOKEN_BODY);
      throw new TypeError('fetch failed', { cause: new Error('unexpected redirect') });
    });
    const err = await makeGrexx()
      .postRealtime('ZipCodeCheckRequest_V6', '<Portfolio>All</Portfolio>')
      .catch((error: unknown) => error);
    expect(err).toBeInstanceOf(GrexxServerError);
    expect((err as GrexxServerError).code).toBe('realtime_redirect');
  });

  it('shares one rate limiter for the same account and not across usernames', () => {
    const shared = rateLimiterForAccount(REALTIME_URL, 'shared-user');
    expect(rateLimiterForAccount(REALTIME_URL, 'shared-user')).toBe(shared);
    expect(rateLimiterForAccount(`${REALTIME_URL}/`, 'shared-user')).not.toBe(shared);
    expect(rateLimiterForAccount(REALTIME_URL, 'other-user')).not.toBe(shared);
  });

  it('strips a trailing slash from the base URL and never appends a caller header URL', async () => {
    const calls = installFetch((call) => (call.url.endsWith('/realtime') ? xmlResponse(SUCCESS_XML) : jsonResponse(TOKEN_BODY)));
    await makeGrexx({ baseUrl: `${BASE_URL}/` }).zipCodeCheck(ZIP_INPUT);
    expect(realtimeCalls(calls)[0]?.url).toBe(REALTIME_URL);
    expect(calls.some((call) => call.url.includes('evil.example'))).toBe(false);
  });

  it('treats legacy status code 0 as success', async () => {
    installFetch((call) =>
      call.url === TOKEN_URL
        ? jsonResponse(TOKEN_BODY)
        : xmlResponse('<ZipCodeCheckResponse_V5><Status><Code>0</Code></Status></ZipCodeCheckResponse_V5>'),
    );
    await expect(makeGrexx().zipCodeCheck(ZIP_INPUT)).resolves.toMatchObject({ code: '0', suppliers: [] });
  });
});
