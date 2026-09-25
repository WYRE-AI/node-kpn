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
  serviceRequestDetailsFixture,
  serviceRequestFixture,
} from './fixtures/mobile-orders.js';
import { BASE, makeClient, respondWithError } from './helpers.js';
import { server } from './mocks/server.js';

const PATH = '/mobile/kpn/mobileservices/track-and-trace/service-requests';
const client = makeClient();

describe('mobile.serviceRequests', () => {
  it('lists with repeated status keys, patterns and Content-Language', async () => {
    let url: URL | undefined;
    let language: string | null = null;
    server.use(
      http.get(`${BASE}${PATH}`, ({ request }) => {
        url = new URL(request.url);
        language = request.headers.get('content-language');
        return HttpResponse.json(msmPage([serviceRequestFixture]));
      })
    );

    const result = await client.mobile.serviceRequests.list({
      status: ['NEW', 'IN_PROGRESS'],
      patterns: ['0600000001'],
      currentUserOrdersOnly: true,
      language: 'en',
      from: 20,
      to: 40,
    });

    expect(result).toEqual(msmPage([serviceRequestFixture]));
    expect(language).toBe('en');
    expect(url?.searchParams.getAll('status')).toEqual(['NEW', 'IN_PROGRESS']);
    expect(url?.searchParams.getAll('patterns')).toEqual(['0600000001']);
    expect(url?.searchParams.get('currentUserOrdersOnly')).toBe('true');
    expect(url?.searchParams.get('from')).toBe('20');
    expect(url?.searchParams.get('to')).toBe('40');
    expect(url?.searchParams.has('language')).toBe(false);
  });

  it('gets service request details', async () => {
    expect(await client.mobile.serviceRequests.get(8001)).toEqual(serviceRequestDetailsFixture);
  });

  describe('error paths', () => {
    it('401 → AuthenticationError', async () => {
      respondWithError('get', PATH, 401);
      await expect(client.mobile.serviceRequests.list({ status: ['NEW'] })).rejects.toBeInstanceOf(
        AuthenticationError
      );
    });

    it('403 → ForbiddenError', async () => {
      respondWithError('get', PATH, 403);
      await expect(client.mobile.serviceRequests.list({ status: ['NEW'] })).rejects.toBeInstanceOf(
        ForbiddenError
      );
    });

    it('404 → NotFoundError', async () => {
      respondWithError('get', `${PATH}/:id`, 404);
      await expect(client.mobile.serviceRequests.get(9999)).rejects.toBeInstanceOf(NotFoundError);
    });

    it('429 → RateLimitError', async () => {
      respondWithError('get', `${PATH}/:id`, 429);
      await expect(client.mobile.serviceRequests.get(8001)).rejects.toBeInstanceOf(RateLimitError);
    });

    it('500 → ServerError', async () => {
      respondWithError('get', PATH, 500);
      await expect(client.mobile.serviceRequests.list({ status: ['NEW'] })).rejects.toBeInstanceOf(
        ServerError
      );
    });
  });
});
