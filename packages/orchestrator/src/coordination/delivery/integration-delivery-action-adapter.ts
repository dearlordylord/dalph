/* eslint-disable max-lines -- The exhaustive integration transition-to-boundary routing stays in one auditable adapter. */
import { Context, Effect, Option } from "effect"
import { isExactTaskClaim } from "../../authorities/task-tracker/claim-mutation.js"
import {
  AcceptedResultEvidenceUnavailable,
  queueAcceptedResultIntegrationResponsibility,
  startQueuedIntegration
} from "../../workflow/protocols/integration-admission/protocol.js"
import { deliveryActionCompleted, deliveryActionDeferred } from "./delivery-action-adapter-common.js"
import { EvidenceStore } from "../../workflow/protocols/evidence-store.js"
import { targetPromotionCorrelationFor, TargetPromotionGit } from "../../workflow/protocols/target-promotion/events.js"
import {
  reconcileTargetPromotionAttempt,
  runTargetPromotion
} from "../../workflow/protocols/target-promotion/protocol.js"
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
  runCompletionClaimReplacementProtocolWithFreshPremises
} from "../../workflow/protocols/integration-finality/protocol.js"
import {
  CompletionClaimBoundary,
  CompletionTaskBoundary,
  completionTaskRequestFor
} from "../../workflow/protocols/integration-finality/events.js"
import {
  authorizeCompletionTaskAttempt,
  CompletionTaskAuthorizationConflict,
  CompletionTaskAuthorizationWait,
  CompletionTaskConfirmationWait,
  CompletionTaskPreconditionConflict,
  completionTaskConfirmationDisposition,
  readCompletionConfirmation,
  readCurrentCompletionConfirmation,
  runCompletionTaskProtocol
} from "../../workflow/protocols/integration-finality/completion-task-protocol.js"
import type { JournalRecord } from "../../workflow-journal/store.js"
import { AcceptedJournalReader } from "../../workflow-journal/accepted-reader.js"
import { InRunJournal } from "../../workflow-journal/store.js"
import {
  journaledTaskClaimRead,
  journaledTaskWorkSpecificationRead
} from "../../workflow-journal/journaled-interpreter.js"
import {
  journalRecordsForOperationId,
  journalRecordsForTask,
  journalRecordsOfKind,
  type JournalHistorySource
} from "../../workflow-journal/record-evidence.js"
import { IntegrationFinalityRuntimeUnavailable } from "./integration-finality-boundary.js"
import type { TrackerTarget } from "../../authorities/task-tracker/target.js"
import { integrationExitBoundaryFamilyFor } from "./integration-exit-boundary.js"
import { CoordinatorOwnership } from "../../authorities/coordinator-ownership/ownership.js"
import type { RunReactivationHint } from "../run/run-reactivation-owner.js"
import {
  executeIntegratorAction,
  authorizeIntegratorCompetingHeadSuccessor,
  fixIntegratorAutomaticSuccessorSession,
  fixIntegratorSuccessorSession,
  recordInitialConclusiveIntegrationQuarantine,
  recordProviderRunFailureIntegrationQuarantine,
  recordPromotionStaleIntegrationQuarantine,
  recordRetryConclusiveIntegrationQuarantine
} from "./integrator-delivery-action.js"
import { recordChangedHeadRetryQuarantine } from "./integration-quarantine-disposition-action.js"
import { readPostPromotionBlockerCandidateAncestry } from "../../workflow/protocols/integration-finality/post-promotion-blocker-ancestry.js"
import { pendingPromotionStaleIntegrationQuarantineFor } from "../../workflow/protocols/integration-quarantine/promotion-stale.js"
import {
  PublishedIntegratorRunQualifiedCandidate,
  remotePublicationCorrelationFor,
  RemotePublicationGit
} from "../../workflow/protocols/direct-publication/events.js"
import { runRemotePublication } from "../../workflow/protocols/direct-publication/protocol-engine.js"
import {
  remotePublicationEventsFor,
  validateRemotePublicationState
} from "../../workflow/protocols/direct-publication/transition-journal.js"
import {
  RemotePublicationResumeRuntimeUnavailable,
  resumeRemotePublicationInRuntime
} from "../../workflow/protocols/direct-publication/resume-runtime.js"
import type { RemotePublicationState } from "../../workflow/protocols/direct-publication/state.js"
import { RemoteBaselineGit } from "../../workflow/protocols/direct-publication/baseline-events.js"
import { establishRemoteBaseline } from "../../workflow/protocols/direct-publication/baseline-protocol-engine.js"
import { WorkflowInterpreter, WorkflowTrace } from "../../workflow/interpretation/interpreter.js"
import { OperationSelected } from "../../presentation/tracker-workflow-trace.js"
import {
  makeTaskClaimObservationOperation,
  makeTaskWorkSpecificationObservationOperation,
  makeTrackerGraphObservationOperation
} from "../../workflow/registry/operation.js"
import { OperationIdAllocator } from "../../workflow/protocols/task-attempt-planning/plan.js"
import { journaledTrackerGraphRead } from "../../workflow/protocols/task-tracker-read/protocol.js"

type IdentityFreeAction = Extract<MaterializedDeliveryAction, { readonly _tag: "IdentityFreeAction" }>
type IntegrationTransition = Exclude<
  IdentityFreeWorkflowTransition,
  {
    readonly _tag:
      | "AdvanceAttemptRestart"
      | "AdvanceAttemptStoppage"
      | "AbandonCancelledAttemptImplementation"
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
type RunRemotePublication = Extract<IntegrationTransition, { readonly _tag: "RunRemotePublication" }>
type EstablishRemoteBaseline = Extract<IntegrationTransition, { readonly _tag: "EstablishRemoteBaseline" }>
type ReconcileTargetPromotionAttempt = Extract<
  IntegrationTransition,
  { readonly _tag: "ReconcileTargetPromotionAttempt" }
>
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
      | "AuthorizeIntegratorCompetingHeadSuccessor"
      | "FixIntegratorAutomaticSuccessorSession"
      | "FixIntegratorSuccessorSession"
      | "RecordChangedHeadRetryQuarantine"
      | "RecordPromotionStaleIntegrationQuarantine"
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

const readPostPromotionFinalityPremises = Effect.fn("DeliveryAction.readPostPromotionFinalityPremises")(function* (
  request: ReplacePromotedTaskClaim["request"],
  target: TrackerTarget,
  lease: DeliveryActionExecutionLease
) {
  const completionRequest = completionTaskRequestFor(request.claim)
  const runId = request.claim.plannedAttempt.runId
  const context = yield* Effect.context<never>()
  const interpreter = Context.getOption(context, WorkflowInterpreter)
  const operationIds = Context.getOption(context, OperationIdAllocator)
  const trace = Context.getOption(context, WorkflowTrace)
  const inRunJournal = Context.getOption(context, InRunJournal)
  const acceptedJournal = Context.getOption(context, AcceptedJournalReader)
  if (
    Option.isNone(interpreter) ||
    Option.isNone(operationIds) ||
    Option.isNone(trace) ||
    Option.isNone(inRunJournal) ||
    Option.isNone(acceptedJournal)
  ) {
    return yield* new IntegrationFinalityRuntimeUnavailable()
  }
  const currentInterpreter = interpreter.value
  const currentOperationIds = operationIds.value
  const currentTrace = trace.value
  const currentInRunJournal = inRunJournal.value
  const currentAcceptedJournal = acceptedJournal.value
  const graphOperationId = yield* currentOperationIds.allocate()
  const graphOperation = makeTrackerGraphObservationOperation(
    { _tag: "PostPromotionFinalityCheck", promotionRequestId: request.claim.promotionCorrelation.requestId },
    graphOperationId,
    target,
    [],
    [completionRequest.taskId]
  )
  const specificationOperation = makeTaskWorkSpecificationObservationOperation(
    yield* currentOperationIds.allocate(),
    target,
    completionRequest.taskId,
    [graphOperationId]
  )
  const claimOperation = makeTaskClaimObservationOperation(
    yield* currentOperationIds.allocate(),
    target,
    completionRequest.taskId,
    [graphOperationId]
  )
  const { claimRead, graphRead, specificationRead } = yield* interruptibleBoundaryOf(lease).run(
    {
      _tag: "PostPromotionFinalityReads",
      family: "TaskTracker",
      request: completionRequest,
      graphOperationId: graphOperation.operationId,
      specificationOperationId: specificationOperation.operationId,
      claimOperationId: claimOperation.operationId
    },
    Effect.gen(function* () {
      yield* currentTrace.emit(OperationSelected.make({ operation: graphOperation }))
      const graphRead = yield* journaledTrackerGraphRead(runId, currentInterpreter, currentInRunJournal)(
        graphOperation,
        Effect.void,
        undefined
      ).pipe(
        Effect.provideService(AcceptedJournalReader, currentAcceptedJournal),
        Effect.catchTags({
          "FixtureReader.FixtureReadError": () =>
            Effect.fail(
              new CompletionTaskAuthorizationWait({
                detail: "current complete tracker graph was unavailable after target promotion",
                reason: "FocusedFactsUnavailable",
                request: completionRequest
              })
            ),
          TaskTrackerKnowledgeUnavailable: () =>
            Effect.fail(
              new CompletionTaskAuthorizationWait({
                detail: "current complete tracker graph was unavailable after target promotion",
                reason: "FocusedFactsUnavailable",
                request: completionRequest
              })
            ),
          TaskTrackerFactsReadUnavailable: () =>
            Effect.fail(
              new CompletionTaskAuthorizationWait({
                detail: "current complete tracker graph was unavailable after target promotion",
                reason: "FocusedFactsUnavailable",
                request: completionRequest
              })
            ),
          "TrackerGraphReader.AdapterReadError": (failure) =>
            failure.reason._tag === "IncompleteSnapshot" ||
            failure.reason._tag === "ResourceLimitExceeded" ||
            failure.reason._tag === "Throttled" ||
            failure.reason._tag === "CircuitOpen" ||
            failure.reason._tag === "Transport"
              ? Effect.fail(
                  new CompletionTaskAuthorizationWait({
                    detail: "current complete tracker graph was unavailable after target promotion",
                    reason: "FocusedFactsUnavailable",
                    request: completionRequest
                  })
                )
              : Effect.fail(failure)
        })
      )

      yield* currentTrace.emit(OperationSelected.make({ operation: specificationOperation }))
      const specificationRead = yield* journaledTaskWorkSpecificationRead(
        runId,
        currentInterpreter,
        currentInRunJournal,
        currentAcceptedJournal
      )(specificationOperation, Effect.void, undefined).pipe(
        Effect.catchTags({
          "FixtureReader.FixtureReadError": () =>
            Effect.fail(
              new CompletionTaskAuthorizationWait({
                detail: "current task specification was unavailable after target promotion",
                reason: "FocusedFactsUnavailable",
                request: completionRequest
              })
            ),
          TaskTrackerKnowledgeUnavailable: () =>
            Effect.fail(
              new CompletionTaskAuthorizationWait({
                detail: "current task specification was unavailable after target promotion",
                reason: "FocusedFactsUnavailable",
                request: completionRequest
              })
            ),
          "TrackerGraphReader.AdapterReadError": (failure) =>
            failure.reason._tag === "IncompleteSnapshot" ||
            failure.reason._tag === "ResourceLimitExceeded" ||
            failure.reason._tag === "Throttled" ||
            failure.reason._tag === "CircuitOpen" ||
            failure.reason._tag === "Transport"
              ? Effect.fail(
                  new CompletionTaskAuthorizationWait({
                    detail: "current task specification was unavailable after target promotion",
                    reason: "FocusedFactsUnavailable",
                    request: completionRequest
                  })
                )
              : Effect.fail(failure)
        })
      )

      yield* currentTrace.emit(OperationSelected.make({ operation: claimOperation }))
      const claimRead = yield* journaledTaskClaimRead(
        runId,
        currentInterpreter,
        currentInRunJournal,
        currentAcceptedJournal
      )(claimOperation, Effect.void, undefined)
      if (claimRead._tag !== "AuthoritativeTaskClaimObserved") {
        return yield* new CompletionTaskAuthorizationWait({
          detail: "current task claim was unavailable after target promotion",
          reason: "FocusedFactsUnavailable",
          request: completionRequest
        })
      }
      return { claimRead, graphRead, specificationRead }
    }),
    Effect.succeed
  )

  const taskLifecycle = Option.getOrUndefined(graphRead.lifecycleOf(completionRequest.taskId))
  if (taskLifecycle === undefined) {
    return yield* new CompletionTaskPreconditionConflict({
      detail: "promoted task is not present in the current complete tracker graph",
      reason: "TaskNotInTarget",
      request: completionRequest
    })
  }
  if (taskLifecycle._tag !== "Open") {
    return yield* new CompletionTaskPreconditionConflict({
      detail: `promoted task lifecycle is ${taskLifecycle._tag}, not Open`,
      reason: "TaskLifecycleConflict",
      request: completionRequest
    })
  }
  const unfinishedPrerequisite = graphRead
    .prerequisitesOf(completionRequest.taskId)
    .find(
      (prerequisiteTaskId) =>
        Option.getOrUndefined(graphRead.lifecycleOf(prerequisiteTaskId))?._tag !== "CompletedSuccessfully"
    )
  if (unfinishedPrerequisite !== undefined) {
    return yield* new CompletionTaskPreconditionConflict({
      detail: `promoted task has unfinished prerequisite ${unfinishedPrerequisite}`,
      reason: "PrerequisitesIncomplete",
      request: completionRequest
    })
  }

  if (
    specificationRead.taskId !== completionRequest.taskId ||
    specificationRead.fingerprint !== completionRequest.taskRevision
  ) {
    return yield* new CompletionTaskPreconditionConflict({
      detail: "current task specification differs from the immutable promoted task revision",
      reason: "TaskIdentityOrRevisionChanged",
      request: completionRequest
    })
  }

  if (
    claimRead.observation._tag !== "ActiveTaskClaim" ||
    !isExactTaskClaim(claimRead.observation, request.claim.originalClaim)
  ) {
    return yield* new CompletionTaskPreconditionConflict({
      detail: "current task claim differs from the exact claim that authorized this promoted result",
      reason: claimRead.observation._tag === "UnclaimedTask" ? "CompletionClaimMissing" : "CompletionClaimForeign",
      request: completionRequest
    })
  }
})

const replacePromotedTaskClaim = Effect.fn("DeliveryAction.replacePromotedTaskClaim")(function* (
  action: IdentityFreeAction,
  transition: ReplacePromotedTaskClaim,
  target: TrackerTarget,
  lease: DeliveryActionExecutionLease
) {
  yield* lease.recordIntent(transition.request.operationId)
  return yield* runCompletionClaimReplacementProtocolWithFreshPremises(
    yield* completionClaimBoundary(),
    transition.request,
    () => readPostPromotionFinalityPremises(transition.request, target, lease)
  ).pipe(
    Effect.as(deliveryActionCompleted(action.proposal.id)),
    Effect.catchTags({
      "IntegrationFinality.CompletionTaskAuthorizationWait": (failure) =>
        Effect.succeed(deliveryActionDeferred(action.proposal.id, failure)),
      "IntegrationFinality.CompletionTaskPreconditionConflict": (failure) =>
        Effect.succeed(deliveryActionDeferred(action.proposal.id, failure)),
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
  records: JournalHistorySource,
  transition: ObserveFocusedTaskCompletion
): CompletionConfirmationBasis | undefined => {
  const operationRecords = Array.from(journalRecordsForOperationId(records, transition.request.operationId))
  for (const { event } of operationRecords.toReversed()) {
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
  records: JournalHistorySource,
  transition: ObserveFocusedTaskCompletion,
  basis: CompletionConfirmationBasis
): DurableCompletionConfirmation | undefined => {
  const durable = Array.from(journalRecordsForTask(records, transition.request.claim.plannedAttempt.taskId)).findLast(
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
  const records = yield* (yield* AcceptedJournalReader).readAccepted(transition.request.claim.plannedAttempt.runId)
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
  const acceptedJournal = yield* AcceptedJournalReader
  const correlation = targetPromotionCorrelationFor(transition.candidate)
  yield* lease.integrationTargets
    .withPermit(
      transition.responsibility,
      runTargetPromotion(
        PublishedIntegratorRunQualifiedCandidate.make({
          candidate: transition.candidate,
          publication: transition.publication
        })
      ).pipe(
        Effect.provideService(
          TargetPromotionGit,
          coordinatorOwnedTargetPromotionGit(runtime.value.git, ownership.value)
        )
      )
    )
    .pipe(
      Effect.ensuring(
        acceptedJournal.readAccepted(transition.responsibility.plannedAttempt.runId).pipe(
          Effect.flatMap((records) =>
            pendingPromotionStaleIntegrationQuarantineFor(records, correlation) === undefined
              ? lease.integrationTargets.release(transition.responsibility)
              : Effect.void
          ),
          // If durable state cannot be classified, releasing could cross the
          // stale-result-before-quarantine boundary. Retain fail-closed.
          Effect.ignore
        )
      )
    )
  return deliveryActionCompleted(action.proposal.id)
})

const executeRemotePublication = Effect.fn("DeliveryAction.runRemotePublication")(function* (
  action: IdentityFreeAction,
  transition: RunRemotePublication,
  lease: DeliveryActionExecutionLease
) {
  const git = yield* RemotePublicationGit
  const acceptedJournal = yield* AcceptedJournalReader
  const activeResumeRequest = (records: JournalHistorySource) =>
    Effect.gen(function* () {
      const correlation = remotePublicationCorrelationFor(transition.candidate, transition.target)
      const state: RemotePublicationState = yield* validateRemotePublicationState(records, correlation)
      if (state._tag === "PublicationResumeReady") return state.request
      const resumeRequestId =
        state._tag === "PublicationPending" && state.authorization._tag === "ResumeRequest"
          ? state.authorization.requestId
          : state._tag === "PublicationRetained" &&
              state.cause._tag === "CompatibleCompetingHead" &&
              state.authorization._tag === "ResumeRequest"
            ? state.authorization.requestId
            : undefined
      if (resumeRequestId === undefined) return undefined
      const receipt = remotePublicationEventsFor(records, correlation).find(
        (event) => event._tag === "RemotePublicationResumeRequested" && event.request.requestId === resumeRequestId
      )
      if (receipt?._tag === "RemotePublicationResumeRequested") return receipt.request
      return yield* new RemotePublicationResumeRuntimeUnavailable({
        detail: "active publication attempt refers to a missing exact resume receipt",
        runId: transition.responsibility.plannedAttempt.runId
      })
    })
  const publicationPhase = <A, E, R>(phase: Effect.Effect<A, E, R>) =>
    runAtomicDeliveryBoundary(
      lease,
      Effect.gen(function* () {
        const records = yield* acceptedJournal.readAccepted(transition.responsibility.plannedAttempt.runId)
        let runPaused = false
        let taskPaused = false
        for (const { event } of journalRecordsOfKind(records, "ControlDirectionApplied")) {
          if (event._tag !== "ControlDirectionApplied") continue
          if (event.subject._tag === "Run") runPaused = event.direction === "Pause"
          else if (event.subject.taskId === transition.responsibility.plannedAttempt.taskId) {
            taskPaused = event.direction === "Pause"
          }
        }
        if (runPaused || taskPaused) return yield* Effect.interrupt
        return yield* phase
      })
    )
  yield* lease.integrationTargets
    .withPermit(
      transition.responsibility,
      Effect.gen(function* () {
        const records = yield* acceptedJournal.readAccepted(transition.responsibility.plannedAttempt.runId)
        const request = yield* activeResumeRequest(records)
        const phaseBoundary = { runObservation: publicationPhase, runSender: publicationPhase }
        if (request === undefined) {
          return yield* runRemotePublication(transition.candidate, transition.target, phaseBoundary).pipe(
            Effect.provideService(RemotePublicationGit, git)
          )
        }
        return yield* resumeRemotePublicationInRuntime(
          transition.candidate,
          transition.target,
          request,
          phaseBoundary,
          {
            // The live delivery runtime is already inside the ordinary Run selector. ActionCompleted feeds its next
            // evaluation; a hint here would enqueue a duplicate activation for the same Run.
            ordinaryRun: { hint: (_hint: RunReactivationHint) => Effect.void }
          }
        ).pipe(Effect.provideService(RemotePublicationGit, git))
      })
    )
    .pipe(Effect.ensuring(lease.integrationTargets.release(transition.responsibility).pipe(Effect.ignore)))
  return deliveryActionCompleted(action.proposal.id)
})

const executeRemoteBaseline = Effect.fn("DeliveryAction.establishRemoteBaseline")(function* (
  action: IdentityFreeAction,
  transition: EstablishRemoteBaseline,
  lease: DeliveryActionExecutionLease
) {
  const git = yield* RemoteBaselineGit
  const state = yield* lease.integrationTargets.withPermit(
    transition.responsibility,
    establishRemoteBaseline(transition.correlation, interruptibleBoundaryOf(lease)).pipe(
      Effect.provideService(RemoteBaselineGit, git)
    )
  )
  if (state._tag === "CatchUpRequired" || state._tag === "CatchUpPending") {
    return deliveryActionDeferred(action.proposal.id, "RemoteBaselineReconciliationPending")
  }
  return deliveryActionCompleted(action.proposal.id)
})

const executeTargetPromotionReconciliation = Effect.fn("DeliveryAction.reconcileTargetPromotionAttempt")(function* (
  action: IdentityFreeAction,
  transition: ReconcileTargetPromotionAttempt,
  lease: DeliveryActionExecutionLease
) {
  const context = yield* Effect.context<never>()
  const runtime = Context.getOption(context, TargetPromotionRuntime)
  if (Option.isNone(runtime)) return yield* new TargetPromotionRuntimeUnavailable()
  const ownership = Context.getOption(context, CoordinatorOwnership)
  if (Option.isNone(ownership)) return yield* new TargetPromotionRuntimeUnavailable()
  const acceptedJournal = yield* AcceptedJournalReader
  const correlation = targetPromotionCorrelationFor(transition.candidate)
  const result = yield* lease.integrationTargets
    .withPermit(
      transition.responsibility,
      reconcileTargetPromotionAttempt(
        PublishedIntegratorRunQualifiedCandidate.make({
          candidate: transition.candidate,
          publication: transition.publication
        })
      ).pipe(
        Effect.provideService(
          TargetPromotionGit,
          coordinatorOwnedTargetPromotionGit(runtime.value.git, ownership.value)
        )
      )
    )
    .pipe(
      Effect.ensuring(
        acceptedJournal.readAccepted(transition.responsibility.plannedAttempt.runId).pipe(
          Effect.flatMap((records) =>
            pendingPromotionStaleIntegrationQuarantineFor(records, correlation) === undefined
              ? lease.integrationTargets.release(transition.responsibility)
              : Effect.void
          ),
          Effect.ignore
        )
      )
    )
  if (result._tag !== "PromotionReconciliationDeferred") return deliveryActionCompleted(action.proposal.id)
  return deliveryActionDeferred(
    action.proposal.id,
    result.deferral._tag === "TargetReadFailed"
      ? "TargetPromotionDestinationUnreadable"
      : "TargetPromotionRetryAuthorityRequired"
  )
})

const executeOuterIntegratorAction = Effect.fn("DeliveryAction.executeOuterIntegrator")(function* (
  action: IdentityFreeAction,
  transition: OuterIntegratorTransition,
  lease: DeliveryActionExecutionLease
) {
  if (transition._tag === "AuthorizeIntegratorCompetingHeadSuccessor") {
    return yield* authorizeIntegratorCompetingHeadSuccessor(action, transition)
  }
  if (transition._tag === "FixIntegratorAutomaticSuccessorSession") {
    return yield* fixIntegratorAutomaticSuccessorSession(action, transition)
  }
  if (transition._tag === "FixIntegratorSuccessorSession") {
    return yield* fixIntegratorSuccessorSession(action, transition)
  }
  if (transition._tag === "RecordChangedHeadRetryQuarantine") {
    return yield* recordChangedHeadRetryQuarantine(action, transition, lease)
  }
  if (transition._tag === "RecordPromotionStaleIntegrationQuarantine") {
    return yield* recordPromotionStaleIntegrationQuarantine(action, transition, lease)
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
  if (transition._tag === "EstablishRemoteBaseline") return yield* executeRemoteBaseline(action, transition, lease)
  if (transition._tag === "RunRemotePublication") return yield* executeRemotePublication(action, transition, lease)
  if (transition._tag === "RunTargetPromotion") return yield* executeTargetPromotion(action, transition, lease)
  if (transition._tag === "ReconcileTargetPromotionAttempt") {
    return yield* executeTargetPromotionReconciliation(action, transition, lease)
  }
  if (transition._tag === "ObservePromotedCandidateAncestryAfterBlockerClear") {
    return yield* observePromotedCandidateAncestryAfterBlockerClear(action, transition)
  }
  if (transition._tag === "ReplacePromotedTaskClaim") {
    return yield* replacePromotedTaskClaim(action, transition, target, lease)
  }
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
  if (transition._tag === "RunRemotePublication") {
    return yield* executeRemotePublication(action, transition, lease)
  }
  const execution = executeAdvancedIntegrationAction(action, transition, lease, target)
  return yield* integrationExitBoundaryFamilyFor(transition) === null
    ? execution
    : runAtomicDeliveryBoundary(lease, execution)
})
