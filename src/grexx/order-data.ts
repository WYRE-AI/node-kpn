import { GrexxValidationError } from './errors.js';
import { buildXmlDocument, type XmlNode, type XmlObject, type XmlValue, parseXml } from './xml.js';

export interface OrderDataSource {
  rawXml: string;
  document: XmlObject;
  requestId?: string;
  httpStatus: number;
}

export const ORDER_DATA_REQUEST_ELEMENT = 'OrderDataRequest_V1';
export const ORDER_DATA_RESPONSE_ELEMENT = 'OrderDataResponse_V1';

/** XSD `Status_V1` / `Code`. */
export const ORDER_DATA_STATUS_CODES = ['Success', 'UnknownError', 'ValidationError'] as const;
export type OrderDataStatusCode = (typeof ORDER_DATA_STATUS_CODES)[number];

const XS_INT_MIN = -2_147_483_648;
const XS_INT_MAX = 2_147_483_647;
const PRODUCT_CODE_MAX = 13;

/** Fields for `OrderDataRequest_V1`. */
export interface OrderDataInput {
  /** `OrderId` (`xs:int`). */
  orderId: number;
}

export interface OrderDataStatus {
  messages: string[];
  code: OrderDataStatusCode;
}

/** `OrderData_V1`. Present only when the response includes `Order`. */
export interface OrderDataOrder {
  customerId: number;
  productCode: string;
  quantity: number;
}

/**
 * `OrderDataResponse_V1`.
 * `parseOrderDataResponse` returns every `Status/Code`, including
 * `ValidationError` and `UnknownError`. `GrexxClient.orderData` still goes
 * through `postRealtime`, which throws those codes the same way as other reads.
 */
export interface OrderDataResult {
  status: OrderDataStatus;
  order?: OrderDataOrder;
  rawXml: string;
  requestId?: string;
  httpStatus: number;
}

function assertXsInt(value: number, label: string, code: string): void {
  if (!Number.isSafeInteger(value) || value < XS_INT_MIN || value > XS_INT_MAX) {
    throw new GrexxValidationError(`${label} must be an xs:int.`, 0, undefined, code);
  }
}

function isStatusCode(value: string): value is OrderDataStatusCode {
  return (ORDER_DATA_STATUS_CODES as readonly string[]).includes(value);
}

/** Normalize and validate an OrderData request. */
export function orderDataFields(input: OrderDataInput): Record<string, XmlValue> {
  assertXsInt(input.orderId, 'OrderId', 'invalid_order_id');
  return { OrderId: input.orderId };
}

/** Build an `OrderDataRequest_V1` document (plain XML, no SOAP envelope). */
export function buildOrderDataRequest(input: OrderDataInput): string {
  return buildXmlDocument(ORDER_DATA_REQUEST_ELEMENT, orderDataFields(input));
}

function asObject(node: XmlNode | undefined): XmlObject | undefined {
  if (node !== null && typeof node === 'object' && !Array.isArray(node)) return node;
  return undefined;
}

function text(record: XmlObject | undefined, key: string): string | undefined {
  const value = record?.[key];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function stringList(node: XmlNode | undefined): string[] {
  const record = asObject(node);
  if (!record) return [];
  const value = record['string'];
  if (typeof value === 'string') return value ? [value] : [];
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string' && item.length > 0);
}

function readRequiredInt(record: XmlObject, key: string, fail: (message: string, code: string) => never): number {
  const value = record[key];
  if (typeof value === 'string' && /^[+-]?\d+$/.test(value)) {
    const parsed = Number(value);
    if (Number.isSafeInteger(parsed) && parsed >= XS_INT_MIN && parsed <= XS_INT_MAX) return parsed;
  }
  fail(`${key} must be an xs:int.`, key === 'CustomerId' ? 'invalid_customer_id' : 'invalid_quantity');
}

function readProductCode(record: XmlObject, fail: (message: string, code: string) => never): string {
  const value = text(record, 'ProductCode');
  if (!value || value.length > PRODUCT_CODE_MAX) {
    fail('ProductCode must be 1 to 13 characters.', 'invalid_product_code');
  }
  return value;
}

function responseRoot(document: XmlObject, element: string, fail: (message: string, code: string) => never): XmlObject {
  if (!Object.prototype.hasOwnProperty.call(document, element)) {
    const found = Object.keys(document)[0] ?? '(empty)';
    throw fail(`Expected ${element} but received <${found}>`, 'unexpected_response_root');
  }
  const node = document[element];
  const record = asObject(node);
  if (record) return record;
  // An empty element has no children, so the XML parser yields '' (or null when nil).
  if (node === null || node === '') return {};
  throw fail(`Expected ${element} but received <${element}>`, 'unexpected_response_root');
}

function parseOrder(node: XmlNode | undefined, fail: (message: string, code: string) => never): OrderDataOrder | undefined {
  const record = asObject(node);
  if (!record) return undefined;
  return {
    customerId: readRequiredInt(record, 'CustomerId', fail),
    productCode: readProductCode(record, fail),
    quantity: readRequiredInt(record, 'Quantity', fail),
  };
}

/** Map an `OrderDataResponse_V1` document (or a realtime result) onto a typed result. */
export function parseOrderDataResponse(source: OrderDataSource | string): OrderDataResult {
  const rawXml = typeof source === 'string' ? source : source.rawXml;
  const document = typeof source === 'string' ? parseXml(source) : source.document;
  const fail = (message: string, code: string): never => {
    throw new GrexxValidationError(
      message,
      typeof source === 'string' ? 0 : source.httpStatus,
      rawXml,
      code,
      typeof source === 'string' ? undefined : source.requestId,
    );
  };
  const root = responseRoot(document, ORDER_DATA_RESPONSE_ELEMENT, fail);
  const status = asObject(root['Status']);
  if (!status) throw fail('Status is required.', 'missing_status');
  const code = text(status, 'Code');
  if (!code || !isStatusCode(code)) {
    throw fail(`Status/Code must be one of ${ORDER_DATA_STATUS_CODES.join(', ')}.`, 'invalid_status_code');
  }
  const order = parseOrder(root['Order'], fail);
  return {
    status: { messages: stringList(status['Messages']), code },
    ...(order ? { order } : {}),
    rawXml,
    requestId: typeof source === 'string' ? undefined : source.requestId,
    httpStatus: typeof source === 'string' ? 0 : source.httpStatus,
  };
}
