import { describe, expect, it } from 'vitest';

import {
  GrexxError,
  PHASE1_ROOTS,
  buildAvailablePortingsRequest,
  buildCarrierInfoRequest,
  buildCustomerDataRequest,
  buildGetMobileSettingsRequest,
  buildGetMobileSubscriptionOrdersRequest,
  buildGetMobileSubscriptionUsageRequest,
  buildGetSimCardRequest,
  buildGetSimRequest,
  buildOrderDataRequest,
  buildOrderSummaryRequest,
  buildPrequalificationRequest,
  buildRadiusCheckRequest,
  buildRasCheckRequest,
  buildStartLineDiagnoseRequest,
  buildZipCodeCheckRequest,
  parseGetSimResponse,
  parseGrexxResponse,
  parseOrderDataResponse,
  parseZipCodeCheckResponse,
  resolveRequestBody,
} from '../src/index.js';

describe('request XML', () => {
  it('builds ZipCodeCheckRequest_V6 and escapes text', () => {
    const xml = buildZipCodeCheckRequest({
      ZipCode: `12&<>"'`,
      HouseNumber: 10,
      HouseNumberExtension: 'A',
    });
    expect(xml).toBe(
      '<?xml version="1.0" encoding="UTF-8"?>\n' +
        '<ZipCodeCheckRequest_V6>' +
        '<ZipCode>12&amp;&lt;&gt;&quot;&apos;</ZipCode>' +
        '<HouseNumber>10</HouseNumber>' +
        '<HouseNumberExtension>A</HouseNumberExtension>' +
        '</ZipCodeCheckRequest_V6>'
    );
    expect(PHASE1_ROOTS.ZipCodeCheckRequest).toBe('ZipCodeCheckRequest_V6');
  });

  it('emits extra elements and the inventory skip field', () => {
    const xml = buildOrderSummaryRequest({
      CustomerId: '1044080',
      Skip: 2500,
      extra: { Portfolio: 'Mobile' },
    });
    expect(xml).toContain('<OrderSummaryRequest_V1><CustomerId>1044080</CustomerId><Skip>2500</Skip><Portfolio>Mobile</Portfolio></OrderSummaryRequest_V1>');
  });

  it('emits the misspelled porting id when that is what the caller set', () => {
    const xml = buildAvailablePortingsRequest({ MobileSubscripionCustomerId: '99' });
    expect(xml).toContain('<MobileSubscripionCustomerId>99</MobileSubscripionCustomerId>');
    expect(xml).not.toContain('MobileSubscriptionCustomerId');
  });

  it('repeats OrderId elements and distinguishes the two SIM roots', () => {
    const orders = buildGetMobileSubscriptionOrdersRequest({ OrderId: ['1', '2'] });
    expect(orders).toContain('<OrderId>1</OrderId><OrderId>2</OrderId>');
    expect(buildGetSimRequest({ OrderId: '7' })).toContain('<GetSimRequest_V1>');
    expect(buildGetSimCardRequest({ Msisdn: '31600000000' })).toContain('<GetSimCardRequest_V1>');
  });

  it('emits every Phase 1 root element', () => {
    const location = { ZipCode: '1234AB', HouseNumber: 1 };
    const built = [
      buildZipCodeCheckRequest(location),
      buildPrequalificationRequest({ ...location, AccessType: 'Fiber' }),
      buildCarrierInfoRequest(location),
      buildRadiusCheckRequest({ Username: 'cpe' }),
      buildRasCheckRequest({ OrderId: '1' }),
      buildStartLineDiagnoseRequest({ OrderId: '1' }),
      buildCustomerDataRequest({ CustomerId: '1' }),
      buildOrderSummaryRequest({ CustomerId: '1' }),
      buildOrderDataRequest({ OrderId: '1' }),
      buildGetSimRequest({ OrderId: '1' }),
      buildGetSimCardRequest({ OrderId: '1' }),
      buildGetMobileSettingsRequest({ Msisdn: '31600000000' }),
      buildGetMobileSubscriptionUsageRequest({ Msisdn: '31600000000' }),
      buildGetMobileSubscriptionOrdersRequest({ CustomerId: '1' }),
      buildAvailablePortingsRequest({ HipGroupOrderId: '1' }),
    ];
    const roots = Object.values(PHASE1_ROOTS);
    expect(built).toHaveLength(roots.length);
    for (const root of roots) {
      expect(built.some((xml) => xml.includes(`<${root}>`))).toBe(true);
    }
    expect(() => buildRadiusCheckRequest({})).toThrow(/Username/);
  });

  it('allows an empty customer-data request and rejects a blank zip code', () => {
    expect(buildCustomerDataRequest()).toContain('<CustomerDataRequest_V1/>');
    expect(() => buildZipCodeCheckRequest({ ZipCode: ' ', HouseNumber: 1 })).toThrow(/ZipCode is required/);
  });

  it('wraps a fragment and rejects a document with the wrong root', () => {
    expect(resolveRequestBody('ZipCodeCheckRequest_V6', '<ZipCode>1234AB</ZipCode>')).toContain(
      '<ZipCodeCheckRequest_V6><ZipCode>1234AB</ZipCode></ZipCodeCheckRequest_V6>'
    );
    expect(() => resolveRequestBody('ZipCodeCheckRequest_V6', '<?xml version="1.0"?><Other/>')).toThrow(
      /does not match ZipCodeCheckRequest_V6/
    );
  });
});

describe('response XML', () => {
  it('maps code 0, repeated elements, and nested address fields', () => {
    const parsed = parseZipCodeCheckResponse(`<?xml version="1.0" encoding="utf-8"?>
      <ZipCodeCheckResponse_V6>
        <ResultCode>0</ResultCode>
        <ResultMessage>Success</ResultMessage>
        <Address><ZipCode>1234AB</ZipCode><HouseNumber>10</HouseNumber></Address>
        <Product><Name>Fiber</Name></Product>
        <Product><Name>VDSL</Name></Product>
      </ZipCodeCheckResponse_V6>`);
    expect(parsed.grexxCode).toBe(0);
    expect(parsed.grexxCodeMessage).toBe('Success');
    expect(parsed.message).toBe('Success');
    expect(parsed.body['Address']).toEqual({ ZipCode: '1234AB', HouseNumber: '10' });
    expect(parsed.body['Product']).toEqual([{ Name: 'Fiber' }, { Name: 'VDSL' }]);
  });

  it('maps gateway code 109 on an error envelope', () => {
    const parsed = parseGrexxResponse(
      '<Error><Code>109</Code><Message>XML validation error</Message></Error>'
    );
    expect(parsed.grexxCode).toBe(109);
    expect(parsed.grexxCodeMessage).toBe('XML validation error');
    expect(parsed.message).toBe('XML validation error');
  });

  it('maps code 68 and order status 204 without treating 204 as a gateway failure', () => {
    const failure = parseGrexxResponse('<Response><Code>68</Code></Response>');
    expect(failure.grexxCode).toBe(68);
    expect(failure.grexxCodeMessage).toBe('Error');

    const order = parseOrderDataResponse(`<OrderDataResponse_V1>
      <ResultCode>0</ResultCode>
      <Order><OrderId>99</OrderId><Status>204</Status></Order>
    </OrderDataResponse_V1>`);
    expect(order.grexxCode).toBe(0);
    expect(order.orderStatus).toEqual({
      code: 204,
      meaning: 'Accepted',
      detail: 'Order Placed — new order successfully created',
    });
  });

  it('maps the Active label to order status 201', () => {
    const parsed = parseGrexxResponse('<OrderDataResponse_V1><Status>Active</Status></OrderDataResponse_V1>');
    expect(parsed.orderStatus?.code).toBe(201);
    expect(parsed.orderStatus?.meaning).toBe('Active');
    expect(parsed.grexxCode).toBeUndefined();
  });

  it('decodes entities and rejects a mismatched response family', () => {
    const parsed = parseGrexxResponse('<ZipCodeCheckResponse_V6><ZipCode>A&amp;B</ZipCode></ZipCodeCheckResponse_V6>');
    expect(parsed.body['ZipCode']).toBe('A&B');
    expect(() => parseGetSimResponse('<GetSimCardResponse_V1><Msisdn>1</Msisdn></GetSimCardResponse_V1>')).toThrow(
      GrexxError
    );
  });

  it('rejects DTD declarations', () => {
    expect(() => parseGrexxResponse('<!DOCTYPE foo [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><Foo>&xxe;</Foo>')).toThrow(
      /DTD/
    );
  });
});
