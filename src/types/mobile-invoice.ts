export type InvoiceType =
  | 'CREDIT_NOTE'
  | 'HARDWARE_ADJUSTMENT'
  | 'HARDWARE_INVOICE'
  | 'HARDWARE_INVOICE_ADJUSTMENT'
  | 'SERVICE_ADJUSTMENT'
  | 'SERVICE_INVOICE'
  | 'SERVICE_INVOICE_ADJUSTMENT';

/** MSM `Invoice` (from `GET /finances/invoices`). The PDF is the only line-level detail. */
export interface Invoice {
  id?: number;
  number?: string;
  date?: string;
  payBeforeDate?: string;
  debtorName?: string;
  totalAmountToPayInCents?: number;
  type?: InvoiceType | string;
}
