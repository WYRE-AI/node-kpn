import { PRODUCT_PATHS } from '../config.js';
import type { HttpClient } from '../http.js';
import type { SimSwapResult } from '../types/sim-swap.js';

/**
 * KPN SIM Swap (CAMARA-aligned). KPN-network numbers only: others return
 * 404 `SIM_SWAP.UNKNOWN_PHONE_NUMBER` (NotFoundError with that `code`); a
 * concurrent request for the same number returns 409 (ConflictError).
 */
export class SimSwapResource {
  constructor(private readonly http: HttpClient) {}

  /** `phoneNumber` is E.164 with a leading '+'. A POST, but read-only, so safe to retry. */
  async retrieveDate(phoneNumber: string): Promise<SimSwapResult> {
    const raw = await this.http.request<Partial<SimSwapResult> | undefined>(
      `${PRODUCT_PATHS.simSwap}/retrieve-date`,
      { method: 'POST', idempotent: true, body: { phoneNumber } }
    );
    return { latestSimChange: raw?.latestSimChange ?? null };
  }
}
