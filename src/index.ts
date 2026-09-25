export {
  KpnClient,
  type MobileNamespace,
  type RealmStatus,
  type ConnectionTestResult,
} from './client.js';
export { DEFAULT_BASE_URL, TOKEN_PATHS, PRODUCT_PATHS, type KpnConfig } from './config.js';
export {
  KpnTokenProvider,
  TokenCache,
  defaultTokenCache,
  type AuthProvider,
  type KpnToken,
  type KpnTokenProviderOptions,
} from './auth.js';
export {
  HttpClient,
  parseQuota,
  type HttpClientConfig,
  type RequestOptions,
  type BinaryResponse,
  type QuotaInfo,
} from './http.js';
export { RateLimiter } from './rate-limiter.js';
export {
  KpnError,
  AuthenticationError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
  ConflictError,
  RateLimitError,
  ServerError,
  ENTITLEMENT_HINT,
  parseKpnError,
} from './errors.js';
export { buildFilters, referenceNumber, type MsmPageParams } from './msm.js';
export { DisturbancesResource } from './resources/disturbances.js';
export { AvailabilityResource } from './resources/availability.js';
export { SimSwapResource } from './resources/sim-swap.js';
export { MobileSubscribersResource } from './resources/mobile-subscribers.js';
export { MobileHierarchyResource } from './resources/mobile-hierarchy.js';
export { MobileThresholdsResource } from './resources/mobile-thresholds.js';
export { MobileInvoicesResource } from './resources/mobile-invoices.js';
export { MobileContractsResource } from './resources/mobile-contracts.js';
export { MobileOrdersResource } from './resources/mobile-orders.js';
export { MobileServiceRequestsResource } from './resources/mobile-service-requests.js';
export type * from './types/index.js';
