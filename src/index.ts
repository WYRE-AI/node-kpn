/**
 * `@wyre-ai/node-kpn` v2 — Grexx/IRMA client (OAuth client_credentials, plain XML).
 *
 * The developer.kpn.com client (Disturbance Check, SIM Swap, MSM) lives at
 * `@wyre-ai/node-kpn/legacy`.
 */
export { GrexxClient, type GrexxRealtimeResult, type PostRealtimeOptions } from './grexx/client.js';
export {
  DEFAULT_GREXX_TOKEN_URL,
  GREXX_USERNAME_HEADER,
  GREXX_PASSWORD_HEADER,
  assertGrexxHttpsUrl,
  grexxConfigFromEnv,
  grexxRealtimeUrl,
  resolveGrexxConfig,
  type GrexxConfig,
  type GrexxEnv,
  type GrexxHeaderSource,
  type ResolveGrexxConfigOptions,
} from './grexx/config.js';
export {
  GREXX_EXPIRY_MARGIN_MS,
  GREXX_TOKEN_SCOPE,
  GrexxTokenCache,
  GrexxTokenProvider,
  defaultGrexxTokenCache,
  type GrexxToken,
  type GrexxTokenProviderOptions,
} from './grexx/auth.js';
export {
  ZIP_CODE_CHECK_REQUEST_ELEMENT,
  ZIP_CODE_CHECK_RESPONSE_ELEMENT,
  ZIP_CODE_PORTFOLIOS,
  ZIP_CODE_SUPPLIERS,
  buildZipCodeCheckRequest,
  parseZipCodeCheckResponse,
  zipCodeCheckFields,
  type ZipCodeActionRequired,
  type ZipCodeAvailableSpeed,
  type ZipCodeAvailableSupplier,
  type ZipCodeCheckInput,
  type ZipCodeCheckResult,
  type ZipCodeCheckSource,
  type ZipCodeCopperOff,
  type ZipCodePortfolio,
  type ZipCodeSupplier,
} from './grexx/zipcode.js';
export {
  buildXmlDocument,
  escapeXml,
  parseXml,
  renderRealtimeBody,
  type XmlNode,
  type XmlObject,
  type XmlValue,
} from './grexx/xml.js';
export { isGrexxSuccessCode, readGrexxStatus } from './grexx/status.js';
export { RateLimiter } from './rate-limiter.js';
export {
  GrexxAuthenticationError,
  GrexxConfigError,
  GrexxError,
  GrexxForbiddenError,
  GrexxNotFoundError,
  GrexxRateLimitError,
  GrexxServerError,
  GrexxValidationError,
  parseGrexxError,
  type GrexxErrorHints,
} from './grexx/errors.js';
