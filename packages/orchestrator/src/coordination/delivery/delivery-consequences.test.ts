import { it } from "@effect/vitest"
import { OperationId } from "../../workflow/identity.js"
import { JournalPosition } from "../../workflow-journal/identity.js"
import { TaskDagSnapshot } from "../../authorities/task-tracker/graph.js"
import { TaskLifecycle, TrackerRevision, TrackerSnapshot } from "../../authorities/task-tracker/task.js"
import {
  AttemptId,
  GitCommitSha,
  PlannedAttemptExecutorReport,
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
import {
  currentSignalOf,
  boundedParallelTickets,
  DeliveryReflectionProjection,
  DeliveryRelationRevision,
  deliverySettlements,
  executorResponsibilities,
  mapCurrentSignal,
  makeDeliveryRuntimeRelation,
  reflectDeliverySettlements,
  TrackerGraphState,
  TrackerGraphRelation,
  type JournaledTrackerGraphObservation,
  type CurrentSignal,
  type DeliveryRelationInputBundle,
  type TicketDeliveryEvidence
} from "./relations.js"
import { makeTestJournaledTrackerGraphObservation } from "../../../test/journaled-graph-observation.js"
import { delivery } from "./delivery.js"
import { frontierOf } from "./ticket-delivery-projection.js"
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

const fixtureObservation = (snapshot: TaskDagSnapshot, operation: string, recordedAt: number) => {
  const operationId = OperationId.make(operation)
  return makeTestJournaledTrackerGraphObservation({
    snapshot,
    operationId,
    recordedAt: JournalPosition.make(recordedAt)
  })
}

const journaledGraph = (
  revision: string,
  tasks: ReadonlyArray<Parameters<typeof graphSnapshot>[1][number]>,
  operation: string,
  recordedAt: number
) => {
  const snapshot = graphSnapshot(revision, tasks)
  const observation: JournaledTrackerGraphObservation = fixtureObservation(snapshot, operation, recordedAt)
  return TrackerGraphState.cases.GraphEstablished.make({ observation })
}

const syntheticEvidence = (taskId: TaskId): TicketDeliveryEvidence => {
  const plannedAttempt = PlannedTaskAttempt.make({
    attemptId: AttemptId.make(`coherent:${taskId}`),
    baseSha: GitCommitSha.make("1".repeat(40)),
    branch: TaskBranchRef.make(`refs/heads/dalph/${taskId}`),
    executor: TaskExecutorLocator.make("executor:coherent"),
    runId: RunId.make("coherent-run"),
    taskId,
    taskRevision: TaskRevision.make(`revision:${taskId}`),
    worktree: WorktreeLocator.make(`/worktrees/${taskId}`)
  })
  return {
    _tag: "SyntheticExecutorFacts",
    plannedAttempt,
    report: PlannedAttemptExecutorReport.cases.Running.make({
      correlation: { attemptId: plannedAttempt.attemptId, runId: plannedAttempt.runId }
    })
  }
}

const coherentBundle = (
  graph: TrackerGraphState,
  currentPolicy: RunControlPolicy,
  exactEvidence: ReadonlyArray<TicketDeliveryEvidence>
): DeliveryRelationInputBundle => ({
  legacy: {
    proposalContributions: { deliverySettlement: [], issues: [], ticketDelivery: [] },
    reflectionProposals: [],
    runtimeFacts: {
      acceptedAt: null,
      quiescence: { _tag: "QuiescenceProbeAllowed" },
      revision: DeliveryRelationRevision.make(0),
      taskWork: { capacity: currentPolicy.taskExecutionCapacity, held: [] }
    },
    trackerGraphProposals: []
  },
  publication: { exactEvidence, graph, policy: currentPolicy }
})

const layerFor = (
  graph: TrackerGraphState,
  exactEvidence: ReadonlyArray<TicketDeliveryEvidence> = [],
  currentPolicy: RunControlPolicy = policy
) =>
  makeDeliveryRelationsLayer({
    ...deterministicDeliveryRuntimeSupport(currentPolicy),
    coherent: currentSignalOf(coherentBundle(graph, currentPolicy, exactEvidence))
  })

it.effect("emits one coherent delivery value from journaled graph observation G1", () =>
  Effect.gen(function* () {
    const taskA = TaskId.make("A")
    const graph = journaledGraph("G1", [{ id: "A" }], "read-G1", 7)
    const signal = yield* delivery.pipe(Effect.provide(layerFor(graph)))
    const value = Option.getOrThrow(yield* signal.changes.pipe(Stream.runHead))

    expect(value.graph._tag === "GraphEstablished" ? value.graph.observation.operationId : undefined).toBe(
      OperationId.make("read-G1")
    )
    expect(value.graph._tag === "GraphEstablished" ? value.graph.observation.recordedAt : undefined).toBe(
      JournalPosition.make(7)
    )
    expect(value.frontier.standings).toMatchObject([{ _tag: "Eligible", taskId: taskA }])
    expect(value.tickets.placements).toMatchObject([{ taskId: taskA, placement: { _tag: "Selected" } }])
    expect(value.ticketDeliveries.deliveries).toMatchObject([
      { taskId: taskA, standings: [{ _tag: "ProposedDelivery" }] }
    ])
    expect(value.settlements.settlements).toEqual([])
  })
)

it.effect("keeps graph observation absent until a journaled graph exists", () =>
  Effect.gen(function* () {
    const signal = yield* delivery.pipe(Effect.provide(layerFor(TrackerGraphState.cases.GraphNotEstablished.make({}))))
    const value = Option.getOrThrow(yield* signal.changes.pipe(Stream.runHead))

    expect(value.graph._tag).toBe("GraphNotEstablished")
    expect(value.frontier.source).toEqual(value.graph)
  })
)

it.effect("emits one consequence per accepted publication without mixed graph policy or evidence", () =>
  Effect.gen(function* () {
    const graphOne = journaledGraph("coherent-G1", [{ id: "A" }], "coherent-read-G1", 7)
    const graphTwo = journaledGraph("coherent-G2", [{ id: "B" }], "coherent-read-G2", 8)
    const policyOne = RunControlPolicy.make({
      revision: initialRunPolicyRevision,
      taskExecutionCapacity: TaskWorkCapacity.make(1)
    })
    const policyTwo = RunControlPolicy.make({
      revision: initialRunPolicyRevision,
      taskExecutionCapacity: TaskWorkCapacity.make(2)
    })
    const coherent: CurrentSignal<DeliveryRelationInputBundle> = {
      get: Effect.succeed(coherentBundle(graphOne, policyOne, [])),
      changes: Stream.fromIterable([
        coherentBundle(graphOne, policyOne, []),
        coherentBundle(graphTwo, policyTwo, [syntheticEvidence(TaskId.make("B"))])
      ])
    }
    const layer = makeDeliveryRelationsLayer({ ...deterministicDeliveryRuntimeSupport(policyOne), coherent })

    const signal = yield* delivery.pipe(Effect.provide(layer))
    const values = Array.from(yield* signal.changes.pipe(Stream.runCollect))

    expect(values).toHaveLength(2)
    expect(
      values.map(({ graph }) => (graph._tag === "GraphEstablished" ? graph.observation.contentIdentity : null))
    ).toEqual([TrackerRevision.make("coherent-G1"), TrackerRevision.make("coherent-G2")])
    expect(values.map(({ tickets }) => tickets.policy.taskExecutionCapacity)).toEqual([
      TaskWorkCapacity.make(1),
      TaskWorkCapacity.make(2)
    ])
    expect(values.map(({ ticketDeliveries }) => ticketDeliveries.deliveries.map(({ taskId }) => taskId))).toEqual([
      [TaskId.make("A")],
      [TaskId.make("B")]
    ])
    expect(
      values.every(
        ({ frontier, graph, settlements, ticketDeliveries, tickets, trackerConsequences }) =>
          frontier.source === graph &&
          tickets.source === frontier &&
          ticketDeliveries.source === tickets &&
          settlements.source === ticketDeliveries &&
          trackerConsequences.source === settlements
      )
    ).toBe(true)
  })
)

it.effect("publishes policy and exact evidence changes for one journaled graph", () =>
  Effect.gen(function* () {
    const graph = journaledGraph("same-graph-publication", [{ id: "A" }], "same-graph-read", 9)
    const policyOne = RunControlPolicy.make({
      revision: initialRunPolicyRevision,
      taskExecutionCapacity: TaskWorkCapacity.make(1)
    })
    const policyTwo = RunControlPolicy.make({
      revision: initialRunPolicyRevision,
      taskExecutionCapacity: TaskWorkCapacity.make(2)
    })
    const coherent: CurrentSignal<DeliveryRelationInputBundle> = {
      get: Effect.succeed(coherentBundle(graph, policyOne, [])),
      changes: Stream.fromIterable([
        coherentBundle(graph, policyOne, []),
        coherentBundle(graph, policyTwo, []),
        coherentBundle(graph, policyTwo, [syntheticEvidence(TaskId.make("A"))])
      ])
    }
    const layer = makeDeliveryRelationsLayer({ ...deterministicDeliveryRuntimeSupport(policyOne), coherent })

    const signal = yield* delivery.pipe(Effect.provide(layer))
    const values = Array.from(yield* signal.changes.pipe(Stream.runCollect))

    expect(values).toHaveLength(3)
    expect(
      values.map(({ graph: currentGraph }) =>
        currentGraph._tag === "GraphEstablished" ? currentGraph.observation.operationId : undefined
      )
    ).toEqual([
      OperationId.make("same-graph-read"),
      OperationId.make("same-graph-read"),
      OperationId.make("same-graph-read")
    ])
    expect(values.map(({ tickets }) => tickets.policy.taskExecutionCapacity)).toEqual([
      TaskWorkCapacity.make(1),
      TaskWorkCapacity.make(2),
      TaskWorkCapacity.make(2)
    ])
    expect(values.map(({ ticketDeliveries }) => ticketDeliveries.deliveries[0]?.evidence.length)).toEqual([0, 0, 1])
  })
)

it.effect("evaluates every coherent projection owner from the shared publication", () =>
  Effect.gen(function* () {
    const graph = journaledGraph("coherent-projection", [{ id: "A" }], "coherent-projection-read", 9)
    const coherent: CurrentSignal<DeliveryRelationInputBundle> = {
      get: Effect.succeed(coherentBundle(graph, policy, [])),
      changes: Stream.fromIterable([coherentBundle(graph, policy, [])])
    }
    const layer = makeDeliveryRelationsLayer({ ...deterministicDeliveryRuntimeSupport(policy), coherent })

    yield* Effect.gen(function* () {
      const consequences = yield* delivery
      const trackerGraph = yield* TrackerGraphRelation
      yield* trackerGraph.signal.changes.pipe(Stream.runCollect)
      const frontier = mapCurrentSignal(trackerGraph.signal, frontierOf)
      const tickets = yield* boundedParallelTickets(frontier)
      yield* tickets.changes.pipe(Stream.runCollect)
      const deliveries = yield* executorResponsibilities(tickets)
      yield* deliveries.current.changes.pipe(Stream.runCollect)
      yield* deliveries.proposalContributions.changes.pipe(Stream.runCollect)
      yield* deliveries.proposedActions.changes.pipe(Stream.runCollect)
      const settlements = yield* deliverySettlements(deliveries)
      yield* settlements.current.changes.pipe(Stream.runCollect)
      yield* settlements.proposedActions.changes.pipe(Stream.runCollect)
      const reflectionProjection = yield* DeliveryReflectionProjection
      const reflection = reflectionProjection.of(settlements)
      yield* reflection.current.changes.pipe(Stream.runCollect)
      yield* reflection.proposedActions.changes.pipe(Stream.runCollect)
      yield* reflectDeliverySettlements(settlements).pipe(
        Effect.flatMap((signal) => signal.changes.pipe(Stream.runCollect))
      )
      const directRuntime = makeDeliveryRuntimeRelation({
        delivery: consequences,
        facts: currentSignalOf({
          acceptedAt: null,
          quiescence: { _tag: "QuiescenceProbeAllowed" as const },
          revision: DeliveryRelationRevision.make(0),
          taskWork: { capacity: policy.taskExecutionCapacity, held: [] }
        }),
        proposedActions: currentSignalOf({ _tag: "DeliveryProposalsAvailable", isolatedIssues: [], proposals: [] }),
        requestStabilizationRead: () => Effect.succeed(DeliveryRelationRevision.make(0))
      })
      yield* directRuntime.evaluations.changes.pipe(Stream.runCollect)
    }).pipe(Effect.provide(layer))
  })
)

it.effect("retains an exact responsibility with its changed graph placement", () =>
  Effect.gen(function* () {
    const taskB = TaskId.make("B")
    const graph = journaledGraph("G2", [{ id: "A" }, { id: "B" }], "read-G2", 8)
    const evidence: TicketDeliveryEvidence = {
      _tag: "ResponsibilityFacts" as const,
      facts: {
        _tag: "PlannedAttemptExecutorFreshFacts" as const,
        disposition: {
          _tag: "Ready" as const,
          acceptedProgress: { _tag: "ExecutorResponsibilityBegan" as const, acceptedAt: JournalPosition.make(2) }
        },
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
          coherent: currentSignalOf(coherentBundle(graph, policy, [evidence]))
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
    const graphOne = journaledGraph("G1", [{ id: "A" }], "read-G1", 7)
    const graphTwo = journaledGraph("G2", [{ id: "A" }, { id: "B" }], "read-G2", 8)
    const layer = makeDeliveryRelationsLayer({
      ...deterministicDeliveryRuntimeSupport(policy),
      coherent: {
        get: Effect.succeed(coherentBundle(graphOne, policy, [])),
        changes: Stream.fromIterable([coherentBundle(graphOne, policy, []), coherentBundle(graphTwo, policy, [])])
      }
    })
    const signal = yield* delivery.pipe(Effect.provide(layer))
    const values = Array.from(yield* signal.changes.pipe(Stream.runCollect))

    expect(values).toHaveLength(2)
    expect(values[0]?.graph._tag === "GraphEstablished" ? values[0].graph.observation.operationId : undefined).toBe(
      OperationId.make("read-G1")
    )
    expect(values[0]?.ticketDeliveries.deliveries.map(({ taskId }) => taskId)).toEqual([TaskId.make("A")])
    expect(values[1]?.graph._tag === "GraphEstablished" ? values[1].graph.observation.operationId : undefined).toBe(
      OperationId.make("read-G2")
    )
    expect(values[1]?.ticketDeliveries.deliveries.map(({ taskId }) => taskId)).toEqual([TaskId.make("A")])
    expect(values[1]?.tickets.placements).toMatchObject([
      { taskId: "A", placement: { _tag: "Selected" } },
      { taskId: "B", placement: { _tag: "EligibleOutsideBound" } }
    ])
  })
)

it.effect("emits G1 and equal-content G2 with distinct accepted observation identities", () =>
  Effect.gen(function* () {
    const graphOne = journaledGraph("equal-content", [{ id: "A" }], "logical-read-G1", 10)
    const graphTwo = journaledGraph("equal-content", [{ id: "A" }], "logical-read-G2", 11)
    const layer = makeDeliveryRelationsLayer({
      ...deterministicDeliveryRuntimeSupport(policy),
      coherent: {
        get: Effect.succeed(coherentBundle(graphOne, policy, [])),
        changes: Stream.fromIterable([coherentBundle(graphOne, policy, []), coherentBundle(graphTwo, policy, [])])
      }
    })
    const signal = yield* delivery.pipe(Effect.provide(layer))
    const values = Array.from(yield* signal.changes.pipe(Stream.runCollect))

    expect(
      values.map((value) => (value.graph._tag === "GraphEstablished" ? value.graph.observation.operationId : null))
    ).toEqual([OperationId.make("logical-read-G1"), OperationId.make("logical-read-G2")])
    const first = values[0]?.graph
    const second = values[1]?.graph
    expect(
      first?._tag === "GraphEstablished" && second?._tag === "GraphEstablished"
        ? first.observation.contentIdentity
        : undefined
    ).toBe(second?._tag === "GraphEstablished" ? second.observation.contentIdentity : undefined)
    expect(first?._tag === "GraphEstablished" ? first.observation.recordedAt : undefined).toBe(JournalPosition.make(10))
    expect(second?._tag === "GraphEstablished" ? second.observation.recordedAt : undefined).toBe(
      JournalPosition.make(11)
    )
  })
)
