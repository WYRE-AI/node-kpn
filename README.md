# node-kpn

Node.js client library for the [KPN API Store](https://developer.kpn.com/) products an MSP helpdesk needs:
Disturbance Check, Internet Speed Check, SIM Swap and Mobile Services Management (MSM v11, KPN Zakelijk business mobile).

- Zero runtime dependencies — built on native `fetch` and `node:crypto` (Node 20+).
- Dual ESM + CJS build with full TypeScript types.
- Apigee client-credentials OAuth for two realms, with a process-wide token cache and single-flight minting.
- Token-bucket rate limiting (25 requests / 5 s, conservative — KPN publishes no limits).
- Safe retries: only idempotent requests are retried. MSM order POSTs (block SIM, authorize…) are **never** retried.
- Typed error hierarchy (`KpnError` → `AuthenticationError`, `ForbiddenError`, `NotFoundError`, `ValidationError`, `ConflictError`, `RateLimitError`, `ServerError`).

## Install

```bash
npm install @wyre-ai/node-kpn
```

The package is published to GitHub Packages under the `@wyre-ai` scope. Configure your `.npmrc`:

```
@wyre-ai:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${NODE_AUTH_TOKEN}
```

## Usage

```ts
import { KpnClient, buildFilters, referenceNumber } from '@wyre-ai/node-kpn';

const kpn = new KpnClient({
  clientId: process.env.KPN_CLIENT_ID!,         // developer.kpn.com → Dashboard → Projects
  clientSecret: process.env.KPN_CLIENT_SECRET!,
  // Optional: the customer's GRIP-bound MSM app. Falls back to the credentials above.
  msmClientId: process.env.KPN_MSM_CLIENT_ID,
  msmClientSecret: process.env.KPN_MSM_CLIENT_SECRET,
});

// Is KPN down at this address?
const outages = await kpn.disturbances.getByAddress({ zipCode: '1234AB', houseNumber: 1 });

// SIM-swap fraud check before resetting SMS MFA.
const { latestSimChange } = await kpn.simSwap.retrieveDate('+31600000000');

// Business mobile: find a contract, then block its SIM (creates an asynchronous KPN order).
const contracts = await kpn.mobile.contracts.list({
  filters: buildFilters({ MOBILE_NUMBER: ['0600000000'] }),
  from: 0,
  to: 20,
});
const order = await kpn.mobile.contracts.blockSim({
  contractId: contracts.result[0]!.id!,
  referenceNumber: referenceNumber(),
});

// Which credentials work, and on which tier (demo/prod)?
console.log(await kpn.testConnection({ includeMsm: true }), kpn.lastQuota);
```

## Resources

| Property | Realm | Endpoints (under `api-prd.kpn.com`) |
|---|---|---|
| `disturbances` | gateway | `/network/kpn/disturbance-check/address` |
| `availability` | gateway | `/network/kpn/internet-speed-check/offer` |
| `simSwap` | gateway | `/kpn/sim-swap/retrieve-date` |
| `mobile.subscribers` | msm | `/mobile/kpn/mobileservices/hierarchy/subscribers[/{id}[/contracts]]` |
| `mobile.hierarchy` | msm | `…/hierarchy/children[/{id}]` |
| `mobile.thresholds` | msm | `…/contract/thresholds[/{id}/contracts]` |
| `mobile.invoices` | msm | `…/finances/invoices[/{id}]` (PDF) |
| `mobile.contracts` | msm | `…/contract/all`, `…/contract/id/{id}[/items]`, `…/order/operations`, `…/order/{block,unblock,replace}-sim` |
| `mobile.orders` | msm | `…/track-and-trace/orders[/{id}[/pretty\|/cancel]]`, `…/order/authorize` |
| `mobile.serviceRequests` | msm | `…/track-and-trace/service-requests[/{id}]` |

## API quirks this SDK handles for you

- **Two token realms.** `gateway` (`/oauth/client_credential/accesstoken`) and `msm` (`/oauth/grip/msm/accesstoken`). `grant_type` goes in the query string, credentials in a form body. Every value in the token body is a string, `expires_in` included.
- **Process-wide token cache.** Keyed by `sha256(baseUrl, tokenPath, clientId, clientSecret)`, bounded at 500 entries, re-minted 5 minutes before expiry. Pass `tokenCache` to override.
- **Token refresh on 401.** A 401, or an Apigee invalid/expired-token fault on any status, evicts the token and retries the request once. A 401 from the token endpoint itself is terminal (`AuthenticationError`, `code: 'invalid_client'`).
- **Entitlement looks like auth.** A token mints even when the project lacks a product; the call then fails with 401/403. `ForbiddenError` says so explicitly.
- **MSM is per customer.** The MSM token is bound to one customer's GRIP user; one credential set equals one KPN business customer.
- **No retries for side effects.** Network errors, 429 and 5xx are retried only for idempotent requests (GETs and the read-only POSTs `/offer`, `/retrieve-date`, `/order/replace-sim/validator`).
- **Repeated-key arrays.** `status: ['NEW', 'CLOSED']` serializes as `status=NEW&status=CLOSED` (MSM `collectionFormat: multi`).
- **Quota headers.** `quota-limit`, `quota-used`, `quota-interval`, `quota-time-unit`, `quota-reset-UTC` and `sunset` are exposed as `client.lastQuota` and on `RateLimitError.quota`.
- **No sandbox.** Test and production share `api-prd.kpn.com`; the tier lives on the account (`level` in `testConnection()`).

## Requirements

- Node.js >= 20
- A KPN API Store project with the relevant products; for MSM, a GRIP-bound MSM app for the customer

## License

Apache-2.0 — see [LICENSE](./LICENSE).
