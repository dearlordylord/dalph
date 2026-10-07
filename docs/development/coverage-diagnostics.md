# Identify an unfinished coverage owner

The coverage runner retains test lifecycle observations in its existing child
logs. `coverage:body` selects the compact reporter alongside Vitest's dot
reporter; this adds no Dalph workflow behavior, changes no test assertion or
deadline, and does not replace gate custody or its exit verdict.

Each `CoverageLifecycle` JSON line is written directly to stderr. Console
capture cannot postpone these observations until a test exits. A module emits queued/start/end and a test emits start/end with its Vitest test ID and UTC observation time. For the
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
scope adds two edges per variant and each of its six named waits adds two;
an expired wait adds one. Aggregate volume
therefore scales with the number of test edges, not their duration. Existing CI
child-log artifacts retain the observations without a new artifact transport.

Focused reproduction keeps the original acceptance case and V8 coverage; do
not extend deadlines or rerun unchanged full coverage on the strength of this
instrumentation alone. #479 owns the real hosted cause, any required repair and
successful complete coverage.
