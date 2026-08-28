import { Context, type Effect, Schema } from "effect"
import { PlannedTaskAttempt, plannedTaskAttemptEquivalence, TaskId, TaskRevision } from "@dalph/contracts"
import {
  ActiveTaskClaim,
  isExactTaskClaim,
  TaskClaimRelease,
  type TrackerMutationService,
  UnclaimedTask
} from "../../../authorities/task-tracker/claim-mutation.js"
import { TrackerRevision } from "../../../authorities/task-tracker/task.js"
import { TrackerTarget } from "../../../authorities/task-tracker/target.js"
import { JournalPosition } from "../../../workflow-journal/identity.js"
import { OperationId } from "../../identity.js"
import type { TaskTrackerMutationThrottled } from "../../../authorities/task-tracker/mutation-throttling.js"
import {
  TargetPromotionCorrelation,
  targetPromotionCorrelationEquals,
  targetPromotionPlannedAttemptOf
} from "../target-promotion/events.js"

/** A temporary tracker record that binds task completion to one promoted Integrator candidate. */
export const CompletionTaskClaim = Schema.TaggedStruct("CompletionTaskClaim", {
  originalClaim: ActiveTaskClaim,
  plannedAttempt: PlannedTaskAttempt,
  promotionCorrelation: TargetPromotionCorrelation
}).check(
  Schema.makeFilter((claim) => {
    const promotionAttempt = targetPromotionPlannedAttemptOf(claim.promotionCorrelation)
    const promotionAttemptMatches = plannedTaskAttemptEquivalence(promotionAttempt, claim.plannedAttempt)
    return claim.originalClaim.taskId === claim.plannedAttempt.taskId &&
      promotionAttempt.attemptId === claim.plannedAttempt.attemptId &&
      promotionAttempt.runId === claim.plannedAttempt.runId &&
      promotionAttemptMatches
      ? undefined
      : "completion claim must bind its original claim, planned attempt, and promotion to one task attempt"
  })
)
export type CompletionTaskClaim = typeof CompletionTaskClaim.Type

/** Compares every field of one exact temporary completion claim. */
export const completionTaskClaimEquals = (left: CompletionTaskClaim, right: CompletionTaskClaim): boolean =>
  [
    isExactTaskClaim(left.originalClaim, right.originalClaim),
    plannedTaskAttemptEquivalence(left.plannedAttempt, right.plannedAttempt),
    targetPromotionCorrelationEquals(left.promotionCorrelation, right.promotionCorrelation)
  ].every(Boolean)

/** SHA-256 identity of one canonical encoded completion claim, never a reconstructed claim by itself. */
export const CompletionClaimFingerprint = Schema.String.check(
  Schema.makeFilter((value) =>
    /^[0-9a-f]{64}$/.test(value) ? undefined : "completion claim fingerprint must be SHA-256 hex"
  )
).pipe(Schema.brand("CompletionClaimFingerprint"))
export type CompletionClaimFingerprint = typeof CompletionClaimFingerprint.Type

/** A provider record exists for this task but identifies another exact completion claim. */
export const ForeignCompletionClaim = Schema.TaggedStruct("ForeignCompletionClaim", {
  fingerprint: CompletionClaimFingerprint,
  taskId: TaskId
})
export type ForeignCompletionClaim = typeof ForeignCompletionClaim.Type

/** The exact provider-neutral read request carries the task and claim whose evidence must be checked. */
export const CompletionClaimReadRequest = Schema.Struct({ expectedClaim: CompletionTaskClaim, taskId: TaskId }).check(
  Schema.makeFilter((request) =>
    request.taskId === request.expectedClaim.plannedAttempt.taskId
      ? undefined
      : "completion claim read must bind the expected claim's exact task"
  )
)
export type CompletionClaimReadRequest = typeof CompletionClaimReadRequest.Type

/** Derives the one exact read request used before create, after ambiguity, and during cleanup. */
export const completionClaimReadRequestFor = (expectedClaim: CompletionTaskClaim): CompletionClaimReadRequest =>
  CompletionClaimReadRequest.make({ expectedClaim, taskId: expectedClaim.plannedAttempt.taskId })

/** The exact provider-neutral replacement request, including the operation identity. */
export const CompletionClaimReplacementRequest = Schema.Struct({ claim: CompletionTaskClaim, operationId: OperationId })
export type CompletionClaimReplacementRequest = typeof CompletionClaimReplacementRequest.Type

/** A focused task-local success read; it is intentionally not complete graph coverage. */
export const FocusedCompletedTaskObservation = Schema.TaggedStruct("FocusedCompletedTaskObservation", {
  claim: CompletionTaskClaim,
  lifecycle: Schema.Literal("CompletedSuccessfully"),
  observedAt: JournalPosition,
  operationId: OperationId,
  taskId: TaskId,
  taskRevision: TaskRevision,
  trackerRevision: TrackerRevision,
  target: TrackerTarget
}).check(
  Schema.makeFilter((observation) =>
    observation.taskId === observation.claim.plannedAttempt.taskId &&
    observation.taskRevision === observation.claim.plannedAttempt.taskRevision
      ? undefined
      : "focused completion observation must bind the claimed task and task revision"
  )
)
export type FocusedCompletedTaskObservation = typeof FocusedCompletedTaskObservation.Type

/** Only a task-local focused success can authorize completion-claim cleanup. */
export const CompletionSuccessObservation = FocusedCompletedTaskObservation
export type CompletionSuccessObservation = typeof CompletionSuccessObservation.Type

/** The exact provider-neutral deletion request, authorized by one fresh success read. */
export const CompletionClaimDeletionRequest = Schema.Struct({
  claim: CompletionTaskClaim,
  operationId: OperationId,
  successObservation: CompletionSuccessObservation
}).check(
  Schema.makeFilter((request) =>
    completionTaskClaimEquals(request.claim, request.successObservation.claim)
      ? undefined
      : "completion claim deletion success proof must bind the exact claimed task attempt"
  )
)
export type CompletionClaimDeletionRequest = typeof CompletionClaimDeletionRequest.Type

/** Stable operation identity for deleting the exact original active record after task success. */
export const completionOriginalTaskClaimReleaseOperationIdFor = (claim: CompletionTaskClaim): OperationId =>
  OperationId.make(`completion-original-claim-release:${claim.promotionCorrelation.requestId}`)

/** Derives the generic exact-claim release nested inside completion cleanup. */
export const completionOriginalTaskClaimReleaseFor = (claim: CompletionTaskClaim): TaskClaimRelease =>
  TaskClaimRelease.make({
    claim: claim.originalClaim,
    operationId: completionOriginalTaskClaimReleaseOperationIdFor(claim)
  })

/** Current provider evidence can be active, exact completion, foreign completion, or absent. */
export const CompletionClaimObservation = Schema.Union([
  ActiveTaskClaim,
  CompletionTaskClaim,
  ForeignCompletionClaim,
  UnclaimedTask
])
export type CompletionClaimObservation = typeof CompletionClaimObservation.Type

/** Proves only that the task's distinct completion-marker record is currently absent. */
export const CompletionClaimMarkerAbsent = Schema.TaggedStruct("CompletionClaimMarkerAbsent", { taskId: TaskId })
export type CompletionClaimMarkerAbsent = typeof CompletionClaimMarkerAbsent.Type

/** Current provider evidence for the completion marker alone, independent of any active claim record. */
export const CompletionClaimMarkerObservation = Schema.Union([
  CompletionTaskClaim,
  ForeignCompletionClaim,
  CompletionClaimMarkerAbsent
])
export type CompletionClaimMarkerObservation = typeof CompletionClaimMarkerObservation.Type

/** One cleanup read, preserving whether absence applies to the active record or completion marker. */
export const CompletionClaimCleanupObservation = Schema.Union([CompletionClaimObservation, CompletionClaimMarkerAbsent])
export type CompletionClaimCleanupObservation = typeof CompletionClaimCleanupObservation.Type

const CompletionClaimRequestOutcome = Schema.Literals(["DefinitelyNotApplied", "Unknown"])
export type CompletionClaimRequestOutcome = typeof CompletionClaimRequestOutcome.Type

/** The task tracker could not return a complete current claim record. */
export class CompletionClaimReadFailure extends Schema.TaggedError<CompletionClaimReadFailure>()(
  "IntegrationFinality.CompletionClaimReadFailure",
  { detail: Schema.String, taskId: TaskId }
) {}

/** A replacement request failed; Unknown requires a fresh claim read before retry. */
export class CompletionClaimReplacementFailure extends Schema.TaggedError<CompletionClaimReplacementFailure>()(
  "IntegrationFinality.CompletionClaimReplacementFailure",
  { detail: Schema.String, outcome: CompletionClaimRequestOutcome, request: CompletionClaimReplacementRequest }
) {}

/** A deletion request failed; Unknown requires a fresh claim read before retry. */
export class CompletionClaimDeletionFailure extends Schema.TaggedError<CompletionClaimDeletionFailure>()(
  "IntegrationFinality.CompletionClaimDeletionFailure",
  { detail: Schema.String, outcome: CompletionClaimRequestOutcome, request: CompletionClaimDeletionRequest }
) {}

/** A fresh read found a claim other than the exact claim Dalph is authorized to change. */
export class CompletionClaimOwnershipConflict extends Schema.TaggedError<CompletionClaimOwnershipConflict>()(
  "IntegrationFinality.CompletionClaimOwnershipConflict",
  { attempted: CompletionTaskClaim, observed: CompletionClaimCleanupObservation }
) {}

/** Provider-neutral tracker boundary used by replacement and cleanup protocols. */
export interface CompletionClaimBoundaryService {
  /** Reads the original active record independently of the coexisting completion marker. */
  readonly readOriginalTaskClaim: TrackerMutationService["readTaskClaim"]
  readonly readTaskClaim: (
    request: CompletionClaimReadRequest
  ) => Effect.Effect<CompletionClaimObservation, CompletionClaimReadFailure>
  /** Reads only the completion marker so cleanup can prove it before rereading the active record. */
  readonly readCompletionClaimMarker: (
    request: CompletionClaimReadRequest
  ) => Effect.Effect<CompletionClaimMarkerObservation, CompletionClaimReadFailure>
  readonly replaceTaskClaim: (
    request: CompletionClaimReplacementRequest
  ) => Effect.Effect<CompletionTaskClaim, CompletionClaimReplacementFailure | TaskTrackerMutationThrottled>
  readonly deleteTaskClaim: (
    request: CompletionClaimDeletionRequest
  ) => Effect.Effect<void, CompletionClaimDeletionFailure | TaskTrackerMutationThrottled>
  /** Deletes only the exact original active record through the generic claim-release boundary. */
  readonly releaseOriginalTaskClaim: TrackerMutationService["releaseTaskClaim"]
}

/** The ordinary Effect service for the task-tracker completion-claim boundary. */
export class CompletionClaimBoundary extends Context.Service<CompletionClaimBoundary, CompletionClaimBoundaryService>()(
  "@dalph/CompletionClaimBoundary"
) {}
