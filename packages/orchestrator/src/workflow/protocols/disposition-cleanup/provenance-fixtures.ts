/* eslint-disable max-lines -- Shared deterministic authority fixtures preserve exact append chronology for cassettes and focused tests. */

import {
  GitRepositoryLocator,
  IntegrationTarget,
  IntegrationTargetRef,
  PlannedAttemptExecutorReport,
  TaskRevision,
  makeTaskWorkSpecification
} from "@dalph/contracts"
import type { PlannedTaskAttempt } from "@dalph/contracts"
import { Effect, Option } from "effect"
import { PlannedWorktreeReady } from "../../../authorities/git/worktree.js"
import { projectTrackerSnapshot } from "../../../authorities/task-tracker/graph.js"
import { TaskLifecycle, TrackerRevision } from "../../../authorities/task-tracker/task.js"
import { ActiveTaskClaim } from "../../../authorities/task-tracker/claim-mutation.js"
import { ClaimOwner, ClaimToken } from "../../../authorities/task-tracker/claim.js"
import { JournalStore } from "../../../workflow-journal/store.js"
import { JournalPosition } from "../../../workflow-journal/identity.js"
import {
  integrationProviderRunActivityAbsentRecordKey,
  attemptPlanRecordKey,
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
  attemptImplementationAbandonedRecordKey,
  plannedAttemptReplacedRecordKey,
  plannedAttemptExecutorWorkResponsibilityBeganRecordKey,
  plannedAttemptExecutorCommandIntendedRecordKey,
  plannedAttemptExecutorWorkReportedRecordKey
} from "../../../workflow-journal/record-key.js"
import {
  GitReadIntentRecordedEvent,
  PlannedAttemptWorktreeObservedEvent,
  TargetLineageObservedEvent,
  TaskClaimAcquiredEvent,
  TaskClaimAcquisitionIntendedEvent,
  TaskAttemptPlannedEvent,
  taskTrackerReadIntent
} from "../../registry/event.js"
import {
  makeCompleteTaskTrackerFactsObserved,
  makeFocusedTaskClaimFactsObserved,
  makeFocusedTaskWorkSpecificationFactsObserved,
  taskTrackerFactsObservedEvent
} from "../../task-tracker-facts/observation.js"
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
  firstFullRerunSuccessorGeneration,
  IntegratorSuccessorSessionFixedEvent
} from "../integrator/events.js"
import type { IntegratorSessionCorrelation } from "../integrator/events.js"
import { integratorResponsibilityFactsFromCorrelation } from "../integrator/state.js"
import { OperationId } from "../../identity.js"
import { workflowJournalEventVersion } from "../../kernel/event.js"
import {
  WorkflowOperation,
  makeTaskClaimAcquisitionOperation,
  makeTaskAttemptPlanOperation,
  makeTaskClaimObservationOperation,
  makeTaskWorkSpecificationObservationOperation,
  makeTrackerGraphObservationOperation
} from "../../registry/operation.js"
import {
  AttemptChoiceAppliedEvent,
  AttemptChoiceRequestId,
  AttemptChoiceSubject,
  AttemptImplementationAbandonedEvent
} from "../attempt-choice/events.js"
import {
  PlannedAttemptCleanupDisposition,
  WorktreeCleanupAuthorization,
  WorktreeCleanupEvidenceRevision,
  WorktreeCleanupOwner
} from "./disposition.js"
import { PlannedAttemptReplacedEvent, PlannedAttemptReplacementWitness } from "../attempt-choice/replacement-events.js"
import {
  PlannedAttemptExecutorCommandIntendedEvent,
  PlannedAttemptExecutorCommandOrdinal,
  PlannedAttemptExecutorReportOrdinal,
  PlannedAttemptExecutorWorkReportedEvent,
  PlannedAttemptExecutorWorkResponsibilityBeganEvent
} from "../planned-attempt-executor-work/events.js"

import { replacementFixtureIdsFor } from "./provenance-identities.js"

export {
  replacementFixtureIdsFor,
  replacementPredecessorsFor,
  replacementWorktreeObservationOperationIdFor
} from "./provenance-identities.js"

const quarantinePositionOffset = 5
const activityAbsencePositionOffset = 4
const startupCleanupQuiescenceOrdinal = 2

/** Builds the same typed P1 -> P2 terminal evidence used by cleanup tests and cassettes. */
export const replacementProvenanceFor = (
  plannedAttempt: PlannedTaskAttempt,
  successorAttempt: PlannedTaskAttempt,
  quiescenceReportOrdinal: PlannedAttemptExecutorReportOrdinal = PlannedAttemptExecutorReportOrdinal.make(1)
): PlannedAttemptReplacedEvent => {
  const ids = replacementFixtureIdsFor(plannedAttempt)
  const requestId = AttemptChoiceRequestId.make({ nonce: ids.requestNonce, runId: plannedAttempt.runId })
  const subject = AttemptChoiceSubject.make({ observedTaskRevision: successorAttempt.taskRevision, plannedAttempt })
  const expectedClaim = ActiveTaskClaim.make({
    operationId: ids.claimOperationId,
    owner: ClaimOwner.make("cleanup-provenance"),
    taskId: plannedAttempt.taskId,
    token: ClaimToken.make(ids.requestNonce)
  })
  const witness = PlannedAttemptReplacementWitness.make({
    claimObservationOperationId: ids.claimObservationOperationId,
    expectedClaim,
    graphObservationOperationId: ids.graphObservationOperationId,
    oldWorktreeObservationOperationId: ids.worktreeObservationOperationId,
    oldWorktreeProof: PlannedWorktreeReady.make({
      baseSha: plannedAttempt.baseSha,
      branch: plannedAttempt.branch,
      headSha: plannedAttempt.baseSha,
      worktree: plannedAttempt.worktree
    }),
    quiescenceProof: { _tag: "CommandResponse", reportOrdinal: quiescenceReportOrdinal },
    specificationObservationOperationId: ids.specificationObservationOperationId,
    targetHeadSha: successorAttempt.baseSha,
    targetLineageObservationOperationId: ids.targetLineageObservationOperationId
  })
  const successorPlan = WorkflowOperation.cases.RecordTaskAttemptPlan.make({
    operationId: ids.successorPlanOperationId,
    plannedAttempt: successorAttempt,
    predecessorOperationIds: ids.predecessorOperationIds
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
  successorAttempt: PlannedTaskAttempt,
  chronology: "Cassette" | "StartupValid" = "Cassette"
) {
  const journal = yield* JournalStore
  const quiescenceReportOrdinal =
    chronology === "StartupValid"
      ? PlannedAttemptExecutorReportOrdinal.make(startupCleanupQuiescenceOrdinal)
      : PlannedAttemptExecutorReportOrdinal.make(1)
  const event = replacementProvenanceFor(plannedAttempt, successorAttempt, quiescenceReportOrdinal)
  const ids = replacementFixtureIdsFor(plannedAttempt)
  const began = (yield* journal.read(plannedAttempt.runId)).find(
    ({ event: candidate }) => candidate._tag === "WorkflowRunBegan"
  )
  if (began?.event._tag !== "WorkflowRunBegan") return yield* Effect.die("replacement fixture requires a begun Run")
  const graphOperation = makeTrackerGraphObservationOperation(
    ids.graphObservationOperationId,
    began.event.target,
    [],
    [plannedAttempt.taskId]
  )
  const graphProjection = projectTrackerSnapshot({
    revision: TrackerRevision.make("cleanup-provenance-graph"),
    tasks: [
      {
        id: plannedAttempt.taskId,
        lifecycle: TaskLifecycle.cases.Open.make({}),
        parentTaskId: null,
        prerequisiteIds: []
      }
    ]
  })
  const graphSnapshot = Option.getOrThrow(
    graphProjection._tag === "Valid" ? Option.some(graphProjection.snapshot) : Option.none()
  )
  const specificationOperation = makeTaskWorkSpecificationObservationOperation(
    ids.specificationObservationOperationId,
    began.event.target,
    plannedAttempt.taskId,
    [graphOperation.operationId]
  )
  const specification = makeTaskWorkSpecification({
    body: "cleanup provenance witness",
    taskId: plannedAttempt.taskId,
    title: "cleanup provenance witness"
  })
  // The Restart choice itself needs a prior graph/specification observation,
  // while the replacement witness needs a fresh graph/specification read
  // after that choice. Keep those authorities distinct so the startup
  // reducer sees the same chronology as an ordinary coordinator.
  const choiceGraphOperation = makeTrackerGraphObservationOperation(
    OperationId.make(`${ids.graphObservationOperationId}:choice-authority`),
    began.event.target,
    [],
    [plannedAttempt.taskId]
  )
  const choiceSpecificationOperation = makeTaskWorkSpecificationObservationOperation(
    OperationId.make(`${ids.specificationObservationOperationId}:choice-authority`),
    began.event.target,
    plannedAttempt.taskId,
    [choiceGraphOperation.operationId]
  )
  const claimObservationOperation = makeTaskClaimObservationOperation(
    ids.claimObservationOperationId,
    began.event.target,
    plannedAttempt.taskId,
    [graphOperation.operationId, specificationOperation.operationId]
  )
  const worktreeObservationOperation = WorkflowOperation.cases.ReadTaskWorktree.make({
    operationId: ids.worktreeObservationOperationId,
    plannedAttempt,
    predecessorOperationIds: [
      graphOperation.operationId,
      specificationOperation.operationId,
      claimObservationOperation.operationId
    ]
  })
  const targetLineageOperation = WorkflowOperation.cases.ReadTargetLineage.make({
    integrationTarget: IntegrationTarget.make({
      repository: GitRepositoryLocator.make("cleanup-provenance-repository"),
      ref: IntegrationTargetRef.make("refs/heads/main")
    }),
    operationId: ids.targetLineageObservationOperationId,
    plannedAttempt,
    predecessorOperationIds: [worktreeObservationOperation.operationId]
  })
  const appendTrackerIntent = (
    operation: typeof graphOperation | typeof specificationOperation | typeof claimObservationOperation
  ) => journal.append(plannedAttempt.runId, intentRecordKey(operation.operationId), taskTrackerReadIntent(operation))
  yield* journal.append(
    plannedAttempt.runId,
    intentRecordKey(event.witness.expectedClaim.operationId),
    TaskClaimAcquisitionIntendedEvent.make({
      operation: makeTaskClaimAcquisitionOperation({
        acquisition: event.witness.expectedClaim,
        predecessorOperationIds: []
      }),
      version: workflowJournalEventVersion
    })
  )
  yield* journal.append(
    plannedAttempt.runId,
    outcomeRecordKey(event.witness.expectedClaim.operationId),
    TaskClaimAcquiredEvent.make({ claim: event.witness.expectedClaim, version: workflowJournalEventVersion })
  )
  const planOperation = makeTaskAttemptPlanOperation({
    operationId: OperationId.make(`${ids.requestNonce}:plan`),
    plannedAttempt,
    predecessorOperationIds: [event.witness.expectedClaim.operationId]
  })
  yield* journal.append(
    plannedAttempt.runId,
    attemptPlanRecordKey(plannedAttempt.attemptId),
    TaskAttemptPlannedEvent.make({ operation: planOperation, version: workflowJournalEventVersion })
  )
  if (chronology === "StartupValid") {
    // Startup recovery needs the earlier graph/specification facts before it
    // can accept the persisted Restart choice.
    yield* appendTrackerIntent(choiceGraphOperation)
    yield* journal.append(
      plannedAttempt.runId,
      outcomeRecordKey(choiceGraphOperation.operationId),
      taskTrackerFactsObservedEvent(
        choiceGraphOperation.operationId,
        makeCompleteTaskTrackerFactsObserved(choiceGraphOperation, graphSnapshot)
      )
    )
    yield* appendTrackerIntent(choiceSpecificationOperation)
    yield* journal.append(
      plannedAttempt.runId,
      outcomeRecordKey(choiceSpecificationOperation.operationId),
      taskTrackerFactsObservedEvent(
        choiceSpecificationOperation.operationId,
        makeFocusedTaskWorkSpecificationFactsObserved(choiceSpecificationOperation, specification)
      )
    )
  }
  const appendExecutorQuiescenceProof = (
    commandOrdinal: PlannedAttemptExecutorCommandOrdinal,
    reportOrdinal: PlannedAttemptExecutorReportOrdinal,
    beginResponsibility: boolean
  ) =>
    Effect.gen(function* () {
      if (beginResponsibility) {
        yield* journal.append(
          plannedAttempt.runId,
          plannedAttemptExecutorWorkResponsibilityBeganRecordKey(plannedAttempt.attemptId),
          PlannedAttemptExecutorWorkResponsibilityBeganEvent.make({
            plannedAttempt,
            version: workflowJournalEventVersion
          })
        )
      }
      yield* journal.append(
        plannedAttempt.runId,
        plannedAttemptExecutorCommandIntendedRecordKey(plannedAttempt.attemptId, commandOrdinal),
        PlannedAttemptExecutorCommandIntendedEvent.make({
          command: "StartOrContinue",
          initiatedBy: { _tag: "DalphCoordinator" },
          occurrenceClassification: "InitiatedAction",
          ordinal: commandOrdinal,
          plannedAttempt,
          version: workflowJournalEventVersion
        })
      )
      yield* journal.append(
        plannedAttempt.runId,
        plannedAttemptExecutorWorkReportedRecordKey(plannedAttempt.attemptId, reportOrdinal),
        PlannedAttemptExecutorWorkReportedEvent.make({
          ordinal: reportOrdinal,
          report: PlannedAttemptExecutorReport.cases.SafelySuspended.make({
            correlation: { attemptId: plannedAttempt.attemptId, runId: plannedAttempt.runId }
          }),
          version: workflowJournalEventVersion
        })
      )
    })
  if (chronology === "StartupValid") {
    yield* appendExecutorQuiescenceProof(
      PlannedAttemptExecutorCommandOrdinal.make(1),
      PlannedAttemptExecutorReportOrdinal.make(1),
      true
    )
  }
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
  yield* appendExecutorQuiescenceProof(
    PlannedAttemptExecutorCommandOrdinal.make(chronology === "StartupValid" ? startupCleanupQuiescenceOrdinal : 1),
    quiescenceReportOrdinal,
    chronology === "Cassette"
  )
  yield* appendTrackerIntent(graphOperation)
  yield* journal.append(
    plannedAttempt.runId,
    outcomeRecordKey(graphOperation.operationId),
    taskTrackerFactsObservedEvent(
      graphOperation.operationId,
      makeCompleteTaskTrackerFactsObserved(graphOperation, graphSnapshot)
    )
  )
  yield* appendTrackerIntent(specificationOperation)
  yield* journal.append(
    plannedAttempt.runId,
    outcomeRecordKey(specificationOperation.operationId),
    taskTrackerFactsObservedEvent(
      specificationOperation.operationId,
      makeFocusedTaskWorkSpecificationFactsObserved(specificationOperation, specification)
    )
  )
  yield* appendTrackerIntent(claimObservationOperation)
  yield* journal.append(
    plannedAttempt.runId,
    outcomeRecordKey(claimObservationOperation.operationId),
    taskTrackerFactsObservedEvent(
      claimObservationOperation.operationId,
      makeFocusedTaskClaimFactsObserved(claimObservationOperation, event.witness.expectedClaim)
    )
  )
  yield* journal.append(
    plannedAttempt.runId,
    intentRecordKey(worktreeObservationOperation.operationId),
    GitReadIntentRecordedEvent.make({
      initiatedBy: { _tag: "DalphCoordinator" },
      occurrenceClassification: "InitiatedAction",
      operation: worktreeObservationOperation,
      version: workflowJournalEventVersion
    })
  )
  yield* journal.append(
    plannedAttempt.runId,
    outcomeRecordKey(worktreeObservationOperation.operationId),
    PlannedAttemptWorktreeObservedEvent.make({
      observation: PlannedWorktreeReady.make({
        baseSha: plannedAttempt.baseSha,
        branch: plannedAttempt.branch,
        headSha: plannedAttempt.baseSha,
        worktree: plannedAttempt.worktree
      }),
      occurrenceClassification: "NonActionOccurrence",
      operationId: worktreeObservationOperation.operationId,
      version: workflowJournalEventVersion
    })
  )
  yield* journal.append(
    plannedAttempt.runId,
    intentRecordKey(targetLineageOperation.operationId),
    GitReadIntentRecordedEvent.make({
      initiatedBy: { _tag: "DalphCoordinator" },
      occurrenceClassification: "InitiatedAction",
      operation: targetLineageOperation,
      version: workflowJournalEventVersion
    })
  )
  yield* journal.append(
    plannedAttempt.runId,
    outcomeRecordKey(targetLineageOperation.operationId),
    TargetLineageObservedEvent.make({
      observation: {
        plannedBaseIsAncestorOfTargetHead: true,
        plannedBaseSha: plannedAttempt.baseSha,
        targetHeadSha: event.witness.targetHeadSha
      },
      occurrenceClassification: "NonActionOccurrence",
      operationId: targetLineageOperation.operationId,
      plannedAttempt,
      version: workflowJournalEventVersion
    })
  )
  return yield* journal.append(plannedAttempt.runId, plannedAttemptReplacedRecordKey(plannedAttempt.attemptId), event)
})

/**
 * Appends a complete Stop/Abandoned terminal witness and the exact Git read
 * used by a worktree cleanup authorization. This fixture intentionally keeps
 * the responsibility, command intent, correlated safe report, and claim
 * authority in one immutable chronology so cleanup cannot accept a forged
 * direct abandonment report.
 */
export const appendAbandonedProvenance = Effect.fn("DispositionCleanupTest.appendAbandonedProvenance")(function* (
  plannedAttempt: PlannedTaskAttempt,
  cleanupOperationId = OperationId.make(`abandoned:${plannedAttempt.attemptId}:cleanup`)
) {
  const journal = yield* JournalStore
  const began = (yield* journal.read(plannedAttempt.runId)).find(
    ({ event: candidate }) => candidate._tag === "WorkflowRunBegan"
  )
  if (began?.event._tag !== "WorkflowRunBegan") return yield* Effect.die("abandoned fixture requires a begun Run")
  const suffix = plannedAttempt.attemptId
  const claim = ActiveTaskClaim.make({
    operationId: OperationId.make(`abandoned:${suffix}:claim`),
    owner: ClaimOwner.make("abandoned-fixture"),
    taskId: plannedAttempt.taskId,
    token: ClaimToken.make(`abandoned:${suffix}:token`)
  })
  const claimOperation = makeTaskClaimAcquisitionOperation({ acquisition: claim, predecessorOperationIds: [] })
  const planOperation = makeTaskAttemptPlanOperation({
    operationId: OperationId.make(`abandoned:${suffix}:plan`),
    plannedAttempt,
    predecessorOperationIds: [claim.operationId]
  })
  const requestId = AttemptChoiceRequestId.make({ nonce: `abandoned:${suffix}:stop`, runId: plannedAttempt.runId })
  const subject = AttemptChoiceSubject.make({
    observedTaskRevision: TaskRevision.make(`abandoned:${suffix}:observed`),
    plannedAttempt
  })
  yield* journal.append(
    plannedAttempt.runId,
    intentRecordKey(claim.operationId),
    TaskClaimAcquisitionIntendedEvent.make({ operation: claimOperation, version: workflowJournalEventVersion })
  )
  yield* journal.append(
    plannedAttempt.runId,
    outcomeRecordKey(claim.operationId),
    TaskClaimAcquiredEvent.make({ claim, version: workflowJournalEventVersion })
  )
  yield* journal.append(
    plannedAttempt.runId,
    attemptPlanRecordKey(plannedAttempt.attemptId),
    TaskAttemptPlannedEvent.make({ operation: planOperation, version: workflowJournalEventVersion })
  )
  yield* journal.append(
    plannedAttempt.runId,
    attemptChoiceAppliedRecordKey(requestId),
    AttemptChoiceAppliedEvent.make({
      choice: "StopTaskImplementation",
      initiatedBy: { _tag: "Operator" },
      occurrenceClassification: "InitiatedAction",
      requestId,
      subject,
      version: workflowJournalEventVersion
    })
  )
  yield* journal.append(
    plannedAttempt.runId,
    plannedAttemptExecutorWorkResponsibilityBeganRecordKey(plannedAttempt.attemptId),
    PlannedAttemptExecutorWorkResponsibilityBeganEvent.make({ plannedAttempt, version: workflowJournalEventVersion })
  )
  const commandOrdinal = PlannedAttemptExecutorCommandOrdinal.make(1)
  yield* journal.append(
    plannedAttempt.runId,
    plannedAttemptExecutorCommandIntendedRecordKey(plannedAttempt.attemptId, commandOrdinal),
    PlannedAttemptExecutorCommandIntendedEvent.make({
      command: "StartOrContinue",
      initiatedBy: { _tag: "DalphCoordinator" },
      occurrenceClassification: "InitiatedAction",
      ordinal: commandOrdinal,
      plannedAttempt,
      version: workflowJournalEventVersion
    })
  )
  const reportOrdinal = PlannedAttemptExecutorReportOrdinal.make(1)
  yield* journal.append(
    plannedAttempt.runId,
    plannedAttemptExecutorWorkReportedRecordKey(plannedAttempt.attemptId, reportOrdinal),
    PlannedAttemptExecutorWorkReportedEvent.make({
      ordinal: reportOrdinal,
      report: PlannedAttemptExecutorReport.cases.SafelySuspended.make({
        correlation: { attemptId: plannedAttempt.attemptId, runId: plannedAttempt.runId }
      }),
      version: workflowJournalEventVersion
    })
  )
  const abandonment = yield* journal.append(
    plannedAttempt.runId,
    attemptImplementationAbandonedRecordKey(requestId),
    AttemptImplementationAbandonedEvent.make({
      expectedClaim: claim,
      initiatedBy: { _tag: "DalphCoordinator" },
      occurrenceClassification: "InitiatedAction",
      proof: { _tag: "CommandResponse", reportOrdinal },
      requestId,
      subject,
      version: workflowJournalEventVersion
    })
  )
  const observationOperation = WorkflowOperation.cases.ReadTaskWorktree.make({
    operationId: OperationId.make(`abandoned:${suffix}:worktree-observation`),
    plannedAttempt,
    predecessorOperationIds: [claim.operationId]
  })
  yield* journal.append(
    plannedAttempt.runId,
    intentRecordKey(observationOperation.operationId),
    GitReadIntentRecordedEvent.make({
      initiatedBy: { _tag: "DalphCoordinator" },
      occurrenceClassification: "InitiatedAction",
      operation: observationOperation,
      version: workflowJournalEventVersion
    })
  )
  const observation = yield* journal.append(
    plannedAttempt.runId,
    outcomeRecordKey(observationOperation.operationId),
    PlannedAttemptWorktreeObservedEvent.make({
      observation: PlannedWorktreeReady.make({
        baseSha: plannedAttempt.baseSha,
        branch: plannedAttempt.branch,
        headSha: plannedAttempt.baseSha,
        worktree: plannedAttempt.worktree
      }),
      occurrenceClassification: "NonActionOccurrence",
      operationId: observationOperation.operationId,
      version: workflowJournalEventVersion
    })
  )
  const disposition = PlannedAttemptCleanupDisposition.cases.Abandoned.make({
    dispositionAt: abandonment.position,
    plannedAttempt,
    requestId
  })
  return WorktreeCleanupAuthorization.make({
    causalPredecessors: [claim.operationId],
    disposition,
    evidenceRevision: WorktreeCleanupEvidenceRevision.make(1),
    expectedHead: plannedAttempt.baseSha,
    locator: plannedAttempt.worktree,
    observationAt: observation.position,
    observationOperationId: observationOperation.operationId,
    operationId: cleanupOperationId,
    owner: WorktreeCleanupOwner.make({ attemptId: plannedAttempt.attemptId, branch: plannedAttempt.branch }),
    writerQuiescent: true
  })
})

interface CandidateAuthorityPrefix {
  readonly predecessorRun: IntegratorRunCorrelation
  readonly quarantine: IntegrationQuarantinedEvent
  readonly quarantineAt: JournalPosition
  readonly directionAppliedAt: JournalPosition
}

/**
 * Appends the canonical S1 -> run -> provider-absence -> quarantine prefix.
 * Current quarantine selection deliberately uses this same causal prefix but
 * has no direction or successor event from which cleanup authority could be
 * reconstructed.
 */
const appendCandidateAuthorityPrefix = (
  predecessor: IntegratorSessionCorrelation,
  chronology: "Cassette" | "StartupValid" = "Cassette"
) =>
  Effect.gen(function* () {
    const journal = yield* JournalStore
    const runId = predecessor.plannedAttempt.runId
    const predecessorRun = IntegratorRunCorrelation.make({
      ordinal: IntegratorRunOrdinal.make(1),
      session: predecessor
    })
    const predecessorLineageOperation = WorkflowOperation.cases.ReadTargetLineage.make({
      integrationTarget: predecessor.integrationTarget,
      operationId: OperationId.make(`${predecessor.sessionId}:predecessor-lineage`),
      plannedAttempt: predecessor.plannedAttempt,
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
    // Startup recovery validates IntegrationStarted before the original
    // lineage read. That moves the quarantine four records after the lineage
    // observation; legacy cassettes retain their historical five-record
    // offset because their started fact follows the read.
    const quarantineAt = JournalPosition.make(
      Number(predecessor.targetLineageObservedAt) +
        (chronology === "StartupValid" ? quarantinePositionOffset - 1 : quarantinePositionOffset)
    )
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
          Number(predecessor.targetLineageObservedAt) +
            (chronology === "StartupValid" ? activityAbsencePositionOffset - 1 : activityAbsencePositionOffset)
        )
      }),
      correlation: predecessor,
      occurrenceClassification: "NonActionOccurrence",
      version: workflowJournalEventVersion
    })
    const appendResponsibility = journal.append(
      runId,
      integrationResponsibilityBeganRecordKey(predecessor.plannedAttempt.attemptId),
      responsibilityBegan
    )
    const appendStart = journal.append(
      runId,
      integrationStartedRecordKey(predecessor.plannedAttempt.attemptId),
      started
    )
    const appendLineageIntent = journal.append(
      runId,
      intentRecordKey(predecessorLineageOperation.operationId),
      GitReadIntentRecordedEvent.make({
        initiatedBy: { _tag: "DalphCoordinator" },
        occurrenceClassification: "InitiatedAction",
        operation: predecessorLineageOperation,
        version: workflowJournalEventVersion
      })
    )
    const appendLineageObservation = journal.append(
      runId,
      outcomeRecordKey(predecessorLineageOperation.operationId),
      predecessorLineage
    )
    const appendSession = journal.append(
      runId,
      integratorSessionFixedRecordKey(integratorResponsibilityFactsFromCorrelation(predecessor)),
      fixed
    )
    yield* appendResponsibility
    if (chronology === "StartupValid") yield* appendStart
    yield* appendLineageIntent
    yield* appendLineageObservation
    if (chronology === "Cassette") yield* appendSession
    if (chronology === "Cassette") yield* appendStart
    if (chronology === "StartupValid") yield* appendSession
    yield* journal.append(runId, integratorRunStartedRecordKey(predecessorRun), runStarted)
    yield* journal.append(runId, integrationProviderRunActivityAbsentRecordKey(predecessorRun), absence)
    yield* journal.append(runId, integrationQuarantinedRecordKey(predecessor.sessionId, quarantine.basis), quarantine)
    return {
      predecessorRun,
      quarantine,
      quarantineAt,
      directionAppliedAt: JournalPosition.make(Number(quarantineAt) + 1)
    } satisfies CandidateAuthorityPrefix
  })

/** Appends a real current-quarantine history without fabricating disposal authority. */
export const appendCurrentQuarantineProvenance = Effect.fn("DispositionCleanupTest.appendCurrentQuarantineProvenance")(
  function* (predecessor: IntegratorSessionCorrelation) {
    yield* appendCandidateAuthorityPrefix(predecessor)
  }
)

/**
 * Appends the complete S1/Q/D/S2 evidence needed by candidate cleanup. The
 * positions are deliberately derived from append order so the fixture also
 * exercises the same chronology checks used by recovery.
 */
export const appendCandidateProvenance = Effect.fn("DispositionCleanupTest.appendCandidateProvenance")(function* (
  predecessor: IntegratorSessionCorrelation,
  successor: IntegratorSessionCorrelation,
  directionNonce: string,
  chronology: "Cassette" | "StartupValid" = "Cassette"
) {
  const journal = yield* JournalStore
  const runId = predecessor.plannedAttempt.runId
  const prefix = yield* appendCandidateAuthorityPrefix(predecessor, chronology)
  const successorLineageOperation = WorkflowOperation.cases.ReadTargetLineage.make({
    integrationTarget: successor.integrationTarget,
    operationId: OperationId.make(`${successor.sessionId}:successor-lineage`),
    plannedAttempt: successor.plannedAttempt,
    predecessorOperationIds: []
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
  const direction = IntegrationQuarantineDirectionAppliedEvent.make({
    fingerprint: IntegrationQuarantineDirectionFingerprint.make({
      direction: "FullRerun",
      quarantineAt: prefix.quarantineAt,
      sessionId: predecessor.sessionId
    }),
    initiatedBy: { _tag: "Operator" },
    occurrenceClassification: "InitiatedAction",
    requestId: IntegrationQuarantineDirectionRequestId.make({ nonce: directionNonce, runId }),
    version: workflowJournalEventVersion
  })
  const successorFixed = IntegratorSuccessorSessionFixedEvent.make({
    direction: "FullRerun",
    directionAppliedAt: prefix.directionAppliedAt,
    predecessor,
    quarantineAt: prefix.quarantineAt,
    successor,
    successorGeneration: firstFullRerunSuccessorGeneration,
    version: workflowJournalEventVersion
  })
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
    integratorSuccessorSessionFixedRecordKey(predecessor, prefix.quarantineAt, prefix.directionAppliedAt),
    successorFixed
  )
})
