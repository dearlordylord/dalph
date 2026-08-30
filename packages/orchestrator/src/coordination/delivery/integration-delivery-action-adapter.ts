/* eslint-disable max-lines -- The exhaustive integration transition-to-boundary routing stays in one auditable adapter. */
import { Context, Effect, Option } from "effect"
import {
  AcceptedResultEvidenceUnavailable,
  queueAcceptedResultIntegrationResponsibility,
  startQueuedIntegration
} from "../../workflow/protocols/integration-admission/protocol.js"
import { deliveryActionCompleted, deliveryActionDeferred } from "./delivery-action-adapter-common.js"
import { EvidenceStore } from "../../workflow/protocols/evidence-store.js"
import { TargetPromotionGit } from "../../workflow/protocols/target-promotion/events.js"
import { runTargetPromotion } from "../../workflow/protocols/target-promotion/protocol.js"
import {
  coordinatorOwnedTargetPromotionGit,
  TargetPromotionRuntime
} from "../../workflow/protocols/target-promotion/runtime.js"
import { TargetPromotionRuntimeUnavailable } from "./target-promotion-boundary.js"
import {
  type DeliveryActionExecutionLease,
  interruptibleBoundaryOf,
  type MaterializedDeliveryAction,
  runAtomicDeliveryBoundary
} from "./delivery-action-executor.js"
import type { IdentityFreeWorkflowTransition } from "./delivery-action-proposal.js"
import {
  runCompletionClaimDeletionProtocol,
  runCompletionClaimReplacementProtocol
} from "../../workflow/protocols/integration-finality/protocol.js"
import {
  CompletionClaimBoundary,
  CompletionTaskBoundary
} from "../../workflow/protocols/integration-finality/events.js"
import {
  authorizeCompletionTaskAttempt,
  CompletionTaskAuthorizationConflict,
  CompletionTaskConfirmationWait,
  completionTaskConfirmationDisposition,
  readCompletionConfirmation,
  readCurrentCompletionConfirmation,
  runCompletionTaskProtocol
} from "../../workflow/protocols/integration-finality/completion-task-protocol.js"
import { InRunJournal, type JournalRecord } from "../../workflow-journal/store.js"
import { IntegrationFinalityRuntimeUnavailable } from "./integration-finality-boundary.js"
import type { TrackerTarget } from "../../authorities/task-tracker/target.js"
import { integrationExitBoundaryFamilyFor } from "./integration-exit-boundary.js"
import { CoordinatorOwnership } from "../../authorities/coordinator-ownership/ownership.js"
import {
  executeIntegratorAction,
  fixIntegratorSuccessorSession,
  recordInitialConclusiveIntegrationQuarantine,
  recordProviderRunFailureIntegrationQuarantine,
  recordRetryConclusiveIntegrationQuarantine
} from "./integrator-delivery-action.js"
import { recordChangedHeadRetryQuarantine } from "./integration-quarantine-disposition-action.js"
import { readPostPromotionBlockerCandidateAncestry } from "../../workflow/protocols/integration-finality/post-promotion-blocker-ancestry.js"

type IdentityFreeAction = Extract<MaterializedDeliveryAction, { readonly _tag: "IdentityFreeAction" }>
type IntegrationTransition = Exclude<
  IdentityFreeWorkflowTransition,
  {
    readonly _tag:
      | "AdvanceAttemptRestart"
      | "AdvanceAttemptStoppage"
      | "RelinquishCancelledAttemptImplementation"
      | "ObservePlannedAttemptExecutorWork"
      | "ResumePlannedAttemptExecutorWorkAfterCurrentFacts"
      | "ReconcilePlannedAttemptExecutorWork"
      | "ObserveAttemptStoppageExecutor"
      | "RecordStoppedAttemptClaimNoRelease"
      | "RecordCancelledAttemptClaimNoRelease"
      | "SuspendPlannedAttemptExecutorWork"
  }
>
type RunTargetPromotion = Extract<IntegrationTransition, { readonly _tag: "RunTargetPromotion" }>
type ReplacePromotedTaskClaim = Extract<IntegrationTransition, { readonly _tag: "ReplacePromotedTaskClaim" }>
type ObservePromotedCandidateAncestryAfterBlockerClear = Extract<
  IntegrationTransition,
  { readonly _tag: "ObservePromotedCandidateAncestryAfterBlockerClear" }
>
type DeleteCompletedTaskCompletionClaim = Extract<
  IntegrationTransition,
  { readonly _tag: "DeleteCompletedTaskCompletionClaim" }
>
type CompletePromotedTask = Extract<IntegrationTransition, { readonly _tag: "CompletePromotedTask" }>
type ObserveFocusedTaskCompletion = Extract<IntegrationTransition, { readonly _tag: "ObserveFocusedTaskCompletion" }>
type OuterIntegratorTransition = Extract<
  IntegrationTransition,
  {
    readonly _tag:
      | "FixIntegratorSuccessorSession"
      | "RecordChangedHeadRetryQuarantine"
      | "RecordInitialConclusiveIntegrationQuarantine"
      | "RecordProviderRunFailureIntegrationQuarantine"
      | "RecordRetryConclusiveIntegrationQuarantine"
      | "RunIntegrator"
  }
>
type CompletionConfirmationBasis = Extract<
  JournalRecord["event"],
  { readonly _tag: "CompletionTaskAcknowledged" | "CompletionTaskRequestLookupObserved" }
>
type DurableCompletionConfirmation = Extract<JournalRecord["event"], { readonly _tag: "TaskTrackerFactsObserved" }>
type AdvancedIntegrationTransition = Exclude<
  IntegrationTransition,
  {
    readonly _tag:
      | "QueueAcceptedResultIntegrationResponsibility"
      | "StartQueuedIntegration"
      | "AcquireStartedIntegrationTarget"
      | "ReleaseStartedIntegrationTarget"
  }
>

const completionClaimBoundary = Effect.fn("DeliveryAction.completionClaimBoundary")(function* () {
  const boundary = Context.getOption(yield* Effect.context<never>(), CompletionClaimBoundary)
  return Option.isSome(boundary) ? boundary.value : yield* new IntegrationFinalityRuntimeUnavailable()
})

const replacePromotedTaskClaim = Effect.fn("DeliveryAction.replacePromotedTaskClaim")(function* (
  action: IdentityFreeAction,
  transition: ReplacePromotedTaskClaim
) {
  return yield* runCompletionClaimReplacementProtocol(yield* completionClaimBoundary(), transition.request).pipe(
    Effect.as(deliveryActionCompleted(action.proposal.id)),
    Effect.catchTags({
      /* v8 ignore next -- @preserve The bounded protocol tests own non-convergence; the runtime test owns deferred-result admission. */
      "IntegrationFinality.CompletionClaimDidNotConverge": () =>
        Effect.succeed(deliveryActionDeferred(action.proposal.id, "CompletionClaimNonConvergent")),
      "IntegrationFinality.CompletionClaimOwnershipConflict": () =>
        Effect.succeed(deliveryActionDeferred(action.proposal.id, "CompletionClaimConflict")),
      "IntegrationFinality.CompletionClaimReadFailure": () =>
        Effect.succeed(deliveryActionDeferred(action.proposal.id, "CompletionClaimReadUnavailable")),
      /* v8 ignore next -- @preserve The protocol tests own definite rejection; this adapter only translates its tag. */
      "IntegrationFinality.CompletionClaimReplacementFailure": () =>
        Effect.succeed(deliveryActionDeferred(action.proposal.id, "CompletionClaimRejected"))
    })
  )
})

const observePromotedCandidateAncestryAfterBlockerClear = Effect.fn(
  "DeliveryAction.observePromotedCandidateAncestryAfterBlockerClear"
)(function* (action: IdentityFreeAction, transition: ObservePromotedCandidateAncestryAfterBlockerClear) {
  const runtime = Context.getOption(yield* Effect.context<never>(), TargetPromotionRuntime)
  if (Option.isNone(runtime)) return deliveryActionDeferred(action.proposal.id, "CompletionTaskUnavailable")
  yield* readPostPromotionBlockerCandidateAncestry(transition.authorization).pipe(
    Effect.provideService(TargetPromotionGit, runtime.value.git)
  )
  return deliveryActionCompleted(action.proposal.id)
})

const deleteCompletedTaskCompletionClaim = Effect.fn("DeliveryAction.deleteCompletedTaskCompletionClaim")(function* (
  action: IdentityFreeAction,
  transition: DeleteCompletedTaskCompletionClaim,
  lease: DeliveryActionExecutionLease
) {
  return yield* runCompletionClaimDeletionProtocol(
    yield* completionClaimBoundary(),
    transition.request,
    transition.replacementOperationId,
    interruptibleBoundaryOf(lease)
  ).pipe(
    Effect.as(deliveryActionCompleted(action.proposal.id)),
    Effect.catchTags({
      /* v8 ignore next -- @preserve The protocol tests own definite deletion rejection; this adapter only translates its tag. */
      "IntegrationFinality.CompletionClaimDeletionFailure": () =>
        Effect.succeed(deliveryActionDeferred(action.proposal.id, "CompletionClaimRejected")),
      /* v8 ignore next -- @preserve The bounded protocol tests own non-convergence; the runtime test owns deferred-result admission. */
      "IntegrationFinality.CompletionClaimDidNotConverge": () =>
        Effect.succeed(deliveryActionDeferred(action.proposal.id, "CompletionClaimNonConvergent")),
      /* v8 ignore next -- @preserve Foreign deletion claims are protocol-tested; the replacement route proves adapter translation. */
      "IntegrationFinality.CompletionClaimOwnershipConflict": () =>
        Effect.succeed(deliveryActionDeferred(action.proposal.id, "CompletionClaimConflict")),
      "IntegrationFinality.CompletionClaimReadFailure": () =>
        Effect.succeed(deliveryActionDeferred(action.proposal.id, "CompletionClaimReadUnavailable")),
      /* v8 ignore next -- @preserve Focused-success guarding is frontier/protocol tested before this tag translation. */
      "IntegrationFinality.FocusedTaskCompletionSuccessRequired": () =>
        Effect.succeed(deliveryActionDeferred(action.proposal.id, "FocusedTaskCompletionSuccessRequired"))
    })
  )
})

const completionTaskBoundary = Effect.fn("DeliveryAction.completionTaskBoundary")(function* () {
  const boundary = Context.getOption(yield* Effect.context<never>(), CompletionTaskBoundary)
  return Option.isSome(boundary) ? boundary.value : yield* new IntegrationFinalityRuntimeUnavailable()
})

const completePromotedTask = Effect.fn("DeliveryAction.completePromotedTask")(function* (
  action: IdentityFreeAction,
  transition: CompletePromotedTask,
  target: TrackerTarget
) {
  const boundary = yield* completionTaskBoundary()
  const context = yield* Effect.context<never>()
  const promotionRuntime = Context.getOption(context, TargetPromotionRuntime)
  const evidenceStore = Context.getOption(context, EvidenceStore)
  if (Option.isNone(promotionRuntime) || Option.isNone(evidenceStore)) {
    return deliveryActionDeferred(action.proposal.id, "CompletionTaskUnavailable")
  }
  return yield* runCompletionTaskProtocol(boundary, transition.request, target, (ordinal) =>
    authorizeCompletionTaskAttempt(boundary, transition.request, target, ordinal).pipe(
      Effect.provideService(TargetPromotionGit, promotionRuntime.value.git),
      Effect.provideService(EvidenceStore, evidenceStore.value)
    )
  ).pipe(
    Effect.as(deliveryActionCompleted(action.proposal.id)),
    Effect.catchTags({
      "IntegrationFinality.CompletionTaskAmbiguousWait": (failure) =>
        Effect.succeed(deliveryActionDeferred(action.proposal.id, failure)),
      "IntegrationFinality.CompletionTaskAuthorizationConflict": (failure) =>
        Effect.succeed(deliveryActionDeferred(action.proposal.id, failure)),
      "IntegrationFinality.CompletionTaskAuthorizationWait": (failure) =>
        Effect.succeed(deliveryActionDeferred(action.proposal.id, failure)),
      "IntegrationFinality.CompletionTaskConfirmationWait": (failure) =>
        Effect.succeed(deliveryActionDeferred(action.proposal.id, failure)),
      "IntegrationFinality.CompletionTaskDidNotConverge": () =>
        Effect.succeed(deliveryActionDeferred(action.proposal.id, "CompletionTaskNonConvergent")),
      "IntegrationFinality.CompletionTaskPreconditionConflict": (failure) =>
        Effect.succeed(deliveryActionDeferred(action.proposal.id, failure))
    })
  )
})

const completionConfirmationBasisFor = (
  records: ReadonlyArray<JournalRecord>,
  transition: ObserveFocusedTaskCompletion
): CompletionConfirmationBasis | undefined => {
  for (const { event } of records.toReversed()) {
    if (event._tag === "CompletionTaskAcknowledged" && event.request.operationId === transition.request.operationId) {
      return event
    }
    if (
      event._tag === "CompletionTaskRequestLookupObserved" &&
      event.lookup._tag === "Applied" &&
      event.request.operationId === transition.request.operationId
    ) {
      return event
    }
  }
  return undefined
}

const resumableDurableConfirmationFor = (
  records: ReadonlyArray<JournalRecord>,
  transition: ObserveFocusedTaskCompletion,
  basis: CompletionConfirmationBasis
): DurableCompletionConfirmation | undefined => {
  const durable = records.findLast(
    ({ event }) =>
      event._tag === "TaskTrackerFactsObserved" &&
      event.observation._tag === "FocusedTaskCompletionFacts" &&
      event.observation.request.operationId === transition.request.operationId &&
      event.observation.purpose._tag === "Confirmation" &&
      event.observation.purpose.attemptOrdinal === basis.attemptOrdinal
  )?.event
  if (durable?._tag !== "TaskTrackerFactsObserved" || durable.observation._tag !== "FocusedTaskCompletionFacts") {
    return undefined
  }
  const focused = durable.observation
  const disposition = completionTaskConfirmationDisposition(
    transition.request,
    focused.target,
    durable.operationId,
    focused.facts
  )
  return disposition._tag === "CompletedSuccessfully" ? durable : undefined
}

const observeFocusedTaskCompletion = Effect.fn("DeliveryAction.observeFocusedTaskCompletion")(function* (
  action: IdentityFreeAction,
  transition: ObserveFocusedTaskCompletion,
  target: TrackerTarget
) {
  const boundary = yield* completionTaskBoundary()
  const journal = yield* InRunJournal
  const records = yield* journal.read(transition.request.claim.plannedAttempt.runId)
  const confirmationBasis = completionConfirmationBasisFor(records, transition)
  if (confirmationBasis === undefined) {
    return deliveryActionDeferred(
      action.proposal.id,
      new CompletionTaskAuthorizationConflict({
        detail: "focused confirmation has no exact prior tracker acknowledgement or applied request lookup",
        reason: "RequestIdentityContradiction",
        request: transition.request
      })
    )
  }
  const resumableDurableConfirmation = resumableDurableConfirmationFor(records, transition, confirmationBasis)
  const confirmation =
    resumableDurableConfirmation !== undefined
      ? readCompletionConfirmation(boundary, transition.request, confirmationBasis.attemptOrdinal, target).pipe(
          Effect.map((observation) => ({ observation, operationId: resumableDurableConfirmation.operationId }))
        )
      : readCurrentCompletionConfirmation(boundary, transition.request, confirmationBasis.attemptOrdinal, target)
  return yield* confirmation.pipe(
    Effect.map(({ observation, operationId }) =>
      observation === undefined
        ? deliveryActionDeferred(
            action.proposal.id,
            new CompletionTaskConfirmationWait({
              detail: "focused confirmation still reports the exact task open under the completion claim",
              operationId,
              request: transition.request
            })
          )
        : deliveryActionCompleted(action.proposal.id)
    ),
    Effect.catchTags({
      "IntegrationFinality.CompletionTaskConfirmationWait": (failure) =>
        Effect.succeed(deliveryActionDeferred(action.proposal.id, failure)),
      "IntegrationFinality.CompletionTaskPreconditionConflict": (failure) =>
        Effect.succeed(deliveryActionDeferred(action.proposal.id, failure))
    })
  )
})

const executeTargetPromotion = Effect.fn("DeliveryAction.runTargetPromotion")(function* (
  action: IdentityFreeAction,
  transition: RunTargetPromotion,
  lease: DeliveryActionExecutionLease
) {
  const context = yield* Effect.context<never>()
  const runtime = Context.getOption(context, TargetPromotionRuntime)
  if (Option.isNone(runtime)) return yield* new TargetPromotionRuntimeUnavailable()
  const ownership = Context.getOption(context, CoordinatorOwnership)
  if (Option.isNone(ownership)) return yield* new TargetPromotionRuntimeUnavailable()
  yield* lease.integrationTargets
    .withPermit(
      transition.responsibility,
      runTargetPromotion(transition.candidate).pipe(
        Effect.provideService(
          TargetPromotionGit,
          coordinatorOwnedTargetPromotionGit(runtime.value.git, ownership.value)
        )
      )
    )
    .pipe(Effect.ensuring(lease.integrationTargets.release(transition.responsibility)))
  return deliveryActionCompleted(action.proposal.id)
})

const executeOuterIntegratorAction = Effect.fn("DeliveryAction.executeOuterIntegrator")(function* (
  action: IdentityFreeAction,
  transition: OuterIntegratorTransition,
  lease: DeliveryActionExecutionLease
) {
  if (transition._tag === "FixIntegratorSuccessorSession") {
    return yield* fixIntegratorSuccessorSession(action, transition)
  }
  if (transition._tag === "RecordChangedHeadRetryQuarantine") {
    return yield* recordChangedHeadRetryQuarantine(action, transition, lease)
  }
  if (transition._tag === "RecordInitialConclusiveIntegrationQuarantine") {
    return yield* recordInitialConclusiveIntegrationQuarantine(action, transition, lease)
  }
  if (transition._tag === "RecordProviderRunFailureIntegrationQuarantine") {
    return yield* recordProviderRunFailureIntegrationQuarantine(action, transition, lease)
  }
  if (transition._tag === "RecordRetryConclusiveIntegrationQuarantine") {
    return yield* recordRetryConclusiveIntegrationQuarantine(action, transition, lease)
  }
  return yield* executeIntegratorAction(action, transition, lease)
})

const executeAdvancedIntegrationAction = Effect.fn("DeliveryAction.executeAdvancedIntegration")(function* (
  action: IdentityFreeAction,
  transition: AdvancedIntegrationTransition,
  lease: DeliveryActionExecutionLease,
  target: TrackerTarget
) {
  if (transition._tag === "RunTargetPromotion") return yield* executeTargetPromotion(action, transition, lease)
  if (transition._tag === "ObservePromotedCandidateAncestryAfterBlockerClear") {
    return yield* observePromotedCandidateAncestryAfterBlockerClear(action, transition)
  }
  if (transition._tag === "ReplacePromotedTaskClaim") return yield* replacePromotedTaskClaim(action, transition)
  if (transition._tag === "CompletePromotedTask") return yield* completePromotedTask(action, transition, target)
  if (transition._tag === "ObserveFocusedTaskCompletion") {
    return yield* observeFocusedTaskCompletion(action, transition, target)
  }
  if (transition._tag === "DeleteCompletedTaskCompletionClaim") {
    return yield* deleteCompletedTaskCompletionClaim(action, transition, lease)
  }
  return yield* executeOuterIntegratorAction(action, transition, lease)
})

export const executeIntegrationAction = Effect.fn("DeliveryAction.executeIntegration")(function* (
  action: IdentityFreeAction,
  transition: IntegrationTransition,
  lease: DeliveryActionExecutionLease,
  target: TrackerTarget
) {
  if (transition._tag === "QueueAcceptedResultIntegrationResponsibility") {
    const context = yield* Effect.context<never>()
    const evidenceStore = Context.getOption(context, EvidenceStore)
    if (Option.isNone(evidenceStore)) {
      return deliveryActionDeferred(
        action.proposal.id,
        new AcceptedResultEvidenceUnavailable({
          attemptId: transition.accepted.plannedAttempt.attemptId,
          detail: "acceptance evidence store is not configured for this run activation",
          reference: transition.accepted.acceptedResult.evidenceManifest,
          runId: transition.accepted.plannedAttempt.runId
        })
      )
    }
    return yield* queueAcceptedResultIntegrationResponsibility(
      transition.accepted.plannedAttempt,
      transition.accepted.acceptedResult,
      transition.integrationTarget
    ).pipe(
      Effect.provideService(EvidenceStore, evidenceStore.value),
      Effect.as(deliveryActionCompleted(action.proposal.id)),
      Effect.catchTags({
        AcceptedResultEvidenceUnavailable: (failure) =>
          Effect.succeed(deliveryActionDeferred(action.proposal.id, failure)),
        AcceptedResultEvidenceConflict: (failure) => Effect.succeed(deliveryActionDeferred(action.proposal.id, failure))
      })
    )
  }
  if (transition._tag === "StartQueuedIntegration") {
    yield* startQueuedIntegration(transition.responsibility)
    yield* lease.acceptIntegrationTargetOwnership
    return deliveryActionCompleted(action.proposal.id)
  }
  if (transition._tag === "AcquireStartedIntegrationTarget") {
    yield* lease.acceptIntegrationTargetOwnership
    return deliveryActionCompleted(action.proposal.id)
  }
  if (transition._tag === "ReleaseStartedIntegrationTarget") {
    yield* lease.integrationTargets.release(transition.responsibility)
    return deliveryActionCompleted(action.proposal.id)
  }
  const execution = executeAdvancedIntegrationAction(action, transition, lease, target)
  return yield* integrationExitBoundaryFamilyFor(transition) === null
    ? execution
    : runAtomicDeliveryBoundary(lease, execution)
})
