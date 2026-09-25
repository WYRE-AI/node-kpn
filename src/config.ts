import type { TokenCache } from './auth.js';

/**
 * Every v1 product sits behind the KPN Apigee gateway on one host. Test and
 * production share this host — the account tier (`level`: demo/prod) lives on
 * the API Store project — so there is deliberately no environment selector.
 */
export const DEFAULT_BASE_URL = 'https://api-prd.kpn.com';

/** Apigee client-credentials token endpoints, one per realm. `grant_type` goes in the query string. */
export const TOKEN_PATHS = {
  gateway: '/oauth/client_credential/accesstoken',
  msm: '/oauth/grip/msm/accesstoken',
} as const;

/** Product base paths. Resource paths are absolute from the host and prefix these themselves. */
export const PRODUCT_PATHS = {
  disturbance: '/network/kpn/disturbance-check',
  availability: '/network/kpn/internet-speed-check',
  simSwap: '/kpn/sim-swap',
  msm: '/mobile/kpn/mobileservices',
} as const;

export interface KpnConfig {
  /** API Store project client id (gateway realm; also the MSM fallback). */
  clientId: string;
  /** API Store project client secret. */
  clientSecret: string;
  /** Customer's GRIP-bound MSM app id. Falls back to `clientId`. */
  msmClientId?: string;
  /** MSM app secret. Falls back to `clientSecret`; must be paired with `msmClientId`. */
  msmClientSecret?: string;
  /** Default {@link DEFAULT_BASE_URL}. */
  baseUrl?: string;
  /** Max retries for network errors, 429s and 5xx — idempotent requests only (default 3). */
  maxRetries?: number;
  /** Token cache override (tests pass a fresh one). Default: the process-wide `defaultTokenCache`. */
  tokenCache?: TokenCache;
}
