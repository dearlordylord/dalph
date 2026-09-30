/* eslint-disable max-lines -- Publication execution and reconciliation stay adjacent at one auditable protocol boundary. */
import type { RemotePublicationTarget } from "@dalph/contracts"
import { Effect, Schema } from "effect"
import { integrationResponsibilityIdentity } from "../integration-admission/responsibility.js"
import type { IntegratorRunQualifiedCandidate } from "../integrator/events.js"
import { isIntegrationFinalitySettledForCandidate } from "../integration-finality/settled-candidate.js"
import {
  isJournalRecordEvidence,
  journalEvidenceBefore,
  journalRecordsOfKind
} from "../../../workflow-journal/record-evidence.js"
import {
  RemotePublicationAttemptOrdinal,
  RemotePublicationAttemptAuthorization,
  RemotePublicationGit,
  type RemotePublicationObservationFailure,
  RemotePublicationProofBasis,
  RemotePublicationResumeRequest,
  remotePublicationAttemptLimit,
  type RemotePublicationPushFailure,
  RemotePublicationRetainedCause,
  remotePublicationCorrelationFor,
  remotePublicationGitRequestFor
} from "./events.js"
import {
  remotePublicationAttemptsExhausted,
  remotePublicationRetainedCauseIsResumable,
  RemotePublicationState,
  type RemotePublicationState as RemotePublicationStateType
} from "./state.js"
import {
  appendRemotePublicationAttemptIntent,
  appendRemotePublicationAttemptRejection,
  appendRemotePublicationIntent,
  appendRemotePublicationRetained,
  appendRemotePublicationResumeRequest,
  appendRemotePublicationSuccess,
  readAcceptedRemotePublicationEvidence,
  remotePublicationBatchGrantForNextAttempt,
  remotePublicationEventsFor,
  validateRemotePublicationState,
  type CurrentRemotePublicationEvidence
} from "./transition-journal.js"
import { RemotePublicationResumeRequestConflict, RemotePublicationResumeSubjectMismatch } from "./errors.js"
import type { InRunJournalRunMismatch, JournalError } from "../../../workflow-journal/store.js"

/** Post-resume continuation through the ordinary Run frontier. */
export type RemotePublicationResumeDispatch =
  | {
      readonly _tag: "ContinueDirectPublication"
      readonly state: Extract<
        RemotePublicationStateType,
        { readonly _tag: "PublicationAbsent" | "PublicationPending" | "PublicationResumeReady" }
      >
    }
  | {
      readonly _tag: "PublicationStatus"
      readonly state: Extract<
        RemotePublicationStateType,
        { readonly _tag: "PublicationContradiction" | "PublicationRetained" }
      >
    }
  | {
      readonly _tag: "ContinueFinality"
      readonly state: Extract<RemotePublicationStateType, { readonly _tag: "PublicationSucceeded" }>
    }
  | {
      readonly _tag: "ContinueRunFrontier"
      readonly state: Extract<RemotePublicationStateType, { readonly _tag: "PublicationRetained" }>
    }

/** Route compatible competition through the ordinary Run frontier without creating a recovery engine. */
export const remotePublicationResumeDispatchOf = (
  state: RemotePublicationStateType
): RemotePublicationResumeDispatch => {
  if (state._tag === "PublicationRetained" && state.cause._tag === "CompatibleCompetingHead")
    return { _tag: "ContinueRunFrontier", state }
  if (
    state._tag === "PublicationAbsent" ||
    state._tag === "PublicationPending" ||
    state._tag === "PublicationResumeReady"
  ) {
    return { _tag: "ContinueDirectPublication", state }
  }
  if (state._tag === "PublicationSucceeded") return { _tag: "ContinueFinality", state }
  return { _tag: "PublicationStatus", state }
}

/**
 * Runtime continuation installed by the ordinary delivery owner. Published
 * candidates continue through its existing promotion/finality selection;
 * compatible competition is handed to the existing same-commit owner.
 */
export interface RemotePublicationResumeDispatchBoundary<E = never, R = never> {
  readonly dispatch: (dispatch: RemotePublicationResumeDispatch) => Effect.Effect<void, E, R>
}

const resumeOutcomeNeedsContinuation = (state: RemotePublicationStateType): boolean =>
  state._tag === "PublicationAbsent" ||
  state._tag === "PublicationPending" ||
  state._tag === "PublicationResumeReady" ||
  state._tag === "PublicationSucceeded" ||
  (state._tag === "PublicationRetained" && state.cause._tag === "CompatibleCompetingHead")

const lastElementOffset = -1

/** Exit authority around each publication phase that can start new Git work. */
export interface RemotePublicationPhaseBoundary {
  readonly runObservation: <A, E, R>(
    phase: Effect.Effect<A, E, R>
  ) => Effect.Effect<A, E | JournalError | InRunJournalRunMismatch, R>
  readonly runSender: <A, E, R>(
    phase: Effect.Effect<A, E, R>
  ) => Effect.Effect<A, E | JournalError | InRunJournalRunMismatch, R>
}

const retainedCauseForObservationFailure = (failure: RemotePublicationObservationFailure) =>
  RemotePublicationRetainedCause.cases.ObservationUnavailable.make({ reason: failure.reason })

const retainedCauseForPushFailure = (failure: RemotePublicationPushFailure) =>
  failure.reason === "SenderStopUnproven"
    ? RemotePublicationRetainedCause.cases.PushCustodyUnproven.make({})
    : RemotePublicationRetainedCause.cases.PushEndpointMappingChanged.make({})

/** Stateless direct-publication engine; durable history is reread before every effectful boundary. */
export const makeRemotePublicationEngine = <E, R>(readEvidence: CurrentRemotePublicationEvidence<E, R>) => {
  const runRemotePublication = Effect.fn("RemotePublication.run")(function* (
    candidate: IntegratorRunQualifiedCandidate,
    target: RemotePublicationTarget,
    phaseBoundary: RemotePublicationPhaseBoundary
  ) {
    const correlation = remotePublicationCorrelationFor(candidate, target)
    const source = yield* readEvidence(candidate.run.session.plannedAttempt.runId)
    const reconstructed = yield* validateRemotePublicationState(source, correlation)
    if (reconstructed._tag === "PublicationSucceeded") return reconstructed
    const grantForNextAttempt = remotePublicationBatchGrantForNextAttempt(source, correlation, reconstructed)
    if (reconstructed._tag === "PublicationRetained" && grantForNextAttempt === undefined) return reconstructed
    const initialAuthorization = RemotePublicationAttemptAuthorization.cases.InitialAttempt.make({})
    const authorization =
      reconstructed._tag === "PublicationResumeReady"
        ? RemotePublicationAttemptAuthorization.cases.ResumeRequest.make({ requestId: reconstructed.request.requestId })
        : reconstructed._tag === "PublicationPending"
          ? reconstructed.authorization
          : initialAuthorization
    const grantedBatchAt = grantForNextAttempt?.position
    const initialAttemptOrdinals =
      reconstructed._tag === "PublicationAbsent" || reconstructed._tag === "PublicationRetained"
        ? []
        : (reconstructed.attemptOrdinalsInBatch ?? reconstructed.attemptOrdinals)
    let pendingState: Extract<RemotePublicationStateType, { readonly _tag: "PublicationPending" }> =
      reconstructed._tag === "PublicationAbsent"
        ? yield* appendRemotePublicationIntent(correlation).pipe(
            Effect.as(
              RemotePublicationState.cases.PublicationPending.make({
                attemptOrdinals: [],
                attemptOrdinalsInBatch: [],
                authorization: initialAuthorization,
                ...(grantedBatchAt === undefined ? {} : { batchGrantAt: grantedBatchAt }),
                correlation
              })
            )
          )
        : reconstructed._tag === "PublicationRetained"
          ? RemotePublicationState.cases.PublicationPending.make({
              attemptOrdinals: remotePublicationEventsFor(source, correlation).flatMap((event) =>
                event._tag === "RemotePublicationAttemptIntended" ? [event.attemptOrdinal] : []
              ),
              attemptOrdinalsInBatch: [],
              authorization: initialAuthorization,
              ...(grantedBatchAt === undefined ? {} : { batchGrantAt: grantedBatchAt }),
              correlation: reconstructed.correlation
            })
          : reconstructed._tag === "PublicationResumeReady"
            ? RemotePublicationState.cases.PublicationPending.make({
                attemptOrdinals: reconstructed.attemptOrdinals,
                attemptOrdinalsInBatch: initialAttemptOrdinals,
                authorization,
                ...(reconstructed.batchGrantAt === undefined ? {} : { batchGrantAt: reconstructed.batchGrantAt }),
                correlation: reconstructed.correlation
              })
            : reconstructed.attemptOrdinals.length === 0 && grantedBatchAt !== undefined
              ? RemotePublicationState.cases.PublicationPending.make({
                  ...reconstructed,
                  attemptOrdinalsInBatch: [],
                  batchGrantAt: grantedBatchAt
                })
              : reconstructed
    const pendingAttemptAtActivation =
      reconstructed._tag === "PublicationPending" || reconstructed._tag === "PublicationResumeReady"
        ? reconstructed.attemptOrdinals.at(lastElementOffset)
        : undefined
    const git = yield* RemotePublicationGit
    const request = remotePublicationGitRequestFor(correlation)
    const prepareAttemptIntent = Effect.fn("RemotePublication.prepareAttemptIntent")(function* (
      attemptOrdinal: RemotePublicationAttemptOrdinal
    ) {
      const prepared = yield* git
        .prepareSenderCustody(request, attemptOrdinal)
        .pipe(Effect.match({ onFailure: () => false, onSuccess: () => true }))
      if (!prepared) {
        const cause = RemotePublicationRetainedCause.cases.PushCustodyUnproven.make({})
        yield* appendRemotePublicationRetained(
          correlation,
          cause,
          pendingState.authorization,
          pendingState.batchGrantAt
        )
        return RemotePublicationState.cases.PublicationRetained.make({
          attemptOrdinalsInBatch: pendingState.attemptOrdinalsInBatch ?? pendingState.attemptOrdinals,
          authorization: pendingState.authorization,
          ...(pendingState.batchGrantAt === undefined ? {} : { batchGrantAt: pendingState.batchGrantAt }),
          cause,
          correlation
        })
      }
      yield* appendRemotePublicationAttemptIntent(correlation, attemptOrdinal, pendingState.batchGrantAt)
    })
    const observationResult = yield* phaseBoundary.runObservation(
      Effect.gen(function* () {
        const pendingOrdinalAtActivation = pendingAttemptAtActivation
        if (pendingOrdinalAtActivation !== undefined) {
          const custody = yield* git
            .reconcileSenderCustody(request, pendingOrdinalAtActivation)
            .pipe(
              Effect.matchEffect({
                onFailure: (failure) => Effect.succeed({ _tag: "Unproven" as const, failure }),
                onSuccess: () => Effect.succeed({ _tag: "Stopped" as const })
              })
            )
          if (custody._tag === "Unproven") {
            const cause = RemotePublicationRetainedCause.cases.PushCustodyUnproven.make({})
            yield* appendRemotePublicationRetained(
              correlation,
              cause,
              pendingState.authorization,
              pendingState.batchGrantAt
            )
            return { _tag: "Retained" as const, cause }
          }
        }
        const observationResult = yield* git.observe(request).pipe(
          Effect.map((observation) => ({ _tag: "Observed" as const, observation })),
          Effect.catchTag("RemotePublicationObservationFailure", (failure) =>
            Effect.succeed({ _tag: "Unavailable" as const, failure })
          )
        )
        if (observationResult._tag === "Unavailable") {
          const cause = retainedCauseForObservationFailure(observationResult.failure)
          yield* appendRemotePublicationRetained(
            correlation,
            cause,
            pendingState.authorization,
            pendingState.batchGrantAt
          )
          return { _tag: "Retained" as const, cause }
        }
        if (
          observationResult.observation._tag === "CandidateCurrent" ||
          observationResult.observation._tag === "CandidateAncestor"
        ) {
          const existingOrdinal = pendingAttemptAtActivation
          const attemptOrdinal =
            existingOrdinal === undefined
              ? RemotePublicationAttemptOrdinal.make(pendingState.attemptOrdinals.length + 1)
              : existingOrdinal
          if (existingOrdinal === undefined) {
            const preparation = yield* prepareAttemptIntent(attemptOrdinal)
            if (preparation !== undefined) return { _tag: "SucceededOrRetained" as const, state: preparation }
          }
          const proof =
            observationResult.observation._tag === "CandidateCurrent"
              ? RemotePublicationProofBasis.cases.ReconciledCandidateCurrent.make({
                  attemptOrdinal,
                  remoteHead: observationResult.observation.remoteHead
                })
              : RemotePublicationProofBasis.cases.ReconciledCandidateAncestor.make({
                  attemptOrdinal,
                  remoteHead: observationResult.observation.remoteHead
                })
          yield* appendRemotePublicationSuccess(correlation, proof)
          return {
            _tag: "SucceededOrRetained" as const,
            state: RemotePublicationState.cases.PublicationSucceeded.make({ correlation, proof })
          }
        }
        return observationResult
      })
    )
    if (observationResult._tag === "SucceededOrRetained") return observationResult.state
    if (observationResult._tag === "Retained") {
      return RemotePublicationState.cases.PublicationRetained.make({
        attemptOrdinalsInBatch: pendingState.attemptOrdinalsInBatch ?? pendingState.attemptOrdinals,
        authorization: pendingState.authorization,
        ...(pendingState.batchGrantAt === undefined ? {} : { batchGrantAt: pendingState.batchGrantAt }),
        cause: observationResult.cause,
        correlation
      })
    }
    const { observation } = observationResult
    return yield* phaseBoundary.runSender(
      Effect.gen(function* () {
        const retainedCause =
          observation._tag === "CompatibleCompetingHead"
            ? RemotePublicationRetainedCause.cases.CompatibleCompetingHead.make({
                mergeBase: observation.mergeBase,
                remoteHead: observation.remoteHead
              })
            : observation._tag === "IncompatibleLineage"
              ? RemotePublicationRetainedCause.cases.IncompatibleLineage.make({ remoteHead: observation.remoteHead })
              : observation._tag === "TargetMissing"
                ? RemotePublicationRetainedCause.cases.TargetMissing.make({})
                : undefined
        if (retainedCause !== undefined) {
          yield* appendRemotePublicationRetained(
            correlation,
            retainedCause,
            pendingState.authorization,
            pendingState.batchGrantAt
          )
          return RemotePublicationState.cases.PublicationRetained.make({
            attemptOrdinalsInBatch: pendingState.attemptOrdinalsInBatch ?? pendingState.attemptOrdinals,
            authorization: pendingState.authorization,
            ...(pendingState.batchGrantAt === undefined ? {} : { batchGrantAt: pendingState.batchGrantAt }),
            cause: retainedCause,
            correlation
          })
        }
        if (remotePublicationAttemptsExhausted(pendingState)) {
          const cause = RemotePublicationRetainedCause.cases.AttemptsExhausted.make({})
          yield* appendRemotePublicationRetained(
            correlation,
            cause,
            pendingState.authorization,
            pendingState.batchGrantAt
          )
          return RemotePublicationState.cases.PublicationRetained.make({
            attemptOrdinalsInBatch: pendingState.attemptOrdinalsInBatch ?? pendingState.attemptOrdinals,
            authorization: pendingState.authorization,
            ...(pendingState.batchGrantAt === undefined ? {} : { batchGrantAt: pendingState.batchGrantAt }),
            cause,
            correlation
          })
        }
        const attemptOrdinal = RemotePublicationAttemptOrdinal.make(pendingState.attemptOrdinals.length + 1)
        const preparation = yield* prepareAttemptIntent(attemptOrdinal)
        if (preparation !== undefined) return preparation
        const pushResult = yield* git.push(request, attemptOrdinal).pipe(
          Effect.map((result) => ({ _tag: "Result" as const, result })),
          Effect.catchTag("RemotePublicationPushFailure", (failure) =>
            Effect.succeed({ _tag: "Failure" as const, failure })
          )
        )
        if (pushResult._tag === "Failure") {
          pendingState = RemotePublicationState.cases.PublicationPending.make({
            attemptOrdinals: [...pendingState.attemptOrdinals, attemptOrdinal],
            attemptOrdinalsInBatch: [
              ...(pendingState.attemptOrdinalsInBatch ?? pendingState.attemptOrdinals),
              attemptOrdinal
            ],
            authorization: pendingState.authorization,
            ...(pendingState.batchGrantAt === undefined ? {} : { batchGrantAt: pendingState.batchGrantAt }),
            correlation
          })
          if (pushResult.failure.reason === "ResponseDeadline" || pushResult.failure.reason === "TransportUnavailable")
            return pendingState
          const cause = retainedCauseForPushFailure(pushResult.failure)
          yield* appendRemotePublicationRetained(
            correlation,
            cause,
            pendingState.authorization,
            pendingState.batchGrantAt
          )
          return RemotePublicationState.cases.PublicationRetained.make({
            attemptOrdinalsInBatch: pendingState.attemptOrdinalsInBatch ?? pendingState.attemptOrdinals,
            authorization: pendingState.authorization,
            ...(pendingState.batchGrantAt === undefined ? {} : { batchGrantAt: pendingState.batchGrantAt }),
            cause,
            correlation
          })
        }
        const { result } = pushResult
        if (result._tag === "Applied" || result._tag === "UpToDate") {
          const proof =
            result._tag === "Applied"
              ? RemotePublicationProofBasis.cases.PushApplied.make({ attemptOrdinal, remoteHead: result.remoteHead })
              : RemotePublicationProofBasis.cases.PushUpToDate.make({ attemptOrdinal, remoteHead: result.remoteHead })
          yield* appendRemotePublicationSuccess(correlation, proof)
          return RemotePublicationState.cases.PublicationSucceeded.make({ correlation, proof })
        }
        if (result._tag === "RejectedNonFastForward") {
          yield* appendRemotePublicationAttemptRejection(correlation, attemptOrdinal)
          pendingState = RemotePublicationState.cases.PublicationPending.make({
            attemptOrdinals: [...pendingState.attemptOrdinals, attemptOrdinal],
            attemptOrdinalsInBatch: [
              ...(pendingState.attemptOrdinalsInBatch ?? pendingState.attemptOrdinals),
              attemptOrdinal
            ],
            authorization: pendingState.authorization,
            ...(pendingState.batchGrantAt === undefined ? {} : { batchGrantAt: pendingState.batchGrantAt }),
            correlation
          })
          return pendingState
        }
        const cause =
          result._tag === "Throttled"
            ? RemotePublicationRetainedCause.cases.Throttled.make({})
            : result.cause === "Authentication"
              ? RemotePublicationRetainedCause.cases.AuthenticationDenied.make({})
              : result.cause === "Policy"
                ? RemotePublicationRetainedCause.cases.PolicyDenied.make({})
                : RemotePublicationRetainedCause.cases.RemoteDenied.make({})
        pendingState = RemotePublicationState.cases.PublicationPending.make({
          attemptOrdinals: [...pendingState.attemptOrdinals, attemptOrdinal],
          attemptOrdinalsInBatch: [
            ...(pendingState.attemptOrdinalsInBatch ?? pendingState.attemptOrdinals),
            attemptOrdinal
          ],
          authorization: pendingState.authorization,
          ...(pendingState.batchGrantAt === undefined ? {} : { batchGrantAt: pendingState.batchGrantAt }),
          correlation
        })
        yield* appendRemotePublicationRetained(
          correlation,
          cause,
          pendingState.authorization,
          pendingState.batchGrantAt
        )
        return RemotePublicationState.cases.PublicationRetained.make({
          attemptOrdinalsInBatch: pendingState.attemptOrdinalsInBatch ?? pendingState.attemptOrdinals,
          authorization: pendingState.authorization,
          ...(pendingState.batchGrantAt === undefined ? {} : { batchGrantAt: pendingState.batchGrantAt }),
          cause,
          correlation
        })
      })
    )
  })

  const resumeRemotePublicationOutcome = Effect.fn("RemotePublication.resumeRetainedOutcome")(function* (
    candidate: IntegratorRunQualifiedCandidate,
    target: RemotePublicationTarget,
    unknownRequest: unknown,
    phaseBoundary: RemotePublicationPhaseBoundary
  ) {
    const request = yield* Schema.decodeUnknownEffect(RemotePublicationResumeRequest, { onExcessProperty: "error" })(
      unknownRequest
    )
    const expectedRunId = candidate.run.session.plannedAttempt.runId
    const expectedResponsibility = integrationResponsibilityIdentity({
      plannedAttempt: candidate.run.session.plannedAttempt,
      queuedAt: candidate.run.session.queuedAt
    })
    if (
      request.runId !== expectedRunId ||
      request.responsibility.runId !== expectedResponsibility.runId ||
      request.responsibility.queuedAt !== expectedResponsibility.queuedAt
    ) {
      return yield* new RemotePublicationResumeSubjectMismatch({ requestId: request.requestId, runId: expectedRunId })
    }

    const correlation = remotePublicationCorrelationFor(candidate, target)
    const source = yield* readEvidence(expectedRunId)
    const recordedReceipt = Array.from(journalRecordsOfKind(source, "RemotePublicationResumeRequested")).find(
      ({ event }) => event._tag === "RemotePublicationResumeRequested" && event.request.requestId === request.requestId
    )
    if (recordedReceipt !== undefined && recordedReceipt.event._tag === "RemotePublicationResumeRequested") {
      const sameRequest = Schema.toEquivalence(RemotePublicationResumeRequest)(recordedReceipt.event.request, request)
      if (!sameRequest) return yield* new RemotePublicationResumeRequestConflict({ requestId: request.requestId })

      const recordedCorrelation = recordedReceipt.event.correlation
      const laterReceipt = Array.from(journalRecordsOfKind(source, "RemotePublicationResumeRequested")).find(
        (record) =>
          record.position > recordedReceipt.position &&
          record.event._tag === "RemotePublicationResumeRequested" &&
          record.event.request.responsibility.runId === request.responsibility.runId &&
          record.event.request.responsibility.queuedAt === request.responsibility.queuedAt
      )
      const recordedResultSource =
        laterReceipt === undefined
          ? source
          : isJournalRecordEvidence(source)
            ? journalEvidenceBefore(source, laterReceipt.position)
            : source.filter((record) => record.position < laterReceipt.position)
      const recordedCandidate = recordedCorrelation.qualifiedCandidate
      const recordedState = yield* validateRemotePublicationState(recordedResultSource, recordedCorrelation)
      if (laterReceipt !== undefined) return { state: recordedState, activated: false }
      if (recordedState._tag === "PublicationSucceeded") {
        return {
          state: recordedState,
          activated: !isIntegrationFinalitySettledForCandidate(recordedResultSource, recordedCandidate)
        }
      }
      if (recordedState._tag === "PublicationResumeReady" && recordedState.request.requestId === request.requestId) {
        return {
          state: yield* runRemotePublication(recordedCandidate, recordedCorrelation.target, phaseBoundary),
          activated: true
        }
      }
      if (
        recordedState._tag === "PublicationRetained" &&
        recordedState.cause._tag === "CompatibleCompetingHead" &&
        recordedState.authorization._tag === "ResumeRequest" &&
        recordedState.authorization.requestId === request.requestId
      ) {
        return { state: recordedState, activated: true }
      }
      const recordedEvents = remotePublicationEventsFor(recordedResultSource, recordedCorrelation)
      const latestRecordedEvent = recordedEvents.at(recordedEvents.length - 1)
      if (
        recordedState._tag === "PublicationPending" &&
        recordedState.authorization._tag === "ResumeRequest" &&
        recordedState.authorization.requestId === request.requestId &&
        latestRecordedEvent?._tag === "RemotePublicationAttemptIntended" &&
        latestRecordedEvent.attemptOrdinal ===
          recordedState.attemptOrdinals.at(recordedState.attemptOrdinals.length - 1)
      ) {
        return {
          state: yield* runRemotePublication(recordedCandidate, recordedCorrelation.target, phaseBoundary),
          activated: true
        }
      }
      return { state: recordedState, activated: false }
    }

    const state = yield* validateRemotePublicationState(source, correlation)
    const events = remotePublicationEventsFor(source, correlation)
    if (state._tag === "PublicationSucceeded")
      return { state, activated: !isIntegrationFinalitySettledForCandidate(source, candidate) }
    if (state._tag !== "PublicationRetained") return { state, activated: false }
    const priorAttemptCount =
      state.attemptOrdinalsInBatch?.length ??
      events.filter((event) => event._tag === "RemotePublicationAttemptIntended").length
    if (!remotePublicationRetainedCauseIsResumable(state.cause) || priorAttemptCount >= remotePublicationAttemptLimit)
      return { state, activated: false }

    yield* appendRemotePublicationResumeRequest(correlation, request)
    return { state: yield* runRemotePublication(candidate, target, phaseBoundary), activated: true }
  })

  const resumeRemotePublication = Effect.fn("RemotePublication.resumeRetained")(function* (
    candidate: IntegratorRunQualifiedCandidate,
    target: RemotePublicationTarget,
    unknownRequest: unknown,
    phaseBoundary: RemotePublicationPhaseBoundary
  ) {
    return (yield* resumeRemotePublicationOutcome(candidate, target, unknownRequest, phaseBoundary)).state
  })

  const resumeRemotePublicationAndDispatch = Effect.fn("RemotePublication.resumeRetainedAndDispatch")(function* <
    EDispatch,
    RDispatch
  >(
    candidate: IntegratorRunQualifiedCandidate,
    target: RemotePublicationTarget,
    unknownRequest: unknown,
    phaseBoundary: RemotePublicationPhaseBoundary,
    dispatchBoundary: RemotePublicationResumeDispatchBoundary<EDispatch, RDispatch>
  ) {
    const outcome = yield* resumeRemotePublicationOutcome(candidate, target, unknownRequest, phaseBoundary)
    if (outcome.activated && resumeOutcomeNeedsContinuation(outcome.state))
      yield* dispatchBoundary.dispatch(remotePublicationResumeDispatchOf(outcome.state))
    return outcome.state
  })
  return { runRemotePublication, resumeRemotePublication, resumeRemotePublicationAndDispatch }
}

const RemotePublicationEngine = makeRemotePublicationEngine(readAcceptedRemotePublicationEvidence)
export const runRemotePublication = RemotePublicationEngine.runRemotePublication
export const resumeRemotePublication = RemotePublicationEngine.resumeRemotePublication
export const resumeRemotePublicationAndDispatch = RemotePublicationEngine.resumeRemotePublicationAndDispatch
