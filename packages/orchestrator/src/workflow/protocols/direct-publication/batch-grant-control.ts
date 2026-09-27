import type { RunId } from "@dalph/contracts"
import { Effect, Schema } from "effect"
import { JournalPosition } from "../../../workflow-journal/identity.js"
import {
  journalRecordByPosition,
  journalRecordsForRemotePublicationBatchGrantRequest,
  journalRecordsOfKind,
  type JournalHistorySource
} from "../../../workflow-journal/record-evidence.js"
import type { JournalRecord } from "../../../workflow-journal/store.js"
import { remotePublicationBatchGrantRecordKey } from "../../../workflow-journal/record-key.js"
import { ExpectedAcceptedPrefixPosition, type JournalService } from "../../../coordination/delivery/journal.js"
import { workflowJournalEventVersion } from "../../kernel/event.js"
import { WorkflowActor } from "../../registry/actor.js"
import {
  integrationResponsibilityEquivalence,
  StartedIntegrationResponsibility
} from "../integration-admission/responsibility.js"
import { integratorSessionCapacityForJournal } from "../integrator/session-capacity.js"
import { deriveCurrentIntegratorState, integratorRunQualifiedCandidateFromState } from "../integrator/state.js"
import {
  RemotePublicationBatchGrantAppliedEvent,
  RemotePublicationBatchGrantRequest,
  RemotePublicationBatchGrantRequestId,
  remotePublicationAttemptLimit,
  remotePublicationCorrelationFor,
  remotePublicationCorrelationEquals,
  type RemotePublicationBatchGrantRequest as RemotePublicationBatchGrantRequestValue
} from "./events.js"
import { RemotePublicationBatchGrantRequestConflict, RemotePublicationBatchGrantSubjectMismatch } from "./errors.js"
import { remotePublicationEventsFor, validateRemotePublicationState } from "./transition-journal.js"

const lastElementOffset = -1 // eslint-disable-line no-magic-numbers -- select the exact latest retained occurrence

/** The durable grant receipt, including the exact exhaustion occurrence it authorizes. */
export const RemotePublicationBatchGrantReceipt = Schema.TaggedStruct("RemotePublicationBatchGrantReceipt", {
  acceptedAt: JournalPosition,
  exhaustionAt: JournalPosition,
  requestId: RemotePublicationBatchGrantRequestId
})
export type RemotePublicationBatchGrantReceipt = typeof RemotePublicationBatchGrantReceipt.Type

/** Process-local distinction ensures only a new receipt publishes accepted progress to a live owner. */
export type RemotePublicationBatchGrantAdmission =
  | { readonly _tag: "NewlyRecordedBatchGrant"; readonly result: RemotePublicationBatchGrantReceipt }
  | { readonly _tag: "BatchGrantReplay"; readonly result: RemotePublicationBatchGrantReceipt }
  | { readonly _tag: "BatchGrantAlreadyRecordedForExhaustion"; readonly result: RemotePublicationBatchGrantReceipt }

const requestEquivalence = Schema.toEquivalence(RemotePublicationBatchGrantRequest)

const receipt = (
  acceptedAt: JournalPosition,
  exhaustionAt: JournalPosition,
  requestId: RemotePublicationBatchGrantRequestId
): RemotePublicationBatchGrantReceipt =>
  RemotePublicationBatchGrantReceipt.make({ acceptedAt, exhaustionAt, requestId })

const decodeRequestForRun = Effect.fn("RemotePublicationBatchGrant.decodeRequest")(function* (
  expectedRunId: RunId,
  unknownRequest: unknown
) {
  const request = yield* Schema.decodeUnknownEffect(RemotePublicationBatchGrantRequest, { onExcessProperty: "error" })(
    unknownRequest
  )
  if (request.runId !== expectedRunId || request.responsibility.runId !== expectedRunId) {
    return yield* new RemotePublicationBatchGrantSubjectMismatch({ requestId: request.requestId, runId: expectedRunId })
  }
  return request
})

const sameGrantSubject = (
  left: RemotePublicationBatchGrantRequestValue,
  right: RemotePublicationBatchGrantRequestValue
): boolean =>
  left.runId === right.runId &&
  left.responsibility.runId === right.responsibility.runId &&
  left.responsibility.queuedAt === right.responsibility.queuedAt &&
  left.exhaustionAt === right.exhaustionAt

const previousGrant = (
  prefix: JournalHistorySource,
  request: RemotePublicationBatchGrantRequestValue
): RemotePublicationBatchGrantAdmission | { readonly _tag: "BatchGrantRequestConflict" } | undefined => {
  const grants = Array.from(journalRecordsOfKind(prefix, "RemotePublicationBatchGrantApplied")).filter(
    (record) => record.event._tag === "RemotePublicationBatchGrantApplied"
  )
  const byRequest = Array.from(journalRecordsForRemotePublicationBatchGrantRequest(prefix, request.requestId))[0]
  if (byRequest !== undefined && byRequest.event._tag === "RemotePublicationBatchGrantApplied") {
    if (!requestEquivalence(byRequest.event.request, request)) {
      return { _tag: "BatchGrantRequestConflict" }
    }
    return {
      _tag: "BatchGrantReplay",
      result: receipt(byRequest.position, byRequest.event.request.exhaustionAt, byRequest.event.request.requestId)
    }
  }
  const bySubject = grants.find(
    (record) =>
      record.event._tag === "RemotePublicationBatchGrantApplied" && sameGrantSubject(record.event.request, request)
  )
  return bySubject?.event._tag === "RemotePublicationBatchGrantApplied"
    ? {
        _tag: "BatchGrantAlreadyRecordedForExhaustion",
        result: receipt(bySubject.position, bySubject.event.request.exhaustionAt, bySubject.event.request.requestId)
      }
    : undefined
}

const startedResponsibilityForRequest = (
  prefix: JournalHistorySource,
  expectedRunId: RunId,
  request: RemotePublicationBatchGrantRequestValue
): StartedIntegrationResponsibility | undefined => {
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
  return StartedIntegrationResponsibility.make({
    acceptedResult: queued.event.acceptedResult,
    integrationTarget: queued.event.integrationTarget,
    plannedAttempt: queued.event.plannedAttempt,
    queuedAt: queued.position,
    startedAt: started.position
  })
}

type WorkflowRunBeganRecord = Omit<JournalRecord, "event"> & {
  readonly event: Extract<JournalRecord["event"], { readonly _tag: "WorkflowRunBegan" }>
}

const workflowRunBeganFor = (prefix: JournalHistorySource, runId: RunId): WorkflowRunBeganRecord | undefined =>
  Array.from(journalRecordsOfKind(prefix, "WorkflowRunBegan")).find(
    (record): record is WorkflowRunBeganRecord => record.runId === runId && record.event._tag === "WorkflowRunBegan"
  )

const publicationExhaustionIsCurrent = Effect.fn("RemotePublicationBatchGrant.verifyExhaustion")(function* (
  prefix: JournalHistorySource,
  expectedRunId: RunId,
  request: RemotePublicationBatchGrantRequestValue
) {
  const occurrence = journalRecordByPosition(prefix, request.exhaustionAt)
  if (
    occurrence === undefined ||
    occurrence.runId !== expectedRunId ||
    occurrence.event._tag !== "RemotePublicationRetained"
  ) {
    return false
  }
  const { cause, correlation } = occurrence.event
  if (
    correlation.qualifiedCandidate.run.session.plannedAttempt.runId !== expectedRunId ||
    correlation.qualifiedCandidate.run.session.queuedAt !== request.responsibility.queuedAt
  ) {
    return false
  }
  const responsibility = startedResponsibilityForRequest(prefix, expectedRunId, request)
  if (
    responsibility === undefined ||
    !integrationResponsibilityEquivalence(responsibility, correlation.qualifiedCandidate.run.session)
  ) {
    return false
  }
  const began = workflowRunBeganFor(prefix, expectedRunId)
  if (began === undefined) {
    return false
  }
  const currentIntegrator = deriveCurrentIntegratorState(prefix, responsibility)
  if (currentIntegrator._tag !== "GitQualifiedPrepared") return false
  const currentCorrelation = remotePublicationCorrelationFor(
    integratorRunQualifiedCandidateFromState(currentIntegrator),
    began.event.remotePublicationTarget
  )
  if (!remotePublicationCorrelationEquals(correlation, currentCorrelation)) return false
  const matchingRetained = Array.from(journalRecordsOfKind(prefix, "RemotePublicationRetained")).filter(
    (record) =>
      record.event._tag === "RemotePublicationRetained" &&
      remotePublicationCorrelationEquals(record.event.correlation, correlation)
  )
  if (matchingRetained.at(lastElementOffset)?.position !== occurrence.position) return false

  const state = yield* validateRemotePublicationState(prefix, correlation)
  if (state._tag !== "PublicationRetained" || state.cause._tag !== cause._tag) return false
  if (cause._tag === "AttemptsExhausted") {
    const attempts = remotePublicationEventsFor(prefix, correlation).filter(
      (event) => event._tag === "RemotePublicationAttemptIntended"
    )
    return attempts.length === remotePublicationAttemptLimit
  }
  if (cause._tag === "CompatibleCompetingHead") {
    return integratorSessionCapacityForJournal(prefix, correlation.qualifiedCandidate.run.session)._tag === "Exhausted"
  }
  return false
})

/** Records a distinct Full rerun grant only for a still-current, exact publication-exhaustion occurrence. */
export const applyRemotePublicationBatchGrantWithAdmission = (
  expectedRunId: RunId,
  journal: JournalService,
  unknownRequest: unknown
) => {
  const evaluate = Effect.fn("RemotePublicationBatchGrant.evaluateAcceptedPrefix")(function* () {
    // CAS retries are limited to accepted-prefix advances; each retry revalidates O and its exact responsibility.
    // oxlint-disable-next-line typescript/no-unnecessary-condition -- CAS revalidation repeats only after another accepted append.
    while (true) {
      const request = yield* decodeRequestForRun(expectedRunId, unknownRequest)
      const state = yield* journal.state.get
      const prefix = state.prefix
      const duplicate = previousGrant(prefix, request)
      if (duplicate?._tag === "BatchGrantRequestConflict") {
        return yield* new RemotePublicationBatchGrantRequestConflict({ requestId: request.requestId })
      }
      if (duplicate !== undefined) return duplicate
      const began = workflowRunBeganFor(prefix, expectedRunId)
      const terminated = Array.from(journalRecordsOfKind(prefix, "WorkflowRunTerminated")).some(
        ({ event }) => event._tag === "WorkflowRunTerminated"
      )
      if (
        began === undefined ||
        terminated ||
        !(yield* publicationExhaustionIsCurrent(prefix, expectedRunId, request))
      ) {
        return yield* new RemotePublicationBatchGrantSubjectMismatch({
          requestId: request.requestId,
          runId: expectedRunId
        })
      }
      const event = RemotePublicationBatchGrantAppliedEvent.make({
        direction: "FullRerun",
        initiatedBy: WorkflowActor.cases.Operator.make({}),
        occurrenceClassification: "InitiatedAction",
        request,
        version: workflowJournalEventVersion
      })
      const append = yield* journal.appendIfAcceptedPrefixCurrent(
        expectedRunId,
        ExpectedAcceptedPrefixPosition.make(state.position),
        remotePublicationBatchGrantRecordKey(request),
        event
      )
      if (append._tag === "PrefixAdvanced") continue
      return {
        _tag: "NewlyRecordedBatchGrant",
        result: receipt(append.record.position, request.exhaustionAt, request.requestId)
      } satisfies RemotePublicationBatchGrantAdmission
    }
  })
  return evaluate()
}

/** Redelivery of one exact Full rerun request returns the durable grant receipt without another append. */
export const applyRemotePublicationBatchGrant = (
  expectedRunId: RunId,
  journal: JournalService,
  unknownRequest: unknown
) =>
  applyRemotePublicationBatchGrantWithAdmission(expectedRunId, journal, unknownRequest).pipe(
    Effect.map(({ result }) => result)
  )
