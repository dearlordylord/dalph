import { it } from "@effect/vitest"
import { NodeCrypto } from "@effect/platform-node"
import { Cause, Effect, Exit, Fiber, Option, Ref, Schema, Stream } from "effect"
import { expect } from "vitest"
import {
  AttemptId,
  PlannedAttemptExecutor,
  PlannedAttemptExecutorLifecycleObservation,
  PlannedAttemptExecutorReport,
  RunId,
  TaskId,
  passiveLifecycleObservationPurpose,
  plannedAttemptExecutorCorrelationKey
} from "@dalph/contracts"
import {
  FixtureTarget,
  OperationId,
  TrackerRevision,
  makeTaskWorkSpecificationObservationOperation,
  makeTrackerGraphObservationOperation
} from "@dalph/orchestrator"
import {
  type AuthoredCassetteDecision,
  AuthoredCassetteStoryItem,
  AuthoredCausalSelection
} from "../../src/cassettes/authored-domain.js"
import {
  AuthoredCausalSelectionFailure,
  type AuthoredOperationCausalContext,
  type StoryCursor,
  makeStoryCursor
} from "../../src/cassettes/authored-cursor.js"
import { controlledExecutorLayer, controlledTrace } from "../../src/cassettes/authored-adapters.js"
import {
  consumeControlledTaskWorkSpecification,
  consumeControlledTrackerGraph
} from "../../src/cassettes/authored-tracker-read-results.js"
import { activeWorkF2SafelySuspendsAuthoredCassette, runAuthoredScenarioCassette } from "../../src/cassettes/index.js"

const taskB = TaskId.make("B")
const target = FixtureTarget.make("active-work-target")
const readGraph = { _tag: "ReadTrackerGraph" as const, target }
const readBSpecification = { _tag: "ReadTaskWorkSpecification" as const, taskId: taskB }

const graph = (revision: string) => ({
  revision: TrackerRevision.make(revision),
  rootTaskId: taskB,
  tasks: [{ id: taskB, lifecycle: { _tag: "Open" as const }, parentTaskId: null, prerequisiteIds: [] }]
})

const causal = Schema.decodeUnknownSync(AuthoredCausalSelection)
const causalContext = (
  operationId: string,
  predecessorOperationIds: ReadonlyArray<string>
): AuthoredOperationCausalContext => ({
  operationId: OperationId.make(operationId),
  predecessorOperationIds: predecessorOperationIds.map((operationId) => OperationId.make(operationId))
})

const selection = (occurrenceRole: string, predecessorRoles: ReadonlyArray<string>, operation = readGraph) =>
  AuthoredCassetteStoryItem.cases.DalphSelects.make({ causal: causal({ occurrenceRole, predecessorRoles }), operation })

const anchorSelection = (occurrenceRole: string, operation: AuthoredCassetteDecision = readGraph) =>
  Schema.decodeUnknownSync(AuthoredCassetteStoryItem.cases.DalphSelects)({
    _tag: "DalphSelects",
    causalAnchor: { occurrenceRole },
    operation
  })

const graphResult = (revision: string) =>
  AuthoredCassetteStoryItem.cases.TrackerGraphReadReturned.make({ graph: graph(revision) })

const terminal = AuthoredCassetteStoryItem.cases.ExpectedBehavior.make({
  orchestration: null,
  protocol: null,
  taskWork: { absences: [], results: [] }
})

const sameShapeBatch = Schema.decodeUnknownSync(AuthoredCassetteStoryItem.cases.ConcurrentTrackerReadBatch)({
  _tag: "ConcurrentTrackerReadBatch",
  members: [
    {
      causal: causal({ occurrenceRole: "independent-B-F1", predecessorRoles: ["independent-G0"] }),
      operation: readBSpecification,
      result: { _tag: "TaskWorkSpecificationReadReturned", body: "Implement B from F1.", taskId: taskB, title: "B F1" }
    },
    {
      causal: causal({ occurrenceRole: "active-B-F2", predecessorRoles: ["active-G1"] }),
      operation: readBSpecification,
      result: { _tag: "TaskWorkSpecificationReadReturned", body: "Implement B from F2.", taskId: taskB, title: "B F2" }
    }
  ]
})

const causalPrefix = [
  selection("independent-G0", []),
  graphResult("G0"),
  selection("active-G1", []),
  graphResult("G1")
] as const

const bindCausalPrefix = Effect.fn("AuthoredCassetteTest.bindCausalPrefix")(function* (cursor: StoryCursor) {
  yield* cursor.consumeDalphSelectionFor(readGraph, causalContext("operation:G0", []))
  yield* cursor.consumeTrackerGraphFor(target, causalContext("operation:G0", []))
  yield* cursor.consumeDalphSelectionFor(readGraph, causalContext("operation:G1", []))
  yield* cursor.consumeTrackerGraphFor(target, causalContext("operation:G1", []))
})

it.effect("binds an exact operation anchor without revalidating its earlier Journal-owned ancestry", () =>
  Effect.gen(function* () {
    const checked = Schema.decodeUnknownSync(AuthoredCassetteStoryItem.cases.ConcurrentTrackerReadBatch)({
      _tag: "ConcurrentTrackerReadBatch",
      members: [
        {
          causal: causal({ occurrenceRole: "active-G1", predecessorRoles: ["plan-B-F1"] }),
          operation: readGraph,
          result: { _tag: "TrackerGraphReadReturned", graph: graph("G1") }
        }
      ]
    })
    const cursor = yield* makeStoryCursor([anchorSelection("plan-B-F1", readBSpecification), checked, terminal])
    const plan = causalContext("operation:plan-B", ["operation:historical-graph", "operation:claim-B"])
    yield* cursor.consumeDalphSelectionFor(readBSpecification, plan)
    yield* cursor.consumeDalphSelectionFor(readGraph, causalContext("operation:G1", ["operation:plan-B"]))
    const returned = yield* cursor.consumeTrackerGraphFor(target, causalContext("operation:G1", ["operation:plan-B"]))
    expect(returned._tag).toBe("TrackerGraphReadReturned")
    if (returned._tag === "TrackerGraphReadReturned") expect(returned.graph.revision).toBe("G1")

    for (const predecessors of [
      ["operation:unknown"],
      ["operation:plan-B", "operation:extra"],
      ["operation:historical-graph"]
    ]) {
      const failing = yield* makeStoryCursor([anchorSelection("plan-B-F1", readBSpecification), checked, terminal])
      yield* failing.consumeDalphSelectionFor(readBSpecification, plan)
      const exit = yield* Effect.exit(
        failing.consumeDalphSelectionFor(readGraph, causalContext("operation:G1:invalid", predecessors))
      )
      expect(Exit.isFailure(exit), predecessors.join(",")).toBe(true)
      if (Exit.isFailure(exit)) expect(Cause.pretty(exit.cause)).toContain(AuthoredCausalSelectionFailure.name)
    }
  })
)

it.effect("binds authored roles at the real operation-selection trace seam", () =>
  Effect.gen(function* () {
    const cursor = yield* makeStoryCursor([...causalPrefix, sameShapeBatch, terminal])
    const trace = controlledTrace(cursor)
    const g0 = makeTrackerGraphObservationOperation(
      { _tag: "WorkflowEstablishment" },
      OperationId.make("operation:G0"),
      target
    )
    const g1 = makeTrackerGraphObservationOperation(
      { _tag: "WorkflowEstablishment" },
      OperationId.make("operation:G1"),
      target
    )
    const f1 = makeTaskWorkSpecificationObservationOperation(OperationId.make("operation:B:F1"), target, taskB, [
      g0.operationId
    ])
    const f2 = makeTaskWorkSpecificationObservationOperation(OperationId.make("operation:B:F2"), target, taskB, [
      g1.operationId
    ])
    const contextOf = (operation: typeof g0 | typeof f1): AuthoredOperationCausalContext => ({
      operationId: operation.operationId,
      predecessorOperationIds: operation.predecessorOperationIds
    })

    yield* trace.emit({ _tag: "OperationSelected", operation: g0 })
    expect((yield* consumeControlledTrackerGraph(cursor, target, contextOf(g0))).revision).toBe("G0")
    yield* trace.emit({ _tag: "OperationSelected", operation: g1 })
    expect((yield* consumeControlledTrackerGraph(cursor, target, contextOf(g1))).revision).toBe("G1")
    const boundaryOrder: Array<string> = []
    yield* trace.emit({ _tag: "OperationSelected", operation: f1 })
    boundaryOrder.push("Select F1")
    yield* trace.emit({ _tag: "OperationSelected", operation: f2 })
    boundaryOrder.push("Select F2")
    expect((yield* consumeControlledTaskWorkSpecification(cursor, taskB, contextOf(f2))).title).toBe("B F2")
    boundaryOrder.push("Return F2")
    expect((yield* consumeControlledTaskWorkSpecification(cursor, taskB, contextOf(f1))).title).toBe("B F1")
    boundaryOrder.push("Return F1")
    expect(boundaryOrder).toEqual(["Select F1", "Select F2", "Return F2", "Return F1"])
    expect(yield* cursor.storyPosition).toBe(causalPrefix.length + 1)
  })
)

it.effect("selects F1 then F2 and pairs reverse-completing reads with their exact initiating operations", () =>
  Effect.gen(function* () {
    const cursor = yield* makeStoryCursor([...causalPrefix, sameShapeBatch, terminal])
    yield* bindCausalPrefix(cursor)

    const activeF2 = causalContext("operation:B:F2", ["operation:G1"])
    const independentF1 = causalContext("operation:B:F1", ["operation:G0"])
    const boundaryOrder: Array<string> = []
    const independentSelection = yield* cursor.consumeDalphSelectionFor(readBSpecification, independentF1)
    boundaryOrder.push("Select F1")
    const activeSelection = yield* cursor.consumeDalphSelectionFor(readBSpecification, activeF2)
    boundaryOrder.push("Select F2")

    expect(independentSelection.operation).toEqual(readBSpecification)
    expect(activeSelection.operation).toEqual(readBSpecification)
    expect((yield* cursor.consumeTaskWorkSpecificationFor(taskB, activeF2)).title).toBe("B F2")
    boundaryOrder.push("Return F2")
    expect((yield* cursor.consumeTaskWorkSpecificationFor(taskB, independentF1)).title).toBe("B F1")
    boundaryOrder.push("Return F1")
    expect(boundaryOrder).toEqual(["Select F1", "Select F2", "Return F2", "Return F1"])
    expect(yield* cursor.storyPosition).toBe(causalPrefix.length + 1)

    const duplicate = yield* Effect.exit(cursor.consumeDalphSelectionFor(readBSpecification, activeF2))
    expect(Exit.isFailure(duplicate)).toBe(true)
    if (Exit.isFailure(duplicate)) {
      expect(Cause.pretty(duplicate.cause)).toContain("AuthoredCassetteInteractionMismatch")
    }
    expect(yield* cursor.consumeTerminalAssertions).toEqual(terminal)
  })
)

it.effect("fails closed for missing crossed foreign and duplicate causal relationships", () =>
  Effect.gen(function* () {
    const cases = [
      undefined,
      causalContext("operation:B:crossed", ["operation:G0", "operation:G1"]),
      causalContext("operation:B:foreign", ["operation:foreign"])
    ]

    for (const context of cases) {
      const cursor = yield* makeStoryCursor([...causalPrefix, sameShapeBatch, terminal])
      yield* bindCausalPrefix(cursor)
      const exit = yield* Effect.exit(cursor.consumeDalphSelectionFor(readBSpecification, context))
      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) expect(Cause.pretty(exit.cause)).toContain(AuthoredCausalSelectionFailure.name)
      expect(yield* cursor.storyPosition).toBe(causalPrefix.length)
    }

    const duplicateOwner = yield* makeStoryCursor([...causalPrefix, sameShapeBatch, terminal])
    yield* bindCausalPrefix(duplicateOwner)
    const first = causalContext("operation:B:duplicate", ["operation:G1"])
    yield* duplicateOwner.consumeDalphSelectionFor(readBSpecification, first)
    const duplicate = yield* Effect.exit(
      duplicateOwner.consumeDalphSelectionFor(
        readBSpecification,
        causalContext("operation:B:duplicate", ["operation:G0"])
      )
    )
    expect(Exit.isFailure(duplicate)).toBe(true)
    if (Exit.isFailure(duplicate)) expect(Cause.pretty(duplicate.cause)).toContain(AuthoredCausalSelectionFailure.name)
  })
)

it.effect("drains repeatedly forked exact read operations without resetting the story position", () =>
  Effect.gen(function* () {
    for (const activeFirst of [true, false, true, false]) {
      const cursor = yield* makeStoryCursor([...causalPrefix, sameShapeBatch, terminal])
      yield* bindCausalPrefix(cursor)
      const activeF2 = causalContext(`operation:B:F2:${activeFirst}`, ["operation:G1"])
      const independentF1 = causalContext(`operation:B:F1:${activeFirst}`, ["operation:G0"])
      const order = activeFirst ? ([activeF2, independentF1] as const) : ([independentF1, activeF2] as const)
      yield* Effect.forEach(
        order,
        (context) =>
          Effect.gen(function* () {
            yield* cursor.consumeDalphSelectionFor(readBSpecification, context)
            yield* cursor.consumeTaskWorkSpecificationFor(taskB, context)
          }),
        { concurrency: "unbounded" }
      )

      expect(yield* cursor.storyPosition).toBe(causalPrefix.length + 1)
      expect(yield* cursor.consumeTerminalAssertions).toEqual(terminal)
    }
  })
)

const observeThroughControlledExecutor = (
  cursor: StoryCursor,
  runId: RunId,
  correlation: { readonly attemptId: AttemptId; readonly runId: RunId },
  reports: Ref.Ref<ReadonlyMap<string, PlannedAttemptExecutorReport>>
) =>
  Effect.gen(function* () {
    const unresolved = yield* Ref.make<ReadonlySet<string>>(new Set())
    return yield* Effect.gen(function* () {
      const executor = yield* PlannedAttemptExecutor
      return yield* executor.observe(correlation, passiveLifecycleObservationPurpose)
    }).pipe(Effect.provide(controlledExecutorLayer(cursor, runId, () => Effect.void, reports, unresolved)))
  })

const attachThroughControlledExecutor = (
  cursor: StoryCursor,
  runId: RunId,
  correlation: { readonly attemptId: AttemptId; readonly runId: RunId },
  reports: Ref.Ref<ReadonlyMap<string, PlannedAttemptExecutorReport>>
) =>
  Effect.gen(function* () {
    const unresolved = yield* Ref.make<ReadonlySet<string>>(new Set())
    return yield* Effect.gen(function* () {
      const lifecycle = yield* PlannedAttemptExecutorLifecycleObservation
      return yield* lifecycle.attach(correlation)
    }).pipe(Effect.provide(controlledExecutorLayer(cursor, runId, () => Effect.void, reports, unresolved)))
  })

it.effect("reobserves B1 executing without advancing or manufacturing another report", () =>
  Effect.gen(function* () {
    const runId = RunId.make("active-work-run")
    const correlation = { attemptId: AttemptId.make("attempt:B:1"), runId }
    const executing = PlannedAttemptExecutorReport.cases.ExecutorWorkExecuting.make({ correlation })
    const reports = yield* Ref.make<ReadonlyMap<string, PlannedAttemptExecutorReport>>(
      new Map([[plannedAttemptExecutorCorrelationKey(correlation), executing]])
    )
    const cursor = yield* makeStoryCursor([terminal])

    expect((yield* attachThroughControlledExecutor(cursor, runId, correlation, reports)).current).toEqual({
      _tag: "Exact",
      report: executing
    })
    expect((yield* attachThroughControlledExecutor(cursor, runId, correlation, reports)).current).toEqual({
      _tag: "Exact",
      report: executing
    })
    expect(yield* cursor.storyPosition).toBe(0)
  })
)

it.effect("allows only B1 safe or terminal observations to consume B1's lifecycle result", () =>
  Effect.gen(function* () {
    for (const report of [
      { _tag: "ExecutorWorkSafelySuspended" as const, attemptId: AttemptId.make("attempt:B:1") },
      {
        _tag: "ExecutorWorkTerminal" as const,
        attemptId: AttemptId.make("attempt:B:1"),
        result: { _tag: "Completed" as const }
      }
    ]) {
      const runId = RunId.make(`active-work-${report._tag}`)
      const b = { attemptId: report.attemptId, runId }
      const foreign = { attemptId: AttemptId.make("attempt:C:1"), runId }
      const cursor = yield* makeStoryCursor([
        AuthoredCassetteStoryItem.cases.PlannedAttemptExecutorPassiveLifecycleChanged.make({ report }),
        terminal
      ])
      const reports = yield* Ref.make<ReadonlyMap<string, PlannedAttemptExecutorReport>>(new Map())

      const foreignSubscription = yield* attachThroughControlledExecutor(cursor, runId, foreign, reports)
      expect(foreignSubscription.current._tag).toBe("NoReport")
      const foreignChange = yield* Stream.runHead(foreignSubscription.changes).pipe(Effect.forkChild)
      expect(yield* cursor.storyPosition).toBe(0)
      const bSubscription = yield* attachThroughControlledExecutor(cursor, runId, b, reports)
      expect(bSubscription.current._tag).toBe("NoReport")
      const bChange = yield* Stream.runHead(bSubscription.changes)
      expect(Option.getOrUndefined(bChange)?._tag).toBe("Exact")
      expect(yield* cursor.storyPosition).toBe(1)
      expect(foreignChange.pollUnsafe()).toBeUndefined()
      yield* Fiber.interrupt(foreignChange)
    }
  })
)

it.effect("keeps requested executor projections ordered even in a causal tracker story", () =>
  Effect.gen(function* () {
    const runId = RunId.make("active-work-requested-projection")
    const b = { attemptId: AttemptId.make("attempt:B:1"), runId }
    const foreign = { attemptId: AttemptId.make("attempt:C:1"), runId }
    const cursor = yield* makeStoryCursor([
      anchorSelection("causal-only"),
      AuthoredCassetteStoryItem.cases.PlannedAttemptExecutorProjectionReturned.make({
        report: { _tag: "ExecutorWorkSafelySuspended", attemptId: b.attemptId }
      }),
      terminal
    ])
    yield* cursor.consumeDalphSelectionFor(readGraph, causalContext("operation:causal-only", []))
    const reports = yield* Ref.make<ReadonlyMap<string, PlannedAttemptExecutorReport>>(new Map())

    expect((yield* observeThroughControlledExecutor(cursor, runId, foreign, reports))._tag).toBe(
      "CorrelationContradiction"
    )
    expect(yield* cursor.storyPosition).toBe(2)
  })
)

it.effect("coalesces notification and timer hints then retains B1 until its exact safe report", () =>
  Effect.gen(function* () {
    const run = yield* runAuthoredScenarioCassette(activeWorkF2SafelySuspendsAuthoredCassette)
    const bAttemptId = AttemptId.make("attempt:B:1")
    const bReports = run.records.flatMap(({ event, position }) =>
      event._tag === "PlannedAttemptExecutorWorkReported" && event.report.correlation.attemptId === bAttemptId
        ? [{ position, report: event.report._tag }]
        : []
    )
    const suspends = run.records.filter(
      ({ event }) =>
        event._tag === "PlannedAttemptExecutorCommandIntended" &&
        event.command === "Suspend" &&
        event.plannedAttempt.attemptId === bAttemptId
    )
    const suspend = suspends[0]
    const changedF2 = run.records.find(
      ({ event }) =>
        event._tag === "TaskTrackerFactsObserved" &&
        event.observation._tag === "FocusedTaskWorkSpecificationFacts" &&
        event.observation.factFamily.taskId === taskB &&
        event.observation.factFamily.body === "Implement changed B from F2."
    )

    expect(run.cassette).toStrictEqual(activeWorkF2SafelySuspendsAuthoredCassette)
    expect(run.activationOrdinals).toEqual([1, 2, 3])
    expect(suspends).toHaveLength(1)
    expect(bReports.map(({ report }) => report)).toEqual(["ExecutorWorkExecuting", "ExecutorWorkSafelySuspended"])
    expect(changedF2?.position).toBeDefined()
    expect(suspend?.position).toBeDefined()
    expect(changedF2 !== undefined && suspend !== undefined && changedF2.position < suspend.position).toBe(true)
    const finalBReport = bReports.at(-1)
    expect(finalBReport).toBeDefined()
    expect(suspend !== undefined && finalBReport !== undefined && suspend.position < finalBReport.position).toBe(true)
    expect(run.observedBehavior.taskWorkResults).toEqual([])
  }).pipe(Effect.provide(NodeCrypto.layer))
)
