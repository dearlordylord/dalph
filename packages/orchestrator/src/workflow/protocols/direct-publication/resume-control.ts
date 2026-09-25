import type { RunId } from "@dalph/contracts"
import { Effect, Schema } from "effect"
import { JournalPosition } from "../../../workflow-journal/identity.js"
import {
  journalRecordByPosition,
  journalRecordsOfKind,
  type JournalHistorySource
} from "../../../workflow-journal/record-evidence.js"
import { remotePublicationResumeRequestedRecordKey } from "../../../workflow-journal/record-key.js"
import { ExpectedAcceptedPrefixPosition, type JournalService } from "../../../coordination/delivery/journal.js"
import { workflowJournalEventVersion } from "../../kernel/event.js"
import { WorkflowActor } from "../../registry/actor.js"
import {
  integrationResponsibilityEquivalence,
  StartedIntegrationResponsibility
} from "../integration-admission/responsibility.js"
import { deriveCurrentIntegratorState, integratorRunQualifiedCandidateFromState } from "../integrator/state.js"
import { isIntegrationFinalitySettledForCandidate } from "../integration-finality/settled-candidate.js"
import {
  RemotePublicationRequestId,
  RemotePublicationResumeRequest,
  RemotePublicationResumeRequestId,
  RemotePublicationResumeRequestedEvent,
  remotePublicationAttemptLimit,
  remotePublicationCorrelationFor,
  type RemotePublicationResumeRequest as RemotePublicationResumeRequestValue
} from "./events.js"
import { RemotePublicationResumeRequestConflict, RemotePublicationResumeSubjectMismatch } from "./errors.js"
import { remotePublicationRetainedCauseIsResumable, RemotePublicationState } from "./state.js"
import { remotePublicationEventsFor, validateRemotePublicationState } from "./transition-journal.js"

/** One durable receipt result. Replaying the same request returns this same value and position. */
export const RemotePublicationResumeReceipt = Schema.TaggedStruct("RemotePublicationResumeReceipt", {
  acceptedAt: JournalPosition,
  publicationRequestId: RemotePublicationRequestId,
  requestId: RemotePublicationResumeRequestId
})
export type RemotePublicationResumeReceipt = typeof RemotePublicationResumeReceipt.Type

/** Non-receipt results report the exact current publication projection without authorizing a retry. */
export const RemotePublicationResumeStatus = Schema.TaggedStruct("RemotePublicationResumeStatus", {
  state: RemotePublicationState
})
export type RemotePublicationResumeStatus = typeof RemotePublicationResumeStatus.Type

export type RemotePublicationResumeControlResult = RemotePublicationResumeReceipt | RemotePublicationResumeStatus

/** Process-local admission outcome used to notify a live Run owner only for a new receipt. */
export type RemotePublicationResumeAdmission =
  | { readonly _tag: "NewlyRecordedResumeReceipt"; readonly result: RemotePublicationResumeReceipt }
  | { readonly _tag: "ResumeReceiptReplay"; readonly result: RemotePublicationResumeReceipt }
  | { readonly _tag: "ResumeStatus"; readonly result: RemotePublicationResumeStatus }

const resumeRequestEquivalence = Schema.toEquivalence(RemotePublicationResumeRequest)

const receiptResult = (
  acceptedAt: JournalPosition,
  publicationRequestId: typeof RemotePublicationRequestId.Type,
  requestId: typeof RemotePublicationResumeRequestId.Type
): RemotePublicationResumeReceipt =>
  RemotePublicationResumeReceipt.make({ acceptedAt, publicationRequestId, requestId })

const statusResult = (state: typeof RemotePublicationState.Type): RemotePublicationResumeStatus =>
  RemotePublicationResumeStatus.make({ state })

const replayAdmission = (
  acceptedAt: JournalPosition,
  publicationRequestId: typeof RemotePublicationRequestId.Type,
  requestId: typeof RemotePublicationResumeRequestId.Type
): RemotePublicationResumeAdmission => ({
  _tag: "ResumeReceiptReplay",
  result: receiptResult(acceptedAt, publicationRequestId, requestId)
})

const statusAdmission = (state: typeof RemotePublicationState.Type): RemotePublicationResumeAdmission => ({
  _tag: "ResumeStatus",
  result: statusResult(state)
})

const responsibilityMatchesRequest = (
  responsibility: typeof StartedIntegrationResponsibility.Type,
  request: RemotePublicationResumeRequestValue
): boolean =>
  responsibility.plannedAttempt.runId === request.runId &&
  responsibility.plannedAttempt.runId === request.responsibility.runId &&
  responsibility.queuedAt === request.responsibility.queuedAt

const workflowRunIsTerminated = (source: JournalHistorySource): boolean =>
  journalRecordsOfKind(source, "WorkflowRunTerminated").some(({ event }) => event._tag === "WorkflowRunTerminated")

/**
 * Records a transport-neutral resume request against the current retained
 * publication for its exact Run responsibility. The candidate and destination
 * come from accepted Run history; a caller cannot select either one.
 */
export const applyRemotePublicationResumeWithAdmission = (
  expectedRunId: RunId,
  journal: JournalService,
  unknownRequest: unknown
) => {
  const evaluate = Effect.fn("RemotePublicationResume.evaluateAcceptedPrefix")(function* () {
    // oxlint-disable-next-line typescript/no-unnecessary-condition -- CAS revalidation repeats only when another append advances the prefix.
    while (true) {
      const request = yield* Schema.decodeUnknownEffect(RemotePublicationResumeRequest, { onExcessProperty: "error" })(
        unknownRequest
      )
      if (request.runId !== expectedRunId || request.responsibility.runId !== expectedRunId) {
        return yield* new RemotePublicationResumeSubjectMismatch({ requestId: request.requestId, runId: expectedRunId })
      }

      const journalState = yield* journal.state.get
      const prefix = journalState.prefix
      const duplicate = journalRecordsOfKind(prefix, "RemotePublicationResumeRequested").find(
        ({ event }) => event.request.requestId === request.requestId
      )
      if (duplicate !== undefined && duplicate.event._tag === "RemotePublicationResumeRequested") {
        if (!resumeRequestEquivalence(duplicate.event.request, request)) {
          return yield* new RemotePublicationResumeRequestConflict({ requestId: request.requestId })
        }
        return replayAdmission(duplicate.position, duplicate.event.correlation.requestId, request.requestId)
      }

      const queued = journalRecordByPosition(prefix, request.responsibility.queuedAt)
      if (queued?.event._tag !== "IntegrationResponsibilityBegan" || queued.runId !== expectedRunId) {
        return yield* new RemotePublicationResumeSubjectMismatch({ requestId: request.requestId, runId: expectedRunId })
      }
      const started = journalRecordsOfKind(prefix, "IntegrationStarted").find(
        ({ event }) => event.responsibilityBeganAt === queued.position
      )
      if (
        started?.event._tag !== "IntegrationStarted" ||
        !integrationResponsibilityEquivalence(started.event, queued.event)
      ) {
        return yield* new RemotePublicationResumeSubjectMismatch({ requestId: request.requestId, runId: expectedRunId })
      }
      const responsibility = StartedIntegrationResponsibility.make({
        acceptedResult: queued.event.acceptedResult,
        integrationTarget: queued.event.integrationTarget,
        plannedAttempt: queued.event.plannedAttempt,
        queuedAt: queued.position,
        startedAt: started.position
      })
      if (!responsibilityMatchesRequest(responsibility, request)) {
        return yield* new RemotePublicationResumeSubjectMismatch({ requestId: request.requestId, runId: expectedRunId })
      }

      const began = journalRecordsOfKind(prefix, "WorkflowRunBegan").find(({ runId }) => runId === expectedRunId)
      if (began?.event._tag !== "WorkflowRunBegan") {
        return yield* new RemotePublicationResumeSubjectMismatch({ requestId: request.requestId, runId: expectedRunId })
      }
      const integrator = deriveCurrentIntegratorState(prefix, responsibility)
      if (integrator._tag === "Contradiction") {
        return statusAdmission(
          RemotePublicationState.cases.PublicationContradiction.make({ detail: integrator.detail })
        )
      }
      if (integrator._tag !== "GitQualifiedPrepared") {
        return statusAdmission(RemotePublicationState.cases.PublicationAbsent.make({}))
      }

      const candidate = integratorRunQualifiedCandidateFromState(integrator)
      const correlation = remotePublicationCorrelationFor(candidate, began.event.remotePublicationTarget)
      const state = yield* validateRemotePublicationState(prefix, correlation)
      const continueProvedFinality =
        state._tag === "PublicationSucceeded" &&
        !isIntegrationFinalitySettledForCandidate(prefix, candidate) &&
        !workflowRunIsTerminated(prefix)
      if (
        !continueProvedFinality &&
        (state._tag !== "PublicationRetained" || !remotePublicationRetainedCauseIsResumable(state.cause))
      ) {
        return statusAdmission(state)
      }
      const events = remotePublicationEventsFor(prefix, correlation)
      const attempts = events.filter((event) => event._tag === "RemotePublicationAttemptIntended").length
      if (!continueProvedFinality && attempts >= remotePublicationAttemptLimit) return statusAdmission(state)

      const event = RemotePublicationResumeRequestedEvent.make({
        correlation,
        initiatedBy: WorkflowActor.cases.Operator.make({}),
        occurrenceClassification: "InitiatedAction",
        request,
        version: workflowJournalEventVersion
      })
      const append = yield* journal.appendIfAcceptedPrefixCurrent(
        expectedRunId,
        ExpectedAcceptedPrefixPosition.make(journalState.position),
        remotePublicationResumeRequestedRecordKey(request.requestId),
        event
      )
      if (append._tag === "PrefixAdvanced") continue
      return {
        _tag: "NewlyRecordedResumeReceipt",
        result: receiptResult(append.record.position, correlation.requestId, request.requestId)
      } satisfies RemotePublicationResumeAdmission
    }
  })
  return evaluate()
}

/** Records a transport-neutral exact resume request; duplicate receipt replay is a no-op. */
export const applyRemotePublicationResume = (expectedRunId: RunId, journal: JournalService, unknownRequest: unknown) =>
  applyRemotePublicationResumeWithAdmission(expectedRunId, journal, unknownRequest).pipe(
    Effect.map(({ result }) => result)
  )
