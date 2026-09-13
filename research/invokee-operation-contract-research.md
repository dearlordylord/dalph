# First-milestone attached-operation contract research

Status: source-only research on 2026-09-13 at
`f99a2343f5b5d90c08e84b536ffab4a8d562b1fb`. This note is evidence for a later
scenario/specification round. It does not select a frozen architecture, add a
supported API, or change production behavior.

## Concrete operator events

Alice attaches to one already-selected production Run. She needs to observe the
current delivery state, follow later state changes, read and revision-check
capacity, ask an unpaused owner to run another ordinary pass, or durably apply
Run Unpause. Those actions have different completion facts:

- reading and watching are passive views of the current runtime publication;
- capacity change completes after a durable revisioned policy change;
- wake completes after the process-local owner handles a hint, before any
  activation or outside read completes;
- a successful full Unpause call completes after the control record and
  bootstrap-to-owner callback; host ownership lets that full call survive a
  request disconnect; and
- a refresh request maps to the existing tracker-notification hint; optional
  task IDs are advisory and neither narrow the complete graph read nor prove
  that a read completed.

Keeping these events separate is required to describe truthful results.

Today the callback receives observations and application Exit, but no owner or
operator controls. The production Run layer itself retains the workflow and
reactivation services through `provideMerge`; `withDecodedProductionRepositoryHost`
then projects only `ProductionHostObservation`
([production-host.ts](../packages/dalph/src/application/production-host.ts#L541),
[callback projection](../packages/dalph/src/application/production-host.ts#L556)).
A future attached adapter must use services from that one built Run context. It
must not construct a second bootstrap, owner, or runtime.

## Read and watch

`ProductionHostObservation.current` is the read-only
`CurrentSignal<DeliveryRuntimeObservationState>` from the already-built Run
([production-host.ts](../packages/dalph/src/application/production-host.ts#L68)).
`CurrentSignal.get` reads the current value. One `attach` returns a current value
and the loss-free stream belonging to that same scoped subscription; the
declarative `changes` stream prepends current automatically
([relations.ts](../packages/orchestrator/src/coordination/delivery/relations.ts#L62)).
Observation never invokes the tracker, scheduler, or executor.

The state is already a three-way lifecycle:

- `NotReady`: no runtime publication is available yet;
- `Ready`: one coherent evaluation and live-owner snapshot; and
- `Closed`: the retained final `Ready`, if any.

The source publishes `Closed`, refuses later publications, then ends the signal
([delivery-runtime-observation.ts](../packages/orchestrator/src/coordination/delivery/delivery-runtime-observation.ts#L293)).
The graph-stream experiment separately observed current-first reconnect, later
updates, retained terminal state, and EOF on an unchanged production host.

**Smallest recommended names:** `readSnapshot({ runId })` and
`watchSnapshots({ runId })`, returning the same wire-safe projection of
`NotReady | Ready | Closed`. A watch must use one `attach`, send its `current`,
then consume that attachment's `changes`. A combined snapshot is the
implementable default because graph, frontier, classifications, and accepted
position come from one runtime publication. Splitting status and graph is a UI
choice, but independently timed reads must not be described as one coherent
snapshot.

Every request names the selected `RunId`. If it differs from the host's fixed
Run, reject it as `RunMismatch { selectedRunId, requestedRunId }` before reading
or mutating. The bootstrap already uses
`JournaledRunIdentityMismatch { expectedRunId, requestedRunId }` for several
fixed-Run operations
([run.ts](../packages/orchestrator/src/coordination/run/run.ts#L131)). A tracker
target should not be accepted from an attached client: production selection has
already bound one target to one allocated or recovered Run, and conflicting Hot
histories fail selection
([production-run-selection.ts](../packages/orchestrator/src/coordination/run/production-run-selection.ts#L12)).

## Capacity is compare-and-set

The existing request contains exact `runId`, branded capacity, and
`expectedRevision`. The service reads accepted policy, rejects a stale revision
with the complete current policy, or appends the next revision and returns that
policy
([task-work-capacity.ts](../packages/orchestrator/src/control/task-work-capacity.ts#L23)).
The interruption experiments observed one durable change followed by an exact
retry conflict, without a second capacity record.

**Smallest recommended names and results:**

- `readCapacity({ runId }) -> CapacityPolicy { capacity, revision }`
- `setCapacity({ runId, capacity, expectedRevision }) -> CapacityApplied { policy }`
- stale failure:
  `CapacityRevisionConflict { runId, expectedRevision, currentPolicy }`

The caller decides whether to submit a new change after seeing the conflict.
The boundary must not retry automatically. The complete current policy is
needed for that choice; returning only “conflict” discards the existing source
fact.

Capacity is currently an active-runtime control. Both read and set acquire a
runtime lease and return `JournaledRunNotActive` between activations
([journaled-run-bootstrap.ts](../packages/orchestrator/src/coordination/run/journaled-run-bootstrap.ts#L1129)).
Reading capacity from an inactive journal would be a new application seam.
**Source-preserving implementation candidate:** return `RunInactive` through
this seam. Active-only behavior is not an accepted product policy; inactive
read/set behavior remains a contract choice. A journal-backed inactive capacity
boundary would extend the current bootstrap surface.

## Wake and Unpause are distinct

### Wake

`RunReactivationOwner.hint(OperatorWake)` reads only process-local owner state.
If the owner is stopped or locally paused it returns without queueing anything.
Otherwise it enqueues or coalesces one ordinary-entry hint; the worker performs
the activation later
([run-reactivation-owner.ts](../packages/orchestrator/src/coordination/run/run-reactivation-owner.ts#L258)).
`OperatorWake` selects `OrdinaryRunEntry`, while only timer and tracker
notifications select the specialized active-work refresh
([run-reactivation-owner.ts](../packages/orchestrator/src/coordination/run/run-reactivation-owner.ts#L356)).

**Smallest recommended name:** `wake({ runId })`. Its honest success is
`WakeSubmitted`, meaning only that the host-owned call to `hint` returned.
It must not say `Activated`, `RefreshCompleted`, or `ReadCompleted`. “Queued” is
also too strong because paused, stopped, and coalesced paths all return
successfully without creating a new queue item.

### Unpause

Run Unpause is a durable `ControlDirectionApplied` occurrence. The application
derives a new monotonic ordinal and appends it to the journal
([control application](../packages/orchestrator/src/workflow/protocols/control-direction-application/protocol.ts#L28)).
For a Run subject, the bootstrap then invokes the registered owner's control
callback. The inactive-runtime fallback uses the stored journal and the same
post-apply callback
([journaled-run-bootstrap.ts](../packages/orchestrator/src/coordination/run/journaled-run-bootstrap.ts#L1054)).

**Smallest recommended name and result:**
`unpause({ runId }) -> UnpauseApplied { ordinal, acceptedAt }`. `acceptedAt` is
the returned journal record position. Any successful completion of the full
bootstrap call proves that its owner callback returned. Host ownership is what
preserves that path when the request disconnects; a request-owned call can be
interrupted after persistence and before the callback. The command-recovery
experiment observed a disconnected request waiter, Pause at ordinal 1,
host-owned Unpause at ordinal 2, exactly one owner callback, timer restart, and
activation.

Unpause has no expected revision or request identity. Retrying after a lost
response creates another ordinal; after another client's intervening Pause it
can override that Pause. A generic `requestWork` operation must therefore never
silently translate to Unpause. Wake and Unpause require separate operator
choices and separate method names.

## What “refresh” can currently mean

All existing tracker graph operations read `CompleteTargetClosure`.
`explicitlyCoveredTaskIds` name decision-sensitive subjects; they do not narrow
the fetched graph
([operation.ts](../packages/orchestrator/src/workflow/registry/operation.ts#L20)).
The GitHub adapter resolves and traverses the bounded root closure, then returns
one normalized graph
([graph-reader.ts](../packages/orchestrator/src/authorities/task-tracker/github/graph-reader.ts#L203)).

The specialized active-work refresh is currently driven by a timer or tracker
notification. Either hint captures currently executing `(RunId, AttemptId)` pairs.
When at least one qualifying pair remains, recovery selects one complete graph
read and records those task IDs as explicit causal coverage
([recovery-activation.ts](../packages/orchestrator/src/coordination/run/recovery-activation.ts#L2894)).
An attached refresh adapter can submit the existing `TrackerNotification` hint.
Optional caller task IDs can state advisory interest, but the existing owner
does not pass those IDs into activation and the operation does not perform an
ID-scoped graph fetch.

The whole-graph promise varies by state:

| Starting state | What an existing wake/refresh hint call proves | Whole-graph read promise |
| --- | --- | --- |
| Locally paused | The hint method returned after discarding the hint. | None; no activation or read is requested. |
| Terminal/stopped owner | The hint method returned after observing stopped state. | None. |
| Unpaused and idle/quiescent | An ordinary activation was queued or coalesced. | No read-completion promise; ordinary workflow decides which causally required reads to perform. |
| Another activation is running | One ordinary trailing obligation may be recorded or coalesced. | No read-completion promise, and the caller cannot infer when the trailing activation runs. |
| Timer/tracker active-work refresh with executing subjects | The owner admits a specialized activation; source selects one complete closure read for the captured subjects. | The hint still returns before the read. Read success is visible later only through accepted journal/runtime observation. |
| Timer/tracker active-work refresh without a qualifying executing subject | The activation may run, but active-refresh graph selection has no representative attempt. | No specialized graph-read promise. |

The scheduled changing-graph experiment now verifies active discovery and
subscriber updates, and separately reproduces a terminal-evidence rejection
after delivery. Neither result turns a timer hint into a read-completion receipt.

**Smallest candidate matching the accepted refresh intent:**
`refresh({ runId, advisoryTaskIds? }) -> RefreshSubmitted { advisoryTaskIds? }`.
The optional IDs describe interest, never execution or fetch scope. The adapter
maps both forms to
`RunReactivationHint.TrackerNotification`; absence of IDs asks for the
whole Run, while provided IDs remain advisory interest only. Both forms
may lead to the same complete target-closure read and neither promises that the
named tasks were fetched independently, that a read was admitted, or that a
read completed. The adapter should validate and retain the distinction in its
request/result projection rather than silently relabel IDs as targeted read
authority.

Returning `RefreshCompleted` with the accepted graph observation that satisfies
the request would require a new completion-correlated boundary. No new receipt
identity is needed merely to acknowledge the existing advisory hint.

## Inactive and terminal Run matrix

| Operation | Runtime inactive, Run unfinished | Run terminal |
| --- | --- | --- |
| `readSnapshot` | Existing signal may be `NotReady` or retain its last `Ready`; return the actual lifecycle projection. | Return `Closed` with retained final value when present. |
| `watchSnapshots` | Stay attached to the host-owned signal; attachment does not activate the Run. | Send `Closed`, then end normally. |
| `readCapacity` / `setCapacity` | Existing bootstrap returns `JournaledRunNotActive`; recommended boundary result is `RunInactive`. | Runtime is inactive; return a terminal result when already known, otherwise the underlying inactive failure. Do not invent a successful policy read. |
| `wake` | If the owner is unpaused, it can request a later ordinary activation; result still means only handled hint. If locally paused, it is discarded. | Owner initialization reads `RunTerminated` and stops; later hints are no-ops. Do not report activation. |
| `unpause` | Existing inactive fallback establishes the stored journal, appends Unpause, and invokes the owner callback. | SQLite rejects append with `WorkflowRunAlreadyTerminated`; report `RunClosed`, not applied Unpause. |
| `refresh` | Tracker-notification hint can request a later active refresh only when the owner is locally unpaused; optional IDs remain advisory. | Owner is stopped; no read occurs. |

`readRunReactivationControl` explicitly projects `RunTerminated` from accepted
history without requiring an active runtime
([journaled-run-bootstrap.ts](../packages/orchestrator/src/coordination/run/journaled-run-bootstrap.ts#L947)).
The journal store rejects append after its terminal position with
`WorkflowRunAlreadyTerminated`. A later API may normalize those concrete
failures to `RunClosed { runId, terminatedAt }`, but it must retain the terminal
position when the source supplies it.

## Operator choices and implementable defaults

The caller/API chooses separately named **wake or Unpause** operations.
An agent can make that choice under its existing user instructions; no
interactive human approval or handback is required. Wake requests an
ordinary pass and never changes pause policy. Unpause durably changes policy.
For refresh, the caller may express whole-Run interest or provide advisory task
IDs; both use a tracker-notification hint and a complete target-closure read if
the workflow admits one.

The remaining contract decisions have source-preserving defaults:

1. **Inactive capacity:** the source-preserving candidate returns `RunInactive`;
   a journal-backed read/set seam is a contract alternative, not excluded by
   the accepted milestone.
2. **Refresh result:** return `RefreshSubmitted` for the advisory
   `TrackerNotification` hint. A completion-correlated result is later scope.
3. **Wake response detail:** return the uniform minimal
   `WakeSubmitted` result (implementable default), or add an owner result
   that distinguishes discarded, coalesced, and newly queued hints. Current
   `hint` returns `void`, so the latter changes the owner contract.
4. **Snapshot shape:** use one combined coherent runtime projection
   (implementable default), or expose separate graph/status reads whose
   independent timing is explicit.
5. **Terminal normalization:** preserve concrete underlying failures, or define
   one boundary-level `RunClosed` union used consistently by commands. Reads and
   watches should continue returning the actual `Closed` snapshot.

These defaults do not require a scheduler or journal protocol redesign. Their
chronological scenarios must still state exactly what Alice can infer from a
successful response.

## Existing evidence and remaining gaps

The graph-stream experiment proves passive current-first attachment and
terminal EOF. The MCP-host experiment proves capacity CAS through a disposable
adapter on an active real host. The command interruption and recovery
experiments prove the distinction between hint handling, durable Unpause, owner
callback completion, and fresh-owner reconstruction. None establishes an
operator-correlated graph refresh.

No test was run for this source-only note. The changing-graph experiment is the
appropriate owner of active timer-refresh evidence. A future specification
should map each selected choice above to an acceptance test; aggregate test
counts cannot substitute for those chronologies.
