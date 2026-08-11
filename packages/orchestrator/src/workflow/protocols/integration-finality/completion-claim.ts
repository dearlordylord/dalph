import { Context, type Effect, Schema } from "effect"
import {
  evidenceReferenceEquals,
  PlannedTaskAttempt,
  plannedTaskAttemptEquivalence,
  TaskId,
  TaskRevision
} from "@dalph/contracts"
import { ActiveTaskClaim, isExactTaskClaim, UnclaimedTask } from "../../../authorities/task-tracker/claim-mutation.js"
import { TrackerRevision } from "../../../authorities/task-tracker/task.js"
import { TrackerTarget } from "../../../authorities/task-tracker/target.js"
import { JournalPosition } from "../../../workflow-journal/identity.js"
import { OperationId } from "../../identity.js"
import { TargetPromotionCorrelation, targetPromotionCorrelationEquals } from "../target-promotion/events.js"
import { EvidenceReference } from "../target-verification/evidence-store.js"

/** A temporary tracker record that binds task completion to one promoted attempt. */
export const CompletionTaskClaim = Schema.TaggedStruct("CompletionTaskClaim", {
  /** The immutable accepted-result evidence sealed before integration. */
  acceptanceManifest: EvidenceReference,
  /** The immutable passing integration-review evidence sealed for the candidate. */
  integrationReviewManifest: EvidenceReference,
  originalClaim: ActiveTaskClaim,
  plannedAttempt: PlannedTaskAttempt,
  promotionCorrelation: TargetPromotionCorrelation,
  /** The exact sealed target-verification evidence carried by promotion. */
  verificationManifest: EvidenceReference
}).check(
  Schema.makeFilter((claim) => {
    const promotionAttempt = claim.promotionCorrelation.candidateCorrelation.attemptId
    const promotionRun = claim.promotionCorrelation.candidateCorrelation.runId
    const evidenceMatchesPromotion =
      evidenceReferenceEquals(claim.acceptanceManifest, claim.promotionCorrelation.acceptanceManifest) &&
      evidenceReferenceEquals(claim.integrationReviewManifest, claim.promotionCorrelation.reviewManifest) &&
      evidenceReferenceEquals(claim.verificationManifest, claim.promotionCorrelation.verificationManifest)
    return claim.originalClaim.taskId === claim.plannedAttempt.taskId &&
      promotionAttempt === claim.plannedAttempt.attemptId &&
      promotionRun === claim.plannedAttempt.runId &&
      evidenceMatchesPromotion
      ? undefined
      : "completion claim must bind its original claim, planned attempt, promotion, and evidence to one task attempt"
  })
)
export type CompletionTaskClaim = typeof CompletionTaskClaim.Type

/** Compares every field of one exact temporary completion claim. */
export const completionTaskClaimEquals = (left: CompletionTaskClaim, right: CompletionTaskClaim): boolean =>
  [
    evidenceReferenceEquals(left.acceptanceManifest, right.acceptanceManifest),
    evidenceReferenceEquals(left.integrationReviewManifest, right.integrationReviewManifest),
    isExactTaskClaim(left.originalClaim, right.originalClaim),
    plannedTaskAttemptEquivalence(left.plannedAttempt, right.plannedAttempt),
    targetPromotionCorrelationEquals(left.promotionCorrelation, right.promotionCorrelation),
    evidenceReferenceEquals(left.verificationManifest, right.verificationManifest)
  ].every(Boolean)

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

/** A current task claim can be active, completion-bound, or absent. */
export const CompletionClaimObservation = Schema.Union([ActiveTaskClaim, CompletionTaskClaim, UnclaimedTask])
export type CompletionClaimObservation = typeof CompletionClaimObservation.Type

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
  { attempted: CompletionTaskClaim, observed: CompletionClaimObservation }
) {}

/** Provider-neutral tracker boundary used by replacement and cleanup protocols. */
export interface CompletionClaimBoundaryService {
  readonly readTaskClaim: (taskId: TaskId) => Effect.Effect<CompletionClaimObservation, CompletionClaimReadFailure>
  readonly replaceTaskClaim: (
    request: CompletionClaimReplacementRequest
  ) => Effect.Effect<CompletionTaskClaim, CompletionClaimReplacementFailure>
  readonly deleteTaskClaim: (
    request: CompletionClaimDeletionRequest
  ) => Effect.Effect<void, CompletionClaimDeletionFailure>
}

/** The ordinary Effect service for the task-tracker completion-claim boundary. */
export class CompletionClaimBoundary extends Context.Service<CompletionClaimBoundary, CompletionClaimBoundaryService>()(
  "@dalph/CompletionClaimBoundary"
) {}
