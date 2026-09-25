import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import {
  AuthenticationError,
  ForbiddenError,
  NotFoundError,
  RateLimitError,
  ServerError,
} from '../src/index.js';
import { orgContractFixture, page, thresholdFixture } from './fixtures/mobile-org.js';
import { BASE, makeClient, respondWithError } from './helpers.js';
import { server } from './mocks/server.js';

const PATH = '/mobile/kpn/mobileservices/contract/thresholds';
const client = makeClient();

describe('mobile.thresholds', () => {
  it('lists thresholds as a bare array', async () => {
    expect(await client.mobile.thresholds.list()).toEqual([thresholdFixture]);
  });

  it("lists a threshold's contracts with paging", async () => {
    let url: URL | undefined;
    server.use(
      http.get(`${BASE}${PATH}/:id/contracts`, ({ request }) => {
        url = new URL(request.url);
        return HttpResponse.json(page([orgContractFixture]));
      })
    );
    const result = await client.mobile.thresholds.listContracts(5001, { from: 20, to: 40 });
    expect(result).toEqual(page([orgContractFixture]));
    expect(url?.pathname).toBe(`${PATH}/5001/contracts`);
    expect(url?.searchParams.get('from')).toBe('20');
    expect(url?.searchParams.get('to')).toBe('40');
  });

  describe('error paths', () => {
    it('401 → AuthenticationError', async () => {
      respondWithError('get', PATH, 401);
      await expect(client.mobile.thresholds.list()).rejects.toBeInstanceOf(AuthenticationError);
    });

    it('403 → ForbiddenError', async () => {
      respondWithError('get', PATH, 403);
      await expect(client.mobile.thresholds.list()).rejects.toBeInstanceOf(ForbiddenError);
    });

    it('404 → NotFoundError', async () => {
      respondWithError('get', `${PATH}/9999/contracts`, 404);
      await expect(client.mobile.thresholds.listContracts(9999)).rejects.toBeInstanceOf(NotFoundError);
    });

    it('429 → RateLimitError', async () => {
      respondWithError('get', PATH, 429);
      await expect(client.mobile.thresholds.list()).rejects.toBeInstanceOf(RateLimitError);
    });

    it('500 → ServerError', async () => {
      respondWithError('get', PATH, 500);
      await expect(client.mobile.thresholds.list()).rejects.toBeInstanceOf(ServerError);
    });
  });
});
