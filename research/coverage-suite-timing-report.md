# Coverage-suite timing profile

This is a tooling-only measurement. It changes no Dalph runtime behavior and does not launch Codex, call OpenAI, or contact GitHub. The run used the ordinary controlled test providers with V8 coverage counters enabled.

## Measurement

- Commit: `aac2e608376cf2fa450209b8fe31d7a8fbeb4ca0`
- Command: `pnpm exec vitest run --mode coverage --coverage --coverage.reporter=json-summary --coverage.thresholds.lines=0 --coverage.thresholds.functions=0 --coverage.thresholds.branches=0 --coverage.thresholds.statements=0 --reporter=json --outputFile=.scratch/coverage-timings.json`
- Test files: 165
- Tests: 1533 passed, 2 skipped, 1535 total
- Measured wall interval: 315.8 s
- Sum of test-file intervals across parallel workers: 678.0 s

The summed file intervals are larger than wall time because Vitest runs files concurrently. Durations include asynchronous waits and child-process wall time; they are not literal CPU seconds. The JSON reporter does not separately expose global transform, import, V8 counter collection, or final coverage serialization time.

## Follow-up after the finality-event prefilter

A second full coverage run on the change now committed as `210731092` completed in 200.4 seconds
after integration-finality reconstruction began rejecting unrelated journal
event tags before invoking the full Effect Schema union parser. All 1,547
runnable tests passed and two were skipped. Compared with the original 315.8
second measured interval, this removes 115.4 seconds, or 36.5% of the wall
time. The follow-up used the compact dot reporter, so it does not provide a new
per-file timing table; the original detailed table below remains the evidence
for which files formed the prior critical path.

This optimization changes no cassette provider, workflow chronology, or
accepted result. Candidate finality tags still undergo the complete schema
validation, including malformed-event rejection; only events with unrelated
tags bypass that parser.

For comparison, an isolated current run of only the capstone, with one Vitest
worker and no coverage instrumentation, completed in 75.54 seconds wall time
(72.16 seconds inside the two tests, 77.37 seconds user CPU, and 1.90 seconds
system CPU). The first cached assertion consumed 72.16 seconds; the second
consumed 3 milliseconds. This is the relevant ordinary acceptance-test cost:
still substantial, but far below either the former 312.6-second covered file
interval or the five-minute outer quality-gate cutoff.

## What dominates the wall clock

The slowest file, `packages/dalph/test/cassettes/delivery-story-capstone.execution.test.ts`, took 312.6 s. That is 99.0% of the measured wall interval, so the overall run cannot finish materially sooner unless that capstone is shortened or split. The next two large consumers overlap with it on other workers: `packages/dalph/test/cassettes/scenario.test.ts` at 163.5 s and `scripts/quality-lint.test.ts` at 118.5 s.

## Why the capstone consumed 312.6 seconds

The file contains two assertion blocks, but they do not run the coordinator
twice. Both await the same `Effect.cached` value. The first assertion forces one
complete `runAuthoredScenarioCassette(deliveryInvariantStory)` execution; the
second reads the completed value. The reported 312.578-second assertion time is
therefore almost entirely the first cache fill, not the topology array checks
afterward.

That cache fill drives the composed production coordinator against controlled
providers. It does not call Codex, OpenAI, GitHub, or a target application. Its
342-item authored story contains:

| Boundary item | Count |
|---|---:|
| Delivery-action selections | 111 |
| Tracker graph returns | 42 |
| Executor reports | 20 |
| Promotion Git reads | 20 |
| Completion-claim reads | 20 |
| Focused completion reads | 20 |
| Work-specification reads | 14 |
| Current-claim reads | 11 |
| Coordinator activation returns | 10 |
| Candidate-agent reports | 10 |
| Candidate Git validations | 10 |
| Target verifications | 10 |
| Promotion compare-and-set results | 10 |
| Completion-claim replacements | 10 |
| Completion-task results | 10 |
| Completion-claim deletions | 10 |
| Coordinator process deaths | 1 |

The ten tasks therefore do substantially more than ten fake executor calls.
Each task crosses executor work, candidate construction, Git validation, target
verification, promotion, completion-claim replacement, tracker completion,
claim deletion, and finality settlement. Every durable append or provider
observation can publish a new delivery relation. Those publications repeatedly
derive actions and explanations from an increasingly large immutable journal.
Several validators also search the prior prefix for exact correlated intent,
observation, claim, and operation evidence. The result is a CPU-heavy series of
growing-history scans rather than a sleep or outside-service wait.

An isolated pre-optimization CPU sample of the capstone worker was active for
about 89.6 seconds, with only about 2.5 seconds attributed to idle time and
about 2 seconds to garbage collection. Representative inclusive samples were
about 30.6 seconds in Effect Schema AST work, 4.7 seconds in schema parsing,
14.2 seconds in Effect runtime evaluation, and 6.2 seconds in exact candidate
correlation serialization. These categories are call-stack samples and overlap;
they must not be added as a second wall-clock total.

The difference between that isolated worker sample and the original 312.6
second coverage-file interval has two contributors that the Vitest JSON report
cannot separate exactly:

1. V8 instruments the same hot production paths with statement, branch, and
   function counters and later converts those ranges into source coverage.
2. The file shares CPU with the 163.5-second broad cassette suite and the
   118.5-second repository-lint integration tests. Their intervals overlap the
   capstone instead of adding after it.

The follow-up prefilter is direct evidence for the largest identified hot path:
unrelated journal events no longer traverse the full integration-finality
schema union. With all tests still passing, the complete coverage run fell from
315.8 to 200.4 seconds. The remaining time is still production-coordinator and
coverage work; it is not model inference or network activity.

## Performance and test-design assessment

### What this test uniquely proves

The capstone is not ten independent executor examples placed in one file. It
proves one composed Run keeps its meaning while several mechanisms interact:

- capacity two admits and retains the expected overlapping task pairs;
- B and C keep the same Run and Attempt identities across process death;
- X becomes visible after the restart but cannot displace the reconstructed
  positions;
- every accepted executor result crosses candidate construction, Git
  validation, verification, promotion, tracker completion, exact
  completion-claim deletion, and settlement;
- a later complete tracker graph, rather than an executor or mutation response,
  releases the next dependency wave; and
- the Run terminates only after all ten responsibilities settle.

Focused protocol tests prove the individual steps more cheaply, and the
five-task diamond and A-to-B cassettes prove smaller compositions. They do not
prove this restart-plus-capacity-plus-late-X composition. The capstone therefore
has real acceptance value and should not be replaced by injected reducer state
or a copied expected frame.

The second test in the file is not a second expensive Run. Both tests share one
`Effect.cached` execution, so splitting the assertions into more test cases
would improve readability but would not reduce the cache-fill cost.

### Why the cost grows faster than the story length suggests

The controlled providers return immediately; the expensive part is the
production journal and delivery computation between those returns. On every
new journal record, the in-Run journal currently rebuilds the complete
reconstructed history before publishing the new state. Reconstruction itself
performs several complete-history passes. Delivery then derives current
responsibilities, evidence, frontier, and action proposals from that published
state. With an ever-growing journal, the Run pays for many prefixes of the same
history rather than processing each new record once.

The in-memory journal adapter adds smaller quadratic work: it scans existing
records for termination and duplicate keys and copies the immutable record
array on append. The authored runner also copies its publication array and,
after execution, projects every captured publication into a complete readable
delivery frame. Those costs are legitimate for a small test but become visible
when one story causes hundreds of publications.

This makes the capstone a useful scalability canary. Its former 312.6-second
duration exposed production-shaped replay amplification; the 36.5% whole-suite
improvement from one event-tag prefilter confirms that diagnosis. Treating the
test only as a slow fixture and deleting it would hide that signal.

### What should run when

| Development moment | Recommended execution |
|---|---|
| Editing one protocol, decoder, or pure projection | Run that module's focused tests. Do not pay for the capstone on every edit. |
| Editing the authored runner, journal reconstruction/publication, delivery planning, admission, restart recovery, integration finality, or the ten-task cassette | Run the capstone directly, without V8 coverage, after focused tests. |
| Before implementation handoff and on hosted CI | Run the capstone once as a named system-acceptance stage. It remains required evidence. |
| Repository coverage accounting | Eventually exclude the capstone from V8 instrumentation only after focused tests own all lines and branches it currently contributes. The acceptance stage must still run it once in the same gate. |
| Performance regression work | Use a separate non-covered performance test or operation-count invariant for reconstruction/publication scaling. Do not make semantic acceptance depend on a tight wall-clock threshold. |

The current harness does not make this distinction: `test:coverage` discovers
the capstone, and `check:all` gives the entire coverage stage five minutes. The
capstone itself has a ten-minute test timeout. Consequently, a failure reported
at exactly 300 seconds is the outer quality-gate watchdog terminating the
coverage stage, not the capstone reaching its own timeout. The detailed run
outside that watchdog completed naturally at 312.6 seconds; the optimized full
coverage run later completed at 200.4 seconds.

The clean long-term tiering is a dedicated, non-covered system-acceptance
command invoked once by `check:all` and `check:ci`, plus the ordinary covered
focused suite. That change must preserve the existing scenario-to-test mapping
and should land only after the focused suite replaces any unique coverage
currently supplied by the capstone.

### Engineering opportunities, in order

1. **Deepen incremental journal reconstruction.** Keep complete-prefix
   reconstruction for bootstrap and crash recovery, but give the live journal
   a seam that advances one already-valid reconstructed state with one exact
   next record. Property tests should prove incremental and complete replay
   yield the same state and reject the same invalid transitions. This targets
   the repeated full-history work without weakening recovery validation.
2. **Keep delivery publication evaluated once.** The runtime and the cassette
   observer currently derive overlapping information from the same input
   bundle. A deeper publication module could expose one evaluated immutable
   result to action planning and read-only observation, avoiding test-only
   recomputation while preserving one production workflow algebra.
3. **Index the in-memory journal adapter.** A private key index and terminal
   marker can remove repeated scans while retaining the same immutable public
   journal interface. This is smaller than reconstruction work and should not
   lead the effort.
4. **Separate acceptance from coverage instrumentation.** This reduces gate
   wall time and contention, but it is test harness tiering, not a substitute
   for fixing production-shaped scaling.

## Groups

| Group | Files | Tests | Summed file intervals | Share of summed intervals |
|---|---:|---:|---:|---:|
| Dalph maintained/authored cassettes | 9 | 225 | 508.028 s | 74.9% |
| Repository quality scripts | 9 | 26 | 122.401 s | 18.1% |
| Dalph application and host | 10 | 154 | 24.696 s | 3.6% |
| Orchestrator | 125 | 1061 | 15.388 s | 2.3% |
| Dalph production scenarios | 2 | 20 | 7.290 s | 1.1% |
| Contracts | 4 | 33 | 0.124 s | 0.0% |
| Dalph conformance | 2 | 11 | 0.089 s | 0.0% |
| Repository harness | 4 | 5 | 0.017 s | 0.0% |

## Every test file

Sorted by measured file interval. “Assertions” is the sum of individual assertion durations reported inside that file.

| File | Tests | File interval | Assertions |
|---|---:|---:|---:|
| `packages/dalph/test/cassettes/delivery-story-capstone.execution.test.ts` | 2 | 312.579 s | 312.578 s |
| `packages/dalph/test/cassettes/scenario.test.ts` | 145 | 163.491 s | 163.468 s |
| `scripts/quality-lint.test.ts` | 3 | 118.546 s | 118.543 s |
| `packages/dalph/src/application/linux-supervisor-exit.integration.test.ts` | 5 | 17.182 s | 17.181 s |
| `packages/dalph/test/cassettes/maintained-catalog-3.execution.test.ts` | 15 | 9.577 s | 9.574 s |
| `packages/dalph/test/cassettes/maintained-catalog-0.execution.test.ts` | 17 | 9.304 s | 9.302 s |
| `packages/dalph/test/scenarios/production.test.ts` | 18 | 7.277 s | 7.275 s |
| `packages/dalph/test/cassettes/maintained-catalog-1.execution.test.ts` | 16 | 6.889 s | 6.887 s |
| `packages/dalph/test/cassettes/maintained-catalog-2.execution.test.ts` | 15 | 5.968 s | 5.966 s |
| `packages/dalph/src/application/codex-app-server-protocol.test.ts` | 10 | 4.324 s | 4.322 s |
| `scripts/effect-diagnostics.test.ts` | 3 | 2.659 s | 2.658 s |
| `packages/orchestrator/src/workflow/registry/occurrence-projection.test.ts` | 28 | 1.801 s | 1.801 s |
| `packages/dalph/src/application/codex-app-server.test.ts` | 19 | 1.628 s | 1.627 s |
| `packages/orchestrator/src/authorities/git/node-worktree.test.ts` | 10 | 1.109 s | 1.108 s |
| `scripts/oxlint-project-plugin.test.ts` | 3 | 0.846 s | 0.847 s |
| `packages/orchestrator/src/coordination/run/pause-progress-observation.acceptance.test.ts` | 7 | 0.823 s | 0.822 s |
| `packages/orchestrator/src/coordination/run/pause-progress-observation.property.test.ts` | 16 | 0.648 s | 0.647 s |
| `packages/orchestrator/src/coordination/delivery/run-delivery-runtime.test.ts` | 32 | 0.557 s | 0.556 s |
| `packages/orchestrator/src/workflow-journal/store.test.ts` | 36 | 0.513 s | 0.512 s |
| `packages/orchestrator/src/coordination/delivery/ticket-delivery-projection.property.test.ts` | 2 | 0.498 s | 0.498 s |
| `packages/orchestrator/src/authorities/verification/repository-resource-lock.test.ts` | 16 | 0.467 s | 0.466 s |
| `packages/orchestrator/src/coordination/frontier/recovery.property.test.ts` | 2 | 0.463 s | 0.463 s |
| `packages/orchestrator/src/authorities/git/real-git-qualification.test.ts` | 4 | 0.459 s | 0.458 s |
| `packages/dalph/src/application/codex-app-server-public.test.ts` | 11 | 0.415 s | 0.415 s |
| `packages/orchestrator/src/coordination/reconstruction/reduce.property.test.ts` | 1 | 0.398 s | 0.398 s |
| `packages/orchestrator/src/workflow/protocols/attempt-choice/restart.test.ts` | 32 | 0.368 s | 0.367 s |
| `packages/orchestrator/src/workflow/protocols/attempt-choice/stop.test.ts` | 22 | 0.362 s | 0.359 s |
| `packages/orchestrator/src/workflow/protocols/integration-finality/completion-task-protocol.test.ts` | 37 | 0.342 s | 0.338 s |
| `packages/dalph/src/application/dry-run.test.ts` | 5 | 0.332 s | 0.332 s |
| `packages/dalph/src/application/codex-planned-attempt-executor.test.ts` | 68 | 0.314 s | 0.312 s |
| `packages/orchestrator/src/coordination/delivery/ticket-delivery-projection.test.ts` | 24 | 0.292 s | 0.289 s |
| `packages/orchestrator/src/coordination/delivery/journal.test.ts` | 17 | 0.292 s | 0.291 s |
| `packages/orchestrator/src/coordination/delivery/recovered-settlement-relation.test.ts` | 4 | 0.283 s | 0.283 s |
| `scripts/run-bounded-command.test.ts` | 3 | 0.279 s | 0.279 s |
| `packages/orchestrator/src/workflow/task-tracker-facts/observation.property.test.ts` | 2 | 0.272 s | 0.271 s |
| `packages/orchestrator/src/coordination/delivery/delivery.test.ts` | 20 | 0.269 s | 0.269 s |
| `packages/orchestrator/src/coordination/run/run.test.ts` | 5 | 0.259 s | 0.259 s |
| `packages/dalph/src/application/cli.test.ts` | 6 | 0.246 s | 0.246 s |
| `packages/dalph/src/application/codex-attempt-store.test.ts` | 24 | 0.241 s | 0.240 s |
| `packages/orchestrator/src/workflow/protocols/integration-candidate-construction/protocol.test.ts` | 24 | 0.238 s | 0.236 s |
| `packages/dalph/test/cassettes/authored-domain.property.test.ts` | 11 | 0.211 s | 0.210 s |
| `packages/orchestrator/src/workflow/protocols/integration-finality/completion-task-history.test.ts` | 12 | 0.201 s | 0.201 s |
| `packages/orchestrator/src/workflow/protocols/integration-finality/protocol.test.ts` | 26 | 0.192 s | 0.188 s |
| `packages/orchestrator/src/workflow/protocols/task-attempt-planning/plan.property.test.ts` | 8 | 0.189 s | 0.188 s |
| `packages/orchestrator/src/coordination/delivery/current-signal.property.test.ts` | 2 | 0.187 s | 0.187 s |
| `packages/orchestrator/src/workflow/protocols/target-promotion/protocol.test.ts` | 27 | 0.177 s | 0.176 s |
| `packages/orchestrator/src/coordination/run/journaled-run-bootstrap.test.ts` | 34 | 0.169 s | 0.168 s |
| `packages/orchestrator/src/authorities/task-tracker/graph.property.test.ts` | 1 | 0.168 s | 0.168 s |
| `packages/orchestrator/src/coordination/delivery/reactive-delivery-relations.test.ts` | 17 | 0.150 s | 0.151 s |
| `packages/orchestrator/src/authorities/coordinator-ownership/ownership.test.ts` | 19 | 0.149 s | 0.148 s |
| `packages/orchestrator/src/coordination/delivery/delivery-proposal-routes.test.ts` | 21 | 0.149 s | 0.149 s |
| `packages/orchestrator/src/authorities/task-tracker/github/graph-reader.test.ts` | 14 | 0.149 s | 0.149 s |
| `packages/orchestrator/src/workflow/protocols/integration-finality/history.test.ts` | 14 | 0.149 s | 0.148 s |
| `packages/orchestrator/src/workflow/protocols/integration-admission/protocol.test.ts` | 21 | 0.136 s | 0.135 s |
| `packages/orchestrator/src/coordination/run/run-stabilization.test.ts` | 7 | 0.130 s | 0.130 s |
| `packages/orchestrator/src/workflow/protocols/planned-attempt-executor-work/protocol.test.ts` | 34 | 0.116 s | 0.115 s |
| `packages/orchestrator/src/workflow/protocols/control-direction-application/protocol.test.ts` | 8 | 0.107 s | 0.106 s |
| `packages/orchestrator/src/workflow/protocols/attempt-choice/recovery.test.ts` | 3 | 0.097 s | 0.097 s |
| `packages/orchestrator/src/coordination/delivery/delivery-consequences.test.ts` | 9 | 0.094 s | 0.094 s |
| `packages/orchestrator/src/workflow/protocols/attempt-choice/restart-events.property.test.ts` | 2 | 0.090 s | 0.090 s |
| `packages/orchestrator/src/coordination/run/claim-reconciliation.test.ts` | 4 | 0.087 s | 0.087 s |
| `packages/orchestrator/src/workflow/task-tracker-facts/observation.test.ts` | 13 | 0.086 s | 0.085 s |
| `packages/orchestrator/src/coordination/frontier/recovery.test.ts` | 10 | 0.086 s | 0.086 s |
| `packages/orchestrator/src/coordination/application-exit/application-shell.test.ts` | 24 | 0.083 s | 0.083 s |
| `packages/orchestrator/src/coordination/reconstruction/history-scenarios.test.ts` | 17 | 0.077 s | 0.077 s |
| `packages/orchestrator/src/workflow/protocols/attempt-choice/events.property.test.ts` | 2 | 0.076 s | 0.076 s |
| `packages/orchestrator/src/workflow/protocols/target-verification/evidence-store.test.ts` | 9 | 0.072 s | 0.071 s |
| `packages/contracts/src/executor.property.test.ts` | 4 | 0.069 s | 0.069 s |
| `packages/dalph/test/conformance/delivery-service-convergence.test.ts` | 4 | 0.060 s | 0.060 s |
| `packages/orchestrator/src/coordination/frontier/integration-finality-frontier.test.ts` | 18 | 0.053 s | 0.054 s |
| `packages/orchestrator/src/workflow/protocols/target-verification/protocol.test.ts` | 14 | 0.051 s | 0.051 s |
| `packages/orchestrator/src/workflow/protocols/integration-finality/events.test.ts` | 11 | 0.044 s | 0.044 s |
| `packages/orchestrator/src/workflow/protocols/control-direction-application/protocol.property.test.ts` | 1 | 0.043 s | 0.043 s |
| `packages/contracts/src/planned-attempt.property.test.ts` | 4 | 0.042 s | 0.042 s |
| `packages/orchestrator/src/workflow/protocols/attempt-choice/control.test.ts` | 13 | 0.041 s | 0.042 s |
| `packages/orchestrator/src/workflow/protocols/planned-attempt-executor-work/conformance.test.ts` | 17 | 0.039 s | 0.038 s |
| `packages/orchestrator/src/authorities/task-tracker/claim-mutation.property.test.ts` | 1 | 0.038 s | 0.038 s |
| `packages/orchestrator/src/coordination/application-exit/executor-drain.test.ts` | 13 | 0.037 s | 0.037 s |
| `packages/orchestrator/src/workflow/protocols/target-verification/evidence-store.property.test.ts` | 1 | 0.037 s | 0.037 s |
| `packages/orchestrator/src/coordination/delivery/delivery-evaluation-consistency.test.ts` | 2 | 0.035 s | 0.036 s |
| `packages/orchestrator/src/coordination/delivery/delivery-colour.test.ts` | 3 | 0.035 s | 0.035 s |
| `packages/orchestrator/src/coordination/run/pause-progress-observation.coverage.test.ts` | 9 | 0.035 s | 0.034 s |
| `scripts/quality-file-discovery.test.ts` | 3 | 0.034 s | 0.035 s |
| `packages/orchestrator/src/coordination/run/recovery-duplicate-attempt.test.ts` | 2 | 0.031 s | 0.031 s |
| `packages/orchestrator/src/authorities/task-tracker/github/claim-mutation.test.ts` | 7 | 0.030 s | 0.030 s |
| `packages/dalph/test/conformance/support-boundaries.test.ts` | 7 | 0.029 s | 0.029 s |
| `packages/orchestrator/src/workflow-journal/journaled-interruptible-recovery.test.ts` | 2 | 0.027 s | 0.027 s |
| `packages/orchestrator/src/authorities/task-tracker/github/graphql-client.test.ts` | 3 | 0.027 s | 0.026 s |
| `packages/orchestrator/src/workflow-journal/journaled-cleanup-exit.test.ts` | 3 | 0.026 s | 0.027 s |
| `packages/orchestrator/src/workflow-journal/journaled-worktree-observation.test.ts` | 4 | 0.025 s | 0.025 s |
| `scripts/check-package-boundaries.test.ts` | 4 | 0.024 s | 0.024 s |
| `packages/orchestrator/src/workflow/protocols/integration-finality/controlled-boundaries.test.ts` | 12 | 0.023 s | 0.023 s |
| `packages/orchestrator/src/coordination/delivery/delivery-runtime-admission.test.ts` | 5 | 0.023 s | 0.023 s |
| `packages/orchestrator/src/coordination/run/recovery-activation.test.ts` | 1 | 0.023 s | 0.023 s |
| `packages/orchestrator/src/control/task-work-capacity.test.ts` | 6 | 0.022 s | 0.023 s |
| `packages/orchestrator/src/workflow-journal/journaled-claim-acquisition.test.ts` | 1 | 0.022 s | 0.022 s |
| `packages/orchestrator/src/coordination/delivery/journaled-graph-observation.test.ts` | 3 | 0.022 s | 0.021 s |
| `packages/orchestrator/src/coordination/application-exit/lifecycle.test.ts` | 8 | 0.021 s | 0.020 s |
| `packages/orchestrator/src/coordination/delivery/delivery-runtime-observation.test.ts` | 5 | 0.021 s | 0.020 s |
| `packages/orchestrator/src/authorities/task-tracker/graph-reader.contract.test.ts` | 8 | 0.021 s | 0.020 s |
| `packages/orchestrator/src/coordination/delivery/current-signal.test.ts` | 8 | 0.018 s | 0.018 s |
| `packages/orchestrator/src/coordination/frontier/frontier.test.ts` | 14 | 0.017 s | 0.018 s |
| `packages/orchestrator/src/workflow/protocols/target-verification/evidence-chain.property.test.ts` | 1 | 0.017 s | 0.017 s |
| `packages/orchestrator/src/workflow/protocols/integration-admission/accepted-result-evidence.test.ts` | 3 | 0.016 s | 0.015 s |
| `packages/orchestrator/src/workflow-journal/journaled-tracker-exit.test.ts` | 1 | 0.015 s | 0.015 s |
| `packages/orchestrator/src/coordination/reconstruction/integration-history.test.ts` | 14 | 0.015 s | 0.015 s |
| `packages/orchestrator/src/workflow/protocols/task-claim-acquisition/protocol.test.ts` | 7 | 0.015 s | 0.013 s |
| `packages/orchestrator/src/authorities/git/worktree.test.ts` | 12 | 0.014 s | 0.014 s |
| `packages/orchestrator/src/coordination/delivery/delivery-proposal.test.ts` | 9 | 0.014 s | 0.014 s |
| `packages/dalph/test/scenarios/generic-workflow.test.ts` | 2 | 0.013 s | 0.013 s |
| `packages/orchestrator/src/workflow/protocols/task-claim-release/protocol.test.ts` | 6 | 0.013 s | 0.012 s |
| `packages/orchestrator/src/workflow/protocols/task-claim-observation/protocol.test.ts` | 2 | 0.013 s | 0.013 s |
| `packages/orchestrator/src/workflow/protocols/task-claim-reacquisition/control.test.ts` | 2 | 0.012 s | 0.012 s |
| `packages/orchestrator/src/coordination/admission/integration-target-resource.test.ts` | 2 | 0.012 s | 0.013 s |
| `packages/orchestrator/src/workflow-journal/event-codec.test.ts` | 3 | 0.012 s | 0.012 s |
| `packages/orchestrator/src/workflow/protocols/integration-admission/accepted-result-evidence.property.test.ts` | 1 | 0.012 s | 0.012 s |
| `packages/orchestrator/src/authorities/git/target-lineage.test.ts` | 4 | 0.012 s | 0.012 s |
| `packages/orchestrator/src/workflow-journal/journaled-claim-observation.test.ts` | 1 | 0.011 s | 0.011 s |
| `packages/orchestrator/src/authorities/git/integration-candidate.test.ts` | 5 | 0.011 s | 0.011 s |
| `packages/orchestrator/src/authorities/task-tracker/claim-mutation.test.ts` | 4 | 0.011 s | 0.011 s |
| `packages/orchestrator/src/authorities/task-tracker/github/task-identity.property.test.ts` | 1 | 0.011 s | 0.011 s |
| `packages/orchestrator/src/workflow/protocols/attempt-choice/restart-events.test.ts` | 4 | 0.011 s | 0.010 s |
| `packages/orchestrator/src/authorities/task-tracker/github/real-qualification.test.ts` | 4 | 0.010 s | 0.010 s |
| `packages/orchestrator/src/coordination/frontier/task-claim-authority.test.ts` | 3 | 0.010 s | 0.010 s |
| `packages/orchestrator/src/coordination/reconstruction/history.test.ts` | 6 | 0.010 s | 0.011 s |
| `packages/orchestrator/src/workflow-journal/journaled-claim-release.test.ts` | 1 | 0.010 s | 0.010 s |
| `packages/orchestrator/src/workflow/protocols/planned-attempt-worktree-observation/protocol.test.ts` | 2 | 0.009 s | 0.009 s |
| `packages/orchestrator/src/workflow/protocols/planned-attempt-executor-work/traces.test.ts` | 1 | 0.009 s | 0.009 s |
| `packages/orchestrator/src/workflow/protocols/integration-finality/state.property.test.ts` | 1 | 0.009 s | 0.009 s |
| `packages/dalph/src/application/supervisor-exit.test.ts` | 5 | 0.009 s | 0.010 s |
| `packages/contracts/src/executor.test.ts` | 13 | 0.009 s | 0.008 s |
| `packages/orchestrator/src/workflow/protocols/task-claim-acquisition/plan.test.ts` | 2 | 0.009 s | 0.008 s |
| `packages/orchestrator/src/coordination/application-exit/lifecycle-decision.test.ts` | 13 | 0.009 s | 0.009 s |
| `packages/orchestrator/src/workflow/protocols/target-verification/evidence-chain.test.ts` | 3 | 0.009 s | 0.008 s |
| `packages/orchestrator/src/coordination/run/fresh-run-identity.test.ts` | 2 | 0.009 s | 0.008 s |
| `packages/orchestrator/src/authorities/task-tracker/graph.test.ts` | 4 | 0.008 s | 0.009 s |
| `scripts/quint-temporal-gate.test.ts` | 3 | 0.008 s | 0.007 s |
| `packages/orchestrator/src/workflow/registry/operation.test.ts` | 2 | 0.007 s | 0.007 s |
| `test/delivery-story-link.test.ts` | 1 | 0.007 s | 0.007 s |
| `packages/orchestrator/src/coordination/delivery/integration-exit-boundary.test.ts` | 9 | 0.006 s | 0.005 s |
| `packages/orchestrator/src/authorities/task-tracker/task-revision-fingerprint.test.ts` | 1 | 0.006 s | 0.006 s |
| `packages/dalph/src/application/dry-run-planned-attempt-executor.test.ts` | 1 | 0.005 s | 0.005 s |
| `packages/contracts/src/git-locator.test.ts` | 12 | 0.005 s | 0.006 s |
| `packages/orchestrator/src/coordination/run/integration-stage-context.test.ts` | 2 | 0.005 s | 0.005 s |
| `packages/dalph/test/cassettes/authored-presentation.test.ts` | 2 | 0.005 s | 0.004 s |
| `packages/dalph/test/cassettes/authored-domain.test.ts` | 2 | 0.004 s | 0.004 s |
| `packages/dalph/src/presentation/stdio-trace-output.test.ts` | 1 | 0.004 s | 0.004 s |
| `packages/orchestrator/src/coordination/reconstruction/state.test.ts` | 1 | 0.004 s | 0.004 s |
| `test/harness.test.ts` | 1 | 0.004 s | 0.004 s |
| `packages/orchestrator/src/coordination/run/current-delivery-frame.test.ts` | 1 | 0.004 s | 0.004 s |
| `packages/orchestrator/src/coordination/reconstruction/run-policy-history.test.ts` | 1 | 0.004 s | 0.004 s |
| `packages/orchestrator/src/control/policy.test.ts` | 1 | 0.003 s | 0.003 s |
| `packages/orchestrator/src/workflow/protocols/git-reconciliation/decision.test.ts` | 6 | 0.003 s | 0.004 s |
| `packages/orchestrator/src/workflow/protocols/git-reconciliation/frontier-adapter.test.ts` | 2 | 0.003 s | 0.003 s |
| `packages/orchestrator/src/coordination/timing/control-plane-budgets.test.ts` | 2 | 0.003 s | 0.003 s |
| `scripts/control-plane-budget-doc.test.ts` | 2 | 0.003 s | 0.003 s |
| `packages/orchestrator/src/coordination/run/fresh-workflow.test.ts` | 4 | 0.003 s | 0.003 s |
| `packages/orchestrator/src/coordination/admission/capacity.test.ts` | 1 | 0.003 s | 0.003 s |
| `packages/orchestrator/src/coordination/frontier/integration-candidate-progress.test.ts` | 1 | 0.003 s | 0.003 s |
| `packages/orchestrator/src/workflow/task-tracker-facts/focused-completion-observation.test.ts` | 2 | 0.002 s | 0.002 s |
| `packages/orchestrator/src/workflow/protocols/planned-attempt-executor-work/evidence.test.ts` | 5 | 0.002 s | 0.003 s |
| `test/coverage-threshold.test.ts` | 2 | 0.002 s | 0.002 s |
| `packages/orchestrator/src/coordination/reconstruction/claim-release-history.test.ts` | 1 | 0.002 s | 0.002 s |
| `scripts/quality-output-budget.test.ts` | 2 | 0.002 s | 0.002 s |
| `packages/orchestrator/src/authorities/task-tracker/github/qualification-issue-72.test.ts` | 1 | 0.000 s | 0.000 s |

## Individual tests taking at least 500 ms

| Test file | Test | Duration |
|---|---|---:|
| `packages/dalph/test/cassettes/delivery-story-capstone.execution.test.ts` | consumes a staggered graph while reconstructed positions delay restart-added X | 312.576 s |
| `scripts/quality-lint.test.ts` | compatibility lint restores immutable-data and whole-project unused-export checks | 68.002 s |
| `packages/dalph/test/cassettes/scenario.test.ts` | runs the five-task controlled-provider diamond through exact accepted-result finality | 52.874 s |
| `scripts/quality-lint.test.ts` | staged lint runs compatibility policy over the discovered project | 49.622 s |
| `packages/dalph/test/cassettes/scenario.test.ts` | alpha-renames every Dalph-generated identity and preserves tracker revisions, task revisions, and Git SHAs | 9.207 s |
| `packages/dalph/src/application/linux-supervisor-exit.integration.test.ts` | a successor Linux child acquires the coordinator lock after zero success and nonzero failed or timed-out Exit | 8.333 s |
| `packages/dalph/src/application/linux-supervisor-exit.integration.test.ts` | repeated SIGTERM joins the original stuck Linux child drain and exits nonzero at five seconds | 5.725 s |
| `packages/dalph/test/cassettes/scenario.test.ts` | releases B only after A's accepted-result finality in one Run | 5.416 s |
| `packages/dalph/test/cassettes/scenario.test.ts` | notifies the read-only delivery observer before returning the terminal authored result | 5.342 s |
| `packages/dalph/test/cassettes/scenario.test.ts` | lowers capacity while A holds a position and admits B only after A releases it | 4.503 s |
| `packages/dalph/test/cassettes/scenario.test.ts` | retains every conflicting production proposal owner in the delivery frame | 4.120 s |
| `packages/dalph/test/cassettes/scenario.test.ts` | projects every isolated action-planning issue through its typed maintainer meaning | 3.703 s |
| `packages/dalph/test/cassettes/scenario.test.ts` | Dalph confirms A before a later graph read releases B | 3.688 s |
| `packages/dalph/test/cassettes/scenario.test.ts` | Dalph checks A after losing the tracker completion response | 3.509 s |
| `packages/dalph/test/cassettes/scenario.test.ts` | The later complete graph gives the current reason B may proceed | 3.424 s |
| `packages/dalph/test/cassettes/scenario.test.ts` | Restart keeps B blocked between A's success confirmation and the later graph | 3.133 s |
| `packages/dalph/test/cassettes/scenario.test.ts` | Alice sees task A and grouping child D reach their exact Pause boundaries | 2.672 s |
| `packages/dalph/test/cassettes/maintained-catalog-3.execution.test.ts` | runs maintained authored cassette currentCompletionGraphAuthority through the composed production coordinator | 2.328 s |
| `packages/dalph/test/cassettes/scenario.test.ts` | preserves accepted tracker completion when a prerequisite concurrently reopens | 2.287 s |
| `packages/dalph/test/cassettes/scenario.test.ts` | projects reacquisition and non-exact executor evidence through the authored assertion boundary | 2.146 s |
| `packages/dalph/test/cassettes/maintained-catalog-1.execution.test.ts` | runs maintained authored cassette completionGraphRefreshRecovery through the composed production coordinator | 2.035 s |
| `packages/dalph/test/cassettes/scenario.test.ts` | reconciles ambiguous stoppage and claim release across later activations without duplicates | 2.000 s |
| `packages/dalph/test/cassettes/scenario.test.ts` | records no P2 when fresh restart authority is changed, unreadable, or non-ready | 1.809 s |
| `packages/dalph/test/cassettes/maintained-catalog-0.execution.test.ts` | runs maintained authored cassette taskPauseExecutorAndPromotionBoundaries through the composed production coordinator | 1.784 s |
| `packages/orchestrator/src/workflow/registry/occurrence-projection.test.ts` | projects a large journal without rescanning each retained prefix | 1.738 s |
| `packages/dalph/test/cassettes/maintained-catalog-3.execution.test.ts` | runs maintained authored cassette ambiguousCompletionResponse through the composed production coordinator | 1.654 s |
| `packages/dalph/test/cassettes/scenario.test.ts` | A tracker client changes A while Dalph's completion request is pending | 1.611 s |
| `packages/dalph/test/cassettes/scenario.test.ts` | uses the injected projection when the public Run entry reconstructs an ambiguous executor command | 1.499 s |
| `packages/dalph/test/cassettes/scenario.test.ts` | Alice sees current grouping facts add D to task A's Pause | 1.492 s |
| `packages/dalph/src/application/linux-supervisor-exit.integration.test.ts` | a running controlled executor suspends before its Linux child exits zero | 1.490 s |
| `packages/dalph/test/cassettes/scenario.test.ts` | reconstructs both retained holders and blocks C through a contracted capacity | 1.454 s |
| `packages/dalph/test/cassettes/scenario.test.ts` | runs maintained conflict, unreadable-Git, correction, exhaustion, and contradiction stories | 1.436 s |
| `packages/dalph/src/application/codex-app-server-protocol.test.ts` | maps malformed thread and turn state to typed protocol failures | 1.433 s |
| `packages/dalph/test/cassettes/scenario.test.ts` | settles a promoted authored task through the real completion-claim boundary | 1.414 s |
| `packages/dalph/test/cassettes/maintained-catalog-0.execution.test.ts` | runs maintained authored cassette deliveryFinalitySpine through the composed production coordinator | 1.407 s |
| `packages/dalph/test/cassettes/maintained-catalog-0.execution.test.ts` | runs maintained authored cassette prerequisiteReopensDuringCompletion through the composed production coordinator | 1.405 s |
| `packages/dalph/test/scenarios/production.test.ts` | publishes each accepted executor report before continuing and stops after Terminal | 1.264 s |
| `packages/dalph/test/cassettes/scenario.test.ts` | round-trips every non-submitting integration-agent report | 1.184 s |
| `packages/dalph/test/cassettes/scenario.test.ts` | reconciles a lost promotion response and never sends a fourth request | 1.165 s |
| `packages/dalph/test/cassettes/scenario.test.ts` | preserves late Accepted evidence without P1 integration and still replaces P1 after fresh checks | 1.078 s |
| `packages/dalph/src/application/codex-app-server.test.ts` | fails closed when a prior app-server cannot be stopped or never becomes absent | 1.070 s |
| `packages/dalph/test/cassettes/scenario.test.ts` | reports mismatches through the surface that owns the current story item | 1.033 s |
| `scripts/effect-diagnostics.test.ts` | the strict diagnostics runner also fails a warning severity | 1.030 s |
| `packages/dalph/src/application/linux-supervisor-exit.integration.test.ts` | signal receipt, scope closure, and unexpected death leave only the ordinary journal prefix | 1.022 s |
| `packages/dalph/test/cassettes/maintained-catalog-2.execution.test.ts` | runs maintained authored cassette contractedCapacityRetainsTwoAttempts through the composed production coordinator | 0.970 s |
| `packages/dalph/test/cassettes/scenario.test.ts` | records and alpha-renames verification terminal and contradiction occurrences | 0.963 s |
| `packages/dalph/test/cassettes/scenario.test.ts` | reconstructs P2 after replacement and never allocates P3 | 0.948 s |
| `scripts/quality-lint.test.ts` | repository lint rejects a native warning and keeps diagnostics bounded | 0.919 s |
| `packages/dalph/test/cassettes/scenario.test.ts` | reconstructs and round-trips interrupted and settled completion-cleanup Run prefixes | 0.904 s |
| `packages/dalph/test/cassettes/scenario.test.ts` | seals every non-passing public-wrapper terminal without promoting M | 0.890 s |
| `packages/dalph/test/cassettes/scenario.test.ts` | safely suspends changed A while independent B continues for membership, specification, lifecycle, and external success | 0.886 s |
| `packages/dalph/test/cassettes/maintained-catalog-2.execution.test.ts` | runs maintained authored cassette completionTaskConflict through the composed production coordinator | 0.866 s |
| `scripts/effect-diagnostics.test.ts` | Effect warning and error severities make a floating effect fail | 0.865 s |
| `packages/dalph/test/cassettes/scenario.test.ts` | records compatible target advancement and isolates a proven target rewrite in maintained cassettes | 0.854 s |
| `packages/dalph/test/cassettes/scenario.test.ts` | keeps Restart unproved while P1 is Running and mutates no claim or worktree | 0.846 s |
| `packages/dalph/test/cassettes/maintained-catalog-3.execution.test.ts` | runs maintained authored cassette taskPauseGroupingFactsAdded through the composed production coordinator | 0.845 s |
| `packages/dalph/test/cassettes/maintained-catalog-1.execution.test.ts` | runs maintained authored cassette changedAttemptStopLostThirdSuspension through the composed production coordinator | 0.837 s |
| `packages/dalph/test/cassettes/maintained-catalog-3.execution.test.ts` | runs maintained authored cassette changedAttemptRestartAfterSupersessionCrash through the composed production coordinator | 0.836 s |
| `packages/dalph/test/cassettes/maintained-catalog-3.execution.test.ts` | runs maintained authored cassette targetPromotionAmbiguityExhaustion through the composed production coordinator | 0.828 s |
| `packages/dalph/test/cassettes/scenario.test.ts` | records a foreign claim after process death and safely suspends only its exact attempt | 0.815 s |
| `packages/dalph/test/cassettes/scenario.test.ts` | deletes only the exact completion claim after focused task success | 0.806 s |
| `packages/dalph/test/cassettes/maintained-catalog-0.execution.test.ts` | runs maintained authored cassette taskUnpauseDuringSuspensionRestarts through the composed production coordinator | 0.777 s |
| `packages/dalph/test/cassettes/scenario.test.ts` | records completion finality after valid candidate verification and promotion history | 0.771 s |
| `scripts/effect-diagnostics.test.ts` | a clean Effect diagnostic run succeeds with compact JSON output | 0.764 s |
| `packages/dalph/test/cassettes/scenario.test.ts` | stops implementation without mutating an absent or foreign claim | 0.742 s |
| `packages/dalph/test/cassettes/scenario.test.ts` | does not release the claim while an exact writer may remain | 0.732 s |
| `packages/dalph/test/cassettes/scenario.test.ts` | round-trips pending Git failure and correction-limit candidate evidence | 0.722 s |
| `packages/dalph/test/cassettes/maintained-catalog-3.execution.test.ts` | runs maintained authored cassette prePromotionBlockerRecovery through the composed production coordinator | 0.720 s |
| `packages/dalph/test/cassettes/scenario.test.ts` | preserves promoted M across a post-promotion blocker and resumes its same finality proof after clear | 0.699 s |
| `packages/dalph/test/cassettes/scenario.test.ts` | records stale H2 and never overwrites it | 0.692 s |
| `packages/dalph/test/cassettes/scenario.test.ts` | separates every coordinator activation in a multi-restart delivery timeline | 0.692 s |
| `packages/dalph/src/application/codex-app-server-protocol.test.ts` | keeps every real RPC operation failure typed at its public boundary | 0.688 s |
| `packages/dalph/test/cassettes/scenario.test.ts` | durably waits after an unreadable blocker restart read and resumes only on later complete facts | 0.682 s |
| `packages/dalph/src/application/codex-app-server-protocol.test.ts` | reconciles valid turn markers, metadata, status, and correlation through public reads | 0.666 s |
| `packages/dalph/test/cassettes/scenario.test.ts` | records one atomic P1 to P2 replacement before ordinary clean successor work | 0.646 s |
| `packages/dalph/test/cassettes/scenario.test.ts` | preserves promotion proof and waits before tracker completion on a new blocker | 0.622 s |
| `packages/dalph/src/application/linux-supervisor-exit.integration.test.ts` | an idle Linux child reports successful Exit and status zero after SIGTERM | 0.611 s |
| `packages/dalph/test/scenarios/production.test.ts` | reconciles an exact projected executor report through ordinary Run entry (Running) | 0.605 s |
| `packages/dalph/test/cassettes/scenario.test.ts` | records both task fingerprints when Alice continues the exact attempt | 0.604 s |
| `packages/dalph/test/cassettes/scenario.test.ts` | preserves the candidate and releases integration when a blocker appears before promotion | 0.602 s |
| `packages/dalph/src/application/codex-app-server-protocol.test.ts` | normalizes background terminal observations and rejects unsafe terminal controls | 0.599 s |
| `packages/dalph/test/cassettes/scenario.test.ts` | Alice unpauses task A before its Pause observation confirms | 0.596 s |
| `packages/dalph/test/cassettes/scenario.test.ts` | discovers M in current target ancestry after losing the promotion response | 0.591 s |
| `packages/dalph/test/cassettes/scenario.test.ts` | promotes verified M by exact compare-and-set and records exact ancestry | 0.578 s |
| `packages/dalph/test/scenarios/production.test.ts` | reprojects the exact executor state after process loss on a second ordinary Run activation without a duplicate command | 0.572 s |
| `packages/dalph/test/scenarios/production.test.ts` | establishes an absent Run before its first tracker read and activates it once | 0.570 s |
| `packages/dalph/test/cassettes/maintained-catalog-0.execution.test.ts` | runs maintained authored cassette changedAttemptStopReleaseResponseLost through the composed production coordinator | 0.551 s |
| `packages/dalph/test/scenarios/production.test.ts` | ticket delivery reads Git after ambiguous worktree creation and preserves the exact registration | 0.549 s |
| `packages/dalph/test/cassettes/scenario.test.ts` | preserves every exact resource when executor stoppage is unproved | 0.547 s |
| `packages/dalph/test/cassettes/maintained-catalog-2.execution.test.ts` | runs maintained authored cassette prePromotionBlockerClearAndSupersession through the composed production coordinator | 0.543 s |
| `packages/dalph/test/cassettes/scenario.test.ts` | releases only the freshly confirmed exact claim after Stop | 0.539 s |
| `packages/dalph/test/cassettes/scenario.test.ts` | labels the 100-task four-read encoding experiment as a baseline | 0.536 s |
| `packages/dalph/test/cassettes/scenario.test.ts` | durably reconciles an unresolved claim release through bounded later activations | 0.517 s |
| `packages/dalph/test/cassettes/maintained-catalog-1.execution.test.ts` | runs maintained authored cassette targetPromotionLostResponseDiscoversCurrentCandidate through the composed production coordinator | 0.511 s |

## Reading the result

- The 312.6-second capstone cassette is the wall-clock critical path.
- The broad cassette scenario file and repository lint integration tests are the next largest independent groups, but most of their time overlaps the capstone.
- The complete orchestrator test corpus contributes about 15.4 summed seconds in this run.
- Coverage instrumentation is external to cassette semantics. A normal cassette run executes the same controlled workflow without V8 counters.
- This profile is a single run on a shared host. It identifies order-of-magnitude bottlenecks; sub-second rankings should not be treated as stable benchmarks.
