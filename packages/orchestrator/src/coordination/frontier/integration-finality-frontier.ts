import { Match } from "effect"
import type { StartedIntegrationResponsibility } from "../../workflow/protocols/integration-admission/protocol.js"
import {
  CompletionTaskClaim,
  completionClaimRequestLimit,
  completionClaimDeletionOperationIdFor,
  completionClaimDeletionRequestFor,
  completionClaimReplacementOperationIdFor,
  completionClaimReplacementRequestFor,
  completionTaskRequestFor,
  type CompletionTaskRequest
} from "../../workflow/protocols/integration-finality/events.js"
import {
  deriveIntegrationFinalityStateFor,
  type IntegrationFinalityState,
  latestFocusedCompletedTaskObservationFor
} from "../../workflow/protocols/integration-finality/state.js"
import type { TargetPromotionState } from "../../workflow/protocols/target-promotion/state.js"
import type { JournalPosition } from "../../workflow-journal/identity.js"
import type { JournalRecord } from "../../workflow-journal/store.js"
import type { IntegrationFrontierRuntimeFacts } from "./integration-frontier.js"
import { completionTaskConfirmationDisposition } from "../../workflow/protocols/integration-finality/completion-task-protocol.js"
import {
  FrontierExplanation,
  type IntegrationFinalityTrackerSuccessWaitReason,
  RunnableFrontierTransition,
  type RunnableFrontierTransition as RunnableFrontierTransitionType
} from "./frontier.js"

const replacementPositionFor = (
  records: ReadonlyArray<JournalRecord>,
  operationId: ReturnType<typeof completionClaimReplacementOperationIdFor>
): JournalPosition | undefined =>
  records.findLast(({ event }) => event._tag === "CompletionClaimReplaced" && event.operationId === operationId)
    ?.position

const completionClaimFor = (
  responsibility: StartedIntegrationResponsibility,
  promotion: Extract<TargetPromotionState, { readonly _tag: "PromotionSucceeded" }>,
  runtimeFacts: IntegrationFrontierRuntimeFacts
): CompletionTaskClaim | undefined => {
  const originalClaim = runtimeFacts.activeClaimByAttemptId?.get(responsibility.plannedAttempt.attemptId)
  return originalClaim === undefined
    ? undefined
    : CompletionTaskClaim.make({
        acceptanceManifest: promotion.correlation.acceptanceManifest,
        integrationReviewManifest: promotion.correlation.reviewManifest,
        originalClaim,
        plannedAttempt: responsibility.plannedAttempt,
        promotionCorrelation: promotion.correlation,
        verificationManifest: promotion.correlation.verificationManifest
      })
}

const latestCompletionTaskOutcomeFor = (
  records: ReadonlyArray<JournalRecord>,
  request: CompletionTaskRequest
): JournalRecord | undefined =>
  records.findLast(
    ({ event }) =>
      (event._tag === "CompletionTaskAcknowledged" || event._tag === "CompletionTaskRejected") &&
      event.request.operationId === request.operationId
  )

const latestCompletionTaskLookupFor = (
  records: ReadonlyArray<JournalRecord>,
  request: CompletionTaskRequest
):
  | (JournalRecord & {
      readonly event: Extract<JournalRecord["event"], { readonly _tag: "CompletionTaskRequestLookupObserved" }>
    })
  | undefined => {
  const latest = records.findLast(
    (
      record
    ): record is JournalRecord & {
      readonly event: Extract<JournalRecord["event"], { readonly _tag: "CompletionTaskRequestLookupObserved" }>
    } =>
      record.event._tag === "CompletionTaskRequestLookupObserved" &&
      record.event.request.operationId === request.operationId
  )
  return latest
}

const latestCompletionConfirmationFor = (
  records: ReadonlyArray<JournalRecord>,
  request: CompletionTaskRequest
): JournalRecord | undefined =>
  records.findLast(
    ({ event }) =>
      event._tag === "TaskTrackerFactsObserved" &&
      event.observation._tag === "FocusedTaskCompletionFacts" &&
      event.observation.request.operationId === request.operationId &&
      event.observation.purpose._tag === "Confirmation"
  )

const isCompleteGraphRead = (record: JournalRecord): boolean =>
  record.event._tag === "TaskTrackerFactsObserved" &&
  Match.valueTags(record.event.observation, {
    CompleteTaskTrackerFacts: () => true,
    FocusedTaskClaimFacts: () => false,
    FocusedTaskClaimFactsUnreadable: () => false,
    FocusedTaskCompletionFacts: () => false,
    FocusedTaskWorkSpecificationFacts: () => false,
    TaskTrackerFactsReadFailed: () => false,
    UnchangedTaskTrackerFactsReconfirmed: () => true
  })

const latestCompleteGraphPosition = (records: ReadonlyArray<JournalRecord>): JournalPosition | undefined =>
  records.findLast(isCompleteGraphRead)?.position

const deletionSuccessFor = (
  records: ReadonlyArray<JournalRecord>,
  responsibility: StartedIntegrationResponsibility,
  claim: CompletionTaskClaim,
  replacementOperationId: ReturnType<typeof completionClaimReplacementOperationIdFor>,
  state: Exclude<IntegrationFinalityState, { readonly _tag: "ReplacementPending" | "IntegrationFinalitySettled" }>
) => {
  if (state._tag !== "CompletionClaimReplaced") return state.successObservation
  const replacedAt = replacementPositionFor(records, replacementOperationId)
  /* v8 ignore next -- @preserve A reconstructed CompletionClaimReplaced state necessarily came from this exact replacement occurrence. */
  return replacedAt === undefined
    ? undefined
    : latestFocusedCompletedTaskObservationFor(records, responsibility.plannedAttempt.taskId, replacedAt, claim)
}

const replacementTransitionsFor = (
  claim: CompletionTaskClaim,
  responsibility: StartedIntegrationResponsibility,
  replacementOperationId: ReturnType<typeof completionClaimReplacementOperationIdFor>
): ReadonlyArray<RunnableFrontierTransitionType> => {
  return [
    RunnableFrontierTransition.ReplacePromotedTaskClaim({
      request: completionClaimReplacementRequestFor(claim, replacementOperationId),
      responsibility
    })
  ]
}

const deletionTransitionsFor = (
  state: Exclude<IntegrationFinalityState, { readonly _tag: "ReplacementPending" | "IntegrationFinalitySettled" }>,
  records: ReadonlyArray<JournalRecord>,
  claim: CompletionTaskClaim,
  responsibility: StartedIntegrationResponsibility,
  replacementOperationId: ReturnType<typeof completionClaimReplacementOperationIdFor>
): ReadonlyArray<RunnableFrontierTransitionType> => {
  const successObservation = deletionSuccessFor(records, responsibility, claim, replacementOperationId, state)
  return successObservation === undefined
    ? []
    : [
        RunnableFrontierTransition.DeleteCompletedTaskCompletionClaim({
          replacementOperationId,
          request: completionClaimDeletionRequestFor(claim, successObservation),
          responsibility
        })
      ]
}

const completeTaskTransitionFor = (
  request: CompletionTaskRequest,
  responsibility: StartedIntegrationResponsibility
): ReadonlyArray<RunnableFrontierTransitionType> => [
  RunnableFrontierTransition.CompletePromotedTask({ request, responsibility })
]

const observeCompletionTransitionFor = (
  request: CompletionTaskRequest,
  responsibility: StartedIntegrationResponsibility
): ReadonlyArray<RunnableFrontierTransitionType> => [
  RunnableFrontierTransition.ObserveFocusedTaskCompletion({ request, responsibility })
]

const confirmationTransitionsAfter = (
  confirmation: JournalRecord | undefined,
  confirmationRequiredAfter: JournalPosition,
  completeGraphAt: JournalPosition | undefined,
  request: CompletionTaskRequest,
  responsibility: StartedIntegrationResponsibility
): ReadonlyArray<RunnableFrontierTransitionType> => {
  const alreadyConfirmed = confirmation !== undefined && confirmation.position > confirmationRequiredAfter
  const newerGraphExists =
    completeGraphAt !== undefined && (confirmation === undefined || completeGraphAt > confirmation.position)
  return alreadyConfirmed && !newerGraphExists ? [] : observeCompletionTransitionFor(request, responsibility)
}

const unreadableLookupTransitionsFor = (
  lookupPosition: JournalPosition,
  completeGraphAt: JournalPosition | undefined,
  request: CompletionTaskRequest,
  responsibility: StartedIntegrationResponsibility
): ReadonlyArray<RunnableFrontierTransitionType> =>
  completeGraphAt !== undefined && completeGraphAt > lookupPosition
    ? observeCompletionTransitionFor(request, responsibility)
    : []

const decisiveLookupTransitionsFor = (
  lookup: ReturnType<typeof latestCompletionTaskLookupFor>,
  completeGraphAt: JournalPosition | undefined,
  request: CompletionTaskRequest,
  responsibility: StartedIntegrationResponsibility
): ReadonlyArray<RunnableFrontierTransitionType> | undefined => {
  if (lookup === undefined || lookup.event.lookup._tag === "Applied") return undefined
  return Match.valueTags(lookup.event.lookup, {
    NotApplied: () => completeTaskTransitionFor(request, responsibility),
    Unreadable: () => unreadableLookupTransitionsFor(lookup.position, completeGraphAt, request, responsibility)
  })
}

const focusedSuccessFor = (
  records: ReadonlyArray<JournalRecord>,
  responsibility: StartedIntegrationResponsibility,
  claim: CompletionTaskClaim
) => {
  const replacedAt = replacementPositionFor(records, completionClaimReplacementOperationIdFor(claim))
  /* v8 ignore next -- @preserve The caller reaches completion-task transitions only from a projected CompletionClaimReplaced state, which requires this exact replacement record. */
  return replacedAt === undefined
    ? undefined
    : latestFocusedCompletedTaskObservationFor(records, responsibility.plannedAttempt.taskId, replacedAt, claim)
}

const confirmationRequiredAfterFor = (
  lookup: ReturnType<typeof latestCompletionTaskLookupFor>,
  outcome: JournalRecord | undefined
): JournalPosition | undefined => (lookup?.event.lookup._tag === "Applied" ? lookup.position : outcome?.position)

const completionTaskTransitionsFor = (
  records: ReadonlyArray<JournalRecord>,
  responsibility: StartedIntegrationResponsibility,
  claim: CompletionTaskClaim,
  request: CompletionTaskRequest
): ReadonlyArray<RunnableFrontierTransitionType> => {
  const focusedSuccess = focusedSuccessFor(records, responsibility, claim)
  const lookup = latestCompletionTaskLookupFor(records, request)
  if (focusedSuccess !== undefined) return []
  const confirmation = latestCompletionConfirmationFor(records, request)
  const completeGraphAt = latestCompleteGraphPosition(records)
  const lookupTransitions = decisiveLookupTransitionsFor(lookup, completeGraphAt, request, responsibility)
  if (lookupTransitions !== undefined) return lookupTransitions
  const outcome = latestCompletionTaskOutcomeFor(records, request)
  const confirmationRequiredAfter = confirmationRequiredAfterFor(lookup, outcome)
  if (confirmationRequiredAfter !== undefined) {
    return confirmationTransitionsAfter(
      confirmation,
      confirmationRequiredAfter,
      completeGraphAt,
      request,
      responsibility
    )
  }
  return completeTaskTransitionFor(request, responsibility)
}

const finalityTransitionsForState = (
  state: IntegrationFinalityState | undefined,
  records: ReadonlyArray<JournalRecord>,
  claim: CompletionTaskClaim,
  responsibility: StartedIntegrationResponsibility,
  replacementOperationId: ReturnType<typeof completionClaimReplacementOperationIdFor>,
  completionTaskConfigured: boolean
): ReadonlyArray<RunnableFrontierTransitionType> => {
  if (state === undefined) return replacementTransitionsFor(claim, responsibility, replacementOperationId)
  if (state._tag === "ReplacementPending") {
    return replacementTransitionsFor(claim, responsibility, replacementOperationId)
  }
  if (state._tag === "IntegrationFinalitySettled") return []
  const completionRequest = completionTaskRequestFor(claim)
  if (state._tag === "CompletionClaimReplaced" && completionTaskConfigured) {
    const completionTransitions = completionTaskTransitionsFor(records, responsibility, claim, completionRequest)
    if (completionTransitions.length > 0) return completionTransitions
  }
  return deletionTransitionsFor(state, records, claim, responsibility, replacementOperationId)
}

/** Derives only the task-scoped post-promotion claim action; it never acquires a Git target. */
export const integrationFinalityTransitionsFor = (
  records: ReadonlyArray<JournalRecord>,
  responsibility: StartedIntegrationResponsibility,
  promotion: Extract<TargetPromotionState, { readonly _tag: "PromotionSucceeded" }>,
  runtimeFacts: IntegrationFrontierRuntimeFacts
): ReadonlyArray<RunnableFrontierTransitionType> => {
  if (runtimeFacts.integrationFinalityConfigured !== true) return []
  const claim = completionClaimFor(responsibility, promotion, runtimeFacts)
  if (claim === undefined) return []
  const state = deriveIntegrationFinalityStateFor(records, claim)
  const replacementOperationId = completionClaimReplacementOperationIdFor(claim)
  return finalityTransitionsForState(
    state,
    records,
    claim,
    responsibility,
    replacementOperationId,
    runtimeFacts.completionTaskConfigured === true
  )
}

const nonConvergenceExplanationFor = (
  state: IntegrationFinalityState | undefined,
  claim: CompletionTaskClaim | undefined,
  plannedAttempt: StartedIntegrationResponsibility["plannedAttempt"]
) => {
  if (claim === undefined) return undefined
  if (state?._tag === "ReplacementPending" && state.replacementAttempts.length >= completionClaimRequestLimit) {
    return FrontierExplanation.IntegrationFinalityNonConvergence({
      claim,
      operationId: completionClaimReplacementOperationIdFor(claim),
      phase: "Replacement",
      plannedAttempt,
      wakeCondition: "ProcessRestartedOrAcceptedFactsChanged"
    })
  }
  if (state?._tag === "DeletionPending" && state.deletionAttempts.length >= completionClaimRequestLimit) {
    return FrontierExplanation.IntegrationFinalityNonConvergence({
      claim,
      operationId: completionClaimDeletionOperationIdFor(claim),
      phase: "Deletion",
      plannedAttempt,
      wakeCondition: "ProcessRestartedOrAcceptedFactsChanged"
    })
  }
  return undefined
}

const waitsForFreshSuccess = (
  records: ReadonlyArray<JournalRecord>,
  state: IntegrationFinalityState | undefined,
  claim: CompletionTaskClaim | undefined,
  responsibility: StartedIntegrationResponsibility
): boolean => {
  if (state?._tag !== "CompletionClaimReplaced" || claim === undefined) return false
  const replacedAt = replacementPositionFor(records, completionClaimReplacementOperationIdFor(claim))
  return (
    replacedAt === undefined ||
    latestFocusedCompletedTaskObservationFor(records, responsibility.plannedAttempt.taskId, replacedAt, claim) ===
      undefined
  )
}

const focusedSuccessWaitReasonFor = (
  records: ReadonlyArray<JournalRecord>,
  claim: CompletionTaskClaim
): IntegrationFinalityTrackerSuccessWaitReason => {
  const request = completionTaskRequestFor(claim)
  const focusedObservation = records.findLast(
    ({ event }) =>
      event._tag === "TaskTrackerFactsObserved" &&
      event.observation._tag === "FocusedTaskCompletionFacts" &&
      event.observation.request.operationId === request.operationId
  )
  if (
    focusedObservation?.event._tag !== "TaskTrackerFactsObserved" ||
    focusedObservation.event.observation._tag !== "FocusedTaskCompletionFacts"
  ) {
    return { _tag: "FocusedConfirmationNotObserved" }
  }
  const focused = focusedObservation.event.observation
  const disposition = completionTaskConfirmationDisposition(
    request,
    focused.target,
    focusedObservation.event.operationId,
    focused.facts
  )
  if (disposition._tag === "Pending") {
    return { _tag: "FocusedCompletionPending", operationId: focusedObservation.event.operationId }
  }
  /* v8 ignore else -- @preserve A completed-successfully disposition is intercepted by focusedSuccessFor before explanation; only Pending or Conflict reaches this classifier. */
  if (disposition._tag === "Conflict") {
    return {
      _tag: "FocusedCompletionConflict",
      detail: disposition.detail,
      operationId: focusedObservation.event.operationId,
      reason: disposition.reason
    }
  }
  return { _tag: "FocusedConfirmationNotObserved" }
}

export const integrationFinalityExplanationFor = (
  records: ReadonlyArray<JournalRecord>,
  responsibility: StartedIntegrationResponsibility,
  promotion: Extract<TargetPromotionState, { readonly _tag: "PromotionSucceeded" }>,
  runtimeFacts: IntegrationFrontierRuntimeFacts
) => {
  if (runtimeFacts.integrationFinalityConfigured !== true) {
    return FrontierExplanation.IntegrationFinalityConfigurationWait({
      plannedAttempt: responsibility.plannedAttempt,
      wakeCondition: "CompletionClaimBoundaryConfigured"
    })
  }
  const claim = completionClaimFor(responsibility, promotion, runtimeFacts)
  const state = claim === undefined ? undefined : deriveIntegrationFinalityStateFor(records, claim)
  const nonConvergence = nonConvergenceExplanationFor(state, claim, responsibility.plannedAttempt)
  if (nonConvergence !== undefined) return nonConvergence
  return waitsForFreshSuccess(records, state, claim, responsibility) && claim !== undefined
    ? FrontierExplanation.IntegrationFinalityTrackerSuccessWait({
        plannedAttempt: responsibility.plannedAttempt,
        reason: focusedSuccessWaitReasonFor(records, claim),
        wakeCondition: "TaskTrackerFactsObserved"
      })
    : FrontierExplanation.IntegrationInProgress({ plannedAttempt: responsibility.plannedAttempt })
}
