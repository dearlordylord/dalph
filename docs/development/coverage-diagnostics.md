# Identify an unfinished coverage owner

## Recorded round-trip validation owner

The complete-delivery tests compare every journal checkpoint through
`verifyRecordedCassetteRoundTrip`. Its successful path validates the cassette
envelope and newly visited entries at each checkpoint, rather than revalidating
all earlier entries. A schema failure still parses the complete visited prefix
to retain the cold parser's exact entry index and diagnostic. Entries beyond
the current checkpoint remain unread. Exhausted shorter cassettes still produce
a comparison at every remaining source checkpoint.

This changes verification cost only: the helper compares recorded history and
does not execute Dalph workflow operations. Source history and recorded history
still receive independent causal validation, and all four checkpoint comparisons
remain. `recorded-prefix-parity.property.test.ts` retains the independent cold
oracle, generated source/recording perturbations, invalid suffix and envelope
checks, exact nested schema diagnostics, causal failure cursor, shorter repeated
prefixes, and a field-read regression that fails with whole-prefix validation.
Crashes and retries do not apply to this synchronous comparison helper; process
custody remains the surrounding verification supervisor's responsibility.

The retained #479 worker profile on `bcd0f7b4d0a8ad49413325f374f9f5e0f96a6bd3`
measured 14.22 seconds in this helper, including 10.77 seconds in Schema
validation. That demonstrates repeated validation cost; it does not establish
the exact exception identity of the earlier hosted failures. Required hosted
coverage must complete on the repaired exact source with stopped custody before
#479 can be accepted.

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

### Exact local evidence binding

The first focused reproducer used the test/tool source bytes committed in
`c98d1138df86a9a9755a2cae1da6031a3c5a22c4` (documentation was committed later).
The passing temporary diagnostic used those same helper/reporter bytes and the
captured acceptance file with SHA-256
`9f1696284d7ce06222cd224d98adc05481b67cdff3d2cca792becd9ea4802da4`.
The restored acceptance source SHA-256 is
`7a43038d61c8efe20ee0d870b1c3c6ae6c54ba7cd08e8031d11498007ae6595e`.
Neither is evidence for subsequent source changes.

Complete local logs and source/hash manifests are retained outside the attempt
worktree at
`/workspace/dalph-dogfood/issue-479-20261007/evidence/termination-diagnostic/`:
`focused.log`, `termination-diagnostic.log`, `termination-snapshot.json`,
`acceptance-diagnostic.ts`, `diagnostic-source.json`, `diagnostic-result.json`,
and `evidence-manifest.json`. The original run's downloaded child logs and
coverage envelope remain under `retained/` and `envelope/` there.

Both commands used the existing bounded command runner with a 120,000 ms
allowance, unchanged 60,000 ms test timeout, and the following child arguments:

```bash
mise exec -- pnpm exec vitest run \
  packages/dalph/src/application/production-complete-delivery.acceptance.test.ts \
  --mode=coverage --coverage --coverage.reporter=json-summary \
  --coverage.reportsDirectory=.scratch/issue-479/coverage \
  --maxWorkers=1 --reporter=dot \
  --reporter=./scripts/coverage-lifecycle-reporter.ts \
  -t 'discovered by MCPAdvisory'
```

The passing changed diagnostic used
`.scratch/issue-479/diagnostic-coverage` instead and temporarily captured the
journal/failures/Git calls on wait exit. Its journal has positions, not
wall-clock timestamps: termination at position 532 and 688 tracker calls do
not date intermediate delivery steps. Only the retained lifecycle timestamps
establish the 16.35-second termination wait. A missed observation is not proved.

### Parent-owned hosted diagnostic

Manual CI dispatch accepts `coverage-diagnostics=true`. It enables
`DALPH_COVERAGE_RESOURCE_OBSERVATIONS=1` only for coverage, passes that value
through the isolated account's cleared environment, and uploads the complete
child logs even on success. Each lifecycle edge gains one adjacent
`CoverageResources` line with UTC time, PID, cumulative user/system CPU,
resident memory, available parallelism and one-minute host load. Wait/scope
samples describe the worker; reporter samples describe the reporter process.
Compare CPU deltas only within one PID. Host load is a gauge, not causal
attribution, and no samples poll between edges. Controlled child integration
proves distinct reporter/worker PIDs, matched edges and at most 16 KiB combined
output for the five-test control. Default coverage emits no resource samples.
This is test observation and CI artifact routing; production runtime, workflow
algebra, accepted variants, stage budgets and custody remain unchanged.

After the parent publishes the reviewed exact diagnostic candidate to its
owned ref, it can dispatch exactly once:

```bash
gh workflow run ci.yml --ref <parent-published-diagnostic-ref> \
  -f coverage-diagnostics=true \
  -f comparison-base=8bb1ddf085201b66d5c2832cdcde2befe872c75a
```

Bind the dispatched `head_sha` and the coverage envelope's candidate/source
receipt to that candidate and the explicit comparison Base. Missing or
malformed manual Bases remain unproven before a coverage child starts. The existing coverage child retains its
35-minute bound and the suffix job its 51-minute bound. The parent must record
its absolute stop time before dispatch and retain the full coverage child log,
envelope and stopped-writer evidence. If the run cannot identify the owner,
keep #479 open. No required hosted result has been observed for this diagnostic
candidate yet; its control checks are not qualification.
