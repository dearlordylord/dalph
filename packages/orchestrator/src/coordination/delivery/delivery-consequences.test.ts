import { it } from "@effect/vitest"
import { OperationId } from "../../workflow/identity.js"
import { JournalPosition } from "../../workflow-journal/identity.js"
import { TaskDagSnapshot } from "../../authorities/task-tracker/graph.js"
import { TaskLifecycle, TrackerRevision, TrackerSnapshot } from "../../authorities/task-tracker/task.js"
import {
  AttemptId,
  GitCommitSha,
  PlannedTaskAttempt,
  RunId,
  TaskBranchRef,
  TaskExecutorLocator,
  TaskId,
  TaskRevision,
  WorktreeLocator
} from "@dalph/contracts"
import { Effect, Option, Stream } from "effect"
import { expect } from "vitest"
import { TaskWorkCapacity } from "../admission/capacity.js"
import { initialRunPolicyRevision, RunControlPolicy } from "../../control/policy.js"
import { ResponsibilityDisposition } from "../frontier/fresh-facts.js"
import {
  acceptedTrackerGraphObservationOf,
  currentSignalOf,
  TrackerGraphState,
  type AcceptedTrackerGraphObservation,
  type TicketDeliveryEvidence
} from "./relations.js"
import { delivery } from "./delivery.js"
import { deterministicDeliveryRuntimeSupport, makeDeliveryRelationsLayer } from "./in-memory-relations.js"

const policy = RunControlPolicy.make({
  revision: initialRunPolicyRevision,
  taskExecutionCapacity: TaskWorkCapacity.make(1)
})

const graphSnapshot = (
  revision: string,
  tasks: ReadonlyArray<{
    readonly id: string
    readonly lifecycle?: TaskLifecycle
    readonly prerequisiteIds?: ReadonlyArray<string>
  }>
) => {
  const projected = TaskDagSnapshot.project(
    TrackerSnapshot.make({
      revision: TrackerRevision.make(revision),
      tasks: tasks.map(({ id, lifecycle, prerequisiteIds }) => ({
        id: TaskId.make(id),
        lifecycle: lifecycle ?? TaskLifecycle.cases.Open.make({}),
        parentTaskId: null,
        prerequisiteIds: (prerequisiteIds ?? []).map((prerequisiteId) => TaskId.make(prerequisiteId))
      }))
    })
  )
  if (projected._tag === "Invalid") throw new Error(`invalid test graph: ${JSON.stringify(projected.issues)}`)
  return projected.snapshot
}

const acceptedGraph = (
  revision: string,
  tasks: ReadonlyArray<Parameters<typeof graphSnapshot>[1][number]>,
  operation: string,
  acceptedAt: number
) => {
  const snapshot = graphSnapshot(revision, tasks)
  const operationId = OperationId.make(operation)
  const observation: AcceptedTrackerGraphObservation = {
    ...acceptedTrackerGraphObservationOf(snapshot),
    operationId,
    acceptedAt: JournalPosition.make(acceptedAt),
    freshness: { _tag: "ObservedDuringLogicalRead", operationId }
  }
  return TrackerGraphState.cases.GraphEstablished.make({ observation })
}

const layerFor = (graph: TrackerGraphState) =>
  makeDeliveryRelationsLayer({
    ...deterministicDeliveryRuntimeSupport(policy),
    graph: currentSignalOf(graph),
    exactEvidence: currentSignalOf([]),
    policy: currentSignalOf(policy)
  })

it.effect("emits one coherent delivery value from accepted graph observation G1", () =>
  Effect.gen(function* () {
    const taskA = TaskId.make("A")
    const graph = acceptedGraph("G1", [{ id: "A" }], "read-G1", 7)
    const signal = yield* delivery.pipe(Effect.provide(layerFor(graph)))
    const value = Option.getOrThrow(yield* signal.changes.pipe(Stream.runHead))

    expect(value.graphObservation?.operationId).toBe(OperationId.make("read-G1"))
    expect(value.graphObservation?.acceptedAt).toBe(JournalPosition.make(7))
    expect(value.frontier.standings).toMatchObject([{ _tag: "Eligible", taskId: taskA }])
    expect(value.tickets.placements).toMatchObject([{ taskId: taskA, placement: { _tag: "Selected" } }])
    expect(value.ticketDeliveries.deliveries).toMatchObject([
      { taskId: taskA, standings: [{ _tag: "ProposedDelivery" }] }
    ])
    expect(value.settlements.settlements).toEqual([])
  })
)

it.effect("keeps graph observation absent until an accepted graph exists", () =>
  Effect.gen(function* () {
    const signal = yield* delivery.pipe(Effect.provide(layerFor(TrackerGraphState.cases.GraphNotEstablished.make({}))))
    const value = Option.getOrThrow(yield* signal.changes.pipe(Stream.runHead))

    expect(value.graph._tag).toBe("GraphNotEstablished")
    expect(value.graphObservation).toBeNull()
    expect(value.frontier.source).toEqual(value.graph)
  })
)

it.effect("retains an exact responsibility with its changed graph placement", () =>
  Effect.gen(function* () {
    const taskB = TaskId.make("B")
    const graph = acceptedGraph("G2", [{ id: "A" }, { id: "B" }], "read-G2", 8)
    const evidence: TicketDeliveryEvidence = {
      _tag: "ResponsibilityFacts" as const,
      facts: {
        _tag: "PlannedAttemptExecutorFreshFacts" as const,
        disposition: ResponsibilityDisposition.Ready(),
        responsibility: {
          _tag: "PlannedAttemptExecutorWorkResponsibility" as const,
          beganAt: JournalPosition.make(2),
          plannedAttempt: PlannedTaskAttempt.make({
            attemptId: AttemptId.make("attempt:B"),
            baseSha: GitCommitSha.make("1".repeat(40)),
            branch: TaskBranchRef.make("refs/heads/dalph/B"),
            executor: TaskExecutorLocator.make("executor:fake"),
            runId: RunId.make("run-delivery"),
            taskId: taskB,
            taskRevision: TaskRevision.make("revision:B"),
            worktree: WorktreeLocator.make("/worktrees/B")
          })
        }
      }
    }
    const signal = yield* delivery.pipe(
      Effect.provide(
        makeDeliveryRelationsLayer({
          ...deterministicDeliveryRuntimeSupport(policy),
          graph: currentSignalOf(graph),
          exactEvidence: currentSignalOf([evidence]),
          policy: currentSignalOf(policy)
        })
      )
    )
    const value = Option.getOrThrow(yield* signal.changes.pipe(Stream.runHead))
    const retained = value.ticketDeliveries.deliveries.find(({ taskId }) => taskId === taskB)

    expect(retained?.placement).toEqual({ _tag: "EligibleOutsideBound", rank: 1 })
    expect(retained?.obligations).toHaveLength(1)
  })
)

it.effect("reacts to G2 while the composition remains running", () =>
  Effect.gen(function* () {
    const graphOne = acceptedGraph("G1", [{ id: "A" }], "read-G1", 7)
    const graphTwo = acceptedGraph("G2", [{ id: "A" }, { id: "B" }], "read-G2", 8)
    const layer = makeDeliveryRelationsLayer({
      ...deterministicDeliveryRuntimeSupport(policy),
      graph: { changes: Stream.fromIterable([graphOne, graphTwo]) },
      exactEvidence: currentSignalOf([]),
      policy: currentSignalOf(policy)
    })
    const signal = yield* delivery.pipe(Effect.provide(layer))
    const values = Array.from(yield* signal.changes.pipe(Stream.runCollect))

    expect(values).toHaveLength(2)
    expect(values[0]?.graphObservation?.operationId).toBe(OperationId.make("read-G1"))
    expect(values[0]?.ticketDeliveries.deliveries.map(({ taskId }) => taskId)).toEqual([TaskId.make("A")])
    expect(values[1]?.graphObservation?.operationId).toBe(OperationId.make("read-G2"))
    expect(values[1]?.ticketDeliveries.deliveries.map(({ taskId }) => taskId)).toEqual([TaskId.make("A")])
    expect(values[1]?.tickets.placements).toMatchObject([
      { taskId: "A", placement: { _tag: "Selected" } },
      { taskId: "B", placement: { _tag: "EligibleOutsideBound" } }
    ])
  })
)

it.effect("emits G1 and equal-content G2 with distinct accepted observation identities", () =>
  Effect.gen(function* () {
    const graphOne = acceptedGraph("equal-content", [{ id: "A" }], "logical-read-G1", 10)
    const graphTwo = acceptedGraph("equal-content", [{ id: "A" }], "logical-read-G2", 11)
    const layer = makeDeliveryRelationsLayer({
      ...deterministicDeliveryRuntimeSupport(policy),
      graph: { changes: Stream.fromIterable([graphOne, graphTwo]) },
      exactEvidence: currentSignalOf([]),
      policy: currentSignalOf(policy)
    })
    const signal = yield* delivery.pipe(Effect.provide(layer))
    const values = Array.from(yield* signal.changes.pipe(Stream.runCollect))

    expect(values.map((value) => value.graphObservation?.operationId)).toEqual([
      OperationId.make("logical-read-G1"),
      OperationId.make("logical-read-G2")
    ])
    expect(values[0]?.graphObservation?.contentIdentity).toBe(values[1]?.graphObservation?.contentIdentity)
    expect(values[0]?.graphObservation?.acceptedAt).toBe(JournalPosition.make(10))
    expect(values[1]?.graphObservation?.acceptedAt).toBe(JournalPosition.make(11))
  })
)
