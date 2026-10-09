/**
 * Typed errors for the Grexx/IRMA client.
 *
 * Token-endpoint failures are always {@link GrexxAuthenticationError} and must
 * not be retried into `/realtime` — the client fails closed without a Bearer token.
 * The token request uses HTTP Basic, then form-body credentials only after
 * `invalid_client`. `/realtime` itself is Bearer only.
 */
export class GrexxError extends Error {
  readonly statusCode: number;
  readonly response: unknown;
  readonly code: string | undefined;
  readonly requestId: string | undefined;

  constructor(
    message: string,
    statusCode: number,
    response?: unknown,
    code?: string,
    requestId?: string,
    options?: { cause?: unknown },
  ) {
    super(message, options?.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = new.target.name;
    Object.setPrototypeOf(this, new.target.prototype);
    this.statusCode = statusCode;
    this.response = response;
    this.code = code;
    this.requestId = requestId;
  }
}

/** OAuth token failure, HTTP 401, or a rejected remint. The call did not proceed with a bad token. */
export class GrexxAuthenticationError extends GrexxError {}

/** HTTP 403, or IRMA code 102 (IP not allowed). */
export class GrexxForbiddenError extends GrexxError {}

/** Caller input or Grexx `ValidationError` / HTTP 400. */
export class GrexxValidationError extends GrexxError {}

export class GrexxNotFoundError extends GrexxError {}

/**
 * HTTP 429 or IRMA code 108 (Too Many Requests).
 * `retryAfter` is seconds (default 5).
 */
export class GrexxRateLimitError extends GrexxError {
  retryAfter = 5;
}

/** HTTP 5xx, network failure on `/realtime`, or Grexx `UnknownError`. */
export class GrexxServerError extends GrexxError {}

/** Missing or rejected local configuration. Not an HTTP error. */
export class GrexxConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GrexxConfigError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export interface GrexxErrorHints {
  /** When set, every non-2xx is an authentication failure (fail closed, no /realtime). */
  tokenEndpoint?: boolean;
  code?: string;
  message?: string;
}

function str(value: unknown): string | undefined {
  if (typeof value === 'string' && value.trim().length > 0) return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return undefined;
}

function describeBody(body: unknown): { message?: string; code?: string } {
  if (typeof body === 'string') return { message: body.trim() || undefined };
  if (body === null || typeof body !== 'object') return {};
  const record = body as Record<string, unknown>;

  if (typeof record['error'] === 'string') {
    return {
      code: record['error'],
      message: str(record['error_description']) ?? record['error'],
    };
  }
  if (record['error'] && typeof record['error'] === 'object') {
    const inner = record['error'] as Record<string, unknown>;
    return {
      message: str(inner['message']) ?? str(inner['error_description']) ?? str(inner['info']),
      code: str(inner['code']) ?? str(inner['error']) ?? str(inner['name']),
    };
  }
  return {
    message: str(record['message']) ?? str(record['Message']) ?? str(record['error_description']),
    code: str(record['code']) ?? str(record['Code']),
  };
}

/**
 * Node's `fetch` with `redirect: 'error'` throws `TypeError: fetch failed`
 * and puts the redirect text on `error.cause` (`unexpected redirect`).
 */
export function isRedirectError(err: unknown): boolean {
  return /redirect/i.test(errorMessages(err));
}

function errorMessages(err: unknown): string {
  if (!(err instanceof Error)) return String(err);
  const cause = err.cause;
  const causeText = cause instanceof Error ? cause.message : typeof cause === 'string' ? cause : '';
  return causeText.length > 0 ? `${err.message}\n${causeText}` : err.message;
}

/** Map a Grexx or OAuth failure onto the typed error hierarchy. */
export function parseGrexxError(
  status: number,
  body: unknown,
  headers?: Headers,
  requestId?: string,
  hints?: GrexxErrorHints,
): GrexxError {
  const described = describeBody(body);
  const code = hints?.code ?? described.code;
  const message = hints?.message || described.message;
  const id = requestId ?? headers?.get('x-request-id') ?? undefined;

  if (hints?.tokenEndpoint) {
    const detail = message ?? `Grexx token endpoint failed with HTTP ${status}.`;
    const closed = detail.includes('Refusing to call /realtime')
      ? detail
      : `${detail.replace(/[.?!]\s*$/, '')}. Refusing to call /realtime without a token.`;
    return new GrexxAuthenticationError(closed, status, body, code ?? 'token_endpoint_error', id);
  }

  if (code === '108' || status === 429) {
    const error = new GrexxRateLimitError(
      message ?? 'Grexx rate limit exceeded (108 Too Many Requests)',
      status,
      body,
      code ?? '108',
      id,
    );
    const retryAfter = Number.parseInt(headers?.get('retry-after') ?? '', 10);
    if (Number.isFinite(retryAfter) && retryAfter >= 0) error.retryAfter = retryAfter;
    return error;
  }

  if (
    status === 401 ||
    code === 'invalid_client' ||
    code === 'unauthorized_client' ||
    code === 'invalid_grant'
  ) {
    return new GrexxAuthenticationError(message ?? 'Authentication failed', status, body, code, id);
  }
  if (status === 403 || code === '102') {
    return new GrexxForbiddenError(message ?? 'Forbidden', status, body, code, id);
  }
  if (status === 400 || code === 'ValidationError') {
    return new GrexxValidationError(message ?? 'Validation error', status, body, code, id);
  }
  if (status === 404) {
    return new GrexxNotFoundError(message ?? 'Not found', status, body, code, id);
  }
  if (code === 'UnknownError' || status >= 500) {
    return new GrexxServerError(message ?? `Server error: ${status}`, status, body, code, id);
  }
  return new GrexxError(message ?? (code ? `Grexx request failed (${code})` : `HTTP ${status}`), status, body, code, id);
}
