import { PRODUCT_PATHS } from '../config.js';
import type { HttpClient } from '../http.js';
import type { MsmPageParams } from '../msm.js';
import type { MsmPage } from '../types/common.js';
import type { OrderStatus } from '../types/mobile-order.js';
import type { ServiceRequest, ServiceRequestDetails } from '../types/mobile-service-request.js';

const MSM = PRODUCT_PATHS.msm;

/** MSM service requests (changes to existing contracts) — read-only surface. */
export class MobileServiceRequestsResource {
  constructor(private readonly http: HttpClient) {}

  /** `status` is required by KPN (repeated keys). `language` sets `Content-Language`. */
  async list(
    p: MsmPageParams & {
      status: OrderStatus[];
      patterns?: string[];
      currentUserOrdersOnly?: boolean;
      language?: 'en' | 'nl';
    }
  ): Promise<MsmPage<ServiceRequest>> {
    const { language, ...params } = p;
    return this.http.request<MsmPage<ServiceRequest>>(`${MSM}/track-and-trace/service-requests`, {
      params,
      headers: language ? { 'Content-Language': language } : undefined,
    });
  }

  async get(id: number): Promise<ServiceRequestDetails> {
    return this.http.request<ServiceRequestDetails>(`${MSM}/track-and-trace/service-requests/${id}`);
  }
}
