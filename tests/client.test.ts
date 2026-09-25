import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import {
  AvailabilityResource,
  DisturbancesResource,
  KpnClient,
  MobileContractsResource,
  MobileHierarchyResource,
  MobileInvoicesResource,
  MobileOrdersResource,
  MobileServiceRequestsResource,
  MobileSubscribersResource,
  MobileThresholdsResource,
  PRODUCT_PATHS,
  SimSwapResource,
  TOKEN_PATHS,
  TokenCache,
} from '../src/index.js';
import { invalidClientBody } from './fixtures/oauth.js';
import { BASE, makeClient } from './helpers.js';
import { server } from './mocks/server.js';

const valid = { clientId: 'id', clientSecret: 'secret' };

describe('KpnClient constructor', () => {
  it.each(['clientId', 'clientSecret'] as const)('throws immediately when %s is empty or whitespace', (key) => {
    expect(() => new KpnClient({ ...valid, [key]: '' })).toThrow(new RegExp(`"${key}"`));
    expect(() => new KpnClient({ ...valid, [key]: '   ' })).toThrow(new RegExp(`"${key}"`));
  });

  it('throws on a half MSM credential pair', () => {
    expect(() => new KpnClient({ ...valid, msmClientId: 'm' })).toThrow(/paired/);
    expect(() => new KpnClient({ ...valid, msmClientSecret: 'm' })).toThrow(/paired/);
  });

  it('wires every resource to its class', () => {
    const client = makeClient();
    expect(client.disturbances).toBeInstanceOf(DisturbancesResource);
    expect(client.availability).toBeInstanceOf(AvailabilityResource);
    expect(client.simSwap).toBeInstanceOf(SimSwapResource);
    expect(client.mobile.subscribers).toBeInstanceOf(MobileSubscribersResource);
    expect(client.mobile.hierarchy).toBeInstanceOf(MobileHierarchyResource);
    expect(client.mobile.thresholds).toBeInstanceOf(MobileThresholdsResource);
    expect(client.mobile.invoices).toBeInstanceOf(MobileInvoicesResource);
    expect(client.mobile.contracts).toBeInstanceOf(MobileContractsResource);
    expect(client.mobile.orders).toBeInstanceOf(MobileOrdersResource);
    expect(client.mobile.serviceRequests).toBeInstanceOf(MobileServiceRequestsResource);
  });
});

/** Capture the client_id each realm's token endpoint receives. */
function captureTokenClientIds(): Record<'gateway' | 'msm', string[]> {
  const seen = { gateway: [] as string[], msm: [] as string[] };
  for (const realm of ['gateway', 'msm'] as const) {
    server.use(
      http.post(`${BASE}${TOKEN_PATHS[realm]}`, async ({ request }) => {
        seen[realm].push(new URLSearchParams(await request.text()).get('client_id') ?? '');
        return HttpResponse.json({ access_token: `${realm}-token`, expires_in: '3599', level: 'prod', application_name: `${realm}-app` });
      })
    );
  }
  return seen;
}

describe('KpnClient.testConnection', () => {
  it('reports the gateway realm only by default', async () => {
    const result = await makeClient().testConnection();
    expect(result).toEqual({ gateway: { ok: true, level: 'demo', applicationName: 'wyre-test-app' } });
  });

  it('mints the MSM token with the MSM credentials when includeMsm', async () => {
    const seen = captureTokenClientIds();
    const result = await makeClient().testConnection({ includeMsm: true });
    expect(result.msm).toEqual({ ok: true, level: 'prod', applicationName: 'msm-app' });
    expect(seen).toEqual({ gateway: ['test-client-id'], msm: ['test-msm-client-id'] });
  });

  it('falls back to the main credentials for MSM', async () => {
    const seen = captureTokenClientIds();
    await makeClient({ msm: false }).testConnection({ includeMsm: true });
    expect(seen.msm).toEqual(['test-client-id']);
  });

  it('never throws: reports each realm failure separately', async () => {
    server.use(http.post(`${BASE}${TOKEN_PATHS.msm}`, () => HttpResponse.json(invalidClientBody, { status: 401 })));
    const result = await makeClient().testConnection({ includeMsm: true });
    expect(result.gateway.ok).toBe(true);
    expect(result.msm).toEqual({ ok: false, error: 'ClientId is Invalid' });

    server.use(http.post(`${BASE}${TOKEN_PATHS.gateway}`, () => HttpResponse.error()));
    const down = await makeClient().testConnection();
    expect(down.gateway.ok).toBe(false);
    expect(down.gateway.error).toBeTruthy();
  });
});

describe('KpnClient realms', () => {
  it('uses the gateway token for network products and the MSM token for mobile, sharing lastQuota', async () => {
    captureTokenClientIds();
    const auth: Record<string, string | null> = {};
    server.use(
      http.get(`${BASE}${PRODUCT_PATHS.disturbance}/address`, ({ request }) => {
        auth['disturbance'] = request.headers.get('authorization');
        return HttpResponse.json({ broadband: [], fixed: [], mobile: [], generic: [] }, { headers: { 'quota-used': '1' } });
      }),
      http.get(`${BASE}${PRODUCT_PATHS.msm}/contract/thresholds`, ({ request }) => {
        auth['msm'] = request.headers.get('authorization');
        return HttpResponse.json([], { headers: { 'quota-used': '2' } });
      })
    );
    const client = new KpnClient({ ...valid, msmClientId: 'm', msmClientSecret: 's', tokenCache: new TokenCache() });
    expect(client.lastQuota).toBeUndefined();

    await client.disturbances.getByAddress({ zipCode: '1234AB', houseNumber: 1 });
    expect(client.lastQuota?.used).toBe(1);
    await client.mobile.thresholds.list();
    expect(client.lastQuota?.used).toBe(2);

    expect(auth).toEqual({ disturbance: 'Bearer gateway-token', msm: 'Bearer msm-token' });
  });
});
