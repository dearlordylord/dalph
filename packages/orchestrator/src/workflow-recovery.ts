/* eslint-disable functional/immutable-data, max-lines -- Recovery keeps startup ordering and authority checks together. */
import { Effect, Match, Result, Schema } from "effect"
import { CoordinatorLockObservationContradiction, CoordinatorOwnershipLost } from "./coordinator-lock.js"
import { defaultTaskWorkCapacity, RunId, type TaskWorkCapacity } from "./domain.js"
import { GitWorktree } from "./git-worktree.js"
import { authorizeImplementationReview, EvidenceStore } from "./implementation-evidence.js"
import { authorizeImplementationReviewEvidence } from "./implementation-review.js"
import { type JournalRecord, JournalStore } from "./journal-store.js"
import { activateRecoveredResponsibilities, type RecoveredAdmissionCapacityEvidence } from "./managed-activation.js"
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
import { recoverTrackerGraphObservations } from "./workflow-operation-recovery.js"
import {
  continuePlannedTaskAttemptStage,
  type MissingPlannedTaskAttemptOperationStage,
  RecoveryTaskEligibilityIssue,
  refreshPlannedAttemptEligibility
} from "./workflow-stage-recovery.js"
/** A valid history's fresh authority read could not determine a safe next step. */
export class RecoveryReconciliationIssue
  extends Schema.TaggedErrorClass<RecoveryReconciliationIssue>()("RecoveryReconciliationIssue", {
    authority: Schema.Literals(["Evidence", "Git", "Reviewer", "TaskExecutor", "TaskRunner", "Tracker"]),
    detail: Schema.String,
    runId: RunId
  })
{
}
/** Startup retained the run after coordinator ownership could not be refreshed. */
export class RecoveryOwnershipIssue
  extends Schema.TaggedErrorClass<RecoveryOwnershipIssue>()("RecoveryOwnershipIssue", {
    detail: Schema.String,
    runId: RunId
  })
{
}
/** A fresh authority fact contradicts the durable completed workflow fact. */
export class RecoveryAuthorityContradictionIssue
  extends Schema.TaggedErrorClass<RecoveryAuthorityContradictionIssue>()("RecoveryAuthorityContradictionIssue", {
    authority: RecoveryReconciliationIssue.fields.authority,
    detail: Schema.String,
    runId: RunId
  })
{
}
/** A legal nonterminal stage remained inert after its recovery operation returned. */
export class RecoveryProgressIssue extends Schema.TaggedErrorClass<RecoveryProgressIssue>()("RecoveryProgressIssue", {
  detail: Schema.String,
  runId: RunId,
  stage: NonterminalRecoveryStageTag
}) {
}
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

/** This durable event carries no external authority that startup must refresh. */
const ignoreAuthorityRefresh = () => undefined

export const classifyRecoveryIssue = (
  authority: RecoveryReconciliationIssue["authority"],
  runId: RunId,
  failure: unknown
): RecoveryAuthorityContradictionIssue | RecoveryOwnershipIssue | RecoveryReconciliationIssue =>
  failure instanceof CoordinatorOwnershipLost
    || failure instanceof CoordinatorLockObservationContradiction
    ? new RecoveryOwnershipIssue({ detail: String(failure), runId })
    : failure instanceof AuthorityObservationContradiction
    ? new RecoveryAuthorityContradictionIssue({ authority, detail: failure.detail, runId })
    : reconciliationIssue(authority, runId, failure)
const classifyStageContinuationFailure = (
  authority: RecoveryReconciliationIssue["authority"],
  runId: RunId,
  failure: unknown
):
  | RecoveryAuthorityContradictionIssue
  | RecoveryTaskEligibilityIssue
  | RecoveryOwnershipIssue
  | RecoveryReconciliationIssue =>
  failure instanceof RecoveryTaskEligibilityIssue
    ? failure
    : classifyRecoveryIssue(authority, runId, failure)
const missingPlannedTaskAttemptStages = (runId: RunId, records: ReadonlyArray<JournalRecord>) => {
  const reduction = reduceManagedHistory(runId, records)
  return reduction._tag === "InvalidManagedHistory"
    ? reduction
    : reduction.recoveryStage.entries.filter((stage): stage is MissingPlannedTaskAttemptOperationStage =>
      stage._tag === "TaskExecutionNeeded"
      || stage._tag === "TaskWorkSessionEstablishmentNeeded"
      || stage._tag === "TaskWorktreeReconciliationNeeded"
    )
}
/**
 * Selects and continues missing task-attempt work through the same production
 * recovery-stage reducer used after coordinator restart.
 */
export const continueMissingPlannedTaskAttemptStages = Effect.fn(
  "WorkflowRecovery.continueMissingPlannedTaskAttemptStages"
)(function*(runId: RunId, records: ReadonlyArray<JournalRecord>) {
  const selected = missingPlannedTaskAttemptStages(runId, records)
  if (!Array.isArray(selected)) {
    return selected.issues
  }
  for (const stage of selected) {
    const result = yield* Effect.result(continuePlannedTaskAttemptStage(runId, records, stage))
    if (Result.isFailure(result)) {
      return [classifyStageContinuationFailure(stage.authority, runId, result.failure)]
    }
  }
  return []
})
const collectRefreshIssue =
  (authority: RecoveryReconciliationIssue["authority"], runId: RunId) => <A, E, R>(refresh: Effect.Effect<A, E, R>) =>
    Effect.result(refresh).pipe(
      Effect.map((
        result
      ): ReadonlyArray<RecoveryAuthorityContradictionIssue | RecoveryOwnershipIssue | RecoveryReconciliationIssue> =>
        Result.isFailure(result) ? [classifyRecoveryIssue(authority, runId, result.failure)] : []
      )
    )
class AuthorityObservationContradiction {
  readonly _tag = "AuthorityObservationContradiction"
  constructor(readonly detail: string) {}
}
const contradict = (detail: string): Effect.Effect<never, AuthorityObservationContradiction> =>
  Effect.fail(new AuthorityObservationContradiction(detail))
/**
 * Refreshes every authority represented by decoded history using read-only
 * adapter methods. This is safe even for an invalid history: it never appends
 * records, creates resources, starts work, invokes reviewers, or delivers findings.
 */
export const observeManagedRunAuthorities = Effect.fn("WorkflowRecovery.observeManagedRunAuthorities")(
  function*(runId: RunId, records: ReadonlyArray<JournalRecord>) {
    return (yield* observeManagedRunAuthoritiesWithCapacityEvidence(
      runId,
      records
    )).issues
  }
)

/**
 * Refreshes external authority and retains the exact unresolved-execution
 * observations that also determine reconstructed admission usage.
 */
export const observeManagedRunAuthoritiesWithCapacityEvidence = Effect.fn(
  "WorkflowRecovery.observeManagedRunAuthoritiesWithCapacityEvidence"
)(
  function*(runId: RunId, records: ReadonlyArray<JournalRecord>) {
    const graph = yield* TrackerGraphReader
    const tracker = yield* TrackerMutation
    const git = yield* GitWorktree
    const runner = yield* TaskRunner
    const executor = yield* TaskExecutor
    const evidence = yield* EvidenceStore
    const collect = (authority: RecoveryReconciliationIssue["authority"]) => collectRefreshIssue(authority, runId)
    const checks = new Array<
      Effect.Effect<
        ReadonlyArray<RecoveryAuthorityContradictionIssue | RecoveryOwnershipIssue | RecoveryReconciliationIssue>
      >
    >()
    const freshOccupiedInvocations = new Array<RecoveredAdmissionCapacityEvidence["freshOccupiedInvocations"][number]>()
    const freshlyReleasedOperationIds = new Set<
      RecoveredAdmissionCapacityEvidence["freshlyReleasedOperationIds"] extends ReadonlySet<infer Item> ? Item : never
    >()
    for (const { event } of records) {
      Match.valueTags(event, {
        TrackerGraphObservationIntentRecorded: event => {
          checks.push(collect("Tracker")(graph.read(event.operation.target)))
          return
        },
        TaskClaimAcquisitionIntended: event => {
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
                    : contradict(
                      `task claim changed for completed operation ${event.operation.acquisition.operationId}`
                    )
                )
              )
            )
          )
          return
        },
        TaskWorktreeReconciliationIntended: event => {
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
          return
        },
        TaskWorkSessionEstablishmentIntentRecorded: event => {
          const durable = records.find(({ event: candidate }) =>
            candidate._tag === "TaskWorkSessionEstablished"
            && candidate.outcome.operationId === event.operation.request.operationId
          )?.event
          checks.push(
            collect("TaskRunner")(
              runner.lookupTaskWorkSession({
                operationId: event.operation.request.operationId,
                plannedAttempt: event.operation.request.plannedAttempt
              }).pipe(Effect.flatMap((observed) =>
                durable?._tag !== "TaskWorkSessionEstablished"
                  || sessionAuthorityMatches(observed, durable.outcome.sessionId)
                  ? Effect.void
                  : contradict(
                    `task-work session changed for completed operation ${event.operation.request.operationId}`
                  )
              ))
            )
          )
          return
        },
        TaskExecutionIntentRecorded: event => {
          const session = event.operation.request.session
          if (session._tag !== "EstablishedSession") {
            return
          }
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
              }).pipe(Effect.flatMap((observed) => {
                if (durable?._tag !== "TaskExecutionOutcomeObserved") {
                  if (observed._tag === "RunningTaskExecutionReported") {
                    freshOccupiedInvocations.push({
                      observationId: observed.observationId,
                      operationId: event.operation.request.operationId,
                      taskId: event.operation.request.plannedAttempt.taskId
                    })
                  } else if (observed._tag === "NoTaskExecutionReported") {
                    freshlyReleasedOperationIds.add(
                      event.operation.request.operationId
                    )
                  }
                  return Effect.void
                }
                return executionAuthorityMatches(observed, durable.outcome.outcome)
                  ? Effect.void
                  : contradict(
                    `task execution changed for completed operation ${event.operation.request.operationId}`
                  )
              }))
            )
          )
          return
        },
        ImplementationEvidenceSealed: event => {
          checks.push(
            collect("Evidence")(
              authorizeImplementationReview(event.sealed).pipe(Effect.provideService(EvidenceStore, evidence))
            )
          )
          return
        },
        ImplementationReviewCompleted: event => {
          checks.push(
            collect("Reviewer")(
              authorizeImplementationReviewEvidence(event.review).pipe(Effect.provideService(EvidenceStore, evidence))
            )
          )
          return
        },
        ReviewFindingsHandbackCompleted: event => {
          checks.push(collect("Reviewer")(evidence.read(event.acknowledgement.reviewEvidenceReference)))
          return
        },
        ImplementationConvergenceDispositionRecorded: event => {
          {
            const request = event.operation.request
            if (request._tag === "SimulatedImplementationConvergenceDisposition") {
              return
            }
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
            return
          }
        },
        ImplementationEvidenceSealingIntended: ignoreAuthorityRefresh,
        ImplementationReviewIntended: ignoreAuthorityRefresh,
        ReviewFindingsHandbackIntended: ignoreAuthorityRefresh,
        TrackerGraphOutcomeObserved: ignoreAuthorityRefresh,
        TaskWorktreeReady: ignoreAuthorityRefresh,
        TaskClaimAcquired: ignoreAuthorityRefresh,
        TaskWorkSessionEstablished: ignoreAuthorityRefresh,
        TaskExecutionOutcomeObserved: ignoreAuthorityRefresh,
        TaskAttemptPlanned: ignoreAuthorityRefresh,
        TaskWorkStartRequested: ignoreAuthorityRefresh,
        TaskWorkSessionLookupRequested: ignoreAuthorityRefresh,
        TaskWorkStartRequestAcknowledged: ignoreAuthorityRefresh,
        TaskWorkStartRequestFailed: ignoreAuthorityRefresh,
        TaskWorkSessionLookupFailed: ignoreAuthorityRefresh,
        TaskWorkSessionReported: ignoreAuthorityRefresh,
        TaskWorkSessionResultReported: ignoreAuthorityRefresh,
        TaskExecutionRequestAttemptRecorded: ignoreAuthorityRefresh,
        TaskExecutionRequestReturned: ignoreAuthorityRefresh,
        TaskExecutionRequestFailed: ignoreAuthorityRefresh,
        TaskExecutionObservationFailed: ignoreAuthorityRefresh,
        TaskExecutionReported: ignoreAuthorityRefresh,
        TechnicalRetryPolicyCaptured: ignoreAuthorityRefresh,
        TechnicalRetryScheduled: ignoreAuthorityRefresh,
        TechnicalRetryDeferralSuperseded: ignoreAuthorityRefresh
      })
    }
    const issues = (yield* Effect.all(checks, { concurrency: 1 })).flat()
    return {
      capacityEvidence: {
        freshOccupiedInvocations,
        freshlyReleasedOperationIds
      },
      issues
    } satisfies {
      readonly capacityEvidence: RecoveredAdmissionCapacityEvidence
      readonly issues: ReadonlyArray<
        | RecoveryAuthorityContradictionIssue
        | RecoveryOwnershipIssue
        | RecoveryReconciliationIssue
      >
    }
  }
)

/** Checks that the next attempt continuation has the causal eligibility lineage it needs. */
export const validateManagedRunContinuation = Effect.fn(
  "WorkflowRecovery.validateManagedRunContinuation"
)(function*(runId: RunId, records: ReadonlyArray<JournalRecord>) {
  const reduction = reduceManagedHistory(runId, records)
  if (reduction._tag === "InvalidManagedHistory") return reduction.issues
  const stages = reduction.recoveryStage.entries.filter((candidate) =>
    candidate._tag === "TaskWorktreeReconciliationNeeded"
    || candidate._tag === "TaskWorkSessionEstablishmentNeeded"
    || candidate._tag === "TaskExecutionNeeded"
    || candidate._tag === "ImplementationConvergencePending"
  )
  return (yield* Effect.forEach(
    stages,
    (stage) =>
      Effect.result(
        refreshPlannedAttemptEligibility(runId, records, stage.planOperation)
      ).pipe(
        Effect.map((eligibility) =>
          Result.isFailure(eligibility)
            ? [classifyStageContinuationFailure(
              "Tracker",
              runId,
              eligibility.failure
            )]
            : []
        )
      ),
    { concurrency: 1 }
  )).flat()
})
/** Validates history before refreshing every current external authority. */
export const recoverExactRunAfterCoordinatorDeath = Effect.fn("WorkflowRecovery.recoverExactRunAfterCoordinatorDeath")(
  function*(
    runId: RunId,
    discoveredRecords?: ReadonlyArray<JournalRecord>,
    capacity: TaskWorkCapacity = defaultTaskWorkCapacity,
    capacityEvidence?: RecoveredAdmissionCapacityEvidence
  ) {
    const journal = yield* JournalStore
    const initialReduction = reduceManagedHistory(runId, discoveredRecords ?? (yield* journal.read(runId)))
    if (initialReduction._tag === "InvalidManagedHistory") {
      return initialReduction.issues
    }
    const collect = (authority: RecoveryReconciliationIssue["authority"]) => collectRefreshIssue(authority, runId)
    const before = yield* journal.read(runId)
    for (const stage of initialReduction.recoveryStage.entries) {
      if (stage._tag !== "ImplementationConvergencePending") {
        continue
      }
      const eligibility = yield* Effect.result(refreshPlannedAttemptEligibility(runId, before, stage.planOperation))
      if (Result.isFailure(eligibility)) {
        return [classifyStageContinuationFailure("Tracker", runId, eligibility.failure)]
      }
    }
    const phases = [
      collect("Tracker")(recoverTrackerGraphObservations(runId)),
      collect("TaskExecutor")(
        activateRecoveredResponsibilities(
          runId,
          capacity,
          capacityEvidence
        )
      )
    ] as const
    for (const phase of phases) {
      const issues = yield* phase
      if (issues.length > 0) {
        return issues
      }
    }
    const afterPhases = yield* journal.read(runId)
    if (afterPhases.length > before.length) {
      return []
    }
    const selected = missingPlannedTaskAttemptStages(runId, afterPhases)
    if (!Array.isArray(selected)) {
      return selected.issues
    }
    const continuationIssues = yield* continueMissingPlannedTaskAttemptStages(runId, afterPhases)
    if (continuationIssues.length > 0) {
      return continuationIssues
    }
    const continuedStage = selected[0]
    if (continuedStage !== undefined) {
      const afterContinuation = yield* journal.read(runId)
      if (afterContinuation.length > afterPhases.length) {
        return []
      }
      return [
        new RecoveryProgressIssue({
          detail: "the selected next operation returned without recording a durable fact",
          runId,
          stage: continuedStage._tag
        })
      ]
    }
    const reduction = reduceManagedHistory(runId, afterPhases)
    if (reduction._tag === "InvalidManagedHistory") {
      return reduction.issues
    }
    const nonterminal = reduction.recoveryStage.entries.find((stage) => stage._tag !== "Terminal")
    if (nonterminal === undefined) {
      return []
    }
    return [
      new RecoveryProgressIssue({
        detail: "recovery returned without advancing this legal nonterminal durable stage",
        runId,
        stage: nonterminal._tag
      })
    ]
  }
)
export {
  recoverImplementationEvidenceSealings,
  recoverImplementationReviews,
  recoverReviewFindingsHandbacks,
  recoverTaskClaimAcquisitions,
  recoverTaskExecutions,
  recoverTaskWorkSessionEstablishments,
  recoverTaskWorktreeReconciliations
} from "./workflow-operation-recovery.js"
