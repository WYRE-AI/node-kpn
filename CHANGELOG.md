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

## [Unreleased]

### Added

- `KpnClient` with two OAuth realms (gateway and Mobile Services Management) sharing one rate limiter.
- `KpnTokenProvider` with a process-wide, bounded `TokenCache` (sha256-keyed, 5-minute expiry margin, single-flight minting) and 401 refresh-and-retry-once.
- `HttpClient` with an idempotency-gated retry policy (MSM order POSTs are never retried), repeated-key array params, binary responses and `quota-*` header parsing (`lastQuota`).
- Error hierarchy (`KpnError` → `AuthenticationError`, `ForbiddenError`, `NotFoundError`, `ValidationError`, `ConflictError`, `RateLimitError`, `ServerError`) and `parseKpnError` covering Apigee, KPN proxy, MSM, CAMARA and token-endpoint envelopes.
- MSM helpers `buildFilters` and `referenceNumber`.
- Resources: disturbances, availability, SIM swap, and mobile subscribers, hierarchy, thresholds, invoices, contracts, orders and service requests.
