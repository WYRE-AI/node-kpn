# Contributing to node-kpn

Thanks for helping improve the KPN Grexx IRMA client.

## Development setup

```bash
export NODE_AUTH_TOKEN=$(gh auth token)   # GitHub Packages registry auth
npm install
```

## Workflow

- `npm run build` — tsup dual ESM + CJS build with declarations.
- `npm test` — vitest + MSW (no network access; MSW errors on any unhandled request). Do not call live Grexx. Tests must not contain API passwords.
- `npm run lint` — TypeScript type check (`tsc --noEmit`).

All three must pass before a PR is merged.

## Commit messages

This repo releases via [semantic-release](https://semantic-release.gitbook.io/); commit
messages must follow [Conventional Commits](https://www.conventionalcommits.org/):

- `fix:` — patch release
- `feat:` — minor release
- `feat!:` / `BREAKING CHANGE:` — major release
- `docs:`, `test:`, `chore:`, `refactor:` — no release

## Guidelines

- **Zero runtime dependencies.** The SDK uses native `fetch` only; do not add runtime deps.
- New realtime calls need a request builder, a parse helper, and unit tests for the XML. Mock the token endpoint; never point CI at acceptatie.
- Phase 1 request and response shapes come from `schemas/grexx/`. A call with no response XSD stays generic XML. `postRealtimeXml` is the escape hatch. Do not invent a production base URL.
- Update `CHANGELOG.md` under `[Unreleased]` following
  [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
- Never commit credentials or fixtures containing real tenant data.

## Releasing

Merging to `main` triggers `.github/workflows/release.yml`: tests on Node 20/22, then
semantic-release publishes `@wyre-ai/node-kpn` to GitHub Packages.
