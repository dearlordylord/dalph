import { describe, expect, it } from "vitest"
import { HashMap } from "effect"
import { GitCommitSha, IntegrationTarget, RunId } from "@dalph/contracts"
import { integrationFinalityFixture } from "../../workflow/protocols/integration-finality/fixtures.js"
import {
  IntegratorCandidateText,
  IntegratorCandidateResourceLocator,
  IntegratorSessionCorrelation,
  IntegratorGitObservation,
  IntegratorResult,
  IntegratorRunCorrelation,
  IntegratorRunQualifiedCandidate,
  IntegratorRunCandidateGitObservedEvent,
  IntegratorRunCandidateGitReadIntendedEvent,
  IntegratorRunResultRecordedEvent,
  IntegratorRunStartedEvent,
  IntegratorSessionFixedEvent,
  IntegratorSessionId,
  IntegratorSuccessorSessionFixedEvent,
  firstFullRerunSuccessorGeneration
} from "../../workflow/protocols/integrator/events.js"
import {
  IntegrationResponsibilityBeganEvent,
  IntegrationStartedEvent
} from "../../workflow/protocols/integration-admission/events.js"
import {
  IntegrationProviderRunActivityAbsentEvent,
  IntegrationQuarantineDirectionAppliedEvent,
  IntegrationQuarantineDirectionFingerprint,
  IntegrationQuarantineDirectionRequestId,
  IntegrationQuarantineFailureDetail
} from "../../workflow/protocols/integration-quarantine/events.js"
import {
  TargetPromotionIntendedEvent,
  targetPromotionCorrelationFor
} from "../../workflow/protocols/target-promotion/events.js"
import { TargetLineageObservation } from "../../authorities/git/target-lineage.js"
import { OperationId } from "../../workflow/identity.js"
import { WorkflowActor } from "../../workflow/registry/actor.js"
import {
  GitReadIntentRecordedEvent,
  TargetLineageObservedEvent,
  TaskClaimAcquisitionIntendedEvent
} from "../../workflow/registry/event.js"
import { makeCompletionTaskFactsObservationOperation, WorkflowOperation } from "../../workflow/registry/operation.js"
import { workflowJournalEventVersion } from "../../workflow/kernel/event.js"
import { JournalPosition, JournalRecordKey } from "../../workflow-journal/identity.js"
import {
  integratorRunCandidateGitObservedRecordKey,
  integratorRunCandidateGitReadIntendedRecordKey,
  integratorRunResultRecordedRecordKey,
  integratorRunStartedRecordKey,
  integratorSuccessorSessionFixedRecordKey
} from "../../workflow-journal/record-key.js"
import type { JournalRecord } from "../../workflow-journal/store.js"
import type { IntegrationHistoryIndexes } from "./integration-history.js"
import { validateIntegrationHistoryRecord } from "./integration-history-validation.js"
import { makeTargetPromotionHistoryIndexes } from "./target-promotion-history.js"
import { invalidIntegrationRunBinding } from "./integration-history-run-binding.js"
import { TaskClaimReacquisitionRequestId } from "../../workflow/protocols/task-claim-reacquisition/events.js"
import {
  CompletionClaimDeletionReadObservedEvent,
  CompletionClaimDeletionReadPurpose,
  CompletionClaimCleanupReadOrdinal,
  CompletionClaimRequestOrdinal,
  CompletionTaskAuthorizationReadOrdinal,
  CompletionTaskFocusedReadPurpose,
  CompletionTaskRequestOrdinal,
  completionClaimDeletionRequestFor,
  completionTaskRequestFor,
  CompletionTaskClaim,
  FocusedTaskCompletionFacts
} from "../../workflow/protocols/integration-finality/events.js"
import {
  makeFocusedTaskCompletionFactsObserved,
  taskTrackerFactsObservedEvent
} from "../../workflow/task-tracker-facts/observation.js"
import { describeJournalEvent } from "../../workflow/registry/event-descriptor.js"

const fixture = integrationFinalityFixture
const runId = fixture.runId
const run = fixture.qualifiedCandidate.run
const session = run.session
const candidateText = IntegratorCandidateText.make("refs/heads/integrator-history-candidate")
const lineageOperationId = OperationId.make("integrator-history-lineage")
const lineageOperation = WorkflowOperation.cases.ReadTargetLineage.make({
  integrationTarget: fixture.integrationTarget,
  operationId: lineageOperationId,
  plannedAttempt: fixture.plannedAttempt,
  predecessorOperationIds: []
})
const lineageIntent = GitReadIntentRecordedEvent.make({
  initiatedBy: WorkflowActor.cases.DalphCoordinator.make({}),
  occurrenceClassification: "InitiatedAction",
  operation: lineageOperation,
  version: workflowJournalEventVersion
})
const lineageObservation = TargetLineageObservedEvent.make({
  observation: TargetLineageObservation.make({
    plannedBaseIsAncestorOfTargetHead: true,
    plannedBaseSha: fixture.plannedAttempt.baseSha,
    targetHeadSha: session.expectedTargetHead
  }),
  occurrenceClassification: "NonActionOccurrence",
  operationId: lineageOperationId,
  plannedAttempt: fixture.plannedAttempt,
  version: workflowJournalEventVersion
})
const integrationStarted = IntegrationStartedEvent.make({
  acceptedResult: session.acceptedResult,
  integrationTarget: fixture.integrationTarget,
  plannedAttempt: fixture.plannedAttempt,
  responsibilityBeganAt: session.queuedAt,
  version: workflowJournalEventVersion
})

const indexes = (): IntegrationHistoryIndexes => ({
  acceptedExecutorResults: HashMap.empty(),
  acceptedExecutorResultPositions: HashMap.empty(),
  executorResponsibilitiesBegan: HashMap.empty(),
  integrationResponsibilitiesBegan: HashMap.empty(),
  integrationStarted: HashMap.make([session.startedAt, integrationStarted]),
  targetLineageReadIntents: HashMap.make([
    lineageOperationId,
    { operation: lineageOperation, position: JournalPosition.make(1) }
  ]),
  targetLineageObservations: HashMap.make([session.targetLineageObservedAt, lineageObservation]),
  integratorSessionFixed: HashMap.empty(),
  integratorSessionsByStartedAt: HashMap.empty(),
  integratorSessionsBySessionId: HashMap.empty(),
  integratorSessionsByCandidateResource: HashMap.empty(),
  integratorSuccessorSessionFixed: HashMap.empty(),
  integratorSuccessorSessionsByPredecessor: HashMap.empty(),
  integratorRunStarted: HashMap.empty(),
  integratorRunResults: HashMap.empty(),
  integratorRunCandidateGitReadIntents: HashMap.empty(),
  integratorRunCandidateGitObservations: HashMap.empty(),
  firstRestartChoiceAppliedAt: HashMap.empty(),
  targetPromotionHistory: makeTargetPromotionHistoryIndexes()
})

const record = (
  position: number,
  event: JournalRecord["event"],
  key: JournalRecord["key"] = JournalRecordKey.make(`integrator-history:${position}`)
): JournalRecord => ({ event, key, position: JournalPosition.make(position), runId })

const validate = (historyIndexes: IntegrationHistoryIndexes, records: ReadonlyArray<JournalRecord>) => {
  const identityIssues: Array<string> = []
  const semanticIssues: Array<string> = []
  let indexes = historyIndexes
  for (const [index, item] of records.entries()) {
    indexes = validateIntegrationHistoryRecord(
      item,
      runId,
      indexes,
      (detail) => identityIssues.push(detail),
      (detail) => semanticIssues.push(detail),
      records.slice(0, index + 1)
    )
  }
  return { identityIssues, semanticIssues }
}

const runResult = IntegratorRunResultRecordedEvent.make({
  result: IntegratorResult.cases.PreparedCandidate.make({ candidateText, correlation: session }),
  run,
  version: workflowJournalEventVersion
})
const runStart = IntegratorRunStartedEvent.make({ run, version: workflowJournalEventVersion })
const gitIntent = IntegratorRunCandidateGitReadIntendedEvent.make({
  candidateText,
  run,
  version: workflowJournalEventVersion
})
const gitObservation = IntegratorRunCandidateGitObservedEvent.make({
  candidateText,
  run,
  observation: IntegratorGitObservation.cases.Commit.make({
    candidateText,
    commit: fixture.qualifiedCandidate.candidateCommit,
    directParents: fixture.qualifiedCandidate.directParents
  }),
  version: workflowJournalEventVersion
})

const fixedSessionRecord = (position = 10): JournalRecord =>
  record(position, IntegratorSessionFixedEvent.make({ correlation: session, version: workflowJournalEventVersion }))

const exactRunPrefix = (): ReadonlyArray<JournalRecord> => [
  fixedSessionRecord(),
  record(11, runStart, integratorRunStartedRecordKey(run)),
  record(12, runResult, integratorRunResultRecordedRecordKey(run))
]

describe("retained integration history", () => {
  it("accepts an exact Integrator session, run, and every durable Git observation", () => {
    const observations = [
      IntegratorGitObservation.cases.Missing.make({ candidateText }),
      IntegratorGitObservation.cases.NonCommit.make({ candidateText, objectType: "tree" }),
      IntegratorGitObservation.cases.Commit.make({
        candidateText,
        commit: fixture.qualifiedCandidate.candidateCommit,
        directParents: fixture.qualifiedCandidate.directParents
      })
    ] as const

    for (const observation of observations) {
      const currentObservation = IntegratorRunCandidateGitObservedEvent.make({
        candidateText,
        observation,
        run,
        version: workflowJournalEventVersion
      })
      const result = validate(indexes(), [
        ...exactRunPrefix(),
        record(13, gitIntent, integratorRunCandidateGitReadIntendedRecordKey(run, candidateText)),
        record(14, currentObservation, integratorRunCandidateGitObservedRecordKey(run, candidateText))
      ])
      expect(result).toEqual({ identityIssues: [], semanticIssues: [] })
    }
  })

  it("rejects duplicate sessions and sessions without exact prerequisites", () => {
    const duplicate = validate(indexes(), [fixedSessionRecord(), fixedSessionRecord(11)])
    expect(duplicate.semanticIssues).toEqual([
      expect.stringContaining("reuses a responsibility, session, or candidate resource")
    ])

    const withoutStartIndexes = { ...indexes(), integrationStarted: HashMap.empty() }
    const withoutStart = validate(withoutStartIndexes, [fixedSessionRecord()])
    expect(withoutStart.semanticIssues).toEqual([expect.stringContaining("no exact earlier IntegrationStarted")])

    const withoutLineageIndexes = { ...indexes(), targetLineageObservations: HashMap.empty() }
    const withoutLineage = validate(withoutLineageIndexes, [fixedSessionRecord()])
    expect(withoutLineage.semanticIssues).toEqual([expect.stringContaining("no exact earlier TargetLineageObserved")])

    const withoutLineageIntentIndexes = { ...indexes(), targetLineageReadIntents: HashMap.empty() }
    const withoutLineageIntent = validate(withoutLineageIntentIndexes, [fixedSessionRecord()])
    expect(withoutLineageIntent.semanticIssues).toEqual([
      expect.stringContaining("no exact earlier TargetLineageObserved")
    ])
  })

  it("rejects duplicate exact-run starts, results, Git intents, and observations", () => {
    const repeatedStart = validate(indexes(), [
      ...exactRunPrefix().slice(0, 1),
      record(11, runStart, integratorRunStartedRecordKey(run)),
      record(12, runStart, integratorRunStartedRecordKey(run))
    ])
    expect(repeatedStart.semanticIssues).toEqual([expect.stringContaining("repeats exact session ordinal")])

    const repeated = validate(indexes(), [
      ...exactRunPrefix(),
      record(13, runResult, integratorRunResultRecordedRecordKey(run))
    ])
    expect(repeated.semanticIssues).toEqual([expect.stringContaining("repeats exact session ordinal")])

    const repeatedIntent = validate(indexes(), [
      ...exactRunPrefix(),
      record(13, gitIntent, integratorRunCandidateGitReadIntendedRecordKey(run, candidateText)),
      record(14, gitIntent, integratorRunCandidateGitReadIntendedRecordKey(run, candidateText))
    ])
    expect(repeatedIntent.semanticIssues).toEqual([expect.stringContaining("repeats candidate text")])

    const repeatedObservation = validate(indexes(), [
      ...exactRunPrefix(),
      record(13, gitIntent, integratorRunCandidateGitReadIntendedRecordKey(run, candidateText)),
      record(14, gitObservation, integratorRunCandidateGitObservedRecordKey(run, candidateText)),
      record(15, gitObservation, integratorRunCandidateGitObservedRecordKey(run, candidateText))
    ])
    expect(repeatedObservation.semanticIssues).toEqual([expect.stringContaining("repeats candidate text")])
  })

  it("rejects a FullRerun successor that reuses an existing session identity", () => {
    const quarantineAt = JournalPosition.make(11)
    const directionAppliedAt = JournalPosition.make(12)
    const successorLineageAt = JournalPosition.make(15)
    const collisionSession = IntegratorSessionCorrelation.make({
      ...session,
      candidateResource: IntegratorCandidateResourceLocator.make("integrator-history-collision-resource"),
      sessionId: IntegratorSessionId.make("integrator-history-collision-session"),
      targetLineageObservedAt: successorLineageAt
    })
    const successorEvent = IntegratorSuccessorSessionFixedEvent.make({
      direction: "FullRerun",
      directionAppliedAt,
      predecessor: session,
      quarantineAt,
      successor: collisionSession,
      successorGeneration: firstFullRerunSuccessorGeneration,
      version: workflowJournalEventVersion
    })
    const successorIndexes = indexes()
    const predecessorPosition = JournalPosition.make(10)
    const collisionPosition = JournalPosition.make(20)
    const withPredecessor = {
      ...successorIndexes,
      integratorSessionFixed: HashMap.make([
        predecessorPosition,
        IntegratorSessionFixedEvent.make({ correlation: session, version: workflowJournalEventVersion })
      ]),
      integratorSessionsBySessionId: HashMap.make(
        [session.sessionId, predecessorPosition],
        [collisionSession.sessionId, collisionPosition]
      )
    }

    const result = validate(withPredecessor, [
      record(30, successorEvent, integratorSuccessorSessionFixedRecordKey(session, quarantineAt, directionAppliedAt))
    ])
    expect(result.semanticIssues).toEqual([expect.stringContaining("reuses a session or resource at 20")])
  })

  it("rejects exact-run records with foreign keys or incomplete chronology", () => {
    const foreignKey = JournalRecordKey.make("integrator-history-foreign-key")
    const wrongStartKey = validate(indexes(), [fixedSessionRecord(), record(11, runStart, foreignKey)])
    expect(wrongStartKey.semanticIssues).toEqual([expect.stringContaining("run start has a foreign key")])

    const wrongResultKey = validate(indexes(), [...exactRunPrefix().slice(0, 2), record(12, runResult, foreignKey)])
    expect(wrongResultKey.semanticIssues).toEqual([expect.stringContaining("run result has a foreign key")])

    const wrongIntentKey = validate(indexes(), [...exactRunPrefix(), record(13, gitIntent, foreignKey)])
    expect(wrongIntentKey.semanticIssues).toEqual([expect.stringContaining("Git-read intent has a foreign key")])

    const wrongObservationKey = validate(indexes(), [
      ...exactRunPrefix(),
      record(13, gitIntent, integratorRunCandidateGitReadIntendedRecordKey(run, candidateText)),
      record(14, gitObservation, foreignKey)
    ])
    expect(wrongObservationKey.semanticIssues).toEqual([expect.stringContaining("Git observation has a foreign key")])

    const resultBeforeStart = validate(indexes(), [
      fixedSessionRecord(),
      record(11, runResult, integratorRunResultRecordedRecordKey(run))
    ])
    expect(resultBeforeStart.semanticIssues).toEqual([
      expect.stringContaining("no exact earlier run start and matching session")
    ])

    const intentBeforeResult = validate(indexes(), [
      ...exactRunPrefix().slice(0, 2),
      record(12, gitIntent, integratorRunCandidateGitReadIntendedRecordKey(run, candidateText))
    ])
    expect(intentBeforeResult.semanticIssues).toEqual([
      expect.stringContaining("no exact earlier PreparedCandidate result")
    ])

    const observationBeforeIntent = validate(indexes(), [
      ...exactRunPrefix(),
      record(14, gitObservation, integratorRunCandidateGitObservedRecordKey(run, candidateText))
    ])
    expect(observationBeforeIntent.semanticIssues).toEqual([
      expect.stringContaining("no exact earlier intent, result, and candidate text")
    ])

    const mismatchedObservation = IntegratorRunCandidateGitObservedEvent.make({
      candidateText,
      observation: IntegratorGitObservation.cases.Missing.make({
        candidateText: IntegratorCandidateText.make("refs/heads/foreign-candidate")
      }),
      run,
      version: workflowJournalEventVersion
    })
    const wrongCandidate = validate(indexes(), [
      ...exactRunPrefix(),
      record(13, gitIntent, integratorRunCandidateGitReadIntendedRecordKey(run, candidateText)),
      record(14, mismatchedObservation, integratorRunCandidateGitObservedRecordKey(run, candidateText))
    ])
    expect(wrongCandidate.semanticIssues).toEqual([
      expect.stringContaining("no exact earlier intent, result, and candidate text")
    ])
  })

  it("reports foreign run bindings for retained exact Integrator events", () => {
    const foreignRun = RunId.make("integrator-history-foreign-run")
    const foreignSession = IntegratorSessionCorrelation.make({
      ...session,
      plannedAttempt: { ...session.plannedAttempt, runId: foreignRun }
    })
    const foreignCorrelationRun = { ...run, session: foreignSession }
    const events = [
      IntegratorSessionFixedEvent.make({ correlation: foreignSession, version: workflowJournalEventVersion }),
      IntegratorRunStartedEvent.make({ run: foreignCorrelationRun, version: workflowJournalEventVersion }),
      IntegratorRunResultRecordedEvent.make({
        result: IntegratorResult.cases.PreparedCandidate.make({ candidateText, correlation: foreignSession }),
        run: foreignCorrelationRun,
        version: workflowJournalEventVersion
      }),
      IntegratorRunCandidateGitReadIntendedEvent.make({
        candidateText,
        run: foreignCorrelationRun,
        version: workflowJournalEventVersion
      }),
      IntegratorRunCandidateGitObservedEvent.make({
        candidateText,
        observation: IntegratorGitObservation.cases.Missing.make({ candidateText }),
        run: foreignCorrelationRun,
        version: workflowJournalEventVersion
      })
    ] as const

    expect(events.map((event) => invalidIntegrationRunBinding(event, runId))).toEqual([
      `Integrator session binds run ${foreignRun}`,
      `Integrator run start binds run ${foreignRun}`,
      `Integrator run result binds run ${foreignRun}`,
      `Integrator run candidate Git-read intent binds run ${foreignRun}`,
      `Integrator run candidate Git observation binds run ${foreignRun}`
    ])
  })

  it("rejects foreign nested completion claims and explicit reacquisition identities", () => {
    const foreignRun = RunId.make("integrator-history-nested-foreign-run")
    const foreignAttempt = { ...fixture.plannedAttempt, runId: foreignRun }
    const foreignSession = IntegratorSessionCorrelation.make({
      ...fixture.qualifiedCandidate.run.session,
      plannedAttempt: foreignAttempt
    })
    const foreignIntegratorRun = IntegratorRunCorrelation.make({
      ...fixture.qualifiedCandidate.run,
      session: foreignSession
    })
    const foreignCandidate = IntegratorRunQualifiedCandidate.make({
      ...fixture.qualifiedCandidate,
      run: foreignIntegratorRun
    })
    const foreignClaim = CompletionTaskClaim.make({
      ...fixture.claim,
      plannedAttempt: foreignAttempt,
      promotionCorrelation: targetPromotionCorrelationFor(foreignCandidate)
    })
    const focusedPurpose = CompletionTaskFocusedReadPurpose.cases.Authorization.make({
      attemptOrdinal: CompletionTaskRequestOrdinal.make(1),
      authorizationOrdinal: CompletionTaskAuthorizationReadOrdinal.make(1)
    })
    const foreignCompletionOperation = makeCompletionTaskFactsObservationOperation(
      completionTaskRequestFor(foreignClaim),
      fixture.target,
      focusedPurpose
    )
    const foreignFocusedObservation = makeFocusedTaskCompletionFactsObserved(
      foreignCompletionOperation,
      FocusedTaskCompletionFacts.make({
        ...fixture.focusedSuccessFactsEvent.observation.facts,
        currentClaim: foreignClaim,
        lifecycle: "Open",
        operationId: foreignCompletionOperation.operationId
      })
    )
    const foreignFocusedFactsEvent = taskTrackerFactsObservedEvent(
      foreignCompletionOperation.operationId,
      foreignFocusedObservation
    )

    const validAcquisitionOperation = WorkflowOperation.cases.AcquireTaskClaim.make({
      acquisition: fixture.activeClaim,
      authority: {
        _tag: "ExplicitTaskClaimReacquisitionAuthority",
        requestId: TaskClaimReacquisitionRequestId.make("integrator-history-nested-reacquisition")
      },
      predecessorOperationIds: []
    })
    const validAcquisitionIntent = TaskClaimAcquisitionIntendedEvent.make({
      operation: validAcquisitionOperation,
      version: workflowJournalEventVersion
    })
    const foreignAuthorityRequestId = { nonce: "integrator-history-nested-reacquisition", runId: foreignRun }
    const foreignAcquisitionIntent = Object.assign({}, validAcquisitionIntent, {
      operation: {
        ...validAcquisitionIntent.operation,
        authority: { _tag: "ExplicitTaskClaimReacquisitionAuthority", requestId: foreignAuthorityRequestId }
      }
    })

    const deletionReadPurpose = CompletionClaimDeletionReadPurpose.cases.BeforeDeletionAttempt.make({
      attemptOrdinal: CompletionClaimRequestOrdinal.make(1),
      readOrdinal: CompletionClaimCleanupReadOrdinal.make(1)
    })
    const deletionRequest = completionClaimDeletionRequestFor(fixture.claim, fixture.successObservation)
    const validDeletionRead = CompletionClaimDeletionReadObservedEvent.make({
      observation: fixture.claim,
      purpose: deletionReadPurpose,
      replacementOperationId: OperationId.make("integrator-history-nested-replacement"),
      request: deletionRequest,
      version: workflowJournalEventVersion
    })
    const foreignDeletionRead = CompletionClaimDeletionReadObservedEvent.make({
      ...validDeletionRead,
      observation: foreignClaim
    })

    const cases = [
      {
        foreign: foreignAcquisitionIntent,
        foreignDetail: `task-claim reacquisition authority binds run ${foreignRun}`,
        valid: validAcquisitionIntent,
        validRunId: runId
      },
      {
        foreign: foreignFocusedFactsEvent,
        foreignDetail: `focused task-completion observation binds run ${foreignRun}`,
        valid: fixture.focusedSuccessFactsEvent,
        validRunId: runId
      },
      {
        foreign: foreignDeletionRead,
        foreignDetail: `completion claim deletion read binds run ${foreignRun}`,
        valid: validDeletionRead,
        validRunId: runId
      }
    ] as const

    for (const { foreign, foreignDetail, valid, validRunId } of cases) {
      const foreignRecord: JournalRecord = {
        event: foreign,
        key: describeJournalEvent(foreign).expectedKey,
        position: JournalPosition.make(20),
        runId: foreignRun
      }
      const validRecord: JournalRecord = {
        event: valid,
        key: describeJournalEvent(valid).expectedKey,
        position: JournalPosition.make(21),
        runId: validRunId
      }
      expect(foreignRecord.key).toBe(describeJournalEvent(foreign).expectedKey)
      expect(validRecord.key).toBe(describeJournalEvent(valid).expectedKey)
      expect(invalidIntegrationRunBinding(foreign, runId)).toBe(foreignDetail)
      expect(invalidIntegrationRunBinding(valid, validRunId)).toBeUndefined()
    }
  })

  it("accepts current-run boundaries and rejects their foreign run bindings", () => {
    const foreignRun = RunId.make("integrator-history-boundary-foreign-run")
    const foreignSession = IntegratorSessionCorrelation.make({
      ...session,
      plannedAttempt: { ...session.plannedAttempt, runId: foreignRun }
    })
    const foreignCorrelationRun = { ...run, session: foreignSession }
    const successorLineageAt = JournalPosition.make(15)
    const successorSession = IntegratorSessionCorrelation.make({
      ...session,
      candidateResource: IntegratorCandidateResourceLocator.make("integrator-history-boundary-successor-resource"),
      sessionId: IntegratorSessionId.make("integrator-history-boundary-successor-session"),
      targetLineageObservedAt: successorLineageAt
    })
    const foreignSuccessorSession = IntegratorSessionCorrelation.make({
      ...foreignSession,
      candidateResource: IntegratorCandidateResourceLocator.make(
        "integrator-history-boundary-foreign-successor-resource"
      ),
      sessionId: IntegratorSessionId.make("integrator-history-boundary-foreign-successor-session"),
      targetLineageObservedAt: successorLineageAt
    })
    const makeSuccessor = (predecessor: IntegratorSessionCorrelation, successor: IntegratorSessionCorrelation) =>
      IntegratorSuccessorSessionFixedEvent.make({
        direction: "FullRerun",
        directionAppliedAt: JournalPosition.make(12),
        predecessor,
        quarantineAt: JournalPosition.make(11),
        successor,
        successorGeneration: firstFullRerunSuccessorGeneration,
        version: workflowJournalEventVersion
      })
    const validSuccessor = makeSuccessor(session, successorSession)
    const foreignSuccessor = makeSuccessor(foreignSession, foreignSuccessorSession)
    const directionFingerprint = IntegrationQuarantineDirectionFingerprint.make({
      direction: "FullRerun",
      quarantineAt: JournalPosition.make(11),
      sessionId: session.sessionId
    })
    const validDirection = IntegrationQuarantineDirectionAppliedEvent.make({
      fingerprint: directionFingerprint,
      initiatedBy: WorkflowActor.cases.Operator.make({}),
      occurrenceClassification: "InitiatedAction",
      requestId: IntegrationQuarantineDirectionRequestId.make({ nonce: "integrator-history-boundary", runId }),
      version: workflowJournalEventVersion
    })
    const foreignDirection = IntegrationQuarantineDirectionAppliedEvent.make({
      ...validDirection,
      requestId: IntegrationQuarantineDirectionRequestId.make({
        nonce: "integrator-history-boundary-foreign",
        runId: foreignRun
      })
    })
    const absenceDetail = IntegrationQuarantineFailureDetail.make("integrator-history boundary absence")
    const validAbsence = IntegrationProviderRunActivityAbsentEvent.make({
      correlation: session,
      detail: absenceDetail,
      occurrenceClassification: "NonActionOccurrence",
      run,
      version: workflowJournalEventVersion
    })
    const foreignAbsence = IntegrationProviderRunActivityAbsentEvent.make({
      correlation: foreignSession,
      detail: absenceDetail,
      occurrenceClassification: "NonActionOccurrence",
      run: foreignCorrelationRun,
      version: workflowJournalEventVersion
    })
    const validResponsibility = IntegrationResponsibilityBeganEvent.make({
      acceptedResult: session.acceptedResult,
      integrationTarget: session.integrationTarget,
      plannedAttempt: session.plannedAttempt,
      version: workflowJournalEventVersion
    })
    const foreignResponsibility = IntegrationResponsibilityBeganEvent.make({
      ...validResponsibility,
      plannedAttempt: foreignSession.plannedAttempt
    })
    const foreignStarted = IntegrationStartedEvent.make({
      ...integrationStarted,
      plannedAttempt: foreignSession.plannedAttempt
    })
    const foreignQualifiedCandidate = IntegratorRunQualifiedCandidate.make({
      ...fixture.qualifiedCandidate,
      run: foreignCorrelationRun
    })
    const validPromotion = TargetPromotionIntendedEvent.make({
      correlation: fixture.promotionCorrelation,
      version: workflowJournalEventVersion
    })
    const foreignPromotion = TargetPromotionIntendedEvent.make({
      correlation: targetPromotionCorrelationFor(foreignQualifiedCandidate),
      version: workflowJournalEventVersion
    })

    expect([
      invalidIntegrationRunBinding(validPromotion, runId),
      invalidIntegrationRunBinding(foreignPromotion, runId),
      invalidIntegrationRunBinding(validSuccessor, runId),
      invalidIntegrationRunBinding(foreignSuccessor, runId),
      invalidIntegrationRunBinding(validDirection, runId),
      invalidIntegrationRunBinding(foreignDirection, runId),
      invalidIntegrationRunBinding(validAbsence, runId),
      invalidIntegrationRunBinding(foreignAbsence, runId),
      invalidIntegrationRunBinding(validResponsibility, runId),
      invalidIntegrationRunBinding(foreignResponsibility, runId),
      invalidIntegrationRunBinding(integrationStarted, runId),
      invalidIntegrationRunBinding(foreignStarted, runId)
    ]).toEqual([
      undefined,
      `target promotion binds run ${foreignRun}`,
      undefined,
      "Integrator successor session binds a foreign run",
      undefined,
      `integration quarantine direction binds run ${foreignRun}`,
      undefined,
      `Integrator provider-activity absence binds run ${foreignRun}`,
      undefined,
      `integration work for attempt ${foreignSession.plannedAttempt.attemptId} binds run ${foreignRun}`,
      undefined,
      `integration work for attempt ${foreignSession.plannedAttempt.attemptId} binds run ${foreignRun}`
    ])
    expect(validate(indexes(), [record(30, foreignResponsibility)]).identityIssues).toEqual([
      `integration work for attempt ${foreignSession.plannedAttempt.attemptId} binds run ${foreignRun}`
    ])
  })

  it("retains target lineage facts as the Integrator session prerequisite", () => {
    expect(lineageIntent.operation.operationId).toBe(lineageOperationId)
    expect(lineageObservation.observation.targetHeadSha).toBe(session.expectedTargetHead)
    expect(integrationStarted.integrationTarget).toEqual(
      IntegrationTarget.make({ ref: fixture.integrationTarget.ref, repository: fixture.integrationTarget.repository })
    )
    expect(GitCommitSha.make("1".repeat(40))).toBe(fixture.plannedAttempt.baseSha)
  })
})
