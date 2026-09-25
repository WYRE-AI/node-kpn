import type { LocalizedString } from './common.js';
import type { FlexibleNumberPresentation } from './mobile-contract.js';
import type {
  MsmAddress,
  Order,
  OrderActionAvailability,
  OrderParticipants,
  OrderStatus,
  RequiredAction,
} from './mobile-order.js';

/** MSM `ServiceRequest` — a change to an existing contract. Same shape as an order row, plus `fixedNumber`. */
export interface ServiceRequest extends Omit<Order, 'contractItems' | 'portingMessage'> {
  fixedNumber?: string;
}

/** A service toggled by the request (recursive). */
export interface ContractServiceUpdate {
  name?: LocalizedString;
  oldState?: 'ON' | 'OFF';
  newState?: 'ON' | 'OFF';
  children?: ContractServiceUpdate[];
}

export interface HardwareSuborder {
  name?: LocalizedString;
  imeiNumber?: string;
  serialNumber?: string;
  priceInCents?: number;
}

export interface ServiceRequestAttachment {
  id?: number;
  fileName?: string;
}

/** MSM `ServiceRequestDetails` (`GET /track-and-trace/service-requests/{id}`). */
export interface ServiceRequestDetails {
  id?: number;
  status?: OrderStatus;
  type?: LocalizedString;
  kpnReference?: string;
  customerReference?: string;
  requiredAction?: RequiredAction;
  creationDate?: string;
  expectedDate?: string;
  wishDate?: string;
  finishDate?: string;
  attachments?: ServiceRequestAttachment[];
  attributes?: Record<string, unknown>;
  modifiedItems?: ContractServiceUpdate[];
  hardwareItems?: HardwareSuborder[];
  sim?: string;
  newSim?: string;
  thresholds?: Record<string, unknown>;
  totalPriceInCents?: number;
  personsInvolved?: OrderParticipants;
  flexibleNumberPresentation?: FlexibleNumberPresentation;
  invoiceAddress?: MsmAddress;
  cancelOrder?: OrderActionAvailability;
  reactivate?: OrderActionAvailability;
}
