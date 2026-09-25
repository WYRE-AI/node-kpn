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
  address,
  availabilityDocsWireFixture,
  availabilityResultFixture,
  availabilityWireFixture,
} from './fixtures/network.js';
import { BASE, makeClient, respondWithError } from './helpers.js';
import { server } from './mocks/server.js';

const PATH = '/network/kpn/internet-speed-check/offer';
const client = makeClient();

describe('availability', () => {
  it('gets availability by address (OAS shape, empty alerts object → [])', async () => {
    expect(await client.availability.getByAddress(address)).toEqual(availabilityResultFixture);
  });

  it('posts the address as service_address with an integer house number', async () => {
    let body: unknown;
    server.use(
      http.post(`${BASE}${PATH}`, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json(availabilityWireFixture);
      })
    );
    await client.availability.getByAddress(address);
    expect(body).toEqual({
      service_address: { zip_code: '1234AB', house_number: 10, house_number_extension: 'A' },
    });
  });

  it('normalizes max_bandwidth → bandwidth and an alerts object → array', async () => {
    server.use(http.post(`${BASE}${PATH}`, () => HttpResponse.json(availabilityDocsWireFixture)));
    const result = await client.availability.getByAddress(address);
    expect(result.bandwidth).toEqual({ up: 2, down: 16 });
    expect(result).not.toHaveProperty('max_bandwidth');
    expect(result.alerts).toEqual([availabilityDocsWireFixture.alerts]);
  });

  it('keeps alerts that are already an array', async () => {
    const alerts = [{ code: '10' }, { code: '11' }];
    server.use(http.post(`${BASE}${PATH}`, () => HttpResponse.json({ alerts })));
    expect((await client.availability.getByAddress(address)).alerts).toEqual(alerts);
  });

  it('defaults alerts to [] when absent', async () => {
    server.use(http.post(`${BASE}${PATH}`, () => HttpResponse.json({})));
    expect(await client.availability.getByAddress(address)).toEqual({ alerts: [] });
  });

  it('is retried on 502 because it is read-only (idempotent POST)', async () => {
    let hits = 0;
    server.use(
      http.post(`${BASE}${PATH}`, () => {
        hits += 1;
        return hits === 1
          ? HttpResponse.json({}, { status: 502, headers: { 'Retry-After': '0' } })
          : HttpResponse.json(availabilityWireFixture);
      })
    );
    const retrying = makeClient({ maxRetries: 1 });
    expect(await retrying.availability.getByAddress(address)).toEqual(availabilityResultFixture);
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
      await expect(client.availability.getByAddress(address)).rejects.toBeInstanceOf(ErrorClass);
    });
  });
});
