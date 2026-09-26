import type { ReconstructedRunState } from "../reconstruction/state.js"
import { journalRecordsOfKind } from "../../workflow-journal/record-evidence.js"
import {
  integratorRunQualifiedCandidateFromState,
  type CurrentIntegratorState
} from "../../workflow/protocols/integrator/state.js"
import { integratorSessionCapacityForJournal } from "../../workflow/protocols/integrator/session-capacity.js"
import { integratorCompetingHeadSuccessorAuthorizationIdFor } from "../../workflow/protocols/integrator/automatic-successor-events.js"
import {
  remotePublicationCorrelationEquals,
  remotePublicationCorrelationFor
} from "../../workflow/protocols/direct-publication/events.js"
import { deriveRemotePublicationState } from "../../workflow/protocols/direct-publication/state.js"
import { remotePublicationEventsFor } from "../../workflow/protocols/direct-publication/transition-journal.js"

const lastRecordOffset = -1

/** A transient projection of exact publication evidence; never a journal authority or retry permission. */
export type PublicationContinuation = ReturnType<typeof derivePublicationContinuation>

/** One history projection feeds actions, target retention, and visible waits for a responsibility. */
export const derivePublicationContinuation = (runState: ReconstructedRunState, state: CurrentIntegratorState) => {
  if (state._tag !== "GitQualifiedPrepared") return undefined
  const source = runState.workflowHistory.evidence
  const began = Array.from(journalRecordsOfKind(source, "WorkflowRunBegan"))[0]
  if (began?.event._tag !== "WorkflowRunBegan") return undefined
  const candidate = integratorRunQualifiedCandidateFromState(state)
  const target = began.event.remotePublicationTarget
  const correlation = remotePublicationCorrelationFor(candidate, target)
  const events = remotePublicationEventsFor(source, correlation)
  const publication = deriveRemotePublicationState(events)
  const qualified = { candidate, correlation, publication, target }
  if (publication._tag !== "PublicationRetained" || publication.cause._tag !== "CompatibleCompetingHead") {
    return {
      ...qualified,
      _tag: "Publication" as const,
      succeeded: events.findLast((event) => event._tag === "RemotePublicationSucceeded")
    }
  }
  const { mergeBase, remoteHead } = publication.cause
  const compatibleRetained = Array.from(journalRecordsOfKind(source, "RemotePublicationRetained")).filter(
    ({ event }) =>
      event._tag === "RemotePublicationRetained" &&
      remotePublicationCorrelationEquals(event.correlation, correlation) &&
      event.cause._tag === "CompatibleCompetingHead" &&
      event.cause.mergeBase === mergeBase &&
      event.cause.remoteHead === remoteHead
  )
  const retained = compatibleRetained.at(lastRecordOffset)
  const authorizationRecords = Array.from(
    journalRecordsOfKind(source, "IntegratorCompetingHeadSuccessorAuthorized")
  ).filter(
    ({ event }) =>
      event._tag === "IntegratorCompetingHeadSuccessorAuthorized" &&
      remotePublicationCorrelationEquals(event.correlation, correlation)
  )
  // A later compatible receipt may add a retained occurrence. Its prior exact
  // authorization remains usable; replay does not authorize another session.
  const authorizations = authorizationRecords.filter(
    ({ event, position }) =>
      event._tag === "IntegratorCompetingHeadSuccessorAuthorized" &&
      event.mergeBase === mergeBase &&
      event.remoteHead === remoteHead &&
      compatibleRetained.some(
        ({ position: retainedAt }) =>
          event.remotePublicationRetainedAt === retainedAt &&
          position > retainedAt &&
          event.authorizationId ===
            integratorCompetingHeadSuccessorAuthorizationIdFor(correlation.requestId, retainedAt, mergeBase, remoteHead)
      )
  )
  const compatible = { ...qualified, mergeBase, remoteHead }
  const authorization = authorizations[0]
  if (authorization !== undefined) {
    return {
      ...compatible,
      _tag: "AuthorizedSuccessor" as const,
      authorization,
      retainsTarget: authorizations.some(({ runId }) => runId === state.run.session.plannedAttempt.runId)
    }
  }
  if (retained === undefined || authorizationRecords.length > 0) {
    return { ...compatible, _tag: "BlockedCompatibleHead" as const }
  }
  if (integratorSessionCapacityForJournal(source, state.run.session)._tag === "Exhausted") {
    return { ...compatible, _tag: "BoundedRetainedWait" as const, retainedAt: retained.position }
  }
  return {
    ...compatible,
    _tag: "NeedsAuthorization" as const,
    retainedAt: retained.position,
    authorizationId: integratorCompetingHeadSuccessorAuthorizationIdFor(
      correlation.requestId,
      retained.position,
      mergeBase,
      remoteHead
    )
  }
}
