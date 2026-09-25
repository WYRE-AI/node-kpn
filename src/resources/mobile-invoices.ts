import { PRODUCT_PATHS } from '../config.js';
import type { BinaryResponse, HttpClient } from '../http.js';
import type { MsmPageParams } from '../msm.js';
import type { MsmPage } from '../types/common.js';
import type { Invoice } from '../types/mobile-invoice.js';

const BASE = `${PRODUCT_PATHS.msm}/finances/invoices`;

/** MSM invoices. There are no line items; the PDF is the only detail. */
export class MobileInvoicesResource {
  constructor(private readonly http: HttpClient) {}

  /** `searchFrom` / `searchTo` are YYYY-MM-DD dates. */
  async list(
    p?: MsmPageParams & {
      debtorId?: number;
      pattern?: string;
      searchFrom?: string;
      searchTo?: string;
      type?: string;
    }
  ): Promise<MsmPage<Invoice>> {
    return this.http.request<MsmPage<Invoice>>(BASE, { params: { ...p } });
  }

  /** The invoice as a PDF. 404 `INVOICE_NOT_FOUND` → NotFoundError. */
  async downloadPdf(id: number): Promise<BinaryResponse> {
    return this.http.request<BinaryResponse>(`${BASE}/${id}`, { responseType: 'binary' });
  }
}
