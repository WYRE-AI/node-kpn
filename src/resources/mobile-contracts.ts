import { PRODUCT_PATHS } from '../config.js';
import type { HttpClient } from '../http.js';
import type { MsmPageParams } from '../msm.js';
import type { MsmPage, OrderSummary } from '../types/common.js';
import type {
  Contract,
  ContractDetails,
  ContractItem,
  OperationsAvailability,
} from '../types/mobile-contract.js';

const MSM = PRODUCT_PATHS.msm;

/**
 * MSM contracts (SIMs/lines) plus the SIM order operations.
 *
 * The order POSTs (block/unblock/replace) are NOT idempotent and are never
 * retried: a duplicate submission is a real-world side effect. Call
 * `getOperations()` first to learn whether an operation is currently allowed.
 */
export class MobileContractsResource {
  constructor(private readonly http: HttpClient) {}

  /** `filters` is the MSM filter DSL; build it with `buildFilters()`. `language` sets `Content-Language`. */
  async list(
    p?: MsmPageParams & {
      patterns?: string[];
      filters?: string;
      category?: string;
      language?: 'en' | 'nl';
    }
  ): Promise<MsmPage<Contract>> {
    const { language, ...params } = p ?? {};
    return this.http.request<MsmPage<Contract>>(`${MSM}/contract/all`, {
      params,
      headers: language ? { 'Content-Language': language } : undefined,
    });
  }

  /** RAW details, including `pin` and `puk`. Masking is the consumer's job. */
  async get(id: number): Promise<ContractDetails> {
    return this.http.request<ContractDetails>(`${MSM}/contract/id/${id}`);
  }

  /** Add-on / bundle tree. */
  async getItems(id: number): Promise<ContractItem[]> {
    return this.http.request<ContractItem[]>(`${MSM}/contract/id/${id}/items`);
  }

  /** Which operations are allowed right now, and which open orders block the rest. */
  async getOperations(contractId: number): Promise<OperationsAvailability> {
    return this.http.request<OperationsAvailability>(`${MSM}/order/operations`, {
      params: { contractId },
    });
  }

  async blockSim(b: { contractId: number; referenceNumber: string }): Promise<OrderSummary> {
    return this.http.request<OrderSummary>(`${MSM}/order/block-sim`, { method: 'POST', body: b });
  }

  async unblockSim(b: { contractId: number; referenceNumber: string }): Promise<OrderSummary> {
    return this.http.request<OrderSummary>(`${MSM}/order/unblock-sim`, { method: 'POST', body: b });
  }

  /** Pre-check an ICCID. Resolves on 2xx; an invalid ICCID rejects with `ValidationError` (400, `code` set). Read-only, so retryable. */
  async validateSimReplacement(b: { contractId: number; newSimCardNumber: string }): Promise<void> {
    await this.http.request<unknown>(`${MSM}/order/replace-sim/validator`, {
      method: 'POST',
      body: b,
      idempotent: true,
    });
  }

  /** Physical SIM: pass `newSimCardNumber`. eSIM: `esim: true` and an `email` for the activation QR code. */
  async replaceSim(b: {
    contractId: number;
    newSimCardNumber?: string;
    esim: boolean;
    email?: string;
    confirmationCode?: string;
    referenceNumber: string;
    wishDate?: string;
  }): Promise<OrderSummary> {
    return this.http.request<OrderSummary>(`${MSM}/order/replace-sim`, { method: 'POST', body: b });
  }
}
