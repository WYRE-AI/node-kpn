/** MSM product names and similar come in both languages. */
export interface LocalizedString {
  en?: string;
  nl?: string;
}

/** MSM `PagedResult_X`: one index window of results plus the total count. */
export interface MsmPage<T> {
  result: T[];
  total: number;
}

export type OrderSummaryStatus =
  | 'Failed'
  | 'Aborted'
  | 'Finished'
  | 'Suspended'
  | 'InProgress'
  | 'Waiting'
  | 'Draft'
  | 'WaitingForAuthorization';

/**
 * Returned by every MSM mutation. Orders are asynchronous: success means an
 * order was created, not that it has executed. `status` is widened to string
 * because the spec's enum value is truncated to `WaitingForAuthorizati`.
 */
export interface OrderSummary {
  id?: number;
  operation?: string;
  referenceNumber?: string;
  status?: OrderSummaryStatus | string;
  contextName?: string;
  creationDate?: string;
}

export type { QuotaInfo } from '../http.js';
