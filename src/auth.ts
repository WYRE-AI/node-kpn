import { createHash } from 'node:crypto';

import { KpnError, parseKpnError } from './errors.js';

/** Supplies auth headers for the HttpClient and (optionally) handles 401s. */
export interface AuthProvider {
  headers(): Promise<Record<string, string>>;
  /** Called at most once per request on 401. Return true if refreshed → retry once. */
  handleUnauthorized?(): Promise<boolean>;
}

export interface KpnToken {
  accessToken: string;
  /** Local epoch ms at which the token expires (issue time + `expires_in`, no margin applied). */
  expiresAt: number;
  /** Account tier: `demo` or `prod`. */
  level?: string;
  applicationName?: string;
}

/** Re-mint this long before expiry (≈ 55 minutes of use from a 1 h token). */
const EXPIRY_MARGIN_MS = 300_000;
const TOKEN_TIMEOUT_MS = 30_000;

/**
 * Process-wide token cache. HTTP-mode MCP servers build a fresh client on every
 * request, so a per-client cache would mint a token per tool call. Bounded:
 * when full, the oldest-inserted entry is evicted.
 */
export class TokenCache {
  private readonly entries = new Map<string, KpnToken>();

  constructor(private readonly maxEntries: number = 500) {}

  get(key: string): KpnToken | undefined {
    return this.entries.get(key);
  }

  set(key: string, token: KpnToken): void {
    this.entries.delete(key); // re-insert as newest
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

export const defaultTokenCache = new TokenCache();

/** Concurrent mints for the same key share one request (single-flight), across clients. */
const inFlight = new Map<string, Promise<KpnToken>>();

export interface KpnTokenProviderOptions {
  baseUrl: string;
  tokenPath: string;
  clientId: string;
  clientSecret: string;
  cache: TokenCache;
}

/**
 * Apigee client-credentials token for one realm (gateway or msm).
 *
 * POST {tokenPath}?grant_type=client_credentials with a form body carrying
 * client_id / client_secret (no Basic auth). Every value in the 200 body is a
 * string, `expires_in` included. There is no refresh token — re-mint on expiry.
 * A 401 from the token endpoint is terminal (never retried).
 */
export class KpnTokenProvider implements AuthProvider {
  private readonly key: string;

  constructor(private readonly opts: KpnTokenProviderOptions) {
    // Hashing the secret into the key: a rotated secret never reuses a cached
    // token, and no raw secret sits in a map key.
    this.key = createHash('sha256')
      .update([opts.baseUrl, opts.tokenPath, opts.clientId, opts.clientSecret].join('\n'))
      .digest('hex');
  }

  async headers(): Promise<Record<string, string>> {
    const token = await this.getToken();
    return { Authorization: `Bearer ${token.accessToken}` };
  }

  async handleUnauthorized(): Promise<boolean> {
    this.opts.cache.delete(this.key);
    return true;
  }

  /** Cached token when still valid (with a 5-minute margin), otherwise a fresh mint. */
  async getToken(): Promise<KpnToken> {
    const cached = this.opts.cache.get(this.key);
    if (cached && Date.now() < cached.expiresAt - EXPIRY_MARGIN_MS) return cached;

    let pending = inFlight.get(this.key);
    if (!pending) {
      // Dropped once settled, so a failed mint is retried by the next caller.
      pending = this.mint().finally(() => inFlight.delete(this.key));
      inFlight.set(this.key, pending);
    }
    return pending;
  }

  private async mint(): Promise<KpnToken> {
    const base = this.opts.baseUrl.replace(/\/+$/, '');
    const response = await fetch(`${base}${this.opts.tokenPath}?grant_type=client_credentials`, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        client_id: this.opts.clientId,
        client_secret: this.opts.clientSecret,
      }).toString(),
      signal: AbortSignal.timeout(TOKEN_TIMEOUT_MS),
    });

    const rawText = await response.text();
    let body: unknown = rawText;
    try {
      body = JSON.parse(rawText);
    } catch {
      // keep raw text
    }
    if (!response.ok) throw parseKpnError(response.status, body, response.headers);

    const b = (body ?? {}) as Record<string, unknown>;
    if (typeof b['access_token'] !== 'string' || b['access_token'] === '') {
      throw new KpnError('KPN token endpoint returned no access_token', response.status, body);
    }
    const token: KpnToken = {
      accessToken: b['access_token'],
      // Apigee sends "3599" (a string); accept a number too.
      expiresAt: Date.now() + (Number(b['expires_in']) || 0) * 1000,
      level: typeof b['level'] === 'string' ? b['level'] : undefined,
      applicationName: typeof b['application_name'] === 'string' ? b['application_name'] : undefined,
    };
    this.opts.cache.set(this.key, token);
    return token;
  }
}
