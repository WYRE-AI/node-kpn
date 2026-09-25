import type { LocalizedString } from './common.js';
import type { HierarchyItem } from './mobile-hierarchy.js';

export type ContractState = 'ACTIVE' | 'CLOSED' | 'ORDERED' | 'PENDING' | 'BLOCKED';

/** `GET /contract/all` `category` values. */
export type ContractCategory =
  | 'MOBILE'
  | 'FIXED'
  | 'FIXED_MOBILE'
  | 'HARDWARE'
  | 'SKYPE_FOR_BUSINESS'
  | 'SOFTWARE'
  | 'OTHER';

/** MSM `Contract` — one line/SIM, as returned by the paged contract lists. */
export interface Contract {
  id?: number;
  category?: ContractCategory | string;
  productCategory?: string;
  product?: LocalizedString;
  firstName?: string;
  lastName?: string;
  namePrefix?: string;
  mobileNumber?: string;
  fixedNumber?: string;
  extension?: string;
  simCardNumber?: string;
  imei?: string;
  sipAccount?: string;
  state?: ContractState;
}

export interface FixedNumberPresentation {
  description?: 'ORGANISATION' | 'FIXED_NUMBER' | 'HUNTGROUP' | 'CALL_CENTER';
  number?: string;
}

export interface FlexibleNumberPresentation {
  defaultNumber?: string;
  fixedNumbers?: FixedNumberPresentation[];
  mobileNumberPresentation?: boolean;
}

/**
 * MSM `ContractDetails` (`GET /contract/id/{id}`).
 * SENSITIVE: carries the SIM `pin` and `puk` raw. The SDK does not mask them;
 * any consumer that shows this to a person or an LLM must.
 */
export interface ContractDetails {
  id?: number;
  name?: LocalizedString;
  status?: string;
  tariffPlan?: string;
  phoneNumber?: string;
  fixedNumber?: string;
  extension?: string;
  flexibleNumberPresentation?: FlexibleNumberPresentation;
  simCardNumber?: string;
  uiccid?: string;
  imei?: string;
  pin?: string;
  puk?: string;
  activationDate?: string;
  startDate?: string;
  endDate?: string;
  lastStatusChangeDate?: string;
  hierarchyPath?: HierarchyItem[];
  userId?: string;
  userPrincipalName?: string;
  userGroupId?: string;
  userGroupName?: string;
  enterpriseId?: string;
  enterpriseName?: string;
  pbxName?: string;
  fixedMobilePbxId?: string;
  fixedMobilePbxName?: string;
  sipAccount?: string;
  individualBundle?: boolean;
  multiplicity?: number;
}

/** Add-on / bundle tree node (`GET /contract/id/{id}/items`). */
export interface ContractItem {
  id?: number;
  contractId?: number;
  name?: LocalizedString;
  productBsId?: number;
  tariffPlanVariantBsId?: number;
  citemBsId?: number;
  children?: ContractItem[];
}

/** An open order or service request that prevents an operation. */
export interface BlockingOrder {
  id?: number;
  kpnReference?: string;
  status?: string;
  type?: 'CONTRACTING' | 'SERVICE_REQUEST';
}

export interface OperationAvailability {
  enabled?: boolean;
  visible?: boolean;
  blockingOrders?: BlockingOrder[];
}

/** `GET /order/operations?contractId=` — which writes are currently allowed on a contract. */
export interface OperationsAvailability {
  contractId?: number;
  blockSim?: OperationAvailability;
  unblockSim?: OperationAvailability;
  replaceSim?: OperationAvailability;
  modify?: OperationAvailability;
  move?: OperationAvailability;
  terminate?: OperationAvailability;
  /** The spec's key. */
  portOut?: OperationAvailability;
  /** Name used by DESIGN.md §3.4; kept in case KPN's live payload differs from the spec. */
  portingOut?: OperationAvailability;
  combineFixedMobile?: OperationAvailability;
  separateFixedMobile?: OperationAvailability;
  [k: string]: unknown;
}
