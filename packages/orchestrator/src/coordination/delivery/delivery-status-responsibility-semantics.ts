import type { ResponsibilityDisposition, ResponsibilityFreshFacts } from "../frontier/fresh-facts.js"
import {
  type DeliveryStatusTrackerFact,
  type DeliveryStatusUnavailableEvidence,
  type DeliveryStatusWakeCondition
} from "./delivery-status-model.js"

type TrackerFactProjection = {
  readonly fact: DeliveryStatusTrackerFact
  readonly wakeCondition: DeliveryStatusWakeCondition
}

const missingTrackerFact: TrackerFactProjection = {
  fact: { _tag: "Missing", boundary: "TaskTracker" },
  wakeCondition: "ExplicitAppliedTaskClaimReacquisitionDirection"
}
const unreadableTrackerFact: TrackerFactProjection = {
  fact: { _tag: "Unreadable", boundary: "TaskTracker" },
  wakeCondition: "TaskClaimFactsObserved"
}
const foreignTrackerFact: TrackerFactProjection = {
  fact: { _tag: "Foreign", boundary: "TaskTracker" },
  wakeCondition: "ExplicitAppliedTaskClaimReacquisitionDirection"
}
const unobservedTrackerFact: TrackerFactProjection = {
  fact: { _tag: "Unobserved", boundary: "TaskTracker" },
  wakeCondition: "TaskClaimFactsObserved"
}
const taskTrackerRereadFact: TrackerFactProjection = {
  fact: { _tag: "Unreadable", boundary: "TaskTracker" },
  wakeCondition: "BoundaryRereadSucceeded"
}

export const trackerFactForClaimState = (
  claimState: "Foreign" | "Missing" | "Unreadable" | "Unobserved"
): TrackerFactProjection => {
  if (claimState === "Missing") return missingTrackerFact
  if (claimState === "Unreadable") return unreadableTrackerFact
  if (claimState === "Foreign") return foreignTrackerFact
  return unobservedTrackerFact
}

const directTrackerFactForDisposition = (facts: ResponsibilityFreshFacts): TrackerFactProjection | null => {
  const disposition = facts.disposition
  if (disposition._tag === "TaskClaimMissingConstraint" || disposition._tag === "MissingClaim") {
    return missingTrackerFact
  }
  if (disposition._tag === "TaskClaimUnreadableWait") return unreadableTrackerFact
  if (disposition._tag === "TaskForeignClaimIsolation" || disposition._tag === "ForeignClaimIsolation") {
    return foreignTrackerFact
  }
  return null
}

export const trackerFactForDisposition = (facts: ResponsibilityFreshFacts): TrackerFactProjection | null => {
  const disposition = facts.disposition
  if (disposition._tag === "WorkflowOperationTaskClaimConstraint") {
    return trackerFactForClaimState(disposition.claimState)
  }
  if (disposition._tag === "UnreadableFactWait" && disposition.boundary === "TaskTracker") {
    return taskTrackerRereadFact
  }
  return directTrackerFactForDisposition(facts)
}

type ResponsibilityStatusMeaning =
  | "DependencyWait"
  | "Relinquishment"
  | "Settlement"
  | "TrackerFact"
  | "UnavailableEvidence"
  | "NoEntry"

type AcceptedStandingSettlementTag = "CancelledAttemptSettled" | "StoppedAttemptSettled"

type AcceptedStandingSettlementDisposition = Extract<
  ResponsibilityDisposition,
  { readonly _tag: AcceptedStandingSettlementTag }
>

export const acceptedStandingSettlementDispositionFor = (
  facts: ResponsibilityFreshFacts
): AcceptedStandingSettlementDisposition | null => {
  const disposition = facts.disposition
  return disposition._tag === "CancelledAttemptSettled" || disposition._tag === "StoppedAttemptSettled"
    ? disposition
    : null
}

export const acceptedStandingSettlementTagFor = (
  facts: ResponsibilityFreshFacts
): AcceptedStandingSettlementTag | null => {
  return acceptedStandingSettlementDispositionFor(facts)?._tag ?? null
}

/** Every fresh responsibility disposition has one explicit passive-status meaning. */
const responsibilityStatusMeaningByTag = {
  AttemptRestartRequired: "NoEntry",
  AttemptRestartRejected: "UnavailableEvidence",
  AttemptRestartWait: "UnavailableEvidence",
  AttemptStoppageRequired: "NoEntry",
  AttemptStoppageExecutorObservationRequired: "NoEntry",
  AttemptStoppageWait: "UnavailableEvidence",
  CancelledAttemptRelinquishmentRequired: "NoEntry",
  CancelledAttemptClaimNoReleaseRequired: "NoEntry",
  CancelledAttemptClaimObservationRequired: "NoEntry",
  CancelledAttemptClaimReleaseRequired: "NoEntry",
  CancelledAttemptClaimReleaseRetryRequired: "NoEntry",
  CancelledAttemptClaimReleasePending: "UnavailableEvidence",
  CancelledAttemptClaimPlanningWait: "UnavailableEvidence",
  CancelledAttemptClaimUnreadableWait: "UnavailableEvidence",
  CancelledAttemptSettled: "Settlement",
  DependencyWait: "DependencyWait",
  FinalOutcome: "NoEntry",
  PlannedAttemptExecutorWorkSafelySuspended: "NoEntry",
  PlannedAttemptExecutorWorkTerminal: "NoEntry",
  PlannedAttemptExecutorProjectionWait: "UnavailableEvidence",
  PlannedAttemptExecutorSuspensionRequested: "NoEntry",
  StoppedAttemptClaimNoReleaseRequired: "NoEntry",
  StoppedAttemptClaimObservationRequired: "NoEntry",
  StoppedAttemptClaimReleaseRequired: "NoEntry",
  StoppedAttemptClaimReleaseRetryRequired: "NoEntry",
  StoppedAttemptClaimReleasePending: "UnavailableEvidence",
  StoppedAttemptClaimPlanningWait: "UnavailableEvidence",
  StoppedAttemptClaimUnreadableWait: "UnavailableEvidence",
  StoppedAttemptSettled: "Settlement",
  PlannedAttemptGitConstraint: "UnavailableEvidence",
  TaskExternalSuccessConstraint: "UnavailableEvidence",
  TaskExternalSuccessReleaseNeeded: "NoEntry",
  TaskExternalSuccessSettled: "NoEntry",
  TaskClaimMissingConstraint: "TrackerFact",
  TaskClaimUnreadableWait: "TrackerFact",
  TaskForeignClaimIsolation: "TrackerFact",
  AppliedTaskClaimReacquisitionDirection: "NoEntry",
  WorkflowOperationTaskClaimConstraint: "TrackerFact",
  WorkflowOperationGitConstraint: "UnavailableEvidence",
  TaskLifecycleConstraint: "UnavailableEvidence",
  TaskMembershipConstraint: "UnavailableEvidence",
  TaskSpecificationChangeConstraint: "UnavailableEvidence",
  ForeignClaimIsolation: "TrackerFact",
  MissingClaim: "TrackerFact",
  Paused: "NoEntry",
  Ready: "NoEntry",
  Relinquished: "Relinquishment",
  Settled: "NoEntry",
  UnreadableFactWait: "UnavailableEvidence"
} as const satisfies Record<ResponsibilityDisposition["_tag"], ResponsibilityStatusMeaning>

const responsibilityStatusMeaningFor = (facts: ResponsibilityFreshFacts): ResponsibilityStatusMeaning => {
  if (facts.disposition._tag === "UnreadableFactWait" && facts.disposition.boundary === "TaskTracker") {
    return "TrackerFact"
  }
  return responsibilityStatusMeaningByTag[facts.disposition._tag]
}

export const unavailableFromFacts = (facts: ResponsibilityFreshFacts): DeliveryStatusUnavailableEvidence | null =>
  responsibilityStatusMeaningFor(facts) === "UnavailableEvidence" ? { _tag: "ResponsibilityFacts", facts } : null
