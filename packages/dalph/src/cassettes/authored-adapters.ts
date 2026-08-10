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
  type WorkflowOperation,
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
        if (item._tag === "TrackerGraphReadFailed") {
          return yield* trackerReadFailure(`authored cassette tracker graph read failed: ${item.reason}`)
        }
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

type ReadOperation = Extract<
  WorkflowOperation,
  {
    readonly _tag:
      | "ReadTaskClaim"
      | "ReadTargetLineage"
      | "ReadTaskWorkSpecification"
      | "ReadTaskWorktree"
      | "ReadTrackerGraph"
  }
>

const isReadOperation = (operation: WorkflowOperation): operation is ReadOperation =>
  operation._tag === "ReadTaskClaim" ||
  operation._tag === "ReadTargetLineage" ||
  operation._tag === "ReadTaskWorkSpecification" ||
  operation._tag === "ReadTaskWorktree" ||
  operation._tag === "ReadTrackerGraph"

const actualReadDecision = (operation: ReadOperation): CassetteDecision => {
  switch (operation._tag) {
    case "ReadTaskClaim":
      return AuthoredCassetteDecision.cases.ReadTaskClaim.make({ taskId: operation.taskId })
    case "ReadTargetLineage":
      return AuthoredCassetteDecision.cases.ReadTargetLineage.make({
        attemptId: operation.plannedAttempt.attemptId,
        taskId: operation.plannedAttempt.taskId
      })
    case "ReadTaskWorkSpecification":
      return AuthoredCassetteDecision.cases.ReadTaskWorkSpecification.make({ taskId: operation.taskId })
    case "ReadTaskWorktree":
      return AuthoredCassetteDecision.cases.ReadTaskWorktree.make({
        attemptId: operation.plannedAttempt.attemptId,
        taskId: operation.plannedAttempt.taskId
      })
    case "ReadTrackerGraph":
      return AuthoredCassetteDecision.cases.ReadTrackerGraph.make({ target: operation.target })
  }
}

const actualDecision = (item: TraceItem): CassetteDecision | undefined => {
  if (item._tag !== "OperationSelected") return undefined
  if (isReadOperation(item.operation)) return actualReadDecision(item.operation)
  switch (item.operation._tag) {
    case "AcquireTaskClaim":
      return AuthoredCassetteDecision.cases.AcquireTaskClaim.make({ taskId: item.operation.acquisition.taskId })
    case "ReleaseTaskClaim":
      return AuthoredCassetteDecision.cases.ReleaseTaskClaim.make({ taskId: item.operation.release.claim.taskId })
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
      // Stabilization performs its final tracker read outside the delivery
      // action executor. Its operation-selection trace is the remaining
      // same-fiber action boundary for a lifecycle control.
      if (item._tag === "OperationSelected") yield* cursor.pauseAtCoordinatorProcessDeath
      const actual = actualDecision(item)
      if (actual === undefined) return
      const expected = yield* cursor.consumeDalphSelection.pipe(
        Effect.mapError(
          (failure) =>
            new TraceOutputError({
              detail:
                `${failure._tag} at story position ${failure.storyPosition}: ` +
                `expected ${failure.expected}, received ${failure.actual} while emitting ${encodedDecision(actual)}`
            })
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
  item: Extract<
    AuthoredCassetteStoryItem,
    {
      readonly _tag:
        | "PlannedAttemptExecutorProjectionReturned"
        | "PlannedAttemptExecutorResponseLost"
        | "PlannedAttemptExecutorWorkReported"
    }
  >,
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

export const controlledExecutorLayer = (
  cursor: StoryCursor,
  runId: RunId,
  beforeExecutorReport: Effect.Effect<void> = Effect.void,
  survivingReports: Ref.Ref<ReadonlyMap<string, PlannedAttemptExecutorReport>>,
  unresolvedLostResponses: Ref.Ref<ReadonlySet<string>>
) => {
  const reports = survivingReports
  const consume = Effect.fn("AuthoredCassette.PlannedAttemptExecutor.consume")(function* (
    request: "StartOrContinue" | "Suspend",
    plannedAttempt: PlannedTaskAttempt
  ) {
    yield* beforeExecutorReport
    yield* cursor.pauseAtCoordinatorProcessDeath
    const item = yield* cursor.consumeExecutorReport.pipe(
      Effect.mapError(
        (failure) =>
          new ControlledFakeExecutorMismatch({
            detail:
              `${failure._tag} at story position ${failure.storyPosition}: ` +
              `expected ${failure.expected}, received ${failure.actual} while handling ${request}`
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
    if (item._tag === "PlannedAttemptExecutorResponseLost") {
      yield* Ref.update(unresolvedLostResponses, (current) =>
        new Set(current).add(plannedAttemptExecutorCorrelationKey(correlation))
      )
      yield* cursor.pauseAtCoordinatorProcessDeath
      /* v8 ignore next -- @preserve The death barrier interrupts this executor fiber and never resumes it. */
      return yield* Effect.never
    }
    return report
  })
  return Layer.succeed(
    PlannedAttemptExecutor,
    PlannedAttemptExecutor.of({
      project: (correlation) =>
        Effect.gen(function* () {
          const projection = yield* cursor.consumeExecutorProjection
          if (Option.isNone(projection)) {
            const unresolved = yield* Ref.get(unresolvedLostResponses)
            if (unresolved.has(plannedAttemptExecutorCorrelationKey(correlation))) {
              return yield* Effect.die(
                new Error(
                  `authored executor projection for unresolved ${correlation.attemptId} requires an explicit return`
                )
              )
            }
            return Option.fromUndefinedOr(
              (yield* Ref.get(reports)).get(plannedAttemptExecutorCorrelationKey(correlation))
            )
          }
          if (projection.value.report.attemptId !== correlation.attemptId) {
            return yield* Effect.die(
              new Error(
                `authored executor projection expected ${projection.value.report.attemptId}, received ${correlation.attemptId}`
              )
            )
          }
          const projectedReport = executorReport(projection.value, runId)
          yield* Ref.update(
            reports,
            (current) => new Map([...current, [plannedAttemptExecutorCorrelationKey(correlation), projectedReport]])
          )
          yield* Ref.update(unresolvedLostResponses, (current) => {
            const next = new Set(current)
            next.delete(plannedAttemptExecutorCorrelationKey(correlation))
            return next
          })
          return Option.some(projectedReport)
        }),
      /* v8 ignore next -- Live Pause/Suspend production behavior is outside issue 170's maintained singleton. */
      requestSuspension: (plannedAttempt) => consume("Suspend", plannedAttempt),
      startOrContinue: (plannedAttempt) => consume("StartOrContinue", plannedAttempt)
    })
  )
}
