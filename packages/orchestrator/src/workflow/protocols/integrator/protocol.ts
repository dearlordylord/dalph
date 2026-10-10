import { Context, Effect, Option, Schema } from "effect"
import type { IntegrationTarget } from "@dalph/contracts"
import { InRunJournal } from "../../../workflow-journal/store.js"
import { AcceptedJournalReader } from "../../../workflow-journal/accepted-reader.js"
import { journalRecordsOfKind, type JournalHistorySource } from "../../../workflow-journal/record-evidence.js"
import {
  integratorRunCandidateGitObservedRecordKey,
  integratorRunResultRecordedRecordKey
} from "../../../workflow-journal/record-key.js"
import { workflowJournalEventVersion } from "../../kernel/event.js"
import {
  IntegratorCandidateText,
  IntegratorSessionCorrelation,
  IntegratorGitObservation,
  IntegratorJournalEvent,
  IntegratorRequest,
  IntegratorResult,
  IntegratorNotPreparedDetail,
  IntegratorRunCandidateGitObservedEvent,
  IntegratorRunCorrelation,
  integratorRunCorrelationsEqual,
  IntegratorRunOrdinal,
  IntegratorRunProtocolResult,
  IntegratorRunQualifiedCandidate,
  IntegratorRunResultRecordedEvent,
  IntegratorCandidateResourceLocator,
  IntegratorSessionId,
  integratorCandidateHasExactParents,
  IntegratorAutomaticSuccessorGeneration,
  IntegratorSuccessorGeneration,
  firstFullRerunSuccessorGeneration
} from "./events.js"
import {
  IntegratorCompetingHeadSuccessorAuthorizationId,
  IntegratorCompetingHeadSuccessorAuthorizedEvent,
  integratorCompetingHeadSuccessorAuthorizationIdFor
} from "./automatic-successor-events.js"
import {
  IntegratorCallFailure,
  IntegratorGitReadFailure,
  IntegratorJournalContradiction,
  IntegratorProviderActivityAbsent,
  IntegratorTargetHeadChanged,
  IntegratorTargetLineageIncompatible,
  IntegratorTargetLineageObservationChanged
} from "./errors.js"
import { deriveIntegratorRunState, integratorCorrelationsEqual } from "./state.js"
import {
  appendIntegratorSessionIfNeeded,
  hasMatchingIntegratorTargetLineageObservation,
  IntegratorPreparationInput,
  integratorCorrelationFor,
  integratorSuccessorCorrelationFor,
  integratorLineageIsCompatible,
  integratorRunCorrelationFor,
  integratorRunCorrelationForSession,
  readRecordedIntegratorSession
} from "./session.js"
import type { IntegratorRunPreparationInput } from "./session.js"
import { integratorRetryAuthorizationIssue } from "./retry-authorization.js"
import { readActiveIntegratorSession } from "./successor-session.js"
import {
  appendRunGitReadIntentIfNeeded,
  readRecordedRunResult,
  readRunCandidateObservation,
  reconcileRunResult,
  runIdForCorrelation,
  runObservationFromAppendedRecord,
  runResultFromAppendedRecord
} from "./journal-record-reconciliation.js"

export { deriveIntegratorRunState }
export {
  IntegratorCallFailure,
  IntegratorGitReadFailure,
  IntegratorJournalContradiction,
  IntegratorProviderActivityAbsent,
  IntegratorTargetHeadChanged,
  IntegratorTargetLineageIncompatible,
  IntegratorTargetLineageObservationChanged
}
export type { IntegratorProtocolError } from "./errors.js"

export {
  IntegratorPreparationInput,
  integratorCorrelationFor,
  integratorSuccessorCorrelationFor,
  integratorRunCorrelationFor,
  integratorRunCorrelationForSession
}
export type {
  IntegratorPreparationInput as IntegratorPreparationInputType,
  IntegratorSuccessorPreparationInput as IntegratorSuccessorPreparationInputType,
  IntegratorRunPreparationInput as IntegratorRunPreparationInputType
} from "./session.js"

export {
  IntegratorCandidateResourceLocator,
  IntegratorCandidateText,
  IntegratorSessionCorrelation,
  IntegratorGitObservation,
  IntegratorJournalEvent,
  IntegratorRunProtocolResult,
  IntegratorRunQualifiedCandidate,
  IntegratorRequest,
  IntegratorResult,
  IntegratorNotPreparedDetail,
  IntegratorRunCorrelation,
  IntegratorRunOrdinal,
  IntegratorSessionId,
  integratorCandidateHasExactParents,
  IntegratorAutomaticSuccessorGeneration,
  IntegratorSuccessorGeneration,
  firstFullRerunSuccessorGeneration
}
export type {
  IntegratorSessionCorrelation as IntegratorSessionCorrelationType,
  IntegratorAutomaticSuccessorGeneration as IntegratorAutomaticSuccessorGenerationType,
  IntegratorGitObservation as IntegratorGitObservationType,
  IntegratorJournalEvent as IntegratorJournalEventType,
  IntegratorRequest as IntegratorRequestType,
  IntegratorResult as IntegratorResultType
} from "./events.js"
export type { IntegratorResponsibilityFacts } from "./events.js"
export {
  IntegratorCompetingHeadSuccessorAuthorizationId,
  IntegratorCompetingHeadSuccessorAuthorizedEvent,
  integratorCompetingHeadSuccessorAuthorizationIdFor
}
export type {
  IntegratorCompetingHeadSuccessorAuthorizationId as IntegratorCompetingHeadSuccessorAuthorizationIdType,
  IntegratorCompetingHeadSuccessorAuthorizedEvent as IntegratorCompetingHeadSuccessorAuthorizedEventType
} from "./automatic-successor-events.js"

/** The generic outer service owns private process, turn, review, and provider retry state. */
export interface IntegratorService {
  readonly prepare: (
    request: IntegratorRequest
  ) => Effect.Effect<IntegratorResult, IntegratorCallFailure | IntegratorProviderActivityAbsent>
}

/** A single controlled call to the generic Integrator boundary. */
export class Integrator extends Context.Service<Integrator, IntegratorService>()("@dalph/Integrator") {}

/** Git is asked only for object kind and ordered direct parents of the explicitly reported candidate M. */
export interface IntegratorGitService {
  readonly readCandidate: (
    target: IntegrationTarget,
    candidateText: IntegratorCandidateText
  ) => Effect.Effect<IntegratorGitObservation, IntegratorGitReadFailure>
}

export class IntegratorGit extends Context.Service<IntegratorGit, IntegratorGitService>()("@dalph/IntegratorGit") {}

const qualifyRunCandidate = (
  result: Extract<IntegratorResult, { readonly _tag: "PreparedCandidate" }>,
  run: IntegratorRunCorrelation,
  observation: IntegratorGitObservation
): IntegratorRunProtocolResult => {
  if (
    integratorCandidateHasExactParents(observation, run.session.expectedTargetHead, run.session.acceptedResult.commit)
  ) {
    return IntegratorRunProtocolResult.cases.PreparedCandidate.make({
      candidateCommit: observation.commit,
      candidateText: result.candidateText,
      observation: { directParents: [observation.directParents[0], observation.directParents[1]] },
      run
    })
  }
  return IntegratorRunProtocolResult.cases.CandidateRejected.make({
    candidateText: result.candidateText,
    observation,
    run
  })
}

const correlationForPreparation = Effect.fn("IntegratorProtocol.correlationForPreparation")(function* (
  journal: InRunJournal["Service"],
  input: IntegratorPreparationInput,
  records: JournalHistorySource
) {
  const runId = input.responsibility.plannedAttempt.runId
  const recordedCorrelation = yield* readActiveIntegratorSession(records, input.responsibility)
  if (Option.isSome(recordedCorrelation)) {
    const recovered = recordedCorrelation.value
    if (recovered.targetLineageObservedAt !== input.targetLineageObservedAt) {
      return yield* new IntegratorTargetLineageObservationChanged({
        observedAt: input.targetLineageObservedAt,
        recordedAt: recovered.targetLineageObservedAt,
        responsibility: input.responsibility
      })
    }
    if (recovered.expectedTargetHead !== input.targetLineage.targetHeadSha) {
      return yield* new IntegratorTargetHeadChanged({
        observedTargetHead: input.targetLineage.targetHeadSha,
        recordedTargetHead: recovered.expectedTargetHead,
        responsibility: input.responsibility
      })
    }
    if (!integratorLineageIsCompatible(input)) {
      return yield* new IntegratorTargetLineageIncompatible({
        observation: input.targetLineage,
        responsibility: input.responsibility
      })
    }
    if (!hasMatchingIntegratorTargetLineageObservation(records, input)) {
      return yield* new IntegratorJournalContradiction({
        detail: "target lineage was not durably observed before the fixed session",
        runId
      })
    }
    return recovered
  }
  if (!integratorLineageIsCompatible(input)) {
    return yield* new IntegratorTargetLineageIncompatible({
      observation: input.targetLineage,
      responsibility: input.responsibility
    })
  }
  if (!hasMatchingIntegratorTargetLineageObservation(records, input)) {
    return yield* new IntegratorJournalContradiction({
      detail: "target lineage was not durably observed before the fixed session",
      runId
    })
  }
  const correlation = integratorCorrelationFor(input)
  yield* appendIntegratorSessionIfNeeded(journal, correlation, records)
  return correlation
})

const qualifyOrNotPreparedForRun = Effect.fn("IntegratorProtocol.qualifyOrNotPreparedForRun")(function* (
  journal: InRunJournal["Service"],
  run: IntegratorRunCorrelation,
  result: IntegratorResult
) {
  /* v8 ignore next -- @preserve every public result path validates its session correlation before this qualification helper. */
  if (!integratorRunCorrelationsEqual(result.correlation, run)) {
    return yield* new IntegratorJournalContradiction({
      detail: "Integrator result is not bound to the requested run",
      runId: runIdForCorrelation(run.session)
    })
  }
  if (result._tag === "NotPrepared") {
    return IntegratorRunProtocolResult.cases.NotPrepared.make({ detail: result.detail, run })
  }

  const currentRecords = yield* (yield* AcceptedJournalReader).readAccepted(runIdForCorrelation(run.session))
  const recordedObservation = yield* readRunCandidateObservation(currentRecords, run, result.candidateText)
  let observation: IntegratorGitObservation
  if (Option.isSome(recordedObservation)) {
    observation = recordedObservation.value
  } else {
    // The run-bound read intent is durable before Git can produce an ambiguous outcome.
    yield* appendRunGitReadIntentIfNeeded(journal, run, result.candidateText, currentRecords)
    observation = yield* (yield* IntegratorGit).readCandidate(run.session.integrationTarget, result.candidateText)
  }
  if (observation.candidateText !== result.candidateText) {
    return yield* new IntegratorJournalContradiction({
      detail: "Git returned facts for a different candidate text",
      runId: runIdForCorrelation(run.session)
    })
  }
  if (Option.isNone(recordedObservation)) {
    const appended = yield* journal.append(
      runIdForCorrelation(run.session),
      integratorRunCandidateGitObservedRecordKey(run, result.candidateText),
      IntegratorRunCandidateGitObservedEvent.make({
        candidateText: result.candidateText,
        observation,
        run,
        version: workflowJournalEventVersion
      })
    )
    observation = yield* runObservationFromAppendedRecord(appended, run, result.candidateText, observation)
  }
  return qualifyRunCandidate(result, run, observation)
})

const automaticSuccessorRetrySessionFor = (
  records: JournalHistorySource,
  activeSession: Option.Option<IntegratorSessionCorrelation>,
  requestedSession: IntegratorSessionCorrelation
): IntegratorSessionCorrelation | undefined => {
  if (Option.isNone(activeSession) || !integratorCorrelationsEqual(activeSession.value, requestedSession)) {
    return undefined
  }
  for (const { event } of journalRecordsOfKind(records, "IntegratorAutomaticSuccessorSessionFixed")) {
    if (
      event._tag === "IntegratorAutomaticSuccessorSessionFixed" &&
      integratorCorrelationsEqual(event.successor, activeSession.value)
    ) {
      return activeSession.value
    }
  }
  return undefined
}

const exactRetrySessionForRequestedRun = Effect.fn("IntegratorProtocol.exactRetrySessionForRequestedRun")(function* (
  request: IntegratorRunPreparationInput,
  records: JournalHistorySource
) {
  const runId = request.preparation.responsibility.plannedAttempt.runId
  const recordedSession = yield* readRecordedIntegratorSession(records, request.preparation.responsibility)
  if (Option.isNone(recordedSession)) {
    return yield* new IntegratorJournalContradiction({ detail: "Retry run has no exact earlier fixed session", runId })
  }
  const activeSession = yield* readActiveIntegratorSession(records, request.preparation.responsibility)
  const isOriginalSession = integratorCorrelationsEqual(recordedSession.value, request.run.session)
  const automaticSuccessorSession = automaticSuccessorRetrySessionFor(records, activeSession, request.run.session)
  const isExactAutomaticSuccessor = automaticSuccessorSession !== undefined
  const isExactActiveSuccessor =
    Option.isSome(activeSession) && integratorCorrelationsEqual(activeSession.value, request.run.session)
  if (!isOriginalSession && !isExactAutomaticSuccessor && !isExactActiveSuccessor) {
    return yield* new IntegratorJournalContradiction({ detail: "Retry run has no exact earlier fixed session", runId })
  }
  return isExactActiveSuccessor && Option.isSome(activeSession)
    ? activeSession.value
    : (automaticSuccessorSession ?? recordedSession.value)
})

const correlationForRequestedRun = Effect.fn("IntegratorProtocol.correlationForRequestedRun")(function* (
  journal: InRunJournal["Service"],
  request: IntegratorRunPreparationInput,
  records: JournalHistorySource
) {
  if (request.run.ordinal === 1) return yield* correlationForPreparation(journal, request.preparation, records)
  const runId = request.preparation.responsibility.plannedAttempt.runId
  const retrySession = yield* exactRetrySessionForRequestedRun(request, records)
  if (!integratorLineageIsCompatible(request.preparation)) {
    return yield* new IntegratorTargetLineageIncompatible({
      observation: request.preparation.targetLineage,
      responsibility: request.preparation.responsibility
    })
  }
  const authorizationIssue = integratorRetryAuthorizationIssue(records, request)
  if (authorizationIssue !== undefined) {
    return yield* new IntegratorJournalContradiction({ detail: authorizationIssue, runId })
  }
  if (retrySession.expectedTargetHead !== request.preparation.targetLineage.targetHeadSha) {
    return yield* new IntegratorTargetHeadChanged({
      observedTargetHead: request.preparation.targetLineage.targetHeadSha,
      recordedTargetHead: retrySession.expectedTargetHead,
      responsibility: request.preparation.responsibility
    })
  }
  return retrySession
})

/**
 * Runs one exact outer Integrator ordinal. New calls always write
 * IntegratorRunStarted before the opaque provider call and persist all result
 * and candidate Git facts with the same `(session, ordinal)` identity.
 */
export const prepareIntegrationCandidateRun = Effect.fn("IntegratorProtocol.prepareIntegrationCandidateRun")(function* (
  requestInput: IntegratorRunPreparationInput
) {
  const journal = yield* InRunJournal
  const input = requestInput.preparation
  const runId = input.responsibility.plannedAttempt.runId
  if (!Schema.is(IntegratorRunOrdinal)(requestInput.run.ordinal)) {
    return yield* new IntegratorJournalContradiction({
      detail: "Integrator run ordinal must be a positive safely representable integer",
      runId
    })
  }
  const accepted = yield* AcceptedJournalReader
  const records = yield* accepted.readAccepted(runId)
  const session = yield* correlationForRequestedRun(journal, requestInput, records)
  if (!integratorCorrelationsEqual(session, requestInput.run.session)) {
    return yield* new IntegratorJournalContradiction({
      detail: "requested Integrator run belongs to a foreign session",
      runId
    })
  }
  const run = requestInput.run
  const recordsAfterSession = yield* accepted.readAccepted(runId)
  const recordedRunResult = yield* readRecordedRunResult(recordsAfterSession, run)

  const reconciledRunResult = yield* reconcileRunResult(
    journal,
    run,
    recordsAfterSession,
    recordedRunResult,
    run.ordinal > 1
  )
  let result: IntegratorResult
  if (Option.isSome(reconciledRunResult)) {
    result = reconciledRunResult.value
  } else {
    const integrator = yield* Integrator
    const freshResult = yield* integrator.prepare(IntegratorRequest.make({ correlation: run }))
    if (!integratorRunCorrelationsEqual(freshResult.correlation, run)) {
      return yield* new IntegratorJournalContradiction({
        detail: "Integrator returned a foreign run correlation",
        runId
      })
    }
    const appended = yield* journal.append(
      runId,
      integratorRunResultRecordedRecordKey(run),
      IntegratorRunResultRecordedEvent.make({ result: freshResult, run, version: workflowJournalEventVersion })
    )
    result = yield* runResultFromAppendedRecord(appended, run, freshResult)
  }
  return yield* qualifyOrNotPreparedForRun(journal, run, result)
})
