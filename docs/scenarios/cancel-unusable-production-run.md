# Cancel one production Run with an unusable executor

Issue: [Recover an unusable production executor](https://github.com/dearlordylord/dalph/issues/390)

Status: accepted on 2026-09-20 before behavior-changing implementation.

## Governing behavior

When Dalph decides whether an unusable executor may be settled and its Run may
terminate, this scenario preserves [exact identity, claim ownership, and
foreign ownership isolation](../DELIVERY-INVARIANTS.md#identity) under D1, D4,
and D5; [work-in-progress preservation](../DELIVERY-INVARIANTS.md#preservation)
under D16; [intent-before-effect](../DELIVERY-INVARIANTS.md#ambiguity-and-evidence)
under D21; and [Run finality and convergence](../DELIVERY-INVARIANTS.md#progress)
under D35 and D37. It refines the accepted [running-executor
cancellation chronology](terminate-settled-run.md#alice-cancels-while-an-executor-is-running).
The governing `runCancellation` model laws are
`cancellationAppliedAtMostOnce`, `cancellationClosesForwardAdmission`,
`cancellationPreservesWorkInProgress`, and `cancellationHandoffReached` in
[`specs/runCancellation.qnt`](../../specs/runCancellation.qnt). This scenario
adds only the public command, exact production-Run selection, retained provider
reconciliation, and their end-to-end fixture; it does not replace the existing
cancellation, executor, claim-settlement, or finality protocols.

## Alice cancels the exact unfinished Run

Run R owns planned attempt P, worktree W, one task-work position, and exact
claim C for task A. Its Journal has executor-work responsibility without a
safe, terminal, replacement, or abandonment disposition. Executor-private
state may still say `Live`; W and retained evidence may be dirty. R has no
accepted integration result.

Alice invokes `dalph cancel TARGET --production --config PATH`. The command
decodes the ordinary production target and configuration, acquires that
repository's coordinator lock, and selects the only matching unfinished R. It
allocates no Run, starts no Integrator, and starts no replacement attempt.

Dalph records Operator `RunCancellationApplied` before asking the executor to
stop. The executor reconciles the exact retained containment for P, including
the app server and tool descendants. It records stop intent before termination
and accepts only evidence that every owned writer stopped and cannot resume;
PID absence or reuse alone is insufficient.

After conclusive stop evidence, Dalph records
`CancelledAttemptImplementationAbandoned`. This permanent cancellation
disposition releases executor-work responsibility and the task-work position,
but preserves W, commits, transcript, private state, and evidence. Dalph then
freshly reads C. It releases only the exact claim acquired by R, records an
absent or foreign claim without mutation, and uses the existing
intent/observation settlement protocol for an uncertain release.

After every cancellation responsibility settles, Dalph records R terminal as
`Cancelled`. An ordinary later `dalph run` may allocate a fresh Run. Repeating
the exact cancel command selects the already-cancelled R, reports its settled
result, and performs no second stop, abandonment, or claim mutation.

## Stop proof remains unavailable

If the executor reports a possible writer, incomplete containment, reused
identity, or contradictory evidence, Dalph leaves P, C, W, its task-work
position, and all evidence retained. It emits `cancellation.blocked` with the
typed blocker and exits the process-local owner. It performs no release,
cleanup, integration, replacement, Run termination, or automatic retry. Only
another explicit command can re-enter the same proof.

## Claim settlement remains unavailable or foreign

After abandonment, an unreadable claim keeps the separate claim responsibility
pending. A foreign or absent claim records the applicable no-release
observation. Dalph never deletes an unproved or foreign claim. Restart first
reconciles an uncertain prior read or release outcome before another effect.

## Crashes and rejected entry

Every uncertain effect records intent before the effect and observation after
it. A crash after cancellation, stop intent, stop proof, abandonment, focused
claim-read intent, release intent, or release outcome reconstructs R and
continues without duplicate work. Missing or ambiguous Run selection, invalid
configuration, or coordinator-lock contention fails before cancellation or
provider acquisition.

## Acceptance-test mapping

- Public command and entry: `accepts cancellation only for one production GitHub target and absolute configuration`, `routes cancel through the production host cancellation operation`, and `production cancellation fails before provider acquisition when no unfinished Run exists`.
- Exact selection and redelivery: `redelivers the exact cancelled production Run after its terminal history is retired`, `selects the sole exact unfinished production Run without allocating a replacement`, and `names every unfinished Run when production discovery is unsafe`.
- Cancellation ordering and settlement: `lets durable Run cancellation override an unreadable executor projection`, `executes cancellation settlement through suspension, abandonment, reread, and exact release`, and the run-cancellation cassette `cancellation-alpha-renaming` scenario.
- Stop containment: `bounds an unanswered retained-thread resume and closes its exact owned child once`, `terminates a reported background activity before reporting safe suspension`, `does not report safe suspension while a process-group descendant survives`, and `keeps suspension unresolved for contradictory, active, surviving, and failed activity cleanup`.
- Abandonment validity and redelivery: `rejects cancellation abandonment after replacement of the exact attempt`, `rejects a abandonment with the wrong authorized claim or a duplicate abandonment`, and `does not let a terminal report and pre-cancellation claim release bypass cancellation abandonment`.
- Claim safety and crash prefixes: `executes cancellation no-release only for a fresh foreign claim observation`, `retries Alice's exact stopped-claim release after reconciliation keeps the claim current`, and the cancellation-prefix cases in `cancelled-attempt-history.test.ts` and `run-cancellation.cassette.test.ts`.
- Public blocker: `maps a cancellation proof blocker without retaining private executor diagnostics` and `uses one canonical fatal classifier for throttles and recoverable failures`.
