import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import {
  AuthenticationError,
  ForbiddenError,
  NotFoundError,
  RateLimitError,
  ServerError,
} from '../src/index.js';
import { hierarchyDetailsFixture, hierarchyItemFixture, page } from './fixtures/mobile-org.js';
import { BASE, makeClient, respondWithError } from './helpers.js';
import { server } from './mocks/server.js';

const PATH = '/mobile/kpn/mobileservices/hierarchy/children';
const client = makeClient();

describe('mobile.hierarchy', () => {
  it('lists children of a parent with all query params', async () => {
    let url: URL | undefined;
    server.use(
      http.get(`${BASE}${PATH}`, ({ request }) => {
        url = new URL(request.url);
        return HttpResponse.json(page([hierarchyItemFixture]));
      })
    );

    const result = await client.mobile.hierarchy.listChildren({
      id: 1001,
      pattern: 'voorbeeld',
      includeCustomer: true,
      includeGroups: true,
      from: 0,
      to: 20,
    });

    expect(result).toEqual(page([hierarchyItemFixture]));
    expect(url?.searchParams.get('id')).toBe('1001');
    expect(url?.searchParams.get('pattern')).toBe('voorbeeld');
    expect(url?.searchParams.get('includeCustomer')).toBe('true');
    expect(url?.searchParams.get('includeGroups')).toBe('true');
    expect(url?.searchParams.get('from')).toBe('0');
    expect(url?.searchParams.get('to')).toBe('20');
  });

  it('omits id to list the roots', async () => {
    let url: URL | undefined;
    server.use(
      http.get(`${BASE}${PATH}`, ({ request }) => {
        url = new URL(request.url);
        return HttpResponse.json(page([hierarchyItemFixture]));
      })
    );
    await client.mobile.hierarchy.listChildren({ includeCustomer: true });
    expect(url?.searchParams.has('id')).toBe(false);
    expect(url?.searchParams.get('includeCustomer')).toBe('true');
  });

  it('gets item details by id', async () => {
    let path = '';
    server.use(
      http.get(`${BASE}${PATH}/:id`, ({ request }) => {
        path = new URL(request.url).pathname;
        return HttpResponse.json(hierarchyDetailsFixture);
      })
    );
    const details = await client.mobile.hierarchy.get(2001);
    expect(details).toEqual(hierarchyDetailsFixture);
    expect(details.debtor?.krnNumber).toBe('KRN-0000001');
    expect(path).toBe(`${PATH}/2001`);
  });

  describe('error paths', () => {
    it('401 → AuthenticationError', async () => {
      respondWithError('get', PATH, 401);
      await expect(client.mobile.hierarchy.listChildren()).rejects.toBeInstanceOf(AuthenticationError);
    });

    it('403 → ForbiddenError', async () => {
      respondWithError('get', PATH, 403);
      await expect(client.mobile.hierarchy.listChildren()).rejects.toBeInstanceOf(ForbiddenError);
    });

    it('404 → NotFoundError', async () => {
      respondWithError('get', `${PATH}/9999`, 404);
      await expect(client.mobile.hierarchy.get(9999)).rejects.toBeInstanceOf(NotFoundError);
    });

    it('429 → RateLimitError', async () => {
      respondWithError('get', PATH, 429);
      await expect(client.mobile.hierarchy.listChildren()).rejects.toBeInstanceOf(RateLimitError);
    });

    it('500 → ServerError', async () => {
      respondWithError('get', `${PATH}/2001`, 500);
      await expect(client.mobile.hierarchy.get(2001)).rejects.toBeInstanceOf(ServerError);
    });
  });
});
