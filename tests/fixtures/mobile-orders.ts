import type { MsmPage, OrderSummary } from '../../src/types/common.js';
import type {
  Contract,
  ContractDetails,
  ContractItem,
  OperationsAvailability,
} from '../../src/types/mobile-contract.js';
import type { Order, OrderDetails } from '../../src/types/mobile-order.js';
import type {
  ServiceRequest,
  ServiceRequestDetails,
} from '../../src/types/mobile-service-request.js';

// Fictional data only: example names, obviously fake numbers, PIN/PUK and ICCIDs.

export function msmPage<T>(result: T[], total = result.length): MsmPage<T> {
  return { result, total };
}

export const contractFixture: Contract = {
  id: 5001,
  category: 'MOBILE',
  productCategory: 'VOICE_DATA',
  product: { en: 'Example Unlimited', nl: 'Voorbeeld Onbeperkt' },
  firstName: 'Jan',
  lastName: 'Voorbeeld',
  namePrefix: 'de',
  mobileNumber: '0600000001',
  simCardNumber: '8931000000000000001',
  imei: '000000000000001',
  state: 'ACTIVE',
};

export const FAKE_PIN = '0000';
export const FAKE_PUK = '99999999';

export const contractDetailsFixture: ContractDetails = {
  id: 5001,
  name: { en: 'Example Unlimited', nl: 'Voorbeeld Onbeperkt' },
  status: 'ACTIVE',
  tariffPlan: 'Example Unlimited',
  phoneNumber: '+31600000001',
  simCardNumber: '8931000000000000001',
  imei: '000000000000001',
  pin: FAKE_PIN,
  puk: FAKE_PUK,
  activationDate: '2025-01-01',
  startDate: '2025-01-01',
  userPrincipalName: 'jan@voorbeeld.example',
  hierarchyPath: [{ id: 2001, type: 'DEBTOR', name: 'Voorbeeld BV — Debiteur' }],
};

export const contractItemsFixture: ContractItem[] = [
  {
    id: 1,
    contractId: 5001,
    name: { en: 'Example Unlimited', nl: 'Voorbeeld Onbeperkt' },
    productBsId: 100,
    children: [{ id: 2, contractId: 5001, name: { en: 'EU roaming', nl: 'EU roaming' }, children: [] }],
  },
];

export const operationsFixture: OperationsAvailability = {
  contractId: 5001,
  blockSim: { enabled: true, visible: true, blockingOrders: [] },
  unblockSim: { enabled: false, visible: false, blockingOrders: [] },
  replaceSim: {
    enabled: false,
    visible: true,
    blockingOrders: [{ id: 7002, kpnReference: 'KPN-0000002', status: 'IN_PROGRESS', type: 'SERVICE_REQUEST' }],
  },
  terminate: { enabled: true, visible: true, blockingOrders: [] },
};

export const orderSummaryFixture: OrderSummary = {
  id: 7001,
  operation: 'BLOCK_SIM',
  referenceNumber: 'WYRE-20260925120000',
  status: 'WaitingForAuthorization',
  contextName: 'Voorbeeld BV',
  creationDate: '2026-09-25T12:00:00Z',
};

export const orderFixture: Order = {
  id: 7001,
  kpnReference: 'KPN-0000001',
  customerReference: 'WYRE-20260925120000',
  type: { en: 'Block SIM', nl: 'SIM blokkeren' },
  status: 'UNAUTHORIZED',
  creationDate: '2026-09-25T12:00:00Z',
  msisdn: '+31600000001',
  orderedBy: { id: 1, firstName: 'Piet', lastName: 'Beheerder', accountName: 'piet@voorbeeld.example' },
  orderedFor: { id: 3001, firstName: 'Jan', lastName: 'Voorbeeld', companyName: 'Voorbeeld BV' },
  requiredAction: 'AUTHORIZATION',
  isBeingCanceled: false,
};

export const orderDetailsFixture: OrderDetails = {
  id: 7001,
  kpnReference: 'KPN-0000001',
  status: 'UNAUTHORIZED',
  type: { en: 'Block SIM', nl: 'SIM blokkeren' },
  requiredAction: 'AUTHORIZATION',
  creationDate: '2026-09-25T12:00:00Z',
  msisdn: '+31600000001',
  oneTimeCostInCents: 0,
  recurringCostInCents: 0,
  personsInvolved: { orderedBy: { firstName: 'Piet', lastName: 'Beheerder' } },
  cancelOrder: { enabled: true, visible: true },
};

export const prettyOrderFixture = {
  id: 7001,
  kpnReference: 'KPN-0000001',
  status: 'UNAUTHORIZED',
  items: { 'Block SIM': '+31600000001' },
};

export const serviceRequestFixture: ServiceRequest = {
  id: 8001,
  kpnReference: 'KPN-0000003',
  type: { en: 'Change services', nl: 'Diensten wijzigen' },
  status: 'IN_PROGRESS',
  creationDate: '2026-09-20T09:00:00Z',
  msisdn: '+31600000001',
  fixedNumber: '0200000001',
};

export const serviceRequestDetailsFixture: ServiceRequestDetails = {
  id: 8001,
  kpnReference: 'KPN-0000003',
  status: 'IN_PROGRESS',
  type: { en: 'Change services', nl: 'Diensten wijzigen' },
  expectedDate: '2026-09-30',
  attachments: [{ id: 1, fileName: 'voorbeeld.pdf' }],
  modifiedItems: [{ name: { en: 'EU roaming', nl: 'EU roaming' }, oldState: 'OFF', newState: 'ON' }],
  sim: '8931000000000000001',
};
