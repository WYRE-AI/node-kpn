import type { AddressAlert } from './disturbance.js';

/** One access technology available at the address. Speeds are in Mbit/s. */
export interface Technology {
  name?: 'FIBER' | 'COPPER' | 'NoAccess' | string;
  download?: number;
  upload?: number;
}

/**
 * Internet Speed Check result, NORMALIZED by the SDK. The spec and the docs
 * disagree, so the SDK maps:
 * - `max_bandwidth` (docs) → `bandwidth` (OAS);
 * - `alerts` as a single object (OAS) → an array (docs); always present.
 */
export interface AvailabilityResult {
  available_on_address?: {
    technologies?: Technology[];
    /** Valid extensions when the address is ambiguous. */
    house_number_extensions?: string[];
  };
  fixed_info?: {
    copper_access?: boolean;
    fiber_access?: boolean;
    hybrid_access?: boolean;
    mobile_access?: boolean;
  };
  fiber_info?: {
    thirdparty_delivery?: boolean;
    thirdparty_permission?: boolean;
    thirdparty_name?: string;
    construction_type?: string;
    planned_fiber_to_the_home_date?: string;
    planned_fiber_to_the_home_description?: string;
    civil_date?: string;
    wholesale_broadband_access_plan_date?: string;
    wholesale_broadband_access_plan_date_description?: string;
    nl_type?: string;
    phase?: string;
  };
  /** Max bandwidth in Mbit/s. */
  bandwidth?: { up?: number; down?: number };
  alerts: AddressAlert[];
}
