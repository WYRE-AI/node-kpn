import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import {
  AuthenticationError,
  ForbiddenError,
  NotFoundError,
  RateLimitError,
  ServerError,
} from '../src/index.js';
import {
  msmPage,
  orderDetailsFixture,
  orderFixture,
  prettyOrderFixture,
} from './fixtures/mobile-orders.js';
import { BASE, makeClient, respondWithError } from './helpers.js';
import { server } from './mocks/server.js';

const MSM = '/mobile/kpn/mobileservices';
const client = makeClient();

describe('mobile.orders', () => {
  it('lists orders with repeated status keys, patterns and flags', async () => {
    let url: URL | undefined;
    server.use(
      http.get(`${BASE}${MSM}/track-and-trace/orders`, ({ request }) => {
        url = new URL(request.url);
        return HttpResponse.json(msmPage([orderFixture]));
      })
    );

    const result = await client.mobile.orders.list({
      status: ['NEW', 'IN_PROGRESS', 'UNAUTHORIZED'],
      patterns: ['KPN-0000001'],
      currentUserOrdersOnly: false,
      withRequiredActionFirst: true,
      from: 0,
      to: 20,
      sortBy: 'CREATION_DATE',
      order: 'DESC',
    });

    expect(result).toEqual(msmPage([orderFixture]));
    expect(url?.searchParams.getAll('status')).toEqual(['NEW', 'IN_PROGRESS', 'UNAUTHORIZED']);
    expect(url?.search).toContain('status=NEW&status=IN_PROGRESS&status=UNAUTHORIZED');
    expect(url?.searchParams.getAll('patterns')).toEqual(['KPN-0000001']);
    expect(url?.searchParams.get('currentUserOrdersOnly')).toBe('false');
    expect(url?.searchParams.get('withRequiredActionFirst')).toBe('true');
    expect(url?.searchParams.get('sortBy')).toBe('CREATION_DATE');
    expect(url?.searchParams.get('order')).toBe('DESC');
  });

  it('gets order details', async () => {
    expect(await client.mobile.orders.get(7001)).toEqual(orderDetailsFixture);
  });

  it('gets the pretty order view', async () => {
    expect(await client.mobile.orders.getPretty(7001)).toEqual(prettyOrderFixture);
  });

  it('authorize POSTs {orderId}', async () => {
    let body: unknown;
    server.use(
      http.post(`${BASE}${MSM}/order/authorize`, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ id: 7001, status: 'Authorized' });
      })
    );
    const summary = await client.mobile.orders.authorize(7001);
    expect(body).toEqual({ orderId: 7001 });
    expect(summary.status).toBe('Authorized');
  });

  it('cancel POSTs to the order and sends note as a query parameter', async () => {
    let url: URL | undefined;
    let rawBody = 'unset';
    server.use(
      http.post(`${BASE}${MSM}/track-and-trace/orders/:id/cancel`, async ({ request }) => {
        url = new URL(request.url);
        rawBody = await request.text();
        return new HttpResponse(null, { status: 200 });
      })
    );
    await expect(client.mobile.orders.cancel(7001, 'Ordered by mistake')).resolves.toBeUndefined();
    expect(url?.pathname).toBe(`${MSM}/track-and-trace/orders/7001/cancel`);
    expect(url?.searchParams.get('note')).toBe('Ordered by mistake');
    expect(rawBody).toBe('');
  });

  it('cancel without a note sends no query string', async () => {
    let search = 'unset';
    server.use(
      http.post(`${BASE}${MSM}/track-and-trace/orders/:id/cancel`, ({ request }) => {
        search = new URL(request.url).search;
        return new HttpResponse(null, { status: 200 });
      })
    );
    await client.mobile.orders.cancel(7001);
    expect(search).toBe('');
  });

  describe('non-idempotent order POSTs are never retried', () => {
    const retryingClient = makeClient({ maxRetries: 3 });

    it.each([
      ['authorize', '/order/authorize', () => retryingClient.mobile.orders.authorize(7001)],
      ['cancel', '/track-and-trace/orders/:id/cancel', () => retryingClient.mobile.orders.cancel(7001)],
    ] as const)('%s: 502 hits the server exactly once', async (_name, path, call) => {
      let hits = 0;
      server.use(
        http.post(`${BASE}${MSM}${path}`, () => {
          hits += 1;
          return HttpResponse.json({ message: 'Bad gateway' }, { status: 502, headers: { 'Retry-After': '0' } });
        })
      );
      await expect(call()).rejects.toBeInstanceOf(ServerError);
      expect(hits).toBe(1);
    });
  });

  describe('error paths', () => {
    it('401 → AuthenticationError', async () => {
      respondWithError('get', `${MSM}/track-and-trace/orders`, 401);
      await expect(client.mobile.orders.list({ status: ['NEW'] })).rejects.toBeInstanceOf(
        AuthenticationError
      );
    });

    it('403 → ForbiddenError', async () => {
      respondWithError('post', `${MSM}/order/authorize`, 403);
      await expect(client.mobile.orders.authorize(7001)).rejects.toBeInstanceOf(ForbiddenError);
    });

    it('404 → NotFoundError', async () => {
      respondWithError('get', `${MSM}/track-and-trace/orders/:id`, 404);
      await expect(client.mobile.orders.get(9999)).rejects.toBeInstanceOf(NotFoundError);
    });

    it('429 → RateLimitError', async () => {
      respondWithError('get', `${MSM}/track-and-trace/orders/:id/pretty`, 429);
      await expect(client.mobile.orders.getPretty(7001)).rejects.toBeInstanceOf(RateLimitError);
    });

    it('500 → ServerError', async () => {
      respondWithError('get', `${MSM}/track-and-trace/orders`, 500);
      await expect(client.mobile.orders.list({ status: ['NEW'] })).rejects.toBeInstanceOf(ServerError);
    });
  });
});
