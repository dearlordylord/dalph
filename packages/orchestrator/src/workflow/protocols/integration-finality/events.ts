import { Context, Effect, Layer, Ref, Schema } from "effect"
import { PlannedTaskAttempt, TaskId } from "@dalph/contracts"
import { TrackerRevision } from "../../../authorities/task-tracker/task.js"
import { JournalPosition } from "../../../workflow-journal/identity.js"
import { OperationId } from "../../identity.js"
import { workflowJournalEventVersion } from "../../kernel/event.js"
import {
  ActiveTaskClaim,
  isExactTaskClaim,
  type TaskClaimObservation,
  UnclaimedTask
} from "../../../authorities/task-tracker/claim-mutation.js"
import { TargetPromotionCorrelation, targetPromotionCorrelationEquals } from "../target-promotion/events.js"

/** A temporary tracker record that binds task completion to one promoted attempt. */
export const CompletionTaskClaim = Schema.TaggedStruct("CompletionTaskClaim", {
  originalClaim: ActiveTaskClaim,
  plannedAttempt: PlannedTaskAttempt,
  promotionCorrelation: TargetPromotionCorrelation
}).check(
  Schema.makeFilter((claim) => {
    const promotionAttempt = claim.promotionCorrelation.candidateCorrelation.attemptId
    const promotionRun = claim.promotionCorrelation.candidateCorrelation.runId
    return claim.originalClaim.taskId === claim.plannedAttempt.taskId &&
      promotionAttempt === claim.plannedAttempt.attemptId &&
      promotionRun === claim.plannedAttempt.runId
      ? undefined
      : "completion claim must bind its original claim, planned attempt, and promotion to one task attempt"
  })
)
export type CompletionTaskClaim = typeof CompletionTaskClaim.Type

/** Compares every field of one exact temporary completion claim. */
export const completionTaskClaimEquals = (left: CompletionTaskClaim, right: CompletionTaskClaim): boolean =>
  [
    isExactTaskClaim(left.originalClaim, right.originalClaim),
    left.plannedAttempt.attemptId === right.plannedAttempt.attemptId,
    left.plannedAttempt.runId === right.plannedAttempt.runId,
    left.plannedAttempt.taskId === right.plannedAttempt.taskId,
    left.plannedAttempt.taskRevision === right.plannedAttempt.taskRevision,
    left.plannedAttempt.baseSha === right.plannedAttempt.baseSha,
    left.plannedAttempt.branch === right.plannedAttempt.branch,
    left.plannedAttempt.executor === right.plannedAttempt.executor,
    left.plannedAttempt.worktree === right.plannedAttempt.worktree,
    targetPromotionCorrelationEquals(left.promotionCorrelation, right.promotionCorrelation)
  ].every(Boolean)

/** The exact provider-neutral replacement request, including the operation identity. */
export const CompletionClaimReplacementRequest = Schema.Struct({ claim: CompletionTaskClaim, operationId: OperationId })
export type CompletionClaimReplacementRequest = typeof CompletionClaimReplacementRequest.Type

/** The small proof that a later complete tracker read reported this task successful. */
export const FreshCompletedTaskObservation = Schema.Struct({
  lifecycle: Schema.Literal("CompletedSuccessfully"),
  observedAt: JournalPosition,
  operationId: OperationId,
  taskId: TaskId,
  trackerRevision: TrackerRevision
})
export type FreshCompletedTaskObservation = typeof FreshCompletedTaskObservation.Type

/** The exact provider-neutral deletion request, authorized by one fresh success read. */
export const CompletionClaimDeletionRequest = Schema.Struct({
  claim: CompletionTaskClaim,
  operationId: OperationId,
  successObservation: FreshCompletedTaskObservation
}).check(
  Schema.makeFilter((request) =>
    request.claim.plannedAttempt.taskId === request.successObservation.taskId
      ? undefined
      : "completion claim deletion success proof must name the claimed task"
  )
)
export type CompletionClaimDeletionRequest = typeof CompletionClaimDeletionRequest.Type

/** A current task claim can be active, completion-bound, or absent. */
export const CompletionClaimObservation = Schema.Union([ActiveTaskClaim, CompletionTaskClaim, UnclaimedTask])
export type CompletionClaimObservation = typeof CompletionClaimObservation.Type

const CompletionClaimRequestOutcome = Schema.Literals(["DefinitelyNotApplied", "Unknown"])
export type CompletionClaimRequestOutcome = typeof CompletionClaimRequestOutcome.Type

/** The task tracker could not return a complete current claim record. */
export class CompletionClaimReadFailure extends Schema.TaggedErrorClass<CompletionClaimReadFailure>()(
  "IntegrationFinality.CompletionClaimReadFailure",
  { detail: Schema.String, taskId: TaskId }
) {}

/** A replacement request failed; Unknown requires a fresh claim read before retry. */
export class CompletionClaimReplacementFailure extends Schema.TaggedErrorClass<CompletionClaimReplacementFailure>()(
  "IntegrationFinality.CompletionClaimReplacementFailure",
  { detail: Schema.String, outcome: CompletionClaimRequestOutcome, request: CompletionClaimReplacementRequest }
) {}

/** A deletion request failed; Unknown requires a fresh claim read before retry. */
export class CompletionClaimDeletionFailure extends Schema.TaggedErrorClass<CompletionClaimDeletionFailure>()(
  "IntegrationFinality.CompletionClaimDeletionFailure",
  { detail: Schema.String, outcome: CompletionClaimRequestOutcome, request: CompletionClaimDeletionRequest }
) {}

/** A fresh read found a claim other than the exact claim Dalph is authorized to change. */
export class CompletionClaimOwnershipConflict extends Schema.TaggedErrorClass<CompletionClaimOwnershipConflict>()(
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

/** Positive ordinal for one bounded replacement or deletion request. */
export const CompletionClaimRequestOrdinal = Schema.Int.check(Schema.isGreaterThan(0)).pipe(
  Schema.brand("CompletionClaimRequestOrdinal")
)
export type CompletionClaimRequestOrdinal = typeof CompletionClaimRequestOrdinal.Type

/** The fixed request bound for each completion-claim mutation. */
export const completionClaimRequestLimit = 3 as const // eslint-disable-line no-magic-numbers
export const CompletionClaimRequestLimit = Schema.Literal(completionClaimRequestLimit)
export type CompletionClaimRequestLimit = typeof CompletionClaimRequestLimit.Type

/** Records intent before the first request to replace the exact active claim. */
export const CompletionClaimReplacementIntendedEvent = Schema.TaggedStruct("CompletionClaimReplacementIntended", {
  claim: CompletionTaskClaim,
  operationId: OperationId,
  version: Schema.Literal(workflowJournalEventVersion)
})
export type CompletionClaimReplacementIntendedEvent = typeof CompletionClaimReplacementIntendedEvent.Type

/** Records intent before one numbered replacement request. */
export const CompletionClaimReplacementAttemptIntendedEvent = Schema.TaggedStruct(
  "CompletionClaimReplacementAttemptIntended",
  {
    attemptOrdinal: CompletionClaimRequestOrdinal,
    claim: CompletionTaskClaim,
    operationId: OperationId,
    version: Schema.Literal(workflowJournalEventVersion)
  }
)
export type CompletionClaimReplacementAttemptIntendedEvent = typeof CompletionClaimReplacementAttemptIntendedEvent.Type

/** The replacement response or a later fresh read proved the exact completion claim current. */
export const CompletionClaimReplacedEvent = Schema.TaggedStruct("CompletionClaimReplaced", {
  claim: CompletionTaskClaim,
  operationId: OperationId,
  version: Schema.Literal(workflowJournalEventVersion)
})
export type CompletionClaimReplacedEvent = typeof CompletionClaimReplacedEvent.Type

/** Records intent before deleting the exact completion claim after fresh success. */
export const CompletionClaimDeletionIntendedEvent = Schema.TaggedStruct("CompletionClaimDeletionIntended", {
  claim: CompletionTaskClaim,
  operationId: OperationId,
  successObservation: FreshCompletedTaskObservation,
  version: Schema.Literal(workflowJournalEventVersion)
})
export type CompletionClaimDeletionIntendedEvent = typeof CompletionClaimDeletionIntendedEvent.Type

/** Records intent before one numbered deletion request. */
export const CompletionClaimDeletionAttemptIntendedEvent = Schema.TaggedStruct(
  "CompletionClaimDeletionAttemptIntended",
  {
    attemptOrdinal: CompletionClaimRequestOrdinal,
    claim: CompletionTaskClaim,
    operationId: OperationId,
    successObservation: FreshCompletedTaskObservation,
    version: Schema.Literal(workflowJournalEventVersion)
  }
)
export type CompletionClaimDeletionAttemptIntendedEvent = typeof CompletionClaimDeletionAttemptIntendedEvent.Type

/** The deletion response or a later fresh read proved the exact completion claim absent. */
export const CompletionClaimDeletedEvent = Schema.TaggedStruct("CompletionClaimDeleted", {
  claim: CompletionTaskClaim,
  operationId: OperationId,
  successObservation: FreshCompletedTaskObservation,
  version: Schema.Literal(workflowJournalEventVersion)
})
export type CompletionClaimDeletedEvent = typeof CompletionClaimDeletedEvent.Type

/** Task-scoped integration responsibility settlement after fresh success and exact deletion. */
export const IntegrationFinalitySettledEvent = Schema.TaggedStruct("IntegrationFinalitySettled", {
  claim: CompletionTaskClaim,
  deletionOperationId: OperationId,
  replacementOperationId: OperationId,
  successObservation: FreshCompletedTaskObservation,
  version: Schema.Literal(workflowJournalEventVersion)
})
export type IntegrationFinalitySettledEvent = typeof IntegrationFinalitySettledEvent.Type

/** Closed completion-claim and task-settlement event vocabulary. */
export const IntegrationFinalityJournalEvent = Schema.Union([
  CompletionClaimReplacementIntendedEvent,
  CompletionClaimReplacementAttemptIntendedEvent,
  CompletionClaimReplacedEvent,
  CompletionClaimDeletionIntendedEvent,
  CompletionClaimDeletionAttemptIntendedEvent,
  CompletionClaimDeletedEvent,
  IntegrationFinalitySettledEvent
])
export type IntegrationFinalityJournalEvent = typeof IntegrationFinalityJournalEvent.Type

/** Compares the exact proof used to authorize cleanup. */
export const freshCompletedTaskObservationEquals = (
  left: FreshCompletedTaskObservation,
  right: FreshCompletedTaskObservation
): boolean =>
  left.observedAt === right.observedAt &&
  left.operationId === right.operationId &&
  left.taskId === right.taskId &&
  left.trackerRevision === right.trackerRevision

/** Derives stable operation identity for replacement of one promoted claim. */
export const completionClaimReplacementOperationIdFor = (claim: CompletionTaskClaim): OperationId =>
  OperationId.make(`completion-claim-replacement:${claim.promotionCorrelation.requestId}`)

/** Derives stable operation identity for deletion of one promoted claim. */
export const completionClaimDeletionOperationIdFor = (claim: CompletionTaskClaim): OperationId =>
  OperationId.make(`completion-claim-deletion:${claim.promotionCorrelation.requestId}`)

/** Creates the exact replacement request from the promotion-bound claim. */
export const completionClaimReplacementRequestFor = (
  claim: CompletionTaskClaim,
  operationId: OperationId = completionClaimReplacementOperationIdFor(claim)
): CompletionClaimReplacementRequest => CompletionClaimReplacementRequest.make({ claim, operationId })

/** Creates the exact deletion request from fresh task success evidence. */
export const completionClaimDeletionRequestFor = (
  claim: CompletionTaskClaim,
  successObservation: FreshCompletedTaskObservation,
  operationId: OperationId = completionClaimDeletionOperationIdFor(claim)
): CompletionClaimDeletionRequest => CompletionClaimDeletionRequest.make({ claim, operationId, successObservation })

/** Minimal in-memory boundary for deterministic protocol tests. */
export const controlledCompletionClaimBoundaryLayerFrom = (initial: ReadonlyArray<CompletionClaimObservation>) =>
  Layer.effect(
    CompletionClaimBoundary,
    Effect.gen(function* () {
      const taskIdOf = (claim: CompletionClaimObservation): TaskId =>
        claim._tag === "CompletionTaskClaim" ? claim.plannedAttempt.taskId : claim.taskId
      const claims = yield* Ref.make<ReadonlyMap<TaskId, CompletionClaimObservation>>(
        new Map(initial.map((claim) => [taskIdOf(claim), claim] as const))
      )
      const readTaskClaim = Effect.fn("CompletionClaimBoundary.Controlled.readTaskClaim")(function* (taskId: TaskId) {
        const current = (yield* Ref.get(claims)).get(taskId)
        return current ?? UnclaimedTask.make({ taskId })
      })
      const replaceTaskClaim = Effect.fn("CompletionClaimBoundary.Controlled.replaceTaskClaim")(function* (
        request: CompletionClaimReplacementRequest
      ) {
        const current = (yield* Ref.get(claims)).get(request.claim.plannedAttempt.taskId)
        if (current === undefined || current._tag === "UnclaimedTask") {
          return yield* new CompletionClaimReplacementFailure({
            detail: "active claim is absent",
            outcome: "DefinitelyNotApplied",
            request
          })
        }
        if (current._tag === "CompletionTaskClaim" && completionTaskClaimEquals(current, request.claim)) return current
        if (current._tag !== "ActiveTaskClaim" || !isExactTaskClaim(current, request.claim.originalClaim)) {
          return yield* new CompletionClaimReplacementFailure({
            detail: "current claim is not the exact active claim",
            outcome: "DefinitelyNotApplied",
            request
          })
        }
        yield* Ref.update(claims, (all) => new Map(all).set(request.claim.plannedAttempt.taskId, request.claim))
        return request.claim
      })
      const deleteTaskClaim = Effect.fn("CompletionClaimBoundary.Controlled.deleteTaskClaim")(function* (
        request: CompletionClaimDeletionRequest
      ) {
        const current = (yield* Ref.get(claims)).get(request.claim.plannedAttempt.taskId)
        if (current === undefined || current._tag === "UnclaimedTask") return
        if (current._tag !== "CompletionTaskClaim" || !completionTaskClaimEquals(current, request.claim)) {
          return yield* new CompletionClaimDeletionFailure({
            detail: "current claim is not the exact completion claim",
            outcome: "DefinitelyNotApplied",
            request
          })
        }
        yield* Ref.update(claims, (all) => {
          const next = new Map(all)
          next.delete(request.claim.plannedAttempt.taskId)
          return next
        })
      })
      return CompletionClaimBoundary.of({ readTaskClaim, replaceTaskClaim, deleteTaskClaim })
    })
  )

export const controlledCompletionClaimBoundaryLayer = controlledCompletionClaimBoundaryLayerFrom([])

// Keep these imports in the module's public type surface without making callers
// re-import the claim observation identities from the provider adapter.
export type { ActiveTaskClaim, TaskClaimObservation }
export { isExactTaskClaim }
