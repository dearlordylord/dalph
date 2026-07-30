import { it } from "@effect/vitest"
import { defineDriver, ITFBigInt, stateCheck } from "@firfi/quint-connect/effect"
import { quintIt } from "@firfi/quint-connect/vitest"
import {
  AttemptId,
  GitCommitSha,
  PlannedAttemptExecutor,
  plannedAttemptExecutorCorrelation,
  PlannedAttemptExecutorReport,
  PlannedTaskAttempt,
  RunId,
  TaskBranchRef,
  TaskExecutorLocator,
  TaskId,
  TaskRevision,
  WorktreeLocator
} from "@dalph/contracts"
import {
  continuePlannedAttemptExecutorWork,
  type JournalRecord,
  JournalStore,
  JournalPosition,
  makeTaskAdmissionController,
  requestPlannedAttemptExecutorSuspension,
  RunnableFrontierTransition,
  type TaskAdmissionController,
  TaskWorkCapacity
} from "@dalph/orchestrator"
import { Deferred, Effect, Fiber, Layer, Option, Schema } from "effect"

const plannedAttempt = PlannedTaskAttempt.make({
  attemptId: AttemptId.make("1"),
  baseSha: GitCommitSha.make("1".repeat(40)),
  branch: TaskBranchRef.make("refs/heads/dalph/model-attempt"),
  executor: TaskExecutorLocator.make("executor:model"),
  runId: RunId.make("158"),
  taskId: TaskId.make("model-task"),
  taskRevision: TaskRevision.make("model-revision"),
  worktree: WorktreeLocator.make("/worktrees/model-attempt")
})
const correlation = plannedAttemptExecutorCorrelation(plannedAttempt)
const continuation = RunnableFrontierTransition.ContinuePlannedAttemptExecutorWork({ plannedAttempt })

const SpecProjection = Schema.Struct({
  state: Schema.Struct({
    correlationAttemptId: ITFBigInt,
    correlationRunId: ITFBigInt,
    positionHeld: Schema.Boolean,
    status: Schema.Unknown
  })
})

const variantTag = (value: unknown): string =>
  typeof value === "object" && value !== null && "tag" in value ? String(value.tag) : String(value)

const executorConformanceDriver = defineDriver(
  {
    beginResponsibility: {},
    finishTerminal: {},
    init: {},
    reportSafelySuspended: {},
    requestSafeSuspension: {},
    startOrContinueRunning: {}
  },
  () => {
    let latestReport: PlannedAttemptExecutorReport | undefined
    let nextStartReport: PlannedAttemptExecutorReport = PlannedAttemptExecutorReport.cases.Running.make({ correlation })
    let pendingSuspension: Fiber.Fiber<PlannedAttemptExecutorReport> | undefined
    let pendingStart: Fiber.Fiber<PlannedAttemptExecutorReport> | undefined
    let controller: TaskAdmissionController | undefined
    let records: ReadonlyArray<JournalRecord> = []
    let status = "NoReport"
    let responsibilityRecorded = Deferred.makeUnsafe<void>()
    let startResponse: Deferred.Deferred<PlannedAttemptExecutorReport> | undefined
    let suspensionResponse = Deferred.makeUnsafe<PlannedAttemptExecutorReport>()
    const executor = PlannedAttemptExecutor.of({
      project: () => Effect.succeed(Option.fromUndefinedOr(latestReport)),
      requestSuspension: () =>
        Deferred.await(suspensionResponse).pipe(
          Effect.tap((report) =>
            Effect.sync(() => {
              latestReport = report
            })
          )
        ),
      startOrContinue: () => {
        const response = startResponse
        return response === undefined
          ? Effect.sync(() => {
              latestReport = nextStartReport
              return nextStartReport
            })
          : Deferred.await(response).pipe(
              Effect.tap((report) =>
                Effect.sync(() => {
                  latestReport = report
                })
              )
            )
      }
    })
    const journal = JournalStore.of({
      append: (eventRunId, key, event) =>
        Effect.gen(function* () {
          const record = {
            event,
            key,
            position: JournalPosition.make(records.filter(({ runId }) => runId === eventRunId).length + 1),
            runId: eventRunId
          } satisfies JournalRecord
          records = [...records, record]
          if (event._tag === "PlannedAttemptExecutorWorkResponsibilityBegan") {
            yield* Deferred.succeed(responsibilityRecorded, undefined)
          }
          return record
        }),
      beginRun: () => Effect.die("executor conformance never begins a Run"),
      read: (requestedRunId) => Effect.succeed(records.filter(({ runId }) => runId === requestedRunId)),
      readRunForRecovery: () => Effect.die("executor conformance never recovers a Run"),
      scan: () => Effect.die("executor conformance never scans the journal"),
      terminateRun: () => Effect.die("executor conformance never terminates a Run")
    })
    const workflowLayer = Layer.merge(
      Layer.succeed(JournalStore, journal),
      Layer.succeed(PlannedAttemptExecutor, executor)
    )
    const continueExecutorWorkflow = () =>
      continuePlannedAttemptExecutorWork(plannedAttempt).pipe(Effect.provide(workflowLayer), Effect.orDie)
    const suspendExecutorWorkflow = () =>
      requestPlannedAttemptExecutorSuspension(plannedAttempt).pipe(Effect.provide(workflowLayer), Effect.orDie)
    const requireController = (): Effect.Effect<TaskAdmissionController> =>
      controller === undefined ? Effect.die("admission controller must be initialized") : Effect.succeed(controller)
    const releasePositionIfHeld = Effect.fn("PlannedAttemptExecutorConformance.releasePositionIfHeld")(function* () {
      const admission = yield* requireController()
      const snapshot = yield* admission.snapshot()
      if (
        snapshot.reservedPositions.some(
          ({ correlation: reserved }) =>
            reserved._tag === "PlannedAttemptReservation" &&
            reserved.attemptId === correlation.attemptId &&
            reserved.runId === correlation.runId
        )
      ) {
        yield* admission.releasePlannedAttemptPosition(correlation)
      }
    })
    const reservePositionIfAvailable = Effect.fn("PlannedAttemptExecutorConformance.reservePositionIfAvailable")(
      function* () {
        const admission = yield* requireController()
        const decision = yield* admission.admit({ explanations: [], transitions: [continuation] }, plannedAttempt.runId)
        if (Option.isNone(decision.transition)) {
          return yield* Effect.die("planned attempt must be admitted")
        }
      }
    )
    const completePendingSuspension = (report: PlannedAttemptExecutorReport) =>
      Effect.gen(function* () {
        yield* Deferred.succeed(suspensionResponse, report)
        if (pendingSuspension === undefined) {
          return yield* Effect.die("suspension request must be pending")
        }
        const observed = yield* Fiber.join(pendingSuspension)
        pendingSuspension = undefined
        status = observed._tag
        if (observed._tag === "SafelySuspended" || observed._tag === "Terminal") {
          yield* releasePositionIfHeld()
        }
      })
    const completePendingStart = (report: PlannedAttemptExecutorReport) =>
      Effect.gen(function* () {
        const start = pendingStart
        const response = startResponse
        if (start === undefined || response === undefined) {
          return yield* Effect.die("executor start must be pending after responsibility begins")
        }
        yield* Deferred.succeed(response, report)
        const result = yield* Fiber.join(start)
        pendingStart = undefined
        startResponse = undefined
        return result
      })
    const invokeStart = (report: PlannedAttemptExecutorReport) =>
      Effect.gen(function* () {
        const admission = yield* requireController()
        const snapshot = yield* admission.snapshot()
        if (
          !snapshot.reservedPositions.some(
            ({ correlation: reserved }) =>
              reserved._tag === "PlannedAttemptReservation" &&
              reserved.attemptId === correlation.attemptId &&
              reserved.runId === correlation.runId
          )
        ) {
          yield* reservePositionIfAvailable()
        }
        const observed =
          pendingStart === undefined
            ? yield* Effect.suspend(() => {
                nextStartReport = report
                return continueExecutorWorkflow()
              })
            : yield* completePendingStart(report)
        status = observed._tag
        if (observed._tag === "Terminal") {
          yield* releasePositionIfHeld()
        }
      })
    return {
      beginResponsibility: () =>
        Effect.gen(function* () {
          yield* reservePositionIfAvailable()
          responsibilityRecorded = Deferred.makeUnsafe()
          startResponse = Deferred.makeUnsafe()
          pendingStart = yield* continueExecutorWorkflow().pipe(Effect.forkDetach({ startImmediately: true }))
          yield* Deferred.await(responsibilityRecorded)
          status = "ResponsibilityBegan"
        }),
      finishTerminal: () =>
        pendingSuspension === undefined
          ? invokeStart(
              PlannedAttemptExecutorReport.cases.Terminal.make({ correlation, result: { _tag: "Completed" } })
            )
          : completePendingSuspension(
              PlannedAttemptExecutorReport.cases.Terminal.make({ correlation, result: { _tag: "Completed" } })
            ),
      getState: () =>
        Effect.gen(function* () {
          const snapshot = yield* (yield* requireController()).snapshot()
          return {
            correlationAttemptId: 1n,
            correlationRunId: 158n,
            positionHeld: snapshot.reservedPositions.some(
              ({ correlation: reserved }) =>
                reserved._tag === "PlannedAttemptReservation" &&
                reserved.attemptId === correlation.attemptId &&
                reserved.runId === correlation.runId
            ),
            status
          }
        }),
      init: () =>
        Effect.gen(function* () {
          if (pendingSuspension !== undefined) {
            yield* Fiber.interrupt(pendingSuspension)
          }
          if (pendingStart !== undefined) {
            yield* Fiber.interrupt(pendingStart)
          }
          controller = yield* makeTaskAdmissionController({ capacity: TaskWorkCapacity.make(1) })
          latestReport = undefined
          pendingSuspension = undefined
          pendingStart = undefined
          records = []
          status = "NoReport"
          responsibilityRecorded = Deferred.makeUnsafe()
          startResponse = undefined
          suspensionResponse = Deferred.makeUnsafe()
        }),
      requestSafeSuspension: () =>
        Effect.gen(function* () {
          suspensionResponse = Deferred.makeUnsafe()
          pendingSuspension = yield* suspendExecutorWorkflow().pipe(Effect.forkDetach({ startImmediately: true }))
          status = "SuspensionRequested"
        }),
      reportSafelySuspended: () =>
        completePendingSuspension(PlannedAttemptExecutorReport.cases.SafelySuspended.make({ correlation })),
      startOrContinueRunning: () => invokeStart(PlannedAttemptExecutorReport.cases.Running.make({ correlation }))
    }
  }
)

quintIt(
  it.effect,
  "replays the planned-attempt model through the executor boundary",
  {
    backend: "typescript",
    driverFactory: executorConformanceDriver,
    maxSteps: 20,
    nTraces: 50,
    seed: "158",
    spec: "specs/plannedAttemptExecutor.qnt",
    stateCheck: stateCheck(
      (raw) =>
        Schema.decodeUnknownEffect(SpecProjection)(raw).pipe(
          Effect.map(({ state }) => ({ ...state, status: variantTag(state.status) })),
          Effect.orDie
        ),
      (spec, implementation) =>
        spec.positionHeld === implementation.positionHeld &&
        spec.correlationAttemptId === implementation.correlationAttemptId &&
        spec.correlationRunId === implementation.correlationRunId &&
        spec.status === implementation.status
    )
  },
  30_000
)
