/**
 * Phase 1 IRMA request builders and response parsers.
 *
 * Field lists are provisional. The realtime inventory export has descriptions,
 * not XSDs, so element names follow those descriptions (address, customer,
 * order, MSISDN, porting ids) plus common IRMA PascalCase. Unknown XSD fields
 * go in `extra` and are emitted as sibling elements. For a byte-exact body,
 * call `postRealtimeXml(rootElement, xmlString)`.
 */
import { buildRequestXml, type XmlObject, type XmlValue } from './xml.js';
import { parseTypedResponse, type GrexxParsedResponse } from './response.js';

/** Exact IRMA root element names. ZipCodeCheck is V6, the only version in the inventory. */
export const PHASE1_ROOTS = {
  ZipCodeCheckRequest: 'ZipCodeCheckRequest_V6',
  PrequalificationRequest: 'PrequalificationRequest_V2',
  CarrierInfoRequest: 'CarrierInfoRequest_V1',
  RadiusCheckRequest: 'RadiusCheckRequest_V1',
  RasCheckRequest: 'RasCheckRequest_V1',
  StartLineDiagnoseRequest: 'StartLineDiagnoseRequest_V1',
  CustomerDataRequest: 'CustomerDataRequest_V1',
  OrderSummaryRequest: 'OrderSummaryRequest_V1',
  OrderDataRequest: 'OrderDataRequest_V1',
  GetSimRequest: 'GetSimRequest_V1',
  GetSimCardRequest: 'GetSimCardRequest_V1',
  GetMobileSettingsRequest: 'GetMobileSettingsRequest_V1',
  GetMobileSubscriptionUsageRequest: 'GetMobileSubscriptionUsageRequest_V1',
  GetMobileSubscriptionOrdersRequest: 'GetMobileSubscriptionOrdersRequest_V1',
  AvailablePortingsRequest: 'AvailablePortingsRequest_V1',
} as const;

export interface ZipCodeCheckRequest {
  ZipCode: string;
  HouseNumber: string | number;
  HouseNumberExtension?: string;
  extra?: XmlObject;
}

export interface PrequalificationRequest extends ZipCodeCheckRequest {
  /** Provisional. Pass the XSD name via `extra` if acceptatie rejects this element. */
  ConnectionPoint?: string;
  AccessType?: string;
}

export interface CarrierInfoRequest extends ZipCodeCheckRequest {}

export interface RadiusCheckRequest {
  /** RADIUS / service username. Provisional without an XSD. */
  Username?: string;
  OrderId?: string;
  extra?: XmlObject;
}

export interface RasCheckRequest {
  /** PPP/RAS username. Provisional without an XSD. */
  Username?: string;
  OrderId?: string;
  extra?: XmlObject;
}

export interface StartLineDiagnoseRequest {
  OrderId: string;
  extra?: XmlObject;
}

/** Every field is optional: the inventory says an empty request returns all customers. */
export interface CustomerDataRequest {
  CustomerId?: string;
  CustomerNumber?: string;
  Name?: string;
  ZipCode?: string;
  HouseNumber?: string | number;
  HouseNumberExtension?: string;
  Email?: string;
  CocNumber?: string;
  extra?: XmlObject;
}

export interface OrderSummaryRequest {
  CustomerId: string;
  /**
   * Pagination offset. The inventory description names this `skip`
   * (max 2500 orders per call).
   */
  Skip?: string | number;
  extra?: XmlObject;
}

export interface OrderDataRequest {
  OrderId: string;
  extra?: XmlObject;
}

/** Shared by GetSimRequest_V1 and GetSimCardRequest_V1 (inventory: active SIM on the active mobile order). */
export interface GetSimRequest {
  OrderId?: string;
  Msisdn?: string;
  extra?: XmlObject;
}

export interface GetMobileSettingsRequest {
  Msisdn: string;
  extra?: XmlObject;
}

export interface GetMobileSubscriptionUsageRequest {
  Msisdn: string;
  extra?: XmlObject;
}

export interface GetMobileSubscriptionOrdersRequest {
  CustomerId?: string;
  Msisdn?: string | string[];
  OrderId?: string | string[];
  extra?: XmlObject;
}

export interface AvailablePortingsRequest {
  MobileSubscriptionCustomerId?: string;
  /**
   * The inventory sentence spells this id `MobileSubscripionCustomerId`
   * (missing "t"). Set this instead of {@link MobileSubscriptionCustomerId}
   * if the XSD preserved that spelling.
   */
  MobileSubscripionCustomerId?: string;
  HipGroupOrderId?: string;
  extra?: XmlObject;
}

function isBlank(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (typeof value === 'string') return value.trim() === '';
  if (Array.isArray(value)) return value.length === 0 || value.every(isBlank);
  return false;
}

function requireField(value: unknown, name: string): void {
  if (isBlank(value)) throw new Error(`${name} is required.`);
}

function requireOne(label: string, pairs: Array<[string, unknown]>): void {
  if (!pairs.some(([, value]) => !isBlank(value))) {
    throw new Error(`${label} requires at least one of ${pairs.map(([name]) => name).join(', ')}.`);
  }
}

function pack(entries: Array<[string, XmlValue | undefined]>, extra?: XmlObject): XmlObject {
  const out: XmlObject = {};
  for (const [key, value] of entries) {
    if (value === undefined || value === null) continue;
    out[key] = value;
  }
  if (extra) {
    for (const [key, value] of Object.entries(extra)) {
      if (value === undefined || value === null) continue;
      if (key in out) throw new Error(`extra field "${key}" duplicates a known element.`);
      out[key] = value;
    }
  }
  return out;
}

function locationEntries(request: ZipCodeCheckRequest): Array<[string, XmlValue | undefined]> {
  requireField(request.ZipCode, 'ZipCode');
  requireField(request.HouseNumber, 'HouseNumber');
  return [
    ['ZipCode', request.ZipCode],
    ['HouseNumber', request.HouseNumber],
    ['HouseNumberExtension', request.HouseNumberExtension],
  ];
}

export function buildZipCodeCheckRequest(request: ZipCodeCheckRequest): string {
  return buildRequestXml(PHASE1_ROOTS.ZipCodeCheckRequest, pack(locationEntries(request), request.extra));
}

export function buildPrequalificationRequest(request: PrequalificationRequest): string {
  return buildRequestXml(
    PHASE1_ROOTS.PrequalificationRequest,
    pack(
      [
        ...locationEntries(request),
        ['ConnectionPoint', request.ConnectionPoint],
        ['AccessType', request.AccessType],
      ],
      request.extra
    )
  );
}

export function buildCarrierInfoRequest(request: CarrierInfoRequest): string {
  return buildRequestXml(PHASE1_ROOTS.CarrierInfoRequest, pack(locationEntries(request), request.extra));
}

function usernameOrOrder(label: string, request: RadiusCheckRequest): XmlObject {
  requireOne(label, [
    ['Username', request.Username],
    ['OrderId', request.OrderId],
  ]);
  return pack(
    [
      ['Username', request.Username],
      ['OrderId', request.OrderId],
    ],
    request.extra
  );
}

export function buildRadiusCheckRequest(request: RadiusCheckRequest): string {
  return buildRequestXml(PHASE1_ROOTS.RadiusCheckRequest, usernameOrOrder('RadiusCheckRequest', request));
}

export function buildRasCheckRequest(request: RasCheckRequest): string {
  return buildRequestXml(PHASE1_ROOTS.RasCheckRequest, usernameOrOrder('RasCheckRequest', request));
}

export function buildStartLineDiagnoseRequest(request: StartLineDiagnoseRequest): string {
  requireField(request.OrderId, 'OrderId');
  return buildRequestXml(
    PHASE1_ROOTS.StartLineDiagnoseRequest,
    pack([['OrderId', request.OrderId]], request.extra)
  );
}

export function buildCustomerDataRequest(request: CustomerDataRequest = {}): string {
  return buildRequestXml(
    PHASE1_ROOTS.CustomerDataRequest,
    pack(
      [
        ['CustomerId', request.CustomerId],
        ['CustomerNumber', request.CustomerNumber],
        ['Name', request.Name],
        ['ZipCode', request.ZipCode],
        ['HouseNumber', request.HouseNumber],
        ['HouseNumberExtension', request.HouseNumberExtension],
        ['Email', request.Email],
        ['CocNumber', request.CocNumber],
      ],
      request.extra
    )
  );
}

export function buildOrderSummaryRequest(request: OrderSummaryRequest): string {
  requireField(request.CustomerId, 'CustomerId');
  return buildRequestXml(
    PHASE1_ROOTS.OrderSummaryRequest,
    pack(
      [
        ['CustomerId', request.CustomerId],
        ['Skip', request.Skip],
      ],
      request.extra
    )
  );
}

export function buildOrderDataRequest(request: OrderDataRequest): string {
  requireField(request.OrderId, 'OrderId');
  return buildRequestXml(PHASE1_ROOTS.OrderDataRequest, pack([['OrderId', request.OrderId]], request.extra));
}

function simFields(request: GetSimRequest): XmlObject {
  requireOne('GetSimRequest', [
    ['OrderId', request.OrderId],
    ['Msisdn', request.Msisdn],
  ]);
  return pack(
    [
      ['OrderId', request.OrderId],
      ['Msisdn', request.Msisdn],
    ],
    request.extra
  );
}

export function buildGetSimRequest(request: GetSimRequest): string {
  return buildRequestXml(PHASE1_ROOTS.GetSimRequest, simFields(request));
}

export function buildGetSimCardRequest(request: GetSimRequest): string {
  return buildRequestXml(PHASE1_ROOTS.GetSimCardRequest, simFields(request));
}

export function buildGetMobileSettingsRequest(request: GetMobileSettingsRequest): string {
  requireField(request.Msisdn, 'Msisdn');
  return buildRequestXml(
    PHASE1_ROOTS.GetMobileSettingsRequest,
    pack([['Msisdn', request.Msisdn]], request.extra)
  );
}

export function buildGetMobileSubscriptionUsageRequest(request: GetMobileSubscriptionUsageRequest): string {
  requireField(request.Msisdn, 'Msisdn');
  return buildRequestXml(
    PHASE1_ROOTS.GetMobileSubscriptionUsageRequest,
    pack([['Msisdn', request.Msisdn]], request.extra)
  );
}

export function buildGetMobileSubscriptionOrdersRequest(request: GetMobileSubscriptionOrdersRequest): string {
  requireOne('GetMobileSubscriptionOrdersRequest', [
    ['CustomerId', request.CustomerId],
    ['Msisdn', request.Msisdn],
    ['OrderId', request.OrderId],
  ]);
  return buildRequestXml(
    PHASE1_ROOTS.GetMobileSubscriptionOrdersRequest,
    pack(
      [
        ['CustomerId', request.CustomerId],
        ['Msisdn', request.Msisdn],
        ['OrderId', request.OrderId],
      ],
      request.extra
    )
  );
}

export function buildAvailablePortingsRequest(request: AvailablePortingsRequest): string {
  requireOne('AvailablePortingsRequest', [
    ['MobileSubscriptionCustomerId', request.MobileSubscriptionCustomerId],
    ['MobileSubscripionCustomerId', request.MobileSubscripionCustomerId],
    ['HipGroupOrderId', request.HipGroupOrderId],
  ]);
  return buildRequestXml(
    PHASE1_ROOTS.AvailablePortingsRequest,
    pack(
      [
        ['MobileSubscriptionCustomerId', request.MobileSubscriptionCustomerId],
        ['MobileSubscripionCustomerId', request.MobileSubscripionCustomerId],
        ['HipGroupOrderId', request.HipGroupOrderId],
      ],
      request.extra
    )
  );
}

export function parseZipCodeCheckResponse(xml: string): GrexxParsedResponse {
  return parseTypedResponse(xml, ['ZipCodeCheck']);
}

export function parsePrequalificationResponse(xml: string): GrexxParsedResponse {
  return parseTypedResponse(xml, ['Prequalification']);
}

export function parseCarrierInfoResponse(xml: string): GrexxParsedResponse {
  return parseTypedResponse(xml, ['CarrierInfo']);
}

export function parseRadiusCheckResponse(xml: string): GrexxParsedResponse {
  return parseTypedResponse(xml, ['RadiusCheck']);
}

export function parseRasCheckResponse(xml: string): GrexxParsedResponse {
  return parseTypedResponse(xml, ['RasCheck']);
}

export function parseStartLineDiagnoseResponse(xml: string): GrexxParsedResponse {
  return parseTypedResponse(xml, ['StartLineDiagnose', 'LineDiagnose']);
}

export function parseCustomerDataResponse(xml: string): GrexxParsedResponse {
  return parseTypedResponse(xml, ['CustomerData']);
}

export function parseOrderSummaryResponse(xml: string): GrexxParsedResponse {
  return parseTypedResponse(xml, ['OrderSummary']);
}

export function parseOrderDataResponse(xml: string): GrexxParsedResponse {
  return parseTypedResponse(xml, ['OrderData']);
}

export function parseGetSimResponse(xml: string): GrexxParsedResponse {
  return parseTypedResponse(xml, ['GetSim']);
}

export function parseGetSimCardResponse(xml: string): GrexxParsedResponse {
  return parseTypedResponse(xml, ['GetSimCard']);
}

export function parseGetMobileSettingsResponse(xml: string): GrexxParsedResponse {
  return parseTypedResponse(xml, ['GetMobileSettings']);
}

export function parseGetMobileSubscriptionUsageResponse(xml: string): GrexxParsedResponse {
  return parseTypedResponse(xml, ['GetMobileSubscriptionUsage']);
}

export function parseGetMobileSubscriptionOrdersResponse(xml: string): GrexxParsedResponse {
  return parseTypedResponse(xml, ['GetMobileSubscriptionOrders']);
}

export function parseAvailablePortingsResponse(xml: string): GrexxParsedResponse {
  return parseTypedResponse(xml, ['AvailablePortings']);
}
