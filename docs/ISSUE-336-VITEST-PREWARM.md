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
test files and warmed 1,026 local modules in 6.237 s. A representative
`trace-reader.test.ts` run passed 23 tests in 2.875 s cold and 1.557 s after
prewarm (Vitest reported 1.42 s versus 0.125 s transform time). Debug output
confirmed persistent reads for both the test file and its source graph. The
local host did not demonstrate repayment of the full prewarm cost from this
single focused file; this is evidence that the boundary is correct, not a
claim of a universal wall-clock gain.

The coverage-enabled full `pnpm test` control was stopped at its 90 s safety
boundary after unrelated existing `production-host.test.ts` assertion
failures. The no-coverage full `pnpm test --no-coverage` control was stopped at
85 s after reproducing the same three failures. Those commands are not used as
item-5 acceptance evidence; a clean frozen worktree should rerun them before
claiming a repository-wide speedup.

## Closure boundary

The implementation and safety controls are complete locally. Do not mark the
GitHub checkbox as a measured performance win until a clean exact worktree
passes the full candidate gate and records a fresh-worktree cold-versus-warm
comparison. The remaining action is qualification/publication, not another
runtime design change.
