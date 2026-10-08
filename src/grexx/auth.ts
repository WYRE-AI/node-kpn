import { createHash } from 'node:crypto';

import { GrexxAuthenticationError, isRedirectError, parseGrexxError } from './errors.js';

/** Re-mint this long before `expires_in` (observed 3599s on acceptatie). */
export const GREXX_EXPIRY_MARGIN_MS = 60_000;

const DEFAULT_TOKEN_TIMEOUT_MS = 30_000;

/** Hard-coded acceptatie scope. Not caller-configurable. */
export const GREXX_TOKEN_SCOPE = 'all';

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
 * POST {tokenUrl} `application/x-www-form-urlencoded`:
 * `grant_type=client_credentials&client_id&client_secret&scope=all`.
 * No Authorization header is sent. Basic Auth is not a fallback.
 * Network errors, timeouts, redirects, and non-2xx responses throw
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
    const body = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: this.opts.clientId,
      client_secret: this.opts.clientSecret,
      scope: GREXX_TOKEN_SCOPE,
    });

    let response: Response;
    try {
      response = await fetch(this.opts.tokenUrl, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: body.toString(),
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
      throw parseGrexxError(response.status, parsed, response.headers, requestId, { tokenEndpoint: true });
    }

    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new GrexxAuthenticationError(
        'Grexx token endpoint returned a non-JSON body. Refusing to call /realtime without a token.',
        response.status,
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
        response.status,
        redacted,
        'invalid_token_response',
        requestId,
      );
    }

    const tokenType = typeof record['token_type'] === 'string' ? record['token_type'] : 'Bearer';
    if (tokenType.toLowerCase() !== 'bearer') {
      throw new GrexxAuthenticationError(
        `Grexx token endpoint returned token_type "${tokenType}", expected Bearer. Refusing to call /realtime.`,
        response.status,
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
        response.status,
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
