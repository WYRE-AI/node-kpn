import { GrexxTokenProvider } from './auth.js';
import {
  DEFAULT_GREXX_TOKEN_URL,
  assertGrexxHttpsUrl,
  grexxRealtimeUrl,
  resolveGrexxConfig,
  type GrexxConfig,
  type ResolveGrexxConfigOptions,
} from './config.js';
import { GrexxConfigError, GrexxError, GrexxRateLimitError, GrexxServerError, parseGrexxError } from './errors.js';
import { RateLimiter } from '../rate-limiter.js';
import { readGrexxStatus, isGrexxSuccessCode } from './status.js';
import { parseXml, renderRealtimeBody, type XmlObject, type XmlValue } from './xml.js';
import {
  ZIP_CODE_CHECK_REQUEST_ELEMENT,
  ZIP_CODE_CHECK_RESPONSE_ELEMENT,
  buildZipCodeCheckRequest,
  parseZipCodeCheckResponse,
  type ZipCodeCheckInput,
  type ZipCodeCheckResult,
} from './zipcode.js';

const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_RETRIES = 2;

export interface GrexxRealtimeResult {
  httpStatus: number;
  requestId?: string;
  /** Response document element name. */
  rootElement: string;
  /** `Status/Code` when the document carries one (`Success`, `108`, …). */
  code?: string;
  messages: string[];
  rawXml: string;
  document: XmlObject;
}

export interface PostRealtimeOptions {
  /**
   * Retry network errors, HTTP 429 / code 108, and 5xx.
   * Default true: realtime reads are safe to repeat.
   * Token mint failures are never retried into a Bearer-less call.
   */
  idempotent?: boolean;
}

interface NormalizedBody {
  code?: string;
  message?: string;
  document?: XmlObject;
  rootElement?: string;
  raw: string;
  json?: unknown;
}

/**
 * Grexx/IRMA acceptatie client.
 *
 * Mints an OAuth 2.0 client_credentials token and POSTs plain XML (no SOAP)
 * to `{baseUrl}/realtime` with `Authorization: Bearer` and `Content-Type: text/xml`.
 * Basic Auth is not sent. Base URL and token URL come from configuration, never
 * from caller headers — use {@link GrexxClient.fromEnv} for gateway credentials.
 */
export class GrexxClient {
  private readonly auth: GrexxTokenProvider;
  private readonly endpoint: string;
  private readonly rateLimiter: RateLimiter;
  private readonly maxRetries: number;
  private readonly requestTimeoutMs: number;

  constructor(config: GrexxConfig) {
    const username = requireCredential(config.username, 'username');
    const password = requireCredential(config.password, 'password');
    const tokenUrl = assertGrexxHttpsUrl(
      (config.tokenUrl ?? DEFAULT_GREXX_TOKEN_URL).trim() || DEFAULT_GREXX_TOKEN_URL,
      'tokenUrl',
    );
    this.endpoint = grexxRealtimeUrl(config.baseUrl);
    this.auth = new GrexxTokenProvider({
      tokenUrl: tokenUrl.href,
      clientId: username,
      clientSecret: password,
      ...(config.tokenCache ? { cache: config.tokenCache } : {}),
      ...(config.tokenTimeoutMs !== undefined ? { timeoutMs: config.tokenTimeoutMs } : {}),
      ...(config.now ? { now: config.now } : {}),
    });
    this.rateLimiter = new RateLimiter(25, 5_000);
    this.maxRetries = config.maxRetries ?? DEFAULT_MAX_RETRIES;
    this.requestTimeoutMs = config.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  }

  /**
   * Environment (and optional gateway username/password headers).
   * Rejects base-URL and token-URL headers.
   */
  static fromEnv(options?: ResolveGrexxConfigOptions): GrexxClient {
    return new GrexxClient(resolveGrexxConfig(options));
  }

  /**
   * POST plain XML to `/realtime`.
   *
   * `body` is either a child-element object or an XML string (a full
   * `rootElement` document, or a fragment that will be wrapped).
   * The OAuth token is minted first; if that fails, `/realtime` is not called.
   * A 401 drops the cached token, mints once more, and retries once.
   */
  async postRealtime(
    rootElement: string,
    body: string | Record<string, XmlValue>,
    options: PostRealtimeOptions = {},
  ): Promise<GrexxRealtimeResult> {
    const xml = renderRealtimeBody(rootElement, body);
    const idempotent = options.idempotent ?? true;
    const maxRetries = idempotent ? this.maxRetries : 0;
    let attempt = 0;
    let reminted = false;

    for (;;) {
      const authorization = await this.auth.authorizationHeader();
      await this.rateLimiter.acquire();

      let response: Response;
      try {
        response = await fetch(this.endpoint, {
          method: 'POST',
          headers: {
            Accept: 'text/xml, application/xml, application/json',
            'Content-Type': 'text/xml; charset=utf-8',
            Authorization: authorization,
          },
          body: xml,
          redirect: 'error',
          signal: AbortSignal.timeout(this.requestTimeoutMs),
        });
      } catch (err) {
        const wrapped = realtimeTransportError(err);
        if (attempt >= maxRetries) throw wrapped;
        attempt += 1;
        await sleep(backoff(attempt));
        continue;
      }

      const raw = await response.text();
      const requestId = response.headers.get('x-request-id') ?? undefined;

      if (response.status === 401) {
        if (reminted) {
          throw parseGrexxError(response.status, coerceJson(raw), response.headers, requestId);
        }
        reminted = true;
        this.auth.invalidate();
        continue;
      }

      const normalized = normalizeBody(raw);

      if (response.ok) {
        if (!normalized.document || !normalized.rootElement) {
          throw new GrexxError(
            'Grexx realtime response was not XML',
            response.status,
            raw,
            normalized.code,
            requestId,
          );
        }
        const result: GrexxRealtimeResult = {
          httpStatus: response.status,
          requestId,
          rootElement: normalized.rootElement,
          code: normalized.code,
          messages: splitMessages(normalized.message),
          rawXml: raw,
          document: normalized.document,
        };
        if (normalized.code !== undefined && !isGrexxSuccessCode(normalized.code)) {
          const error = parseGrexxError(response.status, raw, response.headers, requestId, {
            code: normalized.code,
            message: normalized.message,
          });
          if (!(error instanceof GrexxRateLimitError) || attempt >= maxRetries) throw error;
          attempt += 1;
          await sleep(retryDelay(error, attempt));
          continue;
        }
        return result;
      }

      const error = parseGrexxError(response.status, normalized.json ?? raw, response.headers, requestId, {
        code: normalized.code,
        message: normalized.message,
      });
      const retryable = error instanceof GrexxRateLimitError || error instanceof GrexxServerError;
      if (!retryable || attempt >= maxRetries) throw error;
      attempt += 1;
      await sleep(error instanceof GrexxRateLimitError ? retryDelay(error, attempt) : backoff(attempt));
    }
  }

  /** `ZipCodeCheckRequest_V6` → parsed `ZipCodeCheckResponse_V5`. */
  async zipCodeCheck(input: ZipCodeCheckInput): Promise<ZipCodeCheckResult> {
    const xml = buildZipCodeCheckRequest(input);
    const result = await this.postRealtime(ZIP_CODE_CHECK_REQUEST_ELEMENT, xml);
    if (result.rootElement !== ZIP_CODE_CHECK_RESPONSE_ELEMENT) {
      throw new GrexxError(
        `Expected ${ZIP_CODE_CHECK_RESPONSE_ELEMENT} but received <${result.rootElement}>`,
        result.httpStatus,
        result.rawXml,
        result.code,
        result.requestId,
      );
    }
    return parseZipCodeCheckResponse(result);
  }
}

function requireCredential(value: string | undefined, label: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new GrexxConfigError(`${label} is required and must be a non-empty string.`);
  }
  return value.trim();
}

function coerceJson(raw: string): unknown {
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  try {
    return JSON.parse(trimmed);
  } catch {
    return raw;
  }
}

function splitMessages(message: string | undefined): string[] {
  if (!message) return [];
  return message.split('; ').filter((item) => item.length > 0);
}

function normalizeBody(raw: string): NormalizedBody {
  const trimmed = raw.trim();
  if (trimmed.startsWith('<')) {
    try {
      const document = parseXml(trimmed);
      const status = readGrexxStatus(document);
      const rootElement = Object.keys(document)[0];
      return {
        code: status.code,
        message: status.messages.length > 0 ? status.messages.join('; ') : undefined,
        document,
        rootElement,
        raw,
      };
    } catch (err) {
      if (err instanceof GrexxError) throw err;
      throw new GrexxError('Grexx realtime response was not valid XML', 0, raw, 'invalid_xml', undefined, { cause: err });
    }
  }
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    const json = coerceJson(trimmed);
    return { raw, json: json === trimmed ? undefined : json };
  }
  return { raw, message: trimmed || undefined };
}

function realtimeTransportError(err: unknown): GrexxServerError {
  const message = err instanceof Error ? err.message : String(err);
  const redirected = /redirect/i.test(message);
  return new GrexxServerError(
    redirected
      ? 'Grexx realtime endpoint redirected. Refusing to follow the redirect.'
      : 'Grexx realtime request failed.',
    0,
    undefined,
    redirected ? 'realtime_redirect' : 'network_error',
    undefined,
    { cause: err },
  );
}

function backoff(attempt: number): number {
  return Math.min(1000 * 2 ** (attempt - 1), 30_000);
}

function retryDelay(error: GrexxRateLimitError, attempt: number): number {
  if (Number.isFinite(error.retryAfter) && error.retryAfter >= 0) {
    return Math.min(error.retryAfter * 1000, 30_000);
  }
  return backoff(attempt);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
