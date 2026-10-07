import { describe, expect, it } from 'vitest';

import {
  GrexxError,
  PHASE1_RESPONSE_ROOTS,
  PHASE1_ROOTS,
  buildAvailablePortingsRequest,
  buildCarrierInfoRequest,
  buildCustomerDataRequest,
  buildGetMobileSettingsRequest,
  buildGetMobileSubscriptionOrdersRequest,
  buildGetMobileSubscriptionUsageRequest,
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
  parseOrderSummaryResponse,
  parseZipCodeCheckResponse,
  resolveRequestBody,
} from '../src/index.js';

const zip = {
  Portfolio: 'Business' as const,
  ZipCode: '1122AB',
  HouseNr: 10,
  IsRoomNumberKnown: false,
};

describe('request XML from the XSDs', () => {
  it('builds ZipCodeCheckRequest_V6 with HouseNr and a Suppliers/string list', () => {
    const xml = buildZipCodeCheckRequest({
      ...zip,
      ZipCode: `12&<>"'`,
      HouseNrExtension: 'a',
      Suppliers: ['KPN', 'Eurofiber'],
    });
    expect(xml).toBe(
      '<?xml version="1.0" encoding="UTF-8"?>\n' +
        '<ZipCodeCheckRequest_V6>' +
        '<Portfolio>Business</Portfolio>' +
        '<ZipCode>12&amp;&lt;&gt;&quot;&apos;</ZipCode>' +
        '<HouseNr>10</HouseNr>' +
        '<HouseNrExtension>a</HouseNrExtension>' +
        '<IsRoomNumberKnown>false</IsRoomNumberKnown>' +
        '<Suppliers><string>KPN</string><string>Eurofiber</string></Suppliers>' +
        '</ZipCodeCheckRequest_V6>'
    );
    expect(PHASE1_ROOTS.ZipCodeCheckRequest).toBe('ZipCodeCheckRequest_V6');
    expect(PHASE1_RESPONSE_ROOTS.ZipCodeCheckResponse).toBe('ZipCodeCheckResponse_V5');
  });

  it('emits order summary filters and the misspelled porting id', () => {
    const summary = buildOrderSummaryRequest({
      CustomerId: 1044080,
      OrderState: 'Active',
      ProductGroup: 'Mobile',
      Skip: 2500,
    });
    expect(summary).toContain(
      '<OrderSummaryRequest_V1><CustomerId>1044080</CustomerId><OrderState>Active</OrderState><ProductGroup>Mobile</ProductGroup><Skip>2500</Skip></OrderSummaryRequest_V1>'
    );
    const porting = buildAvailablePortingsRequest({ MobileSubscripionCustomerId: 99 });
    expect(porting).toContain('<MobileSubscripionCustomerId>99</MobileSubscripionCustomerId>');
    expect(porting).not.toContain('MobileSubscriptionCustomerId');
  });

  it('wraps mobile order ids and does not emit a GetSimCard request', () => {
    const orders = buildGetMobileSubscriptionOrdersRequest({ OrderIds: [1, 2] });
    expect(orders).toContain('<OrderIds><OrderId>1</OrderId><OrderId>2</OrderId></OrderIds>');
    expect(buildGetSimRequest({ OrderId: 7 })).toContain('<GetSimRequest_V1><OrderId>7</OrderId></GetSimRequest_V1>');
    expect(PHASE1_ROOTS).not.toHaveProperty('GetSimCardRequest');
  });

  it('emits every Phase 1 root element', () => {
    const built = [
      buildZipCodeCheckRequest(zip),
      buildPrequalificationRequest({
        ZipCode: '9999ZZ',
        HouseNr: 1,
        HasBroadband: true,
        HasPhone: false,
        ProductTypeCode: 'FTTHTele',
        ServiceId: 'ABC',
      }),
      buildCarrierInfoRequest({ ProductType: 'xDSL', ZipCode: '1122AB', HouseNumber: 10 }),
      buildRadiusCheckRequest({ OrderId: 1 }),
      buildRasCheckRequest({ OrderId: 1 }),
      buildStartLineDiagnoseRequest({ OrderId: 1, SymptomCode: 'Sym103' }),
      buildCustomerDataRequest({ Id: 1 }),
      buildOrderSummaryRequest({ CustomerId: 1 }),
      buildOrderDataRequest({ OrderId: 1 }),
      buildGetSimRequest({ OrderId: 1 }),
      buildGetMobileSettingsRequest({ OrderId: 1 }),
      buildGetMobileSubscriptionUsageRequest({ OrderId: 1 }),
      buildGetMobileSubscriptionOrdersRequest({ OrderIds: [1] }),
      buildAvailablePortingsRequest({ HipGroupOrderId: 1 }),
    ];
    expect(built).toHaveLength(Object.values(PHASE1_ROOTS).length);
    for (const root of Object.values(PHASE1_ROOTS)) {
      expect(built.some((xml) => xml.includes(`<${root}>`))).toBe(true);
    }
  });

  it('rejects XSD violations before a request is sent', () => {
    expect(buildCustomerDataRequest()).toContain('<CustomerDataRequest_V1/>');
    expect(() => buildZipCodeCheckRequest({ ...zip, ZipCode: ' ' })).toThrow(/ZipCode is required/);
    expect(() =>
      buildPrequalificationRequest({
        ZipCode: '9999ZZ',
        HouseNr: 1,
        HasBroadband: true,
        HasPhone: false,
        ProductTypeCode: 'FTTHTele',
      })
    ).toThrow(/ServiceId or ReferencePhoneNumber/);
    expect(() => buildCarrierInfoRequest({ ProductType: 'xDSL', ZipCode: '1122', HouseNumber: 10 })).toThrow(/ZipCode/);
    expect(() => buildGetMobileSubscriptionOrdersRequest({ OrderIds: [] })).toThrow(/1 to 50/);
    expect(() => buildRadiusCheckRequest({ OrderId: 1.5 })).toThrow(/integer/);
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
  it('projects ZipCodeCheckResponse_V5, including a repeated supplier list', () => {
    const parsed = parseZipCodeCheckResponse(`<?xml version="1.0" encoding="utf-8"?>
      <ZipCodeCheckResponse_V5>
        <Status><Code>Success</Code><Messages><string>ok</string></Messages></Status>
        <AvailableSuppliers>
          <AvailableSupplier_V5>
            <Name>KPN</Name>
            <AvailableSpeeds>
              <AvailableSpeed_V4><Technology>Fiber</Technology><NlsType>Nls6</NlsType></AvailableSpeed_V4>
              <AvailableSpeed_V4><Technology>VDSL</Technology><NlsType xsi:nil="true"/></AvailableSpeed_V4>
            </AvailableSpeeds>
          </AvailableSupplier_V5>
        </AvailableSuppliers>
      </ZipCodeCheckResponse_V5>`);
    expect(parsed.rootElement).toBe('ZipCodeCheckResponse_V5');
    expect(parsed.grexxCode).toBeUndefined();
    expect(parsed.data?.Status).toEqual({ Code: 'Success', Messages: ['ok'] });
    expect(parsed.data?.AvailableSuppliers?.[0]?.AvailableSpeeds?.map((speed) => speed.Technology)).toEqual([
      'Fiber',
      'VDSL',
    ]);
    expect(parsed.data?.AvailableSuppliers?.[0]?.AvailableSpeeds?.[1]?.NlsType).toBeUndefined();
  });

  it('maps gateway code 109 on an error envelope without inventing IRMA data', () => {
    const parsed = parseZipCodeCheckResponse('<Error><Code>109</Code><Message>XML validation error</Message></Error>');
    expect(parsed.grexxCode).toBe(109);
    expect(parsed.data).toBeUndefined();
    expect(parsed.message).toBe('XML validation error');
  });

  it('maps code 68 and order status 204 without treating 204 as a gateway failure', () => {
    const failure = parseGrexxResponse('<Response><Code>68</Code></Response>');
    expect(failure.grexxCode).toBe(68);
    expect(failure.grexxCodeMessage).toBe('Error');

    const order = parseOrderDataResponse(`<OrderDataResponse_V1>
      <ResultCode>0</ResultCode>
      <Status><Code>Success</Code></Status>
      <Order><CustomerId>7</CustomerId><ProductCode>FIBER</ProductCode><Quantity>1</Quantity><Status>204</Status></Order>
    </OrderDataResponse_V1>`);
    expect(order.grexxCode).toBe(0);
    expect(order.data?.Order).toEqual({ CustomerId: 7, ProductCode: 'FIBER', Quantity: 1 });
    expect(order.orderStatus).toEqual({
      code: 204,
      meaning: 'Accepted',
      detail: 'Order Placed — new order successfully created',
    });
  });

  it('keeps order summary responses as generic XML', () => {
    const parsed = parseOrderSummaryResponse('<OrderSummaryResponse_V1><Skip>20</Skip><OrderId>9</OrderId></OrderSummaryResponse_V1>');
    expect(parsed.data).toEqual({ Skip: '20', OrderId: '9' });
  });

  it('maps the Active label to order status 201', () => {
    const parsed = parseGrexxResponse('<OrderDataResponse_V1><Status>Active</Status></OrderDataResponse_V1>');
    expect(parsed.orderStatus?.code).toBe(201);
    expect(parsed.orderStatus?.meaning).toBe('Active');
    expect(parsed.grexxCode).toBeUndefined();
  });

  it('decodes entities and rejects a mismatched response family', () => {
    const parsed = parseGrexxResponse('<ZipCodeCheckResponse_V5><ZipCode>A&amp;B</ZipCode></ZipCodeCheckResponse_V5>');
    expect(parsed.body['ZipCode']).toBe('A&B');
    expect(() => parseGetSimResponse('<CarrierInfoResponse_V1><ProductType>xDSL</ProductType></CarrierInfoResponse_V1>')).toThrow(
      GrexxError
    );
  });

  it('rejects DTD declarations', () => {
    expect(() => parseGrexxResponse('<!DOCTYPE foo [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><Foo>&xxe;</Foo>')).toThrow(
      /DTD/
    );
  });
});
