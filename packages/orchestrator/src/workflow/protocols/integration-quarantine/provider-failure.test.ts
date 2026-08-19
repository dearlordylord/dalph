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
  integratorSuccessorSessionFixedRecordKey
} from "../../../workflow-journal/record-key.js"
import {
  InRunJournal,
  JournalStore,
  JournalStoreContradiction,
  type JournalRecord
} from "../../../workflow-journal/store.js"
import { JournalPosition, JournalRecordKey } from "../../../workflow-journal/identity.js"
import { legacyMemoryJournalStoreLayer } from "../../../workflow-journal/adapters/memory-store.js"
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

const makeHistory = Effect.fn("ProviderFailureTest.makeHistory")(function* () {
  const journal = yield* JournalStore
  yield* journal.beginRun(runId, target, InitialControlPolicy.make({ taskExecutionCapacity: TaskWorkCapacity.make(1) }))
  const lineage = yield* journal.append(
    runId,
    JournalRecordKey.make("provider-failure:lineage"),
    TargetLineageObservedEvent.make({
      observation: TargetLineageObservation.make({
        plannedBaseIsAncestorOfTargetHead: true,
        plannedBaseSha: base,
        targetHeadSha: targetHead
      }),
      occurrenceClassification: "NonActionOccurrence",
      operationId: OperationId.make("provider-failure:lineage-operation"),
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
    JournalRecordKey.make("provider-failure:fresh-lineage-intent"),
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
    JournalRecordKey.make("provider-failure:fresh-lineage-observation"),
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
    JournalRecordKey.make("provider-failure:successor-lineage-intent"),
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
    JournalRecordKey.make("provider-failure:successor-lineage-observation"),
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
  const successorRun = IntegratorRunCorrelation.make({
    ordinal: IntegratorRunOrdinal.make(1),
    session: successorSession
  })
  yield* history.journal.append(
    runId,
    integratorRunStartedRecordKey(successorRun),
    IntegratorRunStartedEvent.make({ run: successorRun, version: workflowJournalEventVersion })
  )
  return { ...history, first, successorRun, successorSession }
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
  }).pipe(Effect.provide(legacyMemoryJournalStoreLayer))
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
  }).pipe(Effect.provide(legacyMemoryJournalStoreLayer))
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
  }).pipe(Effect.provide(legacyMemoryJournalStoreLayer))
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
  }).pipe(Effect.provide(legacyMemoryJournalStoreLayer))
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
  }).pipe(Effect.provide(legacyMemoryJournalStoreLayer))
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
  }).pipe(Effect.provide(legacyMemoryJournalStoreLayer))
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
  }).pipe(Effect.provide(legacyMemoryJournalStoreLayer))
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
  }).pipe(Effect.provide(legacyMemoryJournalStoreLayer))
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
  }).pipe(Effect.provide(legacyMemoryJournalStoreLayer))
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
  }).pipe(Effect.provide(legacyMemoryJournalStoreLayer))
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
  }).pipe(Effect.provide(legacyMemoryJournalStoreLayer))
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
  }).pipe(Effect.provide(legacyMemoryJournalStoreLayer))
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
  }).pipe(Effect.provide(legacyMemoryJournalStoreLayer))
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
  }).pipe(Effect.provide(legacyMemoryJournalStoreLayer))
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
  }).pipe(Effect.provide(legacyMemoryJournalStoreLayer))
)
