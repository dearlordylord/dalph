import { PlannedTaskAttempt } from "@dalph/contracts"
import { Effect } from "effect"
import { PlannedWorktreeReady } from "../../../authorities/git/worktree.js"
import { ActiveTaskClaim } from "../../../authorities/task-tracker/claim-mutation.js"
import { ClaimOwner, ClaimToken } from "../../../authorities/task-tracker/claim.js"
import { JournalStore } from "../../../workflow-journal/store.js"
import { JournalPosition } from "../../../workflow-journal/identity.js"
import {
  integrationProviderRunActivityAbsentRecordKey,
  attemptChoiceAppliedRecordKey,
  integrationResponsibilityBeganRecordKey,
  integrationStartedRecordKey,
  integrationQuarantineDirectionAppliedRecordKey,
  integrationQuarantinedRecordKey,
  integratorRunStartedRecordKey,
  integratorSessionFixedRecordKey,
  integratorSuccessorSessionFixedRecordKey,
  intentRecordKey,
  outcomeRecordKey,
  plannedAttemptReplacedRecordKey
} from "../../../workflow-journal/record-key.js"
import {
  GitReadIntentRecordedEvent,
  PlannedAttemptWorktreeObservedEvent,
  TargetLineageObservedEvent
} from "../../registry/event.js"
import { IntegrationResponsibilityBeganEvent, IntegrationStartedEvent } from "../integration-admission/events.js"
import {
  IntegrationProviderRunActivityAbsentEvent,
  IntegrationQuarantineBasis,
  IntegrationQuarantineDirectionAppliedEvent,
  IntegrationQuarantineDirectionFingerprint,
  IntegrationQuarantineDirectionRequestId,
  IntegrationQuarantineFailureDetail,
  IntegrationQuarantinedEvent,
  integrationQuarantineDirectionSubject
} from "../integration-quarantine/events.js"
import {
  IntegratorRunCorrelation,
  IntegratorRunOrdinal,
  IntegratorSuccessorSessionFixedEvent
} from "../integrator/events.js"
import type { IntegratorSessionCorrelation } from "../integrator/events.js"
import { integratorResponsibilityFactsFromCorrelation } from "../integrator/state.js"
import { OperationId } from "../../identity.js"
import { workflowJournalEventVersion } from "../../kernel/event.js"
import { WorkflowOperation } from "../../registry/operation.js"
import { AttemptChoiceAppliedEvent, AttemptChoiceRequestId, AttemptChoiceSubject } from "../attempt-choice/events.js"
import { PlannedAttemptReplacedEvent, PlannedAttemptReplacementWitness } from "../attempt-choice/replacement-events.js"
import { PlannedAttemptExecutorReportOrdinal } from "../planned-attempt-executor-work/events.js"

const quarantinePositionOffset = 5
const activityAbsencePositionOffset = 4

/** Stable operation identities carried by the replacement event's complete authority chain. */
export const replacementPredecessorsFor = (
  attempt: PlannedTaskAttempt
): readonly [OperationId, OperationId, OperationId, OperationId, OperationId, OperationId] => {
  const prefix = `cleanup-provenance:${attempt.attemptId}`
  return [
    OperationId.make(`${prefix}:claim`),
    OperationId.make(`${prefix}:graph`),
    OperationId.make(`${prefix}:specification`),
    OperationId.make(`${prefix}:claim-observation`),
    OperationId.make(`${prefix}:worktree-observation`),
    OperationId.make(`${prefix}:target-lineage`)
  ]
}

/** The exact old-worktree authority read carried by the replacement witness. */
export const replacementWorktreeObservationOperationIdFor = (attempt: PlannedTaskAttempt): OperationId =>
  OperationId.make(`cleanup-provenance:${attempt.attemptId}:worktree-observation`)

/** Builds the same typed P1 -> P2 terminal evidence used by cleanup tests and cassettes. */
export const replacementProvenanceFor = (
  plannedAttempt: PlannedTaskAttempt,
  successorAttempt: PlannedTaskAttempt
): PlannedAttemptReplacedEvent => {
  const prefix = `cleanup-provenance:${plannedAttempt.attemptId}`
  const claimOperationId = OperationId.make(`${prefix}:claim`)
  const graphOperationId = OperationId.make(`${prefix}:graph`)
  const specificationOperationId = OperationId.make(`${prefix}:specification`)
  const claimObservationOperationId = OperationId.make(`${prefix}:claim-observation`)
  const worktreeObservationOperationId = OperationId.make(`${prefix}:worktree-observation`)
  const targetLineageOperationId = OperationId.make(`${prefix}:target-lineage`)
  const requestId = AttemptChoiceRequestId.make({
    nonce: `cleanup-provenance:${plannedAttempt.attemptId}`,
    runId: plannedAttempt.runId
  })
  const subject = AttemptChoiceSubject.make({ observedTaskRevision: successorAttempt.taskRevision, plannedAttempt })
  const expectedClaim = ActiveTaskClaim.make({
    operationId: claimOperationId,
    owner: ClaimOwner.make("cleanup-provenance"),
    taskId: plannedAttempt.taskId,
    token: ClaimToken.make(`cleanup-provenance:${plannedAttempt.attemptId}`)
  })
  const witness = PlannedAttemptReplacementWitness.make({
    claimObservationOperationId,
    expectedClaim,
    graphObservationOperationId: graphOperationId,
    oldWorktreeObservationOperationId: worktreeObservationOperationId,
    oldWorktreeProof: PlannedWorktreeReady.make({
      baseSha: plannedAttempt.baseSha,
      branch: plannedAttempt.branch,
      headSha: plannedAttempt.baseSha,
      worktree: plannedAttempt.worktree
    }),
    quiescenceProof: { _tag: "CommandResponse", reportOrdinal: PlannedAttemptExecutorReportOrdinal.make(1) },
    specificationObservationOperationId: specificationOperationId,
    targetHeadSha: successorAttempt.baseSha,
    targetLineageObservationOperationId: targetLineageOperationId
  })
  const successorPlan = WorkflowOperation.cases.RecordTaskAttemptPlan.make({
    operationId: OperationId.make(`cleanup-provenance:${plannedAttempt.attemptId}:successor-plan`),
    plannedAttempt: successorAttempt,
    predecessorOperationIds: replacementPredecessorsFor(plannedAttempt)
  })
  return PlannedAttemptReplacedEvent.make({
    initiatedBy: { _tag: "DalphCoordinator" },
    occurrenceClassification: "InitiatedAction",
    requestId,
    subject,
    successorPlan,
    version: workflowJournalEventVersion,
    witness
  })
}

/** Appends typed upstream replacement evidence to a test journal before cleanup starts. */
export const appendReplacementProvenance = Effect.fn("DispositionCleanupTest.appendReplacementProvenance")(function* (
  plannedAttempt: PlannedTaskAttempt,
  successorAttempt: PlannedTaskAttempt
) {
  const journal = yield* JournalStore
  const event = replacementProvenanceFor(plannedAttempt, successorAttempt)
  const worktreeObservationOperationId = replacementWorktreeObservationOperationIdFor(plannedAttempt)
  const worktreeObservationOperation = WorkflowOperation.cases.ReadTaskWorktree.make({
    operationId: worktreeObservationOperationId,
    plannedAttempt,
    predecessorOperationIds: []
  })
  yield* journal.append(
    plannedAttempt.runId,
    intentRecordKey(worktreeObservationOperationId),
    GitReadIntentRecordedEvent.make({
      initiatedBy: { _tag: "DalphCoordinator" },
      occurrenceClassification: "InitiatedAction",
      operation: worktreeObservationOperation,
      version: workflowJournalEventVersion
    })
  )
  yield* journal.append(
    plannedAttempt.runId,
    outcomeRecordKey(worktreeObservationOperationId),
    PlannedAttemptWorktreeObservedEvent.make({
      observation: PlannedWorktreeReady.make({
        baseSha: plannedAttempt.baseSha,
        branch: plannedAttempt.branch,
        headSha: plannedAttempt.baseSha,
        worktree: plannedAttempt.worktree
      }),
      occurrenceClassification: "NonActionOccurrence",
      operationId: worktreeObservationOperationId,
      version: workflowJournalEventVersion
    })
  )
  yield* journal.append(
    plannedAttempt.runId,
    attemptChoiceAppliedRecordKey(event.requestId),
    AttemptChoiceAppliedEvent.make({
      choice: "RestartTaskImplementation",
      initiatedBy: { _tag: "Operator" },
      occurrenceClassification: "InitiatedAction",
      requestId: event.requestId,
      subject: event.subject,
      version: workflowJournalEventVersion
    })
  )
  return yield* journal.append(plannedAttempt.runId, plannedAttemptReplacedRecordKey(plannedAttempt.attemptId), event)
})

/**
 * Appends the complete S1/Q/D/S2 evidence needed by candidate cleanup. The
 * positions are deliberately derived from append order so the fixture also
 * exercises the same chronology checks used by recovery.
 */
export const appendCandidateProvenance = Effect.fn("DispositionCleanupTest.appendCandidateProvenance")(function* (
  predecessor: IntegratorSessionCorrelation,
  successor: IntegratorSessionCorrelation,
  directionNonce: string
) {
  const journal = yield* JournalStore
  const runId = predecessor.plannedAttempt.runId
  const predecessorRun = IntegratorRunCorrelation.make({ ordinal: IntegratorRunOrdinal.make(1), session: predecessor })
  const predecessorLineageOperation = WorkflowOperation.cases.ReadTargetLineage.make({
    integrationTarget: predecessor.integrationTarget,
    operationId: OperationId.make(`${predecessor.sessionId}:predecessor-lineage`),
    plannedAttempt: predecessor.plannedAttempt,
    predecessorOperationIds: []
  })
  const successorLineageOperation = WorkflowOperation.cases.ReadTargetLineage.make({
    integrationTarget: successor.integrationTarget,
    operationId: OperationId.make(`${successor.sessionId}:successor-lineage`),
    plannedAttempt: successor.plannedAttempt,
    predecessorOperationIds: []
  })
  const predecessorLineage = TargetLineageObservedEvent.make({
    observation: {
      plannedBaseIsAncestorOfTargetHead: true,
      plannedBaseSha: predecessor.plannedAttempt.baseSha,
      targetHeadSha: predecessor.expectedTargetHead
    },
    occurrenceClassification: "NonActionOccurrence",
    operationId: predecessorLineageOperation.operationId,
    plannedAttempt: predecessor.plannedAttempt,
    version: workflowJournalEventVersion
  })
  const successorLineage = TargetLineageObservedEvent.make({
    observation: {
      plannedBaseIsAncestorOfTargetHead: true,
      plannedBaseSha: successor.plannedAttempt.baseSha,
      targetHeadSha: successor.expectedTargetHead
    },
    occurrenceClassification: "NonActionOccurrence",
    operationId: successorLineageOperation.operationId,
    plannedAttempt: successor.plannedAttempt,
    version: workflowJournalEventVersion
  })
  const responsibilityBegan = IntegrationResponsibilityBeganEvent.make({
    acceptedResult: predecessor.acceptedResult,
    integrationTarget: predecessor.integrationTarget,
    plannedAttempt: predecessor.plannedAttempt,
    version: workflowJournalEventVersion
  })
  const started = IntegrationStartedEvent.make({
    acceptedResult: predecessor.acceptedResult,
    integrationTarget: predecessor.integrationTarget,
    plannedAttempt: predecessor.plannedAttempt,
    responsibilityBeganAt: predecessor.queuedAt,
    version: workflowJournalEventVersion
  })
  const fixed = {
    _tag: "IntegratorSessionFixed" as const,
    correlation: predecessor,
    version: workflowJournalEventVersion
  }
  const runStarted = {
    _tag: "IntegratorRunStarted" as const,
    run: predecessorRun,
    version: workflowJournalEventVersion
  }
  const detail = IntegrationQuarantineFailureDetail.make("candidate cleanup fixture provider activity absent")
  const quarantineAt = JournalPosition.make(Number(predecessor.targetLineageObservedAt) + quarantinePositionOffset)
  const directionAppliedAt = JournalPosition.make(Number(quarantineAt) + 1)
  const absence = IntegrationProviderRunActivityAbsentEvent.make({
    correlation: predecessor,
    detail,
    occurrenceClassification: "NonActionOccurrence",
    run: predecessorRun,
    version: workflowJournalEventVersion
  })
  const quarantine = IntegrationQuarantinedEvent.make({
    basis: IntegrationQuarantineBasis.cases.ProviderRunFailure.make({
      detail,
      ownedActivityProvenAbsentAt: JournalPosition.make(
        Number(predecessor.targetLineageObservedAt) + activityAbsencePositionOffset
      )
    }),
    correlation: predecessor,
    occurrenceClassification: "NonActionOccurrence",
    version: workflowJournalEventVersion
  })
  const direction = IntegrationQuarantineDirectionAppliedEvent.make({
    fingerprint: IntegrationQuarantineDirectionFingerprint.make({
      direction: "FullRerun",
      quarantineAt,
      sessionId: predecessor.sessionId
    }),
    initiatedBy: { _tag: "Operator" },
    occurrenceClassification: "InitiatedAction",
    requestId: IntegrationQuarantineDirectionRequestId.make({ nonce: directionNonce, runId }),
    version: workflowJournalEventVersion
  })
  const successorFixed = IntegratorSuccessorSessionFixedEvent.make({
    direction: "FullRerun",
    directionAppliedAt,
    predecessor,
    quarantineAt: quarantine.basis._tag === "ProviderRunFailure" ? quarantineAt : quarantineAt,
    successor,
    successorGeneration: 2,
    version: workflowJournalEventVersion
  })
  yield* journal.append(
    runId,
    integrationResponsibilityBeganRecordKey(predecessor.plannedAttempt.attemptId),
    responsibilityBegan
  )
  yield* journal.append(
    runId,
    intentRecordKey(predecessorLineageOperation.operationId),
    GitReadIntentRecordedEvent.make({
      initiatedBy: { _tag: "DalphCoordinator" },
      occurrenceClassification: "InitiatedAction",
      operation: predecessorLineageOperation,
      version: workflowJournalEventVersion
    })
  )
  yield* journal.append(runId, outcomeRecordKey(predecessorLineageOperation.operationId), predecessorLineage)
  yield* journal.append(
    runId,
    integratorSessionFixedRecordKey(integratorResponsibilityFactsFromCorrelation(predecessor)),
    fixed
  )
  yield* journal.append(runId, integrationStartedRecordKey(predecessor.plannedAttempt.attemptId), started)
  yield* journal.append(runId, integratorRunStartedRecordKey(predecessorRun), runStarted)
  yield* journal.append(runId, integrationProviderRunActivityAbsentRecordKey(predecessorRun), absence)
  yield* journal.append(runId, integrationQuarantinedRecordKey(predecessor.sessionId, quarantine.basis), quarantine)
  yield* journal.append(
    runId,
    integrationQuarantineDirectionAppliedRecordKey(integrationQuarantineDirectionSubject(direction.fingerprint)),
    direction
  )
  yield* journal.append(
    runId,
    intentRecordKey(successorLineageOperation.operationId),
    GitReadIntentRecordedEvent.make({
      initiatedBy: { _tag: "DalphCoordinator" },
      occurrenceClassification: "InitiatedAction",
      operation: successorLineageOperation,
      version: workflowJournalEventVersion
    })
  )
  yield* journal.append(runId, outcomeRecordKey(successorLineageOperation.operationId), successorLineage)
  yield* journal.append(
    runId,
    integratorSuccessorSessionFixedRecordKey(predecessor, quarantineAt, directionAppliedAt),
    successorFixed
  )
})
