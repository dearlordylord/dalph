/* eslint-disable functional/immutable-data -- Recovery accumulates independent authority reads in journal order. */
import { Effect, Result, Schema } from "effect"
import { CoordinatorLockObservationContradiction, CoordinatorOwnershipLost } from "./coordinator-lock.js"
import { RunId } from "./domain.js"
import { GitWorktree } from "./git-worktree.js"
import { authorizeImplementationReview, EvidenceStore } from "./implementation-evidence.js"
import { authorizeImplementationReviewEvidence } from "./implementation-review.js"
import { type JournalRecord, JournalStore } from "./journal-store.js"
import { reduceManagedHistory } from "./managed-history.js"
import { TaskExecutionOutcomeObserved } from "./task-execution-trace.js"
import { TaskExecutor } from "./task-execution.js"
import { TaskRunner } from "./task-work-start.js"
import { TrackerGraphReader } from "./tracker-graph-reader.js"
import { TrackerMutation } from "./tracker-mutation.js"
import { TrackerGraphOutcomeObserved as TrackerGraphOutcomeObservedTrace } from "./tracker-workflow-trace.js"
import {
  claimAuthorityMatches,
  executionAuthorityMatches,
  sessionAuthorityMatches,
  worktreeAuthorityMatches
} from "./workflow-authority-relations.js"
import {
  ImplementationReviewCompletedTrace,
  makeTrackerGraphObservedOutcome,
  ReviewFindingsHandedBackTrace,
  SealedImplementationEvidenceTrace,
  TaskClaimAcquiredTrace,
  TaskWorkSessionEstablishedTrace,
  TaskWorktreeReadyTrace,
  WorkflowInterpreter,
  WorkflowTrace
} from "./workflow.js"

/** A valid history's fresh authority read could not determine a safe next step. */
export class RecoveryReconciliationIssue extends Schema.TaggedErrorClass<RecoveryReconciliationIssue>()(
  "RecoveryReconciliationIssue",
  {
    authority: Schema.Literals(["Evidence", "Git", "Reviewer", "TaskExecutor", "TaskRunner", "Tracker"]),
    detail: Schema.String,
    runId: RunId
  }
) {}

/** Startup retained the run after coordinator ownership could not be refreshed. */
export class RecoveryOwnershipIssue extends Schema.TaggedErrorClass<RecoveryOwnershipIssue>()(
  "RecoveryOwnershipIssue",
  { detail: Schema.String, runId: RunId }
) {}

/** Reconciles an unfinished tracker-graph read through the real tracker boundary. */
const recoverTrackerGraphObservations = Effect.fn(
  "WorkflowRecovery.recoverTrackerGraphObservations"
)(function*(runId: RunId) {
  const interpreter = yield* WorkflowInterpreter
  const journal = yield* JournalStore
  const trace = yield* WorkflowTrace
  const records = yield* journal.read(runId)
  const observed = new Set(
    records.flatMap(({ event }) => event._tag === "TrackerGraphOutcomeObserved" ? [event.operationId] : [])
  )
  const unresolved = records.flatMap(({ event }) =>
    event._tag === "TrackerGraphObservationIntentRecorded"
      && !observed.has(event.operation.operationId)
      ? [event.operation]
      : []
  )
  return yield* Effect.forEach(unresolved, (operation) =>
    interpreter.readTrackerGraph(operation).pipe(
      Effect.tap((snapshot) =>
        trace.emit(TrackerGraphOutcomeObservedTrace.make({
          operation,
          outcome: makeTrackerGraphObservedOutcome(snapshot)
        }))
      )
    ))
})

/** Reconciles exact claim intents that lack a durable authoritative outcome. */
export const recoverTaskClaimAcquisitions = Effect.fn(
  "WorkflowRecovery.recoverTaskClaimAcquisitions"
)(function*(runId: RunId) {
  const interpreter = yield* WorkflowInterpreter
  const journal = yield* JournalStore
  const trace = yield* WorkflowTrace
  const records = yield* journal.read(runId)
  const acquired = new Set(
    records.flatMap(({ event }) => event._tag === "TaskClaimAcquired" ? [event.claim.operationId] : [])
  )
  const unresolved = records.flatMap(({ event }) =>
    event._tag === "TaskClaimAcquisitionIntended"
      && !acquired.has(event.operation.acquisition.operationId)
      ? [event.operation]
      : []
  )
  return yield* Effect.forEach(unresolved, (operation) =>
    interpreter.acquireTaskClaim(operation).pipe(
      Effect.tap((result) =>
        result._tag === "AuthoritativeTaskClaimAcquired"
          ? trace.emit(TaskClaimAcquiredTrace.make({ claim: result.claim, operation }))
          : Effect.void
      )
    ))
})

/** Reconciles exact Git intents that lack a durable Base/HEAD proof. */
export const recoverTaskWorktreeReconciliations = Effect.fn(
  "WorkflowRecovery.recoverTaskWorktreeReconciliations"
)(function*(runId: RunId) {
  const interpreter = yield* WorkflowInterpreter
  const journal = yield* JournalStore
  const trace = yield* WorkflowTrace
  const records = yield* journal.read(runId)
  const ready = new Set(records.flatMap(({ event }) => event._tag === "TaskWorktreeReady" ? [event.operationId] : []))
  const unresolved = records.flatMap(({ event }) =>
    event._tag === "TaskWorktreeReconciliationIntended"
      && !ready.has(event.operation.operationId)
      ? [event.operation]
      : []
  )
  return yield* Effect.forEach(unresolved, (operation) =>
    interpreter.reconcileTaskWorktree(operation).pipe(
      Effect.tap((result) =>
        result._tag === "AuthoritativeTaskWorktreeReady"
          ? trace.emit(TaskWorktreeReadyTrace.make({ operation, proof: result.proof }))
          : Effect.void
      )
    ))
})

/** Reconstructs unresolved session-establishment operations from ordered history. */
export const recoverTaskWorkSessionEstablishments = Effect.fn(
  "WorkflowRecovery.recoverTaskWorkSessionEstablishments"
)(function*(runId: RunId) {
  const interpreter = yield* WorkflowInterpreter
  const journal = yield* JournalStore
  const trace = yield* WorkflowTrace
  const records = yield* journal.read(runId)
  const established = new Set(
    records.flatMap(({ event }) => event._tag === "TaskWorkSessionEstablished" ? [event.outcome.operationId] : [])
  )
  const unresolved = records.flatMap(({ event }) =>
    event._tag === "TaskWorkSessionEstablishmentIntentRecorded"
      && !established.has(event.operation.request.operationId)
      ? [event.operation]
      : []
  )
  return yield* Effect.forEach(unresolved, (operation) =>
    interpreter.establishTaskWorkSession(operation).pipe(
      Effect.tap((outcome) => trace.emit(TaskWorkSessionEstablishedTrace.make({ operation, outcome })))
    ))
})

/** Observes unresolved exact execution intents before any later retry policy exists. */
export const recoverTaskExecutions = Effect.fn("WorkflowRecovery.recoverTaskExecutions")(
  function*(runId: RunId) {
    const interpreter = yield* WorkflowInterpreter
    const journal = yield* JournalStore
    const trace = yield* WorkflowTrace
    const records = yield* journal.read(runId)
    const observed = new Set(records.flatMap(({ event }) =>
      event._tag === "TaskExecutionOutcomeObserved"
        ? [event.outcome.outcome.operationId]
        : []
    ))
    const unresolved = records.flatMap(({ event }) =>
      event._tag === "TaskExecutionIntentRecorded"
        && !observed.has(event.operation.request.operationId)
        ? [event.operation]
        : []
    )
    return yield* Effect.forEach(unresolved, (operation) =>
      interpreter.executeTaskWork(operation).pipe(
        Effect.tap((outcome) => trace.emit(TaskExecutionOutcomeObserved.make({ operation, outcome })))
      ))
  }
)

/** Resumes one exact journaled reviewer session without allocating a semantic round. */
export const recoverImplementationReviews = Effect.fn(
  "WorkflowRecovery.recoverImplementationReviews"
)(function*(runId: RunId) {
  const interpreter = yield* WorkflowInterpreter
  const journal = yield* JournalStore
  const trace = yield* WorkflowTrace
  const records = yield* journal.read(runId)
  const completed = new Set(records.flatMap(({ event }) =>
    event._tag === "ImplementationReviewCompleted"
      ? [event.review.manifest.operationId]
      : []
  ))
  const unresolved = records.flatMap(({ event }) =>
    event._tag === "ImplementationReviewIntended"
      && !completed.has(event.operation.request.operationId)
      ? [event.operation]
      : []
  )
  return yield* Effect.forEach(unresolved, (operation) =>
    interpreter.reviewImplementation(operation).pipe(
      Effect.tap((result) =>
        result._tag === "SealedImplementationReview"
          ? trace.emit(ImplementationReviewCompletedTrace.make({ operation, review: result }))
          : Effect.void
      )
    ))
})

/** Resumes an exact findings handback under its journaled implementer binding. */
export const recoverReviewFindingsHandbacks = Effect.fn(
  "WorkflowRecovery.recoverReviewFindingsHandbacks"
)(function*(runId: RunId) {
  const interpreter = yield* WorkflowInterpreter
  const journal = yield* JournalStore
  const trace = yield* WorkflowTrace
  const records = yield* journal.read(runId)
  const completed = new Set(records.flatMap(({ event }) =>
    event._tag === "ReviewFindingsHandbackCompleted"
      ? [event.acknowledgement.operationId]
      : []
  ))
  const unresolved = records.flatMap(({ event }) =>
    event._tag === "ReviewFindingsHandbackIntended"
      && !completed.has(event.operation.request.operationId)
      ? [event.operation]
      : []
  )
  return yield* Effect.forEach(unresolved, (operation) =>
    interpreter.handBackReviewFindings(operation).pipe(
      Effect.tap((acknowledgement) => trace.emit(ReviewFindingsHandedBackTrace.make({ acknowledgement, operation })))
    ))
})

/** Completes unresolved sealing intents through the same idempotent evidence protocol. */
export const recoverImplementationEvidenceSealings = Effect.fn(
  "WorkflowRecovery.recoverImplementationEvidenceSealings"
)(function*(runId: RunId) {
  const interpreter = yield* WorkflowInterpreter
  const journal = yield* JournalStore
  const trace = yield* WorkflowTrace
  const records = yield* journal.read(runId)
  const sealed = new Set(
    records.flatMap(({ event }) => event._tag === "ImplementationEvidenceSealed" ? [event.operationId] : [])
  )
  const unresolved = records.flatMap(({ event }) =>
    event._tag === "ImplementationEvidenceSealingIntended"
      && !sealed.has(event.operation.operationId)
      ? [event.operation]
      : []
  )
  return yield* Effect.forEach(unresolved, (operation) =>
    interpreter.sealImplementationEvidence(operation).pipe(
      Effect.tap((result) =>
        result._tag === "SealedImplementationEvidence"
          ? trace.emit(SealedImplementationEvidenceTrace.make({ operation, sealed: result }))
          : Effect.void
      )
    ))
})

const reconciliationIssue = (
  authority: RecoveryReconciliationIssue["authority"],
  runId: RunId,
  failure: unknown
): RecoveryReconciliationIssue =>
  new RecoveryReconciliationIssue({
    authority,
    detail: String(failure),
    runId
  })

export const classifyRecoveryIssue = (
  authority: RecoveryReconciliationIssue["authority"],
  runId: RunId,
  failure: unknown
): RecoveryOwnershipIssue | RecoveryReconciliationIssue =>
  failure instanceof CoordinatorOwnershipLost
    || failure instanceof CoordinatorLockObservationContradiction
    ? new RecoveryOwnershipIssue({ detail: String(failure), runId })
    : reconciliationIssue(authority, runId, failure)

const collectRefreshIssue = (
  authority: RecoveryReconciliationIssue["authority"],
  runId: RunId
) =>
<A, E, R>(refresh: Effect.Effect<A, E, R>) =>
  Effect.result(refresh).pipe(
    Effect.map((result): ReadonlyArray<RecoveryOwnershipIssue | RecoveryReconciliationIssue> =>
      Result.isFailure(result) ? [classifyRecoveryIssue(authority, runId, result.failure)] : []
    )
  )

const contradict = (detail: string): Effect.Effect<never, Error> => Effect.fail(new Error(detail))

/**
 * Refreshes every authority represented by decoded history using read-only
 * adapter methods. This is safe even for an invalid history: it never appends
 * records, creates resources, starts work, invokes reviewers, or delivers findings.
 */
export const observeManagedRunAuthorities = Effect.fn(
  "WorkflowRecovery.observeManagedRunAuthorities"
)(function*(runId: RunId, records: ReadonlyArray<JournalRecord>) {
  const graph = yield* TrackerGraphReader
  const tracker = yield* TrackerMutation
  const git = yield* GitWorktree
  const runner = yield* TaskRunner
  const executor = yield* TaskExecutor
  const evidence = yield* EvidenceStore
  const collect = (authority: RecoveryReconciliationIssue["authority"]) => collectRefreshIssue(authority, runId)
  const checks = new Array<Effect.Effect<ReadonlyArray<RecoveryOwnershipIssue | RecoveryReconciliationIssue>>>()

  for (const { event } of records) {
    // Only authority-bearing events require a refresh; all protocol trace events intentionally share the default.
    // eslint-disable-next-line @typescript-eslint/switch-exhaustiveness-check
    switch (event._tag) {
      case "TrackerGraphObservationIntentRecorded": {
        checks.push(collect("Tracker")(graph.read(event.operation.target)))
        break
      }
      case "TaskClaimAcquisitionIntended": {
        const durable = records.find(({ event: candidate }) =>
          candidate._tag === "TaskClaimAcquired"
          && candidate.claim.operationId === event.operation.acquisition.operationId
        )?.event
        checks.push(
          collect("Tracker")(
            tracker.readTaskClaim(event.operation.acquisition.taskId).pipe(
              Effect.flatMap((observed) =>
                durable?._tag !== "TaskClaimAcquired"
                  || claimAuthorityMatches(observed, durable.claim)
                  ? Effect.void
                  : contradict(`task claim changed for completed operation ${event.operation.acquisition.operationId}`)
              )
            )
          )
        )
        break
      }
      case "TaskWorktreeReconciliationIntended": {
        const durable = records.find(({ event: candidate }) =>
          candidate._tag === "TaskWorktreeReady"
          && candidate.operationId === event.operation.operationId
        )?.event
        checks.push(
          collect("Git")(
            git.readPlannedWorktree(event.operation.plannedAttempt).pipe(
              Effect.flatMap((observed) =>
                durable?._tag !== "TaskWorktreeReady"
                  || worktreeAuthorityMatches(observed, event.operation.plannedAttempt)
                  ? Effect.void
                  : contradict(`worktree changed for completed operation ${event.operation.operationId}`)
              )
            )
          )
        )
        break
      }
      case "TaskWorkSessionEstablishmentIntentRecorded": {
        const durable = records.find(({ event: candidate }) =>
          candidate._tag === "TaskWorkSessionEstablished"
          && candidate.outcome.operationId === event.operation.request.operationId
        )?.event
        checks.push(
          collect("TaskRunner")(
            runner.lookupTaskWorkSession({
              operationId: event.operation.request.operationId,
              plannedAttempt: event.operation.request.plannedAttempt
            }).pipe(
              Effect.flatMap((observed) =>
                durable?._tag !== "TaskWorkSessionEstablished"
                  || sessionAuthorityMatches(observed, durable.outcome.sessionId)
                  ? Effect.void
                  : contradict(
                    `task-work session changed for completed operation ${event.operation.request.operationId}`
                  )
              )
            )
          )
        )
        break
      }
      case "TaskExecutionIntentRecorded": {
        const session = event.operation.request.session
        if (session._tag !== "EstablishedSession") break
        const durable = records.find(({ event: candidate }) =>
          candidate._tag === "TaskExecutionOutcomeObserved"
          && candidate.outcome.outcome.operationId === event.operation.request.operationId
        )?.event
        checks.push(
          collect("TaskExecutor")(
            executor.observeTaskExecution({
              operationId: event.operation.request.operationId,
              plannedAttempt: event.operation.request.plannedAttempt,
              sessionId: session.sessionId
            }).pipe(
              Effect.flatMap((observed) => {
                if (durable?._tag !== "TaskExecutionOutcomeObserved") return Effect.void
                return executionAuthorityMatches(observed, durable.outcome.outcome)
                  ? Effect.void
                  : contradict(`task execution changed for completed operation ${event.operation.request.operationId}`)
              })
            )
          )
        )
        break
      }
      case "ImplementationEvidenceSealed":
        checks.push(
          collect("Evidence")(
            authorizeImplementationReview(event.sealed).pipe(Effect.provideService(EvidenceStore, evidence))
          )
        )
        break
      case "ImplementationReviewCompleted":
        checks.push(
          collect("Reviewer")(
            authorizeImplementationReviewEvidence(event.review).pipe(Effect.provideService(EvidenceStore, evidence))
          )
        )
        break
      case "ReviewFindingsHandbackCompleted":
        checks.push(collect("Reviewer")(evidence.read(event.acknowledgement.reviewEvidenceReference)))
        break
      default:
        break
    }
  }
  return (yield* Effect.all(checks, { concurrency: 1 })).flat()
})

/**
 * Validates one complete history before refreshing each current authority.
 * Every authority result is collected so one unreadable boundary cannot hide
 * an independent reconciliation fact from another boundary.
 */
export const recoverExactRunAfterCoordinatorDeath = Effect.fn(
  "WorkflowRecovery.recoverExactRunAfterCoordinatorDeath"
)(function*(runId: RunId, discoveredRecords?: ReadonlyArray<JournalRecord>) {
  const journal = yield* JournalStore
  const reduction = reduceManagedHistory(
    runId,
    discoveredRecords ?? (yield* journal.read(runId))
  )
  if (reduction._tag === "InvalidManagedHistory") return reduction.issues

  const collect = (authority: RecoveryReconciliationIssue["authority"]) => collectRefreshIssue(authority, runId)
  return (yield* Effect.all([
    collect("Tracker")(recoverTrackerGraphObservations(runId)),
    collect("Tracker")(recoverTaskClaimAcquisitions(runId)),
    collect("Git")(recoverTaskWorktreeReconciliations(runId)),
    collect("TaskRunner")(recoverTaskWorkSessionEstablishments(runId)),
    collect("TaskExecutor")(recoverTaskExecutions(runId)),
    collect("Evidence")(recoverImplementationEvidenceSealings(runId)),
    collect("Reviewer")(recoverImplementationReviews(runId)),
    collect("Reviewer")(recoverReviewFindingsHandbacks(runId))
  ], { concurrency: 1 })).flat()
})
