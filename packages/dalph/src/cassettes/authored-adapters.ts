import { Effect, Layer, Option, Ref, Schema } from "effect"
import {
  ControlledFakeExecutorMismatch,
  PlannedAttemptExecutor,
  PlannedAttemptExecutorReport,
  plannedAttemptExecutorCorrelation,
  plannedAttemptExecutorCorrelationKey,
  type PlannedTaskAttempt,
  type RunId
} from "@dalph/contracts"
import {
  makeTaskWorkSpecification,
  projectTrackerSnapshot,
  TraceOutputError,
  TrackerAdapterReadContext,
  TrackerAdapterReadError,
  TrackerAdapterReadFailureReason,
  TrackerGraphReader,
  type TraceItem,
  WorkflowTrace
} from "@dalph/orchestrator"
import {
  AuthoredCassetteDecision,
  type AuthoredCassetteDecision as CassetteDecision,
  type AuthoredCassetteStoryItem
} from "./authored-domain.js"
import type { StoryCursor } from "./authored-cursor.js"

const trackerReadFailure = (detail: string) =>
  new TrackerAdapterReadError({
    context: TrackerAdapterReadContext.cases.Fixture.make({ operation: "TrackerGraphReader.selectAdapter" }),
    detail,
    reason: TrackerAdapterReadFailureReason.cases.IncompleteSnapshot.make({})
  })

export const controlledTrackerGraphReaderLayer = (cursor: StoryCursor) =>
  Layer.succeed(
    TrackerGraphReader,
    TrackerGraphReader.of({
      read: Effect.fn("AuthoredCassette.TrackerGraphReader.read")(function* () {
        const item = yield* cursor.consumeTrackerGraph.pipe(
          Effect.mapError((failure) => trackerReadFailure(`${failure._tag} at story position ${failure.storyPosition}`))
        )
        const projection = projectTrackerSnapshot(item.graph)
        return projection._tag === "Valid"
          ? projection.snapshot
          : yield* trackerReadFailure(
              `authored cassette tracker graph is invalid: ${projection.issues.map(({ _tag }) => _tag).join(", ")}`
            )
      }),
      readTaskWorkSpecification: Effect.fn("AuthoredCassette.TrackerGraphReader.readTaskWorkSpecification")(
        function* (_target, taskId) {
          const item = yield* cursor.consumeTaskWorkSpecification.pipe(
            Effect.mapError((failure) =>
              trackerReadFailure(`${failure._tag} at story position ${failure.storyPosition}`)
            )
          )
          if (item.taskId !== taskId) {
            return yield* trackerReadFailure(
              `authored cassette returned task-work specification ${item.taskId} for ${taskId}`
            )
          }
          return makeTaskWorkSpecification(item)
        }
      )
    })
  )

const actualDecision = (item: TraceItem): CassetteDecision | undefined => {
  if (item._tag !== "OperationSelected") return undefined
  switch (item.operation._tag) {
    case "AcquireTaskClaim":
      return AuthoredCassetteDecision.cases.AcquireTaskClaim.make({ taskId: item.operation.acquisition.taskId })
    case "ReadTaskWorkSpecification":
      return AuthoredCassetteDecision.cases.ReadTaskWorkSpecification.make({ taskId: item.operation.taskId })
    case "ReadTrackerGraph":
      return AuthoredCassetteDecision.cases.ReadTrackerGraph.make({ target: item.operation.target })
    case "ReconcileTaskWorktree":
      return AuthoredCassetteDecision.cases.ReconcileTaskWorktree.make({
        attemptId: item.operation.plannedAttempt.attemptId,
        taskId: item.operation.plannedAttempt.taskId
      })
    case "RecordTaskAttemptPlan":
      return AuthoredCassetteDecision.cases.RecordTaskAttemptPlan.make({
        attemptId: item.operation.plannedAttempt.attemptId,
        taskId: item.operation.plannedAttempt.taskId
      })
  }
}

const encodedDecision = (decision: CassetteDecision): string =>
  JSON.stringify(Schema.encodeUnknownSync(AuthoredCassetteDecision)(decision))

export const controlledTrace = (cursor: StoryCursor): WorkflowTrace["Service"] =>
  WorkflowTrace.of({
    emit: Effect.fn("AuthoredCassette.WorkflowTrace.emit")(function* (item) {
      const actual = actualDecision(item)
      if (actual === undefined) return
      const expected = yield* cursor.consumeDalphSelection.pipe(
        Effect.mapError(
          (failure) => new TraceOutputError({ detail: `${failure._tag} at story position ${failure.storyPosition}` })
        )
      )
      if (encodedDecision(actual) !== encodedDecision(expected.operation)) {
        return yield* new TraceOutputError({
          detail: `expected ${encodedDecision(expected.operation)}, received ${encodedDecision(actual)}`
        })
      }
    })
  })

const executorReport = (
  item: Extract<AuthoredCassetteStoryItem, { readonly _tag: "PlannedAttemptExecutorWorkReported" }>,
  runId: RunId
): PlannedAttemptExecutorReport => {
  const correlation = { attemptId: item.report.attemptId, runId }
  switch (item.report._tag) {
    case "Running":
      return PlannedAttemptExecutorReport.cases.Running.make({ correlation })
    case "SafelySuspended":
      return PlannedAttemptExecutorReport.cases.SafelySuspended.make({ correlation })
    case "Terminal":
      return PlannedAttemptExecutorReport.cases.Terminal.make({ correlation, result: item.report.result })
  }
}

export const controlledExecutorLayer = (cursor: StoryCursor, runId: RunId) =>
  Layer.effect(
    PlannedAttemptExecutor,
    Effect.gen(function* () {
      const reports = yield* Ref.make<ReadonlyMap<string, PlannedAttemptExecutorReport>>(new Map())
      const consume = Effect.fn("AuthoredCassette.PlannedAttemptExecutor.consume")(function* (
        request: "StartOrContinue" | "Suspend",
        plannedAttempt: PlannedTaskAttempt
      ) {
        const item = yield* cursor.consumeExecutorReport.pipe(
          Effect.mapError(
            (failure) =>
              new ControlledFakeExecutorMismatch({
                detail: `${failure._tag} at story position ${failure.storyPosition}`
              })
          )
        )
        const correlation = plannedAttemptExecutorCorrelation(plannedAttempt)
        if (item.request !== request || item.report.attemptId !== correlation.attemptId) {
          return yield* new ControlledFakeExecutorMismatch({
            detail: `authored executor expected ${item.request} for ${item.report.attemptId}, received ${request} for ${correlation.attemptId}`
          })
        }
        const report = executorReport(item, runId)
        yield* Ref.update(
          reports,
          (current) => new Map([...current, [plannedAttemptExecutorCorrelationKey(correlation), report]])
        )
        return report
      })
      return PlannedAttemptExecutor.of({
        /* v8 ignore next -- The maintained singleton does not reconstruct an independently surviving executor report. */
        project: (correlation) =>
          Ref.get(reports).pipe(
            Effect.map((current) =>
              Option.fromUndefinedOr(current.get(plannedAttemptExecutorCorrelationKey(correlation)))
            )
          ),
        /* v8 ignore next -- Live Pause/Suspend production behavior is outside issue 170's maintained singleton. */
        requestSuspension: (plannedAttempt) => consume("Suspend", plannedAttempt),
        startOrContinue: (plannedAttempt) => consume("StartOrContinue", plannedAttempt)
      })
    })
  )
