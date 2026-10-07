import { GrexxConfigError } from './errors.js';
import type { GrexxTokenCache } from './auth.js';

/**
 * Acceptatie OAuth token endpoint (Grexx #4029, confirmed 2026-10-07).
 * Production will differ — set `KPN_GREXX_TOKEN_URL` when it is known.
 */
export const DEFAULT_GREXX_TOKEN_URL = 'https://service-accept.grexx.today/oauth/access_token';

/** Gateway credential headers. Base URL and token URL are never read from headers. */
export const GREXX_USERNAME_HEADER = 'x-kpn-grexx-username';
export const GREXX_PASSWORD_HEADER = 'x-kpn-grexx-password';

const REJECTED_URL_HEADERS = [
  'x-kpn-grexx-base-url',
  'x-kpn-grexx-token-url',
  'x-kpn-grexx-baseurl',
  'x-kpn-grexx-tokenurl',
  'x-kpn-base-url',
  'x-kpn-token-url',
] as const;

export interface GrexxConfig {
  /** API username. Sent as OAuth `client_id` (`KPN_GREXX_USERNAME`). */
  username: string;
  /** API password. Sent as OAuth `client_secret` (`KPN_GREXX_PASSWORD`). */
  password: string;
  /**
   * Interface root, without `/realtime` (`KPN_GREXX_BASE_URL`).
   * Required. There is no production default.
   */
  baseUrl: string;
  /**
   * OAuth token endpoint. Defaults to {@link DEFAULT_GREXX_TOKEN_URL}
   * (`KPN_GREXX_TOKEN_URL`).
   */
  tokenUrl?: string;
  /** Token cache override. Defaults to the process-wide cache. */
  tokenCache?: GrexxTokenCache;
  /**
   * Retries for network errors, HTTP 429 / code 108, and 5xx on `/realtime`.
   * The token endpoint is never retried. Default 2.
   */
  maxRetries?: number;
  /** @internal Test override. Default 30s. */
  tokenTimeoutMs?: number;
  /** @internal Test override. Default 30s. */
  requestTimeoutMs?: number;
  /** @internal Clock override for token expiry tests. */
  now?: () => number;
}

export type GrexxHeaderSource =
  | Headers
  | Iterable<[string, string]>
  | Record<string, string | string[] | undefined | null>;

/** Environment map. `process.env` satisfies this. */
export type GrexxEnv = Record<string, string | undefined>;

export interface ResolveGrexxConfigOptions {
  env?: GrexxEnv;
  /**
   * Optional gateway credentials (`X-KPN-Grexx-Username` / `X-KPN-Grexx-Password`).
   * A base-URL or token-URL header is rejected.
   */
  headers?: GrexxHeaderSource;
}

function requireText(value: string | undefined, label: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new GrexxConfigError(`${label} is required and must be a non-empty string.`);
  }
  return value.trim();
}

/** https only, no userinfo — blocks credential-in-URL and cleartext token posts. */
export function assertGrexxHttpsUrl(value: string, label: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new GrexxConfigError(`${label} must be an absolute URL.`);
  }
  if (url.protocol !== 'https:') {
    throw new GrexxConfigError(`${label} must use https.`);
  }
  if (url.username !== '' || url.password !== '') {
    throw new GrexxConfigError(`${label} must not include URL credentials.`);
  }
  if (url.hash !== '') {
    throw new GrexxConfigError(`${label} must not include a fragment.`);
  }
  return url;
}

export function grexxRealtimeUrl(baseUrl: string): string {
  const url = assertGrexxHttpsUrl(baseUrl, 'baseUrl');
  const path = url.pathname.replace(/\/+$/, '');
  return `${url.origin}${path}/realtime${url.search}`;
}

function headerMap(headers: GrexxHeaderSource): Map<string, string> {
  const out = new Map<string, string>();
  if (typeof Headers !== 'undefined' && headers instanceof Headers) {
    headers.forEach((value, key) => {
      out.set(key.toLowerCase(), value);
    });
    return out;
  }
  if (typeof headers === 'object' && headers !== null && Symbol.iterator in headers && !Array.isArray(headers) && !isHeaderRecord(headers)) {
    for (const pair of headers as Iterable<[string, string]>) {
      out.set(pair[0].toLowerCase(), pair[1]);
    }
    return out;
  }
  if (Array.isArray(headers)) {
    for (const [key, value] of headers) out.set(key.toLowerCase(), value);
    return out;
  }
  for (const [key, value] of Object.entries(headers as Record<string, string | string[] | undefined | null>)) {
    if (value == null) continue;
    out.set(key.toLowerCase(), Array.isArray(value) ? (value[0] ?? '') : value);
  }
  return out;
}

function isHeaderRecord(value: object): boolean {
  if (value instanceof URLSearchParams) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function envValue(env: GrexxEnv | undefined, name: string): string | undefined {
  const value = env?.[name];
  return typeof value === 'string' ? value : undefined;
}

/**
 * Resolve Grexx configuration.
 *
 * `KPN_GREXX_BASE_URL` is always taken from the environment (required).
 * `KPN_GREXX_TOKEN_URL` is optional and defaults to the acceptatie token endpoint.
 * Username and password come from `X-KPN-Grexx-Username` / `X-KPN-Grexx-Password`
 * when both headers are set, otherwise from `KPN_GREXX_USERNAME` / `KPN_GREXX_PASSWORD`.
 *
 * Base URL and token URL headers are rejected so a caller cannot redirect the
 * client secret or Bearer token to another host.
 */
export function resolveGrexxConfig(options: ResolveGrexxConfigOptions = {}): GrexxConfig {
  const env: GrexxEnv = options.env ?? process.env;
  if (options.headers) {
    const headers = headerMap(options.headers);
    for (const name of REJECTED_URL_HEADERS) {
      if (headers.has(name)) {
        throw new GrexxConfigError(
          `Refusing caller-supplied Grexx URL from header "${name}". ` +
            'Set KPN_GREXX_BASE_URL and KPN_GREXX_TOKEN_URL in the environment only.',
        );
      }
    }
    const usernameHeader = headers.get(GREXX_USERNAME_HEADER);
    const passwordHeader = headers.get(GREXX_PASSWORD_HEADER);
    const hasUsername = usernameHeader !== undefined;
    const hasPassword = passwordHeader !== undefined;
    if (hasUsername !== hasPassword) {
      throw new GrexxConfigError('X-KPN-Grexx-Username and X-KPN-Grexx-Password must be provided together.');
    }
    if (hasUsername) {
      return finishConfig(
        env,
        requireText(usernameHeader, 'X-KPN-Grexx-Username'),
        requireText(passwordHeader, 'X-KPN-Grexx-Password'),
      );
    }
  }

  return grexxConfigFromEnv(env);
}

/** Read Grexx settings from the environment. Does not consult request headers. */
export function grexxConfigFromEnv(env: GrexxEnv = process.env): GrexxConfig {
  return finishConfig(
    env,
    requireText(envValue(env, 'KPN_GREXX_USERNAME'), 'KPN_GREXX_USERNAME'),
    requireText(envValue(env, 'KPN_GREXX_PASSWORD'), 'KPN_GREXX_PASSWORD'),
  );
}

function finishConfig(env: GrexxEnv | undefined, username: string, password: string): GrexxConfig {
  const baseUrl = requireText(envValue(env, 'KPN_GREXX_BASE_URL'), 'KPN_GREXX_BASE_URL');
  const tokenUrl = envValue(env, 'KPN_GREXX_TOKEN_URL')?.trim() || DEFAULT_GREXX_TOKEN_URL;
  assertGrexxHttpsUrl(baseUrl, 'KPN_GREXX_BASE_URL');
  assertGrexxHttpsUrl(tokenUrl, 'KPN_GREXX_TOKEN_URL');
  return { username, password, baseUrl, tokenUrl };
}
