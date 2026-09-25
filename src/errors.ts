import type { QuotaInfo } from './http.js';

/**
 * Base error: HTTP status, raw response body, and — when the envelope carries
 * them — the vendor error `code` and KPN `transactionId` (quote it to KPN support).
 */
export class KpnError extends Error {
  constructor(
    message: string,
    public statusCode: number,
    public response: unknown,
    public code?: string,
    public transactionId?: string
  ) {
    super(message);
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** 401, or an Apigee invalid/expired-token fault on any status. `code = 'invalid_client'` from the token endpoint. */
export class AuthenticationError extends KpnError {}

/** 403. The message always carries {@link ENTITLEMENT_HINT} — entitlement failures look like auth failures. */
export class ForbiddenError extends KpnError {}

export class NotFoundError extends KpnError {}

/** 400. `code` carries the MSM error-table code when present. */
export class ValidationError extends KpnError {}

/** 409 (e.g. SIM Swap concurrent request). */
export class ConflictError extends KpnError {}

/** 429. `retryAfter` in seconds (default 5); `quota` is attached by HttpClient from the `quota-*` headers. */
export class RateLimitError extends KpnError {
  retryAfter = 5;
  quota?: QuotaInfo;
}

/** 5xx, carrying the actual status. */
export class ServerError extends KpnError {}

export const ENTITLEMENT_HINT =
  'The KPN project behind these credentials is not entitled to this API product ' +
  '(add it to the project in developer.kpn.com), or the MSM user lacks the required GRIP privilege.';

/** Apigee fault codes that mean "your token is bad" regardless of the HTTP status they arrive with. */
const INVALID_TOKEN_CODES = new Set([
  'oauth.v2.InvalidAccessToken',
  'oauth.v2.AccessTokenExpired',
  'keymanagement.service.invalid_access_token',
]);

interface Parsed {
  message?: string;
  code?: string;
  transactionId?: string;
}

function str(value: unknown): string | undefined {
  if (typeof value === 'string' && value.length > 0) return value;
  if (typeof value === 'number') return String(value);
  return undefined;
}

/**
 * Pull message / code / transactionId out of every KPN error envelope:
 * - Apigee:        {fault:{faultstring, detail:{errorcode}}}
 * - KPN proxy:     {error:{transactionId,status,name,message,info}}
 * - MSM / legacy:  {transactionId,status,name,message,info}
 * - CAMARA:        {status,code,message}   (SIM Swap)
 * - Token endpoint:{ErrorCode,Error}
 * - Fallback:      raw text
 */
function parseEnvelope(body: unknown): Parsed {
  if (typeof body === 'string') return { message: body.trim() || undefined };
  if (body === null || typeof body !== 'object') return {};
  const b = body as Record<string, unknown>;

  const fault = b['fault'] as Record<string, unknown> | undefined;
  if (fault && typeof fault === 'object') {
    const detail = fault['detail'] as Record<string, unknown> | undefined;
    return { message: str(fault['faultstring']), code: str(detail?.['errorcode']) };
  }

  if ('ErrorCode' in b || 'Error' in b) {
    return { message: str(b['Error']), code: str(b['ErrorCode']) };
  }

  // KPN proxy nests the flat MSM shape under `error`.
  const inner =
    b['error'] && typeof b['error'] === 'object' ? (b['error'] as Record<string, unknown>) : b;
  return {
    message: str(inner['message']) ?? str(inner['info']),
    // CAMARA uses `code`; MSM/KPN use `name` (e.g. "Forbidden") or a table code in `info`.
    code: str(inner['code']) ?? str(inner['name']),
    transactionId: str(inner['transactionId']),
  };
}

/** Map a non-2xx KPN response to the matching {@link KpnError} subclass. */
export function parseKpnError(status: number, body: unknown, headers?: Headers): KpnError {
  const { message, code, transactionId } = parseEnvelope(body);
  const args = [body, code, transactionId] as const;

  if (status === 401 || (code !== undefined && INVALID_TOKEN_CODES.has(code))) {
    return new AuthenticationError(message ?? 'Authentication failed', status, ...args);
  }
  switch (status) {
    case 400:
      return new ValidationError(message ?? 'Bad request', status, ...args);
    case 403:
      return new ForbiddenError(message ? `${message}. ${ENTITLEMENT_HINT}` : ENTITLEMENT_HINT, status, ...args);
    case 404:
      return new NotFoundError(message ?? 'Resource not found', status, ...args);
    case 409:
      return new ConflictError(message ?? 'Conflict', status, ...args);
    case 429: {
      const error = new RateLimitError(message ?? 'Rate limit exceeded', status, ...args);
      const retryAfter = Number.parseInt(headers?.get('retry-after') ?? '', 10);
      if (Number.isFinite(retryAfter)) error.retryAfter = retryAfter;
      return error;
    }
  }
  if (status >= 500) return new ServerError(message ?? `Server error: ${status}`, status, ...args);
  return new KpnError(message ?? `HTTP ${status}`, status, ...args);
}
