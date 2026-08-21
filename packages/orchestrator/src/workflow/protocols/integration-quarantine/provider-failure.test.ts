import { it } from "@effect/vitest"
import {
  AttemptId,
  GitCommitSha,
  GitRepositoryLocator,
  IntegrationTarget,
  IntegrationTargetRef,
  PlannedTaskAttempt,
  RunId,
  TaskBranchRef,
  TaskExecutorLocator,
  TaskId,
  TaskRevision,
  WorktreeLocator
} from "@dalph/contracts"
import { Effect } from "effect"
import { expect } from "vitest"
import { acceptedResultFixture } from "../../../../test/support/evidence.js"
import { FixtureTarget } from "../../../authorities/task-tracker/fixture/target.js"
import { TargetLineageObservation } from "../../../authorities/git/target-lineage.js"
import { TaskWorkCapacity } from "../../../coordination/admission/capacity.js"
import { InitialControlPolicy } from "../../../control/policy.js"
import { OperationId } from "../../identity.js"
import { GitReadIntentRecordedEvent, TargetLineageObservedEvent } from "../../registry/event.js"
import { makeTargetLineageObservationOperation } from "../../registry/operation.js"
import {
  integrationProviderRunActivityAbsentRecordKey,
  integrationQuarantineDirectionAppliedRecordKey,
  integrationQuarantinedRecordKey,
  integratorRunStartedRecordKey,
  integratorSessionFixedRecordKey,
  integratorSuccessorSessionFixedRecordKey,
  intentRecordKey,
  outcomeRecordKey
} from "../../../workflow-journal/record-key.js"
import {
  InRunJournal,
  JournalStore,
  JournalStoreContradiction,
  type JournalRecord
} from "../../../workflow-journal/store.js"
import { JournalPosition, JournalRecordKey } from "../../../workflow-journal/identity.js"
import { memoryJournalTestLayer } from "../../../workflow-journal/adapters/memory-store.js"
import { workflowJournalEventVersion } from "../../kernel/event.js"
import {
  IntegrationProviderRunActivityAbsentEvent,
  IntegrationQuarantineBasis,
  IntegrationQuarantineDirectionAppliedEvent,
  IntegrationQuarantineDirectionFingerprint,
  IntegrationQuarantineDirectionRequestId,
  IntegrationQuarantineDirectionSubject,
  IntegrationQuarantineFailureDetail,
  IntegrationQuarantinedEvent
} from "./events.js"
import {
  appendProviderRunFailureQuarantine,
  providerRunStartFor,
  reconcileProviderRunFailureQuarantine,
  validateProviderRunActivityAbsent
} from "./provider-failure.js"
import { quarantineRecordForFingerprint } from "./canonical-provenance.js"
import { deriveIntegrationQuarantineState } from "./state.js"
import {
  IntegratorSessionCorrelation,
  IntegratorCandidateResourceLocator,
  IntegratorCandidateText,
  IntegratorGitObservation,
  IntegratorNotPreparedDetail,
  IntegratorResult,
  IntegratorRunCandidateGitObservedEvent,
  IntegratorRunCandidateGitReadIntendedEvent,
  IntegratorRunCorrelation,
  IntegratorRunOrdinal,
  IntegratorRunResultRecordedEvent,
  IntegratorRunStartedEvent,
  integratorRetryRunOrdinal,
  IntegratorSessionFixedEvent,
  IntegratorSessionId,
  IntegratorSuccessorSessionFixedEvent,
  firstFullRerunSuccessorGeneration
} from "../integrator/events.js"
import { IntegratorProviderActivityAbsent } from "../integrator/errors.js"
import { integratorResponsibilityFactsFromCorrelation } from "../integrator/state.js"
import {
  evaluateIntegratorFullRerunAuthorization,
  evaluateIntegratorRetryAuthorization,
  integratorRunTwoAuthorizationIssue
} from "../integrator/retry-authorization.js"
import { evaluateIntegratorFullRerunSuccessor } from "../integrator/successor-history.js"
import { StartedIntegrationResponsibility } from "../integration-admission/protocol.js"

const runId = RunId.make("provider-failure-quarantine-run")
const target = FixtureTarget.make("provider-failure-quarantine-target")
const base = GitCommitSha.make("a".repeat(40))
const targetHead = GitCommitSha.make("b".repeat(40))
const acceptedCommit = GitCommitSha.make("c".repeat(40))
const plannedAttempt = PlannedTaskAttempt.make({
  attemptId: AttemptId.make("provider-failure-quarantine-attempt"),
  baseSha: base,
  branch: TaskBranchRef.make("refs/heads/dalph/provider-failure-quarantine"),
  executor: TaskExecutorLocator.make("executor:provider-failure-quarantine"),
  runId,
  taskId: TaskId.make("provider-failure-quarantine-task"),
  taskRevision: TaskRevision.make("provider-failure-quarantine-revision"),
  worktree: WorktreeLocator.make("/worktrees/provider-failure-quarantine")
})
const responsibility = StartedIntegrationResponsibility.make({
  acceptedResult: acceptedResultFixture(acceptedCommit),
  integrationTarget: IntegrationTarget.make({
    ref: IntegrationTargetRef.make("refs/heads/main"),
    repository: GitRepositoryLocator.make("/repositories/provider-failure-quarantine.git")
  }),
  plannedAttempt,
  queuedAt: JournalPosition.make(3),
  startedAt: JournalPosition.make(4)
})
const detail = IntegrationQuarantineFailureDetail.make("the provider has no owned activity for this run")

type SuccessorSessionRecord = JournalRecord & { readonly event: IntegratorSuccessorSessionFixedEvent }
type DirectionRecord = JournalRecord & { readonly event: IntegrationQuarantineDirectionAppliedEvent }
type QuarantineRecord = JournalRecord & { readonly event: IntegrationQuarantinedEvent }
type TargetLineageRecord = JournalRecord & { readonly event: typeof TargetLineageObservedEvent.Type }

const isSuccessorSessionRecord = (record: JournalRecord): record is SuccessorSessionRecord =>
  record.event._tag === "IntegratorSuccessorSessionFixed"

const isDirectionRecord = (record: JournalRecord): record is DirectionRecord =>
  record.event._tag === "IntegrationQuarantineDirectionApplied"

const isQuarantineRecord = (record: JournalRecord): record is QuarantineRecord =>
  record.event._tag === "IntegrationQuarantined"

const isTargetLineageRecord = (record: JournalRecord): record is TargetLineageRecord =>
  record.event._tag === "TargetLineageObserved"

const mutateSuccessorEvent = (
  records: ReadonlyArray<JournalRecord>,
  selected: SuccessorSessionRecord,
  mutate: (event: IntegratorSuccessorSessionFixedEvent) => IntegratorSuccessorSessionFixedEvent
): ReadonlyArray<JournalRecord> =>
  records.map((record) => (record === selected ? { ...selected, event: mutate(selected.event) } : record))

const makeHistory = Effect.fn("ProviderFailureTest.makeHistory")(function* () {
  const journal = yield* JournalStore
  yield* journal.beginRun(runId, target, InitialControlPolicy.make({ taskExecutionCapacity: TaskWorkCapacity.make(1) }))
  const lineageOperationId = OperationId.make("provider-failure:lineage-operation")
  const lineageOperation = makeTargetLineageObservationOperation({
    integrationTarget: responsibility.integrationTarget,
    operationId: lineageOperationId,
    plannedAttempt,
    predecessorOperationIds: []
  })
  yield* journal.append(
    runId,
    intentRecordKey(lineageOperationId),
    GitReadIntentRecordedEvent.make({
      initiatedBy: { _tag: "DalphCoordinator" },
      occurrenceClassification: "InitiatedAction",
      operation: lineageOperation,
      version: workflowJournalEventVersion
    })
  )
  const lineage = yield* journal.append(
    runId,
    outcomeRecordKey(lineageOperationId),
    TargetLineageObservedEvent.make({
      observation: TargetLineageObservation.make({
        plannedBaseIsAncestorOfTargetHead: true,
        plannedBaseSha: base,
        targetHeadSha: targetHead
      }),
      occurrenceClassification: "NonActionOccurrence",
      operationId: lineageOperationId,
      plannedAttempt,
      version: workflowJournalEventVersion
    })
  )
  const session = IntegratorSessionCorrelation.make({
    acceptedResult: responsibility.acceptedResult,
    candidateResource: IntegratorCandidateResourceLocator.make("integrator-resource:provider-failure"),
    expectedTargetHead: targetHead,
    integrationTarget: responsibility.integrationTarget,
    plannedAttempt,
    queuedAt: responsibility.queuedAt,
    sessionId: IntegratorSessionId.make("integrator-session:provider-failure"),
    startedAt: responsibility.startedAt,
    targetLineageObservedAt: lineage.position
  })
  const run = IntegratorRunCorrelation.make({ ordinal: IntegratorRunOrdinal.make(1), session })
  yield* journal.append(
    runId,
    integratorSessionFixedRecordKey(integratorResponsibilityFactsFromCorrelation(session)),
    IntegratorSessionFixedEvent.make({ correlation: session, version: workflowJournalEventVersion })
  )
  yield* journal.append(
    runId,
    integratorRunStartedRecordKey(run),
    IntegratorRunStartedEvent.make({ run, version: workflowJournalEventVersion })
  )
  return { journal, run, session }
})

const providerFailure = (session: IntegratorSessionCorrelation): IntegratorProviderActivityAbsent =>
  IntegratorProviderActivityAbsent.make({ correlation: session, detail })

const absenceRecordFor = (run: IntegratorRunCorrelation, position: number, absenceDetail = detail): JournalRecord => ({
  event: IntegrationProviderRunActivityAbsentEvent.make({
    correlation: run.session,
    detail: absenceDetail,
    occurrenceClassification: "NonActionOccurrence",
    run,
    version: workflowJournalEventVersion
  }),
  key: integrationProviderRunActivityAbsentRecordKey(run),
  position: JournalPosition.make(position),
  runId: run.session.plannedAttempt.runId
})

const makeRetryHistory = Effect.fn("ProviderFailureTest.makeRetryHistory")(function* () {
  const history = yield* makeHistory()
  const first = yield* appendProviderRunFailureQuarantine({
    run: history.run,
    failure: providerFailure(history.session)
  })
  const subject = IntegrationQuarantineDirectionSubject.make({
    quarantineAt: first.quarantine.position,
    sessionId: history.session.sessionId
  })
  yield* history.journal.append(
    runId,
    integrationQuarantineDirectionAppliedRecordKey(subject),
    IntegrationQuarantineDirectionAppliedEvent.make({
      fingerprint: IntegrationQuarantineDirectionFingerprint.make({
        direction: "Retry",
        quarantineAt: first.quarantine.position,
        sessionId: history.session.sessionId
      }),
      initiatedBy: { _tag: "Operator" },
      occurrenceClassification: "InitiatedAction",
      requestId: IntegrationQuarantineDirectionRequestId.make({ nonce: "provider-failure-retry", runId }),
      version: workflowJournalEventVersion
    })
  )
  const freshOperationId = OperationId.make("provider-failure:fresh-lineage-operation")
  yield* history.journal.append(
    runId,
    intentRecordKey(freshOperationId),
    GitReadIntentRecordedEvent.make({
      initiatedBy: { _tag: "DalphCoordinator" },
      occurrenceClassification: "InitiatedAction",
      operation: makeTargetLineageObservationOperation({
        integrationTarget: history.session.integrationTarget,
        operationId: freshOperationId,
        plannedAttempt,
        predecessorOperationIds: []
      }),
      version: workflowJournalEventVersion
    })
  )
  yield* history.journal.append(
    runId,
    outcomeRecordKey(freshOperationId),
    TargetLineageObservedEvent.make({
      observation: TargetLineageObservation.make({
        plannedBaseIsAncestorOfTargetHead: true,
        plannedBaseSha: base,
        targetHeadSha: targetHead
      }),
      occurrenceClassification: "NonActionOccurrence",
      operationId: freshOperationId,
      plannedAttempt,
      version: workflowJournalEventVersion
    })
  )
  const retryRun = IntegratorRunCorrelation.make({ ordinal: integratorRetryRunOrdinal, session: history.session })
  yield* history.journal.append(
    runId,
    integratorRunStartedRecordKey(retryRun),
    IntegratorRunStartedEvent.make({ run: retryRun, version: workflowJournalEventVersion })
  )
  return { ...history, first, retryRun }
})

const makeSuccessorHistory = Effect.fn("ProviderFailureTest.makeSuccessorHistory")(function* () {
  const history = yield* makeHistory()
  const first = yield* appendProviderRunFailureQuarantine({
    run: history.run,
    failure: providerFailure(history.session)
  })
  const subject = IntegrationQuarantineDirectionSubject.make({
    quarantineAt: first.quarantine.position,
    sessionId: history.session.sessionId
  })
  const direction = yield* history.journal.append(
    runId,
    integrationQuarantineDirectionAppliedRecordKey(subject),
    IntegrationQuarantineDirectionAppliedEvent.make({
      fingerprint: IntegrationQuarantineDirectionFingerprint.make({
        direction: "FullRerun",
        quarantineAt: first.quarantine.position,
        sessionId: history.session.sessionId
      }),
      initiatedBy: { _tag: "Operator" },
      occurrenceClassification: "InitiatedAction",
      requestId: IntegrationQuarantineDirectionRequestId.make({ nonce: "provider-failure-full-rerun", runId }),
      version: workflowJournalEventVersion
    })
  )
  const freshOperationId = OperationId.make("provider-failure:successor-lineage-operation")
  yield* history.journal.append(
    runId,
    intentRecordKey(freshOperationId),
    GitReadIntentRecordedEvent.make({
      initiatedBy: { _tag: "DalphCoordinator" },
      occurrenceClassification: "InitiatedAction",
      operation: makeTargetLineageObservationOperation({
        integrationTarget: history.session.integrationTarget,
        operationId: freshOperationId,
        plannedAttempt,
        predecessorOperationIds: []
      }),
      version: workflowJournalEventVersion
    })
  )
  const freshLineage = yield* history.journal.append(
    runId,
    outcomeRecordKey(freshOperationId),
    TargetLineageObservedEvent.make({
      observation: TargetLineageObservation.make({
        plannedBaseIsAncestorOfTargetHead: true,
        plannedBaseSha: base,
        targetHeadSha: targetHead
      }),
      occurrenceClassification: "NonActionOccurrence",
      operationId: freshOperationId,
      plannedAttempt,
      version: workflowJournalEventVersion
    })
  )
  const successorSession = IntegratorSessionCorrelation.make({
    ...history.session,
    candidateResource: IntegratorCandidateResourceLocator.make("integrator-resource:provider-failure-successor"),
    sessionId: IntegratorSessionId.make("integrator-session:provider-failure-successor"),
    targetLineageObservedAt: freshLineage.position
  })
  yield* history.journal.append(
    runId,
    integratorSuccessorSessionFixedRecordKey(history.session, first.quarantine.position, direction.position),
    IntegratorSuccessorSessionFixedEvent.make({
      direction: "FullRerun",
      directionAppliedAt: direction.position,
      predecessor: history.session,
      quarantineAt: first.quarantine.position,
      successor: successorSession,
      successorGeneration: firstFullRerunSuccessorGeneration,
      version: workflowJournalEventVersion
    })
  )
  const successorRun = IntegratorRunCorrelation.make({ ordinal: integratorRetryRunOrdinal, session: successorSession })
  yield* history.journal.append(
    runId,
    integratorRunStartedRecordKey(successorRun),
    IntegratorRunStartedEvent.make({ run: successorRun, version: workflowJournalEventVersion })
  )
  return { ...history, first, successorRun, successorSession }
})

const rejectProviderReconciliation = (records: ReadonlyArray<JournalRecord>, run: IntegratorRunCorrelation) =>
  reconcileProviderRunFailureQuarantine({ detail, run }).pipe(
    Effect.provideService(
      InRunJournal,
      InRunJournal.of({
        append: () => Effect.die("malformed provider chronology must fail before append"),
        read: () => Effect.succeed(records)
      })
    ),
    Effect.flip
  )

const expectProviderReconciliationRejected = (
  label: string,
  records: ReadonlyArray<JournalRecord>,
  run: IntegratorRunCorrelation
) =>
  Effect.gen(function* () {
    const failure = yield* rejectProviderReconciliation(records, run)
    expect(failure._tag, label).toBe("IntegratorJournalContradiction")
  })

it.effect("records provider-owned absence before one idempotent provider-failure quarantine", () =>
  Effect.gen(function* () {
    const history = yield* makeHistory()
    const first = yield* appendProviderRunFailureQuarantine({
      run: history.run,
      failure: providerFailure(history.session)
    })
    const second = yield* appendProviderRunFailureQuarantine({
      run: history.run,
      failure: providerFailure(history.session)
    })
    const records = yield* history.journal.read(runId)

    expect(second).toEqual(first)
    expect(first.absence.position).toBeLessThan(first.quarantine.position)
    expect(records.filter(({ event }) => event._tag === "IntegrationProviderRunActivityAbsent")).toHaveLength(1)
    expect(records.filter(({ event }) => event._tag === "IntegrationQuarantined")).toHaveLength(1)
    expect(deriveIntegrationQuarantineState(records, history.session.sessionId)._tag).toBe("Quarantined")
  }).pipe(Effect.provide(memoryJournalTestLayer))
)

it.effect("records a run-two provider absence only after authorized Retry Q1/D/L/start evidence", () =>
  Effect.gen(function* () {
    const history = yield* makeRetryHistory()
    const second = yield* appendProviderRunFailureQuarantine({
      run: history.retryRun,
      failure: providerFailure(history.session)
    })
    const records = yield* history.journal.read(runId)

    expect(second.absence.event.run).toEqual(history.retryRun)
    expect(second.absence.key).toBe(integrationProviderRunActivityAbsentRecordKey(history.retryRun))
    expect(second.absence.position).toBeGreaterThan(history.first.quarantine.position)
    expect(second.quarantine.position).toBeGreaterThan(second.absence.position)
    expect(records.filter(({ event }) => event._tag === "IntegrationProviderRunActivityAbsent")).toHaveLength(2)
    expect(records.filter(({ event }) => event._tag === "IntegrationQuarantined")).toHaveLength(2)
    expect(deriveIntegrationQuarantineState(records, history.session.sessionId)._tag).toBe("Quarantined")
  }).pipe(Effect.provide(memoryJournalTestLayer))
)

it.effect("recovers run-two Q without repeating the provider call after absence was already appended", () =>
  Effect.gen(function* () {
    const history = yield* makeRetryHistory()
    const absence = yield* history.journal.append(
      runId,
      integrationProviderRunActivityAbsentRecordKey(history.retryRun),
      IntegrationProviderRunActivityAbsentEvent.make({
        correlation: history.session,
        detail,
        occurrenceClassification: "NonActionOccurrence",
        run: history.retryRun,
        version: workflowJournalEventVersion
      })
    )
    const firstRecovery = yield* reconcileProviderRunFailureQuarantine({ detail, run: history.retryRun })
    const secondRecovery = yield* reconcileProviderRunFailureQuarantine({ detail, run: history.retryRun })
    const records = yield* history.journal.read(runId)

    expect(firstRecovery.absence.position).toBe(absence.position)
    expect(secondRecovery).toEqual(firstRecovery)
    expect(records.filter(({ event }) => event._tag === "IntegrationProviderRunActivityAbsent")).toHaveLength(2)
    expect(records.filter(({ event }) => event._tag === "IntegrationQuarantined")).toHaveLength(2)
  }).pipe(Effect.provide(memoryJournalTestLayer))
)

it.effect("quarantines provider absence for the FullRerun successor session S2", () =>
  Effect.gen(function* () {
    const history = yield* makeSuccessorHistory()
    const result = yield* appendProviderRunFailureQuarantine({
      run: history.successorRun,
      failure: providerFailure(history.successorSession)
    })
    const records = yield* history.journal.read(runId)

    expect(result.absence.event.run).toEqual(history.successorRun)
    expect(result.absence.key).toBe(integrationProviderRunActivityAbsentRecordKey(history.successorRun))
    expect(result.quarantine.event.correlation).toEqual(history.successorSession)
    expect(deriveIntegrationQuarantineState(records, history.successorSession.sessionId)._tag).toBe("Quarantined")
  }).pipe(Effect.provide(memoryJournalTestLayer))
)

it.effect("rejects S2 provider absence when the predecessor Q1 terminal evidence is missing", () =>
  Effect.gen(function* () {
    const history = yield* makeSuccessorHistory()
    const records = yield* history.journal.read(runId)
    const successorAbsence = absenceRecordFor(history.successorRun, records.length + 1)

    expect(validateProviderRunActivityAbsent([...records, successorAbsence], successorAbsence)._tag).toBe("Valid")
    expect(
      validateProviderRunActivityAbsent(
        [...records.filter((record) => record !== history.first.absence), successorAbsence],
        successorAbsence
      )._tag
    ).toBe("Invalid")
  }).pipe(Effect.provide(memoryJournalTestLayer))
)

it.effect("recovers Q after absence was durably recorded before the process disappeared", () =>
  Effect.gen(function* () {
    const history = yield* makeHistory()
    const absence = yield* history.journal.append(
      runId,
      integrationProviderRunActivityAbsentRecordKey(history.run),
      IntegrationProviderRunActivityAbsentEvent.make({
        correlation: history.session,
        detail,
        occurrenceClassification: "NonActionOccurrence",
        run: history.run,
        version: workflowJournalEventVersion
      })
    )
    const recovered = yield* reconcileProviderRunFailureQuarantine({ detail, run: history.run })
    const records = yield* history.journal.read(runId)

    expect(recovered.absence.position).toBe(absence.position)
    expect(recovered.quarantine.position).toBeGreaterThan(absence.position)
    expect(records.filter(({ event }) => event._tag === "IntegrationProviderRunActivityAbsent")).toHaveLength(1)
  }).pipe(Effect.provide(memoryJournalTestLayer))
)

it.effect("ignores an unrelated responsibility's run-one evidence", () =>
  Effect.gen(function* () {
    const history = yield* makeHistory()
    const unrelatedAttempt = PlannedTaskAttempt.make({
      ...plannedAttempt,
      attemptId: AttemptId.make("provider-failure-unrelated-attempt"),
      taskId: TaskId.make("provider-failure-unrelated-task"),
      taskRevision: TaskRevision.make("provider-failure-unrelated-revision"),
      worktree: WorktreeLocator.make("/worktrees/provider-failure-unrelated")
    })
    const unrelatedSession = IntegratorSessionCorrelation.make({
      ...history.session,
      plannedAttempt: unrelatedAttempt,
      candidateResource: IntegratorCandidateResourceLocator.make("integrator-resource:provider-failure-unrelated"),
      sessionId: IntegratorSessionId.make("integrator-session:provider-failure-unrelated")
    })
    const unrelatedRun = IntegratorRunCorrelation.make({
      ordinal: IntegratorRunOrdinal.make(1),
      session: unrelatedSession
    })
    yield* history.journal.append(
      runId,
      integratorSessionFixedRecordKey(integratorResponsibilityFactsFromCorrelation(unrelatedSession)),
      IntegratorSessionFixedEvent.make({ correlation: unrelatedSession, version: workflowJournalEventVersion })
    )
    yield* history.journal.append(
      runId,
      integratorRunStartedRecordKey(unrelatedRun),
      IntegratorRunStartedEvent.make({ run: unrelatedRun, version: workflowJournalEventVersion })
    )

    const result = yield* reconcileProviderRunFailureQuarantine({ detail, run: history.run })
    expect(result.quarantine.event.correlation.sessionId).toBe(history.session.sessionId)
  }).pipe(Effect.provide(memoryJournalTestLayer))
)

it.effect("rejects a provider outcome bound to a foreign session", () =>
  Effect.gen(function* () {
    const history = yield* makeHistory()
    const foreignFailure = new IntegratorProviderActivityAbsent({
      correlation: IntegratorSessionCorrelation.make({
        ...history.session,
        sessionId: IntegratorSessionId.make("foreign-session")
      }),
      detail: "provider activity was not proven absent"
    })
    const result = yield* appendProviderRunFailureQuarantine({ run: history.run, failure: foreignFailure }).pipe(
      Effect.flip
    )
    const records = yield* history.journal.read(runId)

    expect(result._tag).toBe("IntegratorJournalContradiction")
    expect(records.some(({ event }) => event._tag === "IntegrationProviderRunActivityAbsent")).toBe(false)
    expect(records.some(({ event }) => event._tag === "IntegrationQuarantined")).toBe(false)
  }).pipe(Effect.provide(memoryJournalTestLayer))
)

it.effect("rejects missing, duplicate, foreign, and reordered run-one evidence", () =>
  Effect.gen(function* () {
    const history = yield* makeHistory()
    const records = yield* history.journal.read(runId)
    const runStartKey = integratorRunStartedRecordKey(history.run)
    const missingStartJournal = InRunJournal.of({
      append: () => Effect.die("missing run start must fail before append"),
      read: () => Effect.succeed(records.filter((record) => record.key !== runStartKey))
    })
    const missing = yield* reconcileProviderRunFailureQuarantine({ detail, run: history.run }).pipe(
      Effect.provideService(InRunJournal, missingStartJournal),
      Effect.flip
    )
    expect(missing._tag).toBe("IntegratorJournalContradiction")

    const duplicateAbsence = yield* history.journal.append(
      runId,
      JournalRecordKey.make("provider-failure:foreign-absence-key"),
      IntegrationProviderRunActivityAbsentEvent.make({
        correlation: history.session,
        detail,
        occurrenceClassification: "NonActionOccurrence",
        run: history.run,
        version: workflowJournalEventVersion
      })
    )
    expect(duplicateAbsence.key).not.toBe(integrationProviderRunActivityAbsentRecordKey(history.run))
    const duplicate = yield* reconcileProviderRunFailureQuarantine({ detail, run: history.run }).pipe(Effect.flip)
    expect(duplicate._tag).toBe("IntegratorJournalContradiction")

    const fabricatedAbsence: JournalRecord = {
      event: IntegrationProviderRunActivityAbsentEvent.make({
        correlation: history.session,
        detail,
        occurrenceClassification: "NonActionOccurrence",
        run: history.run,
        version: workflowJournalEventVersion
      }),
      key: integrationProviderRunActivityAbsentRecordKey(history.run),
      position: JournalPosition.make(1),
      runId
    }
    const fabricatedQuarantine = IntegrationQuarantinedEvent.make({
      basis: IntegrationQuarantineBasis.cases.ProviderRunFailure.make({
        detail,
        ownedActivityProvenAbsentAt: fabricatedAbsence.position
      }),
      correlation: history.session,
      occurrenceClassification: "NonActionOccurrence",
      version: workflowJournalEventVersion
    })
    const fabricated = deriveIntegrationQuarantineState(
      [
        ...records,
        fabricatedAbsence,
        {
          event: fabricatedQuarantine,
          key: integrationQuarantinedRecordKey(history.session.sessionId, fabricatedQuarantine.basis),
          position: JournalPosition.make(2),
          runId
        }
      ],
      history.session.sessionId
    )
    expect(fabricated._tag).toBe("Contradiction")

    const missingAbsencePosition = JournalPosition.make(records.length + 20)
    const missingAbsenceBasis = IntegrationQuarantineBasis.cases.ProviderRunFailure.make({
      detail,
      ownedActivityProvenAbsentAt: missingAbsencePosition
    })
    const missingAbsenceQuarantine = IntegrationQuarantinedEvent.make({
      basis: missingAbsenceBasis,
      correlation: history.session,
      occurrenceClassification: "NonActionOccurrence",
      version: workflowJournalEventVersion
    })
    expect(
      deriveIntegrationQuarantineState(
        [
          ...records,
          {
            event: missingAbsenceQuarantine,
            key: integrationQuarantinedRecordKey(history.session.sessionId, missingAbsenceBasis),
            position: JournalPosition.make(missingAbsencePosition + 1),
            runId
          }
        ],
        history.session.sessionId
      )._tag
    ).toBe("Contradiction")

    const validAbsencePosition = JournalPosition.make(records.length + 1)
    const validQuarantinePosition = JournalPosition.make(records.length + 2)
    const validAbsence: JournalRecord = {
      event: IntegrationProviderRunActivityAbsentEvent.make({
        correlation: history.session,
        detail,
        occurrenceClassification: "NonActionOccurrence",
        run: history.run,
        version: workflowJournalEventVersion
      }),
      key: integrationProviderRunActivityAbsentRecordKey(history.run),
      position: validAbsencePosition,
      runId
    }
    const validBasis = IntegrationQuarantineBasis.cases.ProviderRunFailure.make({
      detail,
      ownedActivityProvenAbsentAt: validAbsencePosition
    })
    const validQuarantine = IntegrationQuarantinedEvent.make({
      basis: validBasis,
      correlation: history.session,
      occurrenceClassification: "NonActionOccurrence",
      version: workflowJournalEventVersion
    })
    const validRecords = [
      ...records,
      validAbsence,
      {
        event: validQuarantine,
        key: integrationQuarantinedRecordKey(history.session.sessionId, validBasis),
        position: validQuarantinePosition,
        runId
      }
    ]
    expect(deriveIntegrationQuarantineState(validRecords, history.session.sessionId)._tag).toBe("Quarantined")
    expect(
      deriveIntegrationQuarantineState(
        [
          ...validRecords,
          {
            event: IntegratorRunStartedEvent.make({ run: history.run, version: workflowJournalEventVersion }),
            key: JournalRecordKey.make("provider-failure:foreign-run-start-key"),
            position: JournalPosition.make(validQuarantinePosition + 1),
            runId
          }
        ],
        history.session.sessionId
      )._tag
    ).toBe("Contradiction")
  }).pipe(Effect.provide(memoryJournalTestLayer))
)

it.effect("rejects provider absence when its run predecessors or exact Journal facts are incomplete", () =>
  Effect.gen(function* () {
    const history = yield* makeHistory()
    const records = yield* history.journal.read(runId)
    const absenceFor = (run: IntegratorRunCorrelation, position: number): JournalRecord => ({
      event: IntegrationProviderRunActivityAbsentEvent.make({
        correlation: run.session,
        detail,
        occurrenceClassification: "NonActionOccurrence",
        run,
        version: workflowJournalEventVersion
      }),
      key: integrationProviderRunActivityAbsentRecordKey(run),
      position: JournalPosition.make(position),
      runId
    })
    const absence = absenceFor(history.run, records.length + 1)
    const firstRecord = records.at(0)
    if (firstRecord === undefined) return yield* Effect.die("provider fixture lacks its beginning record")

    expect(validateProviderRunActivityAbsent(records, firstRecord)._tag).toBe("Invalid")
    expect(
      validateProviderRunActivityAbsent(
        records.filter((record) => record.event._tag !== "IntegratorSessionFixed"),
        absence
      )._tag
    ).toBe("Invalid")
    expect(
      validateProviderRunActivityAbsent(
        records.map((record) =>
          record.event._tag === "TargetLineageObserved"
            ? {
                ...record,
                event: { ...record.event, observation: { ...record.event.observation, targetHeadSha: base } }
              }
            : record
        ),
        absence
      )._tag
    ).toBe("Invalid")
    expect(
      validateProviderRunActivityAbsent(records, { ...absence, key: JournalRecordKey.make("foreign-absence-key") })._tag
    ).toBe("Invalid")
    expect(validateProviderRunActivityAbsent(records, { ...absence, runId: RunId.make("foreign-run") })._tag).toBe(
      "Invalid"
    )

    const unsupportedRun = IntegratorRunCorrelation.make({
      ordinal: IntegratorRunOrdinal.make(3),
      session: history.session
    })
    const unsupportedAbsence = absenceFor(unsupportedRun, records.length + 1)
    expect(validateProviderRunActivityAbsent(records, unsupportedAbsence)._tag).toBe("Invalid")

    const startForDuplicate = records.find((record) => record.event._tag === "IntegratorRunStarted")
    if (startForDuplicate === undefined) return yield* Effect.die("provider fixture lacks duplicate start source")
    const duplicateStart = { ...startForDuplicate, position: JournalPosition.make(records.length + 1) }
    expect(validateProviderRunActivityAbsent([...records, duplicateStart], absence)._tag).toBe("Invalid")

    const duplicateAbsence = { ...absence, position: JournalPosition.make(records.length + 2) }
    expect(validateProviderRunActivityAbsent([...records, absence, duplicateAbsence], absence)._tag).toBe("Invalid")

    const startRecord = records.find((record) => record.event._tag === "IntegratorRunStarted")
    if (startRecord === undefined) return yield* Effect.die("provider fixture lacks run-start record")
    const runResult = {
      ...startRecord,
      event: IntegratorRunResultRecordedEvent.make({
        result: IntegratorResult.cases.NotPrepared.make({
          correlation: history.session,
          detail: IntegratorNotPreparedDetail.make("provider fixture result")
        }),
        run: history.run,
        version: workflowJournalEventVersion
      }),
      position: JournalPosition.make(records.length + 1)
    }
    expect(validateProviderRunActivityAbsent([...records, runResult], absence)._tag).toBe("Invalid")
    expect(providerRunStartFor(records, history.run)?.position).toBeGreaterThan(history.session.targetLineageObservedAt)
  }).pipe(Effect.provide(memoryJournalTestLayer))
)

it.effect("covers exact fixed-session, run-start, and provider-evidence boundary contradictions", () =>
  Effect.gen(function* () {
    const history = yield* makeHistory()
    const records = yield* history.journal.read(runId)
    const fixed = records.find(({ event }) => event._tag === "IntegratorSessionFixed")
    const lineage = records.find(({ event }) => event._tag === "TargetLineageObserved")
    if (fixed === undefined || lineage === undefined) return yield* Effect.die("provider fixture lacks fixed lineage")
    const absence = absenceRecordFor(history.run, records.length + 3)

    const duplicateFixedKey = { ...lineage, key: fixed.key, position: JournalPosition.make(records.length + 1) }
    expect(validateProviderRunActivityAbsent([...records, duplicateFixedKey, absence], absence)._tag).toBe("Invalid")

    const fixedAtLineage = records.map((record) =>
      record === fixed ? { ...record, position: lineage.position } : record
    )
    expect(validateProviderRunActivityAbsent([...fixedAtLineage, absence], absence)._tag).toBe("Invalid")

    expect(
      providerRunStartFor(
        records.filter((record) => record.event._tag !== "IntegratorSessionFixed"),
        history.run
      )
    ).toBeUndefined()
    const runStart = records.find(({ event }) => event._tag === "IntegratorRunStarted")
    if (runStart === undefined) return yield* Effect.die("provider fixture lacks run start")
    const startAtFixed = records.map((record) =>
      record === runStart ? { ...record, position: fixed.position } : record
    )
    expect(providerRunStartFor(startAtFixed, history.run)).toBeUndefined()

    const candidateText = IntegratorCandidateText.make("refs/heads/provider-candidate")
    const candidateRead = {
      event: IntegratorRunCandidateGitReadIntendedEvent.make({
        candidateText,
        run: history.run,
        version: workflowJournalEventVersion
      }),
      key: JournalRecordKey.make("provider-candidate-read"),
      position: JournalPosition.make(records.length + 1),
      runId
    }
    const candidateObservation = {
      event: IntegratorRunCandidateGitObservedEvent.make({
        candidateText,
        observation: IntegratorGitObservation.cases.Missing.make({ candidateText }),
        run: history.run,
        version: workflowJournalEventVersion
      }),
      key: JournalRecordKey.make("provider-candidate-observation"),
      position: JournalPosition.make(records.length + 2),
      runId
    }
    const candidateAbsence = absenceRecordFor(history.run, records.length + 3)
    expect(
      validateProviderRunActivityAbsent(
        [...records, candidateRead, candidateObservation, candidateAbsence],
        candidateAbsence
      )._tag
    ).toBe("Invalid")

    const foreignSession = IntegratorSessionCorrelation.make({
      ...history.session,
      sessionId: IntegratorSessionId.make("provider-foreign-evidence-session")
    })
    if (absence.event._tag !== "IntegrationProviderRunActivityAbsent") {
      return yield* Effect.die("provider fixture lacks absence event")
    }
    const foreignAbsence: JournalRecord = { ...absence, event: { ...absence.event, correlation: foreignSession } }
    expect(validateProviderRunActivityAbsent(records, foreignAbsence)._tag).toBe("Invalid")

    const foreignRun = IntegratorRunCorrelation.make({ ordinal: IntegratorRunOrdinal.make(1), session: foreignSession })
    const foreignCandidate = {
      event: IntegratorRunCandidateGitObservedEvent.make({
        candidateText,
        observation: IntegratorGitObservation.cases.Missing.make({ candidateText }),
        run: foreignRun,
        version: workflowJournalEventVersion
      }),
      key: JournalRecordKey.make("provider-foreign-candidate"),
      position: JournalPosition.make(candidateAbsence.position + 1),
      runId
    }
    const foreignCandidateBeforeAbsence = { ...foreignCandidate, position: JournalPosition.make(records.length + 1) }
    expect(
      validateProviderRunActivityAbsent([...records, candidateAbsence, foreignCandidate], candidateAbsence)._tag
    ).toBe("Valid")
    expect(
      validateProviderRunActivityAbsent([...records, foreignCandidateBeforeAbsence, candidateAbsence], candidateAbsence)
        ._tag
    ).toBe("Valid")

    const resultAfterAbsence = {
      event: IntegratorRunResultRecordedEvent.make({
        result: IntegratorResult.cases.NotPrepared.make({
          correlation: history.session,
          detail: IntegratorNotPreparedDetail.make("result after absence")
        }),
        run: history.run,
        version: workflowJournalEventVersion
      }),
      key: JournalRecordKey.make("provider-result-after-absence"),
      position: JournalPosition.make(candidateAbsence.position + 2),
      runId
    }
    expect(
      validateProviderRunActivityAbsent([...records, candidateAbsence, resultAfterAbsence], candidateAbsence)._tag
    ).toBe("Invalid")
  }).pipe(Effect.provide(memoryJournalTestLayer))
)

it.effect("rejects Retry provider absence when Q1 direction evidence is missing", () =>
  Effect.gen(function* () {
    const history = yield* makeRetryHistory()
    const records = yield* history.journal.read(runId)
    const absence = absenceRecordFor(history.retryRun, records.length + 1)
    expect(
      validateProviderRunActivityAbsent(
        records.filter((record) => record.event._tag !== "IntegrationQuarantineDirectionApplied").concat(absence),
        absence
      )._tag
    ).toBe("Invalid")
  }).pipe(Effect.provide(memoryJournalTestLayer))
)

it.effect("reconciles a Retry absence against the post-append Journal reread", () =>
  Effect.gen(function* () {
    const history = yield* makeRetryHistory()
    const initial = yield* history.journal.read(runId)
    const durable: Array<JournalRecord> = [...initial]
    let reads = 0
    const journal: InRunJournal["Service"] = {
      append: (requestedRunId, key, event) => {
        const record: JournalRecord = {
          event,
          key,
          position: JournalPosition.make(durable.length + 1),
          runId: requestedRunId
        }
        durable.push(record)
        return Effect.succeed(record)
      },
      read: () => {
        reads += 1
        const current =
          reads >= 3
            ? durable.filter(
                (record) =>
                  record.event._tag !== "IntegrationQuarantineDirectionApplied" &&
                  record.event._tag !== "IntegrationQuarantined"
              )
            : durable
        return Effect.succeed(current)
      }
    }
    const recovered = yield* reconcileProviderRunFailureQuarantine({ detail, run: history.retryRun }).pipe(
      Effect.provideService(InRunJournal, journal)
    )
    expect(recovered.quarantine.event._tag).toBe("IntegrationQuarantined")
    expect(reads).toBeGreaterThanOrEqual(3)
  }).pipe(Effect.provide(memoryJournalTestLayer))
)

it.effect("reconciles provider absence and quarantine across duplicate, ambiguous, and foreign Journal outcomes", () =>
  Effect.gen(function* () {
    const history = yield* makeHistory()
    const baseRecords = yield* history.journal.read(runId)
    const absence = absenceRecordFor(history.run, baseRecords.length + 1)

    const invalidExistingAbsence = absenceRecordFor(history.run, history.session.targetLineageObservedAt)
    const invalidExisting = yield* reconcileProviderRunFailureQuarantine({ detail, run: history.run }).pipe(
      Effect.provideService(
        InRunJournal,
        InRunJournal.of({
          append: () => Effect.die("invalid existing absence must not append"),
          read: () => Effect.succeed([...baseRecords, invalidExistingAbsence])
        })
      ),
      Effect.flip
    )
    expect(invalidExisting._tag).toBe("IntegratorJournalContradiction")

    const missingWinner = yield* reconcileProviderRunFailureQuarantine({ detail, run: history.run }).pipe(
      Effect.provideService(
        InRunJournal,
        InRunJournal.of({
          append: (requestedRunId, key, _event) =>
            Effect.fail(
              new JournalStoreContradiction({ existingPosition: JournalPosition.make(999), key, runId: requestedRunId })
            ),
          read: () => Effect.succeed(baseRecords)
        })
      ),
      Effect.flip
    )
    expect(missingWinner._tag).toBe("IntegratorJournalContradiction")

    const duplicateRecords = [...baseRecords, absence, { ...absence, position: JournalPosition.make(99) }]
    const duplicateAbsence = yield* reconcileProviderRunFailureQuarantine({ detail, run: history.run }).pipe(
      Effect.provideService(
        InRunJournal,
        InRunJournal.of({
          append: () => Effect.die("duplicate absence must not append"),
          read: () => Effect.succeed(duplicateRecords)
        })
      ),
      Effect.flip
    )
    expect(duplicateAbsence._tag).toBe("IntegratorJournalContradiction")

    const start = baseRecords.find((record) => record.event._tag === "IntegratorRunStarted")
    if (start === undefined) return yield* Effect.die("provider fixture lacks run-start evidence")
    const lineageForForeignKey = baseRecords.find((record) => record.event._tag === "TargetLineageObserved")
    if (lineageForForeignKey === undefined) return yield* Effect.die("provider fixture lacks lineage evidence")
    const foreignAtAbsenceKey = {
      ...lineageForForeignKey,
      key: absence.key,
      position: JournalPosition.make(baseRecords.length + 1)
    }
    const foreignAbsenceKey = yield* reconcileProviderRunFailureQuarantine({ detail, run: history.run }).pipe(
      Effect.provideService(
        InRunJournal,
        InRunJournal.of({
          append: () => Effect.die("foreign absence key must not append"),
          read: () => Effect.succeed([...baseRecords, foreignAtAbsenceKey])
        })
      ),
      Effect.flip
    )
    expect(foreignAbsenceKey._tag).toBe("IntegratorJournalContradiction")

    const ambiguousRecords: Array<JournalRecord> = [...baseRecords]
    let ambiguousPosition = baseRecords.length
    const ambiguousJournal: InRunJournal["Service"] = {
      append: (requestedRunId, key, event) => {
        ambiguousPosition += 1
        const winner: JournalRecord =
          event._tag === "IntegrationProviderRunActivityAbsent"
            ? absenceRecordFor(history.run, ambiguousPosition)
            : { event, key, position: JournalPosition.make(ambiguousPosition), runId: requestedRunId }
        ambiguousRecords.push(winner)
        return event._tag === "IntegrationProviderRunActivityAbsent"
          ? Effect.fail(
              new JournalStoreContradiction({ existingPosition: winner.position, key, runId: requestedRunId })
            )
          : Effect.succeed(winner)
      },
      read: () => Effect.succeed(ambiguousRecords)
    }
    const ambiguous = yield* reconcileProviderRunFailureQuarantine({ detail, run: history.run }).pipe(
      Effect.provideService(InRunJournal, ambiguousJournal)
    )
    expect(ambiguous.quarantine.event._tag).toBe("IntegrationQuarantined")

    const invalidWinner: Array<JournalRecord> = [...baseRecords]
    const invalidAmbiguousJournal: InRunJournal["Service"] = {
      append: (requestedRunId, key, _event) => {
        const winner = absenceRecordFor(history.run, baseRecords.length + 1)
        invalidWinner.push(winner, { ...winner, position: JournalPosition.make(winner.position + 1) })
        return Effect.fail(
          new JournalStoreContradiction({ existingPosition: winner.position, key, runId: requestedRunId })
        )
      },
      read: () => Effect.succeed(invalidWinner)
    }
    const invalidAmbiguous = yield* reconcileProviderRunFailureQuarantine({ detail, run: history.run }).pipe(
      Effect.provideService(InRunJournal, invalidAmbiguousJournal),
      Effect.flip
    )
    expect(invalidAmbiguous._tag).toBe("IntegratorJournalContradiction")

    const foreignAbsenceJournal: InRunJournal["Service"] = {
      append: (requestedRunId, key) =>
        Effect.succeed({
          ...start,
          key,
          runId: requestedRunId,
          position: JournalPosition.make(baseRecords.length + 1)
        }),
      read: () => Effect.succeed(baseRecords)
    }
    const foreignAbsence = yield* reconcileProviderRunFailureQuarantine({ detail, run: history.run }).pipe(
      Effect.provideService(InRunJournal, foreignAbsenceJournal),
      Effect.flip
    )
    expect(foreignAbsence._tag).toBe("IntegratorJournalContradiction")

    let postAppendRead = 0
    const invalidAfterAppendJournal: InRunJournal["Service"] = {
      append: (requestedRunId, key, event) =>
        Effect.succeed({ event, key, position: JournalPosition.make(baseRecords.length + 1), runId: requestedRunId }),
      read: () => {
        postAppendRead += 1
        return Effect.succeed(
          postAppendRead < 2
            ? baseRecords
            : [...baseRecords.filter((record) => record.event._tag !== "IntegratorRunStarted"), absence]
        )
      }
    }
    const invalidAfterAppend = yield* reconcileProviderRunFailureQuarantine({ detail, run: history.run }).pipe(
      Effect.provideService(InRunJournal, invalidAfterAppendJournal),
      Effect.flip
    )
    expect(invalidAfterAppend._tag).toBe("IntegratorJournalContradiction")

    const foreignBasis = IntegrationQuarantineBasis.cases.ProviderRunFailure.make({
      detail: IntegrationQuarantineFailureDetail.make("foreign provider quarantine"),
      ownedActivityProvenAbsentAt: JournalPosition.make(1)
    })
    const foreignQuarantine = IntegrationQuarantinedEvent.make({
      basis: foreignBasis,
      correlation: history.session,
      occurrenceClassification: "NonActionOccurrence",
      version: workflowJournalEventVersion
    })
    yield* history.journal.append(
      runId,
      integrationQuarantinedRecordKey(history.session.sessionId, foreignBasis),
      foreignQuarantine
    )
    const foreignQuarantineFailure = yield* reconcileProviderRunFailureQuarantine({ detail, run: history.run }).pipe(
      Effect.provideService(InRunJournal, history.journal),
      Effect.flip
    )
    expect(foreignQuarantineFailure._tag).toBe("IntegratorJournalContradiction")

    const existingRecords = baseRecords
    const existingAbsence = absenceRecordFor(history.run, existingRecords.length + 1)
    const expectedBasis = IntegrationQuarantineBasis.cases.ProviderRunFailure.make({
      detail,
      ownedActivityProvenAbsentAt: existingAbsence.position
    })
    const expectedQuarantine = IntegrationQuarantinedEvent.make({
      basis: expectedBasis,
      correlation: history.session,
      occurrenceClassification: "NonActionOccurrence",
      version: workflowJournalEventVersion
    })
    const expectedKey = integrationQuarantinedRecordKey(history.session.sessionId, expectedBasis)
    const duplicateQuarantineRecords = [
      ...existingRecords,
      existingAbsence,
      {
        event: expectedQuarantine,
        key: expectedKey,
        position: JournalPosition.make(existingAbsence.position + 1),
        runId
      },
      {
        event: expectedQuarantine,
        key: expectedKey,
        position: JournalPosition.make(existingAbsence.position + 2),
        runId
      }
    ]
    const duplicateQuarantine = yield* reconcileProviderRunFailureQuarantine({ detail, run: history.run }).pipe(
      Effect.provideService(
        InRunJournal,
        InRunJournal.of({
          append: () => Effect.die("duplicate quarantine must not append"),
          read: () => Effect.succeed(duplicateQuarantineRecords)
        })
      ),
      Effect.flip
    )
    expect(duplicateQuarantine._tag).toBe("IntegratorJournalContradiction")

    const foreignQuarantineRecord = {
      ...lineageForForeignKey,
      key: expectedKey,
      position: JournalPosition.make(existingAbsence.position + 1)
    }
    const foreignQuarantineKey = yield* reconcileProviderRunFailureQuarantine({ detail, run: history.run }).pipe(
      Effect.provideService(
        InRunJournal,
        InRunJournal.of({
          append: () => Effect.die("foreign quarantine key must not append"),
          read: () => Effect.succeed([...existingRecords, existingAbsence, foreignQuarantineRecord])
        })
      ),
      Effect.flip
    )
    expect(foreignQuarantineKey._tag).toBe("IntegratorJournalContradiction")

    const ambiguousQuarantineRecords: Array<JournalRecord> = [...existingRecords, existingAbsence]
    const ambiguousQuarantineJournal: InRunJournal["Service"] = {
      append: (requestedRunId, key, event) => {
        const winner: JournalRecord = {
          event,
          key,
          position: JournalPosition.make(existingAbsence.position + 1),
          runId: requestedRunId
        }
        ambiguousQuarantineRecords.push(winner)
        return Effect.fail(
          new JournalStoreContradiction({ existingPosition: winner.position, key, runId: requestedRunId })
        )
      },
      read: () => Effect.succeed(ambiguousQuarantineRecords)
    }
    const ambiguousQuarantine = yield* reconcileProviderRunFailureQuarantine({ detail, run: history.run }).pipe(
      Effect.provideService(InRunJournal, ambiguousQuarantineJournal)
    )
    expect(ambiguousQuarantine.quarantine.key).toBe(expectedKey)

    const invalidQuarantineRecords: Array<JournalRecord> = [...existingRecords, existingAbsence]
    const invalidQuarantineJournal: InRunJournal["Service"] = {
      append: (requestedRunId, key, _event) => {
        const winner: JournalRecord = {
          ...start,
          key,
          position: JournalPosition.make(existingAbsence.position + 1),
          runId: requestedRunId
        }
        invalidQuarantineRecords.push(winner)
        return Effect.fail(
          new JournalStoreContradiction({ existingPosition: winner.position, key, runId: requestedRunId })
        )
      },
      read: () => Effect.succeed(invalidQuarantineRecords)
    }
    const invalidQuarantine = yield* reconcileProviderRunFailureQuarantine({ detail, run: history.run }).pipe(
      Effect.provideService(InRunJournal, invalidQuarantineJournal),
      Effect.flip
    )
    expect(invalidQuarantine._tag).toBe("IntegratorJournalContradiction")

    const foreignQuarantineAppendJournal: InRunJournal["Service"] = {
      append: (requestedRunId, key) =>
        Effect.succeed({
          ...start,
          key,
          runId: requestedRunId,
          position: JournalPosition.make(existingAbsence.position + 1)
        }),
      read: () => Effect.succeed([...existingRecords, existingAbsence])
    }
    const foreignQuarantineAppend = yield* reconcileProviderRunFailureQuarantine({ detail, run: history.run }).pipe(
      Effect.provideService(InRunJournal, foreignQuarantineAppendJournal),
      Effect.flip
    )
    expect(foreignQuarantineAppend._tag).toBe("IntegratorJournalContradiction")
  }).pipe(Effect.provide(memoryJournalTestLayer))
)

it.effect("rejects successor, Retry, and legacy provider histories before recording absence", () =>
  Effect.gen(function* () {
    const successorHistory = yield* makeSuccessorHistory()
    const successorRecords = yield* successorHistory.journal.read(runId)
    const successorAbsence = absenceRecordFor(successorHistory.successorRun, successorRecords.length + 1)
    const successorHistoryWithAbsence = [...successorRecords, successorAbsence]
    const successorValidation = validateProviderRunActivityAbsent(successorHistoryWithAbsence, successorAbsence)
    if (successorValidation._tag === "Invalid") return yield* Effect.die(successorValidation.detail)

    const successorFixed = successorRecords.find((record) => record.event._tag === "IntegratorSuccessorSessionFixed")
    if (successorFixed === undefined) return yield* Effect.die("provider fixture lacks successor session")
    const foreignDirectSession = IntegratorSessionCorrelation.make({
      ...successorHistory.session,
      sessionId: IntegratorSessionId.make("provider-foreign-direct-session")
    })
    const foreignDirect = {
      event: IntegratorSessionFixedEvent.make({
        correlation: foreignDirectSession,
        version: workflowJournalEventVersion
      }),
      key: JournalRecordKey.make("provider-foreign-direct-key"),
      position: JournalPosition.make(successorAbsence.position - 1),
      runId
    }
    expect(
      validateProviderRunActivityAbsent([...successorHistoryWithAbsence, foreignDirect], successorAbsence)._tag
    ).toBe("Invalid")
    for (const missingEventTag of ["IntegrationQuarantined", "IntegrationQuarantineDirectionApplied"] as const) {
      expect(
        validateProviderRunActivityAbsent(
          successorHistoryWithAbsence.filter((record) => record.event._tag !== missingEventTag),
          successorAbsence
        )._tag
      ).toBe("Invalid")
    }
    expect(
      validateProviderRunActivityAbsent(
        successorHistoryWithAbsence.map((record) =>
          record.event._tag === "IntegrationQuarantineDirectionApplied"
            ? {
                ...record,
                event: IntegrationQuarantineDirectionAppliedEvent.make({
                  ...record.event,
                  fingerprint: { ...record.event.fingerprint, direction: "Retry" }
                })
              }
            : record
        ),
        successorAbsence
      )._tag
    ).toBe("Invalid")
    expect(
      validateProviderRunActivityAbsent(
        successorHistoryWithAbsence.map((record) =>
          record.position === successorHistory.successorSession.targetLineageObservedAt &&
          record.event._tag === "TargetLineageObserved"
            ? {
                ...record,
                event: { ...record.event, observation: { ...record.event.observation, targetHeadSha: base } }
              }
            : record
        ),
        successorAbsence
      )._tag
    ).toBe("Invalid")
    expect(
      validateProviderRunActivityAbsent(
        [
          ...successorHistoryWithAbsence,
          { ...successorFixed, position: JournalPosition.make(successorAbsence.position - 1) }
        ],
        successorAbsence
      )._tag
    ).toBe("Invalid")
    expect(
      validateProviderRunActivityAbsent(
        successorHistoryWithAbsence.filter((record) => record.event._tag !== "IntegratorSessionFixed"),
        successorAbsence
      )._tag
    ).toBe("Invalid")
    expect(
      validateProviderRunActivityAbsent(
        successorHistoryWithAbsence.map((record) =>
          record.event._tag === "IntegratorSuccessorSessionFixed"
            ? { ...record, key: JournalRecordKey.make("provider-foreign-successor-key") }
            : record
        ),
        successorAbsence
      )._tag
    ).toBe("Invalid")
    expect(
      validateProviderRunActivityAbsent(
        successorHistoryWithAbsence.map((record) =>
          record.event._tag === "IntegratorSuccessorSessionFixed"
            ? {
                ...record,
                event: IntegratorSuccessorSessionFixedEvent.make({
                  ...record.event,
                  successor: { ...record.event.successor, expectedTargetHead: base }
                })
              }
            : record
        ),
        successorAbsence
      )._tag
    ).toBe("Invalid")
    expect(
      validateProviderRunActivityAbsent(
        successorHistoryWithAbsence.filter(
          (record) =>
            !(
              record.event._tag === "GitReadIntentRecorded" &&
              record.event.operation._tag === "ReadTargetLineage" &&
              record.position > successorHistory.first.quarantine.position
            )
        ),
        successorAbsence
      )._tag
    ).toBe("Invalid")

    const resultRecord = {
      event: IntegratorRunResultRecordedEvent.make({
        result: IntegratorResult.cases.NotPrepared.make({
          correlation: successorHistory.successorSession,
          detail: IntegratorNotPreparedDetail.make("provider result blocks absence")
        }),
        run: successorHistory.successorRun,
        version: workflowJournalEventVersion
      }),
      key: JournalRecordKey.make("provider-result-before-absence"),
      position: JournalPosition.make(successorAbsence.position - 1),
      runId
    }
    expect(
      validateProviderRunActivityAbsent([...successorHistoryWithAbsence, resultRecord], successorAbsence)._tag
    ).toBe("Invalid")
  }).pipe(Effect.provide(memoryJournalTestLayer))
)

it.effect("rejects Retry provider history when the fresh target head changed", () =>
  Effect.gen(function* () {
    const history = yield* makeRetryHistory()
    const records = yield* history.journal.read(runId)
    const absence = absenceRecordFor(history.retryRun, records.length + 1)
    const withAbsence = [...records, absence]

    expect(validateProviderRunActivityAbsent(withAbsence, absence)._tag).toBe("Valid")
    const changedFreshLineage = withAbsence.map((record) =>
      record.event._tag === "TargetLineageObserved" && record.position > history.first.quarantine.position
        ? { ...record, event: { ...record.event, observation: { ...record.event.observation, targetHeadSha: base } } }
        : record
    )
    expect(validateProviderRunActivityAbsent(changedFreshLineage, absence)._tag).toBe("Invalid")
  }).pipe(Effect.provide(memoryJournalTestLayer))
)

it.effect("rejects each exact provider-run predecessor witness when its owner or chronology changes", () =>
  Effect.gen(function* () {
    const history = yield* makeHistory()
    const records = yield* history.journal.read(runId)
    const absence = absenceRecordFor(history.run, records.length + 1)
    const lineage = records.find(({ event }) => event._tag === "TargetLineageObserved")
    const fixed = records.find(({ event }) => event._tag === "IntegratorSessionFixed")
    const start = records.find(({ event }) => event._tag === "IntegratorRunStarted")
    if (lineage?.event._tag !== "TargetLineageObserved" || fixed?.event._tag !== "IntegratorSessionFixed") {
      return yield* Effect.die("provider fixture lacks direct lineage or session evidence")
    }
    const lineageEvent = lineage.event
    const withAbsence = (input: ReadonlyArray<JournalRecord>) => [...input, absence]
    const reconcile = (input: ReadonlyArray<JournalRecord>) =>
      reconcileProviderRunFailureQuarantine({ detail, run: history.run }).pipe(
        Effect.provideService(
          InRunJournal,
          InRunJournal.of({
            append: () => Effect.die("tampered predecessor must fail before append"),
            read: () => Effect.succeed(input)
          })
        ),
        Effect.flip
      )
    const mutateLineage = (f: (record: JournalRecord) => JournalRecord) =>
      records.map((record) => (record === lineage ? f(record) : record))

    expect(
      validateProviderRunActivityAbsent(
        records.filter((record) => record !== lineage),
        absence
      )._tag
    ).toBe("Invalid")
    expect(
      validateProviderRunActivityAbsent(
        mutateLineage((record) => ({ ...record, position: JournalPosition.make(lineage.position + 1) })),
        absence
      )._tag
    ).toBe("Invalid")
    expect(
      validateProviderRunActivityAbsent(
        mutateLineage((record) => ({ ...record, runId: RunId.make("foreign-provider-run") })),
        absence
      )._tag
    ).toBe("Invalid")
    expect(
      validateProviderRunActivityAbsent(
        mutateLineage((record) => ({ ...record, key: JournalRecordKey.make("foreign-lineage-key") })),
        absence
      )._tag
    ).toBe("Invalid")
    expect(
      validateProviderRunActivityAbsent(
        mutateLineage((record) => ({
          ...record,
          event: { ...lineageEvent, plannedAttempt: { ...lineageEvent.plannedAttempt, taskId: TaskId.make("foreign") } }
        })),
        absence
      )._tag
    ).toBe("Invalid")
    expect(
      validateProviderRunActivityAbsent(
        mutateLineage((record) => ({
          ...record,
          event: { ...lineageEvent, observation: { ...lineageEvent.observation, plannedBaseSha: targetHead } }
        })),
        absence
      )._tag
    ).toBe("Invalid")
    expect(
      validateProviderRunActivityAbsent(
        mutateLineage((record) => ({
          ...record,
          event: { ...lineageEvent, observation: { ...lineageEvent.observation, targetHeadSha: base } }
        })),
        absence
      )._tag
    ).toBe("Invalid")
    expect(
      validateProviderRunActivityAbsent(
        mutateLineage((record) => ({
          ...record,
          event: {
            ...lineageEvent,
            observation: { ...lineageEvent.observation, plannedBaseIsAncestorOfTargetHead: false }
          }
        })),
        absence
      )._tag
    ).toBe("Invalid")
    expect(
      validateProviderRunActivityAbsent(
        records.filter(
          (record) =>
            !(
              record.event._tag === "GitReadIntentRecorded" &&
              record.event.operation._tag === "ReadTargetLineage" &&
              record.event.operation.operationId === lineageEvent.operationId
            )
        ),
        absence
      )._tag
    ).toBe("Invalid")

    const fixedKey = fixed.key
    expect(
      validateProviderRunActivityAbsent(
        records.filter((record) => record !== fixed),
        absence
      )._tag
    ).toBe("Invalid")
    expect(
      validateProviderRunActivityAbsent(
        records.map((record) =>
          record === fixed ? { ...record, key: JournalRecordKey.make("foreign-fixed-key") } : record
        ),
        absence
      )._tag
    ).toBe("Invalid")
    expect(
      validateProviderRunActivityAbsent(
        records.map((record) => (record === fixed ? { ...record, position: lineage.position } : record)),
        absence
      )._tag
    ).toBe("Invalid")
    if (records[0] !== undefined) {
      const duplicate = yield* reconcile(
        withAbsence([...records, { ...records[0], key: fixedKey, position: JournalPosition.make(records.length + 1) }])
      )
      expect(duplicate._tag).toBe("IntegratorJournalContradiction")
    }
    if (start !== undefined) {
      expect(
        providerRunStartFor(
          records.map((record) => (record === start ? { ...record, position: fixed.position } : record)),
          history.run
        )
      ).toBeUndefined()
    }

    const rejected = [
      ["lineage absent", records.filter((record) => record !== lineage)],
      [
        "lineage head changed",
        mutateLineage((record) => ({
          ...record,
          event: { ...lineageEvent, observation: { ...lineageEvent.observation, targetHeadSha: base } }
        }))
      ],
      [
        "lineage read intent absent",
        records.filter(
          (record) =>
            !(
              record.event._tag === "GitReadIntentRecorded" &&
              record.event.operation._tag === "ReadTargetLineage" &&
              record.event.operation.operationId === lineageEvent.operationId
            )
        )
      ],
      ["fixed session absent", records.filter((record) => record !== fixed)],
      [
        "fixed session moved to lineage",
        records.map((record) => (record === fixed ? { ...record, position: lineage.position } : record))
      ]
    ] as const
    for (const [name, input] of rejected) {
      const failure = yield* reconcile(withAbsence(input))
      expect(failure._tag, name).toBe("IntegratorJournalContradiction")
    }
  }).pipe(Effect.provide(memoryJournalTestLayer))
)

it.effect("rejects each FullRerun provider predecessor relation when Q/D/L chronology is incomplete", () =>
  Effect.gen(function* () {
    const history = yield* makeSuccessorHistory()
    const records = yield* history.journal.read(runId)
    const absence = absenceRecordFor(history.successorRun, records.length + 1)
    const successor = records.find(({ event }) => event._tag === "IntegratorSuccessorSessionFixed")
    const fixed = records.find(
      ({ event }) =>
        event._tag === "IntegratorSessionFixed" && event.correlation.sessionId === history.session.sessionId
    )
    const direction = records.find(({ event }) => event._tag === "IntegrationQuarantineDirectionApplied")
    const quarantine = records.find(({ event }) => event._tag === "IntegrationQuarantined")
    if (
      successor?.event._tag !== "IntegratorSuccessorSessionFixed" ||
      fixed === undefined ||
      direction?.event._tag !== "IntegrationQuarantineDirectionApplied" ||
      quarantine?.event._tag !== "IntegrationQuarantined"
    ) {
      return yield* Effect.die("provider fixture lacks FullRerun chronology")
    }
    const successorEvent = successor.event
    const directionEvent = direction.event
    const valid = [...records, absence]
    expect(validateProviderRunActivityAbsent(valid, absence)._tag).toBe("Valid")
    for (const tag of ["IntegrationQuarantined", "IntegrationQuarantineDirectionApplied"] as const) {
      expect(
        validateProviderRunActivityAbsent(
          valid.filter((record) => record.event._tag !== tag),
          absence
        )._tag
      ).toBe("Invalid")
    }
    expect(
      validateProviderRunActivityAbsent(
        valid.map((record) =>
          record === successor ? { ...record, key: JournalRecordKey.make("foreign-successor-key") } : record
        ),
        absence
      )._tag
    ).toBe("Invalid")
    expect(
      validateProviderRunActivityAbsent(
        valid.map((record) =>
          record === successor ? { ...record, position: history.successorSession.targetLineageObservedAt } : record
        ),
        absence
      )._tag
    ).toBe("Invalid")
    expect(
      validateProviderRunActivityAbsent(
        valid.map((record) =>
          record === successor
            ? {
                ...record,
                event: IntegratorSuccessorSessionFixedEvent.make({
                  ...successorEvent,
                  successor: { ...successorEvent.successor, expectedTargetHead: base }
                })
              }
            : record
        ),
        absence
      )._tag
    ).toBe("Invalid")
    expect(
      validateProviderRunActivityAbsent(
        valid.map((record) =>
          record === direction
            ? {
                ...record,
                event: IntegrationQuarantineDirectionAppliedEvent.make({
                  ...directionEvent,
                  fingerprint: { ...directionEvent.fingerprint, direction: "Retry" }
                })
              }
            : record
        ),
        absence
      )._tag
    ).toBe("Invalid")
    expect(
      validateProviderRunActivityAbsent(
        valid.map((record) =>
          record === quarantine
            ? { ...record, position: JournalPosition.make(direction.position + 1) }
            : record === direction
              ? { ...record, position: JournalPosition.make(quarantine.position - 1) }
              : record
        ),
        absence
      )._tag
    ).toBe("Invalid")
    expect(
      validateProviderRunActivityAbsent(
        valid.filter(
          (record) =>
            !(
              record.event._tag === "GitReadIntentRecorded" &&
              record.event.operation._tag === "ReadTargetLineage" &&
              record.position > history.first.quarantine.position
            )
        ),
        absence
      )._tag
    ).toBe("Invalid")
    expect(
      validateProviderRunActivityAbsent(
        valid.map((record) =>
          record === fixed
            ? {
                ...record,
                event: IntegratorSessionFixedEvent.make({
                  correlation: { ...history.session, sessionId: IntegratorSessionId.make("foreign-fixed-session") },
                  version: workflowJournalEventVersion
                })
              }
            : record
        ),
        absence
      )._tag
    ).toBe("Invalid")
  }).pipe(Effect.provide(memoryJournalTestLayer))
)

it.effect("reconstructs exact Retry and FullRerun authority and rejects moved or foreign chronology", () =>
  Effect.gen(function* () {
    const retry = yield* makeRetryHistory()
    const retryRecords = yield* retry.journal.read(runId)
    const retryAuthorization = evaluateIntegratorRetryAuthorization(retryRecords, retry.retryRun)
    expect(retryAuthorization).toMatchObject({ _tag: "Authorized" })

    const retryDirection = retryRecords.find(({ event }) => event._tag === "IntegrationQuarantineDirectionApplied")
    const retryQuarantine = retryRecords.find(({ event }) => event._tag === "IntegrationQuarantined")
    const retryFreshLineage = retryRecords.find(
      (record) => record.event._tag === "TargetLineageObserved" && record.position > retry.first.quarantine.position
    )
    if (
      retryDirection?.event._tag !== "IntegrationQuarantineDirectionApplied" ||
      retryQuarantine?.event._tag !== "IntegrationQuarantined" ||
      retryFreshLineage?.event._tag !== "TargetLineageObserved"
    ) {
      return yield* Effect.die("Retry fixture lacks its exact Q/D/L chronology")
    }
    const retryInvalid = (records: ReadonlyArray<JournalRecord>) =>
      expect(evaluateIntegratorRetryAuthorization(records, retry.retryRun)._tag).toBe("Rejected")

    retryInvalid(retryRecords.filter((record) => record !== retryDirection))
    retryInvalid(
      retryRecords.map((record) =>
        record === retryDirection ? { ...record, key: JournalRecordKey.make("foreign-retry-direction") } : record
      )
    )
    retryInvalid(
      retryRecords.map((record) =>
        record === retryQuarantine ? { ...record, key: JournalRecordKey.make("foreign-retry-quarantine") } : record
      )
    )
    retryInvalid(
      retryRecords.map((record) =>
        record === retryQuarantine
          ? { ...record, position: JournalPosition.make(Number(retryDirection.position) + 1) }
          : record
      )
    )
    retryInvalid(
      retryRecords.map((record) =>
        record === retryFreshLineage
          ? { ...record, position: JournalPosition.make(Number(retryDirection.position) - 1) }
          : record
      )
    )
    retryInvalid(
      retryRecords.map((record) =>
        record === retryFreshLineage ? { ...record, runId: RunId.make("foreign-retry-lineage-run") } : record
      )
    )
    retryInvalid(retryRecords.filter((record) => record.event._tag !== "IntegratorSessionFixed"))
    const firstRetryRecord = retryRecords[0]
    if (firstRetryRecord === undefined) return yield* Effect.die("Retry fixture lacks its first record")
    retryInvalid([...retryRecords, { ...firstRetryRecord, position: JournalPosition.make(999) }])
  }).pipe(Effect.provide(memoryJournalTestLayer))
)

it.effect("reconstructs exact FullRerun authority and rejects moved or foreign chronology", () =>
  Effect.gen(function* () {
    const fullRerun = yield* makeSuccessorHistory()
    const fullRecords = yield* fullRerun.journal.read(runId)
    const successorRecord = fullRecords.find(isSuccessorSessionRecord)
    const fullDirection = fullRecords.find(isDirectionRecord)
    const fullQuarantine = fullRecords.find(isQuarantineRecord)
    const fullFreshLineage = fullRecords.find(
      (record): record is TargetLineageRecord =>
        isTargetLineageRecord(record) && record.position > fullRerun.first.quarantine.position
    )
    const fullPredecessor = fullRecords.find(
      (record) =>
        record.event._tag === "IntegratorSessionFixed" &&
        record.event.correlation.sessionId === fullRerun.session.sessionId
    )
    if (
      successorRecord === undefined ||
      fullDirection === undefined ||
      fullQuarantine === undefined ||
      fullFreshLineage === undefined ||
      fullPredecessor === undefined
    ) {
      return yield* Effect.die("FullRerun fixture lacks its exact Q/D/L/S2 chronology")
    }
    const fullAuthorization = evaluateIntegratorFullRerunAuthorization(
      fullRecords,
      fullRerun.successorRun,
      fullRerun.session,
      fullRerun.successorSession.targetLineageObservedAt
    )
    expect(fullAuthorization).toMatchObject({ _tag: "Authorized" })
    expect(
      evaluateIntegratorRetryAuthorization(fullRecords, fullRerun.successorRun, {
        predecessorSession: fullRerun.session,
        requiredDirection: "FullRerun"
      })
    ).toMatchObject({ _tag: "Authorized" })
    expect(
      evaluateIntegratorFullRerunAuthorization(
        fullRecords,
        fullRerun.successorRun,
        fullRerun.session,
        fullRerun.session.targetLineageObservedAt
      )
    ).toMatchObject({ _tag: "Rejected" })
    expect(
      evaluateIntegratorFullRerunAuthorization(
        fullRecords.filter((record) => record !== fullRerun.first.absence),
        fullRerun.successorRun,
        fullRerun.session,
        fullRerun.successorSession.targetLineageObservedAt
      )
    ).toMatchObject({ _tag: "Rejected" })
    const mismatchedFreshTarget = mutateSuccessorEvent(fullRecords, successorRecord, (event) => ({
      ...event,
      successor: { ...event.successor, expectedTargetHead: base }
    })).map((record) =>
      record === fullFreshLineage && isTargetLineageRecord(record)
        ? { ...record, event: { ...record.event, observation: { ...record.event.observation, targetHeadSha: base } } }
        : record
    )
    expect(
      evaluateIntegratorFullRerunAuthorization(
        mismatchedFreshTarget,
        fullRerun.successorRun,
        fullRerun.session,
        fullRerun.successorSession.targetLineageObservedAt
      )
    ).toMatchObject({ _tag: "Rejected" })
    expect(
      evaluateIntegratorRetryAuthorization(fullRecords, fullRerun.successorRun, {
        predecessorSession: { ...fullRerun.session, sessionId: IntegratorSessionId.make("foreign-retry-predecessor") },
        requiredDirection: "FullRerun"
      })
    ).toMatchObject({ _tag: "Rejected" })
    expect(
      evaluateIntegratorRetryAuthorization(
        fullRecords.filter((record) => record !== fullPredecessor),
        fullRerun.successorRun,
        { predecessorSession: fullRerun.session, requiredDirection: "FullRerun" }
      )
    ).toMatchObject({ _tag: "Rejected" })
    expect(
      evaluateIntegratorFullRerunAuthorization(
        fullRecords,
        IntegratorRunCorrelation.make({ ordinal: IntegratorRunOrdinal.make(1), session: fullRerun.successorSession }),
        fullRerun.session,
        fullRerun.successorSession.targetLineageObservedAt
      )
    ).toMatchObject({ _tag: "Rejected" })

    const fullInvalid = (records: ReadonlyArray<JournalRecord>) =>
      expect(
        evaluateIntegratorFullRerunAuthorization(
          records,
          fullRerun.successorRun,
          fullRerun.session,
          fullRerun.successorSession.targetLineageObservedAt
        )._tag
      ).toBe("Rejected")
    fullInvalid(fullRecords.filter((record) => record !== successorRecord))
    fullInvalid(fullRecords.filter((record) => record !== fullQuarantine))
    fullInvalid(fullRecords.filter((record) => record !== fullDirection))
    fullInvalid(fullRecords.filter((record) => record !== fullFreshLineage))
    fullInvalid(
      fullRecords.map((record) =>
        record === successorRecord ? { ...record, key: JournalRecordKey.make("foreign-full-rerun-key") } : record
      )
    )
    fullInvalid(
      fullRecords.map((record) =>
        record === successorRecord ? { ...record, runId: RunId.make("foreign-full-rerun-run") } : record
      )
    )
    fullInvalid(
      mutateSuccessorEvent(fullRecords, successorRecord, (event) => ({
        ...event,
        predecessor: { ...fullRerun.session, sessionId: IntegratorSessionId.make("foreign-predecessor") }
      }))
    )
    fullInvalid(
      mutateSuccessorEvent(fullRecords, successorRecord, (event) => ({
        ...event,
        successor: {
          ...event.successor,
          candidateResource: fullRerun.session.candidateResource,
          sessionId: fullRerun.session.sessionId
        }
      }))
    )
    fullInvalid(
      mutateSuccessorEvent(fullRecords, successorRecord, (event) => ({
        ...event,
        successor: {
          ...event.successor,
          plannedAttempt: { ...event.successor.plannedAttempt, taskId: TaskId.make("foreign-successor-task") }
        }
      }))
    )
    fullInvalid(
      fullRecords.map((record) =>
        record === successorRecord
          ? { ...record, position: JournalPosition.make(Number(fullFreshLineage.position) - 1) }
          : record
      )
    )

    const successorRelation = evaluateIntegratorFullRerunSuccessor(fullRecords, successorRecord, fullRerun.session)
    expect(successorRelation).toMatchObject({ _tag: "Valid" })
    const firstFullRecord = fullRecords[0]
    if (firstFullRecord === undefined) return yield* Effect.die("FullRerun fixture lacks its first record")
    expect(evaluateIntegratorFullRerunSuccessor(fullRecords, firstFullRecord, fullRerun.session)).toMatchObject({
      _tag: "Invalid"
    })
    for (const [label, records] of [
      ["missing Q", fullRecords.filter((record) => record !== fullQuarantine)],
      ["missing D", fullRecords.filter((record) => record !== fullDirection)],
      ["missing fresh L", fullRecords.filter((record) => record !== fullFreshLineage)],
      [
        "missing predecessor L",
        fullRecords.filter((record) => record.position !== fullRerun.session.targetLineageObservedAt)
      ],
      [
        "moved fresh L",
        mutateSuccessorEvent(fullRecords, successorRecord, (event) => ({
          ...event,
          successor: { ...event.successor, targetLineageObservedAt: fullDirection.position }
        }))
      ]
    ] as const) {
      const candidate = records.find(isSuccessorSessionRecord) ?? successorRecord
      expect(evaluateIntegratorFullRerunSuccessor(records, candidate, fullRerun.session)._tag, label).toBe("Invalid")
    }

    const directSuccessorInvalid = (label: string, records: ReadonlyArray<JournalRecord>) => {
      const candidate = records.find(isSuccessorSessionRecord) ?? successorRecord
      expect(evaluateIntegratorFullRerunSuccessor(records, candidate, fullRerun.session)._tag, label).toBe("Invalid")
    }
    directSuccessorInvalid(
      "foreign predecessor",
      mutateSuccessorEvent(fullRecords, successorRecord, (event) => ({
        ...event,
        predecessor: { ...fullRerun.session, sessionId: IntegratorSessionId.make("foreign-direct-predecessor") }
      }))
    )
    directSuccessorInvalid(
      "foreign Journal Run",
      fullRecords.map((record) =>
        record === successorRecord ? { ...record, runId: RunId.make("foreign-direct-run") } : record
      )
    )
    directSuccessorInvalid(
      "reused identity",
      mutateSuccessorEvent(fullRecords, successorRecord, (event) => ({
        ...event,
        successor: {
          ...event.successor,
          candidateResource: fullRerun.session.candidateResource,
          sessionId: fullRerun.session.sessionId
        }
      }))
    )
    directSuccessorInvalid(
      "changed responsibility",
      mutateSuccessorEvent(fullRecords, successorRecord, (event) => ({
        ...event,
        successor: {
          ...event.successor,
          plannedAttempt: { ...event.successor.plannedAttempt, taskId: TaskId.make("foreign-direct-task") }
        }
      }))
    )
    expect(
      integratorRunTwoAuthorizationIssue(fullRecords, fullRerun.successorRun, {
        beforePosition: fullRerun.successorRun.session.targetLineageObservedAt
      })
    ).toBeDefined()

    const fingerprint = fullDirection.event.fingerprint
    expect(quarantineRecordForFingerprint(fullRecords, fingerprint)).toEqual(fullQuarantine)
    expect(
      quarantineRecordForFingerprint(fullRecords, {
        ...fingerprint,
        quarantineAt: JournalPosition.make(Number(fingerprint.quarantineAt) + 1)
      })
    ).toBeUndefined()
    expect(
      quarantineRecordForFingerprint(fullRecords, {
        ...fingerprint,
        sessionId: IntegratorSessionId.make("foreign-quarantine-session")
      })
    ).toBeUndefined()
    expect(
      quarantineRecordForFingerprint(
        fullRecords.filter((record) => record !== fullRerun.first.absence),
        fingerprint
      )
    ).toBeUndefined()
    const changedBasis = IntegrationQuarantineBasis.cases.RetryTargetHeadChanged.make({
      direction: "Retry",
      directionAppliedAt: fullDirection.position,
      observedTargetHead: base,
      priorQuarantineAt: fullQuarantine.position,
      targetLineageObservedAt: fullRerun.successorSession.targetLineageObservedAt
    })
    expect(
      quarantineRecordForFingerprint(
        fullRecords.map((record) =>
          record === fullQuarantine
            ? {
                ...record,
                event: IntegrationQuarantinedEvent.make({ ...fullQuarantine.event, basis: changedBasis }),
                key: integrationQuarantinedRecordKey(fullRerun.session.sessionId, changedBasis)
              }
            : record
        ),
        fingerprint
      )
    ).toBeUndefined()
  }).pipe(Effect.provide(memoryJournalTestLayer))
)

it.effect("rejects malformed provider predecessor matrices before writing absence", () =>
  Effect.gen(function* () {
    const expectRejected = expectProviderReconciliationRejected
    const direct = yield* makeHistory()
    const directRecords = yield* direct.journal.read(runId)
    const directStart = directRecords.find((record) => record.event._tag === "IntegratorRunStarted")
    if (directStart === undefined) return yield* Effect.die("provider fixture lacks direct run start")
    yield* expectRejected(
      "unsupported ordinal",
      directRecords,
      IntegratorRunCorrelation.make({ ordinal: IntegratorRunOrdinal.make(3), session: direct.session })
    )
    yield* expectRejected(
      "run start moved before fixed session",
      directRecords.map((record) =>
        record === directStart ? { ...record, position: direct.session.targetLineageObservedAt } : record
      ),
      direct.run
    )
    yield* expectRejected(
      "run result before absence",
      [
        ...directRecords,
        {
          event: IntegratorRunResultRecordedEvent.make({
            result: IntegratorResult.cases.NotPrepared.make({
              correlation: direct.session,
              detail: IntegratorNotPreparedDetail.make("provider result before absence")
            }),
            run: direct.run,
            version: workflowJournalEventVersion
          }),
          key: JournalRecordKey.make("provider-result-before-absence-reconcile"),
          position: JournalPosition.make(directRecords.length + 1),
          runId
        }
      ],
      direct.run
    )
    const candidateText = IntegratorCandidateText.make("refs/heads/provider-candidate-before-absence")
    yield* expectRejected(
      "candidate evidence before absence",
      [
        ...directRecords,
        {
          event: IntegratorRunCandidateGitObservedEvent.make({
            candidateText,
            observation: IntegratorGitObservation.cases.Missing.make({ candidateText }),
            run: direct.run,
            version: workflowJournalEventVersion
          }),
          key: JournalRecordKey.make("provider-candidate-before-absence-reconcile"),
          position: JournalPosition.make(directRecords.length + 1),
          runId
        }
      ],
      direct.run
    )
  }).pipe(Effect.provide(memoryJournalTestLayer))
)

it.effect("rejects malformed Retry provider chronology before writing absence", () =>
  Effect.gen(function* () {
    const expectRejected = expectProviderReconciliationRejected
    const retry = yield* makeRetryHistory()
    const retryRecords = yield* retry.journal.read(runId)
    const retryFreshLineage = retryRecords.find(
      (record) => isTargetLineageRecord(record) && record.position > retry.first.quarantine.position
    )
    if (!retryFreshLineage || !isTargetLineageRecord(retryFreshLineage)) {
      return yield* Effect.die("provider fixture lacks Retry fresh lineage")
    }
    yield* expectRejected(
      "Retry Q/D absent",
      retryRecords.filter((record) => record.event._tag !== "IntegrationQuarantineDirectionApplied"),
      retry.retryRun
    )
    yield* expectRejected(
      "Retry fresh target changed",
      retryRecords.map((record) =>
        record === retryFreshLineage && isTargetLineageRecord(record)
          ? { ...record, event: { ...record.event, observation: { ...record.event.observation, targetHeadSha: base } } }
          : record
      ),
      retry.retryRun
    )
  }).pipe(Effect.provide(memoryJournalTestLayer))
)

it.effect("rejects malformed FullRerun provider chronology before writing absence", () =>
  Effect.gen(function* () {
    const expectRejected = expectProviderReconciliationRejected
    const full = yield* makeSuccessorHistory()
    const fullRecords = yield* full.journal.read(runId)
    const successor = fullRecords.find(isSuccessorSessionRecord)
    const predecessor = fullRecords.find(
      (record) =>
        record.event._tag === "IntegratorSessionFixed" && record.event.correlation.sessionId === full.session.sessionId
    )
    const quarantine = fullRecords.find(isQuarantineRecord)
    const direction = fullRecords.find(isDirectionRecord)
    if (successor === undefined || predecessor === undefined || quarantine === undefined || direction === undefined) {
      return yield* Effect.die("provider fixture lacks FullRerun predecessor matrix")
    }
    yield* expectRejected(
      "FullRerun predecessor absent",
      fullRecords.filter((record) => record !== predecessor),
      full.successorRun
    )
    const foreignDirectSession = IntegratorSessionCorrelation.make({
      ...full.session,
      sessionId: IntegratorSessionId.make("provider-foreign-direct-matrix")
    })
    const foreignDirect: JournalRecord = {
      event: IntegratorSessionFixedEvent.make({
        correlation: foreignDirectSession,
        version: workflowJournalEventVersion
      }),
      key: JournalRecordKey.make("provider-foreign-direct-matrix"),
      position: JournalPosition.make(fullRecords.length + 1),
      runId
    }
    yield* expectRejected("FullRerun foreign direct session", [...fullRecords, foreignDirect], full.successorRun)
    yield* expectRejected(
      "FullRerun Q absent",
      fullRecords.filter((record) => record !== quarantine),
      full.successorRun
    )
    yield* expectRejected(
      "FullRerun D absent",
      fullRecords.filter((record) => record !== direction),
      full.successorRun
    )
    yield* expectRejected(
      "FullRerun successor key moved",
      fullRecords.map((record) =>
        record === successor ? { ...record, key: JournalRecordKey.make("provider-successor-foreign-matrix") } : record
      ),
      full.successorRun
    )
    yield* expectRejected(
      "FullRerun direction changed",
      fullRecords.map((record) =>
        record === direction && isDirectionRecord(record)
          ? {
              ...record,
              event: IntegrationQuarantineDirectionAppliedEvent.make({
                ...record.event,
                fingerprint: { ...record.event.fingerprint, direction: "Retry" }
              })
            }
          : record
      ),
      full.successorRun
    )
    yield* expectRejected(
      "FullRerun fresh lineage absent",
      fullRecords.filter(
        (record) =>
          !(
            (isTargetLineageRecord(record) && record.position > full.first.quarantine.position) ||
            (record.event._tag === "GitReadIntentRecorded" && record.position > full.first.quarantine.position)
          )
      ),
      full.successorRun
    )
    const duplicateSuccessor: JournalRecord = {
      ...successor,
      key: JournalRecordKey.make("provider-successor-duplicate-matrix"),
      position: JournalPosition.make(Number(successor.position) + 1)
    }
    yield* expectRejected("FullRerun duplicate successor", [...fullRecords, duplicateSuccessor], full.successorRun)
  }).pipe(Effect.provide(memoryJournalTestLayer))
)
