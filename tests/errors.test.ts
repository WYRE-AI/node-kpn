import { describe, expect, it } from 'vitest';

import {
  AuthenticationError,
  ConflictError,
  ENTITLEMENT_HINT,
  ForbiddenError,
  KpnError,
  NotFoundError,
  RateLimitError,
  ServerError,
  ValidationError,
  parseKpnError,
} from '../src/index.js';

describe('parseKpnError envelopes', () => {
  it('Apigee fault: code = errorcode, message = faultstring', () => {
    const err = parseKpnError(400, {
      fault: { faultstring: 'Bad thing', detail: { errorcode: 'steps.x.Failed' } },
    });
    expect(err).toBeInstanceOf(ValidationError);
    expect(err.message).toBe('Bad thing');
    expect(err.code).toBe('steps.x.Failed');
  });

  it('KPN proxy {error:{...}}: message, name as code, transactionId', () => {
    const err = parseKpnError(404, {
      error: { transactionId: 'tx-1', status: 404, name: 'NotFound', message: 'No such thing' },
    });
    expect(err).toBeInstanceOf(NotFoundError);
    expect(err.message).toBe('No such thing');
    expect(err.code).toBe('NotFound');
    expect(err.transactionId).toBe('tx-1');
  });

  it('MSM flat envelope', () => {
    const err = parseKpnError(400, {
      transactionId: 'tx-2', status: 400, name: 'INVALID_SIM', message: 'SIM card number invalid',
    });
    expect(err).toBeInstanceOf(ValidationError);
    expect(err.code).toBe('INVALID_SIM');
    expect(err.transactionId).toBe('tx-2');
  });

  it('CAMARA (SIM Swap): code wins over name', () => {
    const err = parseKpnError(404, {
      status: 404, code: 'SIM_SWAP.UNKNOWN_PHONE_NUMBER', message: 'Unknown phone number',
    });
    expect(err).toBeInstanceOf(NotFoundError);
    expect(err.code).toBe('SIM_SWAP.UNKNOWN_PHONE_NUMBER');
  });

  it('token endpoint {ErrorCode,Error} → AuthenticationError(invalid_client)', () => {
    const err = parseKpnError(401, { ErrorCode: 'invalid_client', Error: 'ClientId is Invalid' });
    expect(err).toBeInstanceOf(AuthenticationError);
    expect(err.code).toBe('invalid_client');
    expect(err.message).toBe('ClientId is Invalid');
  });

  it('falls back to raw text', () => {
    const err = parseKpnError(502, '<html>bad gateway</html>');
    expect(err).toBeInstanceOf(ServerError);
    expect(err.message).toBe('<html>bad gateway</html>');
    expect(err.statusCode).toBe(502);
  });

  it('uses a default message for an empty body', () => {
    expect(parseKpnError(500, undefined).message).toBe('Server error: 500');
  });
});

describe('parseKpnError status mapping', () => {
  it.each([
    [400, ValidationError],
    [401, AuthenticationError],
    [403, ForbiddenError],
    [404, NotFoundError],
    [409, ConflictError],
    [429, RateLimitError],
    [500, ServerError],
    [503, ServerError],
  ])('%i → %o', (status, cls) => {
    const err = parseKpnError(status, {});
    expect(err).toBeInstanceOf(cls);
    expect(err).toBeInstanceOf(KpnError);
    expect(err.statusCode).toBe(status);
  });

  it('other 4xx → bare KpnError', () => {
    const err = parseKpnError(418, {});
    expect(err.constructor).toBe(KpnError);
  });

  it.each(['oauth.v2.InvalidAccessToken', 'oauth.v2.AccessTokenExpired', 'keymanagement.service.invalid_access_token'])(
    'Apigee %s fault on a non-401 status → AuthenticationError',
    (errorcode) => {
      const err = parseKpnError(500, { fault: { faultstring: 'bad token', detail: { errorcode } } });
      expect(err).toBeInstanceOf(AuthenticationError);
      expect(err.statusCode).toBe(500);
    }
  );

  it('403 message carries the entitlement / GRIP hint', () => {
    const err = parseKpnError(403, { error: { name: 'Forbidden', message: 'Access denied' } });
    expect(err.message).toBe(`Access denied. ${ENTITLEMENT_HINT}`);
    expect(ENTITLEMENT_HINT).toContain('not entitled to this API product');
    expect(ENTITLEMENT_HINT).toContain('GRIP privilege');
    expect(parseKpnError(403, undefined).message).toBe(ENTITLEMENT_HINT);
  });

  it('429 reads Retry-After seconds (default 5)', () => {
    const withHeader = parseKpnError(429, {}, new Headers({ 'retry-after': '12' })) as RateLimitError;
    expect(withHeader.retryAfter).toBe(12);
    expect((parseKpnError(429, {}) as RateLimitError).retryAfter).toBe(5);
  });

  it('preserves the raw response body', () => {
    const body = { transactionId: 'tx', message: 'm' };
    expect(parseKpnError(400, body).response).toBe(body);
  });
});
