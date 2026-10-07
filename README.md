# node-kpn

Node.js client for the **KPN partner Grexx / IRMA XML APIs** used by the partner pilot (portal: `xxid.grexx.today`).

This is a breaking 2.0 rewrite. Version 1 talked to developer.kpn.com (Disturbance Check, Internet Speed Check, SIM Swap, Mobile Services Management). Those products are gone. Phase 1 is **realtime only**: plain XML `POST`s, no SOAP envelope, no Proxymodule.

- Zero runtime dependencies — native `fetch` (Node 20+).
- Dual ESM + CJS build with TypeScript types.
- OAuth client-credentials bearer tokens by default, with a per-client cache. Optional HTTP Basic fallback.
- Conservative client-side rate limit (25 requests / 5 s) plus Grexx code **108**.
- Typed errors with `grexxCode`.

## Install

```bash
npm install @wyre-ai/node-kpn
```

The package is published to GitHub Packages under the `@wyre-ai` scope. Configure your `.npmrc`:

```
@wyre-ai:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${NODE_AUTH_TOKEN}
```

## Environment

Credentials and the base URL come from the partner portal **API Gegevens** page. Do not commit them.

| Variable | Required | Purpose |
|---|---|---|
| `KPN_GREXX_USERNAME` | yes | API username. OAuth `client_id`, or Basic user. |
| `KPN_GREXX_PASSWORD` | yes | API password. OAuth `client_secret`, or Basic password. |
| `KPN_GREXX_BASE_URL` | yes | Interface base URL. No default — production is a different host. |
| `KPN_GREXX_AUTH_MODE` | no | `oauth` (default) or `basic`. |
| `KPN_GREXX_TOKEN_URL` | no | Override. Default is `{origin of base URL}/oauth/access_token`. |
| `KPN_GREXX_SCOPE` | no | OAuth scope. Default `all`. |

Acceptatie base URL (trailing slash optional; the client joins paths with a single slash):

```
https://service-accept.grexx.today/interfaces/kpn/kpn_partners_acceptatieomgeving/697fbf4b18a076446aa2cd4a/
```

| Path | Portal auth note | What this client sends |
|---|---|---|
| `/realtime` | Basic listed | Bearer by default |
| `/queued` | Basic listed | Bearer by default |
| `/ordermodule` | OAuth client credentials | Bearer by default |

Acceptatie token endpoint:

```
POST https://service-accept.grexx.today/oauth/access_token
Content-Type: application/x-www-form-urlencoded

grant_type=client_credentials&client_id=…&client_secret=…&scope=all
```

The account setting on acceptatie is **OAuth using Client Credentials**, even though the realtime/queued rows still say Basic. This client mints a bearer token and sends `Authorization: Bearer`. If a smoke test comes back with Grexx code **101** (`Authorization scheme basic required`), construct the client with `authMode: 'basic'`. That check is not part of CI — tests mock the HTTP calls and never contact Grexx.

## Usage

```ts
import { KpnGrexxClient, grexxConfigFromEnv } from '@wyre-ai/node-kpn';

const kpn = new KpnGrexxClient(grexxConfigFromEnv());

// Empty ZipCodeCheck. Codes 103/104/105/109 mean "credentials worked, XML was rejected".
console.log(await kpn.testConnection());

const speeds = await kpn.zipCodeCheck({
  Portfolio: 'Business',
  ZipCode: '1234AB',
  HouseNr: 10,
  IsRoomNumberKnown: false,
});
console.log(speeds.data?.Status?.Code, speeds.data?.AvailableSuppliers);

// Exact XML when a call is not wrapped by a builder:
await kpn.postRealtimeXml(
  'ZipCodeCheckRequest_V6',
  '<Portfolio>Business</Portfolio><ZipCode>1234AB</ZipCode><HouseNr>10</HouseNr><IsRoomNumberKnown>false</IsRoomNumberKnown>',
);
```

`getAccessToken()` returns the cached OAuth bearer token (it mints even when `authMode` is `basic`, so you can inspect what the account issues).

## Phase 1 calls

All of these `POST` to `{KPN_GREXX_BASE_URL}/realtime`. Request and response shapes come from the portal XSDs in [`schemas/grexx/`](./schemas/grexx) (also published with the package). Builders emit elements in XSD document order and reject a missing required field or a value outside an enumeration before the request is sent.

| Client method | Request root | Response |
|---|---|---|
| `zipCodeCheck` | `ZipCodeCheckRequest_V6` | `ZipCodeCheckResponse_V5` |
| `prequalification` | `PrequalificationRequest_V2` | `PrequalificationResponse_V1` |
| `carrierInfo` | `CarrierInfoRequest_V1` | `CarrierInfoResponse_V1` |
| `radiusCheck` | `RadiusCheckRequest_V1` | `RadiusCheckResponse_V1` |
| `rasCheck` | `RasCheckRequest_V1` | `RasCheckResponse_V1` |
| `startLineDiagnose` | `StartLineDiagnoseRequest_V1` | `StartLineDiagnoseResponse_V1` |
| `customerData` | `CustomerDataRequest_V1` | `CustomerDataResponse_V1` |
| `orderSummary` | `OrderSummaryRequest_V1` | generic XML (no response XSD) |
| `orderData` | `OrderDataRequest_V1` | `OrderDataResponse_V1` |
| `getSim` | `GetSimRequest_V1` | `GetSimResponse_V1` |
| `getMobileSettings` | `GetMobileSettingsRequest_V1` | `GetMobileSettingsResponse_V1` |
| `getMobileSubscriptionUsage` | `GetMobileSubscriptionUsageRequest_V1` | `GetMobileSubscriptionUsageResponse_V1` |
| `getMobileSubscriptionOrders` | `GetMobileSubscriptionOrdersRequest_V1` | generic XML (no response XSD) |
| `availablePortings` | `AvailablePortingsRequest_V1` | `AvailablePortingsResponse_V1` |

There is no `GetSimCardRequest`. SIM reads use `GetSimRequest_V1` and key on the integer IRMA `OrderId`. Matching `build*Request` and `parse*Response` helpers are exported. `PHASE1_ROOTS` and `PHASE1_RESPONSE_ROOTS` hold the exact element names.

### Field names from the XSDs

- Zip-code check: `Portfolio` (`Business` \| `SMB` \| `Teleworker` \| `All`), `ZipCode`, `HouseNr`, optional `HouseNrExtension`, and required `IsRoomNumberKnown`. Suppliers are a `Suppliers/string` list (`KPN`, `KPNWEAS`, `Eurofiber`, …). An empty list is omitted and means every supplier.
- Prequalification uses the same `HouseNr` spelling. `HasBroadband: true` requires `ServiceId` or `ReferencePhoneNumber`. `ProductTypeCode` is one of `ADSLTele`, `VDSLTele`, `FTTHTele`, `ADSLSMB`, `VDSLSMB`, `FTTHSMB`, `VDSLZakelijk`, `ADSLZakelijk`, `SDSL`, `FIBER`. Optional `OrderId` must match `OID` plus digits.
- Carrier info uses `HouseNumber` (1–99999) and `HouseNumberExt`, not `HouseNr`. `ProductType` is `xDSL` \| `FttH` \| `WeasFiber` \| `All`. Zip, phone, ISRA, and extension checks follow the XSD patterns. The portal file stores those patterns double-escaped (`\\d`); the client validates the intended `\d` form.
- Radius, RAS, order data, GetSim, mobile settings, and mobile usage each take an integer `OrderId`. Start-line diagnose also takes `SymptomCode` (`Sym103` \| `Sym104` \| `Sym105` \| `Sym111`).
- Customer data and order summary are filters; every field is optional. An empty `CustomerDataRequest` asks for every customer. `Take` is at most 100 (customers) or 2500 (order summary).
- Mobile subscription orders take `OrderIds` (1–50), serialized as `OrderIds/OrderId`.
- Available portings require `MobileSubscripionCustomerId` (the XSD spelling, missing the "t") and/or `HipGroupOrderId`, both integers.

`xsi:nil` values are omitted from the projected response. IRMA `Status/Code` strings (`Success`, `UnknownError`, `ValidationError`; usage uses `UnKnownError`) stay on `data` and are not copied onto `grexxCode`. Gateway codes still throw.

`GetSim` returns `Puc1` (PUK) and, for eSIM, `ActivationCode` and `ConfirmationCode`. Radius check returns `Password`. Those values are not redacted and are not logged by this client. Do not log them in the caller.

`postRealtimeXml(root, xmlString)` sends a fragment or a full document unchanged when the root already matches.

`Content-Type` is `application/xml; charset=utf-8`. That value has **not** been confirmed against live acceptatie. If a smoke test shows Grexx wants `text/xml`, that is the only header to change (`GREXX_XML_CONTENT_TYPE`).

## Responses and codes

Bodies are plain XML. The parser maps:

| Codes | Meaning |
|---|---|
| `0` | Success. Returned on the parsed response. |
| `68` | Unknown RoutIT error. Throws `GrexxError`. |
| `100`–`102` | Auth. Throws `GrexxAuthenticationError`. |
| `103`, `104`, `105`, `109` | XML missing, malformed, unknown type, or schema-invalid. Throws `GrexxValidationError`. |
| `106`, `107` | Inactive account, or message type not allowed. Throws `GrexxError`. |
| `108` | Too Many Requests. Throws `GrexxRateLimitError`. |
| `201`, `203`, `204`, `205`, `207`, `208`, `209`, `213`, `214` | IRMA order status (`Active`, `Accepted`, …). Returned as `orderStatus`, not thrown. |

`grexxCode` is set on both successful parses (code 0) and thrown errors. Redirects are not followed.

`postXml('queued' | 'ordermodule', …)` can address the other two paths. Phase 1 does not wrap them in typed helpers: queued calls only ack, and the partner has no Proxymodule tile, so the business result would never arrive.

## Requirements

- Node.js >= 20
- A KPN partner Grexx user (acceptatie or, later, production) and a base URL from API Gegevens

## License

Apache-2.0 — see [LICENSE](./LICENSE).
