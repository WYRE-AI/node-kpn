import { PRODUCT_PATHS } from '../config.js';
import type { HttpClient } from '../http.js';
import type { MsmPage } from '../types/common.js';
import type { HierarchyItem, HierarchyItemDetails } from '../types/mobile-hierarchy.js';

const BASE = `${PRODUCT_PATHS.msm}/hierarchy/children`;

/** MSM organisation tree (customer, debtors, cost centres, groups, locations, subscribers). */
export class MobileHierarchyResource {
  constructor(private readonly http: HttpClient) {}

  /** Children of `id`; omit `id` for the root entities. */
  async listChildren(p?: {
    id?: number;
    pattern?: string;
    includeCustomer?: boolean;
    includeGroups?: boolean;
    from?: number;
    to?: number;
  }): Promise<MsmPage<HierarchyItem>> {
    return this.http.request<MsmPage<HierarchyItem>>(BASE, { params: { ...p } });
  }

  async get(id: number): Promise<HierarchyItemDetails> {
    return this.http.request<HierarchyItemDetails>(`${BASE}/${id}`);
  }
}
