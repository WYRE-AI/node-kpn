import { GrexxAuthorizer } from './auth.js';
import { describeGrexxCode } from './codes.js';
import {
  GREXX_XML_CONTENT_TYPE,
  grexxChannelUrl,
  type AuthMode,
  type CallOptions,
  type GrexxChannel,
  type KpnGrexxConfig,
} from './config.js';
import {
  GrexxAuthenticationError,
  GrexxError,
  GrexxRateLimitError,
  GrexxValidationError,
  type GrexxErrorOptions,
} from './errors.js';
import {
  PHASE1_ROOTS,
  buildAvailablePortingsRequest,
  buildCarrierInfoRequest,
  buildCustomerDataRequest,
  buildGetMobileSettingsRequest,
  buildGetMobileSubscriptionOrdersRequest,
  buildGetMobileSubscriptionUsageRequest,
  buildGetSimRequest,
  buildOrderDataRequest,
  buildOrderSummaryRequest,
  buildPrequalificationRequest,
  buildRadiusCheckRequest,
  buildRasCheckRequest,
  buildStartLineDiagnoseRequest,
  buildZipCodeCheckRequest,
  parseAvailablePortingsResponse,
  parseCarrierInfoResponse,
  parseCustomerDataResponse,
  parseGetMobileSettingsResponse,
  parseGetMobileSubscriptionOrdersResponse,
  parseGetMobileSubscriptionUsageResponse,
  parseGetSimResponse,
  parseOrderDataResponse,
  parseOrderSummaryResponse,
  parsePrequalificationResponse,
  parseRadiusCheckResponse,
  parseRasCheckResponse,
  parseStartLineDiagnoseResponse,
  parseZipCodeCheckResponse,
  type AvailablePortingsRequest,
  type CarrierInfoRequest,
  type CustomerDataRequest,
  type GetMobileSettingsRequest,
  type GetMobileSubscriptionOrdersRequest,
  type GetMobileSubscriptionUsageRequest,
  type GetSimRequest,
  type OrderDataRequest,
  type OrderSummaryRequest,
  type PrequalificationRequest,
  type RadiusCheckRequest,
  type RasCheckRequest,
  type StartLineDiagnoseRequest,
  type ZipCodeCheckRequest,
} from './phase1.js';
import { RateLimiter } from './rate-limiter.js';
import { parseGrexxResponse, type GrexxParsedResponse } from './response.js';
import { resolveRequestBody, type XmlObject } from './xml.js';

export interface ConnectionTestResult {
  /**
   * True when Grexx processed the empty ZipCodeCheck probe (code 0) or
   * rejected it only as XML after accepting credentials (103, 104, 105, 109).
   */
  ok: boolean;
  /** False for codes 100–102, HTTP 401, or an inactive account (106). */
  authenticated: boolean;
  grexxCode?: number;
  message: string;
  authMode: AuthMode;
}

function retryAfter(headers: Headers): number | undefined {
  const raw = headers.get('retry-after');
  if (!raw) return undefined;
  const seconds = Number(raw);
  return Number.isFinite(seconds) ? seconds : undefined;
}

function gatewayError(
  parsed: GrexxParsedResponse,
  httpStatus: number,
  authMode: AuthMode,
  headers: Headers
): GrexxError | undefined {
  if (parsed.grexxCode === undefined) return undefined;
  const info = describeGrexxCode(parsed.grexxCode);
  if (info.category !== 'gateway') return undefined;

  let message = info.detail ?? info.message;
  if (parsed.message && parsed.message !== info.message && parsed.message !== message) {
    message = `${message}: ${parsed.message}`;
  }
  if (parsed.grexxCode === 101 && authMode === 'oauth') {
    message += ' The portal lists Basic on /realtime; set authMode to "basic" if acceptatie rejects Bearer.';
  }

  const options: GrexxErrorOptions = {
    grexxCode: parsed.grexxCode,
    httpStatus,
    responseXml: parsed.rawXml,
    parsed,
    retryAfterSeconds: retryAfter(headers),
  };
  if (parsed.grexxCode === 100 || parsed.grexxCode === 101 || parsed.grexxCode === 102) {
    return new GrexxAuthenticationError(message, options);
  }
  if (parsed.grexxCode === 108) return new GrexxRateLimitError(message, options);
  if (
    parsed.grexxCode === 103 ||
    parsed.grexxCode === 104 ||
    parsed.grexxCode === 105 ||
    parsed.grexxCode === 109
  ) {
    return new GrexxValidationError(message, options);
  }
  return new GrexxError(message, options);
}

/**
 * Grexx IRMA client for the KPN partner pilot (Phase 1, realtime).
 *
 * OAuth client-credentials is the default (`Authorization: Bearer`). Set
 * `authMode: 'basic'` if acceptatie answers code 101 on `/realtime`.
 * `baseUrl` is required; this client does not call developer.kpn.com.
 */
export class KpnGrexxClient {
  readonly authMode: AuthMode;
  private readonly authorizer: GrexxAuthorizer;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly rateLimiter: RateLimiter;

  constructor(config: KpnGrexxConfig, rateLimiter: RateLimiter = new RateLimiter()) {
    if (typeof config.username !== 'string' || config.username.trim() === '') {
      throw new Error('KPN_GREXX_USERNAME is required and must be a non-empty string.');
    }
    if (typeof config.password !== 'string' || config.password.trim() === '') {
      throw new Error('KPN_GREXX_PASSWORD is required and must be a non-empty string.');
    }
    if (typeof config.baseUrl !== 'string' || config.baseUrl.trim() === '') {
      throw new Error('KPN_GREXX_BASE_URL is required (no default host).');
    }
    const authMode = config.authMode ?? 'oauth';
    if (authMode !== 'oauth' && authMode !== 'basic') {
      throw new Error('authMode must be "oauth" or "basic".');
    }
    this.authMode = authMode;
    this.baseUrl = config.baseUrl.trim();
    this.fetchImpl = config.fetch ?? fetch;
    this.rateLimiter = rateLimiter;
    this.authorizer = new GrexxAuthorizer({ ...config, username: config.username.trim(), baseUrl: this.baseUrl, authMode });
  }

  /** Mint (or return the cached) OAuth access token. Does not log the secret. */
  getAccessToken(): Promise<string> {
    return this.authorizer.getAccessToken();
  }

  /**
   * Credential and base-URL probe. Posts an empty `ZipCodeCheckRequest_V6`.
   * Does not require a real address. Codes 103/104/105/109 count as success:
   * Grexx accepted the credentials and rejected only the empty XML.
   */
  async testConnection(): Promise<ConnectionTestResult> {
    try {
      const parsed = await this.postRealtimeXml(PHASE1_ROOTS.ZipCodeCheckRequest, {});
      return {
        ok: true,
        authenticated: true,
        grexxCode: parsed.grexxCode,
        message: parsed.message ?? parsed.grexxCodeMessage ?? 'Success',
        authMode: this.authMode,
      };
    } catch (error) {
      if (!(error instanceof GrexxError)) throw error;
      const code = error.grexxCode;
      const authenticated =
        code !== undefined &&
        code !== 100 &&
        code !== 101 &&
        code !== 102 &&
        code !== 106 &&
        error.httpStatus !== 401;
      const ok = code === 103 || code === 104 || code === 105 || code === 109;
      return {
        ok,
        authenticated,
        grexxCode: code,
        message: error.message,
        authMode: this.authMode,
      };
    }
  }

  /**
   * POST plain XML to `/realtime`. `body` is either child elements or a raw
   * XML string (see `resolveRequestBody`). Gateway codes 68 and 100–109 throw
   * {@link GrexxError}; code 0 and IRMA order statuses are returned.
   */
  postRealtimeXml(
    rootElement: string,
    body: XmlObject | string,
    options?: CallOptions
  ): Promise<GrexxParsedResponse> {
    return this.postXml('realtime', rootElement, body, options);
  }

  /**
   * Low-level POST to `/realtime`, `/queued` or `/ordermodule`.
   * Phase 1 typed helpers use realtime only. Queued and ordermodule results
   * are not a supported pilot workflow until a Proxymodule receiver exists.
   */
  postXml(
    channel: GrexxChannel,
    rootElement: string,
    body: XmlObject | string,
    options?: CallOptions
  ): Promise<GrexxParsedResponse> {
    return this.dispatch(channel, rootElement, body, options, false);
  }

  zipCodeCheck(request: ZipCodeCheckRequest, options?: CallOptions) {
    return this.postAndParse(
      PHASE1_ROOTS.ZipCodeCheckRequest,
      buildZipCodeCheckRequest(request),
      parseZipCodeCheckResponse,
      options
    );
  }

  prequalification(request: PrequalificationRequest, options?: CallOptions) {
    return this.postAndParse(
      PHASE1_ROOTS.PrequalificationRequest,
      buildPrequalificationRequest(request),
      parsePrequalificationResponse,
      options
    );
  }

  carrierInfo(request: CarrierInfoRequest, options?: CallOptions) {
    return this.postAndParse(
      PHASE1_ROOTS.CarrierInfoRequest,
      buildCarrierInfoRequest(request),
      parseCarrierInfoResponse,
      options
    );
  }

  radiusCheck(request: RadiusCheckRequest, options?: CallOptions) {
    return this.postAndParse(
      PHASE1_ROOTS.RadiusCheckRequest,
      buildRadiusCheckRequest(request),
      parseRadiusCheckResponse,
      options
    );
  }

  rasCheck(request: RasCheckRequest, options?: CallOptions) {
    return this.postAndParse(PHASE1_ROOTS.RasCheckRequest, buildRasCheckRequest(request), parseRasCheckResponse, options);
  }

  startLineDiagnose(request: StartLineDiagnoseRequest, options?: CallOptions) {
    return this.postAndParse(
      PHASE1_ROOTS.StartLineDiagnoseRequest,
      buildStartLineDiagnoseRequest(request),
      parseStartLineDiagnoseResponse,
      options
    );
  }

  customerData(request: CustomerDataRequest = {}, options?: CallOptions) {
    return this.postAndParse(
      PHASE1_ROOTS.CustomerDataRequest,
      buildCustomerDataRequest(request),
      parseCustomerDataResponse,
      options
    );
  }

  orderSummary(request: OrderSummaryRequest, options?: CallOptions) {
    return this.postAndParse(
      PHASE1_ROOTS.OrderSummaryRequest,
      buildOrderSummaryRequest(request),
      parseOrderSummaryResponse,
      options
    );
  }

  orderData(request: OrderDataRequest, options?: CallOptions) {
    return this.postAndParse(
      PHASE1_ROOTS.OrderDataRequest,
      buildOrderDataRequest(request),
      parseOrderDataResponse,
      options
    );
  }

  getSim(request: GetSimRequest, options?: CallOptions) {
    return this.postAndParse(PHASE1_ROOTS.GetSimRequest, buildGetSimRequest(request), parseGetSimResponse, options);
  }

  getMobileSettings(request: GetMobileSettingsRequest, options?: CallOptions) {
    return this.postAndParse(
      PHASE1_ROOTS.GetMobileSettingsRequest,
      buildGetMobileSettingsRequest(request),
      parseGetMobileSettingsResponse,
      options
    );
  }

  getMobileSubscriptionUsage(
    request: GetMobileSubscriptionUsageRequest,
    options?: CallOptions
  ) {
    return this.postAndParse(
      PHASE1_ROOTS.GetMobileSubscriptionUsageRequest,
      buildGetMobileSubscriptionUsageRequest(request),
      parseGetMobileSubscriptionUsageResponse,
      options
    );
  }

  getMobileSubscriptionOrders(
    request: GetMobileSubscriptionOrdersRequest,
    options?: CallOptions
  ) {
    return this.postAndParse(
      PHASE1_ROOTS.GetMobileSubscriptionOrdersRequest,
      buildGetMobileSubscriptionOrdersRequest(request),
      parseGetMobileSubscriptionOrdersResponse,
      options
    );
  }

  availablePortings(request: AvailablePortingsRequest, options?: CallOptions) {
    return this.postAndParse(
      PHASE1_ROOTS.AvailablePortingsRequest,
      buildAvailablePortingsRequest(request),
      parseAvailablePortingsResponse,
      options
    );
  }

  private async postAndParse<T>(
    rootElement: string,
    xml: string,
    parse: (body: string) => T,
    options?: CallOptions
  ): Promise<T> {
    const parsed = await this.postRealtimeXml(rootElement, xml, options);
    return parse(parsed.rawXml);
  }

  private async dispatch(
    channel: GrexxChannel,
    rootElement: string,
    body: XmlObject | string,
    options: CallOptions | undefined,
    retried: boolean
  ): Promise<GrexxParsedResponse> {
    await this.rateLimiter.acquire();
    const xml = resolveRequestBody(rootElement, body);
    const authorization = await this.authorizer.authorizationHeader();
    const response = await this.fetchImpl(grexxChannelUrl(this.baseUrl, channel), {
      method: 'POST',
      redirect: 'manual',
      signal: options?.signal,
      headers: {
        Authorization: authorization,
        'Content-Type': GREXX_XML_CONTENT_TYPE,
        Accept: 'application/xml, text/xml, */*',
      },
      body: xml,
    });

    if (isRedirect(response)) {
      throw new GrexxError(
        `Grexx redirected the request (${response.status || response.type}); redirects are not followed.`,
        { httpStatus: response.status || undefined }
      );
    }

    const text = await response.text();
    const parsed = text.trim().startsWith('<') ? tryParse(text) : undefined;
    const code = parsed?.grexxCode;
    const authRejected = code === 100 || code === 101 || code === 102;

    if (response.status === 401 && this.authMode === 'oauth' && !retried && !authRejected) {
      this.authorizer.invalidate();
      return this.dispatch(channel, rootElement, body, options, true);
    }

    if (parsed) {
      const gateway = gatewayError(parsed, response.status, this.authMode, response.headers);
      if (gateway) throw gateway;
      if (!response.ok) {
        throw new GrexxError(parsed.message ?? `Grexx HTTP ${response.status}.`, {
          grexxCode: parsed.grexxCode,
          httpStatus: response.status,
          responseXml: text,
          parsed,
        });
      }
      return parsed;
    }

    if (response.status === 401) {
      throw new GrexxAuthenticationError('Grexx authentication failed.', {
        httpStatus: 401,
        responseXml: text,
      });
    }
    if (response.status === 429) {
      throw new GrexxRateLimitError('Too Many Requests', {
        httpStatus: 429,
        responseXml: text,
        retryAfterSeconds: retryAfter(response.headers),
      });
    }
    if (!response.ok) {
      throw new GrexxError(text.trim() || `Grexx HTTP ${response.status}.`, {
        httpStatus: response.status,
        responseXml: text,
      });
    }
    throw new GrexxError('Grexx response was not well-formed XML.', {
      httpStatus: response.status,
      responseXml: text,
    });
  }
}

function isRedirect(response: Response): boolean {
  return response.type === 'opaqueredirect' || (response.status >= 300 && response.status < 400);
}

function tryParse(xml: string): GrexxParsedResponse | undefined {
  try {
    return parseGrexxResponse(xml);
  } catch {
    return undefined;
  }
}
