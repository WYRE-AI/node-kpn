import { PRODUCT_PATHS } from '../config.js';
import type { HttpClient } from '../http.js';
import type { AvailabilityResult } from '../types/availability.js';
import type { AddressAlert } from '../types/disturbance.js';

/** The wire shape: either bandwidth name, and alerts as an object or an array. */
type RawAvailability = Omit<AvailabilityResult, 'alerts'> & {
  max_bandwidth?: AvailabilityResult['bandwidth'];
  alerts?: AddressAlert | AddressAlert[];
};

/** KPN Internet Speed Check: access technologies and max speeds at a Dutch address. */
export class AvailabilityResource {
  constructor(private readonly http: HttpClient) {}

  /** A POST, but read-only, so it is safe to retry. */
  async getByAddress(a: {
    zipCode: string;
    houseNumber: number;
    houseNumberExtension?: string;
  }): Promise<AvailabilityResult> {
    const raw = await this.http.request<RawAvailability | undefined>(
      `${PRODUCT_PATHS.availability}/offer`,
      {
        method: 'POST',
        idempotent: true,
        body: {
          service_address: {
            zip_code: a.zipCode,
            house_number: a.houseNumber,
            house_number_extension: a.houseNumberExtension,
          },
        },
      }
    );
    return normalizeAvailability(raw ?? {});
  }
}

/** Map the docs/OAS variants onto one shape (see AvailabilityResult). */
function normalizeAvailability(raw: RawAvailability): AvailabilityResult {
  const { max_bandwidth, alerts, ...rest } = raw;
  const bandwidth = rest.bandwidth ?? max_bandwidth;
  return {
    ...rest,
    ...(bandwidth ? { bandwidth } : {}),
    alerts: toAlertArray(alerts),
  };
}

/** An empty object (valid address, OAS style) counts as no alerts. */
function toAlertArray(alerts: RawAvailability['alerts']): AddressAlert[] {
  if (!alerts) return [];
  if (Array.isArray(alerts)) return alerts;
  return Object.keys(alerts).length > 0 ? [alerts] : [];
}
