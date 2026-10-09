import { GrexxValidationError } from './errors.js';
import { buildXmlDocument, type XmlNode, type XmlObject, type XmlValue, parseXml } from './xml.js';

export interface PrequalificationSource {
  rawXml: string;
  document: XmlObject;
  requestId?: string;
  httpStatus: number;
}

export const PREQUALIFICATION_REQUEST_ELEMENT = 'PrequalificationRequest_V2';
export const PREQUALIFICATION_RESPONSE_ELEMENT = 'PrequalificationResponse_V1';

/** XSD `PrequalificationRequest_V2` / `ProductTypeCode`. */
export const PREQUALIFICATION_PRODUCT_TYPES = [
  'ADSLTele',
  'VDSLTele',
  'FTTHTele',
  'ADSLSMB',
  'VDSLSMB',
  'FTTHSMB',
  'VDSLZakelijk',
  'ADSLZakelijk',
  'SDSL',
  'FIBER',
] as const;
export type PrequalificationProductType = (typeof PREQUALIFICATION_PRODUCT_TYPES)[number];

/**
 * XSD `Suppliers` / `string`. Empty or omitted checks every supplier.
 * These tokens differ from ZipCodeCheck (`Kpn`, not `KPN`).
 */
export const PREQUALIFICATION_SUPPLIERS = ['Kpn', 'KpnWeas', 'Caiw', 'Eurofiber', 'Tele2', 'Tele2Fiber'] as const;
export type PrequalificationSupplier = (typeof PREQUALIFICATION_SUPPLIERS)[number];

/** XSD `AvailabilityProduct_V1` / `Availability`. */
export const PREQUALIFICATION_AVAILABILITIES = ['Unknown', 'Red', 'Yellow', 'Green'] as const;
export type PrequalificationAvailability = (typeof PREQUALIFICATION_AVAILABILITIES)[number];

const XS_INT_MIN = -2_147_483_648;
const XS_INT_MAX = 2_147_483_647;
const ORDER_ID_PATTERN = /^OID[0-9]+$/;

/**
 * Fields for `PrequalificationRequest_V2` (elementFormDefault qualified, `xs:all`).
 * Names here are the SDK's; the builder emits the XSD element names.
 * PREP accepts ZipCode `9999ZZ` with HouseNr `1`.
 */
export interface PrequalificationInput {
  /** `ZipCode` (`xs:string`, minLength 1). */
  zipCode: string;
  /** `HouseNr` (`xs:int`). */
  houseNumber: number;
  /** `HouseNrExtension`. */
  houseNumberExtension?: string;
  /** `RoomNumber`. */
  roomNumber?: string;
  /**
   * `HasBroadband` (`xs:boolean`).
   * When true, `ServiceId` or `ReferencePhoneNumber` is required.
   */
  hasBroadband: boolean;
  /** `HasPhone` (`xs:boolean`). */
  hasPhone: boolean;
  /** `OrderId`. Pattern `OID[0-9]+`. */
  orderId?: string;
  /** `PhoneNumber`. */
  phoneNumber?: string;
  /** `ProductTypeCode`. */
  productTypeCode: PrequalificationProductType;
  /** `ReferencePhoneNumber`. Satisfies the HasBroadband rule. */
  referencePhoneNumber?: string;
  /** `ServiceId`. Satisfies the HasBroadband rule. */
  serviceId?: string;
  /** `Suppliers`. Omit or pass an empty list to check every supplier. */
  suppliers?: readonly PrequalificationSupplier[];
  /** `IsraSpecs` (`xs:string` on the request). */
  israSpecs?: string;
  /** `IsComplexAddress` (`xs:boolean`). */
  isComplexAddress?: boolean;
}

export interface PrequalificationProduct {
  productCode?: string;
  name?: string;
  availability: PrequalificationAvailability;
  distributionType?: string;
  /** `xs:boolean`, nillable. `null` is `xsi:nil`. */
  isVectoring?: boolean | null;
  tariffCluster?: string;
}

/**
 * `PrequalificationResponse_V1`.
 * `ErrorClass` and `ErrorMessage` are data on this result. They are not IRMA
 * `Status/Code` values, so a realtime 200 that carries them is not thrown.
 */
export interface PrequalificationResult {
  city?: string;
  extension?: string;
  houseNumber?: string;
  street?: string;
  zipCode?: string;
  israSpecs: string[];
  serviceId?: string;
  ftuType?: string;
  /** Required `xs:int`, nillable. `null` is `xsi:nil`. */
  nlsType: number | null;
  lineType?: string;
  remarks: string[];
  errorClass?: string;
  errorMessage?: string;
  products: PrequalificationProduct[];
  rawXml: string;
  requestId?: string;
  httpStatus: number;
}

function optionalText(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function isProductType(value: string): value is PrequalificationProductType {
  return (PREQUALIFICATION_PRODUCT_TYPES as readonly string[]).includes(value);
}

function isSupplier(value: string): value is PrequalificationSupplier {
  return (PREQUALIFICATION_SUPPLIERS as readonly string[]).includes(value);
}

function isAvailability(value: string): value is PrequalificationAvailability {
  return (PREQUALIFICATION_AVAILABILITIES as readonly string[]).includes(value);
}

function assertXsInt(value: number, label: string, code: string): void {
  if (!Number.isSafeInteger(value) || value < XS_INT_MIN || value > XS_INT_MAX) {
    throw new GrexxValidationError(`${label} must be an xs:int.`, 0, undefined, code);
  }
}

/** Normalize and validate a Prequalification request. Element order is not significant (`xs:all`). */
export function prequalificationFields(input: PrequalificationInput): Record<string, XmlValue> {
  const zipCode = (input.zipCode ?? '').trim();
  if (zipCode.length < 1) {
    throw new GrexxValidationError('ZipCode is required.', 0, undefined, 'invalid_zipcode');
  }
  assertXsInt(input.houseNumber, 'HouseNr', 'invalid_house_number');
  if (typeof input.hasBroadband !== 'boolean') {
    throw new GrexxValidationError('HasBroadband is required and must be a boolean.', 0, undefined, 'invalid_has_broadband');
  }
  if (typeof input.hasPhone !== 'boolean') {
    throw new GrexxValidationError('HasPhone is required and must be a boolean.', 0, undefined, 'invalid_has_phone');
  }

  const serviceId = optionalText(input.serviceId);
  const referencePhoneNumber = optionalText(input.referencePhoneNumber);
  if (input.hasBroadband && !serviceId && !referencePhoneNumber) {
    throw new GrexxValidationError(
      'HasBroadband requires ServiceId or ReferencePhoneNumber.',
      0,
      undefined,
      'broadband_reference_required',
    );
  }

  const orderId = optionalText(input.orderId);
  if (orderId !== undefined && !ORDER_ID_PATTERN.test(orderId)) {
    throw new GrexxValidationError('OrderId must match OID[0-9]+.', 0, undefined, 'invalid_order_id');
  }
  if (!isProductType(input.productTypeCode)) {
    throw new GrexxValidationError(
      `ProductTypeCode must be one of ${PREQUALIFICATION_PRODUCT_TYPES.join(', ')}.`,
      0,
      undefined,
      'invalid_product_type',
    );
  }

  const suppliers = input.suppliers ?? [];
  if (!Array.isArray(suppliers)) {
    throw new GrexxValidationError('Suppliers must be a list of supplier names.', 0, undefined, 'invalid_supplier');
  }
  for (const supplier of suppliers) {
    if (!isSupplier(supplier)) {
      throw new GrexxValidationError(
        `Unknown supplier "${String(supplier)}". Expected one of ${PREQUALIFICATION_SUPPLIERS.join(', ')}.`,
        0,
        undefined,
        'invalid_supplier',
      );
    }
  }
  if (input.isComplexAddress !== undefined && typeof input.isComplexAddress !== 'boolean') {
    throw new GrexxValidationError('IsComplexAddress must be a boolean.', 0, undefined, 'invalid_complex_address');
  }

  const fields: Record<string, XmlValue> = {
    ZipCode: zipCode,
    HouseNr: input.houseNumber,
  };
  const extension = optionalText(input.houseNumberExtension);
  const roomNumber = optionalText(input.roomNumber);
  const phoneNumber = optionalText(input.phoneNumber);
  const israSpecs = optionalText(input.israSpecs);
  if (extension) fields['HouseNrExtension'] = extension;
  if (roomNumber) fields['RoomNumber'] = roomNumber;
  fields['HasBroadband'] = input.hasBroadband;
  fields['HasPhone'] = input.hasPhone;
  if (orderId) fields['OrderId'] = orderId;
  if (phoneNumber) fields['PhoneNumber'] = phoneNumber;
  fields['ProductTypeCode'] = input.productTypeCode;
  if (referencePhoneNumber) fields['ReferencePhoneNumber'] = referencePhoneNumber;
  if (serviceId) fields['ServiceId'] = serviceId;
  if (suppliers.length > 0) fields['Suppliers'] = { string: [...suppliers] };
  if (israSpecs) fields['IsraSpecs'] = israSpecs;
  if (input.isComplexAddress !== undefined) fields['IsComplexAddress'] = input.isComplexAddress;
  return fields;
}

/** Build a `PrequalificationRequest_V2` document (plain XML, no SOAP envelope). */
export function buildPrequalificationRequest(input: PrequalificationInput): string {
  return buildXmlDocument(PREQUALIFICATION_REQUEST_ELEMENT, prequalificationFields(input));
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

function readRequiredNillableInt(record: XmlObject, key: string, fail: (message: string, code: string) => never): number | null {
  if (!Object.prototype.hasOwnProperty.call(record, key)) {
    fail(`${key} is required.`, 'missing_nls_type');
  }
  const value = record[key];
  if (value === null) return null;
  if (typeof value === 'string' && /^[+-]?\d+$/.test(value)) {
    const parsed = Number(value);
    if (Number.isSafeInteger(parsed) && parsed >= XS_INT_MIN && parsed <= XS_INT_MAX) return parsed;
  }
  fail(`${key} must be an xs:int or nil.`, 'invalid_nls_type');
}

function readOptionalNillableBoolean(
  record: XmlObject,
  key: string,
  fail: (message: string, code: string) => never,
): boolean | null | undefined {
  if (!Object.prototype.hasOwnProperty.call(record, key)) return undefined;
  const value = record[key];
  if (value === null) return null;
  if (value === 'true' || value === '1') return true;
  if (value === 'false' || value === '0') return false;
  fail(`${key} must be an xs:boolean or nil.`, 'invalid_is_vectoring');
}

function responseRoot(document: XmlObject, element: string, fail: (message: string, code: string) => never): XmlObject {
  if (!Object.prototype.hasOwnProperty.call(document, element)) {
    const found = Object.keys(document)[0] ?? '(empty)';
    throw fail(`Expected ${element} but received <${found}>`, 'unexpected_response_root');
  }
  const node = document[element];
  const record = asObject(node);
  if (record) return record;
  if (node === null || node === '') return {};
  throw fail(`Expected ${element} but received <${element}>`, 'unexpected_response_root');
}

function parseProduct(node: XmlObject, fail: (message: string, code: string) => never): PrequalificationProduct {
  const availability = text(node, 'Availability');
  if (!availability || !isAvailability(availability)) {
    fail(
      `Availability must be one of ${PREQUALIFICATION_AVAILABILITIES.join(', ')}.`,
      'invalid_availability',
    );
  }
  return {
    productCode: text(node, 'ProductCode'),
    name: text(node, 'Name'),
    availability,
    distributionType: text(node, 'DistributionType'),
    isVectoring: readOptionalNillableBoolean(node, 'IsVectoring', fail),
    tariffCluster: text(node, 'TariffCluster'),
  };
}

/** Map a `PrequalificationResponse_V1` document (or a realtime result) onto a typed result. */
export function parsePrequalificationResponse(source: PrequalificationSource | string): PrequalificationResult {
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
  const root = responseRoot(document, PREQUALIFICATION_RESPONSE_ELEMENT, fail);
  return {
    city: text(root, 'City'),
    extension: text(root, 'Extension'),
    houseNumber: text(root, 'HouseNumber'),
    street: text(root, 'Street'),
    zipCode: text(root, 'ZipCode'),
    israSpecs: stringList(root['IsraSpecs']),
    serviceId: text(root, 'ServiceId'),
    ftuType: text(root, 'FtuType'),
    nlsType: readRequiredNillableInt(root, 'NlsType', fail),
    lineType: text(root, 'LineType'),
    remarks: stringList(root['Remarks']),
    errorClass: text(root, 'ErrorClass'),
    errorMessage: text(root, 'ErrorMessage'),
    products: objects(root['Products'], 'AvailabilityProduct_V1').map((node) => parseProduct(node, fail)),
    rawXml,
    requestId: typeof source === 'string' ? undefined : source.requestId,
    httpStatus: typeof source === 'string' ? 0 : source.httpStatus,
  };
}
