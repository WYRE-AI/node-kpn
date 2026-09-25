import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import {
  AuthenticationError,
  ForbiddenError,
  NotFoundError,
  RateLimitError,
  ServerError,
  ValidationError,
} from '../src/index.js';
import {
  contractDetailsFixture,
  contractFixture,
  contractItemsFixture,
  FAKE_PUK,
  msmPage,
  operationsFixture,
  orderSummaryFixture,
} from './fixtures/mobile-orders.js';
import { BASE, makeClient, respondWithError } from './helpers.js';
import { server } from './mocks/server.js';

const MSM = '/mobile/kpn/mobileservices';
const client = makeClient();

/** Answer `path` with a 502 and count the hits. */
function countBadGateway(path: string): { hits: number } {
  const counter = { hits: 0 };
  server.use(
    http.post(`${BASE}${MSM}${path}`, () => {
      counter.hits += 1;
      return HttpResponse.json({ message: 'Bad gateway' }, { status: 502, headers: { 'Retry-After': '0' } });
    })
  );
  return counter;
}

describe('mobile.contracts', () => {
  it('lists contracts with paging, filters, category and Content-Language', async () => {
    let url: URL | undefined;
    let language: string | null = null;
    server.use(
      http.get(`${BASE}${MSM}/contract/all`, ({ request }) => {
        url = new URL(request.url);
        language = request.headers.get('content-language');
        return HttpResponse.json(msmPage([contractFixture]));
      })
    );

    const result = await client.mobile.contracts.list({
      from: 0,
      to: 20,
      patterns: ['0600000001', 'jan'],
      filters: 'MOBILE_NUMBER: "0600000001"; STATE: "ACTIVE"',
      category: 'MOBILE',
      language: 'nl',
    });

    expect(result).toEqual(msmPage([contractFixture]));
    expect(language).toBe('nl');
    expect(url?.searchParams.get('from')).toBe('0');
    expect(url?.searchParams.get('to')).toBe('20');
    expect(url?.searchParams.getAll('patterns')).toEqual(['0600000001', 'jan']);
    expect(url?.searchParams.get('filters')).toBe('MOBILE_NUMBER: "0600000001"; STATE: "ACTIVE"');
    expect(url?.searchParams.get('category')).toBe('MOBILE');
    expect(url?.searchParams.has('language')).toBe(false);
  });

  it('lists without params: no query string, no Content-Language', async () => {
    let search = 'unset';
    let language: string | null = 'unset';
    server.use(
      http.get(`${BASE}${MSM}/contract/all`, ({ request }) => {
        search = new URL(request.url).search;
        language = request.headers.get('content-language');
        return HttpResponse.json(msmPage([contractFixture]));
      })
    );
    await client.mobile.contracts.list();
    expect(search).toBe('');
    expect(language).toBeNull();
  });

  it('gets raw contract details, PIN/PUK included (masking is the consumer’s job)', async () => {
    const details = await client.mobile.contracts.get(5001);
    expect(details).toEqual(contractDetailsFixture);
    expect(details.puk).toBe(FAKE_PUK);
  });

  it('gets the contract item tree', async () => {
    expect(await client.mobile.contracts.getItems(5001)).toEqual(contractItemsFixture);
  });

  it('gets operation availability with contractId in the query', async () => {
    let contractId: string | null = null;
    server.use(
      http.get(`${BASE}${MSM}/order/operations`, ({ request }) => {
        contractId = new URL(request.url).searchParams.get('contractId');
        return HttpResponse.json(operationsFixture);
      })
    );
    const ops = await client.mobile.contracts.getOperations(5001);
    expect(contractId).toBe('5001');
    expect(ops.blockSim?.enabled).toBe(true);
    expect(ops.replaceSim?.blockingOrders?.[0]?.kpnReference).toBe('KPN-0000002');
  });

  it.each([
    ['blockSim', '/order/block-sim'],
    ['unblockSim', '/order/unblock-sim'],
  ] as const)('%s POSTs {contractId, referenceNumber}', async (method, path) => {
    let body: unknown;
    server.use(
      http.post(`${BASE}${MSM}${path}`, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json(orderSummaryFixture);
      })
    );
    const summary = await client.mobile.contracts[method]({
      contractId: 5001,
      referenceNumber: 'WYRE-20260925120000',
    });
    expect(body).toEqual({ contractId: 5001, referenceNumber: 'WYRE-20260925120000' });
    expect(summary).toEqual(orderSummaryFixture);
  });

  it('validateSimReplacement resolves on 2xx and sends the ICCID', async () => {
    let body: unknown;
    server.use(
      http.post(`${BASE}${MSM}/order/replace-sim/validator`, async ({ request }) => {
        body = await request.json();
        return new HttpResponse(null, { status: 200 });
      })
    );
    await expect(
      client.mobile.contracts.validateSimReplacement({ contractId: 5001, newSimCardNumber: '8931000000000000002' })
    ).resolves.toBeUndefined();
    expect(body).toEqual({ contractId: 5001, newSimCardNumber: '8931000000000000002' });
  });

  it('validateSimReplacement: invalid ICCID → ValidationError with code', async () => {
    respondWithError('post', `${MSM}/order/replace-sim/validator`, 400, {
      transactionId: 'tx-iccid',
      status: 400,
      name: 'INVALID_SIM_CARD_NUMBER',
      message: 'SIM card number is not valid',
    });
    const err = await client.mobile.contracts
      .validateSimReplacement({ contractId: 5001, newSimCardNumber: 'bogus' })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ValidationError);
    expect((err as ValidationError).code).toBe('INVALID_SIM_CARD_NUMBER');
    expect((err as ValidationError).transactionId).toBe('tx-iccid');
  });

  it('validateSimReplacement is read-only, so a 502 is retried', async () => {
    let hits = 0;
    server.use(
      http.post(`${BASE}${MSM}/order/replace-sim/validator`, () => {
        hits += 1;
        return hits === 1
          ? HttpResponse.json({ message: 'Bad gateway' }, { status: 502, headers: { 'Retry-After': '0' } })
          : new HttpResponse(null, { status: 200 });
      })
    );
    await makeClient({ maxRetries: 3 }).mobile.contracts.validateSimReplacement({
      contractId: 5001,
      newSimCardNumber: '8931000000000000002',
    });
    expect(hits).toBe(2);
  });

  it('replaceSim POSTs the full body (eSIM)', async () => {
    let body: unknown;
    server.use(
      http.post(`${BASE}${MSM}/order/replace-sim`, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ ...orderSummaryFixture, operation: 'REPLACE_SIM' });
      })
    );
    const summary = await client.mobile.contracts.replaceSim({
      contractId: 5001,
      esim: true,
      email: 'jan@voorbeeld.example',
      referenceNumber: 'WYRE-20260925120000',
      wishDate: '2026-10-01',
    });
    expect(body).toEqual({
      contractId: 5001,
      esim: true,
      email: 'jan@voorbeeld.example',
      referenceNumber: 'WYRE-20260925120000',
      wishDate: '2026-10-01',
    });
    expect(summary.operation).toBe('REPLACE_SIM');
  });

  describe('non-idempotent order POSTs are never retried', () => {
    const retryingClient = makeClient({ maxRetries: 3 });

    it('blockSim: 502 hits the server exactly once', async () => {
      const counter = countBadGateway('/order/block-sim');
      await expect(
        retryingClient.mobile.contracts.blockSim({ contractId: 5001, referenceNumber: 'WYRE-1' })
      ).rejects.toBeInstanceOf(ServerError);
      expect(counter.hits).toBe(1);
    });

    it('unblockSim: 502 hits the server exactly once', async () => {
      const counter = countBadGateway('/order/unblock-sim');
      await expect(
        retryingClient.mobile.contracts.unblockSim({ contractId: 5001, referenceNumber: 'WYRE-1' })
      ).rejects.toBeInstanceOf(ServerError);
      expect(counter.hits).toBe(1);
    });

    it('replaceSim: 502 hits the server exactly once', async () => {
      const counter = countBadGateway('/order/replace-sim');
      await expect(
        retryingClient.mobile.contracts.replaceSim({
          contractId: 5001,
          newSimCardNumber: '8931000000000000002',
          esim: false,
          referenceNumber: 'WYRE-1',
        })
      ).rejects.toBeInstanceOf(ServerError);
      expect(counter.hits).toBe(1);
    });
  });

  describe('error paths', () => {
    it('401 → AuthenticationError', async () => {
      respondWithError('get', `${MSM}/contract/all`, 401);
      await expect(client.mobile.contracts.list()).rejects.toBeInstanceOf(AuthenticationError);
    });

    it('403 → ForbiddenError', async () => {
      respondWithError('get', `${MSM}/contract/id/:id`, 403);
      await expect(client.mobile.contracts.get(5001)).rejects.toBeInstanceOf(ForbiddenError);
    });

    it('404 → NotFoundError', async () => {
      respondWithError('get', `${MSM}/contract/id/:id`, 404);
      await expect(client.mobile.contracts.get(9999)).rejects.toBeInstanceOf(NotFoundError);
    });

    it('429 → RateLimitError', async () => {
      respondWithError('get', `${MSM}/order/operations`, 429);
      await expect(client.mobile.contracts.getOperations(5001)).rejects.toBeInstanceOf(RateLimitError);
    });

    it('500 → ServerError', async () => {
      respondWithError('get', `${MSM}/contract/id/:id/items`, 500);
      await expect(client.mobile.contracts.getItems(5001)).rejects.toBeInstanceOf(ServerError);
    });
  });
});
