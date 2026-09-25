import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import {
  AuthenticationError,
  ForbiddenError,
  NotFoundError,
  RateLimitError,
  ServerError,
} from '../src/index.js';
import { invoiceFixture, invoicePdfBytes, page } from './fixtures/mobile-org.js';
import { BASE, makeClient, respondWithError } from './helpers.js';
import { server } from './mocks/server.js';

const PATH = '/mobile/kpn/mobileservices/finances/invoices';
const client = makeClient();

describe('mobile.invoices', () => {
  it('lists invoices with debtor, date range, type and paging', async () => {
    let url: URL | undefined;
    server.use(
      http.get(`${BASE}${PATH}`, ({ request }) => {
        url = new URL(request.url);
        return HttpResponse.json(page([invoiceFixture]));
      })
    );

    const result = await client.mobile.invoices.list({
      debtorId: 2001,
      searchFrom: '2026-01-01',
      searchTo: '2026-08-31',
      type: 'SERVICE_INVOICE',
      pattern: 'INV',
      from: 0,
      to: 20,
    });

    expect(result).toEqual(page([invoiceFixture]));
    expect(url?.searchParams.get('debtorId')).toBe('2001');
    expect(url?.searchParams.get('searchFrom')).toBe('2026-01-01');
    expect(url?.searchParams.get('searchTo')).toBe('2026-08-31');
    expect(url?.searchParams.get('type')).toBe('SERVICE_INVOICE');
    expect(url?.searchParams.get('pattern')).toBe('INV');
    expect(url?.searchParams.get('from')).toBe('0');
    expect(url?.searchParams.get('to')).toBe('20');
  });

  it('downloads an invoice PDF as binary with content type and filename', async () => {
    const pdf = await client.mobile.invoices.downloadPdf(6001);
    expect(pdf.contentType).toContain('application/pdf');
    expect(pdf.filename).toBe('invoice-6001.pdf');
    expect(pdf.data).toBeInstanceOf(Uint8Array);
    expect(Array.from(pdf.data)).toEqual(Array.from(invoicePdfBytes));
  });

  describe('error paths', () => {
    it('401 → AuthenticationError', async () => {
      respondWithError('get', PATH, 401);
      await expect(client.mobile.invoices.list()).rejects.toBeInstanceOf(AuthenticationError);
    });

    it('403 → ForbiddenError', async () => {
      respondWithError('get', PATH, 403);
      await expect(client.mobile.invoices.list()).rejects.toBeInstanceOf(ForbiddenError);
    });

    it('404 INVOICE_NOT_FOUND → NotFoundError with code and transactionId', async () => {
      respondWithError('get', `${PATH}/9999`, 404, {
        transactionId: 'txn-fake-0001',
        status: 404,
        name: 'INVOICE_NOT_FOUND',
        message: 'Invoice not found',
      });
      const err = await client.mobile.invoices.downloadPdf(9999).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(NotFoundError);
      expect((err as NotFoundError).code).toBe('INVOICE_NOT_FOUND');
      expect((err as NotFoundError).transactionId).toBe('txn-fake-0001');
    });

    it('429 → RateLimitError', async () => {
      respondWithError('get', PATH, 429);
      await expect(client.mobile.invoices.list()).rejects.toBeInstanceOf(RateLimitError);
    });

    it('500 → ServerError', async () => {
      respondWithError('get', `${PATH}/6001`, 500);
      await expect(client.mobile.invoices.downloadPdf(6001)).rejects.toBeInstanceOf(ServerError);
    });
  });
});
