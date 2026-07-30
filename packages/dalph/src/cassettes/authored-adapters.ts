import { Effect, Layer, Option, Ref, Schema } from "effect"
import {
  ControlledFakeExecutorMismatch,
  PlannedAttemptExecutor,
  PlannedAttemptExecutorReport,
  plannedAttemptExecutorCorrelation,
  plannedAttemptExecutorCorrelationKey,
  type PlannedTaskAttempt,
  type RunId,
  type TaskId
} from "@dalph/contracts"
import {
  makeTaskWorkSpecification,
  projectTrackerSnapshot,
  TraceOutputError,
  TrackerAdapterReadContext,
  TrackerAdapterReadError,
  TrackerAdapterReadFailureReason,
  TrackerGraphReader,
  TrackerMutation,
  TaskClaimConflict,
  TaskClaimOwnershipConflict,
  TaskClaimReadFailure,
  type TaskClaimObservation,
  UnclaimedTask,
  isExactTaskClaim,
  OperationId,
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

/** Owns the cassette's coherent logical claim state and optional authored read failures. */
export const controlledTrackerMutationLayer = (cursor: StoryCursor, tracker: TrackerMutation["Service"]) =>
  Layer.effect(
    TrackerMutation,
    Effect.gen(function* () {
      const authoredObservations = yield* Ref.make<ReadonlyMap<TaskId, TaskClaimObservation>>(new Map())
      const currentObservation: TrackerMutation["Service"]["readTaskClaim"] = (taskId) =>
        Ref.get(authoredObservations).pipe(
          Effect.flatMap((observations) => {
            const observation = observations.get(taskId)
            return observation === undefined ? tracker.readTaskClaim(taskId) : Effect.succeed(observation)
          })
        )
      const setObservation = (taskId: TaskId, observation: TaskClaimObservation) =>
        Ref.update(authoredObservations, (observations) => new Map(observations).set(taskId, observation))
      const applyAuthoredObservation = (observation: TaskClaimObservation) =>
        Effect.gen(function* () {
          if (observation._tag === "UnclaimedTask") {
            const current = yield* tracker.readTaskClaim(observation.taskId)
            /* v8 ignore start -- @preserve Repeating an authored absence needs no second underlying release. */
            if (current._tag === "ActiveTaskClaim") {
              yield* tracker
                .releaseTaskClaim({
                  claim: current,
                  operationId: OperationId.make(`authored-external-claim-loss:${current.operationId}`)
                })
                .pipe(Effect.orDie)
            }
            /* v8 ignore stop -- @preserve */
          }
          yield* setObservation(observation.taskId, observation)
          return observation
        })
      const readTaskClaim: TrackerMutation["Service"]["readTaskClaim"] = (taskId) =>
        cursor.consumeTaskClaimRead.pipe(
          Effect.flatMap(
            Option.match({
              onNone: () => currentObservation(taskId),
              onSome: (item) => {
                if (item._tag === "TaskClaimCurrentReadReturned") {
                  return item.taskId === taskId
                    ? currentObservation(taskId)
                    : /* v8 ignore next -- @preserve Decoded authored claim reads must name the requested task. */
                      Effect.die(`authored cassette returned current claim ${item.taskId} for ${taskId}`)
                }
                if (item._tag === "TaskClaimReadFailed") {
                  return item.taskId === taskId
                    ? Effect.fail(new TaskClaimReadFailure({ detail: item.reason, taskId }))
                    : /* v8 ignore next -- @preserve Decoded authored failures must name the requested task. */
                      Effect.die(`authored cassette returned unreadable claim ${item.taskId} for ${taskId}`)
                }
                return item.observation.taskId === taskId
                  ? applyAuthoredObservation(item.observation)
                  : /* v8 ignore next -- @preserve Decoded authored observations must name the requested task. */
                    Effect.die(`authored cassette returned task claim ${item.observation.taskId} for ${taskId}`)
              }
            })
          )
        )
      return TrackerMutation.of({
        acquireTaskClaim: (acquisition) =>
          Ref.get(authoredObservations).pipe(
            Effect.flatMap((observations) => {
              const observed = observations.get(acquisition.taskId)
              if (observed === undefined) {
                return tracker
                  .acquireTaskClaim(acquisition)
                  .pipe(Effect.tap((claim) => setObservation(acquisition.taskId, claim)))
              }
              const attempted = { _tag: "ActiveTaskClaim" as const, ...acquisition }
              /* v8 ignore next -- @preserve Active-observation redelivery and conflict behavior is covered by the ignored underlying acquisition-contract block below. */
              if (observed._tag === "UnclaimedTask") {
                return tracker
                  .acquireTaskClaim(acquisition)
                  .pipe(Effect.tap((claim) => setObservation(acquisition.taskId, claim)))
              }
              /* v8 ignore start -- @preserve Exact redelivery is covered by the underlying acquisition contract. */
              return isExactTaskClaim(observed, attempted)
                ? Effect.succeed(observed)
                : Effect.fail(new TaskClaimConflict({ attempted: acquisition, observed }))
              /* v8 ignore stop -- @preserve */
            })
          ),
        readTaskClaim,
        /* v8 ignore start -- @preserve Release variants are covered by the tracker contract and composed cassette outcomes. */
        releaseTaskClaim: (release) =>
          Ref.get(authoredObservations).pipe(
            Effect.flatMap((observations) => {
              const observed = observations.get(release.claim.taskId)
              if (observed === undefined) {
                return tracker
                  .releaseTaskClaim(release)
                  .pipe(
                    Effect.tap(() =>
                      setObservation(release.claim.taskId, UnclaimedTask.make({ taskId: release.claim.taskId }))
                    )
                  )
              }
              /* v8 ignore next -- @preserve Ownership-conflict variants are covered by the tracker contract. */
              return observed._tag === "ActiveTaskClaim" && isExactTaskClaim(observed, release.claim)
                ? tracker
                    .releaseTaskClaim(release)
                    .pipe(
                      Effect.tap(() =>
                        setObservation(release.claim.taskId, UnclaimedTask.make({ taskId: release.claim.taskId }))
                      )
                    )
                : Effect.fail(new TaskClaimOwnershipConflict({ attempted: release.claim, observed }))
            })
          )
        /* v8 ignore stop -- @preserve */
      })
    })
  )

const encodedDecision = (decision: CassetteDecision): string =>
  JSON.stringify(Schema.encodeUnknownSync(AuthoredCassetteDecision)(decision))

export const controlledTrace = (cursor: StoryCursor): WorkflowTrace["Service"] =>
  WorkflowTrace.of({
    emit: Effect.fn("AuthoredCassette.WorkflowTrace.emit")(function* (item) {
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
        yield* cursor.pauseAtCoordinatorProcessDeath
        const item = yield* cursor.consumeExecutorReport.pipe(
          Effect.mapError(
            (failure) =>
              new ControlledFakeExecutorMismatch({
                detail:
                  `${failure._tag} at story position ${failure.storyPosition}: ` +
                  `expected ${failure.expected}, received ${failure.actual}`
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
