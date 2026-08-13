import { Effect, Layer, Match, Option, Ref, Schema } from "effect"
import {
  PlannedAttemptExecutorCommandFailure,
  EvidenceDigest,
  EvidenceReference,
  PlannedAttemptExecutor,
  PlannedAttemptExecutorReport,
  PlannedAttemptExecutorResult,
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

const evidenceDigestHexLength = 64

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

const actualReadDecision = Match.type<ReadOperation>().pipe(
  Match.tagsExhaustive({
    ReadTaskClaim: (operation) => AuthoredCassetteDecision.cases.ReadTaskClaim.make({ taskId: operation.taskId }),
    ReadTargetLineage: (operation) =>
      AuthoredCassetteDecision.cases.ReadTargetLineage.make({
        attemptId: operation.plannedAttempt.attemptId,
        taskId: operation.plannedAttempt.taskId
      }),
    ReadTaskWorkSpecification: (operation) =>
      AuthoredCassetteDecision.cases.ReadTaskWorkSpecification.make({ taskId: operation.taskId }),
    ReadTaskWorktree: (operation) =>
      AuthoredCassetteDecision.cases.ReadTaskWorktree.make({
        attemptId: operation.plannedAttempt.attemptId,
        taskId: operation.plannedAttempt.taskId
      }),
    ReadTrackerGraph: (operation) => AuthoredCassetteDecision.cases.ReadTrackerGraph.make({ target: operation.target })
  })
)

const actualDecision = (item: TraceItem): CassetteDecision | undefined => {
  if (item._tag !== "OperationSelected") return undefined
  if (isReadOperation(item.operation)) return actualReadDecision(item.operation)
  return Match.value(item.operation).pipe(
    Match.tags({
      AcquireTaskClaim: (operation) =>
        AuthoredCassetteDecision.cases.AcquireTaskClaim.make({ taskId: operation.acquisition.taskId }),
      ReleaseTaskClaim: (operation) =>
        AuthoredCassetteDecision.cases.ReleaseTaskClaim.make({ taskId: operation.release.claim.taskId }),
      ReconcileTaskWorktree: (operation) =>
        AuthoredCassetteDecision.cases.ReconcileTaskWorktree.make({
          attemptId: operation.plannedAttempt.attemptId,
          taskId: operation.plannedAttempt.taskId
        }),
      RecordTaskAttemptPlan: (operation) =>
        AuthoredCassetteDecision.cases.RecordTaskAttemptPlan.make({
          attemptId: operation.plannedAttempt.attemptId,
          taskId: operation.plannedAttempt.taskId
        })
    }),
    Match.orElse(() => undefined)
  )
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
      if (actual._tag === "ReadTaskWorkSpecification") {
        yield* cursor.awaitTaskWorkSpecificationReadBoundary(actual.taskId)
      }
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
        const storyPosition = (yield* cursor.storyPosition) - 1
        return yield* new TraceOutputError({
          detail: `at story position ${storyPosition}: expected ${encodedDecision(expected.operation)}, received ${encodedDecision(actual)}`
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
  const provisionalEvidence = EvidenceReference.make({
    byteLength: 0,
    digest: EvidenceDigest.make("0".repeat(evidenceDigestHexLength))
  })
  return Match.value(item.report).pipe(
    Match.tagsExhaustive({
      Running: () => PlannedAttemptExecutorReport.cases.Running.make({ correlation }),
      SafelySuspended: () => PlannedAttemptExecutorReport.cases.SafelySuspended.make({ correlation }),
      Terminal: (report) =>
        PlannedAttemptExecutorReport.cases.Terminal.make({
          correlation,
          result: Match.value(report.result).pipe(
            Match.tagsExhaustive({
              Accepted: ({ acceptedResult }) =>
                PlannedAttemptExecutorResult.cases.Accepted.make({
                  acceptedResult: { commit: acceptedResult.commit, evidenceManifest: provisionalEvidence }
                }),
              Completed: () => PlannedAttemptExecutorResult.cases.Completed.make({}),
              Failed: () => PlannedAttemptExecutorResult.cases.Failed.make({})
            })
          )
        })
    })
  )
}

export const controlledExecutorLayer = (
  cursor: StoryCursor,
  runId: RunId,
  beforeExecutorReport:
    | Effect.Effect<void>
    | ((
        plannedAttempt: PlannedTaskAttempt,
        request: "StartOrContinue" | "Suspend"
      ) => Effect.Effect<void>) = Effect.void,
  survivingReports: Ref.Ref<ReadonlyMap<string, PlannedAttemptExecutorReport>>,
  unresolvedLostResponses: Ref.Ref<ReadonlySet<string>>,
  prepareReport: (report: PlannedAttemptExecutorReport) => Effect.Effect<PlannedAttemptExecutorReport> = Effect.succeed
) => {
  const reports = survivingReports
  const consume = Effect.fn("AuthoredCassette.PlannedAttemptExecutor.consume")(function* (
    request: "StartOrContinue" | "Suspend",
    plannedAttempt: PlannedTaskAttempt
  ) {
    yield* typeof beforeExecutorReport === "function"
      ? beforeExecutorReport(plannedAttempt, request)
      : beforeExecutorReport
    yield* cursor.pauseAtCoordinatorProcessDeath
    const storyPosition = yield* cursor.storyPosition
    const item = yield* cursor.consumeExecutorReport.pipe(
      Effect.mapError(
        (failure) =>
          new PlannedAttemptExecutorCommandFailure({
            command: request,
            correlation: plannedAttemptExecutorCorrelation(plannedAttempt),
            detail:
              `${failure._tag} at story position ${failure.storyPosition}: ` +
              `expected ${failure.expected}, received ${failure.actual} while handling ${request} for ` +
              `${plannedAttempt.taskId}/${plannedAttempt.attemptId}`
          })
      )
    )
    const correlation = plannedAttemptExecutorCorrelation(plannedAttempt)
    if (item.request !== request || item.report.attemptId !== correlation.attemptId) {
      return yield* new PlannedAttemptExecutorCommandFailure({
        command: request,
        correlation,
        detail:
          `at story position ${storyPosition}: authored executor expected ${item.request} for ${item.report.attemptId}, ` +
          `received ${request} for ${correlation.attemptId}`
      })
    }
    const report = yield* prepareReport(executorReport(item, runId))
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
          const projectedReport = yield* prepareReport(executorReport(projection.value, runId))
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
