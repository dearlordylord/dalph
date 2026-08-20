# Issue #221 verification and timing report

This report is implementation evidence for [issue #221](https://github.com/dearlordylord/dalph/issues/221).
It is a tooling-and-documentation artifact: it adds no Dalph runtime behavior,
workflow occurrence, journal record, retry, crash rule, or external-provider
call. The existing maintained capstone chronology remains the behavior
authority in
[`docs/scenarios/issue-167-controlled-provider-capstone.md`](../docs/scenarios/issue-167-controlled-provider-capstone.md).

## Operational-scenario exemption and acceptance map

Issue #221 is a semantics-preserving reconstruction/performance change. No
person-visible workflow outcome changes, so this report does not introduce a
second operational scenario. The existing ten-task scenario still maps to its
two named capstone assertions, and the reconstruction laws map to the focused
history/property tests:

| Existing scenario or outcome | Concrete result that remains required | Acceptance test or model check |
|---|---|---|
| Ten-task restart story | Capacity two, dependency waves, the same B/C Run and Attempt identities after one coordinator process death, late X discovery, accepted-result integration/finality, and terminal Run settlement remain unchanged. | `packages/dalph/test/cassettes/delivery-story-capstone.execution.test.ts`: `consumes a staggered graph while reconstructed positions delay restart-added X`; `preserves the double-diamond middle positions across coordinator restart` |
| Repeated read of one immutable prefix | A second projection/reconstruction request for the same prefix reuses the validated process-local result; a new process still starts from durable rows. | `packages/orchestrator/src/coordination/reconstruction/reduce.property.test.ts`: `reuses one validated result for repeated reads of the same immutable prefix`; focused journal/bootstrap/recovery tests |
| Accepted append | One valid successor advances the validated reconstruction and reusable indexes; unrelated or malformed successors retain the complete-replay answer and typed issues. | `packages/orchestrator/src/coordination/reconstruction/reduce.property.test.ts`: `advances every generated valid prefix to the same state and frontier as complete replay`; `keeps a prior prefix correct when a linear successor is rejected, then accepts a later successor`; `rejects generated malformed successors with the same issues as complete replay`; `packages/orchestrator/src/coordination/reconstruction/history.test.ts`: `reports the same terminating-record issue when an accepted terminated prefix is advanced` |
| Cold restart and malformed history | Recovery replays durable history and rejects the same invalid prefix; no process-local cache is treated as recovery authority. | Focused startup/recovery/history suites and the ten-task restart assertion above |

The tests above contain no wall-clock semantic assertions. The approximately
one-second aspiration is reported as environment-dependent evidence below; it
is not a test timeout or a pass/fail condition.

## Isolated capstone measurement

The measurement uses the unchanged ten-task capstone as an end-to-end
behavioral oracle. It runs only the capstone file, with one Vitest worker and
file parallelism disabled. The first invocation is a warm-up process; the
second invocation is the reported warm sample. “Warm” here means that the
package/module transform and filesystem caches have been exercised; each
invocation starts a fresh Node process, so no in-process reconstruction cache
is carried from one invocation to the next. The command does not enable V8
coverage, call Codex, call OpenAI, contact GitHub, or access a real target
repository.

### Environment

- Date: 2026-08-20 (America/Montreal)
- Repository revision: `e87c370c6` (implementation commit), based on
  `8415e1b81e08759d8f925af329c1a0b397b97efe`
- Node: `v24.18.0`
- pnpm: `10.29.3`
- Host: Linux `7.0.14-orbstack-00380-ga7e0a2dc9535`, `aarch64`
- Visible CPUs: 12; memory reported by the host: 58 GiB
- The host was otherwise shared; these are characterization samples, not a
  service-level promise.

### Command and result

```sh
pnpm exec vitest run \
  packages/dalph/test/cassettes/delivery-story-capstone.execution.test.ts \
  --maxWorkers=1 \
  --no-file-parallelism \
  --reporter=json \
  --outputFile=.scratch/issue-221-final-combined-warm.json
```

Two tests passed in each invocation. The shell's outer process intervals and
Vitest's per-assertion intervals were:

| Revision and invocation | Outer wall interval | First cached assertion | Second assertion | Result |
|---|---:|---:|---:|---|
| Base revision warm-up | 24.17 s | 19.041 s | 0.001 s | 2 passed |
| Base revision reported warm sample | 29.68 s | 24.725 s | 0.002 s | 2 passed |
| Implementation warm-up | 5.753 s | 3.285 s | 0.985 ms | 2 passed |
| Implementation reported warm sample | 5.842 s | 3.240 s | 0.614 ms | 2 passed |

The second assertion reads the same `Effect.cached` Run result, so its small
duration is not a second execution of the coordinator. The first assertion is
the capstone's actual production-shaped chronology. The implementation sample
is 7.6 times faster than the same host's reported base-revision assertion, but
3.240 seconds remains above the approximately one-second aspiration. The
aspiration is therefore not claimed as met. The chronology, records, and two
assertions are unchanged; the improvement comes from reusing exact immutable
journal prefixes, incrementally maintaining accepted indexes, indexing trace
and occurrence relationships once, and avoiding a duplicate delivery
evaluation for each captured publication.

The capstone's ten tasks cross substantially more than ten executor calls:
capacity and dependency-wave reads, one coordinator restart, exact task-work
positions, accepted executor results, outer Integrator evidence, Git target
validation and promotion, completion-claim replacement and deletion, tracker
completion finality, and terminal Run settlement. Replacing it with injected
reducer state would remove the acceptance evidence rather than optimize it.

## Critical path versus overlapping worker time

The isolated run above measures the capstone's own cache fill. It is not the
wall time of `pnpm test:coverage` or `pnpm check:all`:

- ordinary Vitest uses four workers and can run files concurrently;
- the sum of per-file or per-test intervals therefore double-counts periods
  that overlap on other workers;
- the ten-task capstone remains a wall-clock critical path when it is the
  slowest active worker, even if its interval is not added to every other
  worker's interval;
- coverage instrumentation adds counter collection and report serialization,
  so a covered-file interval is not the same measurement as the uninstrumented
  capstone command; and
- the quality-gate `tests and coverage` stage has a 300-second outer budget,
  while the capstone test declarations allow 600 seconds. The outer stage is
  consequently the effective bound when the full coverage stage runs.

Use the isolated command for capstone optimization and the full gate for
repository acceptance. Do not turn the approximately one-second target into a
wall-clock assertion: CPU contention, Node/Vitest startup, coverage workers,
and host scheduling are not workflow semantics.

## Test and gate family operating budget

“Current budget” below means the checked-in timeout or policy limit. “Target”
is an operating recommendation, not a semantic timeout. A row that says
“unchanged” deliberately preserves the existing fail-closed quality policy.

| Test or gate family | Purpose | When it runs | Current budget | Recommended target |
|---|---|---|---|---|
| Focused protocol, reducer, journal, delivery, and cassette tests | Prove one transition, decoder, projection, boundary, or small chronology with controlled providers. | During relevant edits; included in ordinary `pnpm test` and coverage. | Ordinary Vitest test timeout 10 s; coverage timeout 20 s unless a test overrides it. | Keep focused files comfortably below 1 s where practical; preserve named scenario ownership. |
| Generated journal-prefix property tests | Compare incremental advancement with complete replay for valid prefixes and compare malformed successors' typed issues. | Every reconstruction/index change and in ordinary coverage. | Same Vitest budgets above; no wall-clock assertion. | Seconds per property file with enough generated cases for mutation diversity; operation-count evidence may be added separately. |
| Cold restart and recovery tests | Prove a replacement process reconstructs only from durable rows and re-runs authority reconciliation. | Every reconstruction/recovery change; hosted quality gate. | Same focused-test budgets; no persisted-cache budget. | Keep complete replay mandatory and make cold/reused test layers explicit. |
| Maintained authored cassette catalog | Run each maintained story through the public production coordinator and controlled boundaries. | Relevant feature edits and ordinary coverage/CI. | Same Vitest budgets; catalog entries are independent. | Keep small stories routine; retain exact catalog-key failure evidence. |
| Ten-task delivery capstone | Compose capacity two, dependency waves, cold restart, exact identities, accepted-result finality, late X, and Run termination. | Relevant journal/delivery/recovery changes and once before handoff/CI. | Per-test declaration 600 s; the coverage stage containing it is 300 s. | Approximately 1 s warm execution as reported evidence; never enforce it as a semantic timeout or remove the chronology. |
| Aggregate tests and coverage | Run the ordinary suite and enforce production/maintained-evaluation coverage policy. | `pnpm check:all`, `pnpm check:ci`, and handoff. | Quality-gate stage 300 s; production metrics 99% statements/branches/functions/lines; maintained evaluation 75%. | Preserve thresholds; reduce runtime by measured architecture/harness work, not threshold or timeout weakening. |
| Build | Compile package outputs and declaration rewrites. | Every `pnpm check:all`/`check:ci`. | 120 s quality-gate stage. | Remain independently diagnosable within 120 s. |
| Production package boundary | Reject undeclared or reversed package dependencies. | Every `pnpm check:all`/`check:ci`. | 60 s. | Remain below 60 s with no exclusions for this change. |
| TypeScript typecheck | Check the strict shared TypeScript program. | Every `pnpm check:all`/`check:ci`; focused during implementation. | 120 s. | Remain below 120 s; no casts/non-null assertions to hide reconstruction errors. |
| Effect diagnostics | Make configured Effect errors/warnings fatal. | Every `pnpm check:all`/`check:ci`. | 180 s. | Remain below 180 s and keep warning policy unchanged. |
| Format and lint | Enforce dprint, Oxlint, and compatibility ESLint policies. | Every quality gate; focused after meaningful edits. | 120 s. | Remain below 120 s; add no baseline suppression for cache/index code. |
| Dependency cycles | Reject runtime import cycles. | Every quality gate. | 60 s. | Remain below 60 s. |
| Cyclomatic complexity | Enforce production complexity budget and baseline. | Every quality gate. | 60 s. | Remain below 60 s; no new suppression. |
| Duplication | Enforce the configured production duplication budget. | Every quality gate. | 60 s. | Remain below 60 s; do not duplicate event/index invalidation rules. |
| Project-memory scenarios | Run checked-in project-memory scenarios. | Every `check:all`/`check:ci`. | 60 s. | Remain below 60 s and retain collected scenario evidence. |
| Reducer Lab maintained evaluation | Typecheck, smoke, and build the maintained Lab cassettes. | Every `check:all`/`check:ci`. | 180 s. | Remain below 180 s; browser smoke remains a separate explicit check. |
| Reducer Lab browser smoke | Run maintained cassettes in hosted Chromium. | Explicit `pnpm check:lab:browser`, not the ordinary quality gate. | No quality-gate timeout; browser setup requires the documented pinned browser/system libraries. | Keep as an explicit environment-dependent check; do not fold it into semantic unit timing. |
| Quint-connected executable MBT | Run executable conformance adapters for checked-in Quint scenarios. | `pnpm check:all`; omitted by hosted `check:ci`. | 300 s quality-gate stage. | Remain below 300 s and retain all collected scenarios/negative controls. |
| Exhaustive Quint model gate | Run deterministic, sampled, mutation, and exhaustive formal model checks. | Once after final model-relevant changes and before integration; not `check:all`. | 360 s regression budget; 480 s safety timeout. | Preserve both bounds and successful negative controls; do not use this as a capstone wall-clock proxy. |
| Secret scan | Scan Git history for secrets. | Every `check:all`/`check:ci`. | 300 s. | Remain below 300 s with redacted diagnostics. |
| Quality-gate orchestration | Run stages fail-fast and bound successful output. | `pnpm check:all` locally and `pnpm check:ci` in hosted CI. | CI job 20 min; successful output maximum 400 lines; `check:ci` omits only Quint-connected MBT. | Preserve stage names, fail-closed exits, and compact diagnostics. |

The rows are not additive wall-clock estimates. Within Vitest, workers overlap;
within CI, the quality job runs stages sequentially; the isolated capstone
command intentionally removes worker overlap to expose its own critical path.
Report both the stage wall interval and summed worker/test intervals whenever a
future timing profile is collected.

## Verification commands

Focused evidence for this change should include the journal/history/property,
delivery, recovery, cassette, and capstone commands named above. Before
handoff, run the repository implementation gate:

```sh
pnpm check:all
```

Run formal checking once after the final relevant changes and before
integration:

```sh
pnpm check:quint
```

Neither command turns the benchmark aspiration into an elapsed-time assertion.
The final handoff should record the exact revision, command, environment, test
counts, and measured intervals, then map the results back to the scenario rows
at the top of this report.
