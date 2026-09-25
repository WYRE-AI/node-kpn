import { PRODUCT_PATHS } from '../config.js';
import type { HttpClient } from '../http.js';
import type { MsmPageParams } from '../msm.js';
import type { MsmPage } from '../types/common.js';
import type { Contract } from '../types/mobile-contract.js';
import type { Subscriber, SubscriberDetails } from '../types/mobile-subscriber.js';

const BASE = `${PRODUCT_PATHS.msm}/hierarchy/subscribers`;

/** MSM subscribers (employees) — read-only surface. */
export class MobileSubscribersResource {
  constructor(private readonly http: HttpClient) {}

  /** `filters` is the MSM filter DSL; build it with `buildFilters()`. */
  async list(
    p?: MsmPageParams & { patterns?: string[]; filters?: string; userOnly?: boolean }
  ): Promise<MsmPage<Subscriber>> {
    return this.http.request<MsmPage<Subscriber>>(BASE, { params: { ...p } });
  }

  async get(id: number): Promise<SubscriberDetails> {
    return this.http.request<SubscriberDetails>(`${BASE}/${id}`);
  }

  async listContracts(subscriberId: number, p?: MsmPageParams): Promise<MsmPage<Contract>> {
    return this.http.request<MsmPage<Contract>>(`${BASE}/${subscriberId}/contracts`, {
      params: { ...p },
    });
  }
}
