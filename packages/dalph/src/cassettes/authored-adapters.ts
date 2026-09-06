import { Deferred, Effect, Layer, Match, Option, Ref, Schema, Stream } from "effect"
import {
  PlannedAttemptExecutorCommandFailure,
  EvidenceDigest,
  EvidenceReference,
  PlannedAttemptExecutor,
  PlannedAttemptExecutorLifecycleObservation,
  PlannedAttemptExecutorProjection,
  PlannedAttemptExecutorReport,
  type PlannedAttemptExecutorRequest,
  PlannedAttemptExecutorResult,
  passiveLifecycleObservationPurpose,
  plannedAttemptExecutorCorrelation,
  plannedAttemptExecutorCorrelationKey,
  samePlannedAttemptExecutorCorrelation,
  makeTaskWorkSpecification,
  type PlannedTaskAttempt,
  type RunId,
  type TaskId
} from "@dalph/contracts"
import {
  projectTrackerSnapshot,
  TraceOutputError,
  TrackerAdapterReadFailureReason,
  TrackerGraphReader,
  type TraceItem,
  type WorkflowOperation,
  workflowOperationId,
  WorkflowTrace
} from "@dalph/orchestrator"
import {
  AuthoredCassetteDecision,
  type AuthoredCassetteDecision as CassetteDecision,
  type AuthoredCassetteStoryItem
} from "./authored-domain.js"
import type { StoryCursor } from "./authored-cursor.js"
import { awaitTraceSelectionBoundaries } from "./authored-trace-boundaries.js"
import { trackerReadFailure } from "./authored-tracker-read-results.js"

const evidenceDigestHexLength = 64

export const controlledTrackerGraphReaderLayer = (cursor: StoryCursor) =>
  Layer.succeed(
    TrackerGraphReader,
    TrackerGraphReader.of({
      read: Effect.fn("AuthoredCassette.TrackerGraphReader.read")(function* () {
        const item = yield* cursor.consumeTrackerGraph.pipe(
          Effect.mapError((failure) =>
            trackerReadFailure(
              `${failure._tag} at story position ${failure.storyPosition}: expected ${failure.expected}, received ${failure.actual}`,
              TrackerAdapterReadFailureReason.cases.BoundaryDecode.make({})
            )
          )
        )
        if (item._tag === "TrackerGraphReadFailed") {
          return yield* trackerReadFailure(`authored cassette tracker graph read failed: ${item.reason}`)
        }
        const projection = projectTrackerSnapshot(item.graph)
        return projection._tag === "Valid"
          ? projection.snapshot
          : yield* trackerReadFailure(
              `authored cassette tracker graph is invalid: ${projection.issues.map(({ _tag }) => _tag).join(", ")}`,
              TrackerAdapterReadFailureReason.cases.BoundaryDecode.make({})
            )
      }),
      readTaskWorkSpecification: Effect.fn("AuthoredCassette.TrackerGraphReader.readTaskWorkSpecification")(
        function* (_target, taskId) {
          const item = yield* cursor.consumeTaskWorkSpecification.pipe(
            Effect.mapError((failure) =>
              trackerReadFailure(
                `${failure._tag} at story position ${failure.storyPosition}`,
                TrackerAdapterReadFailureReason.cases.BoundaryDecode.make({})
              )
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
    /* v8 ignore next -- @preserve Maintained authored stories expose only the selected operations represented by AuthoredCassetteDecision. */
    Match.orElse(() => undefined)
  )
}

const encodedDecision = (decision: CassetteDecision): string =>
  JSON.stringify(Schema.encodeUnknownSync(AuthoredCassetteDecision)(decision))

interface ControlledTraceOptions {
  /**
   * A task-scoped Operator read has priority over a delivery read waiting on
   * the same authored boundary.  The production control call remains the
   * source of the read; this only preserves its declared cassette chronology.
   */
  readonly operatorControlGraphReadActive?: Ref.Ref<boolean>
  readonly operatorControlGraphReadGate?: Ref.Ref<
    Option.Option<{ readonly release: Deferred.Deferred<void>; readonly taskId: TaskId }>
  >
}

const awaitTraceStoryBoundary = (cursor: StoryCursor, item: TraceItem): Effect.Effect<void> =>
  Effect.gen(function* () {
    /* v8 ignore next -- @preserve Trace boundary waiting is invoked only for the operation-selection trace item just emitted. */
    if (item._tag !== "OperationSelected") return
    const current = yield* cursor.currentStoryItem
    if (
      current?._tag === "CassetteHoldsTargetPromotionReconciliationReadBeforeBoundary" &&
      item.operation._tag !== "ReadTargetLineage"
    ) {
      yield* cursor.awaitCurrentStoryAdvance
    }
  })

const awaitTraceTaskWorkSpecificationBoundary = (cursor: StoryCursor, actual: CassetteDecision): Effect.Effect<void> =>
  actual._tag === "ReadTaskWorkSpecification"
    ? cursor.awaitTaskWorkSpecificationReadBoundary(actual.taskId)
    : Effect.void

const awaitTraceOperatorControlGraphReadBoundary = (
  item: TraceItem,
  options: ControlledTraceOptions
): Effect.Effect<void> =>
  Effect.gen(function* () {
    const gateRef = options.operatorControlGraphReadGate
    /* v8 ignore next -- @preserve The authored runner installs both operator-control gate refs together. */
    if (gateRef === undefined) return
    const gate = yield* Ref.get(gateRef)
    const operatorControlGraphReadActive =
      /* v8 ignore next -- @preserve An installed operator-control gate always carries its paired activity ref. */
      options.operatorControlGraphReadActive === undefined
        ? false
        : yield* Ref.get(options.operatorControlGraphReadActive)
    const isOperatorGraphRead =
      Option.isSome(gate) && operatorControlGraphReadActive && item._tag === "OperationSelected"
    /* v8 ignore next -- @preserve The serialized authored cursor cannot overtake an active operator graph read with another trace item. */
    if (Option.isSome(gate) && !isOperatorGraphRead) yield* Deferred.await(gate.value.release)
  })

const awaitTraceBoundaries = (
  cursor: StoryCursor,
  item: TraceItem,
  actual: CassetteDecision,
  options: ControlledTraceOptions
): Effect.Effect<void> =>
  Effect.gen(function* () {
    yield* awaitTraceStoryBoundary(cursor, item)
    yield* awaitTraceTaskWorkSpecificationBoundary(cursor, actual)
    yield* awaitTraceOperatorControlGraphReadBoundary(item, options)
  })

const emitControlledDecision = (
  cursor: StoryCursor,
  item: Extract<TraceItem, { readonly _tag: "OperationSelected" }>,
  actual: CassetteDecision,
  options: ControlledTraceOptions
): Effect.Effect<void, TraceOutputError> =>
  Effect.gen(function* () {
    yield* awaitTraceBoundaries(cursor, item, actual, options)
    const expected = yield* cursor
      .consumeDalphSelectionFor(actual, {
        operationId: workflowOperationId(item.operation),
        predecessorOperationIds: item.operation.predecessorOperationIds
      })
      .pipe(
        Effect.mapError(
          (failure) =>
            new TraceOutputError({
              detail:
                `${failure._tag} at story position ${failure.storyPosition}: ` +
                `${failure._tag === "AuthoredCassetteInteractionMismatch" ? `expected ${failure.expected}, received ${failure.actual}` : failure.detail} ` +
                `while emitting ${encodedDecision(actual)}`
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

export const controlledTrace = (cursor: StoryCursor, options: ControlledTraceOptions = {}): WorkflowTrace["Service"] =>
  WorkflowTrace.of({
    emit: Effect.fn("AuthoredCassette.WorkflowTrace.emit")(function* (item) {
      yield* awaitTraceSelectionBoundaries(cursor, item)
      const actual = actualDecision(item)
      /* v8 ignore next -- @preserve A cassette decision is derived only from an OperationSelected trace item. */
      if (actual === undefined || item._tag !== "OperationSelected") return
      yield* emitControlledDecision(cursor, item, actual, options)
    })
  })

const executorReport = (
  item: Extract<
    AuthoredCassetteStoryItem,
    {
      readonly _tag:
        | "PlannedAttemptExecutorPassiveLifecycleChanged"
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
      ExecutorWorkExecuting: () => PlannedAttemptExecutorReport.cases.ExecutorWorkExecuting.make({ correlation }),
      ExecutorWorkSafelySuspended: () =>
        PlannedAttemptExecutorReport.cases.ExecutorWorkSafelySuspended.make({ correlation }),
      ExecutorWorkTerminal: (report) =>
        PlannedAttemptExecutorReport.cases.ExecutorWorkTerminal.make({
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
  beforeExecutorReport: (
    plannedAttempt: PlannedTaskAttempt,
    request: "Begin" | "Resume" | "Suspend"
  ) => Effect.Effect<void>,
  survivingReports: Ref.Ref<ReadonlyMap<string, PlannedAttemptExecutorReport>>,
  unresolvedLostResponses: Ref.Ref<ReadonlySet<string>>,
  prepareReport: (report: PlannedAttemptExecutorReport) => Effect.Effect<PlannedAttemptExecutorReport> = Effect.succeed
) => {
  const reports = survivingReports
  const consume = Effect.fn("AuthoredCassette.PlannedAttemptExecutor.consume")(function* (
    request: "Begin" | "Resume" | "Suspend",
    plannedAttempt: PlannedTaskAttempt
  ) {
    yield* cursor.beginExecutorReportRequest(request, plannedAttempt.attemptId)
    return yield* Effect.gen(function* () {
      yield* beforeExecutorReport(plannedAttempt, request)
      yield* cursor.pauseAtCoordinatorProcessDeath
      const storyPosition = (yield* cursor.storyPosition) - 1
      const item = yield* cursor
        .consumeExecutorReportFor(request, plannedAttempt.attemptId)
        .pipe(
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
    }).pipe(Effect.ensuring(cursor.endExecutorReportRequest(request, plannedAttempt.attemptId)))
  })
  const executor = PlannedAttemptExecutor.of({
    observe: (correlation) =>
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
          const report = (yield* Ref.get(reports)).get(plannedAttemptExecutorCorrelationKey(correlation))
          return report === undefined
            ? PlannedAttemptExecutorProjection.cases.NoReport.make({ correlation })
            : PlannedAttemptExecutorProjection.cases.Exact.make({ report })
        }
        const projectedReport = yield* prepareReport(executorReport(projection.value, runId))
        if (!samePlannedAttemptExecutorCorrelation(projectedReport.correlation, correlation)) {
          return PlannedAttemptExecutorProjection.cases.CorrelationContradiction.make({
            expected: correlation,
            observed: projectedReport
          })
        }
        yield* Ref.update(
          reports,
          (current) => new Map([...current, [plannedAttemptExecutorCorrelationKey(correlation), projectedReport]])
        )
        yield* Ref.update(unresolvedLostResponses, (current) => {
          const next = new Set(current)
          next.delete(plannedAttemptExecutorCorrelationKey(correlation))
          return next
        })
        return PlannedAttemptExecutorProjection.cases.Exact.make({ report: projectedReport })
      }),
    /* v8 ignore next -- Live Pause/Suspend production behavior is outside issue 170's maintained singleton. */
    requestSuspension: (plannedAttempt) => consume("Suspend", plannedAttempt),
    begin: (request: PlannedAttemptExecutorRequest) => consume("Begin", request.plannedAttempt),
    resume: (request: PlannedAttemptExecutorRequest) => consume("Resume", request.plannedAttempt)
  })
  return Layer.merge(
    Layer.succeed(PlannedAttemptExecutor, executor),
    Layer.succeed(
      PlannedAttemptExecutorLifecycleObservation,
      PlannedAttemptExecutorLifecycleObservation.of({
        attach: (correlation) =>
          Effect.gen(function* () {
            const item = yield* cursor.currentStoryItem
            const current =
              item?._tag === "PlannedAttemptExecutorProjectionReturned" &&
              item.report.attemptId === correlation.attemptId
                ? yield* executor.observe(correlation, passiveLifecycleObservationPurpose)
                : yield* Ref.get(reports).pipe(
                    Effect.map((current) => current.get(plannedAttemptExecutorCorrelationKey(correlation))),
                    Effect.map((report) =>
                      report === undefined
                        ? PlannedAttemptExecutorProjection.cases.NoReport.make({ correlation })
                        : PlannedAttemptExecutorProjection.cases.Exact.make({ report })
                    )
                  )
            const changes = cursor.passiveExecutorLifecycleChangesFor(correlation.attemptId).pipe(
              Stream.mapEffect((item) =>
                Effect.gen(function* () {
                  const report = yield* prepareReport(executorReport(item, runId))
                  yield* Ref.update(
                    reports,
                    (current) => new Map([...current, [plannedAttemptExecutorCorrelationKey(correlation), report]])
                  )
                  return PlannedAttemptExecutorProjection.cases.Exact.make({ report })
                })
              )
            )
            return { changes, close: Effect.void, current }
          })
      })
    )
  )
}
