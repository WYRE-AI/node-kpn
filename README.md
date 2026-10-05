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
  ZipCode: '1234AB',
  HouseNumber: 10,
  HouseNumberExtension: 'A',
});
console.log(speeds.grexxCode, speeds.body);

// Exact XML when the provisional field list is not enough:
await kpn.postRealtimeXml(
  'ZipCodeCheckRequest_V6',
  '<ZipCode>1234AB</ZipCode><HouseNumber>10</HouseNumber>',
);
```

`getAccessToken()` returns the cached OAuth bearer token (it mints even when `authMode` is `basic`, so you can inspect what the account issues).

## Phase 1 calls

All of these `POST` to `{KPN_GREXX_BASE_URL}/realtime`. Request roots are the inventory names. **ZipCodeCheck is V6**, the only version in the realtime inventory.

| Client method | IRMA root |
|---|---|
| `zipCodeCheck` | `ZipCodeCheckRequest_V6` |
| `prequalification` | `PrequalificationRequest_V2` |
| `carrierInfo` | `CarrierInfoRequest_V1` |
| `radiusCheck` | `RadiusCheckRequest_V1` |
| `rasCheck` | `RasCheckRequest_V1` |
| `startLineDiagnose` | `StartLineDiagnoseRequest_V1` |
| `customerData` | `CustomerDataRequest_V1` |
| `orderSummary` | `OrderSummaryRequest_V1` |
| `orderData` | `OrderDataRequest_V1` |
| `getSim` | `GetSimRequest_V1` |
| `getSimCard` | `GetSimCardRequest_V1` |
| `getMobileSettings` | `GetMobileSettingsRequest_V1` |
| `getMobileSubscriptionUsage` | `GetMobileSubscriptionUsageRequest_V1` |
| `getMobileSubscriptionOrders` | `GetMobileSubscriptionOrdersRequest_V1` |
| `availablePortings` | `AvailablePortingsRequest_V1` |

Matching `build*Request` and `parse*Response` helpers are exported. `PHASE1_ROOTS` holds the exact element names.

### Provisional fields

The inventory export describes these calls; it does not include XSDs. Builders emit a small PascalCase set taken from those descriptions:

- Address checks: `ZipCode`, `HouseNumber`, `HouseNumberExtension` (prequalification also `ConnectionPoint`, `AccessType`).
- Line checks: `Username` and/or `OrderId`. `StartLineDiagnose` requires `OrderId`.
- Customer / orders: `CustomerId`, and `Skip` on order summary (the description names `skip`, max 2500 per call). An empty `CustomerDataRequest` asks for every customer.
- Mobile: `Msisdn` and/or `OrderId`.
- Porting: `MobileSubscriptionCustomerId` or `HipGroupOrderId`. The inventory sentence spells the customer id `MobileSubscripionCustomerId` (missing "t"); set that property if the XSD kept the typo.

Pass anything else through `extra`. It is serialized as sibling elements. `postRealtimeXml(root, xmlString)` sends a fragment or a full document unchanged when the root already matches.

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
