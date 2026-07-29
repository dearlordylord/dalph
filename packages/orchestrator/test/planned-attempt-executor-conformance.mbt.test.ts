import { it } from "@effect/vitest"
import { defineDriver, ITFBigInt, stateCheck } from "@firfi/quint-connect/effect"
import { quintIt } from "@firfi/quint-connect/vitest"
import { Effect, Schema } from "effect"
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
} from "../src/domain.js"
import {
  ControlledFakeExecutorStep,
  makeControlledFakePlannedAttemptExecutorLayer,
  PlannedAttemptExecutor,
  plannedAttemptExecutorCorrelation,
  PlannedAttemptExecutorReport
} from "../src/planned-attempt-executor.js"

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

const SpecProjection = Schema.Struct({
  state: Schema.Struct({
    positionHeld: Schema.Boolean,
    report: Schema.Unknown,
    reportAttemptId: ITFBigInt,
    reportRunId: ITFBigInt
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
    requestSafeSuspension: {},
    startOrContinueRunning: {}
  },
  () => {
    let positionHeld = false
    let report = "NoReport"
    const invoke = (
      nextReport: typeof PlannedAttemptExecutorReport.Type,
      operation: "StartOrContinue" | "StopForResume"
    ) =>
      Effect.gen(function*() {
        const executor = yield* PlannedAttemptExecutor
        const observed = operation === "StartOrContinue"
          ? yield* executor.startOrContinue(plannedAttempt)
          : yield* executor.requestSuspension(plannedAttempt)
        report = observed._tag
        positionHeld = observed._tag === "Running"
      }).pipe(
        Effect.provide(
          makeControlledFakePlannedAttemptExecutorLayer([
            operation === "StartOrContinue"
              ? ControlledFakeExecutorStep.cases.StartOrContinue.make({
                correlation,
                report: nextReport
              })
              : ControlledFakeExecutorStep.cases.Suspend.make({
                correlation,
                report: nextReport
              })
          ])
        ),
        Effect.orDie
      )
    return {
      finishTerminal: () =>
        invoke(
          PlannedAttemptExecutorReport.cases.Terminal.make({
            correlation,
            result: { _tag: "Completed" }
          }),
          "StartOrContinue"
        ),
      getState: () =>
        Effect.succeed({
          positionHeld,
          report,
          reportAttemptId: 1n,
          reportRunId: 158n
        }),
      init: () =>
        Effect.sync(() => {
          positionHeld = false
          report = "NoReport"
        }),
      requestSafeSuspension: () =>
        invoke(
          PlannedAttemptExecutorReport.cases.SafelySuspended.make({
            correlation
          }),
          "StopForResume"
        ),
      startOrContinueRunning: () =>
        invoke(
          PlannedAttemptExecutorReport.cases.Running.make({
            correlation
          }),
          "StartOrContinue"
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
          report: variantTag(state.report)
        })),
        Effect.orDie
      ),
    (spec, implementation) =>
      spec.positionHeld === implementation.positionHeld
      && spec.report === implementation.report
      && spec.reportAttemptId === implementation.reportAttemptId
      && spec.reportRunId === implementation.reportRunId
  )
}, 30_000)
