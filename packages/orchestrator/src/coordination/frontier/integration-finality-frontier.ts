import type { StartedIntegrationResponsibility } from "../../workflow/protocols/integration-admission/protocol.js"
import {
  CompletionTaskClaim,
  completionClaimRequestLimit,
  completionClaimDeletionOperationIdFor,
  completionClaimDeletionRequestFor,
  completionClaimReplacementOperationIdFor,
  completionClaimReplacementRequestFor
} from "../../workflow/protocols/integration-finality/events.js"
import {
  deriveIntegrationFinalityStateFor,
  type IntegrationFinalityState,
  latestFreshCompletedTaskObservationFor
} from "../../workflow/protocols/integration-finality/state.js"
import type { TargetPromotionState } from "../../workflow/protocols/target-promotion/state.js"
import type { JournalPosition } from "../../workflow-journal/identity.js"
import type { JournalRecord } from "../../workflow-journal/store.js"
import type { IntegrationFrontierRuntimeFacts } from "./integration-frontier.js"
import {
  FrontierExplanation,
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
        originalClaim,
        plannedAttempt: responsibility.plannedAttempt,
        promotionCorrelation: promotion.correlation
      })
}

const deletionSuccessFor = (
  records: ReadonlyArray<JournalRecord>,
  responsibility: StartedIntegrationResponsibility,
  replacementOperationId: ReturnType<typeof completionClaimReplacementOperationIdFor>,
  state: Exclude<IntegrationFinalityState, { readonly _tag: "ReplacementPending" | "IntegrationFinalitySettled" }>
) => {
  if (state._tag !== "CompletionClaimReplaced") return state.successObservation
  const replacedAt = replacementPositionFor(records, replacementOperationId)
  /* v8 ignore next -- @preserve A reconstructed CompletionClaimReplaced state necessarily came from this exact replacement occurrence. */
  return replacedAt === undefined
    ? undefined
    : latestFreshCompletedTaskObservationFor(records, responsibility.plannedAttempt.taskId, replacedAt)
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
  const successObservation = deletionSuccessFor(records, responsibility, replacementOperationId, state)
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

const finalityTransitionsForState = (
  state: IntegrationFinalityState | undefined,
  records: ReadonlyArray<JournalRecord>,
  claim: CompletionTaskClaim,
  responsibility: StartedIntegrationResponsibility,
  replacementOperationId: ReturnType<typeof completionClaimReplacementOperationIdFor>
): ReadonlyArray<RunnableFrontierTransitionType> => {
  if (state === undefined) return replacementTransitionsFor(claim, responsibility, replacementOperationId)
  if (state._tag === "ReplacementPending") {
    return replacementTransitionsFor(claim, responsibility, replacementOperationId)
  }
  if (state._tag === "IntegrationFinalitySettled") return []
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
  return finalityTransitionsForState(state, records, claim, responsibility, replacementOperationId)
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
    latestFreshCompletedTaskObservationFor(records, responsibility.plannedAttempt.taskId, replacedAt) === undefined
  )
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
  return waitsForFreshSuccess(records, state, claim, responsibility)
    ? FrontierExplanation.IntegrationFinalityTrackerSuccessWait({
        plannedAttempt: responsibility.plannedAttempt,
        wakeCondition: "TaskTrackerFactsObserved"
      })
    : FrontierExplanation.IntegrationInProgress({ plannedAttempt: responsibility.plannedAttempt })
}
