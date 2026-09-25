import { PRODUCT_PATHS } from '../config.js';
import type { HttpClient } from '../http.js';
import type { DisturbanceResult } from '../types/disturbance.js';

/** KPN Disturbance Check: current and planned outages at a Dutch address. */
export class DisturbancesResource {
  constructor(private readonly http: HttpClient) {}

  async getByAddress(a: {
    zipCode: string;
    houseNumber: string | number;
    houseNumberExtension?: string;
  }): Promise<DisturbanceResult> {
    const raw = await this.http.request<Partial<DisturbanceResult> | undefined>(
      `${PRODUCT_PATHS.disturbance}/address`,
      {
        params: {
          zip_code: a.zipCode,
          house_number: String(a.houseNumber),
          house_number_extension: a.houseNumberExtension,
        },
      }
    );
    // Absent categories mean "nothing there"; default them so callers can iterate.
    return {
      ...raw,
      broadband: raw?.broadband ?? [],
      fixed: raw?.fixed ?? [],
      mobile: raw?.mobile ?? [],
      generic: raw?.generic ?? [],
    };
  }
}
