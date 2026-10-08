import { GrexxValidationError } from './errors.js';
import { buildXmlDocument, type XmlNode, type XmlObject, type XmlValue, parseXml } from './xml.js';

export interface ZipCodeCheckSource {
  rawXml: string;
  document: XmlObject;
  requestId?: string;
  httpStatus: number;
}

export const ZIP_CODE_CHECK_REQUEST_ELEMENT = 'ZipCodeCheckRequest_V6';
export const ZIP_CODE_CHECK_RESPONSE_ELEMENT = 'ZipCodeCheckResponse_V5';

/** XSD `ZipCodeCheckRequest_V6` / `Portfolio`. */
export const ZIP_CODE_PORTFOLIOS = ['Business', 'SMB', 'Teleworker', 'All'] as const;
export type ZipCodePortfolio = (typeof ZIP_CODE_PORTFOLIOS)[number];

/** XSD `Suppliers` / `string`. Empty or omitted checks every supplier. */
export const ZIP_CODE_SUPPLIERS = [
  'KPN',
  'KPNWEAS',
  'Eurofiber',
  'Tele2',
  'Tele2Fiber',
  'CAIW',
  'OverigeAanbieders',
] as const;
export type ZipCodeSupplier = (typeof ZIP_CODE_SUPPLIERS)[number];

/**
 * Fields for `ZipCodeCheckRequest_V6` (elementFormDefault qualified, `xs:all`).
 * Names here are the SDK's; the builder emits the XSD element names.
 */
export interface ZipCodeCheckInput {
  /** `Portfolio`. Business, SMB, Teleworker, or All. */
  portfolio: ZipCodePortfolio;
  /** `ZipCode`. Dutch postcode, for example `1012JS` or `1012 JS`. */
  zipCode: string;
  /** `HouseNr` (`xs:int`). */
  houseNumber: number;
  /** `HouseNrExtension`. */
  houseNumberExtension?: string;
  /** `ServiceId`. KPN lines only. */
  serviceId?: string;
  /** `RoomNumber`. */
  roomNumber?: string;
  /** `IsRoomNumberKnown` (`xs:boolean`). */
  isRoomNumberKnown: boolean;
  /** `Suppliers`. Omit or pass an empty list to check every supplier. */
  suppliers?: readonly ZipCodeSupplier[];
}

export interface ZipCodeAvailableSpeed {
  availability?: string;
  description?: string;
  nlsType?: string;
  remarks: string[];
  technology?: string;
  tariffCluster?: string;
  planDate?: string;
}

export interface ZipCodeCopperOff {
  endOfSaleDate?: string;
  endOfLifeDate?: string;
}

export interface ZipCodeActionRequired {
  actionText?: string;
  actionUri?: string;
}

export interface ZipCodeAvailableSupplier {
  name?: string;
  errorMessage?: string;
  locationInfo?: string;
  speeds: ZipCodeAvailableSpeed[];
  copperOff?: ZipCodeCopperOff;
  actionRequired?: ZipCodeActionRequired;
}

export interface ZipCodeCheckResult {
  code?: string;
  messages: string[];
  suppliers: ZipCodeAvailableSupplier[];
  rawXml: string;
  requestId?: string;
  httpStatus: number;
}

const POSTCODE = /^[1-9][0-9]{3}[A-Z]{2}$/;

function optionalText(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function isPortfolio(value: string): value is ZipCodePortfolio {
  return (ZIP_CODE_PORTFOLIOS as readonly string[]).includes(value);
}

function isSupplier(value: string): value is ZipCodeSupplier {
  return (ZIP_CODE_SUPPLIERS as readonly string[]).includes(value);
}

/** Normalize and validate a ZipCodeCheck request into XSD element order. */
export function zipCodeCheckFields(input: ZipCodeCheckInput): Record<string, XmlValue> {
  if (!isPortfolio(input.portfolio)) {
    throw new GrexxValidationError(
      `Portfolio must be one of ${ZIP_CODE_PORTFOLIOS.join(', ')}.`,
      0,
      undefined,
      'invalid_portfolio',
    );
  }
  const compact = (input.zipCode ?? '').trim().replace(/\s+/g, '').toUpperCase();
  if (!POSTCODE.test(compact)) {
    throw new GrexxValidationError('ZipCode must be a Dutch postcode, for example 1012JS.', 0, undefined, 'invalid_zipcode');
  }
  if (!Number.isSafeInteger(input.houseNumber) || input.houseNumber < 1 || input.houseNumber > 2_147_483_647) {
    throw new GrexxValidationError('HouseNr must be a positive xs:int.', 0, undefined, 'invalid_house_number');
  }
  if (typeof input.isRoomNumberKnown !== 'boolean') {
    throw new GrexxValidationError('IsRoomNumberKnown is required and must be a boolean.', 0, undefined, 'invalid_room_flag');
  }

  const suppliers = input.suppliers ?? [];
  for (const supplier of suppliers) {
    if (!isSupplier(supplier)) {
      throw new GrexxValidationError(
        `Unknown supplier "${String(supplier)}". Expected one of ${ZIP_CODE_SUPPLIERS.join(', ')}.`,
        0,
        undefined,
        'invalid_supplier',
      );
    }
  }

  const fields: Record<string, XmlValue> = {
    Portfolio: input.portfolio,
    ZipCode: compact,
    HouseNr: input.houseNumber,
  };
  const extension = optionalText(input.houseNumberExtension);
  const serviceId = optionalText(input.serviceId);
  const roomNumber = optionalText(input.roomNumber);
  if (extension) fields['HouseNrExtension'] = extension;
  if (serviceId) fields['ServiceId'] = serviceId;
  if (roomNumber) fields['RoomNumber'] = roomNumber;
  fields['IsRoomNumberKnown'] = input.isRoomNumberKnown;
  if (suppliers.length > 0) fields['Suppliers'] = { string: [...suppliers] };
  return fields;
}

/** Build a `ZipCodeCheckRequest_V6` document (plain XML, no SOAP envelope). */
export function buildZipCodeCheckRequest(input: ZipCodeCheckInput): string {
  return buildXmlDocument(ZIP_CODE_CHECK_REQUEST_ELEMENT, zipCodeCheckFields(input));
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

function objects(node: XmlNode | undefined, key: string): XmlObject[] {
  const record = asObject(node);
  if (!record) return [];
  const value = record[key];
  if (Array.isArray(value)) {
    return value.filter((item): item is XmlObject => item !== null && typeof item === 'object' && !Array.isArray(item));
  }
  const one = asObject(value ?? undefined);
  return one ? [one] : [];
}

function parseSpeed(node: XmlObject): ZipCodeAvailableSpeed {
  return {
    availability: text(node, 'Availability'),
    description: text(node, 'Description'),
    nlsType: text(node, 'NlsType'),
    remarks: stringList(node['Remarks']),
    technology: text(node, 'Technology'),
    tariffCluster: text(node, 'TariffCluster'),
    planDate: text(node, 'PlanDate'),
  };
}

function parseSupplier(node: XmlObject): ZipCodeAvailableSupplier {
  const copper = asObject(node['CopperOff']);
  const action = asObject(node['ActionRequired']);
  const copperOff = copper
    ? { endOfSaleDate: text(copper, 'EndOfSaleDate'), endOfLifeDate: text(copper, 'EndOfLifeDate') }
    : undefined;
  const actionRequired = action
    ? { actionText: text(action, 'ActionText'), actionUri: text(action, 'ActionUri') }
    : undefined;
  return {
    name: text(node, 'Name'),
    errorMessage: text(node, 'ErrorMessage'),
    locationInfo: text(node, 'LocationInfo'),
    speeds: objects(node['AvailableSpeeds'], 'AvailableSpeed_V4').map(parseSpeed),
    ...(copperOff && (copperOff.endOfSaleDate || copperOff.endOfLifeDate) ? { copperOff } : {}),
    ...(actionRequired && (actionRequired.actionText || actionRequired.actionUri) ? { actionRequired } : {}),
  };
}

/** Map a `ZipCodeCheckResponse_V5` document (or a realtime result) onto a typed result. */
export function parseZipCodeCheckResponse(source: ZipCodeCheckSource | string): ZipCodeCheckResult {
  const rawXml = typeof source === 'string' ? source : source.rawXml;
  const document = typeof source === 'string' ? parseXml(source) : source.document;
  const root = asObject(document[ZIP_CODE_CHECK_RESPONSE_ELEMENT]);
  if (!root) {
    const found = Object.keys(document)[0] ?? '(empty)';
    throw new GrexxValidationError(
      `Expected ${ZIP_CODE_CHECK_RESPONSE_ELEMENT} but received <${found}>`,
      typeof source === 'string' ? 0 : source.httpStatus,
      rawXml,
      'unexpected_response_root',
    );
  }
  const status = asObject(root['Status']);
  const code = text(status, 'Code');
  return {
    code,
    messages: stringList(status?.['Messages']),
    suppliers: objects(root['AvailableSuppliers'], 'AvailableSupplier_V5').map(parseSupplier),
    rawXml,
    requestId: typeof source === 'string' ? undefined : source.requestId,
    httpStatus: typeof source === 'string' ? 0 : source.httpStatus,
  };
}
