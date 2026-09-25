import type { AuthProvider } from './auth.js';
import { AuthenticationError, RateLimitError, ServerError, parseKpnError } from './errors.js';
import type { RateLimiter } from './rate-limiter.js';

export interface HttpClientConfig {
  baseUrl: string;
  rateLimiter: RateLimiter;
  auth?: AuthProvider;
  /** Max retries for network errors, 429 and 5xx — idempotent requests only (default 3). */
  maxRetries?: number;
  /** Called with every parsed quota; lets KpnClient track the most recent value across realms. */
  onQuota?: (quota: QuotaInfo) => void;
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  /** Array values serialize as repeated keys (`status=A&status=B`) — MSM uses `collectionFormat: multi`. */
  params?: Record<string, string | number | boolean | Array<string | number> | undefined>;
  /** JSON-encoded. */
  body?: unknown;
  /** Extra headers, e.g. `Content-Language`. */
  headers?: Record<string, string>;
  /** Safe to retry on network errors / 429 / 5xx? Default: `method === 'GET'`. */
  idempotent?: boolean;
  responseType?: 'json' | 'binary';
}

export interface BinaryResponse {
  data: Uint8Array;
  contentType: string;
  filename?: string;
}

/** Apigee quota headers. KPN publishes no numeric limits, so these are the only signal. */
export interface QuotaInfo {
  limit?: number;
  used?: number;
  interval?: string;
  timeUnit?: string;
  resetUtc?: string;
  sunset?: string;
}

const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);
const TIMEOUT_MS = 30_000;

/** Parse the `quota-*` / `sunset` headers; undefined when none are present. */
export function parseQuota(headers: Headers): QuotaInfo | undefined {
  const num = (name: string) => {
    const value = headers.get(name);
    return value === null || value === '' || Number.isNaN(Number(value)) ? undefined : Number(value);
  };
  const text = (name: string) => headers.get(name) ?? undefined;
  const quota: QuotaInfo = {
    limit: num('quota-limit'),
    used: num('quota-used'),
    interval: text('quota-interval'),
    timeUnit: text('quota-time-unit'),
    resetUtc: text('quota-reset-UTC'),
    sunset: text('sunset'),
  };
  return Object.values(quota).some((v) => v !== undefined) ? quota : undefined;
}

/** `attachment; filename="INV-1.pdf"` or RFC 5987 `filename*=UTF-8''INV-1.pdf`. */
function parseFilename(disposition: string | null): string | undefined {
  if (!disposition) return undefined;
  const extended = /filename\*\s*=\s*[^']*''([^;]+)/i.exec(disposition);
  if (extended?.[1]) return decodeURIComponent(extended[1].trim());
  const plain = /filename\s*=\s*"?([^";]+)"?/i.exec(disposition);
  return plain?.[1]?.trim();
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Native-fetch HTTP client for the KPN Apigee gateway.
 *
 * - Retry policy is SAFETY-CRITICAL: network errors, 429 and 500/502/503/504
 *   are retried ONLY when the request is idempotent (default: GET; read-only
 *   POSTs opt in). MSM order POSTs are never retried — a duplicate block-sim
 *   or authorize is a real-world side effect. Backoff `min(1000·2^(n-1), 30s)`;
 *   `Retry-After` is honoured.
 * - A 401 (or an Apigee invalid-token fault) triggers the auth provider's
 *   refresh and ONE retry, for every method: the request was rejected, so
 *   repeating it is safe. This retry does not count against `maxRetries`.
 * - Reads every body as text first, then JSON.parse — never `.json()`.
 * - 30 s timeout per attempt. `api-version` is never sent (default: latest).
 */
export class HttpClient {
  private readonly baseUrl: string;
  private readonly rateLimiter: RateLimiter;
  private readonly auth: AuthProvider | undefined;
  private readonly maxRetries: number;
  private readonly onQuota: ((quota: QuotaInfo) => void) | undefined;
  private quota: QuotaInfo | undefined;

  constructor(config: HttpClientConfig) {
    this.baseUrl = config.baseUrl.replace(/\/+$/, '');
    this.rateLimiter = config.rateLimiter;
    this.auth = config.auth;
    this.maxRetries = config.maxRetries ?? 3;
    this.onQuota = config.onQuota;
  }

  /** Quota headers from the most recent response that carried any. */
  get lastQuota(): QuotaInfo | undefined {
    return this.quota;
  }

  async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const { method = 'GET', params, body, responseType = 'json' } = options;
    const idempotent = options.idempotent ?? method === 'GET';
    const maxRetries = idempotent ? this.maxRetries : 0;
    const url = this.buildUrl(path, params);

    let attempt = 0;
    let attemptedAuthRefresh = false;
    for (;;) {
      await this.rateLimiter.acquire();

      const headers: Record<string, string> = {
        Accept: responseType === 'binary' ? '*/*' : 'application/json',
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...options.headers,
        ...(this.auth ? await this.auth.headers() : {}),
      };

      let response: Response;
      try {
        response = await fetch(url, {
          method,
          headers,
          body: body !== undefined ? JSON.stringify(body) : undefined,
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
      } catch (err) {
        if (attempt >= maxRetries) throw err;
        attempt += 1;
        await sleep(backoff(attempt));
        continue;
      }

      const quota = parseQuota(response.headers);
      if (quota) {
        this.quota = quota;
        this.onQuota?.(quota);
      }

      if (response.ok) {
        if (responseType === 'binary') {
          return {
            data: new Uint8Array(await response.arrayBuffer()),
            contentType: response.headers.get('content-type') ?? 'application/octet-stream',
            filename: parseFilename(response.headers.get('content-disposition')),
          } as T;
        }
        return parseBody(await response.text()) as T;
      }

      const error = parseKpnError(response.status, parseBody(await response.text()), response.headers);
      if (error instanceof RateLimitError) error.quota = quota;

      if (error instanceof AuthenticationError && !attemptedAuthRefresh && this.auth?.handleUnauthorized) {
        attemptedAuthRefresh = true;
        if (await this.auth.handleUnauthorized().catch(() => false)) continue;
      }

      const retryable =
        RETRYABLE_STATUSES.has(response.status) &&
        (error instanceof RateLimitError || error instanceof ServerError);
      if (!retryable || attempt >= maxRetries) throw error;
      attempt += 1;
      // Honour Retry-After (seconds) when present, capped like the backoff.
      const retryAfter = Number.parseInt(response.headers.get('retry-after') ?? '', 10);
      await sleep(Number.isFinite(retryAfter) ? Math.min(retryAfter * 1000, 30_000) : backoff(attempt));
    }
  }

  /** Strip trailing slashes; array params become repeated keys; undefined values are dropped. */
  private buildUrl(path: string, params: RequestOptions['params']): string {
    let normalizedPath = path.startsWith('/') ? path : `/${path}`;
    if (normalizedPath.length > 1) normalizedPath = normalizedPath.replace(/\/+$/, '');
    let url = `${this.baseUrl}${normalizedPath}`;

    if (params) {
      const searchParams = new URLSearchParams();
      for (const [key, value] of Object.entries(params)) {
        if (value === undefined || value === null) continue;
        if (Array.isArray(value)) {
          for (const item of value) searchParams.append(key, String(item));
        } else {
          searchParams.append(key, String(value));
        }
      }
      const qs = searchParams.toString();
      if (qs) url += `${url.includes('?') ? '&' : '?'}${qs}`;
    }
    return url;
  }
}

function backoff(attempt: number): number {
  return Math.min(1000 * 2 ** (attempt - 1), 30_000);
}

/** Empty → undefined; JSON when it parses; raw text otherwise. */
function parseBody(rawText: string): unknown {
  if (rawText.length === 0) return undefined;
  try {
    return JSON.parse(rawText);
  } catch {
    return rawText;
  }
}
