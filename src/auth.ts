import { grexxTokenUrl, type AuthMode, type KpnGrexxConfig } from './config.js';
import { GrexxAuthenticationError } from './errors.js';

interface CachedToken {
  token: string;
  /** Epoch ms after which the token must be minted again (already includes skew). */
  refreshAt: number;
}

const SKEW_MS = 60_000;

function basicAuthorization(username: string, password: string): string {
  return `Basic ${Buffer.from(`${username}:${password}`, 'utf8').toString('base64')}`;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function numberValue(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) {
    return Number(value);
  }
  return undefined;
}

/**
 * Turn `expires_in` (seconds) or `expires` (seconds, unix time, or ISO) into an
 * absolute refresh deadline. Unknown shapes fall back to one hour.
 */
export function tokenRefreshAt(body: Record<string, unknown>, now = Date.now()): number {
  const expiresIn = numberValue(body['expires_in']);
  if (expiresIn !== undefined) return applySkew(now, now + expiresIn * 1000);

  const expires = body['expires'];
  const numeric = numberValue(expires);
  if (numeric !== undefined) {
    if (numeric < 10_000_000) return applySkew(now, now + numeric * 1000);
    if (numeric < 10_000_000_000) return applySkew(now, numeric * 1000);
    return applySkew(now, numeric);
  }
  if (typeof expires === 'string') {
    const parsed = Date.parse(expires);
    if (!Number.isNaN(parsed)) return applySkew(now, parsed);
  }
  return applySkew(now, now + 3_600_000);
}

function applySkew(now: number, expiresAt: number): number {
  const ttl = expiresAt - now;
  const skew = Math.min(SKEW_MS, Math.max(0, Math.floor(ttl / 2)));
  return expiresAt - skew;
}

async function readTokenBody(response: Response): Promise<Record<string, unknown>> {
  const text = await response.text();
  const trimmed = text.trim();
  if (!trimmed) return {};
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      return asRecord(JSON.parse(trimmed) as unknown);
    } catch {
      throw new GrexxAuthenticationError('Grexx token response was not valid JSON.', {
        httpStatus: response.status,
        responseXml: text,
      });
    }
  }
  if (trimmed.includes('=')) {
    return Object.fromEntries(new URLSearchParams(trimmed).entries());
  }
  throw new GrexxAuthenticationError('Grexx token response was not JSON or form data.', {
    httpStatus: response.status,
    responseXml: text,
  });
}

function tokenErrorMessage(status: number, body: Record<string, unknown>): string {
  const description = body['error_description'] ?? body['error'] ?? body['message'];
  if (typeof description === 'string' && description.trim() !== '') {
    return `Grexx token request failed with HTTP ${status}: ${description.trim()}`;
  }
  return `Grexx token request failed with HTTP ${status}.`;
}

/**
 * Mints and caches an OAuth client-credentials bearer token, and builds the
 * Authorization header for the configured auth mode.
 */
export class GrexxAuthorizer {
  readonly authMode: AuthMode;
  private readonly username: string;
  private readonly password: string;
  private readonly tokenUrl: string;
  private readonly scope: string;
  private readonly fetchImpl: typeof fetch;
  private cache: CachedToken | undefined;
  private inflight: Promise<string> | undefined;

  constructor(config: KpnGrexxConfig) {
    this.authMode = config.authMode ?? 'oauth';
    this.username = config.username;
    this.password = config.password;
    this.tokenUrl = grexxTokenUrl(config.baseUrl, config.tokenUrl);
    this.scope = config.scope ?? 'all';
    this.fetchImpl = config.fetch ?? fetch;
  }

  invalidate(): void {
    this.cache = undefined;
  }

  async authorizationHeader(): Promise<string> {
    if (this.authMode === 'basic') return basicAuthorization(this.username, this.password);
    const token = await this.getAccessToken();
    return `Bearer ${token}`;
  }

  /**
   * Return a cached bearer token, minting one OAuth client-credentials grant
   * when needed. Works in `basic` mode too so callers can inspect the token
   * the account is configured to issue.
   */
  getAccessToken(): Promise<string> {
    const cached = this.cache;
    if (cached && cached.refreshAt > Date.now()) return Promise.resolve(cached.token);
    if (!this.inflight) {
      this.inflight = this.mint().finally(() => {
        this.inflight = undefined;
      });
    }
    return this.inflight;
  }

  private async mint(): Promise<string> {
    const body = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: this.username,
      client_secret: this.password,
      scope: this.scope,
    });
    const response = await this.fetchImpl(this.tokenUrl, {
      method: 'POST',
      redirect: 'manual',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body,
    });
    if (response.type === 'opaqueredirect' || (response.status >= 300 && response.status < 400)) {
      throw new GrexxAuthenticationError(
        `Grexx token endpoint redirected the request (${response.status || response.type}); redirects are not followed.`,
        { httpStatus: response.status || undefined }
      );
    }
    const parsed = await readTokenBody(response);
    if (!response.ok) {
      throw new GrexxAuthenticationError(tokenErrorMessage(response.status, parsed), {
        httpStatus: response.status,
      });
    }
    const token = parsed['access_token'] ?? parsed['accessToken'];
    if (typeof token !== 'string' || token.trim() === '') {
      throw new GrexxAuthenticationError('Grexx token response did not include access_token.', {
        httpStatus: response.status,
      });
    }
    this.cache = { token, refreshAt: tokenRefreshAt(parsed) };
    return token;
  }
}
