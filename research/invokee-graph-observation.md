# Task graph observation from the current production runtime

Status: research only, 2026-09-13. This note inspects the restored production
runtime and its existing status projection. It proposes no API and records no
implementation task.

## Finding

After the runtime publishes `Ready`, one in-process observation contains enough
information to derive a coherent task-level view for that publication. It can
show the normalized task inventory, prerequisite and grouping edges, graph-only
eligibility, capacity-bounded desired placement, detailed delivery status, and
process-local action ownership. The derivation must start from one `Ready`
value; reading these relationships independently would discard the coherence
that the runtime already provides.

There is no current public schema for that combined graph view. The existing
CLI status schema describes delivery status for a Run or task. It neither
contains the complete task inventory and edges nor proves exhaustive alignment
between graph tasks, frontier standings, bounded placements, status summaries,
and live owners.

## View derivable from one publication

| Question | Current source | What can be stated |
| --- | --- | --- |
| Which tasks exist? | `evaluation.current.trackerGraph`, when `GraphEstablished` | `TaskDagSnapshot.toWire()` returns every normalized task with its identity and lifecycle. |
| How are tasks related? | The same `TaskDagWire.tasks` | `parentTaskId` represents grouping and `prerequisiteIds` represents dependency edges. |
| Which task is the selected root? | `GraphEstablished.observation.snapshot.rootTaskId` | The normalized snapshot retains the boundary-supplied root when one exists. `TaskDagWire` does not encode it. |
| Which tasks are graph-eligible? | `evaluation.current.ticketDeliveries.source.source.standings` | The frontier exhaustively classifies every task in the established graph as `Eligible` or `Excluded`, including prerequisite, success, or terminal exclusion reasons. |
| Which eligible tasks fit current policy? | `evaluation.current.ticketDeliveries.source.placements` | Every frontier task has a deterministic `Selected`, `EligibleOutsideBound`, or `GraphExcluded` placement. This is desired work under policy, not proof that work was admitted or that a runtime position is held. |
| What is happening to a task or Run? | `deliveryStatusOf(subject, ready)` | The pure projection returns waiting, progressing, blocked, settled, and relinquished evidence, or typed identity/conflict failures. An established graph also supports an explicit `TaskAbsentFromCurrentGraph` result. |
| Which publication is this? | `Ready.evaluation.runId` and `Ready.evaluation.acceptedAt` | The view can retain the selected Run identity and the latest accepted journal position carried by that evaluation. |
| Which executor owns each task? | `Ready.liveOwners` plus delivery evidence | Only partial, process-local correlation is available. A live owner identifies a proposal and sometimes an operation; some delivery entries carry planned-attempt executor correlations. There is no uniform, stable task-to-executor association for every graph task. |

The coherence is structural. `DeliveryRuntimeSnapshot` is documented as one
value assembled from every relationship visible to the Effect, and it retains
the tracker graph and the `TicketDeliveries` chain. `DeliveryRuntimeEvaluation`
adds the Run, accepted journal position, task-work admission basis, proposed
actions, and pause/cancellation facts. `Ready` then pairs that evaluation with
the live-owner snapshots in one publication
([relations.ts](../packages/orchestrator/src/coordination/delivery/relations.ts#L514),
[delivery-runtime-observation.ts](../packages/orchestrator/src/coordination/delivery/delivery-runtime-observation.ts#L273)).

The graph and placement relations also carry their source publications rather
than independently rereading authority. The frontier walks all tasks from the
accepted normalized snapshot and sorts its exhaustive standings. The bounded
projection maps those standings using only deterministic graph order and the
publication's policy; live positions are explicitly not an input
([ticket-delivery-projection.ts](../packages/orchestrator/src/coordination/delivery/ticket-delivery-projection.ts#L108),
[ticket-delivery-projection.ts](../packages/orchestrator/src/coordination/delivery/ticket-delivery-projection.ts#L127)).

## Schema limits

`TaskDagWire` can encode inventory and both edge kinds, but its schema checks
only the shape and branded fields. Cross-record facts such as unique task IDs,
existing parent and prerequisite references, root membership, and absence of
cycles are checked earlier by `TaskDagSnapshot.project`. Code calling
`toWire()` on a successfully projected snapshot inherits those guarantees;
decoding an arbitrary `TaskDagWire` alone does not establish them. The wire
shape also omits the snapshot's optional `rootTaskId`
([graph.ts](../packages/orchestrator/src/authorities/task-tracker/graph.ts#L34),
[graph.ts](../packages/orchestrator/src/authorities/task-tracker/graph.ts#L282),
[graph.ts](../packages/orchestrator/src/authorities/task-tracker/graph.ts#L414)).

No current schema proves all of the following as one value:

- the Run identity agrees with the graph publication;
- every graph task appears exactly once in the frontier and bounded placement;
- every status summary belongs to a graph task and has a unique classification;
- an unestablished or closed-without-final graph has no invented task data;
- a closed final value retains the same Run identity as its enclosing value;
- each task has a stable optional executor association.

The public `ProductionCliCurrentDeliveryStatus` schema does enforce that status
entries belong to the requested status subject and that a closed status and its
final snapshot have the same subject. Its projection intentionally removes
executable payload and private authority. It exposes selected operation and
planned-attempt correlation facts where relevant, but it is a status schema,
not a complete graph schema
([production-cli-status-schema.ts](../packages/dalph/src/application/production-cli-status-schema.ts#L275),
[production-cli-status-projection.ts](../packages/dalph/src/application/production-cli-status-projection.ts#L22)).

The internal live-owner list does not close the executor-association gap.
`DeliveryRuntimeLiveOwnerSnapshot` is explicitly process-local. It records an
admission authority, action proposal, and, after materialization, an operation
identity. It does not define a durable executor or session locator, and an
action proposal is not equivalent to an executor currently working a task
([delivery-runtime-observation.ts](../packages/orchestrator/src/coordination/delivery/delivery-runtime-observation.ts#L68)).

## Current-first, closure, and passive reads

The observation begins as `NotReady`. Each publication replaces it with one
`Ready` value. Closing the controller publishes `Closed`, retaining the last
`Ready` as `final`, or `null` if no ready value was ever published. Publication
after close is refused, and the current-first stream ends after emitting the
closed value
([delivery-runtime-observation.ts](../packages/orchestrator/src/coordination/delivery/delivery-runtime-observation.ts#L293),
[delivery-runtime-observation.ts](../packages/orchestrator/src/coordination/delivery/delivery-runtime-observation.ts#L320)).

`CurrentSignal.attach` opens one scoped, loss-free current-first subscription.
Its `current` value and later `changes` come from the same attachment, avoiding
a gap between a separate read and watch. `get` and the declarative `changes`
stream are built from this same contract
([relations.ts](../packages/orchestrator/src/coordination/delivery/relations.ts#L62),
[relations.ts](../packages/orchestrator/src/coordination/delivery/relations.ts#L77)).

Status preserves those temporal distinctions. It maps `NotReady`, `Ready`, and
`Closed` directly; a closed source retains the final projected status when one
exists. Wrong-Run, unavailable Run identity, and conflicting status evidence
are typed failures rather than guessed results. `observeDeliveryStatus` receives
only the descriptive signal and is documented as passive, with no authority or
mutation boundary available
([delivery-status.ts](../packages/orchestrator/src/coordination/delivery/delivery-status.ts#L65),
[delivery-status.ts](../packages/orchestrator/src/coordination/delivery/delivery-status.ts#L115),
[delivery-status.ts](../packages/orchestrator/src/coordination/delivery/delivery-status.ts#L140)).

The production host exposes this process-local `current` signal after the
selected Run's beginning is acknowledged. It does not expose a task-graph DTO,
a remote subscription protocol, or a durable observation cursor
([production-host.ts](../packages/dalph/src/application/production-host.ts#L74),
[production-host.ts](../packages/dalph/src/application/production-host.ts#L551)).
Consequently, current-first and passive observation are established for the
in-process Effect boundary. They do not by themselves prove reconnect or
closure semantics across HTTP, MCP, or another process.

## Evidence boundary

### Source evidence

The conclusions above follow from the checked-in types, projections, and host
composition at the cited paths. In particular, source inspection establishes
the in-memory coherence and passivity claims and identifies what the existing
schemas do and do not validate.

### Executed evidence

The following unchanged focused tests were run in this worktree:

```sh
pnpm exec vitest run \
  packages/orchestrator/src/coordination/delivery/current-signal.property.test.ts \
  packages/orchestrator/src/coordination/delivery/ticket-delivery-projection.test.ts \
  packages/orchestrator/src/coordination/delivery/delivery-status.test.ts
```

Result: three files passed, 84 tests passed, in 5.71 seconds. These tests cover
the current-signal contract, graph/frontier projection, status identity and
closure behavior, reconnection to a process-local current source, and checks
that status observation invokes no instrumented authority or mutation boundary.
The relevant status cases are in
[delivery-status.test.ts](../packages/orchestrator/src/coordination/delivery/delivery-status.test.ts#L2322)
and
[delivery-status.test.ts](../packages/orchestrator/src/coordination/delivery/delivery-status.test.ts#L2481).

This execution used controlled in-memory fixtures. It did not start an actual
production host, attach a second process, cross an HTTP or MCP boundary, call
GitHub or Codex, or establish a public graph schema. Those remain unproven by
this evidence.
