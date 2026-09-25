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

const decodeResumeRequestForRun = Effect.fn("RemotePublicationResume.decodeRequest")(function* (
  expectedRunId: RunId,
  unknownRequest: unknown
) {
  const request = yield* Schema.decodeUnknownEffect(RemotePublicationResumeRequest, { onExcessProperty: "error" })(
    unknownRequest
  )
  if (request.runId !== expectedRunId || request.responsibility.runId !== expectedRunId) {
    return yield* new RemotePublicationResumeSubjectMismatch({ requestId: request.requestId, runId: expectedRunId })
  }
  return request
})

const previousResumeAdmission = Effect.fn("RemotePublicationResume.readPreviousReceipt")(function* (
  prefix: JournalHistorySource,
  request: RemotePublicationResumeRequestValue
) {
  const duplicate = Array.from(journalRecordsOfKind(prefix, "RemotePublicationResumeRequested")).find(
    ({ event }) => event._tag === "RemotePublicationResumeRequested" && event.request.requestId === request.requestId
  )
  if (duplicate === undefined || duplicate.event._tag !== "RemotePublicationResumeRequested") return undefined
  if (!resumeRequestEquivalence(duplicate.event.request, request)) {
    return yield* new RemotePublicationResumeRequestConflict({ requestId: request.requestId })
  }
  return replayAdmission(duplicate.position, duplicate.event.correlation.requestId, request.requestId)
})

const startedResponsibilityForRequest = (
  prefix: JournalHistorySource,
  expectedRunId: RunId,
  request: RemotePublicationResumeRequestValue
): typeof StartedIntegrationResponsibility.Type | undefined => {
  const queued = journalRecordByPosition(prefix, request.responsibility.queuedAt)
  if (queued?.event._tag !== "IntegrationResponsibilityBegan" || queued.runId !== expectedRunId) return undefined
  const started = Array.from(journalRecordsOfKind(prefix, "IntegrationStarted")).find(
    ({ event }) => event._tag === "IntegrationStarted" && event.responsibilityBeganAt === queued.position
  )
  if (
    started?.event._tag !== "IntegrationStarted" ||
    !integrationResponsibilityEquivalence(started.event, queued.event)
  ) {
    return undefined
  }
  const responsibility = StartedIntegrationResponsibility.make({
    acceptedResult: queued.event.acceptedResult,
    integrationTarget: queued.event.integrationTarget,
    plannedAttempt: queued.event.plannedAttempt,
    queuedAt: queued.position,
    startedAt: started.position
  })
  return responsibilityMatchesRequest(responsibility, request) ? responsibility : undefined
}

const workflowRunBeganFor = (prefix: JournalHistorySource, expectedRunId: RunId) =>
  Array.from(journalRecordsOfKind(prefix, "WorkflowRunBegan")).find(({ runId }) => runId === expectedRunId)

const exactResumeSubjectFor = Effect.fn("RemotePublicationResume.verifyResponsibility")(function* (
  prefix: JournalHistorySource,
  expectedRunId: RunId,
  request: RemotePublicationResumeRequestValue
) {
  const responsibility = startedResponsibilityForRequest(prefix, expectedRunId, request)
  if (responsibility === undefined) {
    return yield* new RemotePublicationResumeSubjectMismatch({ requestId: request.requestId, runId: expectedRunId })
  }
  const began = workflowRunBeganFor(prefix, expectedRunId)
  if (began?.event._tag !== "WorkflowRunBegan") {
    return yield* new RemotePublicationResumeSubjectMismatch({ requestId: request.requestId, runId: expectedRunId })
  }
  return { began, responsibility }
})

const currentIntegratorPublication = (
  prefix: JournalHistorySource,
  responsibility: typeof StartedIntegrationResponsibility.Type,
  target: Parameters<typeof remotePublicationCorrelationFor>[1]
) => {
  const integrator = deriveCurrentIntegratorState(prefix, responsibility)
  if (integrator._tag === "Contradiction") {
    return {
      _tag: "Status" as const,
      result: statusAdmission(RemotePublicationState.cases.PublicationContradiction.make({ detail: integrator.detail }))
    }
  }
  if (integrator._tag !== "GitQualifiedPrepared") {
    return { _tag: "Status" as const, result: statusAdmission(RemotePublicationState.cases.PublicationAbsent.make({})) }
  }
  const candidate = integratorRunQualifiedCandidateFromState(integrator)
  return { _tag: "Prepared" as const, candidate, correlation: remotePublicationCorrelationFor(candidate, target) }
}

const workflowRunIsTerminated = (source: JournalHistorySource): boolean =>
  Array.from(journalRecordsOfKind(source, "WorkflowRunTerminated")).some(
    ({ event }) => event._tag === "WorkflowRunTerminated"
  )

const resumeStatusIfNotEligible = (
  prefix: JournalHistorySource,
  candidate: ReturnType<typeof integratorRunQualifiedCandidateFromState>,
  correlation: ReturnType<typeof remotePublicationCorrelationFor>,
  state: typeof RemotePublicationState.Type
): RemotePublicationResumeAdmission | undefined => {
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
  const attempts = remotePublicationEventsFor(prefix, correlation).filter(
    (event) => event._tag === "RemotePublicationAttemptIntended"
  ).length
  if (!continueProvedFinality && attempts >= remotePublicationAttemptLimit) return statusAdmission(state)
  return undefined
}

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
      const request = yield* decodeResumeRequestForRun(expectedRunId, unknownRequest)

      const journalState = yield* journal.state.get
      const prefix = journalState.prefix
      const duplicate = yield* previousResumeAdmission(prefix, request)
      if (duplicate !== undefined) return duplicate

      const { began, responsibility } = yield* exactResumeSubjectFor(prefix, expectedRunId, request)
      const publication = currentIntegratorPublication(prefix, responsibility, began.event.remotePublicationTarget)
      if (publication._tag === "Status") return publication.result

      const state = yield* validateRemotePublicationState(prefix, publication.correlation)
      const status = resumeStatusIfNotEligible(prefix, publication.candidate, publication.correlation, state)
      if (status !== undefined) return status

      const event = RemotePublicationResumeRequestedEvent.make({
        correlation: publication.correlation,
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
        result: receiptResult(append.record.position, publication.correlation.requestId, request.requestId)
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
