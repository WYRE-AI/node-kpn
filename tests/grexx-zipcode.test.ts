import { describe, expect, it } from 'vitest';

import {
  GrexxError,
  GrexxValidationError,
  ZIP_CODE_CHECK_REQUEST_ELEMENT,
  buildZipCodeCheckRequest,
  parseXml,
  parseZipCodeCheckResponse,
  renderRealtimeBody,
} from '../src/index.js';

describe('ZipCodeCheckRequest_V6 builder', () => {
  it('emits the XSD elements for the acceptatie smoke request', () => {
    expect(
      buildZipCodeCheckRequest({
        portfolio: 'All',
        zipCode: '1012 js',
        houseNumber: 1,
        isRoomNumberKnown: false,
        suppliers: [],
      }),
    ).toBe(
      '<?xml version="1.0" encoding="utf-8"?>' +
        '<ZipCodeCheckRequest_V6>' +
        '<Portfolio>All</Portfolio>' +
        '<ZipCode>1012JS</ZipCode>' +
        '<HouseNr>1</HouseNr>' +
        '<IsRoomNumberKnown>false</IsRoomNumberKnown>' +
        '</ZipCodeCheckRequest_V6>',
    );
  });

  it('emits optional elements and repeated supplier strings, escaped', () => {
    const xml = buildZipCodeCheckRequest({
      portfolio: 'Business',
      zipCode: '1122AB',
      houseNumber: 10,
      houseNumberExtension: 'a&b<c>"\'',
      serviceId: 'ABC1234567890',
      roomNumber: 'kamer 1',
      isRoomNumberKnown: true,
      suppliers: ['KPN', 'Tele2Fiber'],
    });
    expect(xml).toContain('<HouseNrExtension>a&amp;b&lt;c&gt;&quot;&apos;</HouseNrExtension>');
    expect(xml).toContain('<ServiceId>ABC1234567890</ServiceId>');
    expect(xml).toContain('<RoomNumber>kamer 1</RoomNumber>');
    expect(xml).toContain('<Suppliers><string>KPN</string><string>Tele2Fiber</string></Suppliers>');
    expect(xml.startsWith(`<?xml version="1.0" encoding="utf-8"?><${ZIP_CODE_CHECK_REQUEST_ELEMENT}>`)).toBe(true);
  });

  it('rejects portfolio, postcode, house number, and supplier values outside the XSD', () => {
    const base = { portfolio: 'All' as const, zipCode: '1012JS', houseNumber: 1, isRoomNumberKnown: false };
    expect(() => buildZipCodeCheckRequest({ ...base, portfolio: 'all' as 'All' })).toThrow(GrexxValidationError);
    expect(() => buildZipCodeCheckRequest({ ...base, zipCode: '0123AB' })).toThrow(GrexxValidationError);
    expect(() => buildZipCodeCheckRequest({ ...base, houseNumber: 1.5 })).toThrow(GrexxValidationError);
    expect(() => buildZipCodeCheckRequest({ ...base, suppliers: ['Odido' as 'KPN'] })).toThrow(/Tele2/);
  });

  it('wraps a fragment and keeps a document that already has the root element', () => {
    expect(renderRealtimeBody('ZipCodeCheckRequest_V6', '<Portfolio>All</Portfolio>')).toBe(
      '<?xml version="1.0" encoding="utf-8"?><ZipCodeCheckRequest_V6><Portfolio>All</Portfolio></ZipCodeCheckRequest_V6>',
    );
    const built = buildZipCodeCheckRequest({
      portfolio: 'SMB',
      zipCode: '1012JS',
      houseNumber: 2,
      isRoomNumberKnown: false,
    });
    expect(renderRealtimeBody('ZipCodeCheckRequest_V6', built)).toBe(built);
  });

  it('rejects DTD declarations', () => {
    expect(() => renderRealtimeBody('ZipCodeCheckRequest_V6', '<!DOCTYPE foo [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><ZipCodeCheckRequest_V6/>')).toThrow(
      GrexxValidationError,
    );
    expect(() => parseXml('<!DOCTYPE foo><ZipCodeCheckRequest_V6/>')).toThrow(GrexxError);
  });
});

describe('ZipCodeCheckResponse_V5 parser', () => {
  it('reads suppliers, speeds, copper-off, action required, and nil values', () => {
    const parsed = parseZipCodeCheckResponse(`<?xml version="1.0" encoding="utf-8"?>
      <ZipCodeCheckResponse_V5>
        <Status>
          <Messages><string>one</string><string>two &amp; three</string></Messages>
          <Code>Success</Code>
        </Status>
        <AvailableSuppliers>
          <AvailableSupplier_V5 xsi:nil="true"/>
          <AvailableSupplier_V5>
            <Name>KPN</Name>
            <LocationInfo>1012JS</LocationInfo>
            <AvailableSpeeds>
              <AvailableSpeed_V4>
                <Description>xDSL</Description>
                <NlsType xsi:nil="true"/>
                <Technology>VDSL</Technology>
                <PlanDate>2026-11-01T00:00:00</PlanDate>
              </AvailableSpeed_V4>
            </AvailableSpeeds>
            <CopperOff>
              <EndOfSaleDate>2026-12-01T00:00:00</EndOfSaleDate>
              <EndOfLifeDate>2027-01-01T00:00:00</EndOfLifeDate>
            </CopperOff>
            <ActionRequired>
              <ActionText>check</ActionText>
              <ActionUri>https://example.test/action</ActionUri>
            </ActionRequired>
          </AvailableSupplier_V5>
        </AvailableSuppliers>
      </ZipCodeCheckResponse_V5>`);
    expect(parsed.code).toBe('Success');
    expect(parsed.messages).toEqual(['one', 'two & three']);
    expect(parsed.suppliers).toHaveLength(1);
    expect(parsed.suppliers[0]).toMatchObject({
      name: 'KPN',
      locationInfo: '1012JS',
      speeds: [{ description: 'xDSL', technology: 'VDSL', planDate: '2026-11-01T00:00:00', remarks: [] }],
      copperOff: { endOfSaleDate: '2026-12-01T00:00:00', endOfLifeDate: '2027-01-01T00:00:00' },
      actionRequired: { actionText: 'check', actionUri: 'https://example.test/action' },
    });
    expect(parsed.suppliers[0]?.speeds[0]?.nlsType).toBeUndefined();
  });

  it('rejects a different response root', () => {
    expect(() => parseZipCodeCheckResponse('<OtherResponse><Status><Code>Success</Code></Status></OtherResponse>')).toThrow(
      /ZipCodeCheckResponse_V5/,
    );
  });
});
