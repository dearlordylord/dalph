/* eslint-disable functional/immutable-data -- Recovery keeps startup ordering and authority checks together. */
import { Effect, Result, Schema } from "effect"
import { CoordinatorLockObservationContradiction, CoordinatorOwnershipLost } from "./coordinator-lock.js"
import { RunId } from "./domain.js"
import { GitWorktree } from "./git-worktree.js"
import { recoverImplementationConvergences } from "./implementation-convergence-recovery.js"
import { authorizeImplementationReview, EvidenceStore } from "./implementation-evidence.js"
import { authorizeImplementationReviewEvidence } from "./implementation-review.js"
import { type JournalRecord, JournalStore } from "./journal-store.js"
import { reduceManagedHistory } from "./managed-history.js"
import { NonterminalRecoveryStageTag } from "./managed-run-recovery-stage.js"
import { TaskExecutor } from "./task-execution.js"
import { TaskRunner } from "./task-work-start.js"
import { TrackerGraphReader } from "./tracker-graph-reader.js"
import { TrackerMutation } from "./tracker-mutation.js"
import {
  claimAuthorityMatches,
  executionAuthorityMatches,
  sessionAuthorityMatches,
  worktreeAuthorityMatches
} from "./workflow-authority-relations.js"
import {
  recoverImplementationEvidenceSealings,
  recoverTaskClaimAcquisitions,
  recoverTaskExecutions,
  recoverTaskWorkSessionEstablishments,
  recoverTaskWorktreeReconciliations,
  recoverTrackerGraphObservations
} from "./workflow-operation-recovery.js"
import {
  continuePlannedTaskAttemptStage,
  type MissingPlannedTaskAttemptOperationStage,
  RecoveryTaskEligibilityIssue,
  refreshPlannedAttemptEligibility
} from "./workflow-stage-recovery.js"

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

/** A legal nonterminal stage remained inert after its recovery operation returned. */
export class RecoveryProgressIssue extends Schema.TaggedErrorClass<RecoveryProgressIssue>()(
  "RecoveryProgressIssue",
  {
    detail: Schema.String,
    runId: RunId,
    stage: NonterminalRecoveryStageTag
  }
) {}

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

const classifyStageContinuationFailure = (
  authority: RecoveryReconciliationIssue["authority"],
  runId: RunId,
  failure: unknown
): RecoveryTaskEligibilityIssue | RecoveryOwnershipIssue | RecoveryReconciliationIssue =>
  failure instanceof RecoveryTaskEligibilityIssue
    ? failure
    : classifyRecoveryIssue(authority, runId, failure)

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
      case "ImplementationConvergenceDispositionRecorded": {
        const request = event.operation.request
        if (request._tag === "SimulatedImplementationConvergenceDisposition") break
        const disposition = request.disposition
        const review = disposition._tag === "Accepted"
            || disposition._tag === "ImplementationNonConvergent"
          ? disposition.review
          : disposition._tag === "HandbackTechnicalRetryExhausted"
          ? disposition.request.review
          : disposition._tag === "ResourceEmergency"
              || disposition._tag === "ImplementationExecutionFailed"
              || disposition._tag === "ImplementationExecutionInterrupted"
          ? disposition.priorEvidence._tag === "PriorReviewEvidence"
            ? disposition.priorEvidence.review
            : undefined
          : undefined
        if (review !== undefined) {
          checks.push(
            collect("Reviewer")(
              authorizeImplementationReviewEvidence(review).pipe(Effect.provideService(EvidenceStore, evidence))
            )
          )
        }
        if (disposition._tag === "ReviewTechnicalRetryExhausted") {
          checks.push(
            collect("Evidence")(
              authorizeImplementationReview(disposition.request.implementationEvidence).pipe(
                Effect.provideService(EvidenceStore, evidence)
              )
            )
          )
        }
        break
      }
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
  const initialReduction = reduceManagedHistory(
    runId,
    discoveredRecords ?? (yield* journal.read(runId))
  )
  if (initialReduction._tag === "InvalidManagedHistory") return initialReduction.issues

  const collect = (authority: RecoveryReconciliationIssue["authority"]) => collectRefreshIssue(authority, runId)
  const before = yield* journal.read(runId)
  for (const stage of initialReduction.recoveryStage.attempts) {
    if (stage._tag !== "ImplementationConvergencePending") continue
    const eligibility = yield* Effect.result(
      refreshPlannedAttemptEligibility(runId, before, stage.planOperation)
    )
    if (Result.isFailure(eligibility)) {
      return [classifyStageContinuationFailure("Tracker", runId, eligibility.failure)]
    }
  }
  const phases = [
    collect("Tracker")(recoverTrackerGraphObservations(runId)),
    collect("Tracker")(recoverTaskClaimAcquisitions(runId)),
    collect("Git")(recoverTaskWorktreeReconciliations(runId)),
    collect("TaskRunner")(recoverTaskWorkSessionEstablishments(runId)),
    collect("TaskExecutor")(recoverTaskExecutions(runId)),
    collect("Evidence")(recoverImplementationEvidenceSealings(runId)),
    collect("Reviewer")(recoverImplementationConvergences(runId))
  ] as const
  for (const phase of phases) {
    const issues = yield* phase
    if (issues.length > 0) return issues
  }

  const afterPhases = yield* journal.read(runId)
  if (afterPhases.length > before.length) return []
  const reduction = reduceManagedHistory(runId, afterPhases)
  if (reduction._tag === "InvalidManagedHistory") return reduction.issues
  const missingStages = reduction.recoveryStage.attempts.filter(
    (stage): stage is MissingPlannedTaskAttemptOperationStage =>
      stage._tag === "TaskExecutionNeeded"
      || stage._tag === "TaskWorkSessionEstablishmentNeeded"
      || stage._tag === "TaskWorktreeReconciliationNeeded"
  )
  for (const stage of missingStages) {
    const result = yield* Effect.result(
      continuePlannedTaskAttemptStage(runId, afterPhases, stage)
    )
    if (Result.isFailure(result)) {
      return [classifyStageContinuationFailure(stage.authority, runId, result.failure)]
    }
  }
  const continuedStage = missingStages[0]
  if (continuedStage !== undefined) {
    const afterContinuation = yield* journal.read(runId)
    if (afterContinuation.length > afterPhases.length) return []
    return [
      new RecoveryProgressIssue({
        detail: "the selected next operation returned without recording a durable fact",
        runId,
        stage: continuedStage._tag
      })
    ]
  }

  const nonterminal = reduction.recoveryStage.attempts.find((stage) => stage._tag !== "Terminal")
  if (nonterminal === undefined) return []
  return [
    new RecoveryProgressIssue({
      detail: "recovery returned without advancing this legal nonterminal durable stage",
      runId,
      stage: nonterminal._tag
    })
  ]
})

export {
  recoverImplementationEvidenceSealings,
  recoverImplementationReviews,
  recoverReviewFindingsHandbacks,
  recoverTaskClaimAcquisitions,
  recoverTaskExecutions,
  recoverTaskWorkSessionEstablishments,
  recoverTaskWorktreeReconciliations
} from "./workflow-operation-recovery.js"
