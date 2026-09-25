import { http, HttpResponse } from 'msw';

import {
  availabilityWireFixture,
  disturbanceResultFixture,
  simSwapFixture,
} from '../fixtures/network.js';

const BASE = 'https://api-prd.kpn.com';

export const networkHandlers = [
  http.get(`${BASE}/network/kpn/disturbance-check/address`, () =>
    HttpResponse.json(disturbanceResultFixture)
  ),
  http.post(`${BASE}/network/kpn/internet-speed-check/offer`, () =>
    HttpResponse.json(availabilityWireFixture)
  ),
  http.post(`${BASE}/kpn/sim-swap/retrieve-date`, () => HttpResponse.json(simSwapFixture)),
];
