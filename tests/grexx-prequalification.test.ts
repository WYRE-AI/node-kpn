import { describe, expect, it } from 'vitest';

import {
  GrexxError,
  GrexxValidationError,
  PREQUALIFICATION_REQUEST_ELEMENT,
  buildPrequalificationRequest,
  parsePrequalificationResponse,
  parseXml,
  type PrequalificationInput,
} from '../src/index.js';
import { TOKEN_BODY, TOKEN_URL, installFetch, jsonResponse, makeGrexx, realtimeCalls, xmlResponse } from './grexx-fetch.js';

const PREP: PrequalificationInput = {
  zipCode: '9999ZZ',
  houseNumber: 1,
  hasBroadband: false,
  hasPhone: false,
  productTypeCode: 'FTTHTele',
};

describe('PrequalificationRequest_V2 builder', () => {
  it('emits the required XSD elements for the PREP example and omits the rest', () => {
    expect(buildPrequalificationRequest(PREP)).toBe(
      '<?xml version="1.0" encoding="utf-8"?>' +
        '<PrequalificationRequest_V2>' +
        '<ZipCode>9999ZZ</ZipCode>' +
        '<HouseNr>1</HouseNr>' +
        '<HasBroadband>false</HasBroadband>' +
        '<HasPhone>false</HasPhone>' +
        '<ProductTypeCode>FTTHTele</ProductTypeCode>' +
        '</PrequalificationRequest_V2>',
    );
  });

  it('emits optional elements and repeated supplier strings, escaped', () => {
    const xml = buildPrequalificationRequest({
      zipCode: ' 9999ZZ ',
      houseNumber: 1,
      houseNumberExtension: 'a&b<c>"\'',
      roomNumber: 'kamer 1',
      hasBroadband: true,
      hasPhone: false,
      orderId: 'OID42',
      phoneNumber: '020-123',
      productTypeCode: 'FIBER',
      referencePhoneNumber: '010111',
      serviceId: 'SVC1',
      suppliers: ['Kpn', 'Tele2Fiber'],
      israSpecs: 'spec & more',
      isComplexAddress: false,
    });
    expect(xml).toBe(
      '<?xml version="1.0" encoding="utf-8"?>' +
        `<${PREQUALIFICATION_REQUEST_ELEMENT}>` +
        '<ZipCode>9999ZZ</ZipCode>' +
        '<HouseNr>1</HouseNr>' +
        '<HouseNrExtension>a&amp;b&lt;c&gt;&quot;&apos;</HouseNrExtension>' +
        '<RoomNumber>kamer 1</RoomNumber>' +
        '<HasBroadband>true</HasBroadband>' +
        '<HasPhone>false</HasPhone>' +
        '<OrderId>OID42</OrderId>' +
        '<PhoneNumber>020-123</PhoneNumber>' +
        '<ProductTypeCode>FIBER</ProductTypeCode>' +
        '<ReferencePhoneNumber>010111</ReferencePhoneNumber>' +
        '<ServiceId>SVC1</ServiceId>' +
        '<Suppliers><string>Kpn</string><string>Tele2Fiber</string></Suppliers>' +
        '<IsraSpecs>spec &amp; more</IsraSpecs>' +
        '<IsComplexAddress>false</IsComplexAddress>' +
        `</${PREQUALIFICATION_REQUEST_ELEMENT}>`,
    );
    expect(xml).not.toContain('Envelope');
  });

  it('omits blank optional strings and an empty supplier list', () => {
    const xml = buildPrequalificationRequest({
      ...PREP,
      houseNumberExtension: '  ',
      roomNumber: '',
      orderId: '   ',
      phoneNumber: '',
      referencePhoneNumber: '',
      serviceId: '',
      suppliers: [],
      israSpecs: ' ',
    });
    expect(xml).toBe(buildPrequalificationRequest(PREP));
    expect(xml).not.toContain('HouseNrExtension');
    expect(xml).not.toContain('Suppliers');
    expect(xml).not.toContain('IsraSpecs');
    expect(xml).not.toContain('IsComplexAddress');
    expect(xml).not.toContain('ServiceId');
  });

  it('accepts HasBroadband when ServiceId or ReferencePhoneNumber is set', () => {
    expect(buildPrequalificationRequest({ ...PREP, hasBroadband: true, serviceId: ' SVC ' })).toContain(
      '<ServiceId>SVC</ServiceId>',
    );
    const byPhone = buildPrequalificationRequest({ ...PREP, hasBroadband: true, referencePhoneNumber: ' 010 ' });
    expect(byPhone).toContain('<ReferencePhoneNumber>010</ReferencePhoneNumber>');
    expect(byPhone).not.toContain('ServiceId');
  });

  it('rejects the HasBroadband rule, the OrderId pattern, and ProductTypeCode outside the XSD', () => {
    expect(() => buildPrequalificationRequest({ ...PREP, hasBroadband: true })).toThrow(GrexxValidationError);
    expect(() => buildPrequalificationRequest({ ...PREP, hasBroadband: true, serviceId: '  ' })).toThrow(
      /ServiceId or ReferencePhoneNumber/,
    );
    const broadband = (() => {
      try {
        buildPrequalificationRequest({ ...PREP, hasBroadband: true });
      } catch (err) {
        return err;
      }
      return undefined;
    })();
    expect(broadband).toBeInstanceOf(GrexxValidationError);
    expect((broadband as GrexxValidationError).code).toBe('broadband_reference_required');

    for (const orderId of ['OID', 'oid123', 'OID12A', 'ORDER1']) {
      expect(() => buildPrequalificationRequest({ ...PREP, orderId })).toThrow(/OID\[0-9\]\+/);
    }
    const order = (() => {
      try {
        buildPrequalificationRequest({ ...PREP, orderId: 'oid1' });
      } catch (err) {
        return err;
      }
      return undefined;
    })();
    expect((order as GrexxValidationError).code).toBe('invalid_order_id');
    expect(buildPrequalificationRequest({ ...PREP, orderId: ' OID0 ' })).toContain('<OrderId>OID0</OrderId>');

    expect(() => buildPrequalificationRequest({ ...PREP, productTypeCode: 'Fiber' as 'FIBER' })).toThrow(
      GrexxValidationError,
    );
    const product = (() => {
      try {
        buildPrequalificationRequest({ ...PREP, productTypeCode: 'ftth' as 'FIBER' });
      } catch (err) {
        return err;
      }
      return undefined;
    })();
    expect((product as GrexxValidationError).code).toBe('invalid_product_type');
    expect((product as GrexxValidationError).message).toContain('FIBER');

    expect(() => buildPrequalificationRequest({ ...PREP, suppliers: ['KPN' as 'Kpn'] })).toThrow(/Kpn/);
    expect(() => buildPrequalificationRequest({ ...PREP, zipCode: '   ' })).toThrow(/ZipCode/);
    expect(() => buildPrequalificationRequest({ ...PREP, houseNumber: 1.5 })).toThrow(/HouseNr/);
    expect(() => buildPrequalificationRequest({ ...PREP, houseNumber: 2_147_483_648 })).toThrow(/xs:int/);
    expect(buildPrequalificationRequest({ ...PREP, houseNumber: 0 })).toContain('<HouseNr>0</HouseNr>');
  });
});

describe('PrequalificationResponse_V1 parser', () => {
  it('reads address, products, nil values, and a success document', () => {
    const xml = `<?xml version="1.0" encoding="utf-8"?>
      <PrequalificationResponse_V1>
        <City>Amsterdam</City>
        <Extension>A</Extension>
        <HouseNumber>1</HouseNumber>
        <Street>Damrak</Street>
        <ZipCode>9999ZZ</ZipCode>
        <IsraSpecs><string>spec-a</string><string>a &amp; b</string></IsraSpecs>
        <ServiceId>SVC1</ServiceId>
        <FtuType>FTU_TY01</FtuType>
        <NlsType>6</NlsType>
        <LineType>Fiber</LineType>
        <Remarks><string>one</string></Remarks>
        <Products>
          <AvailabilityProduct_V1 xsi:nil="true"/>
          <AvailabilityProduct_V1>
            <ProductCode>FIBER</ProductCode>
            <Name>Fiber &amp; Co</Name>
            <Availability>Green</Availability>
            <DistributionType>FTTH</DistributionType>
            <IsVectoring xsi:nil="true"/>
            <TariffCluster>C1</TariffCluster>
          </AvailabilityProduct_V1>
          <AvailabilityProduct_V1>
            <Availability>Yellow</Availability>
            <IsVectoring>false</IsVectoring>
          </AvailabilityProduct_V1>
        </Products>
      </PrequalificationResponse_V1>`;
    const parsed = parsePrequalificationResponse({
      rawXml: xml,
      document: parseXml(xml),
      requestId: 'req-1',
      httpStatus: 200,
    });
    expect(parsed).toMatchObject({
      city: 'Amsterdam',
      extension: 'A',
      houseNumber: '1',
      street: 'Damrak',
      zipCode: '9999ZZ',
      israSpecs: ['spec-a', 'a & b'],
      serviceId: 'SVC1',
      ftuType: 'FTU_TY01',
      nlsType: 6,
      lineType: 'Fiber',
      remarks: ['one'],
      requestId: 'req-1',
      httpStatus: 200,
    });
    expect(parsed.errorClass).toBeUndefined();
    expect(parsed.errorMessage).toBeUndefined();
    expect(parsed.products).toHaveLength(2);
    expect(parsed.products[0]).toMatchObject({
      productCode: 'FIBER',
      name: 'Fiber & Co',
      availability: 'Green',
      distributionType: 'FTTH',
      isVectoring: null,
      tariffCluster: 'C1',
    });
    expect(parsed.products[1]).toMatchObject({ availability: 'Yellow', isVectoring: false });
    expect(parsed.products[1]?.productCode).toBeUndefined();
  });

  it('returns ErrorClass and ErrorMessage instead of throwing', () => {
    const parsed = parsePrequalificationResponse(`<?xml version="1.0" encoding="utf-8"?>
      <PrequalificationResponse_V1>
        <NlsType xsi:nil="true"/>
        <ErrorClass>Functional</ErrorClass>
        <ErrorMessage>no coverage &lt;here&gt;</ErrorMessage>
      </PrequalificationResponse_V1>`);
    expect(parsed.nlsType).toBeNull();
    expect(parsed.errorClass).toBe('Functional');
    expect(parsed.errorMessage).toBe('no coverage <here>');
    expect(parsed.products).toEqual([]);
    expect(parsed.remarks).toEqual([]);
    expect(parsed.israSpecs).toEqual([]);
    expect(parsed.httpStatus).toBe(0);
  });

  it('rejects a different root, a missing NlsType, and an availability outside the enum', () => {
    expect(() => parsePrequalificationResponse('<OtherResponse><NlsType>1</NlsType></OtherResponse>')).toThrow(
      /PrequalificationResponse_V1/,
    );
    expect(() => parsePrequalificationResponse('<PrequalificationResponse_V1><ZipCode>9999ZZ</ZipCode></PrequalificationResponse_V1>')).toThrow(
      /NlsType/,
    );
    expect(() =>
      parsePrequalificationResponse(
        '<PrequalificationResponse_V1><NlsType>1</NlsType><Products><AvailabilityProduct_V1><Availability>Blue</Availability></AvailabilityProduct_V1></Products></PrequalificationResponse_V1>',
      ),
    ).toThrow(/Availability/);
  });
});

const SUCCESS_XML = `<?xml version="1.0" encoding="utf-8"?>
<PrequalificationResponse_V1>
  <ZipCode>9999ZZ</ZipCode>
  <NlsType>2</NlsType>
  <Products>
    <AvailabilityProduct_V1>
      <Availability>Green</Availability>
      <IsVectoring>1</IsVectoring>
    </AvailabilityProduct_V1>
  </Products>
</PrequalificationResponse_V1>`;

describe('GrexxClient.prequalification', () => {
  it('POSTs plain XML to /realtime with a Bearer token and parses the response', async () => {
    const calls = installFetch((call) => (call.url === TOKEN_URL ? jsonResponse(TOKEN_BODY) : xmlResponse(SUCCESS_XML, 200, { 'x-request-id': 'pq-1' })));
    const result = await makeGrexx({ username: 'prequal-user' }).prequalification(PREP);
    const realtime = realtimeCalls(calls)[0]!;
    expect(realtime.method).toBe('POST');
    expect(realtime.url).toMatch(/\/realtime$/);
    expect(realtime.headers.get('authorization')).toBe('Bearer test-access-token');
    expect(realtime.headers.get('content-type')).toContain('text/xml');
    expect(realtime.body).toBe(buildPrequalificationRequest(PREP));
    expect(realtime.body).not.toContain('Envelope');
    expect(realtime.redirect).toBe('error');
    expect(result.nlsType).toBe(2);
    expect(result.products[0]).toMatchObject({ availability: 'Green', isVectoring: true });
    expect(result.requestId).toBe('pq-1');
    expect(result.httpStatus).toBe(200);
  });

  it('returns a response ErrorClass from HTTP 200 instead of throwing', async () => {
    installFetch((call) =>
      call.url === TOKEN_URL
        ? jsonResponse(TOKEN_BODY)
        : xmlResponse(
            '<PrequalificationResponse_V1><NlsType xsi:nil="true"/><ErrorClass>Technical</ErrorClass><ErrorMessage>down</ErrorMessage></PrequalificationResponse_V1>',
          ),
    );
    const result = await makeGrexx({ username: 'prequal-error-user' }).prequalification(PREP);
    expect(result.errorClass).toBe('Technical');
    expect(result.errorMessage).toBe('down');
    expect(result.nlsType).toBeNull();
  });

  it('retries HTTP 502 because the read opts in', async () => {
    let hits = 0;
    installFetch((call) => {
      if (call.url === TOKEN_URL) return jsonResponse(TOKEN_BODY);
      hits += 1;
      if (hits === 1) return xmlResponse('<PrequalificationResponse_V1><NlsType xsi:nil="true"/></PrequalificationResponse_V1>', 502);
      return xmlResponse(SUCCESS_XML);
    });
    const result = await makeGrexx({ username: 'prequal-retry-user', maxRetries: 1 }).prequalification(PREP);
    expect(result.nlsType).toBe(2);
    expect(hits).toBe(2);
  });

  it('rejects a different realtime root', async () => {
    installFetch((call) =>
      call.url === TOKEN_URL ? jsonResponse(TOKEN_BODY) : xmlResponse('<ZipCodeCheckResponse_V5><Status><Code>Success</Code></Status></ZipCodeCheckResponse_V5>'),
    );
    const err = await makeGrexx({ username: 'prequal-root-user' })
      .prequalification(PREP)
      .catch((error: unknown) => error);
    expect(err).toBeInstanceOf(GrexxError);
    expect((err as GrexxError).message).toContain('PrequalificationResponse_V1');
  });
});
