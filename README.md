# node-kpn

Node.js client for KPN IRMA APIs hosted by Grexx (acceptatie: `service-accept.grexx.today`). The v2 surface mints an OAuth 2.0 client-credentials token and POSTs plain XML to `/realtime`.

The previous [developer.kpn.com](https://developer.kpn.com/) client (Disturbance Check, Internet Speed Check, SIM Swap, Mobile Services Management) is still published from `@wyre-ai/node-kpn/legacy`.

- Zero runtime dependencies — native `fetch` and `node:crypto` (Node 20+).
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
| `KPN_GREXX_BASE_URL` | yes | Interface root, **without** `/realtime`. No default — acceptatie and production differ. |
| `KPN_GREXX_TOKEN_URL` | no | Token endpoint. Default: `https://service-accept.grexx.today/oauth/access_token` |

`KPN_GREXX_BASE_URL` is the interface root copied from API Gegevens, for example `https://service-accept.grexx.today/interfaces/kpn/kpn_partners_acceptatieomgeving/<interface-id>/`.

Gateway mode may pass the username and password on `X-KPN-Grexx-Username` and `X-KPN-Grexx-Password` (both, or neither). Those override the env credentials. **Base URL and token URL are env-only.** `GrexxClient.fromEnv` / `resolveGrexxConfig` throw `GrexxConfigError` if a request includes `X-KPN-Grexx-Base-Url`, `X-KPN-Grexx-Token-Url`, or the same headers under the older `X-KPN-*` names. Do not copy those header values into `baseUrl` or `tokenUrl`.

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

Success codes on HTTP 200 are `Success`, legacy `0`, and queued `201` / `204` / `Accepted` / `Active`. Other `Status/Code` values throw. `postRealtime` does not retry network errors, `108` / 429, or 5xx unless you pass `{ idempotent: true }` — a timeout can arrive after Grexx has already accepted a write. `zipCodeCheck` opts in (up to 2 retries). A 401 still drops the cached token and retries that call once. The token endpoint is never retried into a call without a Bearer token. Clients for the same username and base URL share one limiter: at most 25 requests in any 5 seconds.

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
