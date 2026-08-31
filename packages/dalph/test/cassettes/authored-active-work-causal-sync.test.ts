import { it } from "@effect/vitest"
import { Cause, Effect, Exit, Fiber, Ref, Schema } from "effect"
import { expect } from "vitest"
import {
  AttemptId,
  PlannedAttemptExecutor,
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
import { AuthoredCassetteStoryItem, AuthoredCausalSelection } from "../../src/cassettes/authored-domain.js"
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
    yield* trace.emit({ _tag: "OperationSelected", operation: f2 })
    yield* trace.emit({ _tag: "OperationSelected", operation: f1 })
    expect((yield* consumeControlledTaskWorkSpecification(cursor, taskB, contextOf(f1))).title).toBe("B F1")
    expect((yield* consumeControlledTaskWorkSpecification(cursor, taskB, contextOf(f2))).title).toBe("B F2")
    expect(yield* cursor.storyPosition).toBe(causalPrefix.length + 1)
  })
)

it.effect("pairs reverse-arriving same-shape B reads with their exact initiating operations exactly once", () =>
  Effect.gen(function* () {
    const cursor = yield* makeStoryCursor([...causalPrefix, sameShapeBatch, terminal])
    yield* bindCausalPrefix(cursor)

    const activeF2 = causalContext("operation:B:F2", ["operation:G1"])
    const independentF1 = causalContext("operation:B:F1", ["operation:G0"])
    const activeSelection = yield* cursor.consumeDalphSelectionFor(readBSpecification, activeF2).pipe(Effect.forkChild)
    yield* Effect.yieldNow
    const independentSelection = yield* cursor.consumeDalphSelectionFor(readBSpecification, independentF1)

    expect(independentSelection.operation).toEqual(readBSpecification)
    expect((yield* cursor.consumeTaskWorkSpecificationFor(taskB, independentF1)).title).toBe("B F1")
    expect((yield* Fiber.join(activeSelection)).operation).toEqual(readBSpecification)
    expect((yield* cursor.consumeTaskWorkSpecificationFor(taskB, activeF2)).title).toBe("B F2")
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

it.effect("reobserves B1 executing without advancing or manufacturing another report", () =>
  Effect.gen(function* () {
    const runId = RunId.make("active-work-run")
    const correlation = { attemptId: AttemptId.make("attempt:B:1"), runId }
    const executing = PlannedAttemptExecutorReport.cases.ExecutorWorkExecuting.make({ correlation })
    const reports = yield* Ref.make<ReadonlyMap<string, PlannedAttemptExecutorReport>>(
      new Map([[plannedAttemptExecutorCorrelationKey(correlation), executing]])
    )
    const cursor = yield* makeStoryCursor([terminal], { exactCausalSynchronization: () => true })

    expect(yield* observeThroughControlledExecutor(cursor, runId, correlation, reports)).toEqual({
      _tag: "Exact",
      report: executing
    })
    expect(yield* observeThroughControlledExecutor(cursor, runId, correlation, reports)).toEqual({
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
      const cursor = yield* makeStoryCursor(
        [AuthoredCassetteStoryItem.cases.PlannedAttemptExecutorProjectionReturned.make({ report }), terminal],
        { exactCausalSynchronization: () => true }
      )
      const reports = yield* Ref.make<ReadonlyMap<string, PlannedAttemptExecutorReport>>(new Map())

      expect((yield* observeThroughControlledExecutor(cursor, runId, foreign, reports))._tag).toBe(
        "CorrelationContradiction"
      )
      expect(yield* cursor.storyPosition).toBe(0)
      expect((yield* observeThroughControlledExecutor(cursor, runId, b, reports))._tag).toBe("Exact")
      expect(yield* cursor.storyPosition).toBe(1)
    }
  })
)
