# Capability-registration source-audit performance

Issue #262 is a tooling-only change. The scanner reads authored TypeScript
text and builds an in-process TypeScript semantic index; it does not import,
evaluate, or call an audited module. The benchmark therefore measures source
text parsing and semantic indexing only.

## Method

The focused benchmark is `scripts/capability-registration-performance.test.ts`.
It reports elapsed wall time and the virtual source-tree paths that were
rebuilt or reused. Each row runs `runCapabilityRegistrationGate` and then reads
the cached diagnostics for that exact source-array object. The dedicated
command is:

```sh
mise exec node@22.22.2 -- pnpm exec vitest run scripts/capability-registration-performance.test.ts --pool=forks --maxWorkers=1 --reporter=verbose
mise exec node@24.15.0 -- pnpm exec vitest run scripts/capability-registration-performance.test.ts --pool=forks --maxWorkers=1 --reporter=verbose
```

The repository source set contains 624 authored TypeScript files. The source
array passed to each row is new, so the row measures Program construction while
the latest compatible Program is supplied as TypeScript's old Program.

## Named rows

| Node | Row | Wall time | Rebuilt virtual trees | Reused virtual trees | Issues |
| --- | --- | ---: | ---: | ---: | ---: |
| 22.22.2 | baseline | 7.913s | 624 | 0 | 0 |
| 22.22.2 | same-path mutation | 1.055s | 1 | 623 | 0 |
| 22.22.2 | added/re-export roots | 6.270s | 3 | 624 | 1 |
| 22.22.2 | provider-text roots | 8.522s | 2 | 624 | 1 |
| 24.15.0 | baseline | 8.516s | 624 | 0 | 0 |
| 24.15.0 | same-path mutation | 1.191s | 1 | 623 | 0 |
| 24.15.0 | added/re-export roots | 5.210s | 3 | 624 | 1 |
| 24.15.0 | provider-text roots | 4.727s | 2 | 624 | 1 |

The added and provider rows intentionally report one unregistered production
Layer issue. Their source text is parsed and bound; no provider expression is
executed.

## Complete focused suite

The main focused command retains all 33 accepted capability positives and
negative controls and adds three cache contract tests. All 36 tests passed in
each dedicated repetition below:

```sh
mise exec node@22.22.2 -- pnpm test:capability-registration -- --reporter=dot
mise exec node@24.15.0 -- pnpm test:capability-registration -- --reporter=dot
```

| Node | Repetition | Wall time | Result |
| --- | ---: | ---: | --- |
| 22.22.2 | 1 | 48.807s | 36/36 passed |
| 22.22.2 | 2 | 49.267s | 36/36 passed |
| 22.22.2 | 3 | 54.605s | 36/36 passed |
| 24.15.0 | 1 | 51.316s | 36/36 passed |
| 24.15.0 | 2 | 49.992s | 36/36 passed |
| 24.15.0 | 3 | 53.635s | 36/36 passed |

The existing capability-registration quality stage remains bounded at 60s.
The maximum valid dedicated observation is 54.605s, leaving 5.395s of measured
margin; the bound was not raised. One earlier Node24 process ran while
uncontrolled Quint and other-agent workloads occupied the shared host and
timed out an individual test at 15.065s, so it is retained as an excluded
contention observation rather than a dedicated or controlled-stress result.

## Scenario-to-test mapping

| Operational scenario | Evidence |
| --- | --- |
| A maintainer runs the complete quality gate and the 33 accepted controls remain source-only | `capability-registration.test.ts` existing 33 tests; `is part of check:all`; complete-suite rows above |
| A negative fixture changes one existing source | `rebuilds a source whose complete text changes instead of reusing its old tree`; same-path mutation row |
| A fixture adds virtual/re-export roots | `reuses unchanged source trees when a later audit adds a virtual root`; added/re-export row |
| A source contains a provider expression | `audits source text without loading or invoking a live provider`; provider-text row |
| Measurements set the finite stage bound | this report, the benchmark test, and the bounded runner contract in `capability-registration.test.ts` |
