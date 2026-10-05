/**
 * Acceptatie host from the KPN partner portal (API Gegevens), crawled 2026-10-05.
 * This is documentation, not a default: production will differ and `baseUrl` is required.
 */
export const GREXX_ACCEPTATIE_BASE_URL =
  'https://service-accept.grexx.today/interfaces/kpn/kpn_partners_acceptatieomgeving/697fbf4b18a076446aa2cd4a/';

/** OAuth client-credentials token endpoint on the acceptatie host. */
export const GREXX_ACCEPTATIE_TOKEN_URL = 'https://service-accept.grexx.today/oauth/access_token';

/**
 * Phase 1 request `Content-Type`. Live acceptatie has not been called from this
 * package; switch only if a smoke test shows Grexx requires `text/xml`.
 */
export const GREXX_XML_CONTENT_TYPE = 'application/xml; charset=utf-8';

export const GREXX_CHANNELS = ['realtime', 'queued', 'ordermodule'] as const;

export type GrexxChannel = (typeof GREXX_CHANNELS)[number];

export type AuthMode = 'basic' | 'oauth';

export interface KpnGrexxConfig {
  /** API username (`KPN_GREXX_USERNAME`). Sent as OAuth `client_id` or Basic user. */
  username: string;
  /** API password (`KPN_GREXX_PASSWORD`). Sent as OAuth `client_secret` or Basic password. */
  password: string;
  /**
   * Interface base URL (`KPN_GREXX_BASE_URL`), including the partner path.
   * Required — there is no production default.
   */
  baseUrl: string;
  /**
   * How realtime/queued/ordermodule calls authenticate.
   * Default `oauth` (account setting on acceptatie). `basic` is the fallback
   * if acceptatie rejects Bearer on `/realtime` with code 101.
   */
  authMode?: AuthMode;
  /**
   * OAuth token URL. Default: `{origin of baseUrl}/oauth/access_token`,
   * which is {@link GREXX_ACCEPTATIE_TOKEN_URL} for the acceptatie base URL.
   */
  tokenUrl?: string;
  /** OAuth scope. Default `all` (portal token form). */
  scope?: string;
  /** Override `fetch` (tests). */
  fetch?: typeof fetch;
}

export interface CallOptions {
  signal?: AbortSignal;
}

const ENV_USERNAME = 'KPN_GREXX_USERNAME';
const ENV_PASSWORD = 'KPN_GREXX_PASSWORD';
const ENV_BASE_URL = 'KPN_GREXX_BASE_URL';
const ENV_AUTH_MODE = 'KPN_GREXX_AUTH_MODE';
const ENV_TOKEN_URL = 'KPN_GREXX_TOKEN_URL';
const ENV_SCOPE = 'KPN_GREXX_SCOPE';

function requiredEnv(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name];
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${name} is required (no default host or credentials).`);
  }
  return value;
}

/** Build config from `KPN_GREXX_*` environment variables. Never reads a secret from disk. */
export function grexxConfigFromEnv(env: NodeJS.ProcessEnv = process.env): KpnGrexxConfig {
  const authRaw = env[ENV_AUTH_MODE]?.trim();
  let authMode: AuthMode | undefined;
  if (authRaw) {
    if (authRaw !== 'oauth' && authRaw !== 'basic') {
      throw new Error(`${ENV_AUTH_MODE} must be "oauth" or "basic".`);
    }
    authMode = authRaw;
  }
  const tokenUrl = env[ENV_TOKEN_URL]?.trim();
  const scope = env[ENV_SCOPE]?.trim();
  return {
    username: requiredEnv(env, ENV_USERNAME).trim(),
    password: requiredEnv(env, ENV_PASSWORD),
    baseUrl: requiredEnv(env, ENV_BASE_URL).trim(),
    authMode,
    tokenUrl: tokenUrl || undefined,
    scope: scope || undefined,
  };
}

function assertHttpUrl(value: string, label: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${label} must be an absolute http(s) URL.`);
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error(`${label} must be an absolute http(s) URL.`);
  }
  if (url.username || url.password) {
    throw new Error(`${label} must not embed credentials.`);
  }
  if (url.search || url.hash) {
    throw new Error(`${label} must not include a query string or hash.`);
  }
  return url;
}

/** `{base}/realtime`, `{base}/queued` or `{base}/ordermodule`, with exactly one slash. */
export function grexxChannelUrl(baseUrl: string, channel: GrexxChannel): string {
  const url = assertHttpUrl(baseUrl.trim(), 'KPN_GREXX_BASE_URL');
  const path = url.pathname.replace(/\/+$/, '');
  return `${url.origin}${path}/${channel}`;
}

/** Token URL override, or `{origin}/oauth/access_token` derived from the base URL. */
export function grexxTokenUrl(baseUrl: string, tokenUrl?: string): string {
  if (tokenUrl !== undefined && tokenUrl.trim() !== '') {
    return assertHttpUrl(tokenUrl.trim(), 'KPN_GREXX_TOKEN_URL').href;
  }
  const origin = assertHttpUrl(baseUrl.trim(), 'KPN_GREXX_BASE_URL').origin;
  return `${origin}/oauth/access_token`;
}
