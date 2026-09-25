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
  orgContractFixture,
  page,
  subscriberDetailsFixture,
  subscriberFixture,
} from './fixtures/mobile-org.js';
import { BASE, makeClient, respondWithError } from './helpers.js';
import { server } from './mocks/server.js';

const PATH = '/mobile/kpn/mobileservices/hierarchy/subscribers';
const client = makeClient();

describe('mobile.subscribers', () => {
  it('lists subscribers with paging, repeated patterns and the filters string', async () => {
    let url: URL | undefined;
    let auth: string | null = null;
    server.use(
      http.get(`${BASE}${PATH}`, ({ request }) => {
        url = new URL(request.url);
        auth = request.headers.get('authorization');
        return HttpResponse.json(page([subscriberFixture]));
      })
    );

    const result = await client.mobile.subscribers.list({
      from: 20,
      to: 40,
      sortBy: 'LASTNAME',
      order: 'ASC',
      patterns: ['jan', 'voorbeeld'],
      filters: 'FIRSTNAME: "Jan"; EMPLOYEE_NUMBER: "EMP-0001"',
      userOnly: false,
    });

    expect(result).toEqual(page([subscriberFixture]));
    expect(auth).toMatch(/^Bearer /);
    expect(url?.searchParams.get('from')).toBe('20');
    expect(url?.searchParams.get('to')).toBe('40');
    expect(url?.searchParams.get('sortBy')).toBe('LASTNAME');
    expect(url?.searchParams.get('order')).toBe('ASC');
    expect(url?.searchParams.getAll('patterns')).toEqual(['jan', 'voorbeeld']);
    expect(url?.searchParams.get('filters')).toBe('FIRSTNAME: "Jan"; EMPLOYEE_NUMBER: "EMP-0001"');
    expect(url?.searchParams.get('userOnly')).toBe('false');
  });

  it('lists without params and sends no query string', async () => {
    let search = 'unset';
    server.use(
      http.get(`${BASE}${PATH}`, ({ request }) => {
        search = new URL(request.url).search;
        return HttpResponse.json(page([subscriberFixture]));
      })
    );
    expect((await client.mobile.subscribers.list()).total).toBe(1);
    expect(search).toBe('');
  });

  it('gets subscriber details by id', async () => {
    let path = '';
    server.use(
      http.get(`${BASE}${PATH}/:id`, ({ request }) => {
        path = new URL(request.url).pathname;
        return HttpResponse.json(subscriberDetailsFixture);
      })
    );
    expect(await client.mobile.subscribers.get(3001)).toEqual(subscriberDetailsFixture);
    expect(path).toBe(`${PATH}/3001`);
  });

  it("lists a subscriber's contracts with paging", async () => {
    let url: URL | undefined;
    server.use(
      http.get(`${BASE}${PATH}/:id/contracts`, ({ request }) => {
        url = new URL(request.url);
        return HttpResponse.json(page([orgContractFixture]));
      })
    );
    const result = await client.mobile.subscribers.listContracts(3001, { from: 0, to: 100 });
    expect(result.result).toEqual([orgContractFixture]);
    expect(url?.pathname).toBe(`${PATH}/3001/contracts`);
    expect(url?.searchParams.get('from')).toBe('0');
    expect(url?.searchParams.get('to')).toBe('100');
  });

  describe('error paths', () => {
    it('401 → AuthenticationError', async () => {
      respondWithError('get', PATH, 401);
      await expect(client.mobile.subscribers.list()).rejects.toBeInstanceOf(AuthenticationError);
    });

    it('403 → ForbiddenError', async () => {
      respondWithError('get', `${PATH}/3001`, 403);
      await expect(client.mobile.subscribers.get(3001)).rejects.toBeInstanceOf(ForbiddenError);
    });

    it('404 → NotFoundError', async () => {
      respondWithError('get', `${PATH}/9999`, 404);
      await expect(client.mobile.subscribers.get(9999)).rejects.toBeInstanceOf(NotFoundError);
    });

    it('429 → RateLimitError', async () => {
      respondWithError('get', PATH, 429);
      await expect(client.mobile.subscribers.list()).rejects.toBeInstanceOf(RateLimitError);
    });

    it('500 → ServerError', async () => {
      respondWithError('get', `${PATH}/3001/contracts`, 500);
      await expect(client.mobile.subscribers.listContracts(3001)).rejects.toBeInstanceOf(ServerError);
    });
  });
});
