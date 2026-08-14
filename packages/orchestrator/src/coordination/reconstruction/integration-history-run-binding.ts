import type { RunId } from "@dalph/contracts"
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

const candidateCorrelatedEventTags: ReadonlySet<string> = new Set([
  "IntegrationCandidateGitObserved",
  "IntegrationCandidateGitValidationFailed",
  "IntegrationCandidateConstructed",
  "IntegrationCandidateCorrectionLimitReached",
  "IntegrationCandidateContinuationLimitReached"
])

const invalidCandidateRunBinding = (event: WorkflowJournalEvent, runId: RunId): string | undefined => {
  if (
    event._tag === "TargetPromotionIntended" ||
    event._tag === "TargetPromotionAttemptIntended" ||
    event._tag === "TargetPromotionObservedSuccess" ||
    event._tag === "TargetPromotionStale" ||
    event._tag === "TargetPromotionNonConvergence"
  ) {
    return event.correlation.candidateCorrelation.runId === runId &&
      event.correlation.verificationCorrelation.candidateCorrelation.runId === runId
      ? undefined
      : `target promotion binds run ${event.correlation.candidateCorrelation.runId}`
  }
  if (event._tag === "TargetVerificationCorrelationContradicted") {
    return event.expected.candidateCorrelation.runId === runId
      ? undefined
      : "target verification contradiction expectation binds a foreign run"
  }
  if (event._tag === "TargetVerificationIntended" || event._tag === "TargetVerificationEvidenceSealed") {
    return event.correlation.candidateCorrelation.runId === runId
      ? undefined
      : `target verification binds run ${event.correlation.candidateCorrelation.runId}`
  }
  if (event._tag === "IntegrationCandidateConstructionIntended") {
    return event.plannedAttempt.runId === runId && event.correlation.runId === runId
      ? undefined
      : `integration work for attempt ${event.plannedAttempt.attemptId} binds run ${event.plannedAttempt.runId}`
  }
  if (event._tag === "IntegrationCandidateSessionSuperseded") {
    return event.priorCorrelation.runId === runId && event.successorCorrelation.runId === runId
      ? undefined
      : "candidate session supersession binds a foreign run"
  }
  if (event._tag === "IntegrationCandidateAgentReported") {
    return event.expectedCorrelation.runId === runId
      ? undefined
      : `candidate report expectation binds run ${event.expectedCorrelation.runId}`
  }
  if (candidateCorrelatedEventTags.has(event._tag) && "correlation" in event) {
    return event.correlation.runId === runId ? undefined : `candidate event binds run ${event.correlation.runId}`
  }
  return undefined
}

export const invalidIntegrationRunBinding = (event: WorkflowJournalEvent, runId: RunId): string | undefined => {
  if (event._tag === "IntegrationResponsibilityBegan" || event._tag === "IntegrationStarted") {
    return event.plannedAttempt.runId === runId
      ? undefined
      : `integration work for attempt ${event.plannedAttempt.attemptId} binds run ${event.plannedAttempt.runId}`
  }
  return invalidCandidateRunBinding(event, runId)
}
