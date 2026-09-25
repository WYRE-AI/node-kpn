import { PRODUCT_PATHS } from '../config.js';
import type { HttpClient } from '../http.js';
import type { MsmPageParams } from '../msm.js';
import type { MsmPage, OrderSummary } from '../types/common.js';
import type { Order, OrderDetails, OrderStatus } from '../types/mobile-order.js';

const MSM = PRODUCT_PATHS.msm;

/**
 * MSM order tracking plus the two order writes (authorize, cancel).
 * The writes are NOT idempotent and are never retried.
 */
export class MobileOrdersResource {
  constructor(private readonly http: HttpClient) {}

  /** `status` is required by KPN and serializes as repeated keys (`status=NEW&status=IN_PROGRESS`). */
  async list(
    p: MsmPageParams & {
      status: OrderStatus[];
      patterns?: string[];
      currentUserOrdersOnly?: boolean;
      withRequiredActionFirst?: boolean;
    }
  ): Promise<MsmPage<Order>> {
    return this.http.request<MsmPage<Order>>(`${MSM}/track-and-trace/orders`, { params: { ...p } });
  }

  async get(id: number): Promise<OrderDetails> {
    return this.http.request<OrderDetails>(`${MSM}/track-and-trace/orders/${id}`);
  }

  /** Human-readable variant with operation availability. The schema is loosely specified, so it stays untyped. */
  async getPretty(id: number): Promise<unknown> {
    return this.http.request<unknown>(`${MSM}/track-and-trace/orders/${id}/pretty`);
  }

  /** Approve an UNAUTHORIZED order. Needs the `privileges_orders_authorization` GRIP privilege. */
  async authorize(orderId: number): Promise<OrderSummary> {
    return this.http.request<OrderSummary>(`${MSM}/order/authorize`, {
      method: 'POST',
      body: { orderId },
    });
  }

  /** Cancel an open order. The spec takes `note` as a query parameter, not a body. */
  async cancel(id: number, note?: string): Promise<unknown> {
    return this.http.request<unknown>(`${MSM}/track-and-trace/orders/${id}/cancel`, {
      method: 'POST',
      params: { note },
    });
  }
}
