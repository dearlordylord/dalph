# Issue #336 item 5 — Vitest prewarm qualification

Item 5 changes repository tooling only. It does not change a Dalph command,
workflow decision, provider request, journal fact, retry, cleanup action, or
delivery-visible result.

## Implemented boundary

- `bootstrap:worktree` runs the bounded `prewarm:vitest` command after the
  final frozen relink and launcher validation.
- The prewarm uses Vitest's module fetcher with filesystem caching enabled,
  discovers ordinary test specifications, parses their test declarations, and
  recursively transforms the local module graph. It never runs a test,
  provider, coverage collector, or target application.
- `NODE_ENV=test` and the repository's ordinary-suite opt-ins are fixed during
  prewarm and restored afterward, so cache keys match a fresh Vitest CLI run.
- The persistent cache is disposable. Full fresh and resumed quality gates
  remove `node_modules/.experimental-vitest-cache` before guarded candidate
  observation and treat it as generated output.
- Cache reset rejects non-directory and symlinked paths before deletion.

The accepted chronology and scenario-to-test mapping are in
[`docs/scenarios/vitest-cache-prewarm.md`](scenarios/vitest-cache-prewarm.md).

## Evidence

Focused controls passed:

- `scripts/prewarm-vitest.test.mjs`: 2/2
- `scripts/bootstrap-worktree.test.ts`: 7/7
- `scripts/gate-vite-cache.test.mjs`: 4/4
- `pnpm test:gate-resume`: 190/190
- `pnpm typecheck`: exit 0
- `pnpm lint:changed`: passed

On 2026-09-21 in this worktree, a cache-reset prewarm transformed 399 ordinary
test files and warmed 1,026 local modules in 6.589 s. A representative
`trace-reader.test.ts` run passed 23 tests in 3.563 s cold and 1.447 s after
prewarm (a 2.116 s saving, below the prewarm cost). Debug output confirmed
persistent reads for both the test file and its source graph. This is evidence
that the boundary is correct, not a claim of a universal wall-clock gain.

The documented repeated-delivery workload was then measured from the same
cache-reset boundary: twenty fresh iterations took 49.955 s cold and 44.324 s
after prewarm. The warm run saved 5.631 s, which is 0.958 s less than the
6.589 s bootstrap cost. Every iteration passed with occurrence count 1,010 and
the same accepted-order digest
(`6df6b575b41d4ea07d3ac083725cd54b0ddf29fb925936dfd7f1c85a5d90b5c8`). The
controlled workload therefore does not repay prewarm on this host; no net
performance win is claimed.

The exact candidate gate also passed on this revision: run
`cd14fe9a-cfdb-4583-a1bb-ae8da59e4ab0`, candidate `ffe71e482`, base
`69bd8693`, with 506 obligations complete, formal evidence passed, delivery
repeatability and recorded-catalog qualification passed, and coverage reporting
392 passed test files (4 skipped) and 4,279 passed tests (41 skipped). The gate
finished with exit 0 and stopped custody proved.

The coverage-enabled full `pnpm test` control was stopped at its 90 s safety
boundary after unrelated existing `production-host.test.ts` assertion
failures. The no-coverage full `pnpm test --no-coverage` control was stopped at
85 s after reproducing the same three failures. Those commands are not used as
item-5 acceptance evidence; a clean frozen worktree should rerun them before
claiming a repository-wide speedup.

## Closure boundary

The implementation, safety controls, exact-candidate qualification, and
cold-versus-warm publication are complete. Item 5 can be marked complete as a
tooling-boundary change, with the measured result recorded as neutral/slightly
negative net wall time on this host. The performance claim remains open: any
future speedup work must change the documented workload or prewarm boundary
and collect a new controlled comparison; it does not justify a Dalph runtime
change.
