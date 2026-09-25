import { http, HttpResponse } from 'msw';

import { KpnClient, TokenCache } from '../src/index.js';
import { server } from './mocks/server.js';

export const BASE = 'https://api-prd.kpn.com';

/**
 * A client with fake credentials and a fresh TokenCache (no cross-test token
 * reuse). maxRetries defaults to 0 so error-path tests fail fast. `msm: true`
 * passes separate MSM credentials; `false` exercises the fallback to the
 * main project credentials.
 */
export function makeClient({ maxRetries = 0, msm = true }: { maxRetries?: number; msm?: boolean } = {}): KpnClient {
  return new KpnClient({
    clientId: 'test-client-id',
    clientSecret: 'test-client-secret',
    ...(msm ? { msmClientId: 'test-msm-client-id', msmClientSecret: 'test-msm-client-secret' } : {}),
    maxRetries,
    tokenCache: new TokenCache(),
  });
}

type Method = 'get' | 'post' | 'put' | 'patch' | 'delete';

/** Representative KPN error envelopes per status. */
const DEFAULT_BODIES: Record<number, unknown> = {
  400: { transactionId: 'tx-400', status: 400, name: 'Bad Request', message: 'Invalid request' },
  401: { fault: { faultstring: 'Invalid access token', detail: { errorcode: 'oauth.v2.InvalidAccessToken' } } },
  403: { error: { transactionId: 'tx-403', status: 403, name: 'Forbidden', message: 'Access denied' } },
  404: { transactionId: 'tx-404', status: 404, name: 'Not Found', message: 'Resource not found' },
  409: { status: 409, code: 'CONFLICT', message: 'Concurrent request' },
  429: { fault: { faultstring: 'Rate limit quota violation', detail: { errorcode: 'policies.ratelimit.QuotaViolation' } } },
  500: { transactionId: 'tx-500', status: 500, name: 'Internal Server Error', message: 'Unexpected error' },
};

/**
 * Override one route (path relative to BASE, product prefix included) to
 * answer a fixed error status. Reset by afterEach.
 */
export function respondWithError(method: Method, path: string, status: number, body?: unknown): void {
  server.use(
    http[method](`${BASE}${path}`, () =>
      HttpResponse.json((body ?? DEFAULT_BODIES[status] ?? { message: `HTTP ${status}` }) as never, { status })
    )
  );
}
