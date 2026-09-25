import { PRODUCT_PATHS } from '../config.js';
import type { HttpClient } from '../http.js';
import type { MsmPageParams } from '../msm.js';
import type { MsmPage } from '../types/common.js';
import type { Contract } from '../types/mobile-contract.js';
import type { Threshold } from '../types/mobile-threshold.js';

const BASE = `${PRODUCT_PATHS.msm}/contract/thresholds`;

/** MSM daily usage thresholds (caps/alerts) — read-only surface. */
export class MobileThresholdsResource {
  constructor(private readonly http: HttpClient) {}

  /** Not paged: the API returns a bare array. */
  async list(): Promise<Threshold[]> {
    return this.http.request<Threshold[]>(BASE);
  }

  /** Contracts the threshold is assigned to. */
  async listContracts(thresholdId: number, p?: MsmPageParams): Promise<MsmPage<Contract>> {
    return this.http.request<MsmPage<Contract>>(`${BASE}/${thresholdId}/contracts`, {
      params: { ...p },
    });
  }
}
