import { describe, expect, it } from "vitest"
import { GitCommitSha, IntegrationTarget, RunId } from "@dalph/contracts"
import { integrationFinalityFixture } from "../../workflow/protocols/integration-finality/fixtures.js"
import {
  IntegratorCandidateGitObservedEvent,
  IntegratorCandidateGitReadIntendedEvent,
  IntegratorCandidateText,
  IntegratorCorrelation,
  IntegratorGitObservation,
  IntegratorResult,
  IntegratorResultRecordedEvent,
  IntegratorSessionFixedEvent
} from "../../workflow/protocols/integrator/events.js"
import { IntegrationStartedEvent } from "../../workflow/protocols/integration-admission/events.js"
import { TargetLineageObservation } from "../../authorities/git/target-lineage.js"
import { OperationId } from "../../workflow/identity.js"
import { WorkflowActor } from "../../workflow/registry/actor.js"
import { GitReadIntentRecordedEvent, TargetLineageObservedEvent } from "../../workflow/registry/event.js"
import { WorkflowOperation } from "../../workflow/registry/operation.js"
import { workflowJournalEventVersion } from "../../workflow/kernel/event.js"
import { JournalPosition, JournalRecordKey } from "../../workflow-journal/identity.js"
import type { JournalRecord } from "../../workflow-journal/store.js"
import type { IntegrationHistoryIndexes } from "./integration-history.js"
import { validateIntegrationHistoryRecord } from "./integration-history-validation.js"
import { makeTargetPromotionHistoryIndexes } from "./target-promotion-history.js"
import { invalidIntegrationRunBinding } from "./integration-history-run-binding.js"

const fixture = integrationFinalityFixture
const runId = fixture.runId
const session = fixture.qualifiedCandidate.run.session
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
  acceptedExecutorResults: new Map(),
  acceptedExecutorResultPositions: new Map(),
  executorResponsibilitiesBegan: new Map(),
  integrationResponsibilitiesBegan: new Map(),
  integrationStarted: new Map([[session.startedAt, integrationStarted]]),
  targetLineageReadIntents: new Map([
    [lineageOperationId, { operation: lineageOperation, position: JournalPosition.make(1) }]
  ]),
  targetLineageObservations: new Map([[session.targetLineageObservedAt, lineageObservation]]),
  integratorSessionFixed: new Map(),
  integratorSessionsByStartedAt: new Map(),
  integratorSessionsBySessionId: new Map(),
  integratorSessionsByCandidateResource: new Map(),
  integratorSuccessorSessionFixed: new Map(),
  integratorSuccessorSessionsByPredecessor: new Map(),
  integratorResultsByStartedAt: new Map(),
  integratorCandidateGitReadIntents: new Map(),
  integratorCandidateGitObservations: new Map(),
  integratorRunStarted: new Map(),
  integratorRunResults: new Map(),
  integratorRunCandidateGitReadIntents: new Map(),
  integratorRunCandidateGitObservations: new Map(),
  firstRestartChoiceAppliedAt: new Map(),
  targetPromotionHistory: makeTargetPromotionHistoryIndexes()
})

const record = (position: number, event: JournalRecord["event"]): JournalRecord => ({
  event,
  key: JournalRecordKey.make(`integrator-history:${position}`),
  position: JournalPosition.make(position),
  runId
})

const validate = (historyIndexes: IntegrationHistoryIndexes, records: ReadonlyArray<JournalRecord>) => {
  const identityIssues: Array<string> = []
  const semanticIssues: Array<string> = []
  for (const [index, item] of records.entries()) {
    validateIntegrationHistoryRecord(
      item,
      runId,
      historyIndexes,
      (detail) => identityIssues.push(detail),
      (detail) => semanticIssues.push(detail),
      records.slice(0, index + 1)
    )
  }
  return { identityIssues, semanticIssues }
}

describe("retained integration history", () => {
  it("accepts an exact Integrator session, result, and Git qualification prefix", () => {
    const integratorResult = IntegratorResultRecordedEvent.make({
      result: IntegratorResult.cases.PreparedCandidate.make({ candidateText, correlation: session }),
      version: workflowJournalEventVersion
    })
    const gitIntent = IntegratorCandidateGitReadIntendedEvent.make({
      candidateText,
      correlation: session,
      version: workflowJournalEventVersion
    })
    const gitObservation = IntegratorCandidateGitObservedEvent.make({
      candidateText,
      correlation: session,
      observation: IntegratorGitObservation.cases.Commit.make({
        candidateText,
        commit: fixture.qualifiedCandidate.candidateCommit,
        directParents: fixture.qualifiedCandidate.directParents
      }),
      version: workflowJournalEventVersion
    })
    const result = validate(indexes(), [
      record(10, IntegratorSessionFixedEvent.make({ correlation: session, version: workflowJournalEventVersion })),
      record(11, integratorResult),
      record(12, gitIntent),
      record(13, gitObservation)
    ])

    expect(result).toEqual({ identityIssues: [], semanticIssues: [] })
  })

  it("rejects a repeated Integrator result and a Git observation without its intent", () => {
    const integratorResult = IntegratorResultRecordedEvent.make({
      result: IntegratorResult.cases.PreparedCandidate.make({ candidateText, correlation: session }),
      version: workflowJournalEventVersion
    })
    const gitObservation = IntegratorCandidateGitObservedEvent.make({
      candidateText,
      correlation: session,
      observation: IntegratorGitObservation.cases.Missing.make({ candidateText }),
      version: workflowJournalEventVersion
    })
    const result = validate(indexes(), [
      record(10, IntegratorSessionFixedEvent.make({ correlation: session, version: workflowJournalEventVersion })),
      record(11, integratorResult),
      record(12, integratorResult),
      record(13, gitObservation)
    ])

    expect(result.semanticIssues).toEqual([
      expect.stringContaining("Integrator result repeats the exact session"),
      expect.stringContaining("Integrator candidate Git observation has no exact earlier intent")
    ])
  })

  it("reports a foreign run binding for retained Integrator history", () => {
    const foreignRun = RunId.make("integrator-history-foreign-run")
    const foreignSession = IntegratorCorrelation.make({
      ...session,
      plannedAttempt: { ...session.plannedAttempt, runId: foreignRun }
    })
    const event = IntegratorResultRecordedEvent.make({
      result: IntegratorResult.cases.PreparedCandidate.make({ candidateText, correlation: foreignSession }),
      version: workflowJournalEventVersion
    })

    expect(invalidIntegrationRunBinding(event, runId)).toBe(`Integrator result binds run ${foreignRun}`)
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
