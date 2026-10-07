# Identify an unfinished coverage owner

The coverage runner retains test lifecycle observations in its existing child
logs. `coverage:body` selects the compact reporter alongside Vitest's dot
reporter; this adds no Dalph workflow behavior, changes no test assertion or
deadline, and does not replace gate custody or its exit verdict.

Each `CoverageLifecycle` JSON line is written directly to stderr. Console
capture cannot postpone these observations until a test exits. A module emits queued/start/end and a test emits start/end with its Vitest test ID and UTC observation time. Reporter file/module locators
are relative to the working directory so deep attempt-worktree prefixes do not
consume the bounded owner fields. Wait edges retain the original budget in
`timeoutMilliseconds`. For the
complete-delivery acceptance scenarios, an expired wait additionally names its
variant, boundary and original timeout in `AcceptanceWaitTimedOut`. Scope
finalization emits start before the existing finalizers, including the body exit
outcome, and finish after they
return. A missing finish is an observation of an unfinished scope, not proof
that its writers stopped.

Named waits emit start/finish edges as well, so a timeout whose interruption
waits for a stalled child finalizer still leaves the awaited boundary visible.

Read unmatched test/module IDs and unmatched finalization edges in the retained
child log. Concurrent tests can interleave, so the last printed line alone does
not identify the only unfinished owner. No successful lifecycle marker overrides
a failed or missing child exit. These diagnostics do not establish the cause of
the hosted failure in #479.

## Acceptance mapping

| Starting facts and trigger | Boundary and required observation | Check |
| --- | --- | --- |
| A controlled wait has not completed when its original 20-second budget expires. | The error and retained stderr name `MCPAdvisory` / `AuthoredTaskEObserved`, with the unchanged 20,000 ms budget. | `coverage-wait.test.ts`: names the original wait boundary; `coverage-lifecycle-reporter.test.ts`: actual child reporter output |
| A scoped effect finishes while its finalizer waits on a controlled Deferred. | FinalizationStarted appears, Finished is absent until the existing finalizer is released; release completes normally. | `coverage-wait.test.ts`: identifies scope finalization before a blocked finalizer |
| A wait or the five controlled tests complete normally. | Values and verdicts remain unchanged; each started test ID has one passing result and its module completes. | `coverage-wait.test.ts`: keeps successful waits; reporter child integration test |
| Lifecycle labels contain very long Unicode or escaped control characters. | Per-edge output remains at most 4 KiB, including framing, with omitted characters counted. | `coverage-wait.test.ts`: both byte-bound tests; reporter child integration test |

The reporter emits edges, never poll observations, prompts, stack traces or test
payloads. Five controlled tests produce eighteen lifecycle observations
(module queued/start/end, ten test edges, four wait edges and one controlled wait timeout). The child
integration test bounds their combined JSON to 8 KiB. The complete-delivery
outer scope and inner host scope each add two edges per variant and each of its six named waits adds two;
an expired wait adds one. Aggregate volume
therefore scales with the number of test edges, not their duration. Existing CI
child-log artifacts retain the observations without a new artifact transport.

Focused reproduction keeps the original acceptance case and V8 coverage; do
not extend deadlines or rerun unchanged full coverage on the strength of this
instrumentation alone. #479 owns the real hosted cause, any required repair and
successful complete coverage.

## Issue #479 diagnostic status (2026-10-07)

The retained coverage child for [run 37602840755](https://github.com/dearlordylord/dalph/actions/runs/37602840755)
tested published candidate `1d8abedde1532bf57babf44df41474a19fe4abad`.
Its envelope records timed-out child outcome, stopped custody and unchanged
source. The child log names MCPAdvisory's `TimeoutError`, but contains no
`CoverageLifecycle` observations. That historical log cannot retrospectively
identify which original wait expired or which owner remained unfinished.

The current diagnostic is based on `8bb1ddf085201b66d5c2832cdcde2befe872c75a`,
which already includes #482's observations. A controlled child-reporter test
fails at the repository filename assertion with that Base's reporter in the
deep attempt worktree and passes with relative locators. This establishes an
observation defect only; it does not establish the hosted timeout cause.
The `complete-delivery-host:*` label observes the inner host-use callback scope,
not the enclosing foundation/provider/run resources owned by
`withDecodedProductionRepositoryHost`. Its finish edge does not prove those
resources finalized. A gap before the outer fixture finalization starts still
leaves enclosing host work unresolved. Both existing scopes and their finalizers
are preserved.

The next required hosted diagnostic must retain all unmatched module/test IDs,
wait edges and inner/outer finalization edges alongside complete child output,
resource/ordering observations, exact source binding and stopped custody.
An isolated passing MCPAdvisory case does not supply that evidence or authorize
an unchanged broad retry. #479 remains open until a demonstrated owner receives
focused before/after proof and new exact-source hosted coverage completes.

On this Base plus the observation changes, the one-worker MCPAdvisory V8
coverage reproducer failed at `RunTermination` after its unchanged 30,000 ms
budget (47.67 s test, 61.15 s total). All preceding waits completed and both
scopes finalized; the bounded runner reported `stoppedWritersProven: true`.
This run overlapped local typecheck/lint, so it is not isolated resource evidence.
A changed diagnostic captured the fixture's journal/failures/Git calls at that
boundary before cleanup. It passed (52.26 s test, 62.36 s total), with termination
in 16.35 s, all four delivery finalities and no activation failures. Its child
exit was zero with stopped writers proved. The temporary capture was restored.
Neither run changed a deadline, assertion or acceptance selection in the
candidate; the four unselected variants are not qualified by these focused runs.

Competing causes remain resource contention, an intermittent termination wait,
and an independent unfinished hosted owner. The missing discriminating evidence
is a bounded hosted diagnostic's ordering/resource observations and unmatched
lifecycle/finalization edges on the exact observed source. No runtime repair or
complete-coverage success is claimed. Controlled observation tests, fresh
TypeScript/Effect typecheck, changed-file lint and documentation links passed;
no unchanged broad gate was retried. Dalph owns publication and tracker closure.
