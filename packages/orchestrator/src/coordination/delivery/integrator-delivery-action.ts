import { Context, Effect, Option, Schema } from "effect"
import type { RunnableFrontierTransition } from "../frontier/frontier.js"
import {
  Integrator,
  IntegratorGit,
  prepareIntegrationCandidateRun
} from "../../workflow/protocols/integrator/protocol.js"
import { appendInitialConclusiveIntegrationQuarantine } from "../../workflow/protocols/integration-quarantine/initial-conclusive.js"
import {
  appendProviderRunFailureQuarantine,
  reconcileProviderRunFailureQuarantine
} from "../../workflow/protocols/integration-quarantine/provider-failure.js"
import { appendRetryConclusiveIntegrationQuarantine } from "../../workflow/protocols/integration-quarantine/retry-conclusive.js"
import { appendPromotionStaleIntegrationQuarantine } from "../../workflow/protocols/integration-quarantine/promotion-stale.js"
import { deliveryActionCompleted, deliveryActionDeferred } from "./delivery-action-adapter-common.js"
import type { DeliveryActionExecutionLease, MaterializedDeliveryAction } from "./delivery-action-executor.js"
import { IntegratorBoundaryUnavailable } from "./integrator-boundary.js"
import {
  integratorSuccessorAppendRecordMatches,
  integratorSuccessorPreparationIsCurrent,
  prepareIntegratorSuccessorSessionAppend
} from "../../workflow/protocols/integrator/successor-session.js"
import { IntegratorJournalContradiction } from "../../workflow/protocols/integrator/errors.js"
import { ExpectedAcceptedPrefixPosition, Journal } from "./journal.js"
import { workflowJournalEventVersion } from "../../workflow/kernel/event.js"
import {
  integratorSuccessorResponsibilityMatches,
  maximumIntegratorSessionsPerResponsibility,
  type IntegratorSessionCorrelation
} from "../../workflow/protocols/integrator/events.js"
import { IntegratorCompetingHeadSuccessorAuthorizedEvent } from "../../workflow/protocols/integrator/automatic-successor-events.js"
import { remotePublicationCorrelationEquals } from "../../workflow/protocols/direct-publication/events.js"
import {
  journalRecordByKey,
  journalRecordsOfKind,
  type JournalHistorySource
} from "../../workflow-journal/record-evidence.js"
import type { JournalRecord } from "../../workflow-journal/store.js"
import { integratorCompetingHeadSuccessorAuthorizedRecordKey } from "../../workflow-journal/record-key.js"
import {
  integratorAutomaticSuccessorAppendRecordMatches,
  integratorAutomaticSuccessorPreparationIsCurrent,
  prepareIntegratorAutomaticSuccessorSessionAppend
} from "../../workflow/protocols/integrator/automatic-successor-session.js"
import { WorkflowActor } from "../../workflow/registry/actor.js"

type IdentityFreeAction = Extract<MaterializedDeliveryAction, { readonly _tag: "IdentityFreeAction" }>
type RunIntegrator = Extract<RunnableFrontierTransition, { readonly _tag: "RunIntegrator" }>
type RecordInitialConclusiveIntegrationQuarantine = Extract<
  RunnableFrontierTransition,
  { readonly _tag: "RecordInitialConclusiveIntegrationQuarantine" }
>
type RecordProviderRunFailureIntegrationQuarantine = Extract<
  RunnableFrontierTransition,
  { readonly _tag: "RecordProviderRunFailureIntegrationQuarantine" }
>
type RecordRetryConclusiveIntegrationQuarantine = Extract<
  RunnableFrontierTransition,
  { readonly _tag: "RecordRetryConclusiveIntegrationQuarantine" }
>
type RecordPromotionStaleIntegrationQuarantine = Extract<
  RunnableFrontierTransition,
  { readonly _tag: "RecordPromotionStaleIntegrationQuarantine" }
>
type FixIntegratorSuccessorSession = Extract<
  RunnableFrontierTransition,
  { readonly _tag: "FixIntegratorSuccessorSession" }
>
type AuthorizeIntegratorCompetingHeadSuccessor = Extract<
  RunnableFrontierTransition,
  { readonly _tag: "AuthorizeIntegratorCompetingHeadSuccessor" }
>
type FixIntegratorAutomaticSuccessorSession = Extract<
  RunnableFrontierTransition,
  { readonly _tag: "FixIntegratorAutomaticSuccessorSession" }
>

const fixedSessionIdsForResponsibility = (
  records: JournalHistorySource,
  predecessor: IntegratorSessionCorrelation
): Set<string> => {
  const sessions = new Set<string>()
  const addIfSameResponsibility = (session: IntegratorSessionCorrelation) => {
    if (integratorSuccessorResponsibilityMatches(predecessor, session)) sessions.add(session.sessionId)
  }
  for (const { event: prior } of journalRecordsOfKind(records, "IntegratorSessionFixed")) {
    if (prior._tag === "IntegratorSessionFixed") addIfSameResponsibility(prior.correlation)
  }
  for (const { event: prior } of journalRecordsOfKind(records, "IntegratorSuccessorSessionFixed")) {
    if (prior._tag === "IntegratorSuccessorSessionFixed") {
      addIfSameResponsibility(prior.predecessor)
      addIfSameResponsibility(prior.successor)
    }
  }
  for (const { event: prior } of journalRecordsOfKind(records, "IntegratorAutomaticSuccessorSessionFixed")) {
    if (prior._tag === "IntegratorAutomaticSuccessorSessionFixed") {
      addIfSameResponsibility(prior.predecessor)
      addIfSameResponsibility(prior.successor)
    }
  }
  return sessions
}

const automaticAuthorizationAppendMatches = (
  record: JournalRecord,
  event: IntegratorCompetingHeadSuccessorAuthorizedEvent
) =>
  record.event._tag === "IntegratorCompetingHeadSuccessorAuthorized" &&
  Schema.toEquivalence(IntegratorCompetingHeadSuccessorAuthorizedEvent)(record.event, event)

const automaticAuthorizationCanBeRecorded = (sessionCount: number, lastPosition: JournalRecord["position"] | null) =>
  sessionCount < maximumIntegratorSessionsPerResponsibility && lastPosition !== null

/** Appends the missing initial Q before releasing any held target responsibility. */
export const recordInitialConclusiveIntegrationQuarantine = Effect.fn(
  "DeliveryAction.recordInitialConclusiveIntegrationQuarantine"
)(function* (
  action: IdentityFreeAction,
  transition: RecordInitialConclusiveIntegrationQuarantine,
  lease: DeliveryActionExecutionLease
) {
  yield* appendInitialConclusiveIntegrationQuarantine(transition.result)
  yield* lease.integrationTargets.release(transition.responsibility)
  return deliveryActionCompleted(action.proposal.id)
})

/** Finishes the absence-to-Q chronology after a crash without calling the provider again. */
export const recordProviderRunFailureIntegrationQuarantine = Effect.fn(
  "DeliveryAction.recordProviderRunFailureIntegrationQuarantine"
)(function* (
  action: IdentityFreeAction,
  transition: RecordProviderRunFailureIntegrationQuarantine,
  lease: DeliveryActionExecutionLease
) {
  yield* reconcileProviderRunFailureQuarantine(transition.input)
  yield* lease.integrationTargets.release(transition.responsibility)
  return deliveryActionCompleted(action.proposal.id)
})

/** Appends Q2 for an already-recorded conclusive Retry result before releasing target ownership. */
export const recordRetryConclusiveIntegrationQuarantine = Effect.fn(
  "DeliveryAction.recordRetryConclusiveIntegrationQuarantine"
)(function* (
  action: IdentityFreeAction,
  transition: RecordRetryConclusiveIntegrationQuarantine,
  lease: DeliveryActionExecutionLease
) {
  yield* appendRetryConclusiveIntegrationQuarantine(transition.result)
  yield* lease.integrationTargets.release(transition.responsibility)
  return deliveryActionCompleted(action.proposal.id)
})

/** Appends promotion-stale Q from the exact durable stale promotion fact before releasing target ownership. */
export const recordPromotionStaleIntegrationQuarantine = Effect.fn(
  "DeliveryAction.recordPromotionStaleIntegrationQuarantine"
)(function* (
  action: IdentityFreeAction,
  transition: RecordPromotionStaleIntegrationQuarantine,
  lease: DeliveryActionExecutionLease
) {
  yield* appendPromotionStaleIntegrationQuarantine(transition.input)
  yield* lease.integrationTargets.release(transition.responsibility)
  return deliveryActionCompleted(action.proposal.id)
})

/** Fixes or reconciles S2 after FullRerun's exact Q/D/fresh-lineage chronology; it retains the held target. */
export const fixIntegratorSuccessorSession = Effect.fn("DeliveryAction.fixIntegratorSuccessorSession")(function* (
  action: IdentityFreeAction,
  transition: FixIntegratorSuccessorSession
) {
  const journal = yield* Journal
  const runId = transition.responsibility.plannedAttempt.runId
  const records = yield* journal.readAccepted(runId)
  const prepared = yield* prepareIntegratorSuccessorSessionAppend(transition.input, records)
  if (prepared._tag === "Existing") return deliveryActionCompleted(action.proposal.id)
  if (!integratorSuccessorPreparationIsCurrent(records, transition.input)) {
    return deliveryActionDeferred(action.proposal.id, "ContinuationAuthorizationStale")
  }
  if (records.lastPosition === null) {
    return deliveryActionDeferred(action.proposal.id, "ContinuationAuthorizationStale")
  }
  const appended = yield* journal.appendIfAcceptedPrefixCurrent(
    runId,
    ExpectedAcceptedPrefixPosition.make(records.lastPosition),
    prepared.key,
    prepared.event
  )
  if (appended._tag === "PrefixAdvanced") {
    return deliveryActionDeferred(action.proposal.id, "ContinuationAuthorizationStale")
  }
  if (!integratorSuccessorAppendRecordMatches(appended.record, prepared.key, prepared.event)) {
    return yield* new IntegratorJournalContradiction({
      detail: "FullRerun successor conditional append returned a foreign Journal record",
      runId
    })
  }
  return deliveryActionCompleted(action.proposal.id)
})

/** Persists one exact compatible competing-head authorization before any new Git read. */
export const authorizeIntegratorCompetingHeadSuccessor = Effect.fn(
  "DeliveryAction.authorizeIntegratorCompetingHeadSuccessor"
)(function* (action: IdentityFreeAction, transition: AuthorizeIntegratorCompetingHeadSuccessor) {
  const journal = yield* Journal
  const runId = transition.responsibility.plannedAttempt.runId
  const records = yield* journal.readAccepted(runId)
  const event = IntegratorCompetingHeadSuccessorAuthorizedEvent.make({
    authorizationId: transition.authorizationId,
    correlation: transition.correlation,
    initiatedBy: WorkflowActor.cases.DalphCoordinator.make({}),
    mergeBase: transition.mergeBase,
    occurrenceClassification: "InitiatedAction",
    remoteHead: transition.remoteHead,
    remotePublicationRetainedAt: transition.remotePublicationRetainedAt,
    version: workflowJournalEventVersion
  })
  const key = integratorCompetingHeadSuccessorAuthorizedRecordKey(transition.authorizationId)
  const existing = journalRecordByKey(records, key)
  if (existing !== undefined) {
    if (!automaticAuthorizationAppendMatches(existing, event)) {
      return yield* new IntegratorJournalContradiction({
        detail: "automatic successor authorization key identifies a different journal event",
        runId
      })
    }
    return deliveryActionCompleted(action.proposal.id)
  }
  const retained = Array.from(journalRecordsOfKind(records, "RemotePublicationRetained")).find(
    ({ event: retainedEvent, position }) =>
      retainedEvent._tag === "RemotePublicationRetained" &&
      position === transition.remotePublicationRetainedAt &&
      remotePublicationCorrelationEquals(retainedEvent.correlation, transition.correlation) &&
      retainedEvent.cause._tag === "CompatibleCompetingHead" &&
      retainedEvent.cause.mergeBase === transition.mergeBase &&
      retainedEvent.cause.remoteHead === transition.remoteHead
  )
  if (retained === undefined) return deliveryActionDeferred(action.proposal.id, "ContinuationAuthorizationStale")
  const authorizationAlreadyExists = Array.from(
    journalRecordsOfKind(records, "IntegratorCompetingHeadSuccessorAuthorized")
  ).some(
    ({ event: prior }) =>
      prior._tag === "IntegratorCompetingHeadSuccessorAuthorized" &&
      remotePublicationCorrelationEquals(prior.correlation, transition.correlation)
  )
  if (authorizationAlreadyExists) {
    return yield* new IntegratorJournalContradiction({
      detail: "one retained publication request cannot authorize a second automatic successor",
      runId
    })
  }
  const predecessor = transition.correlation.qualifiedCandidate.run.session
  const sessions = fixedSessionIdsForResponsibility(records, predecessor)
  if (!automaticAuthorizationCanBeRecorded(sessions.size, records.lastPosition)) {
    return deliveryActionDeferred(action.proposal.id, "ContinuationAuthorizationStale")
  }
  const appended = yield* journal.appendIfAcceptedPrefixCurrent(
    runId,
    ExpectedAcceptedPrefixPosition.make(records.lastPosition),
    key,
    event
  )
  if (appended._tag === "PrefixAdvanced") {
    return deliveryActionDeferred(action.proposal.id, "ContinuationAuthorizationStale")
  }
  if (!automaticAuthorizationAppendMatches(appended.record, event)) {
    return yield* new IntegratorJournalContradiction({
      detail: "automatic successor conditional append returned a foreign journal record",
      runId
    })
  }
  return deliveryActionCompleted(action.proposal.id)
})

/** Fixes the exact authorized successor with a journal CAS before its first Integrator call. */
export const fixIntegratorAutomaticSuccessorSession = Effect.fn(
  "DeliveryAction.fixIntegratorAutomaticSuccessorSession"
)(function* (action: IdentityFreeAction, transition: FixIntegratorAutomaticSuccessorSession) {
  const journal = yield* Journal
  const runId = transition.responsibility.plannedAttempt.runId
  const records = yield* journal.readAccepted(runId)
  if (!integratorAutomaticSuccessorPreparationIsCurrent(records, transition.input)) {
    return deliveryActionDeferred(action.proposal.id, "ContinuationAuthorizationStale")
  }
  const prepared = yield* prepareIntegratorAutomaticSuccessorSessionAppend(transition.input, records)
  if (prepared._tag === "Existing") return deliveryActionCompleted(action.proposal.id)
  if (records.lastPosition === null) {
    return deliveryActionDeferred(action.proposal.id, "ContinuationAuthorizationStale")
  }
  const appended = yield* journal.appendIfAcceptedPrefixCurrent(
    runId,
    ExpectedAcceptedPrefixPosition.make(records.lastPosition),
    prepared.key,
    prepared.event
  )
  if (appended._tag === "PrefixAdvanced") {
    return deliveryActionDeferred(action.proposal.id, "ContinuationAuthorizationStale")
  }
  if (!integratorAutomaticSuccessorAppendRecordMatches(appended.record, prepared.key, prepared.event)) {
    return yield* new IntegratorJournalContradiction({
      detail: "automatic successor conditional append returned a foreign journal record",
      runId
    })
  }
  return deliveryActionCompleted(action.proposal.id)
})

/** Executes one outer session under the exact target permit and always releases process-local ownership afterward. */
export const executeIntegratorAction = Effect.fn("DeliveryAction.runIntegrator")(function* (
  action: IdentityFreeAction,
  transition: RunIntegrator,
  lease: DeliveryActionExecutionLease
) {
  const context = yield* Effect.context<never>()
  const integrator = Context.getOption(context, Integrator)
  if (Option.isNone(integrator)) return yield* new IntegratorBoundaryUnavailable({ boundary: "Integrator" })
  const git = Context.getOption(context, IntegratorGit)
  if (Option.isNone(git)) return yield* new IntegratorBoundaryUnavailable({ boundary: "Git" })
  return yield* lease.integrationTargets
    .withPermit(
      transition.responsibility,
      prepareIntegrationCandidateRun({
        preparation: {
          responsibility: transition.responsibility,
          targetLineage: transition.lineage,
          targetLineageObservedAt: transition.lineageObservedAt
        },
        run: transition.run
      }).pipe(
        Effect.provideService(Integrator, integrator.value),
        Effect.provideService(IntegratorGit, git.value),
        Effect.tap((result) =>
          result._tag !== "NotPrepared" && result._tag !== "CandidateRejected"
            ? Effect.void
            : result.run.ordinal === 1
              ? appendInitialConclusiveIntegrationQuarantine(result)
              : appendRetryConclusiveIntegrationQuarantine(result)
        ),
        Effect.catchTag("IntegratorProviderActivityAbsent", (failure) =>
          appendProviderRunFailureQuarantine({ failure, run: transition.run })
        )
      )
    )
    .pipe(
      Effect.ensuring(lease.integrationTargets.release(transition.responsibility)),
      Effect.as(deliveryActionCompleted(action.proposal.id)),
      Effect.catchTag("IntegratorGitReadFailure", (failure) =>
        Effect.succeed(deliveryActionDeferred(action.proposal.id, failure))
      )
    )
})
