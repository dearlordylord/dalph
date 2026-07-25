# M2 reconstructed-run conformance inventory

This inventory covers the M2 slice before the Dalph orchestrator derives a
runnable frontier. Each row names the concrete actor, action, and boundary
before the canonical model property and executable lane.

`E` is the checked finite M2 profile, `S` is sampled Quint-connect replay, and
`P0`/`P1` are the in-memory and closed/reopened SQLite conformance-test cut
points.

| Cross-component invariant | Canonical M2 property or action | Executable lane |
| --- | --- | --- |
| The driver decodes one generated action and maps its bounded task and operation identities before it appends a journal event. | Closed reconstruction action map; `commitFirstIntent` | `frontier-recovery-conformance.test.ts` |
| A normalized target-closure membership read records explicit coverage, completeness, potentially mixed-time consistency, boundary freshness, and proven absence; a predecessor identity alone does not add coverage. | Fresh knowledge is required before `commitFirstIntent` | `reconstructed-managed-run.test.ts`; `frontier-recovery-reconstruction.mbt.test.ts` |
| The workflow journal retains the exact ordered graph-read intent/outcome and claim intent while the graph-knowledge, responsibility, and pause reducers return distinct projections. | `requestRequiresIntent`; `responsibilityHasActionOrReason` | `frontier-recovery-reconstruction.mbt.test.ts` (`S`) |
| Observing target-closure membership does not create task responsibility. Recording task A's exact claim intent creates responsibility only for A. | `deterministicFirstAdmissionTest`; `commitFirstIntent(A)` | `frontier-recovery-reconstruction.test.ts` (`P0`, `P1`) |
| Closing the coordinator after the graph read or after task A's claim intent discards process-local state. A fresh control scope rereads the selected journal store and invokes the production managed-history reducer. | `crash`; `restart`; `crashAfterIntentRequiresFreshReadTest` | in-memory and closed/reopened SQLite `P0`/`P1` in `frontier-recovery-reconstruction.test.ts` |
| The sampled driver never assigns expected production state or derives another scheduler. It appends normalized controls, rereads the journal, invokes `reduceManagedHistory`, and compares the returned projection. | `reconstructionStep` | `frontier-recovery-reconstruction.mbt.test.ts` (`S`) |

## Intentional omissions

- `TrackerMutationService` currently returns task-claim observations only.
  It has no normalized task or dependency/grouping-edge result carrying
  coverage, completeness, consistency, freshness, or replacement evidence.
  Therefore this slice does not manufacture mutation-origin graph facts.
  The first tracker mutation that returns normalized task or edge facts must
  add its production `TaskGraphFactsUpdated` event, reducer case, closed action
  mapping, negative conflict profile, and applicable `P0`–`P6` lanes in the
  same change.
- Runnable-frontier and admission projections are owned by issue #131. This
  adapter stops before that missing production selector and does not implement
  a test-only scheduler.
- The reconstructed pause reducer currently exposes only `RunUnpaused` and
  `NoTaskPauses`. The first production pause command/event must extend M2, the
  adapter state comparison, and both reopening lanes together.
- P2–P6 do not apply to this issue's crash-before-claim-intent and
  crash-after-claim-intent acceptance slice. Later ambiguity-crossing boundary
  tickets extend the same manifest rather than redefining P0/P1.
