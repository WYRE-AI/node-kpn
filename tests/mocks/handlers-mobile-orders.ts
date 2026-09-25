import { http, HttpResponse } from 'msw';

import {
  contractDetailsFixture,
  contractFixture,
  contractItemsFixture,
  msmPage,
  operationsFixture,
  orderDetailsFixture,
  orderFixture,
  orderSummaryFixture,
  prettyOrderFixture,
  serviceRequestDetailsFixture,
  serviceRequestFixture,
} from '../fixtures/mobile-orders.js';

const MSM = 'https://api-prd.kpn.com/mobile/kpn/mobileservices';

export const mobileOrderHandlers = [
  // Contracts
  http.get(`${MSM}/contract/all`, () => HttpResponse.json(msmPage([contractFixture]))),
  http.get(`${MSM}/contract/id/:id`, () => HttpResponse.json(contractDetailsFixture)),
  http.get(`${MSM}/contract/id/:id/items`, () => HttpResponse.json(contractItemsFixture)),

  // Contract operations (SIM orders)
  http.get(`${MSM}/order/operations`, () => HttpResponse.json(operationsFixture)),
  http.post(`${MSM}/order/block-sim`, () => HttpResponse.json(orderSummaryFixture)),
  http.post(`${MSM}/order/unblock-sim`, () =>
    HttpResponse.json({ ...orderSummaryFixture, operation: 'UNBLOCK_SIM' })
  ),
  http.post(`${MSM}/order/replace-sim/validator`, () => new HttpResponse(null, { status: 200 })),
  http.post(`${MSM}/order/replace-sim`, () =>
    HttpResponse.json({ ...orderSummaryFixture, operation: 'REPLACE_SIM' })
  ),
  http.post(`${MSM}/order/authorize`, () =>
    HttpResponse.json({ ...orderSummaryFixture, status: 'Authorized' })
  ),

  // Track and trace
  http.get(`${MSM}/track-and-trace/orders`, () => HttpResponse.json(msmPage([orderFixture]))),
  http.get(`${MSM}/track-and-trace/orders/:id`, () => HttpResponse.json(orderDetailsFixture)),
  http.get(`${MSM}/track-and-trace/orders/:id/pretty`, () => HttpResponse.json(prettyOrderFixture)),
  http.post(`${MSM}/track-and-trace/orders/:id/cancel`, () => new HttpResponse(null, { status: 200 })),
  http.get(`${MSM}/track-and-trace/service-requests`, () =>
    HttpResponse.json(msmPage([serviceRequestFixture]))
  ),
  http.get(`${MSM}/track-and-trace/service-requests/:id`, () =>
    HttpResponse.json(serviceRequestDetailsFixture)
  ),
];
