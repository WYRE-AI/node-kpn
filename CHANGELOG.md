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

### Breaking

- Replace the developer.kpn.com OAuth client and MSM/network resources with `KpnGrexxClient`, a Grexx IRMA XML client for the KPN partner pilot.
- Remove Apigee token realms, `api-prd.kpn.com` defaults, disturbance / availability / SIM-swap / MSM methods, and the v1 error hierarchy.
- Require `KPN_GREXX_USERNAME`, `KPN_GREXX_PASSWORD`, and `KPN_GREXX_BASE_URL`. There is no production host default.

### Added

- OAuth client-credentials token mint and cache (`getAccessToken`), sent as `Authorization: Bearer` by default.
- `authMode: 'basic' | 'oauth'` for the acceptatie realtime/queued Basic listing.
- Phase 1 realtime builders and parsers, including `ZipCodeCheckRequest_V6`, plus `postRealtimeXml`.
- `testConnection()` and `GrexxError.grexxCode` (codes 0, 68, 100–109, and IRMA order statuses 201/203/204/…).
