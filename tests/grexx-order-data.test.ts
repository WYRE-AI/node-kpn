import { describe, expect, it } from 'vitest';

import {
  GrexxServerError,
  GrexxValidationError,
  ORDER_DATA_REQUEST_ELEMENT,
  buildOrderDataRequest,
  parseOrderDataResponse,
  parseXml,
} from '../src/index.js';
import { TOKEN_BODY, TOKEN_URL, installFetch, jsonResponse, makeGrexx, realtimeCalls, xmlResponse } from './grexx-fetch.js';

describe('OrderDataRequest_V1 builder', () => {
  it('emits OrderId and no other elements', () => {
    const xml = buildOrderDataRequest({ orderId: 42 });
    expect(xml).toBe(
      '<?xml version="1.0" encoding="utf-8"?>' +
        `<${ORDER_DATA_REQUEST_ELEMENT}>` +
        '<OrderId>42</OrderId>' +
        `</${ORDER_DATA_REQUEST_ELEMENT}>`,
    );
    expect(xml).not.toContain('Envelope');
    expect(buildOrderDataRequest({ orderId: -2_147_483_648 })).toContain('<OrderId>-2147483648</OrderId>');
    expect(buildOrderDataRequest({ orderId: 2_147_483_647 })).toContain('<OrderId>2147483647</OrderId>');
  });

  it('rejects values outside xs:int', () => {
    expect(() => buildOrderDataRequest({ orderId: 1.5 })).toThrow(GrexxValidationError);
    expect(() => buildOrderDataRequest({ orderId: 2_147_483_648 })).toThrow(/xs:int/);
    expect(() => buildOrderDataRequest({ orderId: -2_147_483_649 })).toThrow(/xs:int/);
    const err = (() => {
      try {
        buildOrderDataRequest({ orderId: Number.NaN });
      } catch (error) {
        return error;
      }
      return undefined;
    })();
    expect(err).toBeInstanceOf(GrexxValidationError);
    expect((err as GrexxValidationError).code).toBe('invalid_order_id');
  });
});

describe('OrderDataResponse_V1 parser', () => {
  it('reads a success status and the order', () => {
    const xml = `<?xml version="1.0" encoding="utf-8"?>
      <OrderDataResponse_V1>
        <Status>
          <Messages><string>accepted</string><string>line &amp; port</string></Messages>
          <Code>Success</Code>
        </Status>
        <Order>
          <CustomerId>100</CustomerId>
          <ProductCode>FTTH&amp;1</ProductCode>
          <Quantity>2</Quantity>
        </Order>
      </OrderDataResponse_V1>`;
    const parsed = parseOrderDataResponse({
      rawXml: xml,
      document: parseXml(xml),
      requestId: 'od-1',
      httpStatus: 200,
    });
    expect(parsed.status).toEqual({ code: 'Success', messages: ['accepted', 'line & port'] });
    expect(parsed.order).toEqual({ customerId: 100, productCode: 'FTTH&1', quantity: 2 });
    expect(parsed.requestId).toBe('od-1');
    expect(parsed.httpStatus).toBe(200);
    expect(parsed.rawXml).toBe(xml);
  });

  it('returns ValidationError as a typed status and omits a missing order', () => {
    const parsed = parseOrderDataResponse(`<?xml version="1.0" encoding="utf-8"?>
      <OrderDataResponse_V1>
        <Status>
          <Messages><string>OrderId is unknown</string></Messages>
          <Code>ValidationError</Code>
        </Status>
      </OrderDataResponse_V1>`);
    expect(parsed.status).toEqual({ code: 'ValidationError', messages: ['OrderId is unknown'] });
    expect(parsed.order).toBeUndefined();
    expect(parsed.httpStatus).toBe(0);
  });

  it('returns UnknownError as a typed status', () => {
    const parsed = parseOrderDataResponse(
      '<OrderDataResponse_V1><Status><Code>UnknownError</Code></Status></OrderDataResponse_V1>',
    );
    expect(parsed.status.code).toBe('UnknownError');
    expect(parsed.status.messages).toEqual([]);
    expect(parsed.order).toBeUndefined();
  });

  it('rejects a different root, a missing status, a code outside the enum, and an over-long product code', () => {
    expect(() => parseOrderDataResponse('<OtherResponse><Status><Code>Success</Code></Status></OtherResponse>')).toThrow(
      /OrderDataResponse_V1/,
    );
    expect(() => parseOrderDataResponse('<OrderDataResponse_V1></OrderDataResponse_V1>')).toThrow(/Status/);
    expect(() => parseOrderDataResponse('<OrderDataResponse_V1><Status><Code>108</Code></Status></OrderDataResponse_V1>')).toThrow(
      /Success/,
    );
    expect(() =>
      parseOrderDataResponse(
        '<OrderDataResponse_V1><Status><Code>Success</Code></Status><Order><CustomerId>1</CustomerId><ProductCode>ABCDEFGHIJKLMN</ProductCode><Quantity>1</Quantity></Order></OrderDataResponse_V1>',
      ),
    ).toThrow(/1 to 13/);
    const ok = parseOrderDataResponse(
      '<OrderDataResponse_V1><Status><Code>Success</Code></Status><Order><CustomerId>1</CustomerId><ProductCode>ABCDEFGHIJKLM</ProductCode><Quantity>0</Quantity></Order></OrderDataResponse_V1>',
    );
    expect(ok.order).toEqual({ customerId: 1, productCode: 'ABCDEFGHIJKLM', quantity: 0 });
  });
});

const SUCCESS_XML = `<?xml version="1.0" encoding="utf-8"?>
<OrderDataResponse_V1>
  <Status><Code>Success</Code></Status>
  <Order>
    <CustomerId>7</CustomerId>
    <ProductCode>SDSL</ProductCode>
    <Quantity>1</Quantity>
  </Order>
</OrderDataResponse_V1>`;

describe('GrexxClient.orderData', () => {
  it('POSTs plain XML to /realtime with a Bearer token and parses Success', async () => {
    const calls = installFetch((call) => (call.url === TOKEN_URL ? jsonResponse(TOKEN_BODY) : xmlResponse(SUCCESS_XML, 200, { 'x-request-id': 'od-req' })));
    const result = await makeGrexx({ username: 'order-data-user' }).orderData({ orderId: 42 });
    const realtime = realtimeCalls(calls)[0]!;
    expect(realtime.method).toBe('POST');
    expect(realtime.headers.get('authorization')).toBe('Bearer test-access-token');
    expect(realtime.headers.get('content-type')).toContain('text/xml');
    expect(realtime.body).toBe(buildOrderDataRequest({ orderId: 42 }));
    expect(realtime.body).not.toContain('Envelope');
    expect(result.status.code).toBe('Success');
    expect(result.order).toEqual({ customerId: 7, productCode: 'SDSL', quantity: 1 });
    expect(result.requestId).toBe('od-req');
  });

  it('throws ValidationError through the realtime mapping and does not retry it', async () => {
    const calls = installFetch((call) =>
      call.url === TOKEN_URL
        ? jsonResponse(TOKEN_BODY)
        : xmlResponse(
            '<OrderDataResponse_V1><Status><Messages><string>OrderId is unknown</string></Messages><Code>ValidationError</Code></Status></OrderDataResponse_V1>',
          ),
    );
    const err = await makeGrexx({ username: 'order-data-validation-user', maxRetries: 3 })
      .orderData({ orderId: 9 })
      .catch((error: unknown) => error);
    expect(err).toBeInstanceOf(GrexxValidationError);
    expect((err as GrexxValidationError).code).toBe('ValidationError');
    expect((err as GrexxValidationError).message).toContain('OrderId is unknown');
    expect(realtimeCalls(calls)).toHaveLength(1);
  });

  it('throws UnknownError on HTTP 200 and does not retry it', async () => {
    const calls = installFetch((call) =>
      call.url === TOKEN_URL
        ? jsonResponse(TOKEN_BODY)
        : xmlResponse('<OrderDataResponse_V1><Status><Code>UnknownError</Code></Status></OrderDataResponse_V1>'),
    );
    const err = await makeGrexx({ username: 'order-data-unknown-user', maxRetries: 3 })
      .orderData({ orderId: 9 })
      .catch((error: unknown) => error);
    expect(err).toBeInstanceOf(GrexxServerError);
    expect((err as GrexxServerError).code).toBe('UnknownError');
    expect(realtimeCalls(calls)).toHaveLength(1);
  });

  it('retries HTTP 502 because the read opts in', async () => {
    let hits = 0;
    installFetch((call) => {
      if (call.url === TOKEN_URL) return jsonResponse(TOKEN_BODY);
      hits += 1;
      if (hits === 1) return xmlResponse('<OrderDataResponse_V1><Status><Code>UnknownError</Code></Status></OrderDataResponse_V1>', 502);
      return xmlResponse(SUCCESS_XML);
    });
    const result = await makeGrexx({ username: 'order-data-retry-user', maxRetries: 1 }).orderData({ orderId: 42 });
    expect(result.status.code).toBe('Success');
    expect(hits).toBe(2);
  });
});
