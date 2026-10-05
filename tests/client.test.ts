import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import {
  GREXX_ACCEPTATIE_BASE_URL,
  GREXX_ACCEPTATIE_TOKEN_URL,
  GREXX_XML_CONTENT_TYPE,
  GrexxAuthenticationError,
  GrexxError,
  GrexxRateLimitError,
  GrexxValidationError,
  KpnGrexxClient,
  grexxChannelUrl,
  grexxConfigFromEnv,
  grexxTokenUrl,
  tokenRefreshAt,
} from '../src/index.js';
import { server } from './mocks/server.js';

const REALTIME = grexxChannelUrl(GREXX_ACCEPTATIE_BASE_URL, 'realtime');
const QUEUED = grexxChannelUrl(GREXX_ACCEPTATIE_BASE_URL, 'queued');
const USER = 'api-user';
const PASSWORD = 'p@ss word';

function client(overrides: { authMode?: 'oauth' | 'basic' } = {}) {
  return new KpnGrexxClient({
    username: USER,
    password: PASSWORD,
    baseUrl: GREXX_ACCEPTATIE_BASE_URL,
    authMode: overrides.authMode,
  });
}

function tokenHandler(body: Record<string, unknown> = { access_token: 'tok-1', expires_in: 3600 }, status = 200) {
  return http.post(GREXX_ACCEPTATIE_TOKEN_URL, async ({ request }) => {
    const form = new URLSearchParams(await request.text());
    const type = request.headers.get('content-type') ?? '';
    if (
      !type.startsWith('application/x-www-form-urlencoded') ||
      form.get('grant_type') !== 'client_credentials' ||
      form.get('client_id') !== USER ||
      form.get('client_secret') !== PASSWORD ||
      form.get('scope') !== 'all'
    ) {
      return HttpResponse.json({ error: 'invalid_client' }, { status: 401 });
    }
    return HttpResponse.json(body, { status });
  });
}

function xmlResponse(xml: string, status = 200, headers: Record<string, string> = {}) {
  return new HttpResponse(xml, {
    status,
    headers: { 'Content-Type': 'application/xml', ...headers },
  });
}

describe('URL and env config', () => {
  it('joins acceptatie paths without a double slash and derives the token URL', () => {
    expect(REALTIME).toBe(
      'https://service-accept.grexx.today/interfaces/kpn/kpn_partners_acceptatieomgeving/697fbf4b18a076446aa2cd4a/realtime'
    );
    expect(grexxChannelUrl(GREXX_ACCEPTATIE_BASE_URL, 'queued')).toBe(
      'https://service-accept.grexx.today/interfaces/kpn/kpn_partners_acceptatieomgeving/697fbf4b18a076446aa2cd4a/queued'
    );
    expect(grexxChannelUrl(`${GREXX_ACCEPTATIE_BASE_URL}///`, 'ordermodule')).toBe(
      'https://service-accept.grexx.today/interfaces/kpn/kpn_partners_acceptatieomgeving/697fbf4b18a076446aa2cd4a/ordermodule'
    );
    expect(grexxTokenUrl(GREXX_ACCEPTATIE_BASE_URL)).toBe(GREXX_ACCEPTATIE_TOKEN_URL);
    expect(REALTIME).not.toContain('api-prd.kpn.com');
  });

  it('requires the three Grexx env vars and does not default a host', () => {
    expect(() => grexxConfigFromEnv({})).toThrow(/KPN_GREXX_USERNAME is required/);
    expect(() =>
      new KpnGrexxClient({ username: USER, password: PASSWORD, baseUrl: '  ' })
    ).toThrow(/KPN_GREXX_BASE_URL is required/);
    const config = grexxConfigFromEnv({
      KPN_GREXX_USERNAME: ' user ',
      KPN_GREXX_PASSWORD: PASSWORD,
      KPN_GREXX_BASE_URL: GREXX_ACCEPTATIE_BASE_URL,
      KPN_GREXX_AUTH_MODE: 'basic',
    });
    expect(config).toMatchObject({ username: 'user', authMode: 'basic', password: PASSWORD });
  });

  it('applies expiry skew for expires_in and a short expires duration', () => {
    const now = 1_700_000_000_000;
    expect(tokenRefreshAt({ expires_in: 3600 }, now)).toBe(now + 3_600_000 - 60_000);
    expect(tokenRefreshAt({ expires: 30 }, now)).toBe(now + 15_000);
  });
});

describe('OAuth and realtime calls', () => {
  it('mints a bearer token once and posts ZipCodeCheck XML', async () => {
    let tokenCalls = 0;
    server.use(
      http.post(GREXX_ACCEPTATIE_TOKEN_URL, async ({ request }) => {
        tokenCalls += 1;
        const form = new URLSearchParams(await request.text());
        expect(form.get('grant_type')).toBe('client_credentials');
        expect(form.get('client_id')).toBe(USER);
        expect(form.get('client_secret')).toBe(PASSWORD);
        expect(form.get('scope')).toBe('all');
        return HttpResponse.json({ access_token: 'tok-1', expires: 3600 });
      }),
      http.post(REALTIME, async ({ request }) => {
        expect(request.headers.get('authorization')).toBe('Bearer tok-1');
        expect(request.headers.get('content-type')).toBe(GREXX_XML_CONTENT_TYPE);
        const xml = await request.text();
        expect(xml).toContain('<ZipCodeCheckRequest_V6>');
        expect(xml).toContain('<ZipCode>1234AB</ZipCode>');
        return xmlResponse(
          '<ZipCodeCheckResponse_V6><ResultCode>0</ResultCode><ResultMessage>Success</ResultMessage></ZipCodeCheckResponse_V6>'
        );
      })
    );

    const kpn = client();
    const first = await kpn.zipCodeCheck({ ZipCode: '1234AB', HouseNumber: '10' });
    const again = await kpn.getAccessToken();
    expect(first.grexxCode).toBe(0);
    expect(again).toBe('tok-1');
    expect(tokenCalls).toBe(1);
  });

  it('sends Basic and does not mint when authMode is basic', async () => {
    server.use(
      http.post(REALTIME, async ({ request }) => {
        const expected = `Basic ${Buffer.from(`${USER}:${PASSWORD}`, 'utf8').toString('base64')}`;
        expect(request.headers.get('authorization')).toBe(expected);
        return xmlResponse('<RasCheckResponse_V1><ResultCode>0</ResultCode></RasCheckResponse_V1>');
      })
    );
    const parsed = await client({ authMode: 'basic' }).rasCheck({ Username: 'line-user' });
    expect(parsed.grexxCode).toBe(0);
  });

  it('refreshes the bearer token once after HTTP 401 and does not retry code 102', async () => {
    let tokenCalls = 0;
    let realtimeCalls = 0;
    server.use(
      http.post(GREXX_ACCEPTATIE_TOKEN_URL, () => {
        tokenCalls += 1;
        return HttpResponse.json({ access_token: `tok-${tokenCalls}`, expires_in: 3600 });
      }),
      http.post(REALTIME, () => {
        realtimeCalls += 1;
        if (realtimeCalls === 1) return new HttpResponse('unauthorized', { status: 401 });
        return xmlResponse('<CarrierInfoResponse_V1><ResultCode>0</ResultCode></CarrierInfoResponse_V1>');
      })
    );
    const parsed = await client().carrierInfo({ ZipCode: '1234AB', HouseNumber: 1 });
    expect(parsed.grexxCode).toBe(0);
    expect(tokenCalls).toBe(2);
    expect(realtimeCalls).toBe(2);

    let rejectedTokenCalls = 0;
    server.use(
      http.post(GREXX_ACCEPTATIE_TOKEN_URL, async ({ request }) => {
        rejectedTokenCalls += 1;
        const form = new URLSearchParams(await request.text());
        expect(form.get('client_secret')).toBe(PASSWORD);
        return HttpResponse.json({ access_token: 'tok-bad', expires_in: 30 });
      }),
      http.post(REALTIME, () =>
        xmlResponse('<Error><Code>102</Code><Message>Wrong username/password or ip address not allowed</Message></Error>', 401)
      )
    );
    const kpn = client();
    await expect(kpn.prequalification({ ZipCode: '1234AB', HouseNumber: 2 })).rejects.toMatchObject({
      grexxCode: 102,
    });
    expect(rejectedTokenCalls).toBe(1);
  });

  it('throws GrexxError subclasses with grexxCode and keeps order status 204', async () => {
    server.use(
      tokenHandler(),
      http.post(REALTIME, async ({ request }) => {
        const xml = await request.text();
        if (xml.includes('StartLineDiagnoseRequest')) {
          return xmlResponse('<Error><Code>108</Code><Message>Too Many Requests</Message></Error>', 200, {
            'retry-after': '5',
          });
        }
        if (xml.includes('OrderDataRequest')) {
          return xmlResponse('<OrderDataResponse_V1><ResultCode>0</ResultCode><Status>204</Status></OrderDataResponse_V1>');
        }
        return xmlResponse('<Error><Code>68</Code></Error>');
      })
    );
    const kpn = client();
    await expect(kpn.customerData({ CustomerId: '1' })).rejects.toMatchObject({
      name: 'GrexxError',
      grexxCode: 68,
    });
    await expect(kpn.startLineDiagnose({ OrderId: '9' })).rejects.toBeInstanceOf(GrexxRateLimitError);
    const limited = await kpn.startLineDiagnose({ OrderId: '9' }).catch((error: unknown) => error);
    expect(limited).toBeInstanceOf(GrexxRateLimitError);
    expect(limited).toMatchObject({ grexxCode: 108, retryAfterSeconds: 5 });
    const order = await kpn.orderData({ OrderId: '55' });
    expect(order.orderStatus?.code).toBe(204);
    expect(order.orderStatus?.meaning).toBe('Accepted');
  });

  it('treats an authenticated XML rejection as a successful connection test', async () => {
    server.use(
      tokenHandler(),
      http.post(REALTIME, async ({ request }) => {
        const xml = await request.text();
        expect(xml).toContain('<ZipCodeCheckRequest_V6/>');
        return xmlResponse('<Error><Code>109</Code><Message>XML validation error</Message></Error>');
      })
    );
    const result = await client().testConnection();
    expect(result).toMatchObject({ ok: true, authenticated: true, grexxCode: 109, authMode: 'oauth' });
  });

  it('reports code 101 so the caller can fall back to basic', async () => {
    server.use(
      tokenHandler(),
      http.post(REALTIME, () => xmlResponse('<Error><Code>101</Code><Message>Authorization scheme basic required</Message></Error>'))
    );
    const result = await client().testConnection();
    expect(result.ok).toBe(false);
    expect(result.authenticated).toBe(false);
    expect(result.grexxCode).toBe(101);
    expect(result.message).toMatch(/authMode to "basic"/);
  });

  it('does not put the password in a token failure', async () => {
    server.use(http.post(GREXX_ACCEPTATIE_TOKEN_URL, () => HttpResponse.json({ error: 'invalid_client' }, { status: 401 })));
    const error = await client().getAccessToken().catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(GrexxAuthenticationError);
    expect((error as Error).message).not.toContain(PASSWORD);
    expect((error as Error).message).toContain('invalid_client');
  });

  it('posts the escape-hatch string to /queued without a typed helper', async () => {
    server.use(
      tokenHandler(),
      http.post(QUEUED, async ({ request }) => {
        expect(request.url).toBe(QUEUED);
        expect(await request.text()).toContain('<GetSimRequest_V1><OrderId>7</OrderId></GetSimRequest_V1>');
        return xmlResponse('<Error><Code>107</Code><Message>Message type not allowed</Message></Error>');
      })
    );
    await expect(
      client().postXml('queued', 'GetSimRequest_V1', '<OrderId>7</OrderId>')
    ).rejects.toBeInstanceOf(GrexxError);
  });

  it('does not follow redirects', async () => {
    server.use(
      tokenHandler(),
      http.post(REALTIME, () => new HttpResponse(null, { status: 302, headers: { Location: 'https://evil.example/realtime' } }))
    );
    await expect(client().postRealtimeXml('ZipCodeCheckRequest_V6', {})).rejects.toThrow(/redirected/);
  });

  it('maps validation code 104', async () => {
    server.use(
      tokenHandler(),
      http.post(REALTIME, () => xmlResponse('<Error><Code>104</Code></Error>'))
    );
    await expect(client().postRealtimeXml('ZipCodeCheckRequest_V6', '<not-xml')).rejects.toBeInstanceOf(
      GrexxValidationError
    );
  });
});
