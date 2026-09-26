# Candidate validation simplification

The tooling candidate validates one clean candidate against Base
`72c51f1f003b7f9e646a7a290ee76b2ef6b05eaf`. The independent runtime clone adds the
publication refactor against snapshot `01e4c584`; its inherited integration
failures prevent full qualification. The tooling changes affect validation only.
The runtime refactor changes the derivation owner, preserving existing decisions,
events, authority boundaries, crash recovery, and cleanup rules.

The investigation's 4–8 hour complete-delivery target is a forecast, not a result.
This candidate does not establish that target or replace three future complete
comparable delivery trials.

## Changes and proof

| Requirement | Implementation | Focused proof |
| --- | --- | --- |
| Remove diagnosis/repair permits | Delete permit commands and their implementation; retain stopped-writer custody and historical records | `gate-resume-integration.test.mjs`: a failed full gate retains its failure and accepts actual repaired tests without a permit |
| Execute one candidate-local command manifest | `check:all` uses `run-candidate-checks.mjs`; no stage resume or formal-reuse credit | `candidate-checks.test.mjs`: same manifest execution, actual failure, smoke command materialization |
| Preserve candidate immutability | Live input observation, final comparison, completed artifact protection, bounded child cleanup | `candidate-checks.test.mjs`: edit-and-restore; production guard setup and completed artifacts; retained custody tests |
| Make percentages advisory | Vitest and aggregate/changed-line verifiers retain reports without numeric vetoes | `coverage-advisory.test.mjs`: zero coverage succeeds, uncovered lines remain visible, invalid JSON fails |
| Select infrastructure controls | Tooling and root/workspace configuration select controls; ordinary product edits omit them | `quality-check-selection.test.mjs`: product, tooling, workspace config, unknown changes |
| Remove heuristic blockers and duplicate baseline requirement | Complexity, duplication, unused-export diagnostics remain explicit; separate baseline is optional | `quality-lint-census.test.mjs`; affected preflight/complexity command tests |
| Select Lab/catalog locally | Cassette, contracts, schema, journal/projection, Lab and shared tooling changes retain their unique assertions | `quality-check-selection.test.mjs`: catalog/projection selection |
| Reduce ordinary local repeat sampling | Three fresh samples; concurrency/workflow/cassette/tooling changes retain twenty | Same complete delivery runner; smoke manifest test |

The standards and specification reviews independently found and closed stale
policy text, missing workspace configuration selection, observer setup, artifact
protection, and stale smoke execution fields. Review closure does not substitute
for the final candidate command.

## Retained and pending boundaries

The local runner still uses live input observation, exact worktree admission,
clone capacity, bounded subprocess supervision, and durable stopped-writer fences.
It deliberately discards resume/reuse credit: interrupted checks restart. Lower
coverage and sampling assurance is explicit; tests and affected formal proofs
remain authoritative. The standalone formal diagnostics and historical runner
modules remain available, but do not govern ordinary `check:all`.

Hosted suffix selection, the broad hosted matrix, and affected-model granularity
remain unchanged. Hosted assurance still runs the full catalog and repetition.
These parts of the proposed sampling demotion remain outstanding.

The publication refactor is implemented in `publication-continuation.ts` and
consumed once per responsibility by frontier actions, target retention, and
visible waits. Independent standards and specification reviews found no new
semantic blocker. Its focused frontier, authorization recovery, and resume suites
pass all 58 tests after four fixture events and their record keys were updated to
the existing authorization schema. The production composition proof is recorded
below. Full qualification remains blocked by package declaration generation.

The copied integration snapshot initially had 315 typecheck errors, reproduced
with identical codes and source locations before and after the refactor. Focused
repairs to those inherited declarations and fixtures are described below. No live
integration worktree was modified. Hosted assurance selection and per-model
formal granularity remain pending. No delivery-time improvement or live-host proof
is claimed.

## Qualification repair evidence

Run `bb153ae4-0a09-439f-b88b-588e332e7a43` stopped in coverage-explanation
controls after artifact validation, typecheck, lint, Lab, and cycle checks passed.
Custody was stopped and source unchanged; the result is unproven, not qualified.

The diagnostic question was whether the product coverage boundary failed or its
fixtures inherited incompatible inputs. The focused two-test run with the real
`DALPH_COVERAGE_BASE_SHA` exited 1 and reproduced both distinguishing observations:
the real Base was absent from the disposable Git repository, and the copied
legacy runtime omitted `quality-check-selection.mjs`. This supports fixture
isolation as the cause. After using the fixture's own Base and copying the new
dependency, the identical focused command passed both tests in 22.9 seconds.
The final runner also retains completed-stage results when a later stage fails.

## Runtime attempt and accepted scenario mapping

The runtime attempt uses the independent combined integration snapshot
`01e4c584` as its Base. Its source was read twice with identical tracked content;
the live integration worktree remains untouched. This refactor changes only the
transient derivation consumed by the existing frontier; it introduces no journal
event, effect, authority, persisted decision, or new retry permission.

The accepted chronology is `docs/scenarios/direct-remote-publication.md`, the
compatible receipt/automatic successor composition, S7 Pause/Exit, and S8 finality.
Before refactoring, the focused frontier, authorization recovery, and resume
suites establish the existing behavior. Required mappings are:

| Starting facts and trigger | Boundary / visible result and forbidden result | Proof |
| --- | --- | --- |
| Retained compatible head, receipt before authorization | Resume receipt wakes the same responsibility; one authorization, no task retry | Frontier receipt-order regression and production composition fixture |
| Authorization R1, then compatible receipt R2 before fixation | Reuse R1 authorization and exact target; at most one successor, no extra budget | `integration-frontier-transitions.test.ts`: reuses one successor authorization when a compatible resume receipt follows authorization before fixation |
| Crash after authorization/receipt | Reopen durable journal and resume the same authorization; no duplicate effects | `automatic-successor-authorization-recovery.test.ts` and production composition fixture |
| Replay exact receipt | Existing receipt and successor identities remain unchanged; no new wake or session | `direct-publication/resume.test.ts`: exact compatible-head continuation after restart; composition fixture |
| Pause or Exit before continuation | Existing control boundary prevents new work; receipt cannot unpause | Production workflow control cases and composition fixture |
| Exhausted sessions / changed finality premises | Visible bounded retained wait / no premature dependant or finality | Existing frontier bounded-wait tests and finality production/model regressions |

The refactor itself performs no external call and adds no crash boundary; crashes
and retries are therefore tested at the retained interpreter/journal boundaries.
The exact new composition proof and its remaining build qualification limit are recorded below.


## Production composition proof and remaining build failure

`packages/dalph/test/scenarios/publication-composition.test.ts` now owns the two
moved Pause/Exit assertions and ten new production-interpreter cases. Every new
case runs on both Memory and SQLite. The SQLite reopen case releases and rebuilds
the production application after the receipt and before fixation. The controlled
provider stops the process after the real interpreter has fixed S2; exact receipt
replay after reopening must leave every record unchanged.

| Accepted chronology | Exact test selector (each Memory and SQLite) |
| --- | --- |
| Receipt before authorization | `composes ReceiptBeforeAuthorization through production continuation and exact replay` |
| R1 authorization, receipt R2 before fixation | `composes ReceiptAfterAuthorization through production continuation and exact replay` |
| Reopen after receipt before fixation | `composes ReopenAfterReceipt through production continuation and exact replay` |
| Pause after receipt preserves cutoff | `composes PauseAfterReceipt through production continuation and exact replay` |
| Exit after receipt preserves cutoff | `composes ExitAfterReceipt through production continuation and exact replay` |

All twelve cases passed in 9.45 seconds, then in 5.67 seconds with explicit
successor identity assertions. The fixture checks one authorization, one successor,
exact original authorization reuse, retained task/Base/accepted commit/FIFO target,
no additional task begin, exact replay identity, and no forbidden control-cutoff
calls. Existing bootstrap tests remain the owner of accepted-fact wake counts.
No live-provider proof is implied.

The inherited typecheck errors were repaired through missing fixture authorization,
accurate existing variant unions, removal of a spurious externally required service,
and an explicit dry-run scope. Of 229 focused regression tests, 228 passed together;
the one property test that exceeded ten seconds under contention passed unchanged
alone in 2.51 seconds. The full production package build still fails with TS4023
`NodeInspectSymbol` errors in inferred public return types. This is an artifact
qualification blocker, separate from runtime test success. The next diagnostic is
to identify the originating public effect/error type in the package declarations;
no gate or declaration check has been waived.


The declaration-emission obstruction was diagnosed after the root typecheck passed.
The inferred workflow error union exposed the module-private
`PlannedAttemptResumeRedeliveryRejected` class, forcing TypeScript to inline its
unnameable Effect inspection symbol in downstream public declarations. Exporting
that existing class and re-exporting it from the orchestrator package makes the
public return type nameable. No runtime branch, event or schema changed. The exact
`pnpm build` command then passed all three production packages; the earlier TS4023
obstruction is repaired, not waived.

Run `68cbc8ef-8cc1-44bb-873c-ea10b3a0daa5` passed artifacts, typecheck,
lint and Lab, then exhausted the existing dependency check's 60-second allowance.
Its process custody stopped and source remained unchanged. The focused diagnostic
asked whether the traversal contained a cycle/failure or merely exceeded that
allowance. The same `check:circular` command with a three-minute bound exited zero
and reported all 2,081 files analyzed with no circular dependency. This supports
an inadequate stage allowance, not a dependency defect. The stage now retains its
check and has a three-minute bound; the repaired bounded command must pass before
another qualification attempt.
