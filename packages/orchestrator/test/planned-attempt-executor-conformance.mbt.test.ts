import { it } from "@effect/vitest"
import { defineDriver, ITFBigInt, stateCheck } from "@firfi/quint-connect/effect"
import { quintIt } from "@firfi/quint-connect/vitest"
import { Deferred, Effect, Fiber, Option, Schema } from "effect"
import {
  AttemptId,
  GitCommitSha,
  PlannedTaskAttempt,
  RunId,
  TaskBranchRef,
  TaskExecutorLocator,
  TaskId,
  TaskRevision,
  TaskWorkCapacity,
  WorktreeLocator
} from "../src/domain.js"
import {
  PlannedAttemptExecutor,
  plannedAttemptExecutorCorrelation,
  PlannedAttemptExecutorReport
} from "../src/planned-attempt-executor.js"
import { RunnableFrontierTransition } from "../src/runnable-frontier.js"
import { makeTaskAdmissionController, type TaskAdmissionController } from "../src/task-admission-controller.js"

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
const continuation = RunnableFrontierTransition.ContinuePlannedAttemptExecutorWork({
  plannedAttempt
})

const SpecProjection = Schema.Struct({
  state: Schema.Struct({
    correlationAttemptId: ITFBigInt,
    correlationRunId: ITFBigInt,
    positionHeld: Schema.Boolean,
    status: Schema.Unknown
  })
})

const variantTag = (value: unknown): string =>
  typeof value === "object" && value !== null && "tag" in value
    ? String(value.tag)
    : String(value)

const executorConformanceDriver = defineDriver(
  {
    finishTerminal: {},
    init: {},
    reportSafelySuspended: {},
    requestSafeSuspension: {},
    startOrContinueRunning: {}
  },
  () => {
    let latestReport: typeof PlannedAttemptExecutorReport.Type | undefined
    let nextStartReport: typeof PlannedAttemptExecutorReport.Type = PlannedAttemptExecutorReport.cases.Running.make({
      correlation
    })
    let pendingSuspension:
      | Fiber.Fiber<typeof PlannedAttemptExecutorReport.Type>
      | undefined
    let controller: TaskAdmissionController | undefined
    let status = "NoReport"
    let suspensionResponse = Deferred.makeUnsafe<
      typeof PlannedAttemptExecutorReport.Type
    >()
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
      startOrContinue: () =>
        Effect.sync(() => {
          latestReport = nextStartReport
          return nextStartReport
        })
    })
    const requireController = (): Effect.Effect<
      TaskAdmissionController
    > =>
      controller === undefined
        ? Effect.die("admission controller must be initialized")
        : Effect.succeed(controller)
    const releasePositionIfHeld = Effect.fn(
      "PlannedAttemptExecutorConformance.releasePositionIfHeld"
    )(function*() {
      const admission = yield* requireController()
      const snapshot = yield* admission.snapshot()
      if (
        snapshot.reservedPositions.some(({ correlation: reserved }) =>
          reserved._tag === "PlannedAttemptReservation"
          && reserved.attemptId === correlation.attemptId
          && reserved.runId === correlation.runId
        )
      ) {
        yield* admission.releasePlannedAttemptPosition(correlation)
      }
    })
    const completePendingSuspension = (
      report: typeof PlannedAttemptExecutorReport.Type
    ) =>
      Effect.gen(function*() {
        yield* Deferred.succeed(suspensionResponse, report)
        if (pendingSuspension === undefined) {
          return yield* Effect.die("suspension request must be pending")
        }
        const observed = yield* Fiber.join(pendingSuspension)
        pendingSuspension = undefined
        status = observed._tag
        if (
          observed._tag === "SafelySuspended"
          || observed._tag === "Terminal"
        ) {
          yield* releasePositionIfHeld()
        }
      })
    const invokeStart = (
      report: typeof PlannedAttemptExecutorReport.Type
    ) =>
      Effect.gen(function*() {
        const admission = yield* requireController()
        const decision = yield* admission.admit({
          explanations: [],
          transitions: [continuation]
        }, plannedAttempt.runId)
        if (Option.isNone(decision.transition)) {
          return yield* Effect.die("planned attempt must be admitted")
        }
        nextStartReport = report
        const observed = yield* executor.startOrContinue(plannedAttempt)
        status = observed._tag
        if (observed._tag === "Terminal") {
          yield* releasePositionIfHeld()
        }
      })
    return {
      finishTerminal: () =>
        pendingSuspension === undefined
          ? invokeStart(
            PlannedAttemptExecutorReport.cases.Terminal.make({
              correlation,
              result: { _tag: "Completed" }
            })
          )
          : completePendingSuspension(
            PlannedAttemptExecutorReport.cases.Terminal.make({
              correlation,
              result: { _tag: "Completed" }
            })
          ),
      getState: () =>
        Effect.gen(function*() {
          const snapshot = yield* (yield* requireController()).snapshot()
          return {
            correlationAttemptId: 1n,
            correlationRunId: 158n,
            positionHeld: snapshot.reservedPositions.some(
              ({ correlation: reserved }) =>
                reserved._tag === "PlannedAttemptReservation"
                && reserved.attemptId === correlation.attemptId
                && reserved.runId === correlation.runId
            ),
            status
          }
        }),
      init: () =>
        Effect.gen(function*() {
          if (pendingSuspension !== undefined) {
            yield* Fiber.interrupt(pendingSuspension)
          }
          controller = yield* makeTaskAdmissionController({
            capacity: TaskWorkCapacity.make(1)
          })
          latestReport = undefined
          pendingSuspension = undefined
          status = "NoReport"
          suspensionResponse = Deferred.makeUnsafe()
        }),
      requestSafeSuspension: () =>
        Effect.gen(function*() {
          suspensionResponse = Deferred.makeUnsafe()
          pendingSuspension = yield* executor.requestSuspension(
            plannedAttempt
          ).pipe(
            Effect.orDie,
            Effect.forkDetach({ startImmediately: true })
          )
          status = "SuspensionRequested"
        }),
      reportSafelySuspended: () =>
        completePendingSuspension(
          PlannedAttemptExecutorReport.cases.SafelySuspended.make({
            correlation
          })
        ),
      startOrContinueRunning: () =>
        invokeStart(
          PlannedAttemptExecutorReport.cases.Running.make({
            correlation
          })
        )
    }
  }
)

quintIt(it.effect, "replays the planned-attempt model through the executor boundary", {
  backend: "typescript",
  driverFactory: executorConformanceDriver,
  maxSteps: 20,
  nTraces: 50,
  seed: "158",
  spec: "specs/plannedAttemptExecutor.qnt",
  stateCheck: stateCheck(
    (raw) =>
      Schema.decodeUnknownEffect(SpecProjection)(raw).pipe(
        Effect.map(({ state }) => ({
          ...state,
          status: variantTag(state.status)
        })),
        Effect.orDie
      ),
    (spec, implementation) =>
      spec.positionHeld === implementation.positionHeld
      && spec.correlationAttemptId === implementation.correlationAttemptId
      && spec.correlationRunId === implementation.correlationRunId
      && spec.status === implementation.status
  )
}, 30_000)
