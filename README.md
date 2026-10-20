# node-kpn

Node.js client for KPN IRMA APIs hosted by Grexx (acceptatie: `service-accept.grexx.today`). The v2 surface mints an OAuth 2.0 client-credentials token and POSTs plain XML to `/realtime`.

The previous [developer.kpn.com](https://developer.kpn.com/) client (Disturbance Check, Internet Speed Check, SIM Swap, Mobile Services Management) is still published from `@wyre-ai/node-kpn/legacy`.

- One runtime dependency: [`undici`](https://github.com/nodejs/undici) (`^6`), used only for per-connection URLs (its own `fetch` with a DNS-guarded `Agent`). Everything else is native `fetch` and `node:crypto` (Node 20+).
- Dual ESM + CJS build with TypeScript types.
- OAuth client-credentials (`scope=all`) with a process-wide token cache. The token request uses HTTP Basic. `/realtime` uses the Bearer token only.
- Sliding-window rate limiting (at most 25 requests in any 5 s) and typed errors, including IRMA code `108` (Too Many Requests).

## Install

```bash
npm install @wyre-ai/node-kpn
```

The package is published to GitHub Packages under the `@wyre-ai` scope:

```
@wyre-ai:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${NODE_AUTH_TOKEN}
```

## Auth

Acceptatie (confirmed live 2026-10-09) uses **OAuth 2.0 client credentials**, then a Bearer token. Putting `client_id` and `client_secret` in the token form body returns HTTP 400 `Invalid client: client is invalid`. HTTP Basic on the token endpoint returns a Bearer token (`expires_in` 3599). Basic Auth on `/realtime` is still rejected (`403 Auth method Basic not allowed on this endpoint`) and is not a fallback for that call.

1. `POST {KPN_GREXX_TOKEN_URL}` (https only) with `Authorization: Basic base64(form-urlencoded(client_id):form-urlencoded(client_secret))` (RFC 6749 §2.3.1 / Appendix B; a space is `+`) and body `grant_type=client_credentials&scope=all`. If that response is HTTP 400 or 401 `invalid_client`, retry once with the same grant and scope and `client_id` / `client_secret` in the form body, and no `Authorization` header.
2. Cache `access_token` until 60 seconds before `expires_in` (acceptatie returns `3599`). Concurrent callers share one mint.
3. `POST {KPN_GREXX_BASE_URL}/realtime` with `Authorization: Bearer {access_token}` and `Content-Type: text/xml`. The body is plain XML (`ZipCodeCheckRequest_V6`, …), not a SOAP envelope.
4. On HTTP 401, drop the cached token, mint once more, and retry the XML call once.
5. If the token endpoint errors, times out, or redirects, the client **fails closed** and does not call `/realtime`. Both attempts returning HTTP 400 or 401 `invalid_client` throws `GrexxAuthenticationError` and includes the form attempt's reason. A form-body HTTP 5xx throws `GrexxServerError` (the endpoint is unavailable).

Redirects are not followed on either call, so a token or Bearer credential is not sent to another host.

## Environment

| Variable | Required | Purpose |
|---|---|---|
| `KPN_GREXX_USERNAME` | yes | OAuth `client_id` (API username from the Grexx portal, API Gegevens) |
| `KPN_GREXX_PASSWORD` | yes | OAuth `client_secret` (API password) |
| `KPN_GREXX_BASE_URL` | yes, unless the request sends `X-Grexx-Api-Url` + `X-Grexx-Token-Url` | Interface root, **without** `/realtime`. No default — acceptatie and production differ. |
| `KPN_GREXX_TOKEN_URL` | no | Token endpoint. Default: `https://service-accept.grexx.today/oauth/access_token` |

`KPN_GREXX_BASE_URL` is the interface root copied from API Gegevens, for example `https://service-accept.grexx.today/interfaces/kpn/kpn_partners_acceptatieomgeving/<interface-id>/`.

Gateway mode may pass the username and password on `X-KPN-Grexx-Username` and `X-KPN-Grexx-Password` (both, or neither). Those override the env credentials.

### Per-connection URLs (`X-Grexx-Api-Url` / `X-Grexx-Token-Url`)

A gateway can point one connection at another Grexx environment (for example production) by sending two headers on every call:

| Header | Value | Example |
|---|---|---|
| `X-Grexx-Api-Url` | Interface root from the portal (API Gegevens), **without** `/realtime` | `https://service.grexx.today/interfaces/kpn/<interface-name>/<interface-id>` |
| `X-Grexx-Token-Url` | OAuth token endpoint | `https://service.grexx.today/oauth/access_token` |

Rules, enforced by `resolveGrexxConfig` / `GrexxClient.fromEnv` (each failure is a `GrexxConfigError` whose message never echoes the URL):

- **Both or neither.** When both are absent or empty, the client uses `KPN_GREXX_BASE_URL` and `KPN_GREXX_TOKEN_URL`. `KPN_GREXX_BASE_URL` has no default and is then required; `KPN_GREXX_TOKEN_URL` is optional and defaults to the acceptatie token endpoint (`https://service-accept.grexx.today/oauth/access_token`). This also holds when the credential headers are sent without the URL headers. Exactly one is an error, so a production API is never paired with the acceptatie token host.
- Honoured only together with `X-KPN-Grexx-Username` / `X-KPN-Grexx-Password`, so the environment secret is never sent to a header URL.
- **Scheme and authority:** `https:` only, port 443 only, no userinfo (`user:pass@`), no query string, no fragment.
- **Exact-host allowlist** `GREXX_ALLOWED_HOSTS`: `service.grexx.today` (production) and `service-accept.grexx.today` (acceptatie). No wildcard: other customers' portals live on `*.grexx.today`. IP literals never match. Append to the constant to allow another host.
- **Paths:** the token URL path must be exactly `/oauth/access_token` (`GREXX_TOKEN_PATH`). The API URL path must start with `/interfaces/kpn/` (`GREXX_API_PATH_PREFIX`) and is the interface root without `/realtime`; the client appends `/realtime`. Encoded separators (`%2e`, `%2f`, `%5c`), backslashes and empty segments are rejected.
- **Private-IP blocking (SSRF guard).** Header URLs set `ssrfGuard: true`. Before every token mint and every `/realtime` post the host is resolved, and the call fails closed if any address is private, loopback, link-local (including `169.254.169.254`), CGNAT, multicast, reserved or benchmark (`198.18.0.0/15`), the Azure wireserver, IPv6 ULA (including `fd00:ec2::254`), or an IPv4-in-IPv6 form of those. The request then goes through undici's own `fetch` with an `Agent` whose socket `lookup` repeats the check, so a DNS answer that changes between the check and the connect (rebinding) still cannot reach an internal address. DNS failures carry the resolver error as `cause`; the message does not name the host.
- **Redirects are refused** (`redirect: 'error'`): any 3xx fails the call.

When neither URL header is sent (with or without the credential headers), the URLs come from `KPN_GREXX_BASE_URL` / `KPN_GREXX_TOKEN_URL`. Those are operator-set, so that path keeps using the global `fetch` without the DNS guard.

Every other URL header name (`X-KPN-Grexx-Base-Url`, `X-KPN-Grexx-Token-Url`, older `X-KPN-*` forms) still throws `GrexxConfigError`.

## Usage

```ts
import { GrexxClient } from '@wyre-ai/node-kpn';

const grexx = GrexxClient.fromEnv();

const check = await grexx.zipCodeCheck({
  portfolio: 'All',
  zipCode: '1012JS',
  houseNumber: 1,
  isRoomNumberKnown: false,
});

console.log(check.code, check.suppliers.map((supplier) => supplier.name));
```

`buildZipCodeCheckRequest` emits `ZipCodeCheckRequest_V6` (Portfolio, ZipCode, HouseNr, optional HouseNrExtension / ServiceId / RoomNumber, IsRoomNumberKnown, optional Suppliers). `zipCodeCheck` parses `ZipCodeCheckResponse_V5` (status, suppliers, speeds, copper-off, action required).

`buildPrequalificationRequest` emits `PrequalificationRequest_V2` (ZipCode, HouseNr, HasBroadband, HasPhone, ProductTypeCode, plus optional extension, room, phone, order, supplier, and Isra fields). On PREP, ZipCode `9999ZZ` and HouseNr `1` are the documented test values. `HasBroadband: true` requires `serviceId` or `referencePhoneNumber`. `orderId`, when set, must match `OID` followed by digits (`OID[0-9]+`). `productTypeCode` is one of `ADSLTele`, `VDSLTele`, `FTTHTele`, `ADSLSMB`, `VDSLSMB`, `FTTHSMB`, `VDSLZakelijk`, `ADSLZakelijk`, `SDSL`, `FIBER`. Suppliers, when set, are `Kpn`, `KpnWeas`, `Caiw`, `Eurofiber`, `Tele2`, `Tele2Fiber` (`<string>` children; omit or pass `[]` for every supplier). `prequalification` parses `PrequalificationResponse_V1` (address, nillable `NlsType`, remarks, and `AvailabilityProduct_V1` with availability `Unknown` | `Red` | `Yellow` | `Green`). `errorClass` and `errorMessage` are returned on the result.

`buildOrderDataRequest` emits `OrderDataRequest_V1` (`OrderId`, an `xs:int`). `orderData` parses `OrderDataResponse_V1`: required `Status` (`Success`, `UnknownError`, or `ValidationError`, optional messages) and optional `Order` (`CustomerId`, `ProductCode` of 1–13 characters, `Quantity`). `parseOrderDataResponse` returns validation and unknown-error statuses as data. `GrexxClient.orderData` still posts through `/realtime`, so those status codes throw the same way as other realtime calls.

```ts
const prequal = await grexx.prequalification({
  zipCode: '9999ZZ',
  houseNumber: 1,
  hasBroadband: false,
  hasPhone: false,
  productTypeCode: 'FTTHTele',
});

console.log(prequal.nlsType, prequal.errorClass, prequal.products.map((product) => product.availability));

const order = await grexx.orderData({ orderId: 12345 });
console.log(order.status.code, order.order?.productCode);
```

Other realtime messages use the same transport:

```ts
await grexx.postRealtime('CarrierInfoRequest_V1', {
  // child elements, insertion order, or a prebuilt XML string
});
```

A string whose first element is the root name is sent as that document. Any other string is wrapped in the root element. Object values serialize as nested elements; arrays repeat the element name (`{ Suppliers: { string: ['KPN', 'Tele2Fiber'] } }`).

## Errors and limits

| Condition | Error |
|---|---|
| Token endpoint HTTP error, timeout, redirect, or missing `access_token` | `GrexxAuthenticationError` — `/realtime` is not called |
| HTTP 401 after one remint | `GrexxAuthenticationError` |
| HTTP 403, or IRMA code `102` | `GrexxForbiddenError` |
| HTTP 400, or `ValidationError` | `GrexxValidationError` |
| HTTP 429, or code `108` | `GrexxRateLimitError` (`retryAfter` seconds) |
| HTTP 5xx, or `UnknownError` | `GrexxServerError` |
| Bad env or a caller-supplied URL header | `GrexxConfigError` |

Success codes on HTTP 200 are `Success`, legacy `0`, and queued `201` / `204` / `Accepted` / `Active`. Other `Status/Code` values throw. `postRealtime` does not retry network errors, `108` / 429, or 5xx unless you pass `{ idempotent: true }` — a timeout can arrive after Grexx has already accepted a write. `zipCodeCheck`, `prequalification`, and `orderData` opt in (up to 2 retries). A 401 still drops the cached token and retries that call once. The token endpoint is never retried into a call without a Bearer token. Clients for the same username and base URL share one limiter: at most 25 requests in any 5 seconds. Prequalification `ErrorClass` / `ErrorMessage` are fields on the parsed result, not a `Status/Code`, so they do not throw.

`x-request-id` from Grexx is copied onto results and errors.

## Legacy developer.kpn.com

```ts
import { KpnClient } from '@wyre-ai/node-kpn/legacy';

const kpn = new KpnClient({
  clientId: process.env.KPN_CLIENT_ID!,
  clientSecret: process.env.KPN_CLIENT_SECRET!,
});
```

That entry point is the v1 Apigee client (gateway + MSM realms, JSON resources). It is unchanged, and it is no longer exported from the package root. [kpn-mcp](https://github.com/WYRE-AI/kpn-mcp) must move its imports and test mocks to `@wyre-ai/node-kpn/legacy`, and depend on a release that exports that entry point, before upgrading. That migration is [kpn-mcp#3](https://github.com/WYRE-AI/kpn-mcp/pull/3) on branch `cursor/grexx-mcp-tools-0694`.

## Requirements

- Node.js >= 20
- Grexx API username, password, and interface base URL (portal: API Gegevens). Production token URL and base URL differ from acceptatie.

## License

Apache-2.0 — see [LICENSE](./LICENSE).
