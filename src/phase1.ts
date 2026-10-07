/**
 * Phase 1 IRMA requests and responses, taken from `schemas/grexx/*.xsd`.
 *
 * Pairings that the portal XSD names do not make obvious:
 * - `ZipCodeCheckRequest_V6` → `ZipCodeCheckResponse_V5`
 * - `PrequalificationRequest_V2` → `PrequalificationResponse_V1`
 * - `GetSimRequest_V1` is the only SIM read. There is no `GetSimCardRequest`.
 * - `OrderSummary` and `GetMobileSubscriptionOrders` have request XSDs only.
 *   Their responses stay generic XML.
 *
 * CarrierInfo pattern facets in the portal export are double-escaped (`\\d`).
 * Validation below uses the intended XSD regex (`\d`).
 */
import { describeGrexxCode } from './codes.js';
import { parseGrexxResponse, parseTypedResponse, type GrexxOrderStatus, type GrexxParsedResponse } from './response.js';
import { buildRequestXml, type XmlObject, type XmlValue } from './xml.js';

/** Exact IRMA request root element names. */
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
  GetMobileSettingsRequest: 'GetMobileSettingsRequest_V1',
  GetMobileSubscriptionUsageRequest: 'GetMobileSubscriptionUsageRequest_V1',
  GetMobileSubscriptionOrdersRequest: 'GetMobileSubscriptionOrdersRequest_V1',
  AvailablePortingsRequest: 'AvailablePortingsRequest_V1',
} as const;

/** Response roots that have a portal XSD. ZipCodeCheck is V5, not V6. */
export const PHASE1_RESPONSE_ROOTS = {
  ZipCodeCheckResponse: 'ZipCodeCheckResponse_V5',
  PrequalificationResponse: 'PrequalificationResponse_V1',
  CarrierInfoResponse: 'CarrierInfoResponse_V1',
  RadiusCheckResponse: 'RadiusCheckResponse_V1',
  RasCheckResponse: 'RasCheckResponse_V1',
  StartLineDiagnoseResponse: 'StartLineDiagnoseResponse_V1',
  CustomerDataResponse: 'CustomerDataResponse_V1',
  OrderDataResponse: 'OrderDataResponse_V1',
  GetSimResponse: 'GetSimResponse_V1',
  GetMobileSettingsResponse: 'GetMobileSettingsResponse_V1',
  GetMobileSubscriptionUsageResponse: 'GetMobileSubscriptionUsageResponse_V1',
  AvailablePortingsResponse: 'AvailablePortingsResponse_V1',
} as const;

export const ZIP_CODE_PORTFOLIOS = ['Business', 'SMB', 'Teleworker', 'All'] as const;
export type ZipCodePortfolio = (typeof ZIP_CODE_PORTFOLIOS)[number];

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

export const CARRIER_PRODUCT_TYPES = ['xDSL', 'FttH', 'WeasFiber', 'All'] as const;
export type CarrierProductType = (typeof CARRIER_PRODUCT_TYPES)[number];

export const SYMPTOM_CODES = ['Sym103', 'Sym104', 'Sym105', 'Sym111'] as const;
export type SymptomCode = (typeof SYMPTOM_CODES)[number];

export const CUSTOMER_ORDER_BY = [
  'Id',
  'Name',
  'Street',
  'ZipCode',
  'City',
  'Phone1',
  'Phone2',
  'DateCreated',
  'IsActive',
  'ExternalId',
  'DebitNr',
  'FirstBillingDate',
] as const;
export type CustomerDataOrderBy = (typeof CUSTOMER_ORDER_BY)[number];

export const ORDER_STATES = [
  'Activate',
  'Activating',
  'Active',
  'Update',
  'Updating',
  'Terminate',
  'Terminating',
  'Terminated',
  'Cancelled',
  'Rejected',
  'ActionRequired',
  'PendingParent',
  'WaitForInvoicing',
  'Invoicing',
  'InvoicingCompleted',
  'UpdateActionRequired',
  'Completed',
] as const;
export type OrderState = (typeof ORDER_STATES)[number];

export const PRODUCT_GROUPS = [
  'Connectivity',
  'Security',
  'Storage',
  'Internet',
  'Voip',
  'Additional',
  'Mobile',
  'Cloud',
  'Services247',
] as const;
export type ProductGroup = (typeof PRODUCT_GROUPS)[number];

export const NLS_TYPES = [
  'Nls1',
  'Nls2',
  'Nls3',
  'Nls4',
  'Nls6',
  'Nls7',
  'Nls8',
  'Nls9',
  'Nls11',
  'Nls21',
  'Nls23',
  'Nls24',
  'NlsIO',
  'NlsNO',
  'NlsHbob',
  'NlsHbor',
] as const;
export type NlsType = (typeof NLS_TYPES)[number];

export const SIM_TYPES = ['Physical', 'ESim'] as const;
export type SimType = (typeof SIM_TYPES)[number];

export const PORTING_CONTRACT_TYPES = ['FirstPossibleDate', 'Continuation', 'EarlyTermination'] as const;
export type PortingContractType = (typeof PORTING_CONTRACT_TYPES)[number];

export const USAGE_UNITS = ['Euro', 'MB', 'Minutes', 'Events'] as const;
export type UsageUnit = (typeof USAGE_UNITS)[number];

export const AVAILABILITY_STATUSES = ['Unknown', 'Red', 'Yellow', 'Green'] as const;
export type AvailabilityStatus = (typeof AVAILABILITY_STATUSES)[number];

export interface IrmaCallResult<T> {
  rootElement: string;
  /** Grexx gateway code when the body carries 0, 68, or 100–109. IRMA `Status/Code` strings are not copied here. */
  grexxCode?: number;
  grexxCodeMessage?: string;
  message?: string;
  orderStatus?: GrexxOrderStatus;
  /** Set when the root is the IRMA response. Omitted for a gateway error envelope. */
  data?: T;
  rawXml: string;
}

export interface ZipCodeCheckRequest {
  Portfolio: ZipCodePortfolio;
  ZipCode: string;
  HouseNr: number;
  HouseNrExtension?: string;
  ServiceId?: string;
  RoomNumber?: string;
  IsRoomNumberKnown: boolean;
  /** Wrapped as `Suppliers/string`. Empty or omitted checks every supplier. */
  Suppliers?: string[];
}

export interface PrequalificationRequest {
  ZipCode: string;
  HouseNr: number;
  HouseNrExtension?: string;
  RoomNumber?: string;
  /** When true, `ServiceId` or `ReferencePhoneNumber` is required. */
  HasBroadband: boolean;
  HasPhone: boolean;
  /** Pattern `OID` plus digits. */
  OrderId?: string;
  PhoneNumber?: string;
  ProductTypeCode: PrequalificationProductType;
  ReferencePhoneNumber?: string;
  ServiceId?: string;
  Suppliers?: string[];
  IsraSpecs?: string;
  IsComplexAddress?: boolean;
}

export interface CarrierInfoRequest {
  ProductType: CarrierProductType;
  /** `\d{4}\s*[A-Za-z]{2}\s*` */
  ZipCode: string;
  /** Integer 1–99999. Element name is `HouseNumber`, not `HouseNr`. */
  HouseNumber: number;
  HouseNumberExt?: string;
  /** `0` plus 9 digits. xDSL only. */
  PhoneNumber?: string;
  /** Three digits. xDSL only. */
  IsraSpecification?: string;
  ServiceId?: string;
}

export interface RadiusCheckRequest {
  OrderId: number;
}

export interface RasCheckRequest {
  OrderId: number;
}

export interface DiagnoseHeader {
  PartnerReference?: string;
  DateCreated: string | Date;
}

export interface StartLineDiagnoseRequest {
  Header?: DiagnoseHeader;
  OrderId: number;
  SymptomCode: SymptomCode;
}

export interface CustomerDataRequest {
  Id?: number;
  Name?: string;
  Street?: string;
  ZipCode?: string;
  City?: string;
  CountryCode?: string;
  Phone1?: string;
  Phone2?: string;
  DebitNr?: string;
  ExternalId?: string;
  ChamberOfCommerceNr?: string;
  VATNr?: string;
  IncludeInactiveCustomers?: boolean;
  OrderByMember?: CustomerDataOrderBy;
  OrderByDescending?: boolean;
  Skip?: number;
  /** Max 100. Default on the service is 20. */
  Take?: number;
}

export interface OrderSummaryRequest {
  CustomerId?: number;
  OrderState?: OrderState;
  ProductGroup?: ProductGroup;
  ProductName?: string;
  DateActiveFrom?: string | Date;
  DateActiveTo?: string | Date;
  DateModifiedFrom?: string | Date;
  DateModifiedTo?: string | Date;
  Label?: string;
  Attribute?: string;
  Skip?: number;
  /** Max 2500. */
  Take?: number;
}

export interface OrderDataRequest {
  OrderId: number;
}

export interface GetSimRequest {
  /** IRMA order id of the mobile order. */
  OrderId: number;
}

export interface GetMobileSettingsRequest {
  OrderId: number;
}

export interface GetMobileSubscriptionUsageRequest {
  OrderId: number;
}

export interface GetMobileSubscriptionOrdersRequest {
  /** 1–50 IRMA order ids. Serialized as `OrderIds/OrderId`. */
  OrderIds: number[];
}

export interface AvailablePortingsRequest {
  /**
   * IRMA customer id. The XSD element is spelled `MobileSubscripionCustomerId`
   * (missing "t").
   */
  MobileSubscripionCustomerId?: number;
  HipGroupOrderId?: number;
}

export interface StatusV1 {
  Code: string;
  Messages?: string[];
}

export interface AvailableSpeedV4 {
  Availability?: string;
  Description?: string;
  NlsType?: string;
  Remarks?: string[];
  Technology?: string;
  TariffCluster?: string;
  PlanDate?: string;
}

export interface CopperOffV1 {
  EndOfSaleDate?: string;
  EndOfLifeDate?: string;
}

export interface ActionRequiredV1 {
  ActionText?: string;
  ActionUri?: string;
}

export interface AvailableSupplierV5 {
  Name?: string;
  ErrorMessage?: string;
  LocationInfo?: string;
  AvailableSpeeds?: AvailableSpeedV4[];
  CopperOff?: CopperOffV1;
  ActionRequired?: ActionRequiredV1;
}

export interface ZipCodeCheckResponse {
  Status?: StatusV1;
  AvailableSuppliers?: AvailableSupplierV5[];
}

export interface AvailabilityProductV1 {
  ProductCode?: string;
  Name?: string;
  Availability?: string;
  DistributionType?: string;
  IsVectoring?: boolean;
  TariffCluster?: string;
}

export interface PrequalificationResponse {
  City?: string;
  Extension?: string;
  HouseNumber?: string;
  Street?: string;
  ZipCode?: string;
  IsraSpecs?: string[];
  ServiceId?: string;
  FtuType?: string;
  NlsType?: number;
  LineType?: string;
  Remarks?: string[];
  ErrorClass?: string;
  ErrorMessage?: string;
  Products?: AvailabilityProductV1[];
}

export interface AddressOrderStatusV1 {
  HouseNumber?: string;
  HouseNumberExt?: string;
  ZipCode?: string;
  OrderStatus?: string;
}

export interface PossibleAddressesV1 {
  DistributionPoint?: string;
  Addresses?: AddressOrderStatusV1[];
}

export interface XdslConnectionV1 {
  CurrentTypeOfConnection?: string;
  CurrentServiceId?: string;
  CurrentPhoneNumber?: string;
  FutureTypeOfConnection?: string;
  FutureServiceId?: string;
  FuturePhoneNumber?: string;
}

export interface XdslConnectionPointV1 {
  IsraName?: string;
  IsNls3?: boolean;
  NumberOfNls1LinesAvailable?: string;
  NumberOfNls2LinesAvailable?: string;
  XdslConnections?: XdslConnectionV1[];
  Remarks?: string;
}

export interface FtthConnectionV1 {
  CurrentTypeOfConnection?: string;
  CurrentConnectionId?: string;
  FutureTypeOfConnection?: string;
  FutureConnectionId?: string;
}

export interface FtthConnectionPointV1 {
  FiberTerminationPointId?: string;
  FtuType?: string;
  FtthConnections?: FtthConnectionV1[];
  FtthNlsType?: string;
  PlanDate?: string;
}

export interface FiberConnectionV1 {
  AccessId?: string;
  IsWsoWsoMigrationPossible?: boolean;
}

export interface CarrierInfoResponse {
  ProductType?: string;
  ErrorMessage?: string;
  ZipCode?: string;
  HouseNumber?: string;
  HouseNumberExt?: string;
  Street?: string;
  City?: string;
  MainPhoneNumber?: string;
  CurrentTeleponeType?: string;
  PhoneHasDifferentAddress?: boolean;
  DistributionPoint?: string;
  FtthNlsType?: string;
  AdditionalXdfAccessServiceId?: string;
  PossibleAddresses?: PossibleAddressesV1[];
  XdslConnectionPoints?: XdslConnectionPointV1[];
  FtthConnectionPoints?: FtthConnectionPointV1[];
  Comments?: string[];
  WeasFiberConnections?: FiberConnectionV1[];
}

export interface RadiusCheckResponseItemV1 {
  Status?: string;
  Nas?: string;
  /** RADIUS password from the login attempt. Do not log it. */
  Password?: string;
  User?: string;
  Action?: string;
  DateCreated?: string;
}

export interface RadiusCheckResponse {
  ErrorMessage?: string;
  ResponseItems?: RadiusCheckResponseItemV1[];
}

export interface RasCheckResponseItemV1 {
  VrfId?: number;
  QosEnabled?: boolean;
  HasSession?: boolean;
  PingSuccessPercent?: number;
  IpAddress?: string;
  Error?: string;
  PolicyDetails?: string;
}

export interface RasCheckResponse {
  ErrorMessage?: string;
  ResponseItems?: RasCheckResponseItemV1[];
}

export interface StartLineDiagnoseResultV1 {
  AnalysisId?: string;
}

export interface StartLineDiagnoseResponse {
  Status?: StatusV1;
  OrderId?: number;
  ErrorMessage?: string;
  StartLineDiagnoseResult?: StartLineDiagnoseResultV1;
}

export interface CustomerDataV4 {
  Id?: number;
  Name?: string;
  Street?: string;
  HouseNr?: number;
  HouseNrExtension?: string;
  ZipCode?: string;
  City?: string;
  CountryCode?: string;
  Phone1?: string;
  Phone2?: string;
  DateCreated?: string;
  IsActive?: boolean;
  Fax?: string;
  Email?: string;
  Website?: string;
  DebitNr?: string;
  LegalStatus?: string;
  ExternalId?: string;
  ChamberOfCommerceNr?: string;
  IBAN?: string;
  BIC?: string;
  VATNr?: string;
  FirstBillingDate?: string;
  KrnId?: string;
}

export interface CustomerDataResponse {
  PagedResult?: {
    Skip?: number;
    Take?: number;
    TotalNumberOfRecords?: number;
    Results?: CustomerDataV4[];
  };
  ErrorMessage?: string;
}

export interface OrderDataV1 {
  CustomerId?: number;
  ProductCode?: string;
  Quantity?: number;
}

export interface OrderDataResponse {
  Status?: StatusV1;
  Order?: OrderDataV1;
}

export interface SimCardV4 {
  /** Deprecated on the wire; PUK lives on `Sim_V1.Puc1`. */
  Puc1?: string;
}

export interface ESimV1 {
  SmdpAddress?: string;
  /** eSIM download code. Do not log it. */
  ActivationCode?: string;
  /** eSIM confirmation code. Do not log it. */
  ConfirmationCode?: string;
}

export interface SimV1 {
  SimType?: string;
  ICCId?: string;
  /** PUK code. Do not log it. */
  Puc1?: string;
  SimCard?: SimCardV4;
  ESim?: ESimV1;
}

export interface GetSimResponse {
  Status?: StatusV1;
  Sim?: SimV1;
}

export interface SettingStatusV1 {
  Value?: boolean;
  IsPending?: boolean;
  Remark?: string;
}

export interface MobileSettingsV1 {
  BlockSim?: SettingStatusV1;
  BlockOutgoingCalls?: SettingStatusV1;
  BlockCallsToInternationalNumbers?: SettingStatusV1;
  BlockOutgoingCallsExceptDomestic?: SettingStatusV1;
  BlockRoaming?: SettingStatusV1;
  BlockIncomingCallsWhenRoaming?: SettingStatusV1;
  BlockDataRoaming?: SettingStatusV1;
  BlockInformationNumbers?: SettingStatusV1;
  BlockServiceNumbers?: SettingStatusV1;
  BlockCallerId?: SettingStatusV1;
  BlockCallWaiting?: SettingStatusV1;
  BlockPremiumSms?: SettingStatusV1;
  BlockCsDataFax?: SettingStatusV1;
  BlockVoLte?: SettingStatusV1;
  DataRoamingLimitEnabled?: SettingStatusV1;
  InternationalCallForwardingEnabled?: SettingStatusV1;
  CurrentMonthDataRoamingLimitLifted?: SettingStatusV1;
  BlockOutgoingSms?: SettingStatusV1;
  BlockIncomingSms?: SettingStatusV1;
  BlockIncomingCall?: SettingStatusV1;
  BlockOutgoingCallWhenRoaming?: SettingStatusV1;
  BlockIncomingSmsWhenRoaming?: SettingStatusV1;
  BlockOutgoingSmsWhenRoaming?: SettingStatusV1;
  BlockConferenceCall?: SettingStatusV1;
  BlockVoicemail?: SettingStatusV1;
  SatelliteNetworksEnabled?: SettingStatusV1;
}

export interface GetMobileSettingsResponse {
  Settings?: MobileSettingsV1;
  ErrorMessage?: string;
}

export interface MobileSubscriptionUsageV1 {
  CustomerId?: number;
  PhoneNumber?: string;
  DataBundleValue?: number;
  DataCurrentValue?: number;
  UomData?: string;
  VoiceBundleValue?: number;
  VoiceCurrentValue?: number;
  UomVoice?: string;
  SmsBundleValue?: number;
  SmsCurrentValue?: number;
  UomSms?: string;
  Amount?: number;
  UomAmount?: string;
}

export interface GetMobileSubscriptionUsageResponse {
  Status?: StatusV1;
  OrderId?: number;
  MobileSubscriptionUsage?: MobileSubscriptionUsageV1;
}

export interface AvailablePortingNumberV1 {
  OrderId?: number;
  PhoneNumber?: string;
  LastPhoneNumber?: string;
}

export interface AvailablePortingV1 {
  PortingId?: string;
  FirstPossiblePortingDate?: string;
  PlannedPortingDate?: string;
  Numbers?: AvailablePortingNumberV1[];
  PortingContractType?: string;
}

export interface AvailablePortingsResponse {
  Status?: StatusV1;
  AvailablePortings?: AvailablePortingV1[];
}

function fail(name: string, detail: string): never {
  throw new Error(`${name} ${detail}`);
}

function requireText(value: string, name: string): string {
  if (typeof value !== 'string' || value.trim() === '') fail(name, 'is required.');
  return value;
}

function optionalText(value: string | undefined): string | undefined {
  if (value === undefined || value.trim() === '') return undefined;
  return value;
}

function requireInt(value: number, name: string, min?: number, max?: number): number {
  if (!Number.isInteger(value)) fail(name, 'must be an integer.');
  if (min !== undefined && value < min) fail(name, `must be >= ${min}.`);
  if (max !== undefined && value > max) fail(name, `must be <= ${max}.`);
  return value;
}

function optionalInt(value: number | undefined, name: string, min?: number, max?: number): number | undefined {
  if (value === undefined) return undefined;
  return requireInt(value, name, min, max);
}

function requireBool(value: boolean, name: string): boolean {
  if (typeof value !== 'boolean') fail(name, 'must be a boolean.');
  return value;
}

function requireOneOf<T extends string>(value: string, name: string, allowed: readonly T[]): T {
  if (!allowed.includes(value as T)) fail(name, `must be one of ${allowed.join(', ')}.`);
  return value as T;
}

function requirePattern(value: string, name: string, pattern: RegExp): string {
  if (!pattern.test(value)) fail(name, `must match ${pattern}.`);
  return value;
}

function dateTime(value: string | Date | undefined, name: string): string | undefined {
  if (value === undefined) return undefined;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) fail(name, 'is not a valid date.');
    return value.toISOString();
  }
  if (value.trim() === '') return undefined;
  return value;
}

function stringList(values: readonly string[] | undefined): XmlObject | undefined {
  if (!values || values.length === 0) return undefined;
  return { string: values.map((value) => requireText(value, 'string')) };
}

function fields(entries: Array<[string, XmlValue | undefined]>): XmlObject {
  const out: XmlObject = {};
  for (const [key, value] of entries) {
    if (value === undefined || value === null) continue;
    out[key] = value;
  }
  return out;
}

export function buildZipCodeCheckRequest(request: ZipCodeCheckRequest): string {
  return buildRequestXml(
    PHASE1_ROOTS.ZipCodeCheckRequest,
    fields([
      ['Portfolio', requireOneOf(request.Portfolio, 'Portfolio', ZIP_CODE_PORTFOLIOS)],
      ['ZipCode', requireText(request.ZipCode, 'ZipCode')],
      ['HouseNr', requireInt(request.HouseNr, 'HouseNr', 1)],
      ['HouseNrExtension', optionalText(request.HouseNrExtension)],
      ['ServiceId', optionalText(request.ServiceId)],
      ['RoomNumber', optionalText(request.RoomNumber)],
      ['IsRoomNumberKnown', requireBool(request.IsRoomNumberKnown, 'IsRoomNumberKnown')],
      ['Suppliers', stringList(request.Suppliers)],
    ])
  );
}

export function buildPrequalificationRequest(request: PrequalificationRequest): string {
  const hasBroadband = requireBool(request.HasBroadband, 'HasBroadband');
  const serviceId = optionalText(request.ServiceId);
  const referencePhone = optionalText(request.ReferencePhoneNumber);
  if (hasBroadband && serviceId === undefined && referencePhone === undefined) {
    fail('PrequalificationRequest', 'requires ServiceId or ReferencePhoneNumber when HasBroadband is true.');
  }
  const orderId = optionalText(request.OrderId);
  if (orderId !== undefined) requirePattern(orderId, 'OrderId', /^OID[0-9]+$/);
  return buildRequestXml(
    PHASE1_ROOTS.PrequalificationRequest,
    fields([
      ['ZipCode', requireText(request.ZipCode, 'ZipCode')],
      ['HouseNr', requireInt(request.HouseNr, 'HouseNr', 1)],
      ['HouseNrExtension', optionalText(request.HouseNrExtension)],
      ['RoomNumber', optionalText(request.RoomNumber)],
      ['HasBroadband', hasBroadband],
      ['HasPhone', requireBool(request.HasPhone, 'HasPhone')],
      ['OrderId', orderId],
      ['PhoneNumber', optionalText(request.PhoneNumber)],
      ['ProductTypeCode', requireOneOf(request.ProductTypeCode, 'ProductTypeCode', PREQUALIFICATION_PRODUCT_TYPES)],
      ['ReferencePhoneNumber', referencePhone],
      ['ServiceId', serviceId],
      ['Suppliers', stringList(request.Suppliers)],
      ['IsraSpecs', optionalText(request.IsraSpecs)],
      ['IsComplexAddress', request.IsComplexAddress],
    ])
  );
}

export function buildCarrierInfoRequest(request: CarrierInfoRequest): string {
  const extension = optionalText(request.HouseNumberExt);
  if (extension !== undefined) requirePattern(extension, 'HouseNumberExt', /^.{0,4}\s*$/);
  const phone = optionalText(request.PhoneNumber);
  if (phone !== undefined) requirePattern(phone, 'PhoneNumber', /^0\d{9}\s*$/);
  const isra = optionalText(request.IsraSpecification);
  if (isra !== undefined) requirePattern(isra, 'IsraSpecification', /^\d{3}\s*$/);
  return buildRequestXml(
    PHASE1_ROOTS.CarrierInfoRequest,
    fields([
      ['ProductType', requireOneOf(request.ProductType, 'ProductType', CARRIER_PRODUCT_TYPES)],
      ['ZipCode', requirePattern(requireText(request.ZipCode, 'ZipCode'), 'ZipCode', /^\d{4}\s*[a-zA-Z]{2}\s*$/)],
      ['HouseNumber', requireInt(request.HouseNumber, 'HouseNumber', 1, 99999)],
      ['HouseNumberExt', extension],
      ['PhoneNumber', phone],
      ['IsraSpecification', isra],
      ['ServiceId', optionalText(request.ServiceId)],
    ])
  );
}

export function buildRadiusCheckRequest(request: RadiusCheckRequest): string {
  return buildRequestXml(PHASE1_ROOTS.RadiusCheckRequest, fields([['OrderId', requireInt(request.OrderId, 'OrderId', 1)]]));
}

export function buildRasCheckRequest(request: RasCheckRequest): string {
  return buildRequestXml(PHASE1_ROOTS.RasCheckRequest, fields([['OrderId', requireInt(request.OrderId, 'OrderId', 1)]]));
}

export function buildStartLineDiagnoseRequest(request: StartLineDiagnoseRequest): string {
  let header: XmlObject | undefined;
  if (request.Header) {
    const created = dateTime(request.Header.DateCreated, 'Header.DateCreated');
    if (created === undefined) fail('Header.DateCreated', 'is required.');
    header = fields([
      ['PartnerReference', optionalText(request.Header.PartnerReference)],
      ['DateCreated', created],
    ]);
  }
  return buildRequestXml(
    PHASE1_ROOTS.StartLineDiagnoseRequest,
    fields([
      ['Header', header],
      ['OrderId', requireInt(request.OrderId, 'OrderId', 1)],
      ['SymptomCode', requireOneOf(request.SymptomCode, 'SymptomCode', SYMPTOM_CODES)],
    ])
  );
}

export function buildCustomerDataRequest(request: CustomerDataRequest = {}): string {
  return buildRequestXml(
    PHASE1_ROOTS.CustomerDataRequest,
    fields([
      ['Id', optionalInt(request.Id, 'Id', 1)],
      ['Name', optionalText(request.Name)],
      ['Street', optionalText(request.Street)],
      ['ZipCode', optionalText(request.ZipCode)],
      ['City', optionalText(request.City)],
      ['CountryCode', optionalText(request.CountryCode)],
      ['Phone1', optionalText(request.Phone1)],
      ['Phone2', optionalText(request.Phone2)],
      ['DebitNr', optionalText(request.DebitNr)],
      ['ExternalId', optionalText(request.ExternalId)],
      ['ChamberOfCommerceNr', optionalText(request.ChamberOfCommerceNr)],
      ['VATNr', optionalText(request.VATNr)],
      ['IncludeInactiveCustomers', request.IncludeInactiveCustomers],
      ['OrderByMember', request.OrderByMember === undefined ? undefined : requireOneOf(request.OrderByMember, 'OrderByMember', CUSTOMER_ORDER_BY)],
      ['OrderByDescending', request.OrderByDescending],
      ['Skip', optionalInt(request.Skip, 'Skip', 0)],
      ['Take', optionalInt(request.Take, 'Take', 1, 100)],
    ])
  );
}

export function buildOrderSummaryRequest(request: OrderSummaryRequest = {}): string {
  return buildRequestXml(
    PHASE1_ROOTS.OrderSummaryRequest,
    fields([
      ['CustomerId', optionalInt(request.CustomerId, 'CustomerId', 1)],
      ['OrderState', request.OrderState === undefined ? undefined : requireOneOf(request.OrderState, 'OrderState', ORDER_STATES)],
      ['ProductGroup', request.ProductGroup === undefined ? undefined : requireOneOf(request.ProductGroup, 'ProductGroup', PRODUCT_GROUPS)],
      ['ProductName', optionalText(request.ProductName)],
      ['DateActiveFrom', dateTime(request.DateActiveFrom, 'DateActiveFrom')],
      ['DateActiveTo', dateTime(request.DateActiveTo, 'DateActiveTo')],
      ['DateModifiedFrom', dateTime(request.DateModifiedFrom, 'DateModifiedFrom')],
      ['DateModifiedTo', dateTime(request.DateModifiedTo, 'DateModifiedTo')],
      ['Label', optionalText(request.Label)],
      ['Attribute', optionalText(request.Attribute)],
      ['Skip', optionalInt(request.Skip, 'Skip', 0)],
      ['Take', optionalInt(request.Take, 'Take', 1, 2500)],
    ])
  );
}

export function buildOrderDataRequest(request: OrderDataRequest): string {
  return buildRequestXml(PHASE1_ROOTS.OrderDataRequest, fields([['OrderId', requireInt(request.OrderId, 'OrderId', 1)]]));
}

export function buildGetSimRequest(request: GetSimRequest): string {
  return buildRequestXml(PHASE1_ROOTS.GetSimRequest, fields([['OrderId', requireInt(request.OrderId, 'OrderId', 1)]]));
}

export function buildGetMobileSettingsRequest(request: GetMobileSettingsRequest): string {
  return buildRequestXml(
    PHASE1_ROOTS.GetMobileSettingsRequest,
    fields([['OrderId', requireInt(request.OrderId, 'OrderId', 1)]])
  );
}

export function buildGetMobileSubscriptionUsageRequest(request: GetMobileSubscriptionUsageRequest): string {
  return buildRequestXml(
    PHASE1_ROOTS.GetMobileSubscriptionUsageRequest,
    fields([['OrderId', requireInt(request.OrderId, 'OrderId', 1)]])
  );
}

export function buildGetMobileSubscriptionOrdersRequest(request: GetMobileSubscriptionOrdersRequest): string {
  if (!Array.isArray(request.OrderIds) || request.OrderIds.length < 1 || request.OrderIds.length > 50) {
    fail('OrderIds', 'must contain 1 to 50 order ids.');
  }
  return buildRequestXml(
    PHASE1_ROOTS.GetMobileSubscriptionOrdersRequest,
    fields([['OrderIds', { OrderId: request.OrderIds.map((id) => requireInt(id, 'OrderId', 1)) }]])
  );
}

export function buildAvailablePortingsRequest(request: AvailablePortingsRequest): string {
  const customerId = optionalInt(request.MobileSubscripionCustomerId, 'MobileSubscripionCustomerId', 1);
  const hip = optionalInt(request.HipGroupOrderId, 'HipGroupOrderId', 1);
  if (customerId === undefined && hip === undefined) {
    fail('AvailablePortingsRequest', 'requires MobileSubscripionCustomerId or HipGroupOrderId.');
  }
  return buildRequestXml(
    PHASE1_ROOTS.AvailablePortingsRequest,
    fields([
      ['MobileSubscripionCustomerId', customerId],
      ['HipGroupOrderId', hip],
    ])
  );
}

function isObj(value: XmlValue | null | undefined): value is XmlObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function textOf(value: XmlValue | null | undefined): string | undefined {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return undefined;
}

function intOf(value: XmlValue | null | undefined): number | undefined {
  const text = textOf(value);
  if (text === undefined || !/^-?\d+$/.test(text)) return undefined;
  return Number(text);
}

function numberOf(value: XmlValue | null | undefined): number | undefined {
  const text = textOf(value);
  if (text === undefined || !/^-?(?:\d+\.?\d*|\.\d+)$/.test(text)) return undefined;
  return Number(text);
}

function boolOf(value: XmlValue | null | undefined): boolean | undefined {
  const text = textOf(value)?.toLowerCase();
  if (text === 'true' || text === '1') return true;
  if (text === 'false' || text === '0') return false;
  return undefined;
}

function listOf(value: XmlValue | null | undefined): XmlValue[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function stringsOf(value: XmlValue | null | undefined): string[] | undefined {
  if (!isObj(value) || value['string'] === undefined) return undefined;
  return listOf(value['string']).flatMap((item) => {
    const text = textOf(item);
    return text === undefined ? [] : [text];
  });
}

function itemsOf(value: XmlValue | null | undefined, itemName: string): XmlObject[] | undefined {
  if (!isObj(value) || value[itemName] === undefined) return undefined;
  return listOf(value[itemName]).flatMap((item) => (isObj(item) ? [item] : []));
}

function projectStatus(value: XmlValue | null | undefined): StatusV1 | undefined {
  if (!isObj(value)) return undefined;
  const code = textOf(value['Code']);
  if (code === undefined) return undefined;
  const messages = stringsOf(value['Messages']);
  return messages === undefined ? { Code: code } : { Code: code, Messages: messages };
}

function projectSpeed(item: XmlObject): AvailableSpeedV4 {
  return {
    Availability: textOf(item['Availability']),
    Description: textOf(item['Description']),
    NlsType: textOf(item['NlsType']),
    Remarks: stringsOf(item['Remarks']),
    Technology: textOf(item['Technology']),
    TariffCluster: textOf(item['TariffCluster']),
    PlanDate: textOf(item['PlanDate']),
  };
}

function projectZipCodeCheck(body: XmlObject): ZipCodeCheckResponse {
  return {
    Status: projectStatus(body['Status']),
    AvailableSuppliers: itemsOf(body['AvailableSuppliers'], 'AvailableSupplier_V5')?.map((item) => ({
      Name: textOf(item['Name']),
      ErrorMessage: textOf(item['ErrorMessage']),
      LocationInfo: textOf(item['LocationInfo']),
      AvailableSpeeds: itemsOf(item['AvailableSpeeds'], 'AvailableSpeed_V4')?.map(projectSpeed),
      CopperOff: isObj(item['CopperOff'])
        ? {
            EndOfSaleDate: textOf(item['CopperOff']['EndOfSaleDate']),
            EndOfLifeDate: textOf(item['CopperOff']['EndOfLifeDate']),
          }
        : undefined,
      ActionRequired: isObj(item['ActionRequired'])
        ? {
            ActionText: textOf(item['ActionRequired']['ActionText']),
            ActionUri: textOf(item['ActionRequired']['ActionUri']),
          }
        : undefined,
    })),
  };
}

function projectPrequalification(body: XmlObject): PrequalificationResponse {
  return {
    City: textOf(body['City']),
    Extension: textOf(body['Extension']),
    HouseNumber: textOf(body['HouseNumber']),
    Street: textOf(body['Street']),
    ZipCode: textOf(body['ZipCode']),
    IsraSpecs: stringsOf(body['IsraSpecs']),
    ServiceId: textOf(body['ServiceId']),
    FtuType: textOf(body['FtuType']),
    NlsType: intOf(body['NlsType']),
    LineType: textOf(body['LineType']),
    Remarks: stringsOf(body['Remarks']),
    ErrorClass: textOf(body['ErrorClass']),
    ErrorMessage: textOf(body['ErrorMessage']),
    Products: itemsOf(body['Products'], 'AvailabilityProduct_V1')?.map((item) => ({
      ProductCode: textOf(item['ProductCode']),
      Name: textOf(item['Name']),
      Availability: textOf(item['Availability']),
      DistributionType: textOf(item['DistributionType']),
      IsVectoring: boolOf(item['IsVectoring']),
      TariffCluster: textOf(item['TariffCluster']),
    })),
  };
}

function projectCarrierInfo(body: XmlObject): CarrierInfoResponse {
  return {
    ProductType: textOf(body['ProductType']),
    ErrorMessage: textOf(body['ErrorMessage']),
    ZipCode: textOf(body['ZipCode']),
    HouseNumber: textOf(body['HouseNumber']),
    HouseNumberExt: textOf(body['HouseNumberExt']),
    Street: textOf(body['Street']),
    City: textOf(body['City']),
    MainPhoneNumber: textOf(body['MainPhoneNumber']),
    CurrentTeleponeType: textOf(body['CurrentTeleponeType']),
    PhoneHasDifferentAddress: boolOf(body['PhoneHasDifferentAddress']),
    DistributionPoint: textOf(body['DistributionPoint']),
    FtthNlsType: textOf(body['FtthNlsType']),
    AdditionalXdfAccessServiceId: textOf(body['AdditionalXdfAccessServiceId']),
    PossibleAddresses: itemsOf(body['PossibleAddresses'], 'PossibleAddresses_V1')?.map((item) => ({
      DistributionPoint: textOf(item['DistributionPoint']),
      Addresses: itemsOf(item['Addresses'], 'AddressOrderStatus_V1')?.map((address) => ({
        HouseNumber: textOf(address['HouseNumber']),
        HouseNumberExt: textOf(address['HouseNumberExt']),
        ZipCode: textOf(address['ZipCode']),
        OrderStatus: textOf(address['OrderStatus']),
      })),
    })),
    XdslConnectionPoints: itemsOf(body['XdslConnectionPoints'], 'XdslConnectionPoint_V1')?.map((item) => ({
      IsraName: textOf(item['IsraName']),
      IsNls3: boolOf(item['IsNls3']),
      NumberOfNls1LinesAvailable: textOf(item['NumberOfNls1LinesAvailable']),
      NumberOfNls2LinesAvailable: textOf(item['NumberOfNls2LinesAvailable']),
      XdslConnections: itemsOf(item['XdslConnections'], 'XdslConnection_V1')?.map((connection) => ({
        CurrentTypeOfConnection: textOf(connection['CurrentTypeOfConnection']),
        CurrentServiceId: textOf(connection['CurrentServiceId']),
        CurrentPhoneNumber: textOf(connection['CurrentPhoneNumber']),
        FutureTypeOfConnection: textOf(connection['FutureTypeOfConnection']),
        FutureServiceId: textOf(connection['FutureServiceId']),
        FuturePhoneNumber: textOf(connection['FuturePhoneNumber']),
      })),
      Remarks: textOf(item['Remarks']),
    })),
    FtthConnectionPoints: itemsOf(body['FtthConnectionPoints'], 'FtthConnectionPoint_V1')?.map((item) => ({
      FiberTerminationPointId: textOf(item['FiberTerminationPointId']),
      FtuType: textOf(item['FtuType']),
      FtthConnections: itemsOf(item['FtthConnections'], 'FtthConnection_V1')?.map((connection) => ({
        CurrentTypeOfConnection: textOf(connection['CurrentTypeOfConnection']),
        CurrentConnectionId: textOf(connection['CurrentConnectionId']),
        FutureTypeOfConnection: textOf(connection['FutureTypeOfConnection']),
        FutureConnectionId: textOf(connection['FutureConnectionId']),
      })),
      FtthNlsType: textOf(item['FtthNlsType']),
      PlanDate: textOf(item['PlanDate']),
    })),
    Comments: stringsOf(body['Comments']),
    WeasFiberConnections: itemsOf(body['WeasFiberConnections'], 'FiberConnection_V1')?.map((item) => ({
      AccessId: textOf(item['AccessId']),
      IsWsoWsoMigrationPossible: boolOf(item['IsWsoWsoMigrationPossible']),
    })),
  };
}

function projectRadius(body: XmlObject): RadiusCheckResponse {
  return {
    ErrorMessage: textOf(body['ErrorMessage']),
    ResponseItems: itemsOf(body['ResponseItems'], 'RadiusCheckResponseItem_V1')?.map((item) => ({
      Status: textOf(item['Status']),
      Nas: textOf(item['Nas']),
      Password: textOf(item['Password']),
      User: textOf(item['User']),
      Action: textOf(item['Action']),
      DateCreated: textOf(item['DateCreated']),
    })),
  };
}

function projectRas(body: XmlObject): RasCheckResponse {
  return {
    ErrorMessage: textOf(body['ErrorMessage']),
    ResponseItems: itemsOf(body['ResponseItems'], 'RasCheckResponseItem_V1')?.map((item) => ({
      VrfId: intOf(item['VrfId']),
      QosEnabled: boolOf(item['QosEnabled']),
      HasSession: boolOf(item['HasSession']),
      PingSuccessPercent: intOf(item['PingSuccessPercent']),
      IpAddress: textOf(item['IpAddress']),
      Error: textOf(item['Error']),
      PolicyDetails: textOf(item['PolicyDetails']),
    })),
  };
}

function projectStartLineDiagnose(body: XmlObject): StartLineDiagnoseResponse {
  const result = isObj(body['StartLineDiagnoseResult']) ? body['StartLineDiagnoseResult'] : undefined;
  return {
    Status: projectStatus(body['Status']),
    OrderId: intOf(body['OrderId']),
    ErrorMessage: textOf(body['ErrorMessage']),
    StartLineDiagnoseResult: result ? { AnalysisId: textOf(result['AnalysisId']) } : undefined,
  };
}

function projectCustomer(item: XmlObject): CustomerDataV4 {
  return {
    Id: intOf(item['Id']),
    Name: textOf(item['Name']),
    Street: textOf(item['Street']),
    HouseNr: intOf(item['HouseNr']),
    HouseNrExtension: textOf(item['HouseNrExtension']),
    ZipCode: textOf(item['ZipCode']),
    City: textOf(item['City']),
    CountryCode: textOf(item['CountryCode']),
    Phone1: textOf(item['Phone1']),
    Phone2: textOf(item['Phone2']),
    DateCreated: textOf(item['DateCreated']),
    IsActive: boolOf(item['IsActive']),
    Fax: textOf(item['Fax']),
    Email: textOf(item['Email']),
    Website: textOf(item['Website']),
    DebitNr: textOf(item['DebitNr']),
    LegalStatus: textOf(item['LegalStatus']),
    ExternalId: textOf(item['ExternalId']),
    ChamberOfCommerceNr: textOf(item['ChamberOfCommerceNr']),
    IBAN: textOf(item['IBAN']),
    BIC: textOf(item['BIC']),
    VATNr: textOf(item['VATNr']),
    FirstBillingDate: textOf(item['FirstBillingDate']),
    KrnId: textOf(item['KrnId']),
  };
}

function projectCustomerData(body: XmlObject): CustomerDataResponse {
  const page = isObj(body['PagedResult']) ? body['PagedResult'] : undefined;
  return {
    PagedResult: page
      ? {
          Skip: intOf(page['Skip']),
          Take: intOf(page['Take']),
          TotalNumberOfRecords: intOf(page['TotalNumberOfRecords']),
          Results: itemsOf(page['Results'], 'CustomerData_V4')?.map(projectCustomer),
        }
      : undefined,
    ErrorMessage: textOf(body['ErrorMessage']),
  };
}

function projectOrderData(body: XmlObject): OrderDataResponse {
  const order = isObj(body['Order']) ? body['Order'] : undefined;
  return {
    Status: projectStatus(body['Status']),
    Order: order
      ? {
          CustomerId: intOf(order['CustomerId']),
          ProductCode: textOf(order['ProductCode']),
          Quantity: intOf(order['Quantity']),
        }
      : undefined,
  };
}

const MOBILE_SETTING_KEYS = [
  'BlockSim',
  'BlockOutgoingCalls',
  'BlockCallsToInternationalNumbers',
  'BlockOutgoingCallsExceptDomestic',
  'BlockRoaming',
  'BlockIncomingCallsWhenRoaming',
  'BlockDataRoaming',
  'BlockInformationNumbers',
  'BlockServiceNumbers',
  'BlockCallerId',
  'BlockCallWaiting',
  'BlockPremiumSms',
  'BlockCsDataFax',
  'BlockVoLte',
  'DataRoamingLimitEnabled',
  'InternationalCallForwardingEnabled',
  'CurrentMonthDataRoamingLimitLifted',
  'BlockOutgoingSms',
  'BlockIncomingSms',
  'BlockIncomingCall',
  'BlockOutgoingCallWhenRoaming',
  'BlockIncomingSmsWhenRoaming',
  'BlockOutgoingSmsWhenRoaming',
  'BlockConferenceCall',
  'BlockVoicemail',
  'SatelliteNetworksEnabled',
] as const;

function projectSetting(value: XmlValue | null | undefined): SettingStatusV1 | undefined {
  if (!isObj(value)) return undefined;
  return {
    Value: boolOf(value['Value']),
    IsPending: boolOf(value['IsPending']),
    Remark: textOf(value['Remark']),
  };
}

function projectMobileSettings(body: XmlObject): GetMobileSettingsResponse {
  const settings = isObj(body['Settings']) ? body['Settings'] : undefined;
  const projected: MobileSettingsV1 = {};
  if (settings) {
    for (const key of MOBILE_SETTING_KEYS) {
      const setting = projectSetting(settings[key]);
      if (setting) projected[key] = setting;
    }
  }
  return {
    Settings: settings ? projected : undefined,
    ErrorMessage: textOf(body['ErrorMessage']),
  };
}

function projectUsage(body: XmlObject): GetMobileSubscriptionUsageResponse {
  const usage = isObj(body['MobileSubscriptionUsage']) ? body['MobileSubscriptionUsage'] : undefined;
  return {
    Status: projectStatus(body['Status']),
    OrderId: intOf(body['OrderId']),
    MobileSubscriptionUsage: usage
      ? {
          CustomerId: intOf(usage['CustomerId']),
          PhoneNumber: textOf(usage['PhoneNumber']),
          DataBundleValue: numberOf(usage['DataBundleValue']),
          DataCurrentValue: numberOf(usage['DataCurrentValue']),
          UomData: textOf(usage['UomData']),
          VoiceBundleValue: numberOf(usage['VoiceBundleValue']),
          VoiceCurrentValue: numberOf(usage['VoiceCurrentValue']),
          UomVoice: textOf(usage['UomVoice']),
          SmsBundleValue: intOf(usage['SmsBundleValue']),
          SmsCurrentValue: intOf(usage['SmsCurrentValue']),
          UomSms: textOf(usage['UomSms']),
          Amount: numberOf(usage['Amount']),
          UomAmount: textOf(usage['UomAmount']),
        }
      : undefined,
  };
}

function projectSim(body: XmlObject): GetSimResponse {
  const sim = isObj(body['Sim']) ? body['Sim'] : undefined;
  const card = sim && isObj(sim['SimCard']) ? sim['SimCard'] : undefined;
  const esim = sim && isObj(sim['ESim']) ? sim['ESim'] : undefined;
  return {
    Status: projectStatus(body['Status']),
    Sim: sim
      ? {
          SimType: textOf(sim['SimType']),
          ICCId: textOf(sim['ICCId']),
          Puc1: textOf(sim['Puc1']),
          SimCard: card ? { Puc1: textOf(card['Puc1']) } : undefined,
          ESim: esim
            ? {
                SmdpAddress: textOf(esim['SmdpAddress']),
                ActivationCode: textOf(esim['ActivationCode']),
                ConfirmationCode: textOf(esim['ConfirmationCode']),
              }
            : undefined,
        }
      : undefined,
  };
}

function projectPortings(body: XmlObject): AvailablePortingsResponse {
  return {
    Status: projectStatus(body['Status']),
    AvailablePortings: itemsOf(body['AvailablePortings'], 'AvailablePorting_V1')?.map((item) => ({
      PortingId: textOf(item['PortingId']),
      FirstPossiblePortingDate: textOf(item['FirstPossiblePortingDate']),
      PlannedPortingDate: textOf(item['PlannedPortingDate']),
      Numbers: itemsOf(item['Numbers'], 'AvailablePortingNumber_V1')?.map((number) => ({
        OrderId: intOf(number['OrderId']),
        PhoneNumber: textOf(number['PhoneNumber']),
        LastPhoneNumber: textOf(number['LastPhoneNumber']),
      })),
      PortingContractType: textOf(item['PortingContractType']),
    })),
  };
}

function toResult<T>(parsed: GrexxParsedResponse, data?: T): IrmaCallResult<T> {
  return {
    rootElement: parsed.rootElement,
    grexxCode: parsed.grexxCode,
    grexxCodeMessage: parsed.grexxCodeMessage,
    message: parsed.message,
    orderStatus: parsed.orderStatus,
    data,
    rawXml: parsed.rawXml,
  };
}

function isGatewayFailure(parsed: GrexxParsedResponse): boolean {
  return parsed.grexxCode !== undefined && describeGrexxCode(parsed.grexxCode).category === 'gateway';
}

function parseProjected<T>(xml: string, families: readonly string[], project: (body: XmlObject) => T): IrmaCallResult<T> {
  const parsed = parseTypedResponse(xml, families);
  if (isGatewayFailure(parsed)) return toResult(parsed);
  return toResult(parsed, project(parsed.body));
}

export function parseZipCodeCheckResponse(xml: string): IrmaCallResult<ZipCodeCheckResponse> {
  return parseProjected(xml, [PHASE1_RESPONSE_ROOTS.ZipCodeCheckResponse, 'ZipCodeCheck'], projectZipCodeCheck);
}

export function parsePrequalificationResponse(xml: string): IrmaCallResult<PrequalificationResponse> {
  return parseProjected(xml, [PHASE1_RESPONSE_ROOTS.PrequalificationResponse, 'Prequalification'], projectPrequalification);
}

export function parseCarrierInfoResponse(xml: string): IrmaCallResult<CarrierInfoResponse> {
  return parseProjected(xml, [PHASE1_RESPONSE_ROOTS.CarrierInfoResponse, 'CarrierInfo'], projectCarrierInfo);
}

export function parseRadiusCheckResponse(xml: string): IrmaCallResult<RadiusCheckResponse> {
  return parseProjected(xml, [PHASE1_RESPONSE_ROOTS.RadiusCheckResponse, 'RadiusCheck'], projectRadius);
}

export function parseRasCheckResponse(xml: string): IrmaCallResult<RasCheckResponse> {
  return parseProjected(xml, [PHASE1_RESPONSE_ROOTS.RasCheckResponse, 'RasCheck'], projectRas);
}

export function parseStartLineDiagnoseResponse(xml: string): IrmaCallResult<StartLineDiagnoseResponse> {
  return parseProjected(
    xml,
    [PHASE1_RESPONSE_ROOTS.StartLineDiagnoseResponse, 'StartLineDiagnose', 'LineDiagnose'],
    projectStartLineDiagnose
  );
}

export function parseCustomerDataResponse(xml: string): IrmaCallResult<CustomerDataResponse> {
  return parseProjected(xml, [PHASE1_RESPONSE_ROOTS.CustomerDataResponse, 'CustomerData'], projectCustomerData);
}

export function parseOrderDataResponse(xml: string): IrmaCallResult<OrderDataResponse> {
  return parseProjected(xml, [PHASE1_RESPONSE_ROOTS.OrderDataResponse, 'OrderData'], projectOrderData);
}

export function parseGetSimResponse(xml: string): IrmaCallResult<GetSimResponse> {
  return parseProjected(xml, [PHASE1_RESPONSE_ROOTS.GetSimResponse, 'GetSim'], projectSim);
}

export function parseGetMobileSettingsResponse(xml: string): IrmaCallResult<GetMobileSettingsResponse> {
  return parseProjected(xml, [PHASE1_RESPONSE_ROOTS.GetMobileSettingsResponse, 'GetMobileSettings'], projectMobileSettings);
}

export function parseGetMobileSubscriptionUsageResponse(
  xml: string
): IrmaCallResult<GetMobileSubscriptionUsageResponse> {
  return parseProjected(
    xml,
    [PHASE1_RESPONSE_ROOTS.GetMobileSubscriptionUsageResponse, 'GetMobileSubscriptionUsage'],
    projectUsage
  );
}

export function parseAvailablePortingsResponse(xml: string): IrmaCallResult<AvailablePortingsResponse> {
  return parseProjected(xml, [PHASE1_RESPONSE_ROOTS.AvailablePortingsResponse, 'AvailablePortings'], projectPortings);
}

/** No response XSD was published. The body is the parsed XML object. */
export function parseOrderSummaryResponse(xml: string): IrmaCallResult<XmlObject> {
  const parsed = parseGrexxResponse(xml);
  return toResult(parsed, parsed.body);
}

/** No response XSD was published. The body is the parsed XML object. */
export function parseGetMobileSubscriptionOrdersResponse(xml: string): IrmaCallResult<XmlObject> {
  const parsed = parseGrexxResponse(xml);
  return toResult(parsed, parsed.body);
}
