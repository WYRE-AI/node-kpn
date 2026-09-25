import { http, HttpResponse } from 'msw';

import {
  hierarchyDetailsFixture,
  hierarchyItemFixture,
  invoiceFixture,
  invoicePdfBytes,
  orgContractFixture,
  page,
  subscriberDetailsFixture,
  subscriberFixture,
  thresholdFixture,
} from '../fixtures/mobile-org.js';

const MSM = 'https://api-prd.kpn.com/mobile/kpn/mobileservices';

export const mobileOrgHandlers = [
  // Subscribers — the literal /contracts sub-route has more segments, so no ordering conflict.
  http.get(`${MSM}/hierarchy/subscribers`, () => HttpResponse.json(page([subscriberFixture]))),
  http.get(`${MSM}/hierarchy/subscribers/:id`, () => HttpResponse.json(subscriberDetailsFixture)),
  http.get(`${MSM}/hierarchy/subscribers/:id/contracts`, () =>
    HttpResponse.json(page([orgContractFixture]))
  ),

  // Hierarchy
  http.get(`${MSM}/hierarchy/children`, () => HttpResponse.json(page([hierarchyItemFixture]))),
  http.get(`${MSM}/hierarchy/children/:id`, () => HttpResponse.json(hierarchyDetailsFixture)),

  // Thresholds
  http.get(`${MSM}/contract/thresholds`, () => HttpResponse.json([thresholdFixture])),
  http.get(`${MSM}/contract/thresholds/:id/contracts`, () =>
    HttpResponse.json(page([orgContractFixture]))
  ),

  // Invoices
  http.get(`${MSM}/finances/invoices`, () => HttpResponse.json(page([invoiceFixture]))),
  http.get(`${MSM}/finances/invoices/:id`, ({ params }) =>
    new HttpResponse(invoicePdfBytes, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="invoice-${String(params.id)}.pdf"`,
      },
    })
  ),
];
