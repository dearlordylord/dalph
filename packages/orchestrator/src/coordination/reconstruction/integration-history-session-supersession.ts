import { acceptedResultEquivalence } from "../../workflow/protocols/integration-admission/responsibility.js"
import { integrationCandidateCorrelationEquals } from "../../workflow/protocols/integration-candidate-construction/events.js"
import type { WorkflowJournalEvent } from "../../workflow/registry/event.js"
import type { IntegrationHistoryIndexes } from "./integration-history.js"
import {
  candidateKey,
  priorSessionSupersessionKey,
  sessionSupersessionKey,
  setMapValue
} from "./integration-history-run-binding.js"

type CandidateSessionSupersessionEvent = Extract<
  WorkflowJournalEvent,
  { readonly _tag: "IntegrationCandidateSessionSuperseded" }
>

const hasMatchingPriorCandidate = (
  event: CandidateSessionSupersessionEvent,
  indexes: IntegrationHistoryIndexes
): boolean => {
  const priorIntent = indexes.integrationCandidateIntents.get(candidateKey(event.priorCorrelation))
  const priorConstructed = [...indexes.integrationCandidatesConstructed.values()].some(
    (candidate) =>
      candidate.correlation.candidateId === event.priorCorrelation.candidateId &&
      integrationCandidateCorrelationEquals(candidate.correlation, event.priorCorrelation) &&
      candidate.candidateCommit === event.priorCandidateCommit
  )
  return (
    priorIntent !== undefined &&
    integrationCandidateCorrelationEquals(priorIntent.correlation, event.priorCorrelation) &&
    priorConstructed
  )
}

const hasMatchingStartedResponsibility = (
  event: CandidateSessionSupersessionEvent,
  indexes: IntegrationHistoryIndexes
): boolean => {
  const priorIntent = indexes.integrationCandidateIntents.get(candidateKey(event.priorCorrelation))
  const started = indexes.integrationStarted.get(event.startedAt)
  return (
    priorIntent !== undefined &&
    started !== undefined &&
    event.responsibilityBeganAt === priorIntent.responsibilityBeganAt &&
    event.startedAt === priorIntent.startedAt
  )
}

const hasUnusedCandidateSessionKeys = (
  event: CandidateSessionSupersessionEvent,
  indexes: IntegrationHistoryIndexes
): boolean =>
  !indexes.integrationCandidateSessionSupersessionsByPrior.has(priorSessionSupersessionKey(event.priorCorrelation)) &&
  !indexes.integrationCandidateSessionSupersessions.has(sessionSupersessionKey(event.successorCorrelation))

const hasDistinctSuccessorResource = (event: CandidateSessionSupersessionEvent): boolean =>
  event.priorCorrelation.expectedTargetHead !== event.observedTargetHead &&
  event.priorCorrelation.candidateResource !== event.successorCorrelation.candidateResource

const hasMatchingIntegrationTarget = (
  event: CandidateSessionSupersessionEvent,
  indexes: IntegrationHistoryIndexes
): boolean => {
  const started = indexes.integrationStarted.get(event.startedAt)
  return (
    started !== undefined &&
    event.priorCorrelation.integrationTarget.repository === event.successorCorrelation.integrationTarget.repository &&
    event.priorCorrelation.integrationTarget.ref === event.successorCorrelation.integrationTarget.ref &&
    started.integrationTarget.repository === event.priorCorrelation.integrationTarget.repository &&
    started.integrationTarget.ref === event.priorCorrelation.integrationTarget.ref
  )
}

const hasMatchingAcceptedResults = (
  event: CandidateSessionSupersessionEvent,
  indexes: IntegrationHistoryIndexes
): boolean => {
  const started = indexes.integrationStarted.get(event.startedAt)
  return (
    started !== undefined &&
    acceptedResultEquivalence(started.acceptedResult, {
      commit: event.priorCorrelation.acceptedResultCommit,
      evidenceManifest: event.priorCorrelation.acceptanceManifest
    }) &&
    acceptedResultEquivalence(started.acceptedResult, {
      commit: event.successorCorrelation.acceptedResultCommit,
      evidenceManifest: event.successorCorrelation.acceptanceManifest
    })
  )
}

export const invalidCandidateSessionSupersession = (
  event: CandidateSessionSupersessionEvent,
  indexes: IntegrationHistoryIndexes
): string | undefined => {
  const valid =
    hasMatchingPriorCandidate(event, indexes) &&
    hasMatchingStartedResponsibility(event, indexes) &&
    hasUnusedCandidateSessionKeys(event, indexes) &&
    hasDistinctSuccessorResource(event) &&
    hasMatchingIntegrationTarget(event, indexes) &&
    hasMatchingAcceptedResults(event, indexes)
  if (valid) {
    setMapValue(
      indexes.integrationCandidateSessionSupersessions,
      sessionSupersessionKey(event.successorCorrelation),
      event
    )
    setMapValue(
      indexes.integrationCandidateSessionSupersessionsByPrior,
      priorSessionSupersessionKey(event.priorCorrelation),
      event
    )
  }
  return valid ? undefined : "candidate session supersession has no exact earlier constructed candidate"
}
