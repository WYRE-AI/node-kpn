import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import {
  AuthenticationError,
  ForbiddenError,
  NotFoundError,
  RateLimitError,
  ServerError,
} from '../src/index.js';
import { address, disturbanceResultFixture } from './fixtures/network.js';
import { BASE, makeClient, respondWithError } from './helpers.js';
import { server } from './mocks/server.js';

const PATH = '/network/kpn/disturbance-check/address';
const client = makeClient();

describe('disturbances', () => {
  it('gets disturbances by address', async () => {
    expect(await client.disturbances.getByAddress(address)).toEqual(disturbanceResultFixture);
  });

  it('serializes the address as snake_case query params', async () => {
    let url: URL | undefined;
    server.use(
      http.get(`${BASE}${PATH}`, ({ request }) => {
        url = new URL(request.url);
        return HttpResponse.json(disturbanceResultFixture);
      })
    );
    await client.disturbances.getByAddress(address);
    expect(url?.searchParams.get('zip_code')).toBe('1234AB');
    expect(url?.searchParams.get('house_number')).toBe('10');
    expect(url?.searchParams.get('house_number_extension')).toBe('A');
  });

  it('omits house_number_extension when not given', async () => {
    let url: URL | undefined;
    server.use(
      http.get(`${BASE}${PATH}`, ({ request }) => {
        url = new URL(request.url);
        return HttpResponse.json(disturbanceResultFixture);
      })
    );
    await client.disturbances.getByAddress({ zipCode: '1234AB', houseNumber: '10' });
    expect(url?.searchParams.has('house_number_extension')).toBe(false);
  });

  it('defaults absent categories to empty arrays', async () => {
    server.use(http.get(`${BASE}${PATH}`, () => HttpResponse.json({ fixed: [] })));
    expect(await client.disturbances.getByAddress(address)).toEqual({
      broadband: [],
      fixed: [],
      mobile: [],
      generic: [],
    });
  });

  it('passes address alerts through', async () => {
    const alerts = [{ code: '10', description: 'Address not found' }];
    server.use(http.get(`${BASE}${PATH}`, () => HttpResponse.json({ alerts })));
    const result = await client.disturbances.getByAddress(address);
    expect(result.alerts).toEqual(alerts);
    expect(result.broadband).toEqual([]);
  });

  describe('error paths', () => {
    it.each([
      { status: 401, ErrorClass: AuthenticationError },
      { status: 403, ErrorClass: ForbiddenError },
      { status: 404, ErrorClass: NotFoundError },
      { status: 429, ErrorClass: RateLimitError },
      { status: 500, ErrorClass: ServerError },
    ])('$status → $ErrorClass.name', async ({ status, ErrorClass }) => {
      respondWithError('get', PATH, status);
      await expect(client.disturbances.getByAddress(address)).rejects.toBeInstanceOf(ErrorClass);
    });
  });
});
