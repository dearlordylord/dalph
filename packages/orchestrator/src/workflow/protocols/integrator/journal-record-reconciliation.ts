import { Effect, Option, Schema } from "effect"
import type { RunId } from "@dalph/contracts"
import type { InRunJournal, JournalRecord } from "../../../workflow-journal/store.js"
import {
  integratorRunCandidateGitObservedRecordKey,
  integratorRunCandidateGitReadIntendedRecordKey,
  integratorRunResultRecordedRecordKey,
  integratorRunStartedRecordKey
} from "../../../workflow-journal/record-key.js"
import { workflowJournalEventVersion } from "../../kernel/event.js"
import {
  type IntegratorCandidateText,
  type IntegratorSessionCorrelation,
  IntegratorGitObservation,
  IntegratorResult,
  IntegratorRunCandidateGitReadIntendedEvent,
  IntegratorRunCorrelation,
  IntegratorRunOrdinal
} from "./events.js"
import { IntegratorJournalContradiction } from "./errors.js"
import { appendIntegratorRunStartedIfNeeded } from "./session.js"
import { integratorCorrelationsEqual, integratorFindEventAtKey } from "./state.js"

export const runIdForCorrelation = (correlation: IntegratorSessionCorrelation): RunId =>
  correlation.plannedAttempt.runId
const integratorResultEquivalence = Schema.toEquivalence(IntegratorResult)
const integratorGitObservationEquivalence = Schema.toEquivalence(IntegratorGitObservation)

export const runResultFromAppendedRecord = (
  record: JournalRecord,
  run: IntegratorRunCorrelation,
  expectedResult: IntegratorResult
): Effect.Effect<IntegratorResult, IntegratorJournalContradiction> => {
  if (
    record.event._tag !== "IntegratorRunResultRecorded" ||
    !integratorCorrelationsEqual(record.event.run.session, run.session) ||
    record.event.run.ordinal !== run.ordinal ||
    !integratorCorrelationsEqual(record.event.result.correlation, run.session) ||
    !integratorResultEquivalence(record.event.result, expectedResult)
  ) {
    return Effect.fail(
      new IntegratorJournalContradiction({
        detail: "run result append lost to a different durable result",
        runId: runIdForCorrelation(run.session)
      })
    )
  }
  return Effect.succeed(record.event.result)
}

export const readRecordedRunResult = (
  records: ReadonlyArray<JournalRecord>,
  run: IntegratorRunCorrelation
): Effect.Effect<Option.Option<IntegratorResult>, IntegratorJournalContradiction> => {
  const existing = integratorFindEventAtKey(records, integratorRunResultRecordedRecordKey(run))
  if (existing === undefined) return Effect.succeed(Option.none())
  if (
    existing.event._tag !== "IntegratorRunResultRecorded" ||
    !integratorRunMatches(existing.event.run, run) ||
    !integratorCorrelationsEqual(existing.event.result.correlation, run.session)
  ) {
    return Effect.fail(
      new IntegratorJournalContradiction({
        detail: "run result key contains a foreign event or correlation",
        runId: runIdForCorrelation(run.session)
      })
    )
  }
  return Effect.succeed(Option.some(existing.event.result))
}

export const runObservationFromAppendedRecord = (
  record: JournalRecord,
  run: IntegratorRunCorrelation,
  candidateText: IntegratorCandidateText,
  expectedObservation: IntegratorGitObservation
): Effect.Effect<IntegratorGitObservation, IntegratorJournalContradiction> => {
  if (
    record.event._tag !== "IntegratorRunCandidateGitObserved" ||
    !integratorRunMatches(record.event.run, run) ||
    record.event.candidateText !== candidateText ||
    !integratorGitObservationEquivalence(record.event.observation, expectedObservation)
  ) {
    return Effect.fail(
      new IntegratorJournalContradiction({
        detail: "run Git observation append lost to different durable facts",
        runId: runIdForCorrelation(run.session)
      })
    )
  }
  return Effect.succeed(record.event.observation)
}

const integratorRunMatches = (left: IntegratorRunCorrelation, right: IntegratorRunCorrelation): boolean =>
  left.ordinal === right.ordinal && integratorCorrelationsEqual(left.session, right.session)

const readRecordedRunGitObservation = (
  records: ReadonlyArray<JournalRecord>,
  run: IntegratorRunCorrelation,
  candidateText: IntegratorCandidateText
): Effect.Effect<Option.Option<IntegratorGitObservation>, IntegratorJournalContradiction> => {
  const existing = integratorFindEventAtKey(records, integratorRunCandidateGitObservedRecordKey(run, candidateText))
  if (existing === undefined) return Effect.succeed(Option.none())
  if (
    existing.event._tag !== "IntegratorRunCandidateGitObserved" ||
    !integratorRunMatches(existing.event.run, run) ||
    existing.event.candidateText !== candidateText ||
    existing.event.observation.candidateText !== candidateText
  ) {
    return Effect.fail(
      new IntegratorJournalContradiction({
        detail: "run Git observation belongs to a foreign candidate or run",
        runId: runIdForCorrelation(run.session)
      })
    )
  }
  return Effect.succeed(Option.some(existing.event.observation))
}

export const appendRunGitReadIntentIfNeeded = Effect.fn("IntegratorProtocol.appendRunGitReadIntentIfNeeded")(function* (
  journal: InRunJournal["Service"],
  run: IntegratorRunCorrelation,
  candidateText: IntegratorCandidateText,
  records: ReadonlyArray<JournalRecord>
) {
  const key = integratorRunCandidateGitReadIntendedRecordKey(run, candidateText)
  const existing = integratorFindEventAtKey(records, key)
  if (existing !== undefined) {
    if (
      existing.event._tag !== "IntegratorRunCandidateGitReadIntended" ||
      !integratorRunMatches(existing.event.run, run) ||
      existing.event.candidateText !== candidateText
    ) {
      return yield* new IntegratorJournalContradiction({
        detail: "run Git-read key contains a foreign event",
        runId: runIdForCorrelation(run.session)
      })
    }
    return existing
  }
  const appended = yield* journal.append(
    runIdForCorrelation(run.session),
    key,
    IntegratorRunCandidateGitReadIntendedEvent.make({ candidateText, run, version: workflowJournalEventVersion })
  )
  if (
    appended.event._tag !== "IntegratorRunCandidateGitReadIntended" ||
    !integratorRunMatches(appended.event.run, run) ||
    appended.event.candidateText !== candidateText
  ) {
    return yield* new IntegratorJournalContradiction({
      detail: "run Git-read append lost to a foreign event",
      runId: runIdForCorrelation(run.session)
    })
  }
  return appended
})

const readRunGitReadIntent = (
  records: ReadonlyArray<JournalRecord>,
  run: IntegratorRunCorrelation,
  candidateText: IntegratorCandidateText
): Effect.Effect<boolean, IntegratorJournalContradiction> => {
  const existing = integratorFindEventAtKey(records, integratorRunCandidateGitReadIntendedRecordKey(run, candidateText))
  if (existing === undefined) return Effect.succeed(false)
  if (
    existing.event._tag !== "IntegratorRunCandidateGitReadIntended" ||
    !integratorRunMatches(existing.event.run, run) ||
    existing.event.candidateText !== candidateText
  ) {
    return Effect.fail(
      new IntegratorJournalContradiction({
        detail: "run Git-read key contains a foreign event",
        runId: runIdForCorrelation(run.session)
      })
    )
  }
  return Effect.succeed(true)
}

const previousRunFor = (run: IntegratorRunCorrelation): IntegratorRunCorrelation | undefined =>
  run.ordinal === 1
    ? undefined
    : IntegratorRunCorrelation.make({
        ordinal: IntegratorRunOrdinal.make(Number(run.ordinal) - 1),
        session: run.session
      })

const previousRunHasDurableResult = (
  records: ReadonlyArray<JournalRecord>,
  previous: IntegratorRunCorrelation
): boolean => {
  const previousStart = integratorFindEventAtKey(records, integratorRunStartedRecordKey(previous))
  const previousResult = integratorFindEventAtKey(records, integratorRunResultRecordedRecordKey(previous))
  if (
    previousStart?.event._tag !== "IntegratorRunStarted" ||
    previousResult?.event._tag !== "IntegratorRunResultRecorded"
  ) {
    return false
  }
  return (
    integratorRunMatches(previousStart.event.run, previous) && integratorRunMatches(previousResult.event.run, previous)
  )
}

const previousRunIsDurablyConclusive = (
  records: ReadonlyArray<JournalRecord>,
  run: IntegratorRunCorrelation
): boolean => {
  const previous = previousRunFor(run)
  if (previous === undefined) return true
  return previousRunHasDurableResult(records, previous)
}

export const reconcileRunResult = Effect.fn("IntegratorProtocol.reconcileRunResult")(function* (
  journal: InRunJournal["Service"],
  run: IntegratorRunCorrelation,
  records: ReadonlyArray<JournalRecord>,
  recordedRunResult: Option.Option<IntegratorResult>,
  successorAuthorized: boolean
) {
  if (Option.isNone(recordedRunResult)) {
    if (!successorAuthorized && !previousRunIsDurablyConclusive(records, run)) {
      return yield* new IntegratorJournalContradiction({
        detail: "requested retry has no exact conclusive predecessor run",
        runId: runIdForCorrelation(run.session)
      })
    }
    yield* appendIntegratorRunStartedIfNeeded(journal, run, records)
  }
  const recordsAfterRunStart = yield* journal.read(runIdForCorrelation(run.session))
  return yield* readRecordedRunResult(recordsAfterRunStart, run)
})

export const readRunCandidateObservation = Effect.fn("IntegratorProtocol.readRunCandidateObservation")(function* (
  records: ReadonlyArray<JournalRecord>,
  run: IntegratorRunCorrelation,
  candidateText: IntegratorCandidateText
) {
  const runObservation = yield* readRecordedRunGitObservation(records, run, candidateText)
  const runReadIntent = yield* readRunGitReadIntent(records, run, candidateText)
  if (Option.isSome(runObservation)) {
    if (!runReadIntent) {
      return yield* new IntegratorJournalContradiction({
        detail: "Git observation exists without its durable read intent",
        runId: runIdForCorrelation(run.session)
      })
    }
  }
  return runObservation
})
