## [Unreleased]

### Added

- `buildPrequalificationRequest` / `GrexxClient.prequalification` for `PrequalificationRequest_V2` → `PrequalificationResponse_V1`. PREP can be tested with ZipCode `9999ZZ` and HouseNr `1`. `HasBroadband` true requires `ServiceId` or `ReferencePhoneNumber`. `OrderId`, when set, must match `OID` plus digits. `ErrorClass` and `ErrorMessage` are returned on the result.
- `buildOrderDataRequest` / `GrexxClient.orderData` for `OrderDataRequest_V1` → `OrderDataResponse_V1` (`Status` `Success` | `UnknownError` | `ValidationError`, optional `Order`). `parseOrderDataResponse` returns validation and unknown-error statuses as data. `orderData` still throws those codes through the existing realtime error mapping. Both reads opt in to the realtime retry policy.

### Fixed

- Grexx token acquisition sends HTTP Basic first. `client_id` and `client_secret` are encoded with `application/x-www-form-urlencoded` (RFC 6749 Appendix B; a space is `+`) before base64. The body is `grant_type=client_credentials&scope=all`. Form-body credentials are used only when Basic returns HTTP 400 or 401 `invalid_client`, and that failure includes the form attempt's redacted reason. A form-body HTTP 5xx is an upstream unavailable error, not a credential rejection. The token URL must be https before any Basic header is sent. Every non-empty client secret is redacted from token errors; an empty secret is left unchanged.

## [2.0.1] - 2026-10-09

### Fixed

- Grexx token acquisition sends HTTP Basic first (`Authorization: Basic` with RFC 6749 §2.3.1 percent-encoding, body `grant_type=client_credentials&scope=all`). Form-body `client_id` / `client_secret` is used only when Basic returns HTTP 400 or 401 `invalid_client`. Acceptatie rejects form-body credentials with `Invalid client: client is invalid` and accepts Basic. Token caching and the 60-second expiry margin are unchanged. Client secrets are not logged.

## [2.0.0] - 2026-10-08

### Breaking

- The package entry point is now the Grexx/IRMA client (`GrexxClient`). Acceptatie auth is OAuth 2.0 `client_credentials` with a Bearer token on `POST /realtime` (plain XML, no SOAP). Basic Auth is not implemented.
- The developer.kpn.com client (`KpnClient`, Disturbance Check, Internet Speed Check, SIM Swap, MSM) moved to `@wyre-ai/node-kpn/legacy`.

### Added

- `GrexxClient.postRealtime(rootElement, bodyXmlOrObject)` — mints and caches an OAuth access token (`scope=all`), then POSTs `text/xml` with `Authorization: Bearer`. Tokens are reused until 60 seconds before `expires_in` and reminted once after HTTP 401. Token-endpoint errors, timeouts, and redirects fail closed (no `/realtime` call, no Basic fallback).
- `buildZipCodeCheckRequest` / `GrexxClient.zipCodeCheck` for `ZipCodeCheckRequest_V6` → `ZipCodeCheckResponse_V5`.
- Env configuration: `KPN_GREXX_USERNAME`, `KPN_GREXX_PASSWORD`, `KPN_GREXX_BASE_URL` (required), `KPN_GREXX_TOKEN_URL` (default `https://service-accept.grexx.today/oauth/access_token`). Gateway headers may supply the username and password only; base URL and token URL headers are rejected.
- Grexx error types (`GrexxAuthenticationError`, `GrexxForbiddenError`, `GrexxValidationError`, `GrexxRateLimitError` for HTTP 429 and code 108, `GrexxServerError`, `GrexxConfigError`).

### Fixed

- Token-response validation errors redact `access_token` and `refresh_token` before the body is attached.
- Redirects from Node `fetch` (`fetch failed` with `cause` `unexpected redirect`) are classified as redirect failures.
- `GrexxClient` instances for the same username and realtime URL share one sliding window of at most 25 requests in any 5 seconds.
- `postRealtime` retries only when `{ idempotent: true }`. `zipCodeCheck` opts in. Non-XML error bodies keep the vendor HTTP status.

## [1.0.1](https://github.com/WYRE-AI/node-kpn/compare/v1.0.0...v1.0.1) (2026-09-25)


### Bug Fixes

* treat the MSM token endpoint's HTTP 500 invalid_client as an authentication error ([4f299c1](https://github.com/WYRE-AI/node-kpn/commit/4f299c14e532c8d40c227ea06290ddb405d195ed))

# 1.0.0 (2026-09-25)


### Features

* add KPN network and MSM mobile resources ([a92df19](https://github.com/WYRE-AI/node-kpn/commit/a92df197d5eb1f70d43832c3a9a49e07b6c64827))
* initial KPN SDK core (dual-realm OAuth, HTTP client, errors, MSM helpers) ([9283fcf](https://github.com/WYRE-AI/node-kpn/commit/9283fcfe7bb3197b7c74e95c250592f36e65d983))

# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
Releases are cut automatically by semantic-release from conventional commits.
