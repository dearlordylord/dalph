import type { RunId } from "@dalph/contracts"
import { Match } from "effect"
import type { WorkflowJournalEvent } from "../../workflow/registry/event.js"
import type { IntegrationCandidateCorrelation } from "../../workflow/protocols/integration-candidate-construction/events.js"

export const candidateKey = (correlation: IntegrationCandidateCorrelation): string =>
  JSON.stringify([correlation.runId, correlation.candidateId])
export const sessionSupersessionKey = candidateKey
export const priorSessionSupersessionKey = candidateKey

export const setMapValue = <K, V>(map: Map<K, V>, key: K, value: V): void => {
  Map.prototype.set.call(map, key, value)
}
export const addSetValue = <T>(set: Set<T>, value: T): void => {
  Set.prototype.add.call(set, value)
}

type TargetPromotionRunBindingEvent = Extract<
  WorkflowJournalEvent,
  {
    readonly _tag:
      | "TargetPromotionIntended"
      | "TargetPromotionAttemptIntended"
      | "TargetPromotionObservedSuccess"
      | "TargetPromotionStale"
      | "TargetPromotionNonConvergence"
  }
>

type TargetVerificationRunBindingEvent = Extract<
  WorkflowJournalEvent,
  { readonly _tag: "TargetVerificationIntended" | "TargetVerificationEvidenceSealed" }
>

type CandidateCorrelationRunBindingEvent = Extract<
  WorkflowJournalEvent,
  {
    readonly _tag:
      | "IntegrationCandidateGitObserved"
      | "IntegrationCandidateGitValidationFailed"
      | "IntegrationCandidateConstructed"
      | "IntegrationCandidateCorrectionLimitReached"
      | "IntegrationCandidateContinuationLimitReached"
  }
>

const invalidTargetPromotionRunBinding = (event: TargetPromotionRunBindingEvent, runId: RunId): string | undefined =>
  event.correlation.candidateCorrelation.runId === runId &&
  event.correlation.verificationCorrelation.candidateCorrelation.runId === runId
    ? undefined
    : `target promotion binds run ${event.correlation.candidateCorrelation.runId}`

const invalidTargetVerificationRunBinding = (
  event: TargetVerificationRunBindingEvent,
  runId: RunId
): string | undefined =>
  event.correlation.candidateCorrelation.runId === runId
    ? undefined
    : `target verification binds run ${event.correlation.candidateCorrelation.runId}`

const invalidCandidateCorrelationRunBinding = (
  event: CandidateCorrelationRunBindingEvent,
  runId: RunId
): string | undefined =>
  event.correlation.runId === runId ? undefined : `candidate event binds run ${event.correlation.runId}`

const invalidCandidateRunBinding = (event: WorkflowJournalEvent, runId: RunId): string | undefined =>
  Match.value(event).pipe(
    Match.tags({
      TargetPromotionIntended: (candidate) => invalidTargetPromotionRunBinding(candidate, runId),
      TargetPromotionAttemptIntended: (candidate) => invalidTargetPromotionRunBinding(candidate, runId),
      TargetPromotionObservedSuccess: (candidate) => invalidTargetPromotionRunBinding(candidate, runId),
      TargetPromotionStale: (candidate) => invalidTargetPromotionRunBinding(candidate, runId),
      TargetPromotionNonConvergence: (candidate) => invalidTargetPromotionRunBinding(candidate, runId),
      TargetVerificationCorrelationContradicted: (candidate) =>
        candidate.expected.candidateCorrelation.runId === runId
          ? undefined
          : "target verification contradiction expectation binds a foreign run",
      TargetVerificationIntended: (candidate) => invalidTargetVerificationRunBinding(candidate, runId),
      TargetVerificationEvidenceSealed: (candidate) => invalidTargetVerificationRunBinding(candidate, runId),
      IntegrationCandidateConstructionIntended: (candidate) =>
        candidate.plannedAttempt.runId === runId && candidate.correlation.runId === runId
          ? undefined
          : `integration work for attempt ${candidate.plannedAttempt.attemptId} binds run ${candidate.plannedAttempt.runId}`,
      IntegrationCandidateSessionSuperseded: (candidate) =>
        candidate.priorCorrelation.runId === runId && candidate.successorCorrelation.runId === runId
          ? undefined
          : "candidate session supersession binds a foreign run",
      IntegrationCandidateAgentReported: (candidate) =>
        candidate.expectedCorrelation.runId === runId
          ? undefined
          : `candidate report expectation binds run ${candidate.expectedCorrelation.runId}`,
      IntegrationCandidateGitObserved: (candidate) => invalidCandidateCorrelationRunBinding(candidate, runId),
      IntegrationCandidateGitValidationFailed: (candidate) => invalidCandidateCorrelationRunBinding(candidate, runId),
      IntegrationCandidateConstructed: (candidate) => invalidCandidateCorrelationRunBinding(candidate, runId),
      IntegrationCandidateCorrectionLimitReached: (candidate) =>
        invalidCandidateCorrelationRunBinding(candidate, runId),
      IntegrationCandidateContinuationLimitReached: (candidate) =>
        invalidCandidateCorrelationRunBinding(candidate, runId)
    }),
    Match.orElse(() => undefined)
  )

export const invalidIntegrationRunBinding = (event: WorkflowJournalEvent, runId: RunId): string | undefined => {
  if (event._tag === "IntegrationResponsibilityBegan" || event._tag === "IntegrationStarted") {
    return event.plannedAttempt.runId === runId
      ? undefined
      : `integration work for attempt ${event.plannedAttempt.attemptId} binds run ${event.plannedAttempt.runId}`
  }
  return invalidCandidateRunBinding(event, runId)
}
