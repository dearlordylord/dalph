# Dalph cassette lab

The Lab runs every entry in Dalph's three maintained cassette catalogs through
the corresponding production cassette runner. That includes the authored
coordinator stories, target-promotion protocol stories, and integration-finality
protocol stories. It does not contain a second workflow reducer.

The browser shows one row per maintained cassette. A maintainer can run one
story or the complete catalog and inspect the returned production journal
records. Each run receives fresh in-memory runtime state and a deterministic
test clock. Authored runs additionally receive browser cryptography and a fresh
production Run identity; protocol fixtures retain their declared identities.

An authored cassette controls tracker, claim, Git, executor, integration,
verification, promotion, trace, and journal boundary results. Implemented
Dalph coordinator and protocol code executes normally. A mismatched or
unsupported story item fails at that item and is displayed as a failure; the
Lab never skips it or manufactures a completed result.

The browser build imports the production package sources directly. Its Vite
composition replaces only the unavailable Node platform layers; none of the
cassette runners depend on those adapters for their controlled boundary calls.

Install at the repository root and run the workspace package:

```sh
pnpm install --frozen-lockfile
pnpm --filter @dalph/reducer-lab-prototype dev
```

Validate all maintained cassettes and the browser bundle:

```sh
pnpm --filter @dalph/reducer-lab-prototype typecheck
pnpm --filter @dalph/reducer-lab-prototype smoke
pnpm --filter @dalph/reducer-lab-prototype build
```

The accepted chronology and scenario-to-test mapping are in
`docs/scenarios/reducer-lab-maintained-cassette-catalog.md`.
