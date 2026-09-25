import type { MsmPage } from '../../src/types/common.js';
import type { Contract } from '../../src/types/mobile-contract.js';
import type { HierarchyItem, HierarchyItemDetails } from '../../src/types/mobile-hierarchy.js';
import type { Invoice } from '../../src/types/mobile-invoice.js';
import type { Subscriber, SubscriberDetails } from '../../src/types/mobile-subscriber.js';
import type { Threshold } from '../../src/types/mobile-threshold.js';

// Fictional data only: example names, reserved-looking numbers, obvious fakes.

export const debtorItemFixture: HierarchyItem = {
  id: 2001,
  type: 'DEBTOR',
  name: 'Voorbeeld BV — Debiteur',
};

export const subscriberFixture: Subscriber = {
  id: 3001,
  firstName: 'Jan',
  lastName: 'Voorbeeld',
  prefix: 'de',
  employeeNumber: 'EMP-0001',
  fixedNumber: '0200000001',
  gripUser: false,
  user: false,
  contracts: { amount: 1, firstPhoneNumber: '0600000001' },
  path: [debtorItemFixture],
};

export const subscriberDetailsFixture: SubscriberDetails = {
  id: 3001,
  firstName: 'Jan',
  surname: 'Voorbeeld',
  surnamePrefix: 'de',
  email: 'jan@example.com',
  mobileNumber: '0600000001',
  fixedNumber: '0200000001',
  employeeNumber: 'EMP-0001',
  gender: 'MALE',
  preferredLanguage: 'NL',
  vip: false,
  location: [],
  gripUser: false,
  user: false,
  path: [debtorItemFixture],
};

export const orgContractFixture: Contract = {
  id: 4001,
  category: 'MOBILE',
  productCategory: 'VOICE_DATA',
  product: { en: 'Example Mobile Unlimited', nl: 'Voorbeeld Mobiel Onbeperkt' },
  firstName: 'Jan',
  lastName: 'Voorbeeld',
  mobileNumber: '0600000001',
  simCardNumber: '8931000000000000001',
  state: 'ACTIVE',
};

export const hierarchyItemFixture: HierarchyItem = {
  id: 1001,
  type: 'CUSTOMER',
  name: 'Voorbeeld BV',
  path: [],
  operation: { blocked: false },
};

export const hierarchyDetailsFixture: HierarchyItemDetails = {
  name: 'Voorbeeld BV — Debiteur',
  path: [hierarchyItemFixture],
  debtor: {
    krnNumber: 'KRN-0000001',
    primaryEmail: 'finance@example.com',
    invoiceDistribution: 'EMAIL',
    invoiceLanguage: 'NL',
    billingAddress: { street: 'Voorbeeldstraat', houseNumber: '1', postalCode: '1234AB', city: 'Voorbeeldstad', country: 'NL' },
  },
};

export const thresholdFixture: Threshold = {
  id: 5001,
  name: 'Roaming data cap',
  type: 'DATA_ROAMING_MB',
  dailyValue: 500,
};

export const invoiceFixture: Invoice = {
  id: 6001,
  number: 'INV-000001',
  date: '2026-08-01T00:00:00Z',
  payBeforeDate: '2026-08-31T00:00:00Z',
  debtorName: 'Voorbeeld BV',
  totalAmountToPayInCents: 12345,
  type: 'SERVICE_INVOICE',
};

/** A tiny, obviously fake PDF body. */
export const invoicePdfBytes = new TextEncoder().encode('%PDF-1.4\n% fake invoice\n%%EOF\n');

export function page<T>(items: T[]): MsmPage<T> {
  return { result: items, total: items.length };
}
