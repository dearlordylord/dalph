# Model 2 (M2) reconstructed-run and frontier conformance inventory

Model 2 is the Quint model for graph/frontier recovery. This inventory covers
reconstruction followed by the same runnable-frontier selector used without a
restart. Each row names the concrete actor, action, and boundary before the
canonical model property and executable lane.

`E` is the checked finite M2 profile, `S` is sampled Quint-connect replay, and
`P0`/`P1` are the in-memory and closed/reopened SQLite conformance-test cut
points, and `R` is a retained readable scenario with three perspective
evaluations under `specs/model-scenarios`.

| Cross-component invariant | Canonical M2 property or action | Executable lane |
| --- | --- | --- |
| The driver decodes one generated action and maps its bounded task and operation identities before it appends a journal event. | Closed reconstruction action map; `commitFirstIntent` | `frontier-recovery-conformance.test.ts` |
| A normalized target-closure membership read records explicit coverage, completeness, potentially mixed-time consistency, boundary freshness, and proven absence; a predecessor identity alone does not add coverage. | `observeProvenAbsence`; `observeIncomparableMembership`; `observeCompatibleReplacement` | named Quint-connect `S` lanes plus readable scenarios in `frontier-recovery-reconstruction.test.ts` |
| The workflow journal retains the exact ordered graph-read intent/outcome and claim intent while the graph-knowledge, responsibility, and pause reducers return distinct projections. | `everyEffectHasIntent`; `everyTaskIsActionableOrExplained` | `frontier-recovery-reconstruction.test.ts` exact production projections; `frontier-recovery-reconstruction.mbt.test.ts` (`S`) model projection |
| Observing target-closure membership does not create task responsibility. Recording task A's exact claim intent creates responsibility only for A. | `deterministicFirstAdmissionTest`; `commitFirstIntent(A)` | `frontier-recovery-reconstruction.test.ts` (`P0`, `P1`) |
| The orchestrator gives reconstructed responsibilities priority over fresh tasks, orders fresh tasks by canonical task identity, and lets one process-local controller reserve at most the configured capacity. At configured capacity one, independently eligible A and C both remain in the model-exported frontier, while only A is admitted and reserved and C's task identity carries `CapacityWait` plus `CapacityReleasedOrReconstructedStateChanged`. A second profile gives C an existing responsibility and proves that C precedes smaller fresh A. A complete restart rebuilds the same reserved positions from responsibility plus fresh invocation observations. | `boundedCapacity`; `everyTaskIsActionableOrExplained`; `frontierRecoveryCapacityOne`; `initCapacityOneResponsibilityFirstProfile`; `frontierRecoveryCapacityCounterexample` | both exhaustive capacity-one `E` profiles plus the expected capacity-only weakened counterexample; both capacity-one Quint-connect `S` profiles and capacity-two `S`; `runnable-frontier.test.ts`; fresh-memory and closed/reopened SQLite capacity-one/two lanes in `frontier-recovery-reconstruction.test.ts`; `responsibility-first-resume` (`R`) |
| A paused, dependency-blocked, isolated, or unreadable A does not prevent independently eligible C from receiving an available position. An empty transition set remains paired with an exact explanation and is not a run-termination fact. | `branchLocalConstraintDoesNotStopC`; `everyTaskIsActionableOrExplained`; `finalityIsSubjectSpecific` | readable capacity-one/two scenarios in `runnable-frontier.test.ts`; `unsettled-responsibility-prevents-termination` (`R`) |
| Closing the coordinator after the graph read or after task A's claim intent discards process-local state. A fresh control scope rereads the selected journal store and invokes the production managed-history reducer. | `crash`; `restart`; `crashAfterIntentRequiresFreshReadTest` | in-memory and closed/reopened SQLite `P0`/`P1` in `frontier-recovery-reconstruction.test.ts` |
| The sampled driver never assigns expected production state or derives another scheduler. It appends normalized controls, rereads the journal, invokes `reduceManagedHistory`, and at configured capacities one and two compares exact graph knowledge, workflow records, responsibility, pause, model-exported transition identities and tags, operation identities, explanation task/tag/wake-condition identities, capacity, occupied tasks, and controller reservations with the production selector and controller. | `frontierRecoveryCapacityOne`; `frontierRecoveryCapacityTwo`; `initCapacityOneResponsibilityFirstProfile`; `reconstructionStep`; the three named read profiles | two capacity-one and one capacity-two `frontier-recovery-reconstruction.mbt.test.ts` lanes (`S`) |

## Intentional omissions

- The tracker-mutation graph-fact lane is not applicable to the current
  production boundary: `TrackerMutationService` returns task-claim
  observations only.
  It has no normalized task or dependency/grouping-edge result carrying
  coverage, completeness, consistency, freshness, or replacement evidence.
  Treating claim-label mutation results as graph membership or edge facts
  would duplicate tracker authority, so this adapter intentionally does not
  manufacture them merely to create a positive lane.
  The first tracker mutation that returns normalized task or edge facts must
  add its production `TaskGraphFactsUpdated` event, reducer case, closed action
  mapping, negative conflict profile, and applicable `P0`–`P6` lanes in the
  same change.
- The reconstructed pause reducer currently exposes only `RunUnpaused` and
  `NoTaskPauses`. The first production pause command/event must extend M2, the
  adapter state comparison, and both reopening lanes together.
- P2–P6 do not apply to this issue's crash-before-claim-intent and
  crash-after-claim-intent acceptance slice. Later ambiguity-crossing boundary
  tickets extend the same manifest rather than redefining P0/P1.
