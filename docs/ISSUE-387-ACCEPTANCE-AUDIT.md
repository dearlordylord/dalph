# Issue #387 acceptance audit

## Candidate and source review

- Exact worktree: `/workspace/typescript/dalph-worktrees/issue-387-independent-r2`.
- Planned Base: `0000d5375a7835d02458ddf519b3dcf9bab15b53`.
- The clean Base already contains the original retained-publication resume
  protocol and later integration fixes. In particular, `7adf86c` and
  `8c130a42f` are ancestors; this task closes the remaining acceptance proof
  on the current #385/#386 line.
- `work/issue-387-independent-integration` at `ec6d0bb` is based on old
  `origin/master` `f3653ad`. It lacks the newer integrated #385/#386 descendants
  and its tree would remove many current scenario, grant, and delivery files.
  It is not a valid merge source. The `work/issue-387-integration` candidate at
  `e76012b` branched from the older `0e52596` line. Its changes were inspected
  individually; the retained-denial restart test below is applicable, while its
  state and automatic-successor changes cannot be copied over the current
  #386/#385 implementation.

## Accepted gap recorded before test edit

**Question:** After an exact retained-resume request is recorded and its new
publication attempt receives a conclusive authentication denial, does a later
ordinary Run activation or exact redelivery retry that denied mutation without
a new request, or retain the denial as the latest outcome?

**Accepted boundary:** The retained-delivery chronology says that a still-denied
attempt stops again and that authentication/policy denial requires an explicit
resumption request after the relevant facts change. A durable denial is not an
uncertain result. Process restart cannot turn it into permission to send again.
Exact replay of the earlier request returns its saved outcome and adds no
publication intent or push. This preserves the same Run, task attempt,
responsibility, accepted C, candidate M, and consumed ordinal history.

**Competing outcomes:** A: ordinary activation or exact replay sends another
push despite the conclusive denial. B: both return the same retained state with
no Git boundary and unchanged journal history.

**Regression test:** The focused memory and reopened-SQLite regression is
`packages/orchestrator/src/workflow/protocols/direct-publication/resume.test.ts::does not replay a conclusive resume denial after restart in memory and reopened SQLite journals`.
The test records an initial denial, admits one exact resume request, records a
second denial, simulate a fresh ordinary activation, then redeliver the same
request. It requires both later paths to return the exact retained outcome,
make zero custody, observation, preparation, or push calls, preserve the exact
journal, and keep attempt ordinals monotonic at `[1, 2]`. The complete resume
file passed 25/25 in 85.82s.

**Check contract before execution:** focused resume and related Operator/Run
tests, expected duration at most 8 minutes, absolute UTC stop
`2026-09-29T17:15:00.000Z`; affected TypeScript typecheck, expected duration
at most 5 minutes, stop `2026-09-29T17:30:00.000Z`; changed-file lint, expected
duration at most 3 minutes, stop `2026-09-29T17:40:00.000Z`. Do not begin a
full, hosted, or live qualification in this task.

The focused commands are bounded by those stops: the core `resume.test.ts`
file; selected retained-resume cases in `journaled-run-bootstrap.test.ts` and
`integration-delivery-action-adapter.test.ts`; the Memory/SQLite receipt,
Pause, Exit, and reopen cases in `publication-composition.test.ts`; and the four
ordinary-Run resumed-finality cases in `production.test.ts`. Each uses Vitest
with one worker. No unrelated suite files are included.

## Distinguish the two publication-composition timeouts

The first selected composition invocation completed in 89.25 seconds with 8
passing, 2 skipped, and 2 timed out at the default 10-second test limit. The
only failures were `composes ReceiptBeforeAuthorization through production
continuation and exact replay in Memory` (10.924s) and `composes
ReopenAfterReceipt through production continuation and exact replay in SQLite`
(10.018s); no assertion failed. Distinguish whether either case exceeds its
limit alone (A) or both finish alone after removing same-file suite context (B).

Before the two single-test runs: expected combined duration at most 2 minutes;
recorded pre-run UTC `2026-09-29T16:56:34Z`; hard stop
`2026-09-29T17:02:00Z`. Run exactly once each, sequentially, with unchanged
default timeout and one worker; retain separate logs:

```sh
pnpm exec vitest run packages/dalph/test/scenarios/publication-composition.test.ts -t 'composes ReceiptBeforeAuthorization through production continuation and exact replay in Memory' --reporter=verbose --maxWorkers=1
pnpm exec vitest run packages/dalph/test/scenarios/publication-composition.test.ts -t 'composes ReopenAfterReceipt through production continuation and exact replay in SQLite' --reporter=verbose --maxWorkers=1
```

No edit or additional test run is authorized by this diagnostic.

That restriction applied to the read-only diagnostic only. A later parent task
authorized the test-only SQLite scope repair documented below.

The isolated `ReceiptBeforeAuthorization ... Memory` case passed 1/1 in 4.34s
(`/tmp/issue387-receipt-before-authorization-memory-20260929.log`). The isolated
pre-repair `ReopenAfterReceipt ... SQLite` case failed at the unchanged 10s test
timeout (10.071s; `/tmp/issue387-reopen-receipt-sqlite-20260929.log`). Its
post-repair focused result is recorded below. Do not infer that the complete
composition file passed; it was not rerun as part of the scoped repair.

## Dependency restore needed for focused verification

The focused test command exited before Vitest admission because this worktree
has no `node_modules` and `pnpm exec vitest` returned
`ERR_PNPM_RECURSIVE_EXEC_FIRST_FAIL`. After confirming no full gate or
shared-write hold is active, run only `pnpm install --frozen-lockfile` in this
exact worktree. Expected duration is 60 seconds; absolute stop is
`2026-09-29T16:50:00.000Z`. Do not modify another worktree's dependencies or
start checks until this install is terminal.

## Production SQLite receipt close/reopen proof

**Accepted mapping:** S5/#387's crash-after-receipt-before-activation outcome is
mapped to `packages/orchestrator/src/workflow/protocols/direct-publication/resume.test.ts::recovers the same retained resume receipt after restart with memory and reopened SQLite journals`.
The production composition row is
`packages/dalph/test/scenarios/publication-composition.test.ts::composes ReopenAfterReceipt through production continuation and exact replay in SQLite`.
Its decisive assertions preserve the same request receipt and journal history,
one authorization and successor, and no duplicate publication or task Begin.

**Gap found:** Before this repair, the receipt admission and activation both
used the same default-shared `Effect.provide(application)` layer scope. The
SQLite test therefore did not prove that the first store had closed before a
second store opened, despite its `ReopenAfterReceipt` name.

**Test-only repair:** The SQLite `ReopenAfterReceipt` path now
provides each phase with `local: true`, which builds a fresh application layer
inside a scope that closes before the effect returns. A `Layer.tap` records each
JournalStore acquisition; ordered assertions require acquisition 1, receipt
scope closure, acquisition 2, activation scope closure, acquisition 3, and
replay scope closure. The journal filename remains identical across phases.
No production layer or runtime behavior changed.

**Verification status:** The named SQLite test passed on 2026-09-29 at about
17:31 UTC with its unchanged default timeout: 1 passed, 11 skipped, test
duration 2.783s, Vitest duration 7.58s, exit 0. The retained output is
`/tmp/issue387-reopen-receipt-sqlite-repair-20260929.log`. `pnpm typecheck`
also passed with exit 0 in about 32 seconds; it emitted only nonfatal Effect
suggestions. Base-scoped `lint:changed` passed with exit 0 against the exact
Base and selected only the two changed TypeScript test files. `git diff --check`
passes. The prior denial-replay test passed within the complete `resume.test.ts`
file (25/25); its focused lint and current project typecheck also pass. No
production source changed. No broad suite, gate, or live Run was run or
authorized by this bounded repair.

## Scoped review closure

- **Resolved:** the accepted S5 `ReopenAfterReceipt` test previously reused a
  default-shared application scope, so it did not prove a closed SQLite store
  before activation. The acquisition/closure ordering assertion and exact
  SQLite case passing at the default timeout resolve that proof gap.
- **Resolved:** a conclusive authentication denial after an exact retained
  request must not be retried by ordinary restart or request replay. The
  `resume.test.ts` regression asserts retained outcome, zero later boundary
  calls, unchanged journal, and ordinals `[1, 2]`; the file passed 25/25.
- **No accepted gap deferred:** this scoped change alters test composition only;
  it changes no Dalph runtime behavior. A full #387 qualification is outside
  this task and remains unclaimed.

## Integrated production-composition verification plan — 2026-09-29

The integrated candidate is clean at `bdc621bbda819c927a7d1453d76596fbf96f9da5`,
with the #387 test repair directly atop the accepted #385/#386 integration
Base `0000d5375a7835d02458ddf519b3dcf9bab15b53`. The prior repair verified the
SQLite reopen case alone; it did not rerun the complete production-composition
file. To close that remaining focused check, run exactly:

`pnpm exec vitest run packages/dalph/test/scenarios/publication-composition.test.ts --reporter=dot --maxWorkers=1`

Expected duration is at most 2 minutes; absolute UTC stop is
`2026-09-29T18:10:00Z`. This check covers the production-composed retained
receipt lifecycle cases in that file; it does not qualify the full #387 issue,
the combined #385/#386 candidate, or a live Run. Stop safely at the deadline,
preserve the output, and record the exact terminal result before any next check.

The integrated worktree has no `node_modules/.bin/vitest`. Before the check,
restore only its frozen dependencies with `pnpm install --frozen-lockfile`.
Expected duration is at most 2 minutes; absolute UTC stop is
`2026-09-29T18:09:00Z`. Do not start the Vitest check unless installation
finishes successfully before that stop. This install must leave tracked source
and the candidate HEAD unchanged.

Dependency restore finished at `2026-09-29T18:05:24Z`, exit 0, in 4.8 seconds.
The frozen lockfile was already current; pnpm reused 268 packages and added
270 links. It warned that Dalph CLI bins could not be linked because this
worktree has no `packages/dalph/dist`; the target composition test imports the
workspace modules directly. The install log is
`/tmp/issue387-integrated-install-20260929.log` (SHA-256
`e3722dfd2a6b34dd2b60dfcdad79d0461cdec8e1b314435af089e99a7ba9215c`). HEAD
remained `bdc621bbda819c927a7d1453d76596fbf96f9da5`; only this audit document
is tracked as modified.

The predeclared production-composition check then passed on that exact HEAD:
Vitest reported `Test Files 1 passed (1)` and `Tests 12 passed (12)`, duration
9.48 seconds, exit 0. Its retained log is
`/tmp/issue387-composition-integrated-20260929.log` (SHA-256
`926c3890b4d39df2de61132e7fd3a11699dc117439f381a15bcb5ebad35f939c`). The
run completed before the recorded `18:10Z` stop; the worktree stayed on the
same source HEAD. This closes the composition-file check left unrun by the
scoped repair, but does not claim the full integrated #385/#386/#387 gate.
