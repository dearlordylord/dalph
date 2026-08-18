import { Context, Effect, Option, Schema } from "effect"
import type { IntegrationTarget, RunId } from "@dalph/contracts"
import { InRunJournal } from "../../../workflow-journal/store.js"
import type { JournalRecord } from "../../../workflow-journal/store.js"
import {
  integratorCandidateGitObservedRecordKey,
  integratorCandidateGitReadIntendedRecordKey,
  integratorResultRecordedRecordKey
} from "../../../workflow-journal/record-key.js"
import { workflowJournalEventVersion } from "../../kernel/event.js"
import {
  IntegratorCandidateGitObservedEvent,
  IntegratorCandidateGitReadIntendedEvent,
  IntegratorCandidateText,
  IntegratorCorrelation,
  IntegratorGitObservation,
  IntegratorJournalEvent,
  IntegratorProtocolResult,
  IntegratorRequest,
  IntegratorResult,
  IntegratorNotPreparedDetail,
  IntegratorResultRecordedEvent,
  IntegratorCandidateResourceLocator,
  IntegratorSessionId,
  IntegratorState,
  IntegratorQualifiedCandidate,
  integratorQualifiedCandidateFromState,
  integratorCandidateHasExactParents
} from "./events.js"
import {
  IntegratorCallFailure,
  IntegratorGitReadFailure,
  IntegratorJournalContradiction,
  IntegratorTargetHeadChanged,
  IntegratorTargetLineageIncompatible,
  IntegratorTargetLineageObservationChanged
} from "./errors.js"
import { deriveIntegratorState, integratorCorrelationsEqual, integratorFindEventAtKey } from "./state.js"
import {
  appendIntegratorSessionIfNeeded,
  hasMatchingIntegratorTargetLineageObservation,
  IntegratorPreparationInput,
  integratorCorrelationFor,
  integratorLineageIsCompatible,
  readRecordedIntegratorSession
} from "./session.js"

export { deriveIntegratorState }
export {
  IntegratorCallFailure,
  IntegratorGitReadFailure,
  IntegratorJournalContradiction,
  IntegratorTargetHeadChanged,
  IntegratorTargetLineageIncompatible,
  IntegratorTargetLineageObservationChanged
}
export type { IntegratorProtocolError } from "./errors.js"

export { IntegratorPreparationInput, integratorCorrelationFor }
export type { IntegratorPreparationInput as IntegratorPreparationInputType } from "./session.js"

export {
  IntegratorCandidateResourceLocator,
  IntegratorCandidateText,
  IntegratorCorrelation,
  IntegratorGitObservation,
  IntegratorJournalEvent,
  IntegratorProtocolResult,
  IntegratorRequest,
  IntegratorResult,
  IntegratorNotPreparedDetail,
  IntegratorState,
  IntegratorQualifiedCandidate,
  integratorQualifiedCandidateFromState,
  IntegratorSessionId,
  integratorCandidateHasExactParents
}
export type {
  IntegratorCorrelation as IntegratorCorrelationType,
  IntegratorGitObservation as IntegratorGitObservationType,
  IntegratorJournalEvent as IntegratorJournalEventType,
  IntegratorProtocolResult as IntegratorProtocolResultType,
  IntegratorRequest as IntegratorRequestType,
  IntegratorResult as IntegratorResultType
} from "./events.js"
export type { IntegratorResponsibilityFacts } from "./events.js"

/** The generic outer service owns private process, turn, review, and provider retry state. */
export interface IntegratorService {
  readonly prepare: (request: IntegratorRequest) => Effect.Effect<IntegratorResult, IntegratorCallFailure>
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

const runIdForCorrelation = (correlation: IntegratorCorrelation): RunId => correlation.plannedAttempt.runId
const integratorResultEquivalence = Schema.toEquivalence(IntegratorResult)
const integratorGitObservationEquivalence = Schema.toEquivalence(IntegratorGitObservation)

const resultFromAppendedRecord = (
  record: JournalRecord,
  correlation: IntegratorCorrelation,
  expectedResult: IntegratorResult
): Effect.Effect<IntegratorResult, IntegratorJournalContradiction> => {
  if (
    record.event._tag !== "IntegratorResultRecorded" ||
    !integratorCorrelationsEqual(record.event.result.correlation, correlation) ||
    !integratorResultEquivalence(record.event.result, expectedResult)
  ) {
    return Effect.fail(
      new IntegratorJournalContradiction({
        detail: "result append lost to a different durable result",
        runId: runIdForCorrelation(correlation)
      })
    )
  }
  return Effect.succeed(record.event.result)
}

const observationFromAppendedRecord = (
  record: JournalRecord,
  correlation: IntegratorCorrelation,
  candidateText: IntegratorCandidateText,
  expectedObservation: IntegratorGitObservation
): Effect.Effect<IntegratorGitObservation, IntegratorJournalContradiction> => {
  if (
    record.event._tag !== "IntegratorCandidateGitObserved" ||
    record.event.candidateText !== candidateText ||
    !integratorCorrelationsEqual(record.event.correlation, correlation) ||
    !integratorGitObservationEquivalence(record.event.observation, expectedObservation)
  ) {
    return Effect.fail(
      new IntegratorJournalContradiction({
        detail: "Git observation append lost to different durable facts",
        runId: runIdForCorrelation(correlation)
      })
    )
  }
  return Effect.succeed(record.event.observation)
}

const readRecordedResult = (
  records: ReadonlyArray<JournalRecord>,
  correlation: IntegratorCorrelation
): Effect.Effect<Option.Option<IntegratorResult>, IntegratorJournalContradiction> => {
  const existing = integratorFindEventAtKey(records, integratorResultRecordedRecordKey(correlation))
  if (existing === undefined) return Effect.succeed(Option.none())
  if (existing.event._tag !== "IntegratorResultRecorded") {
    return Effect.fail(
      new IntegratorJournalContradiction({
        detail: "result key contains a foreign event",
        runId: runIdForCorrelation(correlation)
      })
    )
  }
  if (!integratorCorrelationsEqual(existing.event.result.correlation, correlation)) {
    return Effect.fail(
      new IntegratorJournalContradiction({
        detail: "recorded result belongs to a foreign correlation",
        runId: runIdForCorrelation(correlation)
      })
    )
  }
  return Effect.succeed(Option.some(existing.event.result))
}

const readRecordedGitObservation = (
  records: ReadonlyArray<JournalRecord>,
  correlation: IntegratorCorrelation,
  candidateText: IntegratorCandidateText
): Effect.Effect<Option.Option<IntegratorGitObservation>, IntegratorJournalContradiction> => {
  const key = integratorCandidateGitObservedRecordKey(correlation, candidateText)
  const existing = integratorFindEventAtKey(records, key)
  if (existing === undefined) return Effect.succeed(Option.none())
  if (existing.event._tag !== "IntegratorCandidateGitObserved") {
    return Effect.fail(
      new IntegratorJournalContradiction({
        detail: "Git observation key contains a foreign event",
        runId: runIdForCorrelation(correlation)
      })
    )
  }
  if (
    !integratorCorrelationsEqual(existing.event.correlation, correlation) ||
    existing.event.candidateText !== candidateText
  ) {
    return Effect.fail(
      new IntegratorJournalContradiction({
        detail: "recorded Git observation belongs to a foreign candidate",
        runId: runIdForCorrelation(correlation)
      })
    )
  }
  if (existing.event.observation.candidateText !== candidateText) {
    return Effect.fail(
      new IntegratorJournalContradiction({
        detail: "Git observation text differs from the reported candidate",
        runId: runIdForCorrelation(correlation)
      })
    )
  }
  return Effect.succeed(Option.some(existing.event.observation))
}

const appendGitReadIntentIfNeeded = Effect.fn("IntegratorProtocol.appendGitReadIntentIfNeeded")(function* (
  journal: InRunJournal["Service"],
  correlation: IntegratorCorrelation,
  candidateText: IntegratorCandidateText,
  records: ReadonlyArray<JournalRecord>
) {
  const key = integratorCandidateGitReadIntendedRecordKey(correlation, candidateText)
  const existing = integratorFindEventAtKey(records, key)
  if (existing !== undefined) {
    if (
      existing.event._tag !== "IntegratorCandidateGitReadIntended" ||
      existing.event.candidateText !== candidateText ||
      !integratorCorrelationsEqual(existing.event.correlation, correlation)
    ) {
      return yield* new IntegratorJournalContradiction({
        detail: "Git-read key contains a foreign event",
        runId: runIdForCorrelation(correlation)
      })
    }
    return existing
  }
  const appended = yield* journal.append(
    runIdForCorrelation(correlation),
    key,
    IntegratorCandidateGitReadIntendedEvent.make({ candidateText, correlation, version: workflowJournalEventVersion })
  )
  if (
    appended.event._tag !== "IntegratorCandidateGitReadIntended" ||
    appended.event.candidateText !== candidateText ||
    !integratorCorrelationsEqual(appended.event.correlation, correlation)
  ) {
    return yield* new IntegratorJournalContradiction({
      detail: "Git-read append lost to a foreign event",
      runId: runIdForCorrelation(correlation)
    })
  }
  return appended
})

const readGitReadIntent = (
  records: ReadonlyArray<JournalRecord>,
  correlation: IntegratorCorrelation,
  candidateText: IntegratorCandidateText
): Effect.Effect<boolean, IntegratorJournalContradiction> => {
  const existing = integratorFindEventAtKey(
    records,
    integratorCandidateGitReadIntendedRecordKey(correlation, candidateText)
  )
  if (existing === undefined) return Effect.succeed(false)
  if (
    existing.event._tag !== "IntegratorCandidateGitReadIntended" ||
    existing.event.candidateText !== candidateText ||
    !integratorCorrelationsEqual(existing.event.correlation, correlation)
  ) {
    return Effect.fail(
      new IntegratorJournalContradiction({
        detail: "Git-read key contains a foreign event",
        runId: runIdForCorrelation(correlation)
      })
    )
  }
  return Effect.succeed(true)
}

const qualifyCandidate = (
  result: Extract<IntegratorResult, { readonly _tag: "PreparedCandidate" }>,
  observation: IntegratorGitObservation
): IntegratorProtocolResult => {
  if (
    integratorCandidateHasExactParents(
      observation,
      result.correlation.expectedTargetHead,
      result.correlation.acceptedResult.commit
    )
  ) {
    return IntegratorProtocolResult.cases.PreparedCandidate.make({
      candidateCommit: observation.commit,
      candidateText: result.candidateText,
      correlation: result.correlation,
      observation: { directParents: [observation.directParents[0], observation.directParents[1]] }
    })
  }
  return IntegratorProtocolResult.cases.CandidateRejected.make({
    candidateText: result.candidateText,
    correlation: result.correlation,
    observation
  })
}

const correlationForPreparation = Effect.fn("IntegratorProtocol.correlationForPreparation")(function* (
  journal: InRunJournal["Service"],
  input: IntegratorPreparationInput,
  records: ReadonlyArray<JournalRecord>
) {
  const runId = input.responsibility.plannedAttempt.runId
  const recordedCorrelation = yield* readRecordedIntegratorSession(records, input.responsibility)
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

/**
 * Fixes the opaque session before calling the generic Integrator, reuses durable
 * outer results after restart, and qualifies an explicit M only from Git's
 * exact ordered direct-parent proof [H, C].
 */
export const prepareIntegrationCandidate = Effect.fn("IntegratorProtocol.prepareIntegrationCandidate")(function* (
  input: IntegratorPreparationInput
) {
  const journal = yield* InRunJournal
  const runId = input.responsibility.plannedAttempt.runId
  const records = yield* journal.read(runId)
  const correlation = yield* correlationForPreparation(journal, input, records)

  const request = IntegratorRequest.make({ correlation })
  // Reconcile after the intent append: another process may have durably recorded
  // the outer result between the first read and this protocol invocation.
  const recordsAfterSession = yield* journal.read(runId)
  const resultFromJournal = yield* readRecordedResult(recordsAfterSession, correlation)
  let result: IntegratorResult
  if (Option.isNone(resultFromJournal)) {
    const integrator = yield* Integrator
    const freshResult = yield* integrator.prepare(request)
    if (!integratorCorrelationsEqual(freshResult.correlation, correlation)) {
      return yield* new IntegratorJournalContradiction({ detail: "Integrator returned a foreign correlation", runId })
    }
    const appended = yield* journal.append(
      runId,
      integratorResultRecordedRecordKey(correlation),
      IntegratorResultRecordedEvent.make({ result: freshResult, version: workflowJournalEventVersion })
    )
    result = yield* resultFromAppendedRecord(appended, correlation, freshResult)
  } else {
    result = resultFromJournal.value
  }
  return yield* qualifyOrNotPrepared(journal, correlation, result)
})

const qualifyOrNotPrepared = Effect.fn("IntegratorProtocol.qualifyOrNotPrepared")(function* (
  journal: InRunJournal["Service"],
  correlation: IntegratorCorrelation,
  result: IntegratorResult
) {
  if (result._tag === "NotPrepared") {
    return IntegratorProtocolResult.cases.NotPrepared.make({ correlation, detail: result.detail })
  }

  const currentRecords = yield* journal.read(runIdForCorrelation(correlation))
  const recordedObservation = yield* readRecordedGitObservation(currentRecords, correlation, result.candidateText)
  const readIntent = yield* readGitReadIntent(currentRecords, correlation, result.candidateText)
  let observation: IntegratorGitObservation
  if (Option.isSome(recordedObservation)) {
    if (!readIntent) {
      return yield* new IntegratorJournalContradiction({
        detail: "Git observation exists without its durable read intent",
        runId: runIdForCorrelation(correlation)
      })
    }
    observation = recordedObservation.value
  } else {
    // The read intent is durable before Git can produce an ambiguous outcome.
    yield* appendGitReadIntentIfNeeded(journal, correlation, result.candidateText, currentRecords)
    observation = yield* (yield* IntegratorGit).readCandidate(correlation.integrationTarget, result.candidateText)
  }
  if (observation.candidateText !== result.candidateText) {
    return yield* new IntegratorJournalContradiction({
      detail: "Git returned facts for a different candidate text",
      runId: runIdForCorrelation(correlation)
    })
  }
  if (Option.isNone(recordedObservation)) {
    const appended = yield* journal.append(
      runIdForCorrelation(correlation),
      integratorCandidateGitObservedRecordKey(correlation, result.candidateText),
      IntegratorCandidateGitObservedEvent.make({
        candidateText: result.candidateText,
        correlation,
        observation,
        version: workflowJournalEventVersion
      })
    )
    observation = yield* observationFromAppendedRecord(appended, correlation, result.candidateText, observation)
  }
  return qualifyCandidate(result, observation)
})
