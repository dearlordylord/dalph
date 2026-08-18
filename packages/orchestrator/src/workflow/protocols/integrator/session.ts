import { IntegrationTarget, PlannedTaskAttempt } from "@dalph/contracts"
import { Effect, Option, Schema } from "effect"
import { TargetLineageObservation } from "../../../authorities/git/target-lineage.js"
import { JournalPosition } from "../../../workflow-journal/identity.js"
import type { OperationId } from "../../identity.js"
import { integratorRunStartedRecordKey, integratorSessionFixedRecordKey } from "../../../workflow-journal/record-key.js"
import type { InRunJournal, JournalRecord } from "../../../workflow-journal/store.js"
import { workflowJournalEventVersion } from "../../kernel/event.js"
import { StartedIntegrationResponsibility } from "../integration-admission/protocol.js"
import { IntegratorJournalContradiction } from "./errors.js"
import {
  IntegratorCandidateResourceLocator,
  IntegratorCorrelation,
  IntegratorRunCorrelation,
  IntegratorRunOrdinal,
  IntegratorRunStartedEvent,
  IntegratorSessionFixedEvent,
  IntegratorSessionId,
  integratorRunCorrelationsEqual
} from "./events.js"
import {
  integratorCorrelationsEqual,
  integratorFindEventAtKey,
  integratorResponsibilityFactsEqual,
  integratorResponsibilityFactsFor,
  integratorResponsibilityFactsFromCorrelation
} from "./state.js"

/** Inputs assembled from one existing started responsibility and Git's fixed target-head observation. */
export const IntegratorPreparationInput = Schema.Struct({
  responsibility: StartedIntegrationResponsibility,
  targetLineage: TargetLineageObservation,
  /** Position of the durable TargetLineageObserved fact supplying targetLineage. */
  targetLineageObservedAt: JournalPosition
})
export type IntegratorPreparationInput = typeof IntegratorPreparationInput.Type

/** Explicit input for a requested outer run, including its required ordinal. */
export const IntegratorRunPreparationInput = Schema.Struct({
  preparation: IntegratorPreparationInput,
  run: IntegratorRunCorrelation
})
export type IntegratorRunPreparationInput = typeof IntegratorRunPreparationInput.Type

const runIdFor = (responsibility: StartedIntegrationResponsibility) => responsibility.plannedAttempt.runId
const runIdForCorrelation = (correlation: IntegratorCorrelation) => correlation.plannedAttempt.runId

const correlationKeyMaterial = (input: IntegratorPreparationInput): string =>
  [
    input.responsibility.plannedAttempt.runId,
    input.responsibility.plannedAttempt.attemptId,
    input.responsibility.startedAt,
    input.targetLineageObservedAt,
    input.targetLineage.targetHeadSha,
    input.responsibility.acceptedResult.commit,
    input.responsibility.integrationTarget.repository,
    input.responsibility.integrationTarget.ref
  ].join(":")

/** Derives one stable session/resource pair; replay with the same responsibility and H cannot create a successor. */
export const integratorCorrelationFor = (input: IntegratorPreparationInput): IntegratorCorrelation => {
  const material = correlationKeyMaterial(input)
  return IntegratorCorrelation.make({
    acceptedResult: input.responsibility.acceptedResult,
    candidateResource: IntegratorCandidateResourceLocator.make(`integrator-resource:${material}`),
    expectedTargetHead: input.targetLineage.targetHeadSha,
    integrationTarget: input.responsibility.integrationTarget,
    plannedAttempt: input.responsibility.plannedAttempt,
    queuedAt: input.responsibility.queuedAt,
    sessionId: IntegratorSessionId.make(`integrator-session:${material}`),
    startedAt: input.responsibility.startedAt,
    targetLineageObservedAt: input.targetLineageObservedAt
  })
}

/** Constructs the explicit run identity without allowing an unvalidated ordinal. */
export const integratorRunCorrelationFor = (
  input: IntegratorPreparationInput,
  ordinal: IntegratorRunOrdinal
): IntegratorRunCorrelation => IntegratorRunCorrelation.make({ ordinal, session: integratorCorrelationFor(input) })

/** The first opaque call for a fixed session always has run ordinal one. */
export const integratorInitialRunCorrelationFor = (input: IntegratorPreparationInput): IntegratorRunCorrelation =>
  integratorRunCorrelationFor(input, IntegratorRunOrdinal.make(1))

const sessionRecordMatches = (record: JournalRecord, correlation: IntegratorCorrelation): boolean =>
  record.event._tag === "IntegratorSessionFixed" &&
  integratorCorrelationsEqual(record.event.correlation, correlation) &&
  record.position > correlation.targetLineageObservedAt

export const appendIntegratorSessionIfNeeded = Effect.fn("IntegratorProtocol.appendSessionIfNeeded")(function* (
  journal: InRunJournal["Service"],
  correlation: IntegratorCorrelation,
  records: ReadonlyArray<JournalRecord>
) {
  const key = integratorSessionFixedRecordKey(integratorResponsibilityFactsFromCorrelation(correlation))
  const existing = integratorFindEventAtKey(records, key)
  if (existing !== undefined) {
    if (!sessionRecordMatches(existing, correlation)) {
      return yield* new IntegratorJournalContradiction({
        detail: "session key contains a foreign event",
        runId: runIdForCorrelation(correlation)
      })
    }
    return existing
  }
  const event = IntegratorSessionFixedEvent.make({ correlation, version: workflowJournalEventVersion })
  const appended = yield* journal.append(runIdForCorrelation(correlation), key, event)
  if (!sessionRecordMatches(appended, correlation)) {
    return yield* new IntegratorJournalContradiction({
      detail: "session append lost to a foreign event or does not follow the target-lineage observation",
      runId: runIdForCorrelation(correlation)
    })
  }
  return appended
})

const runStartRecordMatches = (record: JournalRecord, run: IntegratorRunCorrelation): boolean =>
  record.event._tag === "IntegratorRunStarted" &&
  integratorRunCorrelationsEqual(record.event.run, run) &&
  record.position > run.session.targetLineageObservedAt

/**
 * Appends the run-start intent before an opaque Integrator call and reuses it
 * after process loss. The durable key makes the same (session, ordinal) win
 * concurrent registration attempts.
 */
export const appendIntegratorRunStartedIfNeeded = Effect.fn("IntegratorProtocol.appendRunStartedIfNeeded")(function* (
  journal: InRunJournal["Service"],
  run: IntegratorRunCorrelation,
  records: ReadonlyArray<JournalRecord>
) {
  const key = integratorRunStartedRecordKey(run)
  const existing = integratorFindEventAtKey(records, key)
  if (existing !== undefined) {
    if (!runStartRecordMatches(existing, run)) {
      return yield* new IntegratorJournalContradiction({
        detail: "run-start key contains a foreign event or precedes the fixed lineage",
        runId: runIdForCorrelation(run.session)
      })
    }
    return existing
  }
  const event = IntegratorRunStartedEvent.make({ run, version: workflowJournalEventVersion })
  const appended = yield* journal.append(runIdForCorrelation(run.session), key, event)
  if (!runStartRecordMatches(appended, run)) {
    return yield* new IntegratorJournalContradiction({
      detail: "run-start append lost to a foreign event or does not follow the fixed lineage",
      runId: runIdForCorrelation(run.session)
    })
  }
  return appended
})

export const readRecordedIntegratorRunStarted = (
  records: ReadonlyArray<JournalRecord>,
  run: IntegratorRunCorrelation
): Effect.Effect<Option.Option<JournalRecord>, IntegratorJournalContradiction> => {
  const existing = integratorFindEventAtKey(records, integratorRunStartedRecordKey(run))
  if (existing === undefined) return Effect.succeed(Option.none())
  return runStartRecordMatches(existing, run) && existing.event._tag === "IntegratorRunStarted"
    ? Effect.succeed(Option.some(existing))
    : Effect.fail(
        new IntegratorJournalContradiction({
          detail: "run-start key contains a foreign event or precedes the fixed lineage",
          runId: runIdForCorrelation(run.session)
        })
      )
}

export const integratorLineageIsCompatible = (input: IntegratorPreparationInput): boolean =>
  input.targetLineage.plannedBaseIsAncestorOfTargetHead &&
  input.targetLineage.plannedBaseSha === input.responsibility.plannedAttempt.baseSha

const targetLineageObservationEquivalence = Schema.toEquivalence(TargetLineageObservation)
const plannedAttemptEquivalence = Schema.toEquivalence(PlannedTaskAttempt)
const integrationTargetEquivalence = Schema.toEquivalence(IntegrationTarget)

const targetLineageIntentFor = (
  records: ReadonlyArray<JournalRecord>,
  targetLineagePosition: JournalPosition,
  operationId: OperationId
): JournalRecord | undefined =>
  records.find(
    ({ event, position }) =>
      position < targetLineagePosition &&
      event._tag === "GitReadIntentRecorded" &&
      event.operation._tag === "ReadTargetLineage" &&
      event.operation.operationId === operationId
  )

export const hasMatchingIntegratorTargetLineageObservation = (
  records: ReadonlyArray<JournalRecord>,
  input: IntegratorPreparationInput
): boolean => {
  const record = records.find(({ position }) => position === input.targetLineageObservedAt)
  if (record?.event._tag !== "TargetLineageObserved") return false
  const intent = targetLineageIntentFor(records, record.position, record.event.operationId)
  return (
    intent?.event._tag === "GitReadIntentRecorded" &&
    intent.event.operation._tag === "ReadTargetLineage" &&
    integrationTargetEquivalence(intent.event.operation.integrationTarget, input.responsibility.integrationTarget) &&
    targetLineageObservationEquivalence(record.event.observation, input.targetLineage) &&
    plannedAttemptEquivalence(record.event.plannedAttempt, input.responsibility.plannedAttempt)
  )
}

export const readRecordedIntegratorSession = (
  records: ReadonlyArray<JournalRecord>,
  responsibility: StartedIntegrationResponsibility
): Effect.Effect<Option.Option<IntegratorCorrelation>, IntegratorJournalContradiction> => {
  const existing = integratorFindEventAtKey(
    records,
    integratorSessionFixedRecordKey(integratorResponsibilityFactsFor(responsibility))
  )
  if (existing === undefined) return Effect.succeed(Option.none())
  if (existing.event._tag !== "IntegratorSessionFixed") {
    return Effect.fail(
      new IntegratorJournalContradiction({
        detail: "session key contains a foreign event",
        runId: runIdFor(responsibility)
      })
    )
  }
  if (
    !integratorResponsibilityFactsEqual(
      integratorResponsibilityFactsFromCorrelation(existing.event.correlation),
      integratorResponsibilityFactsFor(responsibility)
    )
  ) {
    return Effect.fail(
      new IntegratorJournalContradiction({
        detail: "recorded session belongs to a foreign responsibility",
        runId: runIdFor(responsibility)
      })
    )
  }
  return Effect.succeed(Option.some(existing.event.correlation))
}
