import type { GrexxParsedResponse } from './response.js';

export interface GrexxErrorOptions {
  /** Grexx gateway code (0, 68, 100–109) when the body carried one. */
  grexxCode?: number;
  httpStatus?: number;
  responseXml?: string;
  parsed?: GrexxParsedResponse;
  retryAfterSeconds?: number;
}

/**
 * Failure from the Grexx IRMA HTTP API.
 * `grexxCode` is set when the XML (or a mapped HTTP 429) carries a gateway code.
 */
export class GrexxError extends Error {
  readonly grexxCode: number | undefined;
  readonly httpStatus: number | undefined;
  readonly responseXml: string | undefined;
  readonly parsed: GrexxParsedResponse | undefined;

  constructor(message: string, options: GrexxErrorOptions = {}) {
    super(message);
    this.name = new.target.name;
    this.grexxCode = options.grexxCode;
    this.httpStatus = options.httpStatus;
    this.responseXml = options.responseXml;
    this.parsed = options.parsed;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** Codes 100–102, or HTTP 401 without a more specific XML code. */
export class GrexxAuthenticationError extends GrexxError {}

/** Codes 103, 104, 105 and 109 (missing, malformed, unknown or invalid XML). */
export class GrexxValidationError extends GrexxError {}

/** Code 108, or HTTP 429. `retryAfterSeconds` comes from the Retry-After header when present. */
export class GrexxRateLimitError extends GrexxError {
  retryAfterSeconds: number | undefined;

  constructor(message: string, options: GrexxErrorOptions = {}) {
    super(message, options);
    this.retryAfterSeconds = options.retryAfterSeconds;
  }
}
