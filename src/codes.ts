/**
 * Grexx gateway codes and IRMA order statuses.
 *
 * Gateway wording follows the Grexx FAQ (codes 100–109). Code 68 and the
 * 2xx order statuses follow the IRMA order-lifecycle table in the partner
 * general-info brief.
 */

export type GrexxCodeCategory = 'success' | 'gateway' | 'order' | 'routit' | 'unknown';

export interface GrexxCodeInfo {
  code: number;
  /** Short label (gateway message, `Active`, `Accepted`, …). */
  message: string;
  /** Longer IRMA description when the short label is not the whole story. */
  detail?: string;
  category: GrexxCodeCategory;
}

/** Gateway / transport codes. 0 is success; 68 is the unknown RoutIT error. */
export const GATEWAY_CODES: Record<number, string> = {
  0: 'Success',
  68: 'Error',
  100: 'Authorization header required',
  101: 'Authorization scheme basic required',
  102: 'Wrong username/password or ip address not allowed',
  103: 'XML message not found',
  104: 'XML message not well formed',
  105: 'Cannot find the message type',
  106: 'Account inactive',
  107: 'Message type not allowed',
  108: 'Too Many Requests',
  109: 'XML validation error',
};

const GATEWAY_DETAILS: Record<number, string> = {
  68: 'Error — unknown RoutIT error',
  102: 'Wrong username/password or IP address not allowed',
};

/**
 * IRMA order-lifecycle statuses. These are business outcomes on a queued or
 * order-module flow, not Grexx gateway failures.
 */
export const ORDER_STATUSES: Record<number, string> = {
  201: 'Active',
  203: 'Order Modified',
  204: 'Accepted',
  205: 'Terminate Accepted',
  207: 'Terminate Completed',
  208: 'Order Rejected',
  209: 'Order Cancel',
  213: 'Unexpected Error',
  214: 'Model Validation Failed',
};

const ORDER_DETAILS: Record<number, string> = {
  201: 'Order Active — existing order successfully activated',
  203: 'Order Modified — existing order successfully changed',
  204: 'Order Placed — new order successfully created',
  205: 'Terminate Accepted — termination accepted',
  207: 'Terminate Completed — termination executed',
  208: 'Order Rejected — create request rejected',
  209: 'Order Cancel — order cancelled',
  213: 'Unexpected Error',
  214: 'Model Validation Failed',
};

const ORDER_LABEL_TO_CODE: Record<string, number> = {
  Active: 201,
  Accepted: 204,
  'Order Modified': 203,
  'Terminate Accepted': 205,
  'Terminate Completed': 207,
  'Order Rejected': 208,
  'Order Cancel': 209,
  'Unexpected Error': 213,
  'Model Validation Failed': 214,
};

export function describeGrexxCode(code: number): GrexxCodeInfo {
  if (code === 0) {
    return { code, message: GATEWAY_CODES[0]!, category: 'success' };
  }
  if (code === 68 || (code >= 100 && code <= 109)) {
    return {
      code,
      message: GATEWAY_CODES[code] ?? `Grexx code ${code}`,
      detail: GATEWAY_DETAILS[code],
      category: 'gateway',
    };
  }
  if (ORDER_STATUSES[code] !== undefined) {
    return {
      code,
      message: ORDER_STATUSES[code]!,
      detail: ORDER_DETAILS[code],
      category: 'order',
    };
  }
  if (code >= 1 && code <= 100_000) {
    return { code, message: `RoutIT-specific code ${code}`, category: 'routit' };
  }
  return { code, message: `Unrecognized code ${code}`, category: 'unknown' };
}

/** Map a non-numeric order status label (`Active`, `Accepted`, …) to its code. */
export function orderStatusCodeFromLabel(label: string): number | undefined {
  return ORDER_LABEL_TO_CODE[label.trim()];
}
