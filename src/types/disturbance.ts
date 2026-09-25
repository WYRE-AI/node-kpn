/**
 * Address alert returned by the address-based network APIs (Disturbance
 * Check, Internet Speed Check) when the address is unknown or malformed.
 */
export interface AddressAlert {
  code?: string;
  description?: string;
  code_message?: string;
}

/** One outage or maintenance record (field names are the API's snake_case). */
export interface Disturbance {
  id?: number;
  /** e.g. `generic`. */
  type?: string;
  /** e.g. `disturbance`; planned maintenance is distinguished here. */
  cause?: string;
  source?: string;
  /** Affected service, e.g. `I-TV`, `Webmail`. */
  service?: string;
  /** e.g. `open`. */
  state?: string;
  /** ISO 8601 with offset. */
  start_date?: string;
  end_date?: string;
  region?: string;
  description?: string;
  /** HTML. */
  long_description?: string;
  info?: string;
  affected_elements_count?: number;
  affected_customers_count?: number;
  communicated_customers_sms_count?: number;
  communicated_customers_email_count?: number;
  serviceguard_ticket_id?: string;
  created_at?: string;
  communication_type?: string;
  sms_text?: string;
}

/**
 * Disturbances affecting one address, grouped by category. The SDK defaults
 * every category to `[]` when the API omits it, so "all empty" means no known
 * disturbance.
 */
export interface DisturbanceResult {
  broadband: Disturbance[];
  fixed: Disturbance[];
  mobile: Disturbance[];
  generic: Disturbance[];
  alerts?: AddressAlert[];
}
