import type { LocalizedString } from './common.js';
import type { ContractItem, FlexibleNumberPresentation } from './mobile-contract.js';

/**
 * Track-and-trace status filter / status values. The spec's enum is used
 * verbatim (`HOLD_CUSTOMER`, `WAITING`); sending anything else is a 400.
 */
export type OrderStatus =
  | 'IN_PROGRESS'
  | 'UNAUTHORIZED'
  | 'NEW'
  | 'CLOSED'
  | 'CANCELED'
  | 'REJECTED'
  | 'DRAFT'
  | 'THIRD_PARTY'
  | 'HOLD_CUSTOMER'
  | 'WAITING';

export type RequiredAction = 'AUTHORIZATION' | 'PORT_IN_DATA_CHANGE';

export interface OrderParticipant {
  id?: number;
  firstName?: string;
  lastName?: string;
  prefix?: string;
  accountName?: string;
}

export interface OrderReceiver extends OrderParticipant {
  companyName?: string;
  employeeNumber?: string;
}

export interface OrderAuthorizer extends OrderParticipant {
  spectatedBy?: string;
}

export interface OrderParticipants {
  orderedBy?: OrderParticipant;
  receivedBy?: OrderReceiver;
  approvedBy?: OrderAuthorizer;
}

export interface MsmAddress {
  attention?: string;
  companyName?: string;
  street?: string;
  houseNumber?: string;
  postalCode?: string;
  city?: string;
  provinceOrState?: string;
  country?: string;
  floor?: string;
  room?: string;
  location?: string;
}

/** `{enabled, visible}` flag for a follow-up action on an order. */
export interface OrderActionAvailability {
  enabled?: boolean;
  visible?: boolean;
}

/** MSM `Order` — a row of `GET /track-and-trace/orders`. */
export interface Order {
  id?: number;
  kpnReference?: string;
  customerReference?: string;
  type?: LocalizedString;
  status?: OrderStatus;
  creationDate?: string;
  finishDate?: string;
  msisdn?: string;
  orderedBy?: OrderParticipant;
  orderedFor?: OrderReceiver;
  requiredAction?: RequiredAction;
  portingMessage?: string;
  isBeingCanceled?: boolean;
  contractItems?: ContractItem[];
}

/** One line of an order (`ContractingSuborder`), recursive. */
export interface OrderItem {
  id?: string;
  name?: LocalizedString;
  productName?: string;
  status?: string;
  multiplicity?: number;
  expectedDeliveryDate?: string;
  oneTimePriceInCents?: number;
  privateCopyingLevyInCents?: number;
  mobileNumbers?: string[];
  imeiNumbers?: string[];
  serialNumbers?: string[];
  children?: OrderItem[];
}

/** MSM `OrderDetails` (`GET /track-and-trace/orders/{id}`). */
export interface OrderDetails {
  id?: number;
  kpnReference?: string;
  customerReference?: string;
  status?: OrderStatus;
  type?: LocalizedString;
  requiredAction?: RequiredAction;
  creationDate?: string;
  wishDate?: string;
  firstPossibleWishDate?: string;
  startDate?: string;
  finishDate?: string;
  deliveryAddress?: MsmAddress;
  deliveryId?: string;
  invoiceAddress?: MsmAddress;
  sim?: string;
  eSimEmail?: string;
  eSimConfirmationCode?: string;
  eid?: number;
  msisdn?: string;
  flexibleNumberPresentation?: FlexibleNumberPresentation;
  portingCustomerNumber?: string;
  portingMessage?: string;
  items?: OrderItem[];
  thresholds?: Record<string, unknown>;
  attributes?: Record<string, unknown>;
  oneTimeCostInCents?: number;
  recurringCostInCents?: number;
  personsInvolved?: OrderParticipants;
  contextAccountId?: number;
  contextCustomerId?: number;
  registeredForAppleDep?: boolean;
  registeredForSamsungKnox?: boolean;
  appleDepId?: string;
  samsungKnoxId?: string;
  cancelOrder?: OrderActionAvailability;
  changeWishDate?: OrderActionAvailability;
  changePortingData?: OrderActionAvailability;
  returnHardware?: OrderActionAvailability;
  appleDepEnrollment?: OrderActionAvailability;
  samsungKnoxEnrollment?: OrderActionAvailability;
}
