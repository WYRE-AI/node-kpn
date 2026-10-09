import { createHash } from 'node:crypto';

import { assertGrexxHttpsUrl } from './config.js';
import { GrexxAuthenticationError, GrexxError, GrexxServerError, isRedirectError, parseGrexxError } from './errors.js';

/** Re-mint this long before `expires_in` (observed 3599s on acceptatie). */
export const GREXX_EXPIRY_MARGIN_MS = 60_000;

const DEFAULT_TOKEN_TIMEOUT_MS = 30_000;

/** Hard-coded acceptatie scope. Not caller-configurable. */
export const GREXX_TOKEN_SCOPE = 'all';

/**
 * RFC 6749 §2.3.1 / Appendix B (`application/x-www-form-urlencoded`) encoding
 * for HTTP Basic client credentials. Unreserved characters stay as-is, a space
 * is `+`, and every other character is percent-encoded. Applied before base64.
 */
function encodeRfc6749Component(value: string): string {
  return encodeURIComponent(value)
    .replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`)
    .replace(/%20/g, '+');
}

/** `Basic base64(encode(client_id) + ":" + encode(client_secret))`. */
function grexxBasicAuthorization(clientId: string, clientSecret: string): string {
  const encoded = `${encodeRfc6749Component(clientId)}:${encodeRfc6749Component(clientSecret)}`;
  return `Basic ${Buffer.from(encoded, 'utf8').toString('base64')}`;
}

export interface GrexxToken {
  accessToken: string;
  /** Local epoch ms at which the token expires (`expires_in`, no margin applied). */
  expiresAt: number;
  tokenType: 'Bearer';
}

/**
 * Process-wide token cache. HTTP-mode servers build a fresh client per request,
 * so a per-client cache would mint a token per call. Bounded: when full, the
 * oldest-inserted entry is evicted.
 */
export class GrexxTokenCache {
  private readonly entries = new Map<string, GrexxToken>();

  constructor(private readonly maxEntries: number = 500) {}

  get(key: string): GrexxToken | undefined {
    return this.entries.get(key);
  }

  set(key: string, token: GrexxToken): void {
    this.entries.delete(key);
    if (this.entries.size >= this.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (oldest !== undefined) this.entries.delete(oldest);
    }
    this.entries.set(key, token);
  }

  delete(key: string): void {
    this.entries.delete(key);
  }

  clear(): void {
    this.entries.clear();
  }

  get size(): number {
    return this.entries.size;
  }
}

export const defaultGrexxTokenCache = new GrexxTokenCache();

/** Concurrent mints for the same key share one request (single-flight). */
const inFlight = new Map<string, Promise<GrexxToken>>();

export interface GrexxTokenProviderOptions {
  tokenUrl: string;
  clientId: string;
  clientSecret: string;
  cache?: GrexxTokenCache;
  timeoutMs?: number;
  /** Clock override for tests. Defaults to `Date.now`. */
  now?: () => number;
}

/**
 * Grexx OAuth 2.0 client_credentials.
 *
 * Acceptatie rejects `client_id` / `client_secret` in the form body
 * (`HTTP 400 invalid_client`) and accepts HTTP Basic. The first request is
 * `Authorization: Basic` (RFC 6749 §2.3.1) with body
 * `grant_type=client_credentials&scope=all`. Form-body client credentials are
 * sent only when Basic returns HTTP 400 or 401 `invalid_client`.
 * Network errors, timeouts, redirects, and other non-2xx responses throw
 * {@link GrexxAuthenticationError} and do not return a token.
 */
export class GrexxTokenProvider {
  private readonly key: string;
  private readonly cache: GrexxTokenCache;
  private readonly timeoutMs: number;
  private readonly now: () => number;

  constructor(private readonly opts: GrexxTokenProviderOptions) {
    this.cache = opts.cache ?? defaultGrexxTokenCache;
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_TOKEN_TIMEOUT_MS;
    this.now = opts.now ?? Date.now;
    this.key = createHash('sha256')
      .update([opts.tokenUrl, opts.clientId, opts.clientSecret].join('\n'))
      .digest('hex');
  }

  async authorizationHeader(): Promise<string> {
    const token = await this.getToken();
    return `Bearer ${token.accessToken}`;
  }

  /** Drop the cached token so the next {@link getToken} mints again (used on HTTP 401). */
  invalidate(): void {
    this.cache.delete(this.key);
  }

  /** Cached token when it is still outside the 60s expiry margin, otherwise a fresh mint. */
  async getToken(): Promise<GrexxToken> {
    const cached = this.cache.get(this.key);
    if (cached && this.now() < cached.expiresAt - GREXX_EXPIRY_MARGIN_MS) return cached;

    let pending = inFlight.get(this.key);
    if (!pending) {
      pending = this.mint().finally(() => inFlight.delete(this.key));
      inFlight.set(this.key, pending);
    }
    return pending;
  }

  private async mint(): Promise<GrexxToken> {
    const basic = await this.requestToken(
      grexxBasicAuthorization(this.opts.clientId, this.opts.clientSecret),
      new URLSearchParams({
        grant_type: 'client_credentials',
        scope: GREXX_TOKEN_SCOPE,
      }),
    );
    if (basic.ok) return basic.token;
    if (!isInvalidClient(basic.status, basic.body)) throw basic.error;

    const form = await this.requestToken(
      undefined,
      new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: this.opts.clientId,
        client_secret: this.opts.clientSecret,
        scope: GREXX_TOKEN_SCOPE,
      }),
    );
    if (form.ok) return form.token;
    throw formFallbackError(form, this.opts.clientSecret);
  }

  private async requestToken(
    authorization: string | undefined,
    params: URLSearchParams,
  ): Promise<{ ok: true; token: GrexxToken } | { ok: false; status: number; body: unknown; error: GrexxAuthenticationError }> {
    assertGrexxHttpsUrl(this.opts.tokenUrl, 'tokenUrl');

    let response: Response;
    try {
      response = await fetch(this.opts.tokenUrl, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/x-www-form-urlencoded',
          ...(authorization ? { Authorization: authorization } : {}),
        },
        body: params.toString(),
        redirect: 'error',
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (err) {
      throw tokenTransportError(err);
    }

    const rawText = await response.text();
    let parsed: unknown = rawText;
    if (rawText.length > 0) {
      try {
        parsed = JSON.parse(rawText);
      } catch {
        parsed = rawText;
      }
    }

    const requestId = response.headers.get('x-request-id') ?? undefined;
    if (!response.ok) {
      const error = parseGrexxError(response.status, redactSecrets(parsed, this.opts.clientSecret), response.headers, requestId, {
        tokenEndpoint: true,
      });
      return { ok: false, status: response.status, body: parsed, error: error as GrexxAuthenticationError };
    }

    return { ok: true, token: this.parseToken(response.status, parsed, requestId) };
  }

  private parseToken(status: number, parsed: unknown, requestId: string | undefined): GrexxToken {
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new GrexxAuthenticationError(
        'Grexx token endpoint returned a non-JSON body. Refusing to call /realtime without a token.',
        status,
        parsed,
        'invalid_token_response',
        requestId,
      );
    }

    const record = parsed as Record<string, unknown>;
    const redacted = redactTokenResponse(record);
    const accessToken = record['access_token'];
    if (typeof accessToken !== 'string' || accessToken.length === 0 || /[\r\n]/.test(accessToken)) {
      throw new GrexxAuthenticationError(
        'Grexx token endpoint returned no access_token. Refusing to call /realtime without a token.',
        status,
        redacted,
        'invalid_token_response',
        requestId,
      );
    }

    const tokenType = typeof record['token_type'] === 'string' ? record['token_type'] : 'Bearer';
    if (tokenType.toLowerCase() !== 'bearer') {
      throw new GrexxAuthenticationError(
        `Grexx token endpoint returned token_type "${tokenType}", expected Bearer. Refusing to call /realtime.`,
        status,
        redacted,
        'invalid_token_response',
        requestId,
      );
    }

    const expiresInRaw = record['expires_in'];
    const expiresIn =
      typeof expiresInRaw === 'number'
        ? expiresInRaw
        : typeof expiresInRaw === 'string'
          ? Number(expiresInRaw)
          : Number.NaN;
    if (!Number.isFinite(expiresIn) || expiresIn <= 0) {
      throw new GrexxAuthenticationError(
        'Grexx token endpoint returned no expires_in. Refusing to call /realtime without a token.',
        status,
        redacted,
        'invalid_token_response',
        requestId,
      );
    }

    const token: GrexxToken = {
      accessToken,
      expiresAt: this.now() + expiresIn * 1000,
      tokenType: 'Bearer',
    };
    this.cache.set(this.key, token);
    return token;
  }
}

/** HTTP 400/401 whose OAuth error is `invalid_client` (JSON or the acceptatie text). */
function isInvalidClient(status: number, body: unknown): boolean {
  if (status !== 400 && status !== 401) return false;
  if (typeof body === 'string') return /invalid[_ -]?client/i.test(body);
  if (body === null || typeof body !== 'object' || Array.isArray(body)) return false;
  const record = body as Record<string, unknown>;
  const error = record['error'];
  const description = record['error_description'];
  if (error === 'invalid_client') return true;
  if (typeof error === 'string' && /invalid[_ -]?client/i.test(error)) return true;
  if (typeof description === 'string' && /invalid[_ -]?client/i.test(description)) return true;
  return false;
}

function formFallbackError(
  form: { status: number; body: unknown; error: GrexxAuthenticationError },
  clientSecret: string,
): GrexxError {
  const reason = redactSecretText(form.error.message, clientSecret);
  const response = redactSecrets(form.body, clientSecret);
  if (isInvalidClient(form.status, form.body)) {
    return new GrexxAuthenticationError(
      `Grexx token endpoint rejected HTTP Basic authentication and form-body client credentials: ${reason}`,
      form.status,
      response,
      form.error.code ?? 'invalid_client',
      form.error.requestId,
    );
  }
  if (form.status >= 500) {
    return new GrexxServerError(
      `Grexx token endpoint is unavailable after the HTTP Basic attempt. The form-body attempt failed: ${reason}`,
      form.status,
      response,
      form.error.code ?? 'token_endpoint_unavailable',
      form.error.requestId,
    );
  }
  return new GrexxAuthenticationError(
    `Grexx token endpoint failed after the HTTP Basic attempt. The form-body attempt failed: ${reason}`,
    form.status,
    response,
    form.error.code,
    form.error.requestId,
  );
}

function redactSecretText(value: string, secret: string): string {
  const redacted = redactSecrets(value, secret);
  return typeof redacted === 'string' ? redacted : value;
}

function redactSecrets(value: unknown, secret: string): unknown {
  if (secret.length === 0) return value;
  if (typeof value === 'string') return value.split(secret).join('[redacted]');
  if (Array.isArray(value)) return value.map((item) => redactSecrets(item, secret));
  if (value !== null && typeof value === 'object') {
    const redacted: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      redacted[key] = redactSecrets(item, secret);
    }
    return redacted;
  }
  return value;
}

function redactTokenResponse(record: Record<string, unknown>): Record<string, unknown> {
  const redacted = { ...record };
  if ('access_token' in redacted) redacted['access_token'] = '[redacted]';
  if ('refresh_token' in redacted) redacted['refresh_token'] = '[redacted]';
  return redacted;
}

function tokenTransportError(err: unknown): GrexxAuthenticationError {
  const name = err instanceof Error ? err.name : '';
  const timedOut = name === 'TimeoutError' || name === 'AbortError';
  const redirected = isRedirectError(err);
  const code = timedOut ? 'token_endpoint_timeout' : redirected ? 'token_endpoint_redirect' : 'token_endpoint_unreachable';
  const detail = timedOut
    ? 'Grexx token endpoint timed out. Refusing to call /realtime without a token.'
    : redirected
      ? 'Grexx token endpoint redirected. Refusing to follow redirects or call /realtime without a token.'
      : 'Grexx token endpoint request failed. Refusing to call /realtime without a token.';
  return new GrexxAuthenticationError(detail, 0, undefined, code, undefined, { cause: err });
}
