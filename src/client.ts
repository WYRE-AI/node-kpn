import { KpnTokenProvider, defaultTokenCache } from './auth.js';
import { DEFAULT_BASE_URL, TOKEN_PATHS, type KpnConfig } from './config.js';
import { HttpClient, type QuotaInfo } from './http.js';
import { RateLimiter } from './rate-limiter.js';
import { AvailabilityResource } from './resources/availability.js';
import { DisturbancesResource } from './resources/disturbances.js';
import { MobileContractsResource } from './resources/mobile-contracts.js';
import { MobileHierarchyResource } from './resources/mobile-hierarchy.js';
import { MobileInvoicesResource } from './resources/mobile-invoices.js';
import { MobileOrdersResource } from './resources/mobile-orders.js';
import { MobileServiceRequestsResource } from './resources/mobile-service-requests.js';
import { MobileSubscribersResource } from './resources/mobile-subscribers.js';
import { MobileThresholdsResource } from './resources/mobile-thresholds.js';
import { SimSwapResource } from './resources/sim-swap.js';

/** Mobile Services Management (KPN Zakelijk business mobile) resources — msm realm. */
export interface MobileNamespace {
  subscribers: MobileSubscribersResource;
  hierarchy: MobileHierarchyResource;
  thresholds: MobileThresholdsResource;
  invoices: MobileInvoicesResource;
  contracts: MobileContractsResource;
  orders: MobileOrdersResource;
  serviceRequests: MobileServiceRequestsResource;
}

export interface RealmStatus {
  ok: boolean;
  level?: string;
  applicationName?: string;
  error?: string;
}

export interface ConnectionTestResult {
  gateway: RealmStatus;
  msm?: RealmStatus;
}

/**
 * KPN API Store client. Two HttpClients share one RateLimiter:
 * - gateway realm: Disturbance Check, Internet Speed Check, SIM Swap;
 * - msm realm: Mobile Services Management, with the customer's GRIP-bound
 *   MSM credentials (falling back to the main project credentials).
 */
export class KpnClient {
  readonly disturbances: DisturbancesResource;
  readonly availability: AvailabilityResource;
  readonly simSwap: SimSwapResource;
  readonly mobile: MobileNamespace;

  private readonly gatewayAuth: KpnTokenProvider;
  private readonly msmAuth: KpnTokenProvider;
  private quota: QuotaInfo | undefined;

  constructor(config: KpnConfig) {
    for (const key of ['clientId', 'clientSecret'] as const) {
      const value = config[key];
      if (typeof value !== 'string' || value.trim() === '') {
        throw new Error(`KPN credential "${key}" is required and must be a non-empty string.`);
      }
    }
    if (Boolean(config.msmClientId) !== Boolean(config.msmClientSecret)) {
      throw new Error(
        'KPN MSM credentials must be paired: provide both msmClientId and msmClientSecret, or neither.'
      );
    }

    const baseUrl = config.baseUrl ?? DEFAULT_BASE_URL;
    const cache = config.tokenCache ?? defaultTokenCache;
    this.gatewayAuth = new KpnTokenProvider({
      baseUrl,
      tokenPath: TOKEN_PATHS.gateway,
      clientId: config.clientId,
      clientSecret: config.clientSecret,
      cache,
    });
    this.msmAuth = new KpnTokenProvider({
      baseUrl,
      tokenPath: TOKEN_PATHS.msm,
      clientId: config.msmClientId || config.clientId,
      clientSecret: config.msmClientSecret || config.clientSecret,
      cache,
    });

    const shared = {
      baseUrl,
      rateLimiter: new RateLimiter(25, 5_000),
      onQuota: (quota: QuotaInfo) => {
        this.quota = quota;
      },
      ...(config.maxRetries !== undefined ? { maxRetries: config.maxRetries } : {}),
    };
    const gatewayHttp = new HttpClient({ ...shared, auth: this.gatewayAuth });
    const msmHttp = new HttpClient({ ...shared, auth: this.msmAuth });

    this.disturbances = new DisturbancesResource(gatewayHttp);
    this.availability = new AvailabilityResource(gatewayHttp);
    this.simSwap = new SimSwapResource(gatewayHttp);
    this.mobile = {
      subscribers: new MobileSubscribersResource(msmHttp),
      hierarchy: new MobileHierarchyResource(msmHttp),
      thresholds: new MobileThresholdsResource(msmHttp),
      invoices: new MobileInvoicesResource(msmHttp),
      contracts: new MobileContractsResource(msmHttp),
      orders: new MobileOrdersResource(msmHttp),
      serviceRequests: new MobileServiceRequestsResource(msmHttp),
    };
  }

  /** Quota headers from the most recent response of either realm. */
  get lastQuota(): QuotaInfo | undefined {
    return this.quota;
  }

  /**
   * Mint (or read cached) tokens and report per realm; never throws. MSM is
   * attempted only when `includeMsm`. A successful mint does NOT prove a
   * product is enabled on the project.
   */
  async testConnection(opts: { includeMsm?: boolean } = {}): Promise<ConnectionTestResult> {
    const result: ConnectionTestResult = { gateway: await realmStatus(this.gatewayAuth) };
    if (opts.includeMsm) result.msm = await realmStatus(this.msmAuth);
    return result;
  }
}

async function realmStatus(auth: KpnTokenProvider): Promise<RealmStatus> {
  try {
    const token = await auth.getToken();
    return { ok: true, level: token.level, applicationName: token.applicationName };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
