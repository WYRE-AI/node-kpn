/** Hierarchy node types in the MSM organisation tree. */
export type HierarchyItemType =
  | 'CUSTOMER'
  | 'DEBTOR'
  | 'SUBSCRIBER'
  | 'COST_CENTER'
  | 'CUSTOM_GROUP'
  | 'BUSINESS_LOCATION';

/** Whether an operation (e.g. MOVE_GROUP) is possible on a hierarchy item. */
export interface OperationState {
  blocked?: boolean;
  reason?: string;
  blockingOrders?: Array<Record<string, unknown>>;
}

/** MSM `VirtualHierarchyItem` (from `GET /hierarchy/children`). */
export interface HierarchyItem {
  id?: number;
  type?: HierarchyItemType;
  name?: string;
  costCenterNumber?: string;
  firstName?: string;
  lastName?: string;
  prefix?: string;
  email?: string;
  employeeNumber?: string;
  path?: HierarchyItem[];
  operation?: OperationState;
}

/** MSM `LocationAddress`. */
export interface LocationAddress {
  attention?: string;
  partyName?: string;
  street?: string;
  houseNumber?: string;
  postalCode?: string;
  city?: string;
  country?: string;
  floor?: string;
  room?: string;
  location?: string;
  poBoxNumber?: string;
}

export interface CustomerDetails {
  ckrNumber?: string;
  krnNumber?: string;
  billingOwner?: string;
  billingRetentionPeriod?: '6' | '25';
  orderFrozen?: boolean;
  orderFrozenFrom?: string;
  orderFrozenTo?: string;
}

export interface DebtorDetails {
  krnNumber?: string;
  activeFrom?: string;
  billingAddress?: LocationAddress;
  primaryAddress?: LocationAddress;
  primaryEmail?: string;
  invoiceDistribution?: 'MAIL' | 'EMAIL' | 'EINVOICE';
  invoiceLanguage?: 'EN' | 'NL';
  appleDepId?: string;
  samsungKnoxId?: string;
  [key: string]: unknown; // spec also has misspelled extras (additionalInvoiceLayuot, inviceFlag)
}

export interface BusinessLocationDetails {
  activeFrom?: string;
  activeTo?: string;
  contactName?: string;
  contactEmail?: string;
  contactPhoneNumber?: string;
  expectedNumberOfUsers?: number;
  externalAccountNumber?: string;
  primaryAddress?: LocationAddress;
}

export interface CostCenterDetails {
  number?: string;
}

/** MSM `HierarchyItemDetails` (from `GET /hierarchy/children/{id}`); one sub-object is set per item type. */
export interface HierarchyItemDetails {
  name?: string;
  path?: HierarchyItem[];
  customer?: CustomerDetails;
  debtor?: DebtorDetails;
  businessLocation?: BusinessLocationDetails;
  costCenter?: CostCenterDetails;
}
