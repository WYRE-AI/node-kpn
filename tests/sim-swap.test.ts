import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import {
  AuthenticationError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
  RateLimitError,
  ServerError,
} from '../src/index.js';
import { simSwapFixture, unknownPhoneNumberBody } from './fixtures/network.js';
import { BASE, makeClient, respondWithError } from './helpers.js';
import { server } from './mocks/server.js';

const PATH = '/kpn/sim-swap/retrieve-date';
const PHONE = '+31600000000';
const client = makeClient();

describe('simSwap', () => {
  it('retrieves the latest SIM change date', async () => {
    expect(await client.simSwap.retrieveDate(PHONE)).toEqual(simSwapFixture);
  });

  it('posts the phone number as JSON', async () => {
    let body: unknown;
    server.use(
      http.post(`${BASE}${PATH}`, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json(simSwapFixture);
      })
    );
    await client.simSwap.retrieveDate(PHONE);
    expect(body).toEqual({ phoneNumber: PHONE });
  });

  it('returns null when no SIM change is reported', async () => {
    server.use(http.post(`${BASE}${PATH}`, () => HttpResponse.json({})));
    expect(await client.simSwap.retrieveDate(PHONE)).toEqual({ latestSimChange: null });
  });

  it('404 SIM_SWAP.UNKNOWN_PHONE_NUMBER → NotFoundError with code', async () => {
    respondWithError('post', PATH, 404, unknownPhoneNumberBody);
    const error = await client.simSwap.retrieveDate(PHONE).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(NotFoundError);
    expect((error as NotFoundError).code).toBe('SIM_SWAP.UNKNOWN_PHONE_NUMBER');
  });

  it('409 → ConflictError (concurrent request for the same number)', async () => {
    respondWithError('post', PATH, 409, { status: 409, code: 'CONFLICT', message: 'Conflict' });
    await expect(client.simSwap.retrieveDate(PHONE)).rejects.toBeInstanceOf(ConflictError);
  });

  it('is retried on 502 because it is read-only (idempotent POST)', async () => {
    let hits = 0;
    server.use(
      http.post(`${BASE}${PATH}`, () => {
        hits += 1;
        return hits === 1
          ? HttpResponse.json({}, { status: 502, headers: { 'Retry-After': '0' } })
          : HttpResponse.json(simSwapFixture);
      })
    );
    const retrying = makeClient({ maxRetries: 1 });
    expect(await retrying.simSwap.retrieveDate(PHONE)).toEqual(simSwapFixture);
    expect(hits).toBe(2);
  });

  describe('error paths', () => {
    it.each([
      { status: 401, ErrorClass: AuthenticationError },
      { status: 403, ErrorClass: ForbiddenError },
      { status: 404, ErrorClass: NotFoundError },
      { status: 429, ErrorClass: RateLimitError },
      { status: 500, ErrorClass: ServerError },
    ])('$status → $ErrorClass.name', async ({ status, ErrorClass }) => {
      respondWithError('post', PATH, status);
      await expect(client.simSwap.retrieveDate(PHONE)).rejects.toBeInstanceOf(ErrorClass);
    });
  });
});
