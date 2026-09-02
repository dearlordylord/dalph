import { it } from "@effect/vitest"
import { NodeCrypto } from "@effect/platform-node"
import { Cause, Deferred, Effect, Exit, Fiber, Layer, Option, Ref, Schema, Stream } from "effect"
import { expect } from "vitest"
import {
  AttemptId,
  GitCommitSha,
  PlannedAttemptExecutor,
  PlannedAttemptExecutorCommandFailure,
  PlannedAttemptExecutorLifecycleObservation,
  PlannedAttemptExecutorProjection,
  PlannedAttemptExecutorReport,
  PlannedTaskAttempt,
  RunId,
  TaskBranchRef,
  TaskExecutorLocator,
  TaskId,
  TaskRevision,
  WorktreeLocator,
  passiveLifecycleObservationPurpose,
  plannedAttemptExecutorCorrelationKey
} from "@dalph/contracts"
import {
  FixtureTarget,
  InRunJournal,
  JournalDataCorruption,
  JournalHistoryCorruption,
  JournalPartitionContradiction,
  JournalPosition,
  JournalSchemaIncompatible,
  JournalSchemaVersion,
  JournalStorageAccessDenied,
  JournalStorageCapacityExhausted,
  JournalStorageLocked,
  JournalStorageUnavailable,
  JournalStore,
  memoryJournalTestLayer,
  observePlannedAttemptExecutorState,
  plannedAttemptExecutorCommandIntendedRecordKey,
  plannedAttemptProtocolControllerLayer,
  plannedAttemptExecutorWorkResponsibilityBeganRecordKey,
  plannedAttemptExecutorWorkReportedRecordKey,
  PlannedAttemptExecutorCommandIntendedEvent,
  PlannedAttemptExecutorCommandOrdinal,
  PlannedAttemptExecutorReportOrdinal,
  PlannedAttemptExecutorWorkReportedEvent,
  PlannedAttemptExecutorWorkResponsibilityBeganEvent,
  requestPlannedAttemptExecutorSuspension,
  TaskWorkCapacity,
  OperationId,
  TraceOutputError,
  TrackerRevision,
  workflowJournalEventVersion,
  makeTaskWorkSpecificationObservationOperation,
  makeTrackerGraphObservationOperation
} from "@dalph/orchestrator"
import {
  type AuthoredCassetteDecision,
  AuthoredCassetteStoryItem,
  AuthoredCausalSelection,
  AuthoredScenarioCassette
} from "../../src/cassettes/authored-domain.js"
import {
  type AuthoredCassetteInteractionMismatch,
  AuthoredCausalSelectionFailure,
  type AuthoredOperationCausalContext,
  type AuthoredSafelySuspendedExecutorReportItem,
  type StoryCursor,
  makeStoryCursor
} from "../../src/cassettes/authored-cursor.js"
import {
  type ControlledExecutorConfig,
  controlledExecutorLayer,
  controlledTrace
} from "../../src/cassettes/authored-adapters.js"
import {
  consumeControlledTaskWorkSpecification,
  consumeControlledTrackerGraph
} from "../../src/cassettes/authored-tracker-read-results.js"
import {
  activeWorkF2SafelySuspendsAuthoredCassette,
  maintainedAuthoredCassetteCatalog,
  runAuthoredScenarioCassette
} from "../../src/cassettes/index.js"
import { settleAuthoredSafelySuspendedPublication } from "../../src/cassettes/authored-runner.js"
import { runUnpauseAfterSafeSuspensionAuthoredCassette } from "../../src/cassettes/catalog.js"

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

const isSafelySuspendedExecutorReport = (
  item: AuthoredCassetteStoryItem
): item is AuthoredSafelySuspendedExecutorReportItem =>
  item._tag === "PlannedAttemptExecutorWorkReported" &&
  item.request === "Suspend" &&
  item.report._tag === "ExecutorWorkSafelySuspended"

it.effect("keeps Continue B unavailable before the production C2 Safe publication", () =>
  Effect.gen(function* () {
    const capstone = maintainedAuthoredCassetteCatalog.autonomousExecutorDeliveryCapstone
    const safeIndex = capstone.story.findIndex(
      (item) =>
        item._tag === "PlannedAttemptExecutorWorkReported" &&
        item.request === "Suspend" &&
        item.report._tag === "ExecutorWorkSafelySuspended" &&
        item.report.attemptId === "attempt:C:2"
    )
    const safe = capstone.story[safeIndex]
    const continued = capstone.story[safeIndex + 1]
    if (
      safe?._tag !== "PlannedAttemptExecutorWorkReported" ||
      safe.report._tag !== "ExecutorWorkSafelySuspended" ||
      continued?._tag !== "OperatorContinuesAttempt"
    ) {
      return yield* Effect.die("the capstone does not contain the exact C2 Safe/Continue B cut")
    }
    const cursor = yield* makeStoryCursor([safe, continued])
    const providerReturned = yield* Deferred.make<void>()
    const acceptedPublication = yield* Deferred.make<void>()
    const production = yield* Effect.gen(function* () {
      yield* cursor.consumeExecutorReportFor("Suspend", safe.report.attemptId)
      yield* Deferred.succeed(providerReturned, undefined)
      yield* Deferred.await(acceptedPublication)
    }).pipe(Effect.forkChild)

    yield* Deferred.await(providerReturned)
    const continueAttempted = yield* Deferred.make<void>()
    const continueFinished = yield* Deferred.make<void>()
    const earlyContinue = yield* Deferred.succeed(continueAttempted, undefined).pipe(
      Effect.andThen(cursor.consumeAttemptChoice),
      Effect.tap(() => Deferred.succeed(continueFinished, undefined)),
      Effect.forkChild({ startImmediately: true })
    )
    yield* Deferred.await(continueAttempted)
    expect(yield* Deferred.isDone(continueFinished)).toBe(false)
    expect(yield* cursor.storyPosition).toBe(0)
    yield* Fiber.interrupt(earlyContinue)
    yield* Fiber.interrupt(production)
  })
)

it.effect("settles exact C2 Safe once before delayed interruption and Continue B", () =>
  Effect.gen(function* () {
    const capstone = maintainedAuthoredCassetteCatalog.autonomousExecutorDeliveryCapstone
    const safeIndex = capstone.story.findIndex(
      (item) =>
        item._tag === "PlannedAttemptExecutorWorkReported" &&
        item.request === "Suspend" &&
        item.report._tag === "ExecutorWorkSafelySuspended" &&
        item.report.attemptId === "attempt:C:2"
    )
    const safe = capstone.story[safeIndex]
    const continued = capstone.story[safeIndex + 1]
    if (
      safe?._tag !== "PlannedAttemptExecutorWorkReported" ||
      safe.request !== "Suspend" ||
      safe.report._tag !== "ExecutorWorkSafelySuspended" ||
      continued?._tag !== "OperatorContinuesAttempt"
    ) {
      return yield* Effect.die("the capstone does not contain the exact C2 Safe/Continue B cut")
    }
    const journalReadEntered = yield* Deferred.make<void>()
    const releaseJournalRead = yield* Deferred.make<void>()
    const occurrenceCount = yield* Ref.make(0)
    const cursor = yield* makeStoryCursor([safe, continued], {
      onOccurrence: ({ item }) =>
        item._tag === "PlannedAttemptExecutorWorkReported"
          ? Ref.update(occurrenceCount, (count) => count + 1)
          : Effect.void
    })
    const reserved = yield* cursor.consumeExecutorReportFor("Suspend", safe.report.attemptId)
    if (!isSafelySuspendedExecutorReport(reserved)) {
      return yield* Effect.die("the exact C2 Safe item was not reserved")
    }

    const runId = RunId.make("authored-c2-safe-settlement")
    const acceptedThrough = JournalPosition.make(2)
    const correlation = { attemptId: safe.report.attemptId, runId }
    const ordinal = PlannedAttemptExecutorReportOrdinal.make(2)
    const report = PlannedAttemptExecutorReport.cases.ExecutorWorkSafelySuspended.make({ correlation })
    const record = {
      event: PlannedAttemptExecutorWorkReportedEvent.make({ ordinal, report, version: workflowJournalEventVersion }),
      key: plannedAttemptExecutorWorkReportedRecordKey(correlation.attemptId, ordinal),
      position: acceptedThrough,
      runId
    }
    const acceptedSafeReport = yield* Ref.make(Option.some(reserved))
    const settlement = yield* settleAuthoredSafelySuspendedPublication({
      acceptedSafeReport,
      acceptedThrough,
      cursor,
      readJournal: () =>
        Deferred.succeed(journalReadEntered, undefined).pipe(
          Effect.andThen(Deferred.await(releaseJournalRead)),
          Effect.as([record])
        ),
      runId
    }).pipe(Effect.forkScoped({ startImmediately: true }))
    yield* Deferred.await(journalReadEntered)
    const interruptionRequested = yield* Deferred.make<void>()
    const interruptionFinished = yield* Deferred.make<void>()
    const interrupted = yield* Deferred.succeed(interruptionRequested, undefined).pipe(
      Effect.andThen(Fiber.interrupt(settlement)),
      Effect.tap(() => Deferred.succeed(interruptionFinished, undefined)),
      Effect.forkScoped({ startImmediately: true })
    )
    yield* Deferred.await(interruptionRequested)
    const continueAttempted = yield* Deferred.make<void>()
    const continueFinished = yield* Deferred.make<void>()
    const nextChoice = yield* Deferred.succeed(continueAttempted, undefined).pipe(
      Effect.andThen(cursor.consumeAttemptChoice),
      Effect.tap(() => Deferred.succeed(continueFinished, undefined)),
      Effect.forkScoped({ startImmediately: true })
    )
    yield* Deferred.await(continueAttempted)
    expect(yield* Deferred.isDone(interruptionFinished)).toBe(false)
    expect(yield* Deferred.isDone(continueFinished)).toBe(false)
    expect(yield* cursor.storyPosition).toBe(0)

    yield* Deferred.succeed(releaseJournalRead, undefined)
    yield* Fiber.join(interrupted)
    expect(Exit.isFailure(yield* Fiber.await(settlement))).toBe(true)
    expect(yield* Fiber.join(nextChoice)).toEqual(Option.some(continued))
    expect(yield* Ref.get(occurrenceCount)).toBe(1)
    expect(yield* cursor.storyPosition).toBe(2)

    const duplicate = yield* cursor.settleSafelySuspendedExecutorReport(reserved).pipe(Effect.exit)
    expect(Exit.isFailure(duplicate)).toBe(true)
  })
)

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
  reports: Ref.Ref<ReadonlyMap<string, PlannedAttemptExecutorReport>>,
  beforeExecutorReport: ControlledExecutorConfig["beforeExecutorReport"] = () => Effect.void
) =>
  Effect.gen(function* () {
    const unresolved = yield* Ref.make<ReadonlySet<string>>(new Set())
    return yield* Effect.gen(function* () {
      const executor = yield* PlannedAttemptExecutor
      return yield* executor.observe(correlation, passiveLifecycleObservationPurpose)
    }).pipe(
      Effect.provide(
        controlledExecutorLayer({
          cursor,
          runId,
          beforeExecutorReport,
          survivingReports: reports,
          unresolvedLostResponses: unresolved
        })
      )
    )
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
    }).pipe(
      Effect.provide(
        controlledExecutorLayer({
          cursor,
          runId,
          beforeExecutorReport: () => Effect.void,
          survivingReports: reports,
          unresolvedLostResponses: unresolved
        })
      )
    )
  })

type C2JournalReadFailure = Effect.Error<ReturnType<JournalStore["Service"]["read"]>>
type C2JournalReadFailureFixtures = {
  readonly [Tag in C2JournalReadFailure["_tag"]]: Extract<C2JournalReadFailure, { readonly _tag: Tag }>
}

const c2JournalReadFailureFixtures = (runId: RunId): C2JournalReadFailureFixtures => {
  const operation = "JournalStore.read" as const
  return {
    JournalDataCorruption: new JournalDataCorruption({ detail: "invalid C2 bytes", operation }),
    JournalHistoryCorruption: new JournalHistoryCorruption({
      detail: "invalid C2 history",
      operation,
      partition: "Hot",
      runId
    }),
    JournalPartitionContradiction: new JournalPartitionContradiction({ runId }),
    JournalSchemaIncompatible: new JournalSchemaIncompatible({
      found: JournalSchemaVersion.make(2),
      supported: JournalSchemaVersion.make(1)
    }),
    JournalStorageAccessDenied: new JournalStorageAccessDenied({ detail: "C2 read denied", operation }),
    JournalStorageCapacityExhausted: new JournalStorageCapacityExhausted({
      detail: "C2 read capacity exhausted",
      operation
    }),
    JournalStorageLocked: new JournalStorageLocked({ detail: "C2 read locked", operation }),
    JournalStorageUnavailable: new JournalStorageUnavailable({ detail: "C2 read unavailable", operation })
  }
}

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

it.effect("reobserves an exact committed Safe report while its authored publication is still reserved", () =>
  Effect.gen(function* () {
    const runId = RunId.make("active-work-committed-safe-reobservation")
    const correlation = { attemptId: AttemptId.make("attempt:C:2"), runId }
    const safe = AuthoredCassetteStoryItem.cases.PlannedAttemptExecutorWorkReported.make({
      report: { _tag: "ExecutorWorkSafelySuspended", attemptId: correlation.attemptId },
      request: "Suspend"
    })
    const cursor = yield* makeStoryCursor([safe, terminal])
    yield* cursor.consumeExecutorReportFor("Suspend", correlation.attemptId)
    const committed = PlannedAttemptExecutorReport.cases.ExecutorWorkSafelySuspended.make({ correlation })
    const reports = yield* Ref.make<ReadonlyMap<string, PlannedAttemptExecutorReport>>(
      new Map([[plannedAttemptExecutorCorrelationKey(correlation), committed]])
    )

    expect(yield* observeThroughControlledExecutor(cursor, runId, correlation, reports)).toEqual({
      _tag: "Exact",
      report: committed
    })
    expect(yield* cursor.storyPosition).toBe(0)
  })
)

it.effect("fails exact reserved Safe reconciliation for missing, wrong, or unresolved surviving reports", () =>
  Effect.gen(function* () {
    const runId = RunId.make("active-work-invalid-safe-reobservation")
    const correlation = { attemptId: AttemptId.make("attempt:C:2"), runId }
    const foreignCorrelation = { attemptId: AttemptId.make("attempt:C:foreign"), runId }
    const safe = AuthoredCassetteStoryItem.cases.PlannedAttemptExecutorWorkReported.make({
      report: { _tag: "ExecutorWorkSafelySuspended", attemptId: correlation.attemptId },
      request: "Suspend"
    })
    for (const fixture of [
      { report: undefined, unresolved: false },
      { report: PlannedAttemptExecutorReport.cases.ExecutorWorkExecuting.make({ correlation }), unresolved: false },
      {
        report: PlannedAttemptExecutorReport.cases.ExecutorWorkSafelySuspended.make({
          correlation: foreignCorrelation
        }),
        unresolved: false
      },
      { report: PlannedAttemptExecutorReport.cases.ExecutorWorkSafelySuspended.make({ correlation }), unresolved: true }
    ]) {
      const cursor = yield* makeStoryCursor([safe, terminal])
      yield* cursor.consumeExecutorReportFor("Suspend", correlation.attemptId)
      const key = plannedAttemptExecutorCorrelationKey(correlation)
      const reports = yield* Ref.make<ReadonlyMap<string, PlannedAttemptExecutorReport>>(
        fixture.report === undefined ? new Map() : new Map([[key, fixture.report]])
      )
      const unresolved = yield* Ref.make<ReadonlySet<string>>(fixture.unresolved ? new Set([key]) : new Set())
      const captured = yield* Ref.make<AuthoredCassetteInteractionMismatch | undefined>(undefined)
      const exit = yield* Effect.gen(function* () {
        const executor = yield* PlannedAttemptExecutor
        return yield* executor.observe(correlation, passiveLifecycleObservationPurpose)
      }).pipe(
        Effect.provide(
          controlledExecutorLayer({
            cursor,
            runId,
            beforeExecutorReport: () => Effect.void,
            survivingReports: reports,
            unresolvedLostResponses: unresolved,
            prepareReport: Effect.succeed,
            reserveAcceptedSafeReport: () => Effect.void,
            reportMismatch: (failure) => Ref.set(captured, failure)
          })
        ),
        Effect.exit
      )

      expect(Exit.isFailure(exit)).toBe(true)
      const failure = yield* Ref.get(captured)
      expect(failure).toMatchObject({
        _tag: "AuthoredCassetteInteractionMismatch",
        actual: JSON.stringify({
          correlation: fixture.report?.correlation ?? null,
          report: fixture.report?._tag ?? "NoReport",
          unresolved: fixture.unresolved
        }),
        expected: "committed ExecutorWorkSafelySuspended for attempt:C:2",
        storyPosition: 0
      })
      if (Exit.isFailure(exit)) {
        expect(exit.cause.reasons.flatMap((reason) => (Cause.isDieReason(reason) ? [reason.defect] : []))).toContain(
          failure
        )
      }
    }
  })
)

it.effect("preserves named C2 Safe failure families and reconciles a committed lost response without retry", () =>
  Effect.gen(function* () {
    const capstone = maintainedAuthoredCassetteCatalog.autonomousExecutorDeliveryCapstone
    const safeIndex = capstone.story.findIndex(
      (item) =>
        item._tag === "PlannedAttemptExecutorWorkReported" &&
        item.request === "Suspend" &&
        item.report._tag === "ExecutorWorkSafelySuspended" &&
        item.report.attemptId === "attempt:C:2"
    )
    const safe = capstone.story[safeIndex]
    const continued = capstone.story[safeIndex + 1]
    if (
      safe?._tag !== "PlannedAttemptExecutorWorkReported" ||
      safe.request !== "Suspend" ||
      safe.report._tag !== "ExecutorWorkSafelySuspended" ||
      continued?._tag !== "OperatorContinuesAttempt" ||
      continued.attemptId !== "attempt:B:1"
    ) {
      return yield* Effect.die("the capstone does not contain the exact C2 Safe to Continue B identity cut")
    }

    const runId = RunId.make("authored-c2-failure-and-reconciliation")
    const correlation = { attemptId: safe.report.attemptId, runId }
    const acceptedThrough = JournalPosition.make(2)
    const ordinal = PlannedAttemptExecutorReportOrdinal.make(2)
    const committed = PlannedAttemptExecutorReport.cases.ExecutorWorkSafelySuspended.make({ correlation })
    const record = {
      event: PlannedAttemptExecutorWorkReportedEvent.make({
        ordinal,
        report: committed,
        version: workflowJournalEventVersion
      }),
      key: plannedAttemptExecutorWorkReportedRecordKey(correlation.attemptId, ordinal),
      position: acceptedThrough,
      runId
    }

    const directSuspendCursor = yield* makeStoryCursor([safe, continued])
    const directSuspendCalls = yield* Ref.make(0)
    const directSuspendFailure = new PlannedAttemptExecutorCommandFailure({
      command: "Suspend",
      correlation,
      detail: "the exact C2 Suspend provider failed before returning a report"
    })
    const plannedAttempt = PlannedTaskAttempt.make({
      attemptId: correlation.attemptId,
      baseSha: GitCommitSha.make("c".repeat(40)),
      branch: TaskBranchRef.make("refs/heads/dalph/c2-safe-failure"),
      executor: TaskExecutorLocator.make("executor:c2-safe-failure"),
      runId,
      taskId: TaskId.make("C"),
      taskRevision: TaskRevision.make("C2-safe-failure-revision"),
      worktree: WorktreeLocator.make("/dalph/cassettes/c2-safe-failure")
    })
    const appendResponsibility = (attempt: PlannedTaskAttempt = plannedAttempt) =>
      Effect.gen(function* () {
        const journal = yield* JournalStore
        yield* journal.append(
          attempt.runId,
          plannedAttemptExecutorWorkResponsibilityBeganRecordKey(attempt.attemptId),
          PlannedAttemptExecutorWorkResponsibilityBeganEvent.make({
            plannedAttempt: attempt,
            version: workflowJournalEventVersion
          })
        )
      })
    const appendReport = (report: PlannedAttemptExecutorReport) =>
      Effect.gen(function* () {
        const journal = yield* JournalStore
        yield* journal.append(
          report.correlation.runId,
          plannedAttemptExecutorWorkReportedRecordKey(
            report.correlation.attemptId,
            PlannedAttemptExecutorReportOrdinal.make(1)
          ),
          PlannedAttemptExecutorWorkReportedEvent.make({
            ordinal: PlannedAttemptExecutorReportOrdinal.make(1),
            report,
            version: workflowJournalEventVersion
          })
        )
      })
    const appendUnsettledSuspend = Effect.gen(function* () {
      const journal = yield* JournalStore
      const commandOrdinal = PlannedAttemptExecutorCommandOrdinal.make(1)
      yield* journal.append(
        plannedAttempt.runId,
        plannedAttemptExecutorCommandIntendedRecordKey(plannedAttempt.attemptId, commandOrdinal),
        PlannedAttemptExecutorCommandIntendedEvent.make({
          command: "Suspend",
          initiatedBy: { _tag: "DalphCoordinator" },
          occurrenceClassification: "InitiatedAction",
          ordinal: commandOrdinal,
          plannedAttempt,
          version: workflowJournalEventVersion
        })
      )
    })
    const executing = PlannedAttemptExecutorReport.cases.ExecutorWorkExecuting.make({ correlation })
    const safeReport = PlannedAttemptExecutorReport.cases.ExecutorWorkSafelySuspended.make({ correlation })
    const unusedExecutor = PlannedAttemptExecutor.of({
      begin: () => Effect.die("C2 failure fixture must not begin"),
      observe: () => Effect.die("C2 failure fixture must not observe"),
      requestSuspension: () => Effect.die("C2 failure fixture must not suspend"),
      resume: () => Effect.die("C2 failure fixture must not resume")
    })
    const assertProtocolFailure = <E, Expected extends { readonly _tag: string }>(
      operation: Effect.Effect<unknown, E>,
      expected: Expected
    ) =>
      Effect.gen(function* () {
        const failureCursor = yield* makeStoryCursor([safe, continued])
        const failure = yield* operation.pipe(
          Effect.tap(() =>
            Effect.gen(function* () {
              const reserved = yield* failureCursor.consumeExecutorReportFor("Suspend", correlation.attemptId)
              if (!isSafelySuspendedExecutorReport(reserved)) {
                return yield* Effect.die("a successful C2 protocol result must reserve exact Safe before settlement")
              }
              yield* failureCursor.settleSafelySuspendedExecutorReport(reserved)
            })
          ),
          Effect.flip
        )
        expect(failure).toMatchObject(expected)
        expect(yield* failureCursor.storyPosition).toBe(0)
        expect(Option.isNone(yield* failureCursor.consumeAttemptChoice)).toBe(true)
        expect((yield* failureCursor.currentStoryItem)?._tag).toBe("PlannedAttemptExecutorWorkReported")
      })

    const readFailure = new JournalStorageUnavailable({
      detail: "the C2 protocol Journal read failed",
      operation: "JournalStore.read"
    })
    const readCalls = yield* Ref.make(0)
    const readAppendCalls = yield* Ref.make(0)
    yield* assertProtocolFailure(
      requestPlannedAttemptExecutorSuspension(plannedAttempt).pipe(
        Effect.provideService(PlannedAttemptExecutor, unusedExecutor),
        Effect.provide(plannedAttemptProtocolControllerLayer),
        Effect.provide(
          Layer.succeed(
            InRunJournal,
            InRunJournal.of({
              append: () =>
                Ref.update(readAppendCalls, (count) => count + 1).pipe(Effect.andThen(Effect.die("unused"))),
              read: () => Ref.update(readCalls, (count) => count + 1).pipe(Effect.andThen(Effect.fail(readFailure)))
            })
          )
        )
      ),
      readFailure
    )
    expect(yield* Ref.get(readCalls)).toBe(1)
    expect(yield* Ref.get(readAppendCalls)).toBe(0)

    const appendFailure = new JournalStorageUnavailable({
      detail: "the C2 protocol Journal append failed",
      operation: "JournalStore.append"
    })
    const appendReadCalls = yield* Ref.make(0)
    const appendCalls = yield* Ref.make(0)
    yield* assertProtocolFailure(
      requestPlannedAttemptExecutorSuspension(plannedAttempt).pipe(
        Effect.provideService(PlannedAttemptExecutor, unusedExecutor),
        Effect.provide(plannedAttemptProtocolControllerLayer),
        Effect.provide(
          Layer.succeed(
            InRunJournal,
            InRunJournal.of({
              append: () =>
                Ref.update(appendCalls, (count) => count + 1).pipe(Effect.andThen(Effect.fail(appendFailure))),
              read: () => Ref.update(appendReadCalls, (count) => count + 1).pipe(Effect.as([]))
            })
          )
        )
      ),
      appendFailure
    )
    expect(yield* Ref.get(appendReadCalls)).toBe(1)
    expect(yield* Ref.get(appendCalls)).toBe(1)

    const commandCalls = yield* Ref.make(0)
    const commandFailure = new PlannedAttemptExecutorCommandFailure({
      command: "Suspend",
      correlation,
      detail: "the exact C2 Suspend provider failed"
    })
    yield* assertProtocolFailure(
      Effect.gen(function* () {
        yield* appendResponsibility()
        yield* appendReport(executing)
        return yield* requestPlannedAttemptExecutorSuspension(plannedAttempt)
      }).pipe(
        Effect.provideService(PlannedAttemptExecutor, {
          ...unusedExecutor,
          requestSuspension: () =>
            Ref.update(commandCalls, (count) => count + 1).pipe(Effect.andThen(Effect.fail(commandFailure)))
        }),
        Effect.provide(plannedAttemptProtocolControllerLayer),
        Effect.provide(memoryJournalTestLayer)
      ),
      commandFailure
    )
    expect(yield* Ref.get(commandCalls)).toBe(1)

    const foreignCorrelation = { attemptId: AttemptId.make("attempt:C:foreign"), runId }
    const correlationCalls = yield* Ref.make(0)
    yield* assertProtocolFailure(
      Effect.gen(function* () {
        yield* appendResponsibility()
        yield* appendReport(executing)
        return yield* requestPlannedAttemptExecutorSuspension(plannedAttempt)
      }).pipe(
        Effect.provideService(PlannedAttemptExecutor, {
          ...unusedExecutor,
          requestSuspension: () =>
            Ref.update(correlationCalls, (count) => count + 1).pipe(
              Effect.as(
                PlannedAttemptExecutorReport.cases.ExecutorWorkSafelySuspended.make({ correlation: foreignCorrelation })
              )
            )
        }),
        Effect.provide(plannedAttemptProtocolControllerLayer),
        Effect.provide(memoryJournalTestLayer)
      ),
      { _tag: "PlannedAttemptExecutorCorrelationMismatch", expected: correlation, observed: foreignCorrelation }
    )
    expect(yield* Ref.get(correlationCalls)).toBe(1)

    const contradictoryAttempt = PlannedTaskAttempt.make({
      ...plannedAttempt,
      taskRevision: TaskRevision.make("C2-contradictory-responsibility")
    })
    const responsibilityCalls = yield* Ref.make(0)
    yield* assertProtocolFailure(
      Effect.gen(function* () {
        yield* appendResponsibility(contradictoryAttempt)
        return yield* requestPlannedAttemptExecutorSuspension(plannedAttempt)
      }).pipe(
        Effect.provideService(PlannedAttemptExecutor, {
          ...unusedExecutor,
          requestSuspension: () => Ref.update(responsibilityCalls, (count) => count + 1).pipe(Effect.as(safeReport))
        }),
        Effect.provide(plannedAttemptProtocolControllerLayer),
        Effect.provide(memoryJournalTestLayer)
      ),
      {
        _tag: "PlannedAttemptExecutorResponsibilityContradiction",
        accepted: contradictoryAttempt,
        requested: plannedAttempt
      }
    )
    expect(yield* Ref.get(responsibilityCalls)).toBe(0)

    const unauthorizedCalls = yield* Ref.make(0)
    yield* assertProtocolFailure(
      requestPlannedAttemptExecutorSuspension(plannedAttempt).pipe(
        Effect.provideService(PlannedAttemptExecutor, {
          ...unusedExecutor,
          requestSuspension: () => Ref.update(unauthorizedCalls, (count) => count + 1).pipe(Effect.as(safeReport))
        }),
        Effect.provide(plannedAttemptProtocolControllerLayer),
        Effect.provide(memoryJournalTestLayer)
      ),
      { _tag: "PlannedAttemptExecutorSuspensionNotAuthorized", correlation }
    )
    expect(yield* Ref.get(unauthorizedCalls)).toBe(0)

    const limitCalls = yield* Ref.make(0)
    yield* assertProtocolFailure(
      Effect.gen(function* () {
        yield* appendResponsibility()
        yield* appendReport(executing)
        yield* requestPlannedAttemptExecutorSuspension(plannedAttempt)
        yield* requestPlannedAttemptExecutorSuspension(plannedAttempt)
        yield* requestPlannedAttemptExecutorSuspension(plannedAttempt)
        return yield* requestPlannedAttemptExecutorSuspension(plannedAttempt)
      }).pipe(
        Effect.provideService(PlannedAttemptExecutor, {
          ...unusedExecutor,
          requestSuspension: () => Ref.update(limitCalls, (count) => count + 1).pipe(Effect.as(executing))
        }),
        Effect.provide(plannedAttemptProtocolControllerLayer),
        Effect.provide(memoryJournalTestLayer)
      ),
      { _tag: "PlannedAttemptExecutorSuspensionLimitReached", correlation, limit: 3 }
    )
    expect(yield* Ref.get(limitCalls)).toBe(3)

    const terminal = PlannedAttemptExecutorReport.cases.ExecutorWorkTerminal.make({
      correlation,
      result: { _tag: "Completed" }
    })
    const terminalCalls = yield* Ref.make(0)
    yield* assertProtocolFailure(
      Effect.gen(function* () {
        yield* appendResponsibility()
        yield* appendReport(terminal)
        return yield* requestPlannedAttemptExecutorSuspension(plannedAttempt)
      }).pipe(
        Effect.provideService(PlannedAttemptExecutor, {
          ...unusedExecutor,
          requestSuspension: () => Ref.update(terminalCalls, (count) => count + 1).pipe(Effect.as(safeReport))
        }),
        Effect.provide(plannedAttemptProtocolControllerLayer),
        Effect.provide(memoryJournalTestLayer)
      ),
      { _tag: "PlannedAttemptExecutorWorkAlreadyTerminal", correlation }
    )
    expect(yield* Ref.get(terminalCalls)).toBe(0)

    const reconcileObserveCalls = yield* Ref.make(0)
    const reconcileSuspendCalls = yield* Ref.make(0)
    yield* assertProtocolFailure(
      Effect.gen(function* () {
        yield* appendResponsibility()
        yield* appendReport(executing)
        yield* appendUnsettledSuspend
        return yield* requestPlannedAttemptExecutorSuspension(plannedAttempt)
      }).pipe(
        Effect.provideService(PlannedAttemptExecutor, {
          ...unusedExecutor,
          observe: () =>
            Ref.update(reconcileObserveCalls, (count) => count + 1).pipe(
              Effect.as(PlannedAttemptExecutorProjection.cases.NoReport.make({ correlation }))
            ),
          requestSuspension: () => Ref.update(reconcileSuspendCalls, (count) => count + 1).pipe(Effect.as(safeReport))
        }),
        Effect.provide(plannedAttemptProtocolControllerLayer),
        Effect.provide(memoryJournalTestLayer)
      ),
      { _tag: "PlannedAttemptExecutorProjectionNoCurrentReport", commandOrdinal: 1, correlation }
    )
    expect(yield* Ref.get(reconcileObserveCalls)).toBe(1)
    expect(yield* Ref.get(reconcileSuspendCalls)).toBe(0)

    const projectionCorrelationCalls = yield* Ref.make(0)
    yield* assertProtocolFailure(
      Effect.gen(function* () {
        yield* appendResponsibility()
        yield* appendReport(executing)
        yield* appendUnsettledSuspend
        return yield* requestPlannedAttemptExecutorSuspension(plannedAttempt)
      }).pipe(
        Effect.provideService(PlannedAttemptExecutor, {
          ...unusedExecutor,
          observe: () =>
            Ref.update(projectionCorrelationCalls, (count) => count + 1).pipe(
              Effect.as(PlannedAttemptExecutorProjection.cases.NoReport.make({ correlation: foreignCorrelation }))
            )
        }),
        Effect.provide(plannedAttemptProtocolControllerLayer),
        Effect.provide(memoryJournalTestLayer)
      ),
      {
        _tag: "PlannedAttemptExecutorProjectionCorrelationMismatch",
        expected: correlation,
        observed: foreignCorrelation
      }
    )
    expect(yield* Ref.get(projectionCorrelationCalls)).toBe(1)

    const initializationCalls = yield* Ref.make(0)
    yield* assertProtocolFailure(
      Effect.gen(function* () {
        yield* appendResponsibility()
        yield* appendReport(executing)
        yield* appendUnsettledSuspend
        return yield* requestPlannedAttemptExecutorSuspension(plannedAttempt)
      }).pipe(
        Effect.provideService(PlannedAttemptExecutor, {
          ...unusedExecutor,
          observe: () =>
            Ref.update(initializationCalls, (count) => count + 1).pipe(
              Effect.as(
                PlannedAttemptExecutorProjection.cases.InitializationCorrelationContradiction.make({
                  correlation,
                  detail: "the C2 executor initialized a different process identity"
                })
              )
            )
        }),
        Effect.provide(plannedAttemptProtocolControllerLayer),
        Effect.provide(memoryJournalTestLayer)
      ),
      {
        _tag: "PlannedAttemptExecutorInitializationCorrelationContradiction",
        correlation,
        detail: "the C2 executor initialized a different process identity"
      }
    )
    expect(yield* Ref.get(initializationCalls)).toBe(1)

    const initialCausalityCalls = yield* Ref.make(0)
    yield* assertProtocolFailure(
      Effect.gen(function* () {
        yield* appendResponsibility()
        return yield* observePlannedAttemptExecutorState(plannedAttempt)
      }).pipe(
        Effect.provideService(PlannedAttemptExecutor, {
          ...unusedExecutor,
          observe: () =>
            Ref.update(initialCausalityCalls, (count) => count + 1).pipe(
              Effect.as(PlannedAttemptExecutorProjection.cases.Exact.make({ report: executing }))
            )
        }),
        Effect.provide(plannedAttemptProtocolControllerLayer),
        Effect.provide(memoryJournalTestLayer)
      ),
      { _tag: "PlannedAttemptExecutorInitialReportCausalityContradiction", observed: executing }
    )
    expect(yield* Ref.get(initialCausalityCalls)).toBe(1)

    const responsibilityMissingCalls = yield* Ref.make(0)
    yield* assertProtocolFailure(
      observePlannedAttemptExecutorState(plannedAttempt).pipe(
        Effect.provideService(PlannedAttemptExecutor, {
          ...unusedExecutor,
          observe: () =>
            Ref.update(responsibilityMissingCalls, (count) => count + 1).pipe(
              Effect.as(PlannedAttemptExecutorProjection.cases.Exact.make({ report: executing }))
            )
        }),
        Effect.provide(plannedAttemptProtocolControllerLayer),
        Effect.provide(memoryJournalTestLayer)
      ),
      { _tag: "PlannedAttemptExecutorResponsibilityMissing", correlation }
    )
    expect(yield* Ref.get(responsibilityMissingCalls)).toBe(0)

    const reconciliationRequiredCalls = yield* Ref.make(0)
    yield* assertProtocolFailure(
      Effect.gen(function* () {
        yield* appendResponsibility()
        yield* appendReport(executing)
        yield* appendUnsettledSuspend
        return yield* observePlannedAttemptExecutorState(plannedAttempt)
      }).pipe(
        Effect.provideService(PlannedAttemptExecutor, {
          ...unusedExecutor,
          observe: () =>
            Ref.update(reconciliationRequiredCalls, (count) => count + 1).pipe(
              Effect.as(PlannedAttemptExecutorProjection.cases.Exact.make({ report: executing }))
            )
        }),
        Effect.provide(plannedAttemptProtocolControllerLayer),
        Effect.provide(memoryJournalTestLayer)
      ),
      { _tag: "PlannedAttemptExecutorCommandReconciliationRequired", commandOrdinal: 1, correlation }
    )
    expect(yield* Ref.get(reconciliationRequiredCalls)).toBe(0)

    const stateCalls = yield* Ref.make(0)
    yield* assertProtocolFailure(
      Effect.gen(function* () {
        yield* appendResponsibility()
        yield* appendReport(executing)
        return yield* observePlannedAttemptExecutorState(plannedAttempt)
      }).pipe(
        Effect.provideService(PlannedAttemptExecutor, {
          ...unusedExecutor,
          observe: () =>
            Ref.update(stateCalls, (count) => count + 1).pipe(
              Effect.as(PlannedAttemptExecutorProjection.cases.NoReport.make({ correlation }))
            )
        }),
        Effect.provide(plannedAttemptProtocolControllerLayer),
        Effect.provide(memoryJournalTestLayer)
      ),
      { _tag: "PlannedAttemptExecutorStateNoCurrentReport", correlation }
    )
    expect(yield* Ref.get(stateCalls)).toBe(1)

    const directSuspendReports = yield* Ref.make<ReadonlyMap<string, PlannedAttemptExecutorReport>>(new Map())
    const directSuspendUnresolved = yield* Ref.make<ReadonlySet<string>>(new Set())
    expect(
      yield* Effect.gen(function* () {
        const executor = yield* PlannedAttemptExecutor
        return yield* executor.requestSuspension(plannedAttempt)
      }).pipe(
        Effect.provide(
          controlledExecutorLayer({
            cursor: directSuspendCursor,
            runId,
            beforeExecutorReport: () =>
              Ref.update(directSuspendCalls, (count) => count + 1).pipe(
                Effect.andThen(Effect.fail(directSuspendFailure as never))
              ),
            survivingReports: directSuspendReports,
            unresolvedLostResponses: directSuspendUnresolved
          })
        ),
        Effect.flip
      )
    ).toBe(directSuspendFailure)
    expect(yield* Ref.get(directSuspendCalls)).toBe(1)
    expect(yield* Ref.get(directSuspendReports)).toEqual(new Map())
    expect(yield* directSuspendCursor.storyPosition).toBe(0)
    expect((yield* directSuspendCursor.currentStoryItem)?._tag).toBe("PlannedAttemptExecutorWorkReported")

    for (const failure of Object.values(c2JournalReadFailureFixtures(runId))) {
      const cursor = yield* makeStoryCursor([safe, continued])
      const reserved = yield* cursor.consumeExecutorReportFor("Suspend", correlation.attemptId)
      if (!isSafelySuspendedExecutorReport(reserved)) return yield* Effect.die("C2 Safe was not reserved")
      const acceptedSafeReport = yield* Ref.make(Option.some(reserved))
      const reads = yield* Ref.make(0)

      expect(
        yield* settleAuthoredSafelySuspendedPublication({
          acceptedSafeReport,
          acceptedThrough,
          cursor,
          readJournal: () => Ref.update(reads, (count) => count + 1).pipe(Effect.andThen(Effect.fail(failure))),
          runId
        }).pipe(Effect.flip)
      ).toBe(failure)
      expect(yield* Ref.get(reads)).toBe(1)
      expect(yield* cursor.storyPosition).toBe(0)
      expect((yield* cursor.currentStoryItem)?._tag).toBe("PlannedAttemptExecutorWorkReported")
    }

    const mismatchedRecords = [
      [
        {
          ...record,
          event: PlannedAttemptExecutorWorkReportedEvent.make({
            ordinal,
            report: PlannedAttemptExecutorReport.cases.ExecutorWorkSafelySuspended.make({
              correlation: { ...correlation, runId: RunId.make("foreign-C2-run") }
            }),
            version: workflowJournalEventVersion
          })
        }
      ],
      [
        {
          ...record,
          event: PlannedAttemptExecutorWorkReportedEvent.make({
            ordinal: PlannedAttemptExecutorReportOrdinal.make(1),
            report: committed,
            version: workflowJournalEventVersion
          })
        }
      ],
      [{ ...record, position: JournalPosition.make(1) }],
      [record, { ...record, position: JournalPosition.make(1) }]
    ]
    for (const records of mismatchedRecords) {
      const cursor = yield* makeStoryCursor([safe, continued])
      const reserved = yield* cursor.consumeExecutorReportFor("Suspend", correlation.attemptId)
      if (!isSafelySuspendedExecutorReport(reserved)) return yield* Effect.die("C2 Safe was not reserved")
      const acceptedSafeReport = yield* Ref.make(Option.some(reserved))
      const failure = yield* settleAuthoredSafelySuspendedPublication({
        acceptedSafeReport,
        acceptedThrough,
        cursor,
        readJournal: () => Effect.succeed(records),
        runId
      }).pipe(Effect.flip)

      expect(failure).toMatchObject({
        _tag: "AuthoredCassetteInteractionMismatch",
        expected: "one accepted Safe report at ordinal 2 and the published position",
        storyPosition: 0
      })
      expect(yield* cursor.storyPosition).toBe(0)
    }

    const settledSafeOccurrences = yield* Ref.make(0)
    const cursor = yield* makeStoryCursor(
      [safe, AuthoredCassetteStoryItem.cases.CoordinatorProcessDies.make({}), continued],
      {
        onOccurrence: ({ item }) =>
          item._tag === "PlannedAttemptExecutorWorkReported"
            ? Ref.update(settledSafeOccurrences, (count) => count + 1)
            : Effect.void
      }
    )
    const reserved = yield* cursor.consumeExecutorReportFor("Suspend", correlation.attemptId)
    if (!isSafelySuspendedExecutorReport(reserved)) return yield* Effect.die("C2 Safe was not reserved")
    const processDeath = yield* cursor.pauseAtCoordinatorProcessDeath.pipe(Effect.exit)
    expect(Exit.isFailure(processDeath)).toBe(true)
    expect(yield* cursor.storyPosition).toBe(0)

    const reports = yield* Ref.make<ReadonlyMap<string, PlannedAttemptExecutorReport>>(
      new Map([[plannedAttemptExecutorCorrelationKey(correlation), committed]])
    )
    const reconciliationSuspendCalls = yield* Ref.make(0)
    expect(
      yield* observeThroughControlledExecutor(cursor, runId, correlation, reports, () =>
        Ref.update(reconciliationSuspendCalls, (count) => count + 1)
      )
    ).toEqual({ _tag: "Exact", report: committed })
    expect(yield* Ref.get(reconciliationSuspendCalls)).toBe(0)
    const acceptedSafeReport = yield* Ref.make(Option.some(reserved))
    const reads = yield* Ref.make(0)
    expect(
      yield* settleAuthoredSafelySuspendedPublication({
        acceptedSafeReport,
        acceptedThrough,
        cursor,
        readJournal: () => Ref.update(reads, (count) => count + 1).pipe(Effect.as([record])),
        runId
      })
    ).toBe(true)
    expect(yield* Ref.get(reads)).toBe(1)
    expect(yield* Ref.get(settledSafeOccurrences)).toBe(1)
    expect(yield* cursor.storyPosition).toBe(2)
    expect(yield* cursor.consumeAttemptChoice).toEqual(Option.some(continued))
    expect(yield* cursor.storyPosition).toBe(3)
    expect([record].filter(({ event }) => event.ordinal === 2)).toHaveLength(1)
    expect([record].filter(({ event }) => event.ordinal === 3)).toHaveLength(0)
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

    expect(yield* observeThroughControlledExecutor(cursor, runId, foreign, reports)).toMatchObject({
      _tag: "NoReport",
      correlation: foreign
    })
    expect(yield* cursor.storyPosition).toBe(1)
    expect(yield* observeThroughControlledExecutor(cursor, runId, b, reports)).toMatchObject({
      _tag: "Exact",
      report: { _tag: "ExecutorWorkSafelySuspended", correlation: b }
    })
    expect(yield* cursor.storyPosition).toBe(2)
  })
)

it.effect("observes an exact Safe reservation created while an executor projection waits for the cursor permit", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const precedingAttemptId = AttemptId.make("attempt:A:cursor-race")
      const safeAttemptId = AttemptId.make("attempt:C:cursor-race")
      const capacity = AuthoredCassetteStoryItem.cases.SetTaskExecutionCapacity.make({
        capacity: TaskWorkCapacity.make(2)
      })
      const precedingProjection = AuthoredCassetteStoryItem.cases.PlannedAttemptExecutorProjectionReturned.make({
        report: { _tag: "ExecutorWorkExecuting", attemptId: precedingAttemptId }
      })
      const safe = AuthoredCassetteStoryItem.cases.PlannedAttemptExecutorWorkReported.make({
        report: { _tag: "ExecutorWorkSafelySuspended", attemptId: safeAttemptId },
        request: "Suspend"
      })
      const transitionHeld = yield* Deferred.make<void>()
      const releaseTransition = yield* Deferred.make<void>()
      const cursor = yield* makeStoryCursor([capacity, precedingProjection, safe, terminal], {
        onOccurrence: ({ item }) =>
          item === capacity
            ? Deferred.succeed(transitionHeld, undefined).pipe(Effect.andThen(Deferred.await(releaseTransition)))
            : Effect.void
      })
      const reservedCapacity = yield* cursor.consumeCapacityChange
      if (Option.isNone(reservedCapacity)) return yield* Effect.die("the setup capacity was not reserved")
      const settlingCapacity = yield* cursor
        .settleCapacityChange(reservedCapacity.value)
        .pipe(Effect.forkChild({ startImmediately: true }))
      yield* Deferred.await(transitionHeld)

      const precedingAttempted = yield* Deferred.make<void>()
      const consumePrecedingProjection = yield* Deferred.succeed(precedingAttempted, undefined).pipe(
        Effect.andThen(cursor.consumeExecutorProjectionFor(precedingAttemptId)),
        Effect.forkChild({ startImmediately: true })
      )
      yield* Deferred.await(precedingAttempted)
      const safeReservationAttempted = yield* Deferred.make<void>()
      const reserveSafe = yield* Deferred.succeed(safeReservationAttempted, undefined).pipe(
        Effect.andThen(cursor.consumeExecutorReportFor("Suspend", safeAttemptId)),
        Effect.forkChild({ startImmediately: true })
      )
      yield* Deferred.await(safeReservationAttempted)
      const observationAttempted = yield* Deferred.make<void>()
      const observeSafe = yield* Deferred.succeed(observationAttempted, undefined).pipe(
        Effect.andThen(cursor.consumeExecutorProjectionOrReservedSafeFor(safeAttemptId)),
        Effect.forkChild({ startImmediately: true })
      )
      yield* Deferred.await(observationAttempted)

      yield* Deferred.succeed(releaseTransition, undefined)
      yield* Fiber.join(settlingCapacity)
      expect(Option.isSome(yield* Fiber.join(consumePrecedingProjection))).toBe(true)
      expect(yield* Fiber.join(reserveSafe)).toBe(safe)
      const claim = yield* Fiber.join(observeSafe)

      // Exclude the setup capacity occurrence: the old split read returned { claim: "None", position: 1 } here.
      expect({ claim: claim._tag, position: (yield* cursor.storyPosition) - 1 }).toEqual({
        claim: "ReservedSafe",
        position: 1
      })
    })
  )
)

it.effect("waits behind a nonmatching Safe reservation before returning no executor projection", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const precedingAttemptId = AttemptId.make("attempt:A:cursor-race-foreign")
      const safeAttemptId = AttemptId.make("attempt:C:cursor-race-foreign")
      const foreignAttemptId = AttemptId.make("attempt:D:cursor-race-foreign")
      const capacity = AuthoredCassetteStoryItem.cases.SetTaskExecutionCapacity.make({
        capacity: TaskWorkCapacity.make(2)
      })
      const precedingProjection = AuthoredCassetteStoryItem.cases.PlannedAttemptExecutorProjectionReturned.make({
        report: { _tag: "ExecutorWorkExecuting", attemptId: precedingAttemptId }
      })
      const safe = AuthoredCassetteStoryItem.cases.PlannedAttemptExecutorWorkReported.make({
        report: { _tag: "ExecutorWorkSafelySuspended", attemptId: safeAttemptId },
        request: "Suspend"
      })
      const transitionHeld = yield* Deferred.make<void>()
      const releaseTransition = yield* Deferred.make<void>()
      const cursor = yield* makeStoryCursor([capacity, precedingProjection, safe, terminal], {
        onOccurrence: ({ item }) =>
          item === capacity
            ? Deferred.succeed(transitionHeld, undefined).pipe(Effect.andThen(Deferred.await(releaseTransition)))
            : Effect.void
      })
      const reservedCapacity = yield* cursor.consumeCapacityChange
      if (Option.isNone(reservedCapacity)) return yield* Effect.die("the setup capacity was not reserved")
      const settlingCapacity = yield* cursor
        .settleCapacityChange(reservedCapacity.value)
        .pipe(Effect.forkChild({ startImmediately: true }))
      yield* Deferred.await(transitionHeld)

      const precedingAttempted = yield* Deferred.make<void>()
      const consumePrecedingProjection = yield* Deferred.succeed(precedingAttempted, undefined).pipe(
        Effect.andThen(cursor.consumeExecutorProjectionFor(precedingAttemptId)),
        Effect.forkChild({ startImmediately: true })
      )
      yield* Deferred.await(precedingAttempted)
      const safeReservationAttempted = yield* Deferred.make<void>()
      const reserveSafe = yield* Deferred.succeed(safeReservationAttempted, undefined).pipe(
        Effect.andThen(cursor.consumeExecutorReportFor("Suspend", safeAttemptId)),
        Effect.forkChild({ startImmediately: true })
      )
      yield* Deferred.await(safeReservationAttempted)
      const observationAttempted = yield* Deferred.make<void>()
      const observationFinished = yield* Deferred.make<void>()
      const observeForeign = yield* Deferred.succeed(observationAttempted, undefined).pipe(
        Effect.andThen(cursor.consumeExecutorProjectionOrReservedSafeFor(foreignAttemptId)),
        Effect.tap(() => Deferred.succeed(observationFinished, undefined)),
        Effect.forkChild({ startImmediately: true })
      )
      yield* Deferred.await(observationAttempted)

      yield* Deferred.succeed(releaseTransition, undefined)
      yield* Fiber.join(settlingCapacity)
      expect(Option.isSome(yield* Fiber.join(consumePrecedingProjection))).toBe(true)
      const reservedSafe = yield* Fiber.join(reserveSafe)
      if (!isSafelySuspendedExecutorReport(reservedSafe)) return yield* Effect.die("C2 Safe was not reserved")
      expect(yield* Deferred.isDone(observationFinished)).toBe(false)
      expect(yield* cursor.storyPosition).toBe(2)

      yield* Fiber.interrupt(observeForeign)
      const replacementAttempted = yield* Deferred.make<void>()
      const replacementFinished = yield* Deferred.make<void>()
      const observeAfterCancellation = yield* Deferred.succeed(replacementAttempted, undefined).pipe(
        Effect.andThen(cursor.consumeExecutorProjectionOrReservedSafeFor(foreignAttemptId)),
        Effect.tap(() => Deferred.succeed(replacementFinished, undefined)),
        Effect.forkChild({ startImmediately: true })
      )
      yield* Deferred.await(replacementAttempted)
      expect(yield* Deferred.isDone(replacementFinished)).toBe(false)

      yield* cursor.settleSafelySuspendedExecutorReport(reservedSafe)
      expect(yield* Fiber.join(observeAfterCancellation)).toEqual({ _tag: "None" })
      expect(yield* cursor.storyPosition).toBe(3)
    })
  )
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

it.effect("reconciles a committed Safe publication after process death without another Suspend or duplicate Safe", () =>
  Effect.gen(function* () {
    const safeIndex = runUnpauseAfterSafeSuspensionAuthoredCassette.story.findIndex(
      (item) =>
        item._tag === "PlannedAttemptExecutorWorkReported" &&
        item.request === "Suspend" &&
        item.report._tag === "ExecutorWorkSafelySuspended" &&
        item.report.attemptId === "attempt:A:0"
    )
    if (safeIndex < 0) {
      return yield* Effect.die("the maintained scenario does not contain its exact Safe publication cut")
    }
    const interruptedPublication = yield* Schema.decodeUnknownEffect(AuthoredScenarioCassette)({
      ...runUnpauseAfterSafeSuspensionAuthoredCassette,
      name: "committed Safe publication reconciles after process death",
      story: [
        ...runUnpauseAfterSafeSuspensionAuthoredCassette.story.slice(0, safeIndex + 1),
        AuthoredCassetteStoryItem.cases.CoordinatorProcessDies.make({}),
        ...runUnpauseAfterSafeSuspensionAuthoredCassette.story.slice(safeIndex + 1)
      ]
    })
    const run = yield* runAuthoredScenarioCassette(interruptedPublication)
    const attemptId = AttemptId.make("attempt:A:0")
    const suspends = run.records.filter(
      ({ event }) =>
        event._tag === "PlannedAttemptExecutorCommandIntended" &&
        event.command === "Suspend" &&
        event.plannedAttempt.attemptId === attemptId
    )
    const safeReports = run.records.flatMap(({ event, position }) =>
      event._tag === "PlannedAttemptExecutorWorkReported" && event.report.correlation.attemptId === attemptId
        ? [{ ordinal: event.ordinal, position, report: event.report._tag }]
        : []
    )

    expect(suspends).toHaveLength(1)
    expect(safeReports.slice(0, 2)).toEqual([
      expect.objectContaining({ ordinal: 1, report: "ExecutorWorkExecuting" }),
      expect.objectContaining({ ordinal: 2, report: "ExecutorWorkSafelySuspended" })
    ])
    expect(
      safeReports.filter(({ report }) => report === "ExecutorWorkSafelySuspended").map(({ ordinal }) => ordinal)
    ).toEqual([2])
    expect(run.activationOrdinals).toEqual([1, 2])
  }).pipe(Effect.provide(NodeCrypto.layer))
)

it.effect("surfaces a reactivation-owner interaction defect before terminal assertions", () =>
  Effect.gen(function* () {
    const processDeathIndex = activeWorkF2SafelySuspendsAuthoredCassette.story.findIndex(
      ({ _tag }) => _tag === "CoordinatorProcessDies"
    )
    const ownerSelectionIndex = activeWorkF2SafelySuspendsAuthoredCassette.story.findIndex(
      (item, index) => index > processDeathIndex && item._tag === "DalphSelects"
    )
    expect(processDeathIndex).toBeGreaterThanOrEqual(0)
    expect(ownerSelectionIndex).toBeGreaterThan(processDeathIndex)
    const malformedOwnerInteraction = yield* Schema.decodeUnknownEffect(AuthoredScenarioCassette)({
      ...activeWorkF2SafelySuspendsAuthoredCassette,
      name: "reactivation owner surfaces an exact interaction defect",
      story: activeWorkF2SafelySuspendsAuthoredCassette.story.map((item, index) =>
        index === ownerSelectionIndex
          ? { _tag: "DalphSelects", operation: { _tag: "ReadTaskClaim", taskId: "A" } }
          : item
      )
    })

    const exit = yield* runAuthoredScenarioCassette(malformedOwnerInteraction).pipe(Effect.exit)
    expect(Exit.isFailure(exit)).toBe(true)
    if (Exit.isFailure(exit)) {
      expect(exit.cause.reasons.every(Cause.isDieReason)).toBe(true)
      const defects = exit.cause.reasons.flatMap((reason) => (Cause.isDieReason(reason) ? [reason.defect] : []))
      expect(defects).toHaveLength(1)
      expect(defects[0]).toBeInstanceOf(TraceOutputError)
    }
  }).pipe(Effect.provide(NodeCrypto.layer))
)
