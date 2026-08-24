import { NodeFileSystem, NodePath } from "@effect/platform-node"
import { it } from "@effect/vitest"
import {
  AttemptId,
  GitCommitSha,
  IntegrationTarget,
  IntegrationTargetRef,
  makeTaskWorkSpecification,
  PlannedAttemptExecutorReport,
  PlannedTaskAttempt,
  RunId,
  TaskBranchRef,
  TaskExecutorLocator,
  TaskId,
  TaskRevision,
  WorktreeLocator
} from "@dalph/contracts"
import { Effect, FileSystem, Layer, Option, Path, Schema } from "effect"
import { expect as vitestExpect } from "vitest"
import { FixtureTarget } from "../authorities/task-tracker/fixture/target.js"
import { projectTrackerSnapshot } from "../authorities/task-tracker/graph.js"
import { TargetLineageObservation } from "../authorities/git/target-lineage.js"
import { PlannedWorktreeReady } from "../authorities/git/worktree.js"
import { InitialControlPolicy } from "../control/policy.js"
import { TaskWorkCapacity } from "../coordination/admission/capacity.js"
import { ActiveTaskClaim, UnclaimedTask } from "../authorities/task-tracker/claim-mutation.js"
import { ClaimOwner, ClaimToken } from "../authorities/task-tracker/claim.js"
import { WorkflowActor } from "../workflow/registry/actor.js"
import {
  TaskClaimAcquisitionIntendedEvent,
  TaskClaimAcquiredEvent,
  TaskAttemptPlannedEvent,
  GitReadIntentRecordedEvent,
  PlannedAttemptWorktreeObservedEvent,
  TaskWorktreeReadyEvent,
  TaskWorktreeReconciliationIntendedEvent,
  taskTrackerReadIntent,
  TargetLineageObservedEvent,
  WorkflowRunBeganEvent
} from "../workflow/registry/event.js"
import {
  AttemptChoiceAppliedEvent,
  AttemptChoiceRequestId,
  AttemptImplementationAbandonedEvent,
  type AttemptQuiescenceProof,
  AttemptStoppageIntendedEvent,
  StoppedAttemptClaimNoReleaseObservedEvent
} from "../workflow/protocols/attempt-choice/events.js"
import {
  IntegrationResponsibilityBeganEvent,
  IntegrationStartedEvent
} from "../workflow/protocols/integration-admission/events.js"
import {
  PlannedAttemptExecutorReportOrdinal,
  PlannedAttemptExecutorWorkReportedEvent,
  PlannedAttemptExecutorWorkResponsibilityBeganEvent
} from "../workflow/protocols/planned-attempt-executor-work/events.js"
import {
  PlannedAttemptReplacedEvent,
  PlannedAttemptReplacementWitness,
  AttemptRestartAuthorityReadFailedEvent,
  AttemptRestartTaskFactsReadFailure
} from "../workflow/protocols/attempt-choice/replacement-events.js"
import { AttemptWorktreeLost } from "../workflow/protocols/planned-attempt-worktree-observation/protocol.js"
import {
  makeTaskAttemptPlanOperation,
  makeTaskClaimAcquisitionOperation,
  makeTaskClaimObservationOperation,
  makeTaskWorkSpecificationObservationOperation,
  makeCompletionTaskFactsObservationOperation,
  makeTargetLineageObservationOperation,
  makeTaskWorktreeObservationOperation,
  makeTaskWorktreeReconciliationOperation,
  makeTrackerGraphObservationOperation
} from "../workflow/registry/operation.js"
import { OperationId } from "../workflow/identity.js"
import { workflowJournalEventVersion } from "../workflow/kernel/event.js"
import { JournalDatabaseLocator, JournalPosition, JournalRecordKey } from "../workflow-journal/identity.js"
import { memoryJournalStoreLayer } from "../workflow-journal/adapters/memory-store.js"
import { sqliteJournalStoreLayer } from "../workflow-journal/adapters/sqlite-store.js"
import { JournalStore } from "../workflow-journal/store.js"
import type { JournalRecord } from "../workflow-journal/store.js"
import { integrationFinalityFixture } from "../workflow/protocols/integration-finality/fixtures.js"
import {
  IntegratorGitObservation,
  IntegratorCandidateText,
  IntegratorNotPreparedDetail,
  IntegratorRunOrdinal,
  IntegratorResult,
  IntegratorRunCorrelation,
  IntegratorRunCandidateGitObservedEvent,
  IntegratorRunCandidateGitReadIntendedEvent,
  IntegratorRunResultRecordedEvent,
  IntegratorRunStartedEvent,
  IntegratorSessionCorrelation,
  IntegratorSessionId,
  IntegratorSessionFixedEvent
} from "../workflow/protocols/integrator/events.js"
import {
  TargetPromotionAttemptOrdinal,
  TargetPromotionAttemptLimit,
  TargetPromotionSuccessObservation,
  TargetPromotionAttemptIntendedEvent,
  TargetPromotionNonConvergenceEvent,
  TargetPromotionIntendedEvent,
  TargetPromotionStaleEvent,
  TargetPromotionObservedSuccessEvent
} from "../workflow/protocols/target-promotion/events.js"
import {
  IntegrationProviderRunActivityAbsentEvent,
  IntegrationQuarantineDirectionAppliedEvent,
  IntegrationQuarantineDirectionFingerprint,
  IntegrationQuarantineDirectionRequestId,
  IntegrationQuarantineFailureDetail,
  IntegrationQuarantinedEvent
} from "../workflow/protocols/integration-quarantine/events.js"
import {
  CompletionClaimRequestOrdinal,
  CompletionClaimCleanupReadOrdinal,
  CompletionClaimDeletionReadPurpose,
  CompletionClaimDeletionReadObservedEvent,
  CompletionClaimDeletedEvent,
  CompletionClaimDeletionAttemptIntendedEvent,
  CompletionClaimDeletionIntendedEvent,
  CompletionClaimReplacedEvent,
  CompletionClaimReplacementAttemptIntendedEvent,
  CompletionClaimReplacementIntendedEvent,
  CompletionTaskAcknowledgedEvent,
  CompletionTaskAuthorizationReadOrdinal,
  CompletionTaskAttemptIntendedEvent,
  CompletionTaskCandidateAncestryObservedEvent,
  CompletionTaskCandidateAncestryReadIntendedEvent,
  CompletionTaskConfirmationReadOrdinal,
  CompletionTaskFocusedReadPurpose,
  CompletionTaskClaim,
  FocusedTaskCompletionFacts,
  completionTaskRequestFor,
  CompletionTaskIntendedEvent,
  CompletionTaskRequestOrdinal,
  completionClaimDeletionRequestFor,
  IntegrationFinalitySettledEvent,
  PostPromotionBlockerCandidateAncestryObservedEvent,
  PostPromotionBlockerCandidateAncestryReadIntendedEvent,
  PostPromotionBlockerClearAuthorization,
  postPromotionBlockerAncestryOperationIdFor
} from "../workflow/protocols/integration-finality/events.js"
import { completionTaskCandidateAncestryReadOperationIdFor } from "../workflow/protocols/integration-finality/completion-task-operation-identity.js"
import { makeFocusedTaskCompletionFactsObserved } from "../workflow/task-tracker-facts/focused-completion-observation.js"
import {
  makeFocusedTaskClaimFactsObserved,
  makeFocusedTaskClaimFactsUnreadable,
  makeFocusedTaskWorkSpecificationFactsObserved,
  makeCompleteTaskTrackerFactsObserved,
  TaskTrackerFactsReadFailed,
  taskTrackerFactsObservedEvent
} from "../workflow/task-tracker-facts/observation.js"
import {
  TraceAtCursor,
  TraceBranchCleanupProgress,
  TraceBranchCleanupStep,
  TraceCleanupStatus,
  TraceControlDispositionFacet,
  TraceControlFact,
  TraceDispositionFact,
  TraceIntegratorCandidateCleanupStep,
  TraceIntegratorCandidateCleanupProgress,
  TraceCursor,
  TraceHistoricalFacets,
  TraceItemIdentity,
  TraceIntegrationFact,
  TraceObservationGap,
  TracePreservationDisposition,
  TraceJournalPrefixInvalid,
  TraceProjectionInvalid,
  TraceRetainedResponsibility,
  TraceWorktreeCleanupStep,
  TraceWorktreeCleanupProgress,
  makeTraceReader
} from "./trace-reader.js"
import { traceHistoricalFacetsIssue, type HistoricalFacetFactories } from "./trace-reader-historical-facets.js"
import { describeJournalEvent } from "../workflow/registry/event-descriptor.js"
import { projectWorkflowOccurrences } from "../workflow/registry/occurrence-projection.js"

const runId = RunId.make("historical-81-82-run")
const trackerTarget = FixtureTarget.make("historical-81-82-target")
const initialPolicy = InitialControlPolicy.make({ taskExecutionCapacity: TaskWorkCapacity.make(1) })

const record = (position: number, event: JournalRecord["event"], recordRunId: RunId = runId): JournalRecord => ({
  event,
  key: describeJournalEvent(event).expectedKey,
  position: JournalPosition.make(position),
  runId: recordRunId
})

const withEvent = (record: JournalRecord, event: JournalRecord["event"]): JournalRecord => ({
  ...record,
  event,
  key: describeJournalEvent(event).expectedKey
})

const runBeginning = WorkflowRunBeganEvent.make({
  initialControlPolicy: initialPolicy,
  initiatedBy: WorkflowActor.cases.DalphCoordinator.make({}),
  occurrenceClassification: "InitiatedAction",
  target: trackerTarget,
  version: workflowJournalEventVersion
})

const plannedAttempt = PlannedTaskAttempt.make({
  attemptId: AttemptId.make("historical-81-82-attempt"),
  baseSha: GitCommitSha.make("1".repeat(40)),
  branch: TaskBranchRef.make("refs/heads/dalph/historical-81-82"),
  executor: TaskExecutorLocator.make("executor:historical-81-82"),
  runId,
  taskId: TaskId.make("historical-81-82-task"),
  taskRevision: TaskRevision.make("historical-81-82-revision"),
  worktree: WorktreeLocator.make("/worktrees/historical-81-82")
})

const independentAttempt = PlannedTaskAttempt.make({
  ...plannedAttempt,
  attemptId: AttemptId.make("historical-81-82-independent-attempt"),
  branch: TaskBranchRef.make("refs/heads/dalph/historical-81-82-independent"),
  taskId: TaskId.make("historical-81-82-independent-task"),
  taskRevision: TaskRevision.make("historical-81-82-independent-revision"),
  worktree: WorktreeLocator.make("/worktrees/historical-81-82-independent")
})

const historicalFacetFactories = {
  branchCleanupStep: { make: (input: Omit<TraceBranchCleanupStep, "_tag">) => TraceBranchCleanupStep.make(input) },
  cleanupProgress: {
    Branch: { make: (input) => TraceBranchCleanupProgress.make(input) },
    IntegratorCandidate: { make: (input) => TraceIntegratorCandidateCleanupProgress.make(input) },
    Worktree: { make: (input) => TraceWorktreeCleanupProgress.make(input) }
  },
  cleanupStatus: TraceCleanupStatus.cases,
  controlDisposition: {
    make: (input: Omit<TraceControlDispositionFacet, "_tag">) => TraceControlDispositionFacet.make(input)
  },
  controlFact: TraceControlFact.cases,
  dispositionFact: TraceDispositionFact.cases,
  integratorCandidateCleanupStep: {
    make: (input: Omit<TraceIntegratorCandidateCleanupStep, "_tag">) => TraceIntegratorCandidateCleanupStep.make(input)
  },
  observationGap: TraceObservationGap.cases,
  preservationDisposition: TracePreservationDisposition.cases,
  retainedResponsibility: TraceRetainedResponsibility.cases,
  integrationFact: TraceIntegrationFact.cases,
  worktreeCleanupStep: {
    make: (input: Omit<TraceWorktreeCleanupStep, "_tag">) => TraceWorktreeCleanupStep.make(input)
  },
  facets: TraceHistoricalFacets
} satisfies HistoricalFacetFactories

const recoveryRecords = (): ReadonlyArray<JournalRecord> => {
  const claimOperation = makeTaskClaimAcquisitionOperation({
    acquisition: {
      operationId: OperationId.make("historical-81-82-claim"),
      owner: ClaimOwner.make("dalph:historical-81-82"),
      taskId: plannedAttempt.taskId,
      token: ClaimToken.make("historical-81-82-token")
    },
    predecessorOperationIds: []
  })
  const planOperation = makeTaskAttemptPlanOperation({
    operationId: OperationId.make("historical-81-82-plan"),
    plannedAttempt,
    predecessorOperationIds: [claimOperation.acquisition.operationId]
  })
  return [
    record(1, runBeginning),
    record(
      2,
      TaskClaimAcquisitionIntendedEvent.make({ operation: claimOperation, version: workflowJournalEventVersion })
    ),
    record(3, TaskAttemptPlannedEvent.make({ operation: planOperation, version: workflowJournalEventVersion })),
    record(
      4,
      PlannedAttemptExecutorWorkResponsibilityBeganEvent.make({ plannedAttempt, version: workflowJournalEventVersion })
    )
  ]
}

const preservationRecords = (): ReadonlyArray<JournalRecord> => {
  const worktreeOperation = makeTaskWorktreeObservationOperation({
    operationId: OperationId.make("historical-81-82-worktree-loss-read"),
    plannedAttempt,
    predecessorOperationIds: []
  })
  const restartRead = makeTrackerGraphObservationOperation(
    OperationId.make("historical-81-82-task-conflict-read"),
    trackerTarget,
    [],
    [plannedAttempt.taskId]
  )
  const requestId = AttemptChoiceRequestId.make({ nonce: "historical-81-82-restart", runId })
  const subject = { observedTaskRevision: TaskRevision.make("historical-81-82-observed-conflict"), plannedAttempt }
  const planOperation = makeTaskAttemptPlanOperation({
    operationId: OperationId.make("historical-81-82-independent-plan"),
    plannedAttempt: independentAttempt,
    predecessorOperationIds: []
  })
  return [
    record(
      1,
      WorkflowRunBeganEvent.make({
        initialControlPolicy: initialPolicy,
        initiatedBy: WorkflowActor.cases.DalphCoordinator.make({}),
        occurrenceClassification: "InitiatedAction",
        target: trackerTarget,
        version: workflowJournalEventVersion
      })
    ),
    record(
      2,
      GitReadIntentRecordedEvent.make({
        initiatedBy: WorkflowActor.cases.DalphCoordinator.make({}),
        occurrenceClassification: "InitiatedAction",
        operation: worktreeOperation,
        version: workflowJournalEventVersion
      })
    ),
    record(
      3,
      PlannedAttemptWorktreeObservedEvent.make({
        occurrenceClassification: "NonActionOccurrence",
        observation: AttemptWorktreeLost.make({ plannedAttempt }),
        operationId: worktreeOperation.operationId,
        version: workflowJournalEventVersion
      })
    ),
    record(
      4,
      AttemptChoiceAppliedEvent.make({
        choice: "RestartTaskImplementation",
        initiatedBy: WorkflowActor.cases.Operator.make({}),
        occurrenceClassification: "InitiatedAction",
        requestId,
        subject,
        version: workflowJournalEventVersion
      })
    ),
    record(
      5,
      TaskClaimAcquisitionIntendedEvent.make({
        operation: makeTaskClaimAcquisitionOperation({
          acquisition: {
            operationId: OperationId.make("historical-81-82-conflict-claim"),
            owner: ClaimOwner.make("dalph:historical-81-82"),
            taskId: plannedAttempt.taskId,
            token: ClaimToken.make("historical-81-82-conflict-token")
          },
          predecessorOperationIds: []
        }),
        version: workflowJournalEventVersion
      })
    ),
    record(6, taskTrackerReadIntent(restartRead)),
    record(
      7,
      AttemptRestartAuthorityReadFailedEvent.make({
        failure: AttemptRestartTaskFactsReadFailure.make({
          detail: "task facts changed while the attempt was retained",
          source: "FixtureReader.FixtureReadError",
          target: trackerTarget
        }),
        occurrenceClassification: "NonActionOccurrence",
        operationId: restartRead.operationId,
        requestId,
        subject,
        version: workflowJournalEventVersion
      })
    ),
    record(8, TaskAttemptPlannedEvent.make({ operation: planOperation, version: workflowJournalEventVersion }))
  ]
}

it.effect("#81 rejects foreign nested Run identities before exposing recovery history", () =>
  Effect.gen(function* () {
    const foreignRunId = RunId.make("historical-81-82-foreign-run")
    const foreignAttempt = PlannedTaskAttempt.make({ ...plannedAttempt, runId: foreignRunId })
    const foreignReconciliation = makeTaskWorktreeReconciliationOperation({
      operationId: OperationId.make("historical-81-82-foreign-reconciliation"),
      plannedAttempt: foreignAttempt,
      predecessorOperationIds: []
    })
    const foreignRequestId = AttemptChoiceRequestId.make({
      nonce: "historical-81-82-foreign-choice",
      runId: foreignRunId
    })
    const foreignSubject = {
      observedTaskRevision: TaskRevision.make("historical-81-82-foreign-observed"),
      plannedAttempt: foreignAttempt
    }
    const foreignClaim = ActiveTaskClaim.make({
      operationId: OperationId.make("historical-81-82-foreign-claim"),
      owner: ClaimOwner.make("dalph:historical-81-82"),
      taskId: foreignAttempt.taskId,
      token: ClaimToken.make("historical-81-82-foreign-token")
    })
    const quiescenceProof: AttemptQuiescenceProof = {
      _tag: "CommandResponse",
      reportOrdinal: PlannedAttemptExecutorReportOrdinal.make(1)
    }
    const foreignSuccessor = PlannedTaskAttempt.make({
      ...foreignAttempt,
      attemptId: AttemptId.make("historical-81-82-foreign-successor"),
      baseSha: GitCommitSha.make("2".repeat(40)),
      branch: TaskBranchRef.make("refs/heads/dalph/historical-81-82-foreign-successor"),
      taskRevision: foreignSubject.observedTaskRevision,
      worktree: WorktreeLocator.make("/worktrees/historical-81-82-foreign-successor")
    })
    const witness = PlannedAttemptReplacementWitness.make({
      claimObservationOperationId: OperationId.make("historical-81-82-foreign-claim-observation"),
      expectedClaim: foreignClaim,
      graphObservationOperationId: OperationId.make("historical-81-82-foreign-graph-observation"),
      oldWorktreeObservationOperationId: OperationId.make("historical-81-82-foreign-worktree-observation"),
      oldWorktreeProof: {
        baseSha: foreignAttempt.baseSha,
        branch: foreignAttempt.branch,
        headSha: foreignAttempt.baseSha,
        worktree: foreignAttempt.worktree
      },
      quiescenceProof,
      specificationObservationOperationId: OperationId.make("historical-81-82-foreign-specification-observation"),
      targetHeadSha: foreignSuccessor.baseSha,
      targetLineageObservationOperationId: OperationId.make("historical-81-82-foreign-lineage-observation")
    })
    const successorPlan = makeTaskAttemptPlanOperation({
      operationId: OperationId.make("historical-81-82-foreign-successor-plan"),
      plannedAttempt: foreignSuccessor,
      predecessorOperationIds: [
        foreignClaim.operationId,
        witness.claimObservationOperationId,
        witness.graphObservationOperationId,
        witness.oldWorktreeObservationOperationId,
        witness.specificationObservationOperationId,
        witness.targetLineageObservationOperationId
      ]
    })
    const foreignReplacement = PlannedAttemptReplacedEvent.make({
      initiatedBy: WorkflowActor.cases.DalphCoordinator.make({}),
      occurrenceClassification: "InitiatedAction",
      requestId: foreignRequestId,
      subject: foreignSubject,
      successorPlan,
      version: workflowJournalEventVersion,
      witness
    })
    const malformedEvents: ReadonlyArray<JournalRecord["event"]> = [
      TaskAttemptPlannedEvent.make({
        operation: makeTaskAttemptPlanOperation({
          operationId: OperationId.make("historical-81-82-foreign-plan"),
          plannedAttempt: foreignAttempt,
          predecessorOperationIds: []
        }),
        version: workflowJournalEventVersion
      }),
      TaskWorktreeReconciliationIntendedEvent.make({
        operation: foreignReconciliation,
        version: workflowJournalEventVersion
      }),
      AttemptStoppageIntendedEvent.make({
        initiatedBy: WorkflowActor.cases.DalphCoordinator.make({}),
        occurrenceClassification: "InitiatedAction",
        requestId: foreignRequestId,
        subject: foreignSubject,
        version: workflowJournalEventVersion
      }),
      AttemptImplementationAbandonedEvent.make({
        expectedClaim: foreignClaim,
        initiatedBy: WorkflowActor.cases.DalphCoordinator.make({}),
        occurrenceClassification: "InitiatedAction",
        proof: quiescenceProof,
        requestId: foreignRequestId,
        subject: foreignSubject,
        version: workflowJournalEventVersion
      }),
      StoppedAttemptClaimNoReleaseObservedEvent.make({
        expectedClaim: foreignClaim,
        observation: UnclaimedTask.make({ taskId: foreignAttempt.taskId }),
        observationOperationId: OperationId.make("historical-81-82-foreign-claim-read"),
        occurrenceClassification: "NonActionOccurrence",
        requestId: foreignRequestId,
        subject: foreignSubject,
        version: workflowJournalEventVersion
      }),
      foreignReplacement
    ]
    for (const event of malformedEvents) {
      const records = [record(1, runBeginning), record(2, event)]
      const failure = yield* Effect.flip(makeTraceReader({ read: () => Effect.succeed(records) }).read(runId))
      vitestExpect(failure).toBeInstanceOf(TraceProjectionInvalid)
    }
  })
)

const integrationRecords = (): ReadonlyArray<JournalRecord> => {
  const fixture = integrationFinalityFixture
  const candidateText = fixture.qualifiedCandidate.candidateText
  const session = IntegratorSessionCorrelation.make({
    ...fixture.qualifiedCandidate.run.session,
    queuedAt: JournalPosition.make(4),
    startedAt: JournalPosition.make(5),
    targetLineageObservedAt: JournalPosition.make(7)
  })
  const run = IntegratorRunCorrelation.make({ ordinal: fixture.qualifiedCandidate.run.ordinal, session })
  const qualifiedCandidate = { ...fixture.qualifiedCandidate, qualifiedAt: JournalPosition.make(12), run }
  const lineageOperation = makeTargetLineageObservationOperation({
    integrationTarget: fixture.integrationTarget,
    operationId: OperationId.make("historical-81-82-lineage"),
    plannedAttempt: fixture.plannedAttempt,
    predecessorOperationIds: []
  })
  const correlation = { ...fixture.promotionCorrelation, qualifiedCandidate }
  const candidateObservation = IntegratorGitObservation.cases.Commit.make({
    candidateText,
    commit: fixture.qualifiedCandidate.candidateCommit,
    directParents: fixture.qualifiedCandidate.directParents
  })
  return [
    record(
      1,
      WorkflowRunBeganEvent.make({
        initialControlPolicy: initialPolicy,
        initiatedBy: WorkflowActor.cases.DalphCoordinator.make({}),
        occurrenceClassification: "InitiatedAction",
        target: fixture.target,
        version: workflowJournalEventVersion
      }),
      fixture.runId
    ),
    record(
      2,
      PlannedAttemptExecutorWorkResponsibilityBeganEvent.make({
        plannedAttempt: fixture.plannedAttempt,
        version: workflowJournalEventVersion
      }),
      fixture.runId
    ),
    record(
      3,
      PlannedAttemptExecutorWorkReportedEvent.make({
        ordinal: PlannedAttemptExecutorReportOrdinal.make(1),
        report: PlannedAttemptExecutorReport.cases.Terminal.make({
          correlation: { attemptId: fixture.plannedAttempt.attemptId, runId: fixture.runId },
          result: { _tag: "Accepted", acceptedResult: fixture.qualifiedCandidate.run.session.acceptedResult }
        }),
        version: workflowJournalEventVersion
      }),
      fixture.runId
    ),
    record(
      4,
      IntegrationResponsibilityBeganEvent.make({
        acceptedResult: fixture.qualifiedCandidate.run.session.acceptedResult,
        integrationTarget: fixture.integrationTarget,
        plannedAttempt: fixture.plannedAttempt,
        version: workflowJournalEventVersion
      }),
      fixture.runId
    ),
    record(
      5,
      IntegrationStartedEvent.make({
        acceptedResult: fixture.qualifiedCandidate.run.session.acceptedResult,
        integrationTarget: fixture.integrationTarget,
        plannedAttempt: fixture.plannedAttempt,
        responsibilityBeganAt: JournalPosition.make(4),
        version: workflowJournalEventVersion
      }),
      fixture.runId
    ),
    record(
      6,
      GitReadIntentRecordedEvent.make({
        initiatedBy: WorkflowActor.cases.DalphCoordinator.make({}),
        occurrenceClassification: "InitiatedAction",
        operation: lineageOperation,
        version: workflowJournalEventVersion
      }),
      fixture.runId
    ),
    record(
      7,
      TargetLineageObservedEvent.make({
        observation: TargetLineageObservation.make({
          plannedBaseIsAncestorOfTargetHead: true,
          plannedBaseSha: fixture.plannedAttempt.baseSha,
          targetHeadSha: run.session.expectedTargetHead
        }),
        occurrenceClassification: "NonActionOccurrence",
        operationId: lineageOperation.operationId,
        plannedAttempt: fixture.plannedAttempt,
        version: workflowJournalEventVersion
      }),
      fixture.runId
    ),
    record(
      8,
      IntegratorSessionFixedEvent.make({ correlation: run.session, version: workflowJournalEventVersion }),
      fixture.runId
    ),
    record(9, IntegratorRunStartedEvent.make({ run, version: workflowJournalEventVersion }), fixture.runId),
    record(
      10,
      IntegratorRunResultRecordedEvent.make({
        result: IntegratorResult.cases.PreparedCandidate.make({ candidateText, correlation: run.session }),
        run,
        version: workflowJournalEventVersion
      }),
      fixture.runId
    ),
    record(
      11,
      IntegratorRunCandidateGitReadIntendedEvent.make({ candidateText, run, version: workflowJournalEventVersion }),
      fixture.runId
    ),
    record(
      12,
      IntegratorRunCandidateGitObservedEvent.make({
        candidateText,
        observation: candidateObservation,
        run,
        version: workflowJournalEventVersion
      }),
      fixture.runId
    ),
    record(13, TargetPromotionIntendedEvent.make({ correlation, version: workflowJournalEventVersion }), fixture.runId),
    record(
      14,
      TargetPromotionAttemptIntendedEvent.make({
        attemptOrdinal: TargetPromotionAttemptOrdinal.make(1),
        correlation,
        reason: { _tag: "Initial", observedHeadSha: run.session.expectedTargetHead },
        version: workflowJournalEventVersion
      }),
      fixture.runId
    ),
    record(
      15,
      TargetPromotionObservedSuccessEvent.make({
        basis: { _tag: "AfterAttempt", attemptOrdinal: TargetPromotionAttemptOrdinal.make(1) },
        correlation,
        observation: TargetPromotionSuccessObservation.cases.CompareAndSetApplied.make({
          candidateAncestry: "Current",
          targetHeadSha: correlation.qualifiedCandidate.candidateCommit
        }),
        version: workflowJournalEventVersion
      }),
      fixture.runId
    )
  ]
}

const quarantineRecords = (): ReadonlyArray<JournalRecord> => {
  const prefix = integrationRecords().slice(0, 9)
  const startedRecord = Option.getOrThrow(
    Option.fromUndefinedOr(prefix.find(({ event }) => event._tag === "IntegratorRunStarted"))
  )
  const started = Option.getOrThrow(
    startedRecord.event._tag === "IntegratorRunStarted" ? Option.some(startedRecord.event) : Option.none()
  )
  const detail = IntegrationQuarantineFailureDetail.make("provider-owned activity was proved absent")
  const quarantineAt = JournalPosition.make(11)
  const absence = IntegrationProviderRunActivityAbsentEvent.make({
    correlation: started.run.session,
    detail,
    occurrenceClassification: "NonActionOccurrence",
    run: started.run,
    version: workflowJournalEventVersion
  })
  const quarantine = IntegrationQuarantinedEvent.make({
    basis: { _tag: "ProviderRunFailure", detail, ownedActivityProvenAbsentAt: JournalPosition.make(10) },
    correlation: started.run.session,
    occurrenceClassification: "NonActionOccurrence",
    version: workflowJournalEventVersion
  })
  const fingerprint = IntegrationQuarantineDirectionFingerprint.make({
    direction: "Retry",
    quarantineAt,
    sessionId: started.run.session.sessionId
  })
  const direction = IntegrationQuarantineDirectionAppliedEvent.make({
    fingerprint,
    initiatedBy: WorkflowActor.cases.Operator.make({}),
    occurrenceClassification: "InitiatedAction",
    requestId: IntegrationQuarantineDirectionRequestId.make({
      nonce: "historical-quarantine-direction",
      runId: integrationFinalityFixture.runId
    }),
    version: workflowJournalEventVersion
  })
  return [
    ...prefix,
    record(10, absence, integrationFinalityFixture.runId),
    record(11, quarantine, integrationFinalityFixture.runId),
    record(12, direction, integrationFinalityFixture.runId)
  ]
}

const promotionCorrelationFrom = (
  records: ReadonlyArray<JournalRecord>
): Extract<JournalRecord["event"], { readonly _tag: "TargetPromotionIntended" }>["correlation"] => {
  const promotion = records.find(({ event }) => event._tag === "TargetPromotionIntended")?.event
  return Option.getOrThrow(
    Option.fromUndefinedOr(promotion?._tag === "TargetPromotionIntended" ? promotion.correlation : undefined)
  )
}

const stalePromotionRecords = (): ReadonlyArray<JournalRecord> => {
  const prefix = integrationRecords().slice(0, 14)
  const correlation = promotionCorrelationFrom(prefix)
  return [
    ...prefix,
    record(
      15,
      TargetPromotionStaleEvent.make({
        basis: { _tag: "AfterAttempt", attemptOrdinal: TargetPromotionAttemptOrdinal.make(1) },
        correlation,
        observation: { _tag: "CompareAndSetRejected", observedHeadSha: GitCommitSha.make("4".repeat(40)) },
        version: workflowJournalEventVersion
      }),
      correlation.qualifiedCandidate.run.session.plannedAttempt.runId
    )
  ]
}

const nonConvergentPromotionRecords = (): ReadonlyArray<JournalRecord> => {
  const prefix = integrationRecords().slice(0, 13)
  const correlation = promotionCorrelationFrom(prefix)
  const runId = correlation.qualifiedCandidate.run.session.plannedAttempt.runId
  const attempts = [1, 2, 3].map((ordinal) =>
    record(
      13 + ordinal,
      TargetPromotionAttemptIntendedEvent.make({
        attemptOrdinal: TargetPromotionAttemptOrdinal.make(ordinal),
        correlation,
        reason:
          ordinal === 1
            ? { _tag: "Initial", observedHeadSha: correlation.qualifiedCandidate.run.session.expectedTargetHead }
            : {
                _tag: "ReconciledExpectedHead",
                observedHeadSha: correlation.qualifiedCandidate.run.session.expectedTargetHead,
                previousAttemptOrdinal: TargetPromotionAttemptOrdinal.make(ordinal - 1)
              },
        version: workflowJournalEventVersion
      }),
      runId
    )
  )
  return [
    ...prefix,
    ...attempts,
    record(
      17,
      TargetPromotionNonConvergenceEvent.make({
        attemptLimit: TargetPromotionAttemptLimit.make(3),
        attemptOrdinal: TargetPromotionAttemptOrdinal.make(3),
        correlation,
        lastObservation: {
          _tag: "ExpectedHeadStillObserved",
          observedHeadSha: correlation.qualifiedCandidate.run.session.expectedTargetHead
        },
        version: workflowJournalEventVersion
      }),
      runId
    )
  ]
}

const finalityRecords = (): ReadonlyArray<JournalRecord> => {
  const fixture = integrationFinalityFixture
  const runId = fixture.runId
  const integrationPrefix = integrationRecords()
  const promotionCorrelation = promotionCorrelationFrom(integrationPrefix)
  const claim = CompletionTaskClaim.make({
    originalClaim: fixture.claim.originalClaim,
    plannedAttempt: fixture.claim.plannedAttempt,
    promotionCorrelation
  })
  const completionRequest = completionTaskRequestFor(claim)
  const authorizationPurpose = CompletionTaskFocusedReadPurpose.cases.Authorization.make({
    attemptOrdinal: CompletionTaskRequestOrdinal.make(1),
    authorizationOrdinal: CompletionTaskAuthorizationReadOrdinal.make(1)
  })
  const authorizationOperation = makeCompletionTaskFactsObservationOperation(
    completionRequest,
    fixture.target,
    authorizationPurpose
  )
  const authorizationFacts = FocusedTaskCompletionFacts.make({
    ...fixture.focusedSuccessFactsEvent.observation.facts,
    currentClaim: claim,
    lifecycle: "Open",
    operationId: authorizationOperation.operationId
  })
  const authorizationObservation = makeFocusedTaskCompletionFactsObserved(authorizationOperation, authorizationFacts)
  const authorizationReadIntentEvent = taskTrackerReadIntent(authorizationOperation)
  const authorizationFactsEvent = taskTrackerFactsObservedEvent(
    authorizationOperation.operationId,
    authorizationObservation
  )
  const gitReadOperationId = completionTaskCandidateAncestryReadOperationIdFor(completionRequest, authorizationPurpose)
  const confirmationPurpose = CompletionTaskFocusedReadPurpose.cases.Confirmation.make({
    attemptOrdinal: CompletionTaskRequestOrdinal.make(1),
    confirmationOrdinal: CompletionTaskConfirmationReadOrdinal.make(1)
  })
  const confirmationOperation = makeCompletionTaskFactsObservationOperation(
    completionRequest,
    fixture.target,
    confirmationPurpose
  )
  const confirmationFacts = FocusedTaskCompletionFacts.make({
    ...fixture.focusedSuccessFactsEvent.observation.facts,
    currentClaim: claim,
    operationId: confirmationOperation.operationId
  })
  const confirmationObservation = makeFocusedTaskCompletionFactsObserved(confirmationOperation, confirmationFacts)
  const confirmationReadIntentEvent = taskTrackerReadIntent(confirmationOperation)
  const confirmationFactsEvent = taskTrackerFactsObservedEvent(
    confirmationOperation.operationId,
    confirmationObservation
  )
  const replacementOperationId = OperationId.make("historical-81-82-finality-replacement")
  const deletionOperationId = OperationId.make("historical-81-82-finality-deletion")
  const claimOperation = makeTaskClaimAcquisitionOperation({
    acquisition: {
      operationId: fixture.activeClaim.operationId,
      owner: fixture.activeClaim.owner,
      taskId: fixture.activeClaim.taskId,
      token: fixture.activeClaim.token
    },
    predecessorOperationIds: []
  })
  const successObservation = {
    ...fixture.successObservation,
    claim,
    observedAt: JournalPosition.make(30),
    operationId: confirmationOperation.operationId
  }
  return [
    ...integrationPrefix,
    record(
      16,
      TaskClaimAcquisitionIntendedEvent.make({ operation: claimOperation, version: workflowJournalEventVersion }),
      runId
    ),
    record(
      17,
      TaskClaimAcquiredEvent.make({ claim: fixture.activeClaim, version: workflowJournalEventVersion }),
      runId
    ),
    record(
      18,
      TaskAttemptPlannedEvent.make({ operation: fixture.planOperation, version: workflowJournalEventVersion }),
      runId
    ),
    record(
      19,
      CompletionClaimReplacementIntendedEvent.make({
        claim,
        operationId: replacementOperationId,
        version: workflowJournalEventVersion
      }),
      runId
    ),
    record(
      20,
      CompletionClaimReplacementAttemptIntendedEvent.make({
        attemptOrdinal: CompletionClaimRequestOrdinal.make(1),
        claim,
        operationId: replacementOperationId,
        version: workflowJournalEventVersion
      }),
      runId
    ),
    record(
      21,
      CompletionClaimReplacedEvent.make({
        claim,
        operationId: replacementOperationId,
        version: workflowJournalEventVersion
      }),
      runId
    ),
    record(22, authorizationReadIntentEvent, runId),
    record(23, authorizationFactsEvent, runId),
    record(
      24,
      CompletionTaskCandidateAncestryReadIntendedEvent.make({
        attemptOrdinal: CompletionTaskRequestOrdinal.make(1),
        operationId: gitReadOperationId,
        request: completionRequest,
        version: workflowJournalEventVersion
      }),
      runId
    ),
    record(
      25,
      CompletionTaskCandidateAncestryObservedEvent.make({
        attemptOrdinal: CompletionTaskRequestOrdinal.make(1),
        observation: {
          _tag: "CandidateCurrent",
          currentHeadSha: claim.promotionCorrelation.qualifiedCandidate.candidateCommit
        },
        operationId: gitReadOperationId,
        request: completionRequest,
        version: workflowJournalEventVersion
      }),
      runId
    ),
    record(
      26,
      CompletionTaskIntendedEvent.make({ request: completionRequest, version: workflowJournalEventVersion }),
      runId
    ),
    record(
      27,
      CompletionTaskAttemptIntendedEvent.make({
        attemptOrdinal: CompletionTaskRequestOrdinal.make(1),
        focusedFactsOperationId: authorizationOperation.operationId,
        gitReadOperationId,
        request: completionRequest,
        version: workflowJournalEventVersion
      }),
      runId
    ),
    record(
      28,
      CompletionTaskAcknowledgedEvent.make({
        acknowledgement: { operationId: completionRequest.operationId, taskId: fixture.taskId },
        attemptOrdinal: CompletionTaskRequestOrdinal.make(1),
        request: completionRequest,
        version: workflowJournalEventVersion
      }),
      runId
    ),
    record(29, confirmationReadIntentEvent, runId),
    record(30, confirmationFactsEvent, runId),
    record(
      31,
      CompletionClaimDeletionIntendedEvent.make({
        claim,
        operationId: deletionOperationId,
        successObservation,
        version: workflowJournalEventVersion
      }),
      runId
    ),
    record(
      32,
      CompletionClaimDeletionAttemptIntendedEvent.make({
        attemptOrdinal: CompletionClaimRequestOrdinal.make(1),
        claim,
        operationId: deletionOperationId,
        successObservation,
        version: workflowJournalEventVersion
      }),
      runId
    ),
    record(
      33,
      CompletionClaimDeletedEvent.make({
        claim,
        operationId: deletionOperationId,
        successObservation,
        version: workflowJournalEventVersion
      }),
      runId
    ),
    record(
      34,
      IntegrationFinalitySettledEvent.make({
        claim,
        deletionOperationId,
        replacementOperationId,
        successObservation,
        version: workflowJournalEventVersion
      }),
      runId
    ),
    record(35, taskTrackerReadIntent(fixture.graphOperation), runId),
    record(36, fixture.graphRecordEvent, runId)
  ]
}

const responsibilityOrderRecords = (): ReadonlyArray<JournalRecord> => {
  const fixture = integrationFinalityFixture
  const otherTarget = IntegrationTarget.make({
    ref: IntegrationTargetRef.make("refs/heads/other-target"),
    repository: fixture.integrationTarget.repository
  })
  return [
    ...integrationRecords(),
    record(
      16,
      IntegrationResponsibilityBeganEvent.make({
        acceptedResult: fixture.qualifiedCandidate.run.session.acceptedResult,
        integrationTarget: fixture.integrationTarget,
        plannedAttempt: fixture.plannedAttempt,
        version: workflowJournalEventVersion
      }),
      fixture.runId
    ),
    record(
      17,
      IntegrationResponsibilityBeganEvent.make({
        acceptedResult: fixture.qualifiedCandidate.run.session.acceptedResult,
        integrationTarget: otherTarget,
        plannedAttempt: fixture.plannedAttempt,
        version: workflowJournalEventVersion
      }),
      fixture.runId
    )
  ]
}

const nodeFileSystemAndPath = Layer.merge(NodeFileSystem.layer, NodePath.layer)

const appendRecordsToStore = Effect.fn("TraceReaderHistorical81And82.appendRecordsToStore")(function* (
  journal: JournalStore["Service"],
  records: ReadonlyArray<JournalRecord>
) {
  const beginning = records[0]
  if (beginning === undefined || beginning.event._tag !== "WorkflowRunBegan") {
    return yield* Effect.die("historical fixture must begin with WorkflowRunBegan")
  }
  yield* journal.beginRun(beginning.runId, beginning.event.target, beginning.event.initialControlPolicy)
  for (const item of records.slice(1)) {
    if (item.event._tag === "WorkflowRunBegan" || item.event._tag === "WorkflowRunTerminated") {
      return yield* Effect.die("historical fixture contains an unexpected lifecycle event")
    }
    yield* journal.append(item.runId, item.key, item.event)
  }
})

it.effect("#81 projects durable intents as observation gaps and retains exact unfinished responsibility", () =>
  Effect.gen(function* () {
    const view = yield* makeTraceReader({ read: () => Effect.succeed(recoveryRecords()) }).readAt(
      TraceCursor.make({ position: JournalPosition.make(4), runId })
    )
    const gaps = view.facets.recovery.observationGaps
    vitestExpect(gaps.map(({ _tag }) => _tag)).toEqual(
      vitestExpect.arrayContaining(["TrackerObservation", "ExecutorReport"])
    )
    vitestExpect(view.facets.recovery.retainedResponsibilities.map(({ _tag }) => _tag)).toEqual(
      vitestExpect.arrayContaining(["TaskAttempt", "ExecutorWork"])
    )
    vitestExpect(view.items.map(({ occurrence }) => String(occurrence._tag))).not.toContain("CoordinatorCrashed")
    vitestExpect(Schema.is(TraceAtCursor)(view)).toBe(true)
  })
)

it.effect(
  "#81 reopens the same recovery explanation and trace identities without a crash occurrence or replacement attempt in memory and SQLite",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const records = recoveryRecords()
        const cursor = TraceCursor.make({ position: JournalPosition.make(4), runId })
        const memory = yield* Effect.scoped(
          Effect.gen(function* () {
            const journal = yield* JournalStore
            yield* appendRecordsToStore(journal, records)
            const read = (requestedRunId: RunId) => journal.read(requestedRunId)
            const first = yield* makeTraceReader({ read }).readAt(cursor)
            const reopened = yield* makeTraceReader({ read }).readAt(cursor)
            return { first, reopened }
          }).pipe(Effect.provide(memoryJournalStoreLayer))
        )
        vitestExpect(memory.reopened).toEqual(memory.first)
        vitestExpect(memory.reopened.facets.recovery).toEqual(memory.first.facets.recovery)
        vitestExpect(memory.reopened.items.map(({ identity }) => identity)).toEqual(
          memory.first.items.map(({ identity }) => identity)
        )

        const fileSystem = yield* FileSystem.FileSystem
        const path = yield* Path.Path
        const directory = yield* fileSystem.makeTempDirectoryScoped({ prefix: "dalph-trace-historical-81-82-" })
        const filename = JournalDatabaseLocator.make(path.join(directory, "journal.sqlite"))
        const sqliteLayer = sqliteJournalStoreLayer({ filename })
        const firstSqlite = yield* Effect.scoped(
          Effect.gen(function* () {
            const journal = yield* JournalStore
            yield* appendRecordsToStore(journal, records)
            return yield* makeTraceReader({ read: journal.read }).readAt(cursor)
          }).pipe(Effect.provide(sqliteLayer))
        )
        const reopenedSqlite = yield* Effect.scoped(
          Effect.gen(function* () {
            const journal = yield* JournalStore
            return yield* makeTraceReader({ read: journal.read }).readAt(cursor)
          }).pipe(Effect.provide(sqliteLayer))
        )
        vitestExpect(reopenedSqlite).toEqual(firstSqlite)
        vitestExpect(reopenedSqlite.facets.recovery.observationGaps).toEqual(
          firstSqlite.facets.recovery.observationGaps
        )
        vitestExpect(reopenedSqlite.items.map(({ identity }) => identity)).toEqual(
          firstSqlite.items.map(({ identity }) => identity)
        )
        const reopenedTags = reopenedSqlite.items.map(({ occurrence }) => String(occurrence._tag))
        vitestExpect(reopenedTags).not.toContain("CoordinatorCrashed")
        vitestExpect(reopenedTags).not.toContain("PlannedAttemptReplaced")
        const gap = reopenedSqlite.facets.recovery.observationGaps.find(({ _tag }) => _tag === "ExecutorReport")
        if (gap?._tag !== "ExecutorReport") return yield* Effect.die("executor gap was not retained across restart")
        vitestExpect(gap.action).toEqual({ runId, position: JournalPosition.make(4) })
        vitestExpect(gap.attemptId).toBe(plannedAttempt.attemptId)
      }).pipe(Effect.provide(nodeFileSystemAndPath))
    )
)

it.effect(
  "#81 distinguishes worktree loss task-authority conflict and replacement wait without a generic archive state",
  () =>
    Effect.gen(function* () {
      const records = preservationRecords()
      const view = yield* makeTraceReader({ read: () => Effect.succeed(records) }).readAt(
        TraceCursor.make({ position: JournalPosition.make(8), runId })
      )
      const dispositions = view.facets.recovery.preservationDispositions
      vitestExpect(dispositions.map(({ _tag }) => _tag)).toEqual([
        "WorktreeLost",
        "ReplacementPending",
        "TaskAuthorityConflict"
      ])
      vitestExpect(dispositions.map(({ _tag }) => String(_tag))).not.toContain("Archive")
      for (const disposition of dispositions) {
        vitestExpect(disposition.source.runId).toBe(runId)
      }
      const worktreeLoss = dispositions.find(({ _tag }) => _tag === "WorktreeLost")
      if (worktreeLoss?._tag !== "WorktreeLost") return yield* Effect.die("worktree-loss disposition missing")
      vitestExpect(worktreeLoss.plannedAttempt.taskId).toBe(plannedAttempt.taskId)
      const taskConflict = dispositions.find(({ _tag }) => _tag === "TaskAuthorityConflict")
      if (taskConflict?._tag !== "TaskAuthorityConflict") return yield* Effect.die("task-authority disposition missing")
      vitestExpect(taskConflict.subject.plannedAttempt.taskId).toBe(plannedAttempt.taskId)
      const replacementWait = dispositions.find(({ _tag }) => _tag === "ReplacementPending")
      if (replacementWait?._tag !== "ReplacementPending") return yield* Effect.die("replacement disposition missing")
      vitestExpect(replacementWait.choice.plannedAttempt.taskId).toBe(plannedAttempt.taskId)
      const independent = view.facets.recovery.retainedResponsibilities.find(
        (responsibility) =>
          responsibility._tag === "TaskAttempt" && responsibility.plannedAttempt.taskId === independentAttempt.taskId
      )
      if (independent?._tag !== "TaskAttempt") return yield* Effect.die("independent task was not retained")
      vitestExpect(independent.source).toEqual({ runId, position: JournalPosition.make(8) })
      vitestExpect(
        dispositions.every(
          (disposition) =>
            disposition._tag !== "WorktreeLost" || disposition.plannedAttempt.taskId !== independentAttempt.taskId
        )
      ).toBe(true)
    })
)

it.effect("#82 projects one shared ordered integration envelope and rejects a result without its intent", () =>
  Effect.gen(function* () {
    const records = integrationRecords()
    const reader = makeTraceReader({ read: () => Effect.succeed(records) })
    const firstRecord = records[0]
    if (firstRecord === undefined) return yield* Effect.die("integration fixture is empty")
    const view = yield* reader.readAt(
      TraceCursor.make({ position: JournalPosition.make(15), runId: firstRecord.runId })
    )
    const tags = view.facets.integration.facts.map(({ _tag }) => _tag)
    vitestExpect(tags).toEqual(
      vitestExpect.arrayContaining([
        "Responsibility",
        "SessionStarted",
        "Session",
        "IntegratorResult",
        "CandidateObserved",
        "CandidateQualification",
        "PromotionRequested",
        "PromotionAttempt",
        "PromotionSucceeded"
      ])
    )
    vitestExpect(view.facets.integration.facts.map(({ source }) => Number(source.position))).toEqual(
      [...view.facets.integration.facts.map(({ source }) => Number(source.position))].sort(
        (left, right) => left - right
      )
    )

    const runResultRecord = records.find(({ position }) => position === JournalPosition.make(10))
    if (runResultRecord === undefined) return yield* Effect.die("integration fixture missing run result")
    const malformed = records.map((item) =>
      item.position === JournalPosition.make(9) ? withEvent(item, runResultRecord.event) : item
    )
    const failure = yield* Effect.flip(
      makeTraceReader({ read: () => Effect.succeed(malformed) }).read(firstRecord.runId)
    )
    vitestExpect(failure).toBeInstanceOf(TraceProjectionInvalid)
  })
)

it.effect(
  "#82 reopens the same unfinished Integrator session explanation without a successor or fabricated crash occurrence in memory and SQLite",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const records = integrationRecords().slice(0, 9)
        const beginning = records[0]
        if (beginning === undefined) return yield* Effect.die("unfinished Integrator fixture is empty")
        const cursor = TraceCursor.make({ position: JournalPosition.make(9), runId: beginning.runId })
        const memory = yield* Effect.scoped(
          Effect.gen(function* () {
            const journal = yield* JournalStore
            yield* appendRecordsToStore(journal, records)
            const read = (requestedRunId: RunId) => journal.read(requestedRunId)
            const first = yield* makeTraceReader({ read }).readAt(cursor)
            const reopened = yield* makeTraceReader({ read }).readAt(cursor)
            return { first, reopened }
          }).pipe(Effect.provide(memoryJournalStoreLayer))
        )
        vitestExpect(memory.reopened).toEqual(memory.first)
        const memoryGap = memory.reopened.facets.recovery.observationGaps.find(
          ({ _tag }) => _tag === "IntegratorResult"
        )
        if (memoryGap?._tag !== "IntegratorResult") return yield* Effect.die("memory Integrator result gap missing")
        vitestExpect(memoryGap.action).toEqual({ runId: beginning.runId, position: JournalPosition.make(9) })
        vitestExpect(memoryGap.run.session.sessionId).toBe("integration-finality-session")

        const fileSystem = yield* FileSystem.FileSystem
        const path = yield* Path.Path
        const directory = yield* fileSystem.makeTempDirectoryScoped({ prefix: "dalph-trace-integrator-81-82-" })
        const filename = JournalDatabaseLocator.make(path.join(directory, "journal.sqlite"))
        const sqliteLayer = sqliteJournalStoreLayer({ filename })
        const firstSqlite = yield* Effect.scoped(
          Effect.gen(function* () {
            const journal = yield* JournalStore
            yield* appendRecordsToStore(journal, records)
            return yield* makeTraceReader({ read: journal.read }).readAt(cursor)
          }).pipe(Effect.provide(sqliteLayer))
        )
        const reopenedSqlite = yield* Effect.scoped(
          Effect.gen(function* () {
            const journal = yield* JournalStore
            return yield* makeTraceReader({ read: journal.read }).readAt(cursor)
          }).pipe(Effect.provide(sqliteLayer))
        )
        vitestExpect(reopenedSqlite).toEqual(firstSqlite)
        vitestExpect(reopenedSqlite.facets.recovery.observationGaps).toEqual(
          firstSqlite.facets.recovery.observationGaps
        )
        vitestExpect(
          reopenedSqlite.items.some(({ occurrence }) => occurrence._tag === "IntegratorSuccessorSessionFixed")
        ).toBe(false)
        vitestExpect(reopenedSqlite.items.map(({ occurrence }) => String(occurrence._tag))).not.toContain(
          "CoordinatorCrashed"
        )
        const session = reopenedSqlite.facets.integration.facts.find(({ _tag }) => _tag === "Session")
        if (session?._tag !== "Session") return yield* Effect.die("fixed Integrator session was not retained")
        vitestExpect(session.correlation.sessionId).toBe("integration-finality-session")
        vitestExpect(session.source).toEqual({ runId: beginning.runId, position: JournalPosition.make(8) })
      }).pipe(Effect.provide(nodeFileSystemAndPath))
    )
)

it.effect(
  "#82 shows the promotion-through-finality cursor matrix for pending-read success stale non-convergence completion cleanup settlement and dependant release",
  () =>
    Effect.gen(function* () {
      const promotionCases = [
        { records: integrationRecords(), terminal: "Succeeded" as const, terminalPosition: 15 },
        { records: stalePromotionRecords(), terminal: "Stale" as const, terminalPosition: 15 },
        { records: nonConvergentPromotionRecords(), terminal: "NonConvergent" as const, terminalPosition: 17 }
      ]
      for (const promotionCase of promotionCases) {
        const first = promotionCase.records[0]
        if (first === undefined) return yield* Effect.die("promotion matrix fixture is empty")
        const reader = makeTraceReader({ read: () => Effect.succeed(promotionCase.records) })
        for (let position = 1; position <= promotionCase.records.length; position += 1) {
          const view = yield* reader.readAt(
            TraceCursor.make({ position: JournalPosition.make(position), runId: first.runId })
          )
          vitestExpect(view.facets.integration.facts.every(({ source }) => source.position <= position)).toBe(true)
          if (position === 14) {
            vitestExpect(view.facets.recovery.observationGaps.map(({ _tag }) => _tag)).toContain("PromotionResult")
          }
          if (position < 12) {
            vitestExpect(view.facets.integration.facts.some(({ _tag }) => _tag === "CandidateQualification")).toBe(
              false
            )
          }
          if (position >= promotionCase.terminalPosition) {
            const terminal = view.facets.integration.facts.find((fact) =>
              promotionCase.terminal === "Succeeded"
                ? fact._tag === "PromotionSucceeded"
                : promotionCase.terminal === "Stale"
                  ? fact._tag === "PromotionStale"
                  : fact._tag === "PromotionNonConvergent"
            )
            if (
              terminal === undefined ||
              (terminal._tag !== "PromotionSucceeded" &&
                terminal._tag !== "PromotionStale" &&
                terminal._tag !== "PromotionNonConvergent")
            )
              return yield* Effect.die("promotion terminal fact missing")
            vitestExpect(terminal.source.position).toBe(promotionCase.terminalPosition)
          }
        }
      }

      const finality = finalityRecords()
      const finalityReader = makeTraceReader({ read: () => Effect.succeed(finality) })
      for (const position of [15, 16, 18, 19, 22, 23, 26, 27, 29, 30, 31, 32, 33, 34, 35, 36]) {
        const view = yield* finalityReader.readAt(
          TraceCursor.make({ position: JournalPosition.make(position), runId: integrationFinalityFixture.runId })
        )
        vitestExpect(view.items.every(({ identity }) => identity.position <= position)).toBe(true)
        vitestExpect(view.facets.integration.facts.every(({ source }) => source.position <= position)).toBe(true)
      }
      const settled = yield* finalityReader.readAt(
        TraceCursor.make({ position: JournalPosition.make(34), runId: integrationFinalityFixture.runId })
      )
      vitestExpect(
        settled.facets.recovery.retainedResponsibilities.some(
          ({ _tag }) => _tag === "TaskAttempt" || _tag === "ExecutorWork" || _tag === "TaskClaim"
        )
      ).toBe(false)
      const finalityTags = settled.facets.integration.facts.flatMap((fact) =>
        fact._tag === "FocusedCompletion" ||
        fact._tag === "ClaimReplacement" ||
        fact._tag === "ClaimDeletion" ||
        fact._tag === "Settlement"
          ? [fact.event._tag]
          : []
      )
      vitestExpect(finalityTags).toEqual(
        vitestExpect.arrayContaining([
          "CompletionClaimReplacementIntended",
          "CompletionClaimReplacementAttemptIntended",
          "CompletionClaimReplaced",
          "CompletionTaskIntended",
          "CompletionTaskAttemptIntended",
          "CompletionTaskAcknowledged",
          "CompletionClaimDeletionIntended",
          "CompletionClaimDeletionAttemptIntended",
          "CompletionClaimDeleted",
          "IntegrationFinalitySettled"
        ])
      )
      const matrixPromotion = settled.facets.integration.facts.filter(
        (fact) =>
          fact._tag === "PromotionAttempt" ||
          fact._tag === "PromotionSucceeded" ||
          fact._tag === "PromotionStale" ||
          fact._tag === "PromotionNonConvergent"
      )
      vitestExpect(matrixPromotion.map((fact) => String(fact._tag))).not.toContain("Archive")
      vitestExpect(settled.items.map(({ occurrence }) => String(occurrence._tag))).not.toContain("CoordinatorCrashed")

      const orderView = yield* makeTraceReader({ read: () => Effect.succeed(responsibilityOrderRecords()) }).readAt(
        TraceCursor.make({ position: JournalPosition.make(17), runId: integrationFinalityFixture.runId })
      )
      const responsibilities = orderView.facets.integration.facts.filter((fact) => fact._tag === "Responsibility")
      if (responsibilities.length !== 3) return yield* Effect.die("responsibility order fixture is incomplete")
      const firstResponsibility = responsibilities[0]
      const secondResponsibility = responsibilities[1]
      const independentResponsibility = responsibilities[2]
      if (
        firstResponsibility?._tag !== "Responsibility" ||
        secondResponsibility?._tag !== "Responsibility" ||
        independentResponsibility?._tag !== "Responsibility"
      ) {
        return yield* Effect.die("responsibility order facts are not typed")
      }
      vitestExpect(firstResponsibility.sameTargetPredecessor).toBeNull()
      vitestExpect(secondResponsibility.sameTargetPredecessor?.position).toBe(JournalPosition.make(4))
      vitestExpect(independentResponsibility.sameTargetPredecessor).toBeNull()
      vitestExpect(secondResponsibility.target.ref).toBe(firstResponsibility.target.ref)
      vitestExpect(independentResponsibility.target.ref).not.toBe(firstResponsibility.target.ref)
    })
)

it.effect("#81/#82 reject invalid historical relationship tables and property mutations without a partial facet", () =>
  Effect.gen(function* () {
    const records = finalityRecords()
    const view = yield* makeTraceReader({ read: () => Effect.succeed(records) }).readAt(
      TraceCursor.make({ position: JournalPosition.make(36), runId: integrationFinalityFixture.runId })
    )
    const sessionStarted = view.facets.integration.facts.find(({ _tag }) => _tag === "SessionStarted")
    const responsibility = view.facets.integration.facts.find(({ _tag }) => _tag === "Responsibility")
    const candidateQualification = view.facets.integration.facts.find(({ _tag }) => _tag === "CandidateQualification")
    const integratorResult = view.facets.integration.facts.find(({ _tag }) => _tag === "IntegratorResult")
    const promotion = view.facets.integration.facts.find((fact) => fact._tag === "PromotionSucceeded")
    const completion = view.facets.integration.facts.find(({ _tag }) => _tag === "FocusedCompletion")
    const settlement = view.facets.integration.facts.find(({ _tag }) => _tag === "Settlement")
    const dependantRelease = view.facets.integration.facts.find(({ _tag }) => _tag === "DependantRelease")
    const plannedAttemptItem = view.items.find(({ occurrence }) => occurrence._tag === "TaskAttemptPlanned")
    const beginning = view.items[0]
    if (
      sessionStarted?._tag !== "SessionStarted" ||
      responsibility?._tag !== "Responsibility" ||
      candidateQualification?._tag !== "CandidateQualification" ||
      integratorResult?._tag !== "IntegratorResult" ||
      promotion?._tag !== "PromotionSucceeded" ||
      completion?._tag !== "FocusedCompletion" ||
      settlement?._tag !== "Settlement" ||
      dependantRelease?._tag !== "DependantRelease" ||
      plannedAttemptItem?.occurrence._tag !== "TaskAttemptPlanned" ||
      beginning === undefined
    ) {
      return yield* Effect.die("invalid-history fixture did not produce every integration fact")
    }
    vitestExpect(dependantRelease.graphSource).toEqual({
      runId: integrationFinalityFixture.runId,
      position: JournalPosition.make(36)
    })
    vitestExpect(dependantRelease.settlementSource).toEqual({
      runId: integrationFinalityFixture.runId,
      position: JournalPosition.make(34)
    })
    vitestExpect(dependantRelease.graphObservation).toEqual(integrationFinalityFixture.graphObservation)
    vitestExpect(dependantRelease.settlement).toEqual(
      records.find(({ position }) => position === JournalPosition.make(34))?.event
    )
    const graphRecord = records.find(({ position }) => position === JournalPosition.make(36))
    if (graphRecord?.event._tag !== "TaskTrackerFactsObserved") {
      return yield* Effect.die("dependant-release graph fixture is incomplete")
    }
    const noDependantRelease = (candidate: ReadonlyArray<JournalRecord>) =>
      makeTraceReader({ read: () => Effect.succeed(candidate) }).readAt(
        TraceCursor.make({ position: JournalPosition.make(36), runId: integrationFinalityFixture.runId })
      )
    const reopenedProjection = projectTrackerSnapshot({
      revision: "historical-reopened-revision",
      tasks: [
        {
          id: integrationFinalityFixture.taskId,
          lifecycle: { _tag: "Open" as const },
          parentTaskId: null,
          prerequisiteIds: []
        }
      ]
    })
    if (reopenedProjection._tag !== "Valid") return yield* Effect.die("reopened graph fixture is invalid")
    const reopened = yield* noDependantRelease(
      records.map((item) =>
        item.position === JournalPosition.make(36)
          ? withEvent(
              item,
              taskTrackerFactsObservedEvent(
                integrationFinalityFixture.graphOperation.operationId,
                makeCompleteTaskTrackerFactsObserved(
                  integrationFinalityFixture.graphOperation,
                  reopenedProjection.snapshot
                )
              )
            )
          : item
      )
    )
    vitestExpect(reopened.facets.integration.facts.some(({ _tag }) => _tag === "DependantRelease")).toBe(false)

    const blockedTaskId = TaskId.make("historical-dependant-blocker")
    const blockedTargetOperation = makeTrackerGraphObservationOperation(
      OperationId.make("historical-dependant-blocked-graph"),
      integrationFinalityFixture.target,
      [],
      [integrationFinalityFixture.taskId, blockedTaskId]
    )
    const blockedProjection = projectTrackerSnapshot({
      revision: "historical-blocked-revision",
      tasks: [
        {
          id: integrationFinalityFixture.taskId,
          lifecycle: { _tag: "Open" as const },
          parentTaskId: null,
          prerequisiteIds: [blockedTaskId]
        },
        { id: blockedTaskId, lifecycle: { _tag: "Open" as const }, parentTaskId: null, prerequisiteIds: [] }
      ]
    })
    if (blockedProjection._tag !== "Valid") return yield* Effect.die("blocked graph fixture is invalid")
    const blocked = yield* noDependantRelease(
      records.map((item) =>
        item.position === JournalPosition.make(35)
          ? withEvent(item, taskTrackerReadIntent(blockedTargetOperation))
          : item.position === JournalPosition.make(36)
            ? withEvent(
                item,
                taskTrackerFactsObservedEvent(
                  blockedTargetOperation.operationId,
                  makeCompleteTaskTrackerFactsObserved(blockedTargetOperation, blockedProjection.snapshot)
                )
              )
            : item
      )
    )
    vitestExpect(blocked.facets.integration.facts.some(({ _tag }) => _tag === "DependantRelease")).toBe(false)

    const inconsistentTarget = FixtureTarget.make("historical-inconsistent-target")
    const inconsistentOperation = makeTrackerGraphObservationOperation(
      OperationId.make("historical-dependant-inconsistent-graph"),
      inconsistentTarget,
      [],
      [integrationFinalityFixture.taskId]
    )
    const inconsistent = yield* noDependantRelease(
      records.map((item) =>
        item.position === JournalPosition.make(35)
          ? withEvent(item, taskTrackerReadIntent(inconsistentOperation))
          : item.position === JournalPosition.make(36)
            ? withEvent(
                item,
                taskTrackerFactsObservedEvent(
                  inconsistentOperation.operationId,
                  makeCompleteTaskTrackerFactsObserved(inconsistentOperation, integrationFinalityFixture.graphSnapshot)
                )
              )
            : item
      )
    )
    vitestExpect(inconsistent.facets.integration.facts.some(({ _tag }) => _tag === "DependantRelease")).toBe(false)
    const facts = view.facets.integration.facts
    const replace = (target: (typeof facts)[number], replacement: (typeof facts)[number]) =>
      facts.map((fact) => (fact === target ? replacement : fact))
    const invalidViews = [
      {
        ...view,
        facets: {
          ...view.facets,
          integration: { facts: replace(sessionStarted, { ...sessionStarted, responsibility: beginning.identity }) }
        }
      },
      {
        ...view,
        facets: {
          ...view.facets,
          integration: {
            facts: replace(responsibility, { ...responsibility, sameTargetPredecessor: sessionStarted.source })
          }
        }
      },
      {
        ...view,
        facets: {
          ...view.facets,
          integration: {
            facts: replace(candidateQualification, {
              ...candidateQualification,
              directParents: [GitCommitSha.make("9".repeat(40)), candidateQualification.directParents[1]]
            })
          }
        }
      },
      {
        ...view,
        facets: {
          ...view.facets,
          integration: {
            facts: replace(integratorResult, {
              ...integratorResult,
              run: {
                ...integratorResult.run,
                session: { ...integratorResult.run.session, expectedTargetHead: GitCommitSha.make("8".repeat(40)) }
              }
            })
          }
        }
      },
      {
        ...view,
        facets: {
          ...view.facets,
          integration: { facts: replace(promotion, { ...promotion, source: beginning.identity }) }
        }
      },
      {
        ...view,
        facets: {
          ...view.facets,
          integration: {
            facts: replace(completion, {
              ...completion,
              source: { ...completion.source, position: JournalPosition.make(1) }
            })
          }
        }
      },
      {
        ...view,
        facets: {
          ...view.facets,
          integration: {
            facts: replace(settlement, {
              ...settlement,
              event: { ...settlement.event, deletionOperationId: OperationId.make("foreign-settlement-deletion") }
            })
          }
        }
      },
      {
        ...view,
        facets: {
          ...view.facets,
          integration: { facts: replace(dependantRelease, { ...dependantRelease, graphSource: settlement.source }) }
        }
      },
      {
        ...view,
        facets: {
          ...view.facets,
          recovery: {
            ...view.facets.recovery,
            retainedResponsibilities: [
              {
                _tag: "TaskAttempt",
                plannedAttempt: plannedAttemptItem.occurrence.plannedAttempt,
                source: plannedAttemptItem.identity
              }
            ]
          }
        }
      }
    ]
    for (const invalid of invalidViews) {
      vitestExpect(() => Schema.decodeUnknownSync(TraceAtCursor)(invalid)).toThrow()
    }
  })
)

it.effect(
  "#81/#82 fail closed for every public recovery and integration facet variant when its source identity lies",
  () =>
    Effect.gen(function* () {
      const records = finalityRecords()
      const view = yield* makeTraceReader({ read: () => Effect.succeed(records) }).readAt(
        TraceCursor.make({ position: JournalPosition.make(36), runId: integrationFinalityFixture.runId })
      )
      const beginning = view.items[0]
      const accepted = view.facets.integration.facts.find(({ _tag }) => _tag === "AcceptedResult")
      const responsibility = view.facets.integration.facts.find(({ _tag }) => _tag === "Responsibility")
      const sessionStarted = view.facets.integration.facts.find(({ _tag }) => _tag === "SessionStarted")
      const session = view.facets.integration.facts.find(({ _tag }) => _tag === "Session")
      const integratorResult = view.facets.integration.facts.find(({ _tag }) => _tag === "IntegratorResult")
      const candidateObserved = view.facets.integration.facts.find(({ _tag }) => _tag === "CandidateObserved")
      const candidateQualification = view.facets.integration.facts.find(({ _tag }) => _tag === "CandidateQualification")
      const promotionRequested = view.facets.integration.facts.find(({ _tag }) => _tag === "PromotionRequested")
      const promotionAttempt = view.facets.integration.facts.find(({ _tag }) => _tag === "PromotionAttempt")
      const promotionSucceeded = view.facets.integration.facts.find(({ _tag }) => _tag === "PromotionSucceeded")
      const completion = view.facets.integration.facts.find(({ _tag }) => _tag === "FocusedCompletion")
      const claimReplacement = view.facets.integration.facts.find(({ _tag }) => _tag === "ClaimReplacement")
      const claimDeletion = view.facets.integration.facts.find(({ _tag }) => _tag === "ClaimDeletion")
      const settlement = view.facets.integration.facts.find(({ _tag }) => _tag === "Settlement")
      const dependantRelease = view.facets.integration.facts.find(({ _tag }) => _tag === "DependantRelease")
      const plannedAttemptItem = view.items.find(({ occurrence }) => occurrence._tag === "TaskAttemptPlanned")
      if (
        beginning === undefined ||
        accepted?._tag !== "AcceptedResult" ||
        responsibility?._tag !== "Responsibility" ||
        sessionStarted?._tag !== "SessionStarted" ||
        session?._tag !== "Session" ||
        integratorResult?._tag !== "IntegratorResult" ||
        candidateObserved?._tag !== "CandidateObserved" ||
        candidateQualification?._tag !== "CandidateQualification" ||
        promotionRequested?._tag !== "PromotionRequested" ||
        promotionAttempt?._tag !== "PromotionAttempt" ||
        promotionSucceeded?._tag !== "PromotionSucceeded" ||
        completion?._tag !== "FocusedCompletion" ||
        claimReplacement?._tag !== "ClaimReplacement" ||
        claimDeletion?._tag !== "ClaimDeletion" ||
        settlement?._tag !== "Settlement" ||
        dependantRelease?._tag !== "DependantRelease" ||
        plannedAttemptItem?.occurrence._tag !== "TaskAttemptPlanned"
      ) {
        return yield* Effect.die("facet-validation matrix fixture did not produce every required source")
      }

      const reject = (facets: typeof view.facets): void => {
        vitestExpect(() => Schema.decodeUnknownSync(TraceAtCursor)({ ...view, facets })).toThrow()
      }
      const recoveryWith = (recovery: typeof view.facets.recovery): void => reject({ ...view.facets, recovery })
      const factsWith = (facts: ReadonlyArray<TraceIntegrationFact>): void =>
        reject({ ...view.facets, integration: { facts } })

      const invalidGapAction = beginning.identity
      const candidateGap = TraceObservationGap.cases.CandidateQualification.make({
        action: invalidGapAction,
        candidateText: candidateQualification.candidateText,
        run: candidateQualification.run
      })
      const executorGap = TraceObservationGap.cases.ExecutorReport.make({
        action: invalidGapAction,
        attemptId: plannedAttemptItem.occurrence.plannedAttempt.attemptId
      })
      const integratorResultGap = TraceObservationGap.cases.IntegratorResult.make({
        action: invalidGapAction,
        run: integratorResult.run
      })
      const promotionGap = TraceObservationGap.cases.PromotionResult.make({
        action: invalidGapAction,
        attemptOrdinal: promotionAttempt.attemptOrdinal,
        correlation: promotionAttempt.correlation
      })
      const trackerGapTaskIds = [plannedAttemptItem.occurrence.plannedAttempt.taskId]
      const trackerGap = (required: "TaskClaimAcquired" | "TaskClaimReleased" | "TaskTrackerFactsObserved") =>
        TraceObservationGap.cases.TrackerObservation.make({
          action: invalidGapAction,
          operationId: OperationId.make(`facet-validation-${required}`),
          required,
          taskIds: trackerGapTaskIds
        })
      const gitGap = (required: "PlannedAttemptWorktreeObserved" | "TargetLineageObserved" | "TaskWorktreeReady") =>
        TraceObservationGap.cases.GitObservation.make({
          action: invalidGapAction,
          operationId: OperationId.make(`facet-validation-${required}`),
          required,
          taskIds: trackerGapTaskIds
        })
      for (const gap of [
        candidateGap,
        executorGap,
        integratorResultGap,
        promotionGap,
        trackerGap("TaskClaimAcquired"),
        trackerGap("TaskClaimReleased"),
        trackerGap("TaskTrackerFactsObserved"),
        gitGap("PlannedAttemptWorktreeObserved"),
        gitGap("TargetLineageObserved"),
        gitGap("TaskWorktreeReady")
      ]) {
        recoveryWith({ ...view.facets.recovery, observationGaps: [gap] })
      }

      const invalidRetainedSource = beginning.identity
      const retainedWorktree = TraceRetainedResponsibility.cases.Worktree.make({
        plannedAttempt: plannedAttemptItem.occurrence.plannedAttempt,
        proof: {
          baseSha: plannedAttemptItem.occurrence.plannedAttempt.baseSha,
          branch: plannedAttemptItem.occurrence.plannedAttempt.branch,
          headSha: plannedAttemptItem.occurrence.plannedAttempt.baseSha,
          worktree: plannedAttemptItem.occurrence.plannedAttempt.worktree
        },
        source: invalidRetainedSource
      })
      const retainedExecutorWork = TraceRetainedResponsibility.cases.ExecutorWork.make({
        plannedAttempt: plannedAttemptItem.occurrence.plannedAttempt,
        source: invalidRetainedSource
      })
      const retainedTaskAttempt = TraceRetainedResponsibility.cases.TaskAttempt.make({
        plannedAttempt: plannedAttemptItem.occurrence.plannedAttempt,
        source: invalidRetainedSource
      })
      const retainedClaim = TraceRetainedResponsibility.cases.TaskClaim.make({
        claim: {
          _tag: "ActiveTaskClaim",
          operationId: OperationId.make("facet-validation-claim"),
          owner: ClaimOwner.make("dalph:facet-validation"),
          taskId: plannedAttemptItem.occurrence.plannedAttempt.taskId,
          token: ClaimToken.make("facet-validation-token")
        },
        source: invalidRetainedSource
      })
      for (const retained of [retainedExecutorWork, retainedTaskAttempt, retainedClaim, retainedWorktree]) {
        recoveryWith({ ...view.facets.recovery, retainedResponsibilities: [retained] })
      }

      const preservationView = yield* makeTraceReader({ read: () => Effect.succeed(preservationRecords()) }).readAt(
        TraceCursor.make({ position: JournalPosition.make(8), runId })
      )
      const nonConvergentView = yield* makeTraceReader({
        read: () => Effect.succeed(nonConvergentPromotionRecords())
      }).readAt(TraceCursor.make({ position: JournalPosition.make(17), runId: integrationFinalityFixture.runId }))
      for (const disposition of preservationView.facets.recovery.preservationDispositions) {
        recoveryWith({
          ...view.facets.recovery,
          preservationDispositions: [{ ...disposition, source: invalidRetainedSource }]
        })
      }
      const nonConvergent = nonConvergentView.facets.recovery.preservationDispositions.find(
        ({ _tag }) => _tag === "NonConvergentPromotion"
      )
      if (nonConvergent?._tag !== "NonConvergentPromotion") {
        return yield* Effect.die("facet-validation matrix missing non-convergent disposition")
      }
      recoveryWith({
        ...view.facets.recovery,
        preservationDispositions: [{ ...nonConvergent, source: invalidRetainedSource }]
      })
      const quarantineBasis = {
        _tag: "ProviderRunFailure" as const,
        detail: IntegrationQuarantineFailureDetail.make("provider activity was absent"),
        ownedActivityProvenAbsentAt: JournalPosition.make(8)
      }
      const quarantineDisposition = TracePreservationDisposition.cases.IntegrationQuarantined.make({
        basis: quarantineBasis,
        correlation: session.correlation,
        source: invalidRetainedSource
      })
      recoveryWith({ ...view.facets.recovery, preservationDispositions: [quarantineDisposition] })

      const mismatchedSource = (fact: TraceIntegrationFact): TraceIntegrationFact => ({
        ...fact,
        source: beginning.identity
      })
      const staleView = yield* makeTraceReader({ read: () => Effect.succeed(stalePromotionRecords()) }).readAt(
        TraceCursor.make({ position: JournalPosition.make(15), runId: integrationFinalityFixture.runId })
      )
      const stale = staleView.facets.integration.facts.find(({ _tag }) => _tag === "PromotionStale")
      const nonConvergentFact = nonConvergentView.facets.integration.facts.find(
        ({ _tag }) => _tag === "PromotionNonConvergent"
      )
      if (stale?._tag !== "PromotionStale" || nonConvergentFact?._tag !== "PromotionNonConvergent") {
        return yield* Effect.die("facet-validation matrix missing terminal promotion facts")
      }
      const quarantineFact = TraceIntegrationFact.cases.Quarantine.make({
        basis: quarantineBasis,
        correlation: session.correlation,
        source: beginning.identity
      })
      const providerActivityAbsentFact = TraceIntegrationFact.cases.ProviderActivityAbsent.make({
        correlation: session.correlation,
        run: integratorResult.run,
        source: beginning.identity
      })
      const quarantineDirectionFact = TraceIntegrationFact.cases.QuarantineDirection.make({
        fingerprint: IntegrationQuarantineDirectionFingerprint.make({
          direction: "Retry",
          quarantineAt: JournalPosition.make(8),
          sessionId: session.correlation.sessionId
        }),
        source: beginning.identity
      })
      const invalidFacts: ReadonlyArray<TraceIntegrationFact> = [
        mismatchedSource(accepted),
        mismatchedSource(responsibility),
        mismatchedSource(sessionStarted),
        mismatchedSource(session),
        mismatchedSource(integratorResult),
        mismatchedSource(candidateObserved),
        mismatchedSource(candidateQualification),
        mismatchedSource(promotionRequested),
        mismatchedSource(promotionAttempt),
        mismatchedSource(promotionSucceeded),
        mismatchedSource(stale),
        mismatchedSource(nonConvergentFact),
        mismatchedSource(completion),
        mismatchedSource(claimReplacement),
        mismatchedSource(claimDeletion),
        mismatchedSource(settlement),
        mismatchedSource(dependantRelease),
        quarantineFact,
        providerActivityAbsentFact,
        quarantineDirectionFact
      ]
      for (const fact of invalidFacts) factsWith([fact])
    })
)

it.effect(
  "#82 rejects contradictory integration prefixes for missing boundaries and wrong run/session/candidate correlations",
  () =>
    Effect.gen(function* () {
      const records = integrationRecords()
      const eventAt = (position: number): JournalRecord["event"] => {
        const item = records.find(({ position: current }) => current === JournalPosition.make(position))
        return Option.getOrThrow(Option.fromUndefinedOr(item?.event))
      }
      const sessionFixed = eventAt(8)
      const runStarted = eventAt(9)
      const resultRecorded = eventAt(10)
      const candidateIntent = eventAt(11)
      const candidateObserved = eventAt(12)
      if (
        sessionFixed._tag !== "IntegratorSessionFixed" ||
        runStarted._tag !== "IntegratorRunStarted" ||
        resultRecorded._tag !== "IntegratorRunResultRecorded" ||
        candidateIntent._tag !== "IntegratorRunCandidateGitReadIntended" ||
        candidateObserved._tag !== "IntegratorRunCandidateGitObserved"
      ) {
        return yield* Effect.die("contradictory integration fixture is incomplete")
      }
      const notPrepared = IntegratorRunResultRecordedEvent.make({
        result: IntegratorResult.cases.NotPrepared.make({
          correlation: resultRecorded.run.session,
          detail: IntegratorNotPreparedDetail.make("provider did not prepare a candidate")
        }),
        run: resultRecorded.run,
        version: workflowJournalEventVersion
      })
      const wrongCandidateRun = IntegratorRunCorrelation.make({
        ...candidateObserved.run,
        session: { ...candidateObserved.run.session, expectedTargetHead: GitCommitSha.make("7".repeat(40)) }
      })
      const wrongCandidateObservation = IntegratorRunCandidateGitObservedEvent.make({
        candidateText: candidateObserved.candidateText,
        observation: candidateObserved.observation,
        run: wrongCandidateRun,
        version: workflowJournalEventVersion
      })
      const noThirdPromotionAttempt = TargetPromotionNonConvergenceEvent.make({
        attemptLimit: TargetPromotionAttemptLimit.make(3),
        attemptOrdinal: TargetPromotionAttemptOrdinal.make(3),
        correlation: promotionCorrelationFrom(records),
        lastObservation: {
          _tag: "ExpectedHeadStillObserved",
          observedHeadSha: resultRecorded.run.session.expectedTargetHead
        },
        version: workflowJournalEventVersion
      })
      const invalidRecords = [
        records.map((item) => (item.position === JournalPosition.make(8) ? withEvent(item, runStarted) : item)),
        records.map((item) => (item.position === JournalPosition.make(9) ? withEvent(item, resultRecorded) : item)),
        records.map((item) => (item.position === JournalPosition.make(11) ? withEvent(item, resultRecorded) : item)),
        records.map((item) => (item.position === JournalPosition.make(10) ? withEvent(item, notPrepared) : item)),
        records.map((item) =>
          item.position === JournalPosition.make(12) ? withEvent(item, wrongCandidateObservation) : item
        ),
        records.map((item) =>
          item.position === JournalPosition.make(15) ? withEvent(item, noThirdPromotionAttempt) : item
        )
      ]
      const first = records[0]
      if (first === undefined) return yield* Effect.die("contradictory integration fixture is empty")
      for (const malformed of invalidRecords) {
        const failure = yield* Effect.flip(makeTraceReader({ read: () => Effect.succeed(malformed) }).read(first.runId))
        vitestExpect(failure).toBeInstanceOf(TraceProjectionInvalid)
      }
    })
)

it.effect("#82 rejects a bare settlement and duplicate nested finality operation identity", () =>
  Effect.gen(function* () {
    const records = finalityRecords()
    const attemptRecord = records.find(({ position }) => position === JournalPosition.make(27))
    const settlementRecord = records.find(({ position }) => position === JournalPosition.make(34))
    if (
      attemptRecord?.event._tag !== "CompletionTaskAttemptIntended" ||
      settlementRecord?.event._tag !== "IntegrationFinalitySettled"
    ) {
      return yield* Effect.die("finality negative fixture is incomplete")
    }
    const attemptEvent = attemptRecord.event
    const settlementEvent = settlementRecord.event
    const duplicateNestedOperation = records.map((item) =>
      item.position === JournalPosition.make(27)
        ? withEvent(
            item,
            CompletionTaskAttemptIntendedEvent.make({
              ...attemptEvent,
              focusedFactsOperationId: attemptEvent.request.operationId
            })
          )
        : item
    )
    const bareSettlement = records.map((item) =>
      item.position === JournalPosition.make(34)
        ? withEvent(
            item,
            IntegrationFinalitySettledEvent.make({
              ...settlementEvent,
              deletionOperationId: OperationId.make("missing-finality-deletion")
            })
          )
        : item
    )
    for (const malformed of [duplicateNestedOperation, bareSettlement]) {
      const failure = yield* Effect.flip(
        makeTraceReader({ read: () => Effect.succeed(malformed) }).read(integrationFinalityFixture.runId)
      )
      vitestExpect(failure).toBeInstanceOf(TraceProjectionInvalid)
    }
  })
)

it.effect("#82 retains the cleanup claim reread's deletion, replacement, and focused-read identities", () =>
  Effect.gen(function* () {
    const records = finalityRecords()
    const deletion = records.find(({ position }) => position === JournalPosition.make(31))
    const replacement = records.find(({ position }) => position === JournalPosition.make(19))
    if (
      deletion?.event._tag !== "CompletionClaimDeletionIntended" ||
      replacement?.event._tag !== "CompletionClaimReplacementIntended"
    ) {
      return yield* Effect.die("cleanup reread fixture is missing its exact claim operations")
    }
    const reread = CompletionClaimDeletionReadObservedEvent.make({
      observation: deletion.event.claim,
      purpose: CompletionClaimDeletionReadPurpose.cases.BeforeDeletionAttempt.make({
        attemptOrdinal: CompletionClaimRequestOrdinal.make(1),
        readOrdinal: CompletionClaimCleanupReadOrdinal.make(1)
      }),
      replacementOperationId: replacement.event.operationId,
      request: completionClaimDeletionRequestFor(
        deletion.event.claim,
        deletion.event.successObservation,
        deletion.event.operationId
      ),
      version: workflowJournalEventVersion
    })
    const prefix = [...records.slice(0, 31), record(32, reread, integrationFinalityFixture.runId)]
    const view = yield* makeTraceReader({ read: () => Effect.succeed(prefix) }).readAt(
      TraceCursor.make({ position: JournalPosition.make(32), runId: integrationFinalityFixture.runId })
    )
    const rereadItem = view.items.find(
      ({ occurrence }) =>
        occurrence._tag === "IntegrationClaimDeletionOccurred" &&
        occurrence.event._tag === "CompletionClaimDeletionReadObserved"
    )
    if (
      rereadItem?.occurrence._tag !== "IntegrationClaimDeletionOccurred" ||
      rereadItem.occurrence.event._tag !== "CompletionClaimDeletionReadObserved"
    ) {
      return yield* Effect.die("cleanup reread occurrence was not projected")
    }
    vitestExpect(rereadItem.operationIds).toEqual(
      vitestExpect.arrayContaining([
        deletion.event.operationId,
        deletion.event.successObservation.operationId,
        replacement.event.operationId
      ])
    )
    vitestExpect(view.facets.integration.facts).toContainEqual(
      vitestExpect.objectContaining({ _tag: "ClaimDeletion", source: rereadItem.identity })
    )
  })
)

it.effect("#81 names the exact operation family for unfinished tracker and Git reads", () =>
  Effect.gen(function* () {
    const rejectGapMutation = (
      view: TraceAtCursor,
      gap: Extract<TraceObservationGap, { readonly _tag: "GitObservation" | "TrackerObservation" }>
    ): void => {
      const taskIds = gap._tag === "TrackerObservation" && gap.taskIds.length === 0 ? [plannedAttempt.taskId] : []
      const operationId =
        gap._tag === "GitObservation" ? OperationId.make("facet-gap-wrong-operation") : gap.operationId
      const invalidGap = { ...gap, operationId, ...(gap._tag === "TrackerObservation" ? { taskIds } : {}) }
      vitestExpect(() =>
        Schema.decodeUnknownSync(TraceAtCursor)({
          ...view,
          facets: { ...view.facets, recovery: { ...view.facets.recovery, observationGaps: [invalidGap] } }
        })
      ).toThrow()
    }

    const trackerOperations = [
      makeTrackerGraphObservationOperation(OperationId.make("facet-gap-graph"), trackerTarget),
      makeTaskClaimObservationOperation(OperationId.make("facet-gap-claim"), trackerTarget, plannedAttempt.taskId),
      makeTaskWorkSpecificationObservationOperation(
        OperationId.make("facet-gap-specification"),
        trackerTarget,
        plannedAttempt.taskId
      )
    ]
    for (const operation of trackerOperations) {
      const records = [record(1, runBeginning), record(2, taskTrackerReadIntent(operation))]
      const view = yield* makeTraceReader({ read: () => Effect.succeed(records) }).readAt(
        TraceCursor.make({ position: JournalPosition.make(2), runId })
      )
      const gap = view.facets.recovery.observationGaps[0]
      if (gap?._tag !== "TrackerObservation") return yield* Effect.die("tracker gap fixture is incomplete")
      rejectGapMutation(view, gap)
    }

    const worktreePrefix = preservationRecords().slice(0, 2)
    const worktreeView = yield* makeTraceReader({ read: () => Effect.succeed(worktreePrefix) }).readAt(
      TraceCursor.make({ position: JournalPosition.make(2), runId })
    )
    const worktreeGap = worktreeView.facets.recovery.observationGaps[0]
    if (worktreeGap?._tag !== "GitObservation") return yield* Effect.die("worktree Git gap fixture is incomplete")
    rejectGapMutation(worktreeView, worktreeGap)

    const lineagePrefix = integrationRecords().slice(0, 6)
    const lineageView = yield* makeTraceReader({ read: () => Effect.succeed(lineagePrefix) }).readAt(
      TraceCursor.make({ position: JournalPosition.make(6), runId: integrationFinalityFixture.runId })
    )
    const lineageGap = lineageView.facets.recovery.observationGaps[0]
    if (lineageGap?._tag !== "GitObservation") return yield* Effect.die("lineage Git gap fixture is incomplete")
    rejectGapMutation(lineageView, lineageGap)
  })
)

it.effect("#81 preserves focused tracker task identity for specification claim unreadable and failed outcomes", () =>
  Effect.gen(function* () {
    const taskId = plannedAttempt.taskId
    const specificationOperation = makeTaskWorkSpecificationObservationOperation(
      OperationId.make("historical-focused-specification"),
      trackerTarget,
      taskId
    )
    const claimOperation = makeTaskClaimObservationOperation(
      OperationId.make("historical-focused-claim"),
      trackerTarget,
      taskId
    )
    const graphOperation = makeTrackerGraphObservationOperation(
      OperationId.make("historical-focused-failed-graph"),
      trackerTarget
    )
    const specification = makeTaskWorkSpecification({ body: "retain exact instructions", taskId, title: "Focused" })
    const cases = [
      [
        specificationOperation,
        makeFocusedTaskWorkSpecificationFactsObserved(specificationOperation, specification),
        [taskId]
      ],
      [claimOperation, makeFocusedTaskClaimFactsObserved(claimOperation, UnclaimedTask.make({ taskId })), [taskId]],
      [claimOperation, makeFocusedTaskClaimFactsUnreadable(claimOperation), [taskId]],
      [
        graphOperation,
        TaskTrackerFactsReadFailed.make({
          completeness: "Unreadable",
          failure: { _tag: "FixtureReadError", detail: "focused graph read failed" },
          operationId: graphOperation.operationId,
          target: trackerTarget
        }),
        []
      ]
    ] as const
    for (const [operation, observation, expectedTaskIds] of cases) {
      const records = [
        record(1, runBeginning),
        record(2, taskTrackerReadIntent(operation)),
        record(3, taskTrackerFactsObservedEvent(operation.operationId, observation))
      ]
      const view = yield* makeTraceReader({ read: () => Effect.succeed(records) }).readAt(
        TraceCursor.make({ position: JournalPosition.make(3), runId })
      )
      const observed = view.items.find(({ occurrence }) => occurrence._tag === "TaskTrackerFactsObserved")
      if (observed?.occurrence._tag !== "TaskTrackerFactsObserved") {
        return yield* Effect.die("focused tracker outcome was not projected")
      }
      vitestExpect(observed.taskIds).toEqual(expectedTaskIds)
    }
  })
)

it.effect("#81/#82 validates matching facet sources across recovery, promotion, and integration prefixes", () =>
  Effect.gen(function* () {
    const prefixes = [
      { records: recoveryRecords(), position: 4, runId },
      { records: integrationRecords().slice(0, 6), position: 6, runId: integrationFinalityFixture.runId },
      { records: integrationRecords().slice(0, 11), position: 11, runId: integrationFinalityFixture.runId },
      { records: integrationRecords().slice(0, 14), position: 14, runId: integrationFinalityFixture.runId },
      { records: finalityRecords().slice(0, 22), position: 22, runId: integrationFinalityFixture.runId }
    ]
    for (const prefix of prefixes) {
      const view = yield* makeTraceReader({ read: () => Effect.succeed(prefix.records) }).readAt(
        TraceCursor.make({ position: JournalPosition.make(prefix.position), runId: prefix.runId })
      )
      vitestExpect(() => Schema.decodeUnknownSync(TraceAtCursor)(view)).not.toThrow()
    }

    const recovery = yield* makeTraceReader({ read: () => Effect.succeed(recoveryRecords()) }).readAt(
      TraceCursor.make({ position: JournalPosition.make(4), runId })
    )
    const executorGap = recovery.facets.recovery.observationGaps.find(({ _tag }) => _tag === "ExecutorReport")
    if (executorGap?._tag !== "ExecutorReport") return yield* Effect.die("executor gap fixture is incomplete")
    const missingItemAction = TraceItemIdentity.make({ position: JournalPosition.make(1), runId })
    vitestExpect(() =>
      Schema.decodeUnknownSync(TraceAtCursor)({
        ...recovery,
        facets: {
          ...recovery.facets,
          recovery: { ...recovery.facets.recovery, observationGaps: [{ ...executorGap, action: missingItemAction }] }
        }
      })
    ).toThrow()

    const preservation = yield* makeTraceReader({ read: () => Effect.succeed(preservationRecords()) }).readAt(
      TraceCursor.make({ position: JournalPosition.make(8), runId })
    )
    const disposition = preservation.facets.recovery.preservationDispositions[0]
    if (disposition === undefined) return yield* Effect.die("preservation disposition fixture is incomplete")
    vitestExpect(() =>
      Schema.decodeUnknownSync(TraceAtCursor)({
        ...preservation,
        facets: {
          ...preservation.facets,
          recovery: {
            ...preservation.facets.recovery,
            preservationDispositions: [{ ...disposition, source: missingItemAction }]
          }
        }
      })
    ).toThrow()

    const nonConvergent = yield* makeTraceReader({
      read: () => Effect.succeed(nonConvergentPromotionRecords())
    }).readAt(TraceCursor.make({ position: JournalPosition.make(17), runId: integrationFinalityFixture.runId }))
    const retryFact = nonConvergent.facets.integration.facts.find(
      (fact) => fact._tag === "PromotionAttempt" && fact.attemptOrdinal === TargetPromotionAttemptOrdinal.make(2)
    )
    if (retryFact?._tag !== "PromotionAttempt" || retryFact.reason._tag !== "ReconciledExpectedHead") {
      return yield* Effect.die("retry promotion fact fixture is incomplete")
    }
    const wrongRetryReason = {
      ...retryFact,
      reason: { _tag: "Initial" as const, observedHeadSha: retryFact.reason.observedHeadSha }
    }
    vitestExpect(() =>
      Schema.decodeUnknownSync(TraceAtCursor)({
        ...nonConvergent,
        facets: {
          ...nonConvergent.facets,
          integration: {
            facts: nonConvergent.facets.integration.facts.map((fact) => (fact === retryFact ? wrongRetryReason : fact))
          }
        }
      })
    ).toThrow()

    const integration = yield* makeTraceReader({ read: () => Effect.succeed(integrationRecords()) }).readAt(
      TraceCursor.make({ position: JournalPosition.make(15), runId: integrationFinalityFixture.runId })
    )
    const accepted = integration.facets.integration.facts.find(({ _tag }) => _tag === "AcceptedResult")
    if (accepted?._tag !== "AcceptedResult") return yield* Effect.die("accepted-result fact fixture is incomplete")
    vitestExpect(() =>
      Schema.decodeUnknownSync(TraceAtCursor)({
        ...integration,
        facets: {
          ...integration.facets,
          integration: {
            facts: integration.facets.integration.facts.map((fact) =>
              fact === accepted
                ? {
                    ...fact,
                    plannedAttempt: { ...fact.plannedAttempt, taskRevision: TaskRevision.make("wrong-revision") }
                  }
                : fact
            )
          }
        }
      })
    ).toThrow()
  })
)

it.effect("#82 rejects a foreign durable key instead of normalizing it during trace validation", () =>
  Effect.gen(function* () {
    const records = integrationRecords()
    const foreignKey = JournalRecordKey.make("foreign-integrator-session-key")
    const malformed = records.map((item) =>
      item.position === JournalPosition.make(8) ? { ...item, key: foreignKey } : item
    )
    const failure = yield* Effect.flip(
      makeTraceReader({ read: () => Effect.succeed(malformed) }).read(integrationFinalityFixture.runId)
    )
    vitestExpect(failure).toBeInstanceOf(TraceJournalPrefixInvalid)
  })
)

it.effect("#81 retains a worktree-reconciliation intent and names its exact missing readiness observation", () =>
  Effect.gen(function* () {
    const operation = makeTaskWorktreeReconciliationOperation({
      operationId: OperationId.make("historical-worktree-reconciliation"),
      plannedAttempt,
      predecessorOperationIds: []
    })
    const records = [
      record(1, runBeginning),
      record(2, TaskWorktreeReconciliationIntendedEvent.make({ operation, version: workflowJournalEventVersion }))
    ]
    const view = yield* makeTraceReader({ read: () => Effect.succeed(records) }).readAt(
      TraceCursor.make({ position: JournalPosition.make(2), runId })
    )
    const intent = view.items.find(({ occurrence }) => occurrence._tag === "TaskWorktreeReconciliationInitiated")
    if (intent?.occurrence._tag !== "TaskWorktreeReconciliationInitiated") {
      return yield* Effect.die("worktree reconciliation intent was not projected")
    }
    vitestExpect(intent.operationIds).toEqual([operation.operationId])
    vitestExpect(intent.taskIds).toEqual([plannedAttempt.taskId])
    vitestExpect(view.facets.recovery.observationGaps).toContainEqual({
      _tag: "GitObservation",
      action: intent.identity,
      operationId: operation.operationId,
      required: "TaskWorktreeReady",
      taskIds: [plannedAttempt.taskId]
    })
  })
)

it.effect("#82 retains post-promotion Git intent and unreadable outcome with exact nested operation identity", () =>
  Effect.gen(function* () {
    const baseRecords = finalityRecords()
    const settlement = baseRecords.find(({ event }) => event._tag === "IntegrationFinalitySettled")
    if (settlement?.event._tag !== "IntegrationFinalitySettled") {
      return yield* Effect.die("finality fixture did not produce a settlement")
    }
    const blockerTaskId = TaskId.make("post-promotion-blocker")
    const blockedOperation = makeTrackerGraphObservationOperation(
      OperationId.make("historical-post-promotion-blocked"),
      integrationFinalityFixture.target,
      [],
      [settlement.event.claim.plannedAttempt.taskId, blockerTaskId]
    )
    const blockedProjection = projectTrackerSnapshot({
      revision: "historical-post-promotion-blocked-revision",
      tasks: [
        {
          id: settlement.event.claim.plannedAttempt.taskId,
          lifecycle: { _tag: "Open" as const },
          parentTaskId: null,
          prerequisiteIds: [blockerTaskId]
        },
        { id: blockerTaskId, lifecycle: { _tag: "Open" as const }, parentTaskId: null, prerequisiteIds: [] }
      ]
    })
    if (blockedProjection._tag !== "Valid") return yield* Effect.die("blocked graph fixture is invalid")
    const clearOperation = makeTrackerGraphObservationOperation(
      OperationId.make("historical-post-promotion-cleared"),
      integrationFinalityFixture.target,
      [],
      [settlement.event.claim.plannedAttempt.taskId, blockerTaskId]
    )
    const clearProjection = projectTrackerSnapshot({
      revision: "historical-post-promotion-cleared-revision",
      tasks: [
        {
          id: settlement.event.claim.plannedAttempt.taskId,
          lifecycle: { _tag: "CompletedSuccessfully" as const },
          parentTaskId: null,
          prerequisiteIds: [blockerTaskId]
        },
        {
          id: blockerTaskId,
          lifecycle: { _tag: "CompletedSuccessfully" as const },
          parentTaskId: null,
          prerequisiteIds: []
        }
      ]
    })
    if (clearProjection._tag !== "Valid") return yield* Effect.die("cleared graph fixture is invalid")
    const blockedIntent = taskTrackerReadIntent(blockedOperation)
    const blockedFacts = taskTrackerFactsObservedEvent(
      blockedOperation.operationId,
      makeCompleteTaskTrackerFactsObserved(blockedOperation, blockedProjection.snapshot)
    )
    const clearIntent = taskTrackerReadIntent(clearOperation)
    const clearFacts = taskTrackerFactsObservedEvent(
      clearOperation.operationId,
      makeCompleteTaskTrackerFactsObserved(clearOperation, clearProjection.snapshot)
    )
    const records = [
      ...baseRecords.map((item) =>
        item.position === JournalPosition.make(35)
          ? withEvent(item, blockedIntent)
          : item.position === JournalPosition.make(36)
            ? withEvent(item, blockedFacts)
            : item
      ),
      record(37, clearIntent, integrationFinalityFixture.runId),
      record(38, clearFacts, integrationFinalityFixture.runId)
    ]
    const authorization = PostPromotionBlockerClearAuthorization.make({
      blockerClearedAt: JournalPosition.make(38),
      blockerObservedAt: JournalPosition.make(36),
      claim: settlement.event.claim
    })
    const operationId = postPromotionBlockerAncestryOperationIdFor(authorization)
    const intent = PostPromotionBlockerCandidateAncestryReadIntendedEvent.make({
      authorization,
      operationId,
      version: workflowJournalEventVersion
    })
    const observed = PostPromotionBlockerCandidateAncestryObservedEvent.make({
      authorization,
      observation: { _tag: "Unreadable", detail: "git read was unavailable" },
      operationId,
      version: workflowJournalEventVersion
    })
    const view = yield* makeTraceReader({
      read: () =>
        Effect.succeed([
          ...records,
          record(39, intent, integrationFinalityFixture.runId),
          record(40, observed, integrationFinalityFixture.runId)
        ])
    }).readAt(TraceCursor.make({ position: JournalPosition.make(40), runId: integrationFinalityFixture.runId }))
    const facts = view.facets.integration.facts.filter(
      (fact) => fact._tag === "FocusedCompletion" && fact.event._tag.startsWith("PostPromotionBlockerCandidateAncestry")
    )
    vitestExpect(facts).toHaveLength(2)
    vitestExpect(view.items.filter(({ operationIds }) => operationIds.includes(operationId))).toHaveLength(2)
    vitestExpect(facts.map((fact) => (fact._tag === "FocusedCompletion" ? fact.event._tag : undefined))).toEqual([
      "PostPromotionBlockerCandidateAncestryReadIntended",
      "PostPromotionBlockerCandidateAncestryObserved"
    ])
    const unreadable = facts[1]
    if (
      unreadable?._tag !== "FocusedCompletion" ||
      unreadable.event._tag !== "PostPromotionBlockerCandidateAncestryObserved"
    ) {
      return yield* Effect.die("post-promotion unreadable evidence was not retained")
    }
    vitestExpect(unreadable.event.observation).toEqual({ _tag: "Unreadable", detail: "git read was unavailable" })
  })
)

it.effect("#82 keeps candidate-run identities distinct when delimiter text would collide", () =>
  Effect.gen(function* () {
    const baseSession = integrationFinalityFixture.qualifiedCandidate.run.session
    const makeCollisionPrefix = (input: {
      readonly candidateText: string
      readonly lineagePosition: number
      readonly runOrdinal: number
      readonly sessionId: string
      readonly startPosition: number
    }): ReadonlyArray<JournalRecord> => {
      const responsibilityPosition = input.startPosition
      const integrationStartedPosition = input.startPosition + 1
      const lineageIntentPosition = input.startPosition + 2
      const lineageObservedPosition = input.lineagePosition
      const sessionFixedPosition = input.lineagePosition + 1
      const runStartedPosition = input.lineagePosition + 2
      const candidateIntentPosition = input.lineagePosition + 3
      const session = IntegratorSessionCorrelation.make({
        ...baseSession,
        plannedAttempt,
        queuedAt: JournalPosition.make(responsibilityPosition),
        sessionId: IntegratorSessionId.make(input.sessionId),
        startedAt: JournalPosition.make(integrationStartedPosition),
        targetLineageObservedAt: JournalPosition.make(lineageObservedPosition)
      })
      const run = IntegratorRunCorrelation.make({ ordinal: IntegratorRunOrdinal.make(input.runOrdinal), session })
      const lineageOperation = makeTargetLineageObservationOperation({
        integrationTarget: session.integrationTarget,
        operationId: OperationId.make(`historical-collision-lineage-${input.runOrdinal}`),
        plannedAttempt,
        predecessorOperationIds: []
      })
      const responsibility = IntegrationResponsibilityBeganEvent.make({
        acceptedResult: session.acceptedResult,
        integrationTarget: session.integrationTarget,
        plannedAttempt,
        version: workflowJournalEventVersion
      })
      const started = IntegrationStartedEvent.make({
        acceptedResult: session.acceptedResult,
        integrationTarget: session.integrationTarget,
        plannedAttempt,
        responsibilityBeganAt: JournalPosition.make(responsibilityPosition),
        version: workflowJournalEventVersion
      })
      const lineageIntent = GitReadIntentRecordedEvent.make({
        initiatedBy: WorkflowActor.cases.DalphCoordinator.make({}),
        occurrenceClassification: "InitiatedAction",
        operation: lineageOperation,
        version: workflowJournalEventVersion
      })
      const lineageObserved = TargetLineageObservedEvent.make({
        observation: TargetLineageObservation.make({
          plannedBaseIsAncestorOfTargetHead: true,
          plannedBaseSha: plannedAttempt.baseSha,
          targetHeadSha: session.expectedTargetHead
        }),
        occurrenceClassification: "NonActionOccurrence",
        operationId: lineageOperation.operationId,
        plannedAttempt,
        version: workflowJournalEventVersion
      })
      const sessionFixed = IntegratorSessionFixedEvent.make({
        correlation: session,
        version: workflowJournalEventVersion
      })
      const runStarted = IntegratorRunStartedEvent.make({ run, version: workflowJournalEventVersion })
      const candidateIntent = IntegratorRunCandidateGitReadIntendedEvent.make({
        candidateText: IntegratorCandidateText.make(input.candidateText),
        run,
        version: workflowJournalEventVersion
      })
      return [
        record(responsibilityPosition, responsibility),
        record(integrationStartedPosition, started),
        record(lineageIntentPosition, lineageIntent),
        record(lineageObservedPosition, lineageObserved),
        record(sessionFixedPosition, sessionFixed),
        record(runStartedPosition, runStarted),
        record(candidateIntentPosition, candidateIntent)
      ]
    }
    const records = [
      ...makeCollisionPrefix({
        candidateText: "2:candidate",
        lineagePosition: 4,
        runOrdinal: 1,
        sessionId: "collision",
        startPosition: 1
      }),
      ...makeCollisionPrefix({
        candidateText: "candidate",
        lineagePosition: 11,
        runOrdinal: 2,
        sessionId: "collision:1",
        startPosition: 8
      })
    ]
    const projection = yield* projectWorkflowOccurrences(records)
    vitestExpect(
      projection.occurrences.filter(({ _tag }) => _tag === "IntegratorCandidateQualificationInitiated")
    ).toHaveLength(2)
  })
)

it.effect("#82 rejects promotion attempts with a missing predecessor ordinal or wrong first reason", () =>
  Effect.gen(function* () {
    const firstAttemptRecords = integrationRecords()
    const firstAttempt = firstAttemptRecords.find(({ position }) => position === JournalPosition.make(14))
    if (firstAttempt?.event._tag !== "TargetPromotionAttemptIntended") {
      return yield* Effect.die("promotion first-attempt fixture is incomplete")
    }
    const firstAttemptEvent = firstAttempt.event
    const wrongFirstReason = firstAttemptRecords.map((item) =>
      item.position === JournalPosition.make(14)
        ? withEvent(
            item,
            TargetPromotionAttemptIntendedEvent.make({
              ...firstAttemptEvent,
              reason: {
                _tag: "ReconciledExpectedHead",
                observedHeadSha: firstAttemptEvent.reason.observedHeadSha,
                previousAttemptOrdinal: TargetPromotionAttemptOrdinal.make(1)
              }
            })
          )
        : item
    )
    const retryRecords = nonConvergentPromotionRecords()
    const retryAttempt = retryRecords.find(({ position }) => position === JournalPosition.make(15))
    if (retryAttempt?.event._tag !== "TargetPromotionAttemptIntended") {
      return yield* Effect.die("promotion retry fixture is incomplete")
    }
    const retryAttemptEvent = retryAttempt.event
    const wrongRetryPredecessor = retryRecords.map((item) =>
      item.position === JournalPosition.make(15)
        ? withEvent(
            item,
            TargetPromotionAttemptIntendedEvent.make({
              ...retryAttemptEvent,
              reason: {
                _tag: "ReconciledExpectedHead",
                observedHeadSha: retryAttemptEvent.reason.observedHeadSha,
                previousAttemptOrdinal: TargetPromotionAttemptOrdinal.make(3)
              }
            })
          )
        : item
    )
    for (const malformed of [wrongFirstReason, wrongRetryPredecessor]) {
      const first = malformed[0]
      if (first === undefined) return yield* Effect.die("promotion malformed fixture is empty")
      const failure = yield* Effect.flip(makeTraceReader({ read: () => Effect.succeed(malformed) }).read(first.runId))
      vitestExpect(failure).toBeInstanceOf(TraceProjectionInvalid)
    }
  })
)

it.effect("#81/#82 materialize one prefix view at every cursor without future facet leakage", () =>
  Effect.gen(function* () {
    const records = integrationRecords()
    const reader = makeTraceReader({ read: () => Effect.succeed(records) })
    const firstRecord = records[0]
    if (firstRecord === undefined) return yield* Effect.die("integration fixture is empty")
    for (let position = 1; position <= records.length; position += 1) {
      const cursor = TraceCursor.make({ position: JournalPosition.make(position), runId: firstRecord.runId })
      const view = yield* reader.readAt(cursor)
      vitestExpect(view.items.every(({ identity }) => identity.position <= cursor.position)).toBe(true)
      vitestExpect(view.facets.recovery.observationGaps.every(({ action }) => action.position <= cursor.position)).toBe(
        true
      )
      vitestExpect(view.facets.integration.facts.every(({ source }) => source.position <= cursor.position)).toBe(true)
      if (position < 13) {
        vitestExpect(
          view.facets.integration.facts.some(
            ({ _tag }) =>
              _tag === "PromotionRequested" ||
              _tag === "PromotionAttempt" ||
              _tag === "PromotionSucceeded" ||
              _tag === "PromotionStale" ||
              _tag === "PromotionNonConvergent"
          )
        ).toBe(false)
      }
    }

    const recoveryView = yield* makeTraceReader({ read: () => Effect.succeed(recoveryRecords()) }).readAt(
      TraceCursor.make({ position: JournalPosition.make(4), runId })
    )
    const gap = recoveryView.facets.recovery.observationGaps[0]
    if (gap === undefined) return yield* Effect.die("cursor matrix fixture did not retain an unfinished boundary")
    vitestExpect(() =>
      Schema.decodeUnknownSync(TraceAtCursor)({
        ...recoveryView,
        facets: {
          ...recoveryView.facets,
          recovery: {
            ...recoveryView.facets.recovery,
            observationGaps: [{ ...gap, action: { ...gap.action, position: JournalPosition.make(0) } }]
          }
        }
      })
    ).toThrow()
  })
)

it.effect("#81/#82 validate every remaining public facet relation against its exact historical source", () =>
  Effect.gen(function* () {
    const issue = (
      view: TraceAtCursor,
      facets: TraceAtCursor["facets"],
      items: TraceAtCursor["items"] = view.items
    ): string | undefined =>
      traceHistoricalFacetsIssue({ cursor: view.cursor, items, facets }, historicalFacetFactories)
    const expectValid = (view: TraceAtCursor): void => vitestExpect(issue(view, view.facets)).toBeUndefined()
    const expectInvalid = (view: TraceAtCursor, facets: TraceAtCursor["facets"], items = view.items): void =>
      vitestExpect(issue(view, facets, items)).toBeDefined()

    const recovery = yield* makeTraceReader({ read: () => Effect.succeed(recoveryRecords()) }).readAt(
      TraceCursor.make({ position: JournalPosition.make(4), runId })
    )
    expectValid(recovery)
    const executorGap = recovery.facets.recovery.observationGaps.find(({ _tag }) => _tag === "ExecutorReport")
    const retainedExecutor = recovery.facets.recovery.retainedResponsibilities.find(
      ({ _tag }) => _tag === "ExecutorWork"
    )
    const retainedAttempt = recovery.facets.recovery.retainedResponsibilities.find(({ _tag }) => _tag === "TaskAttempt")
    if (
      executorGap?._tag !== "ExecutorReport" ||
      retainedExecutor?._tag !== "ExecutorWork" ||
      retainedAttempt?._tag !== "TaskAttempt"
    ) {
      return yield* Effect.die("recovery relation fixture is incomplete")
    }
    expectInvalid(recovery, {
      ...recovery.facets,
      recovery: {
        ...recovery.facets.recovery,
        observationGaps: [{ ...executorGap, attemptId: AttemptId.make("wrong-executor-attempt") }]
      }
    })
    expectInvalid(recovery, {
      ...recovery.facets,
      recovery: {
        ...recovery.facets.recovery,
        retainedResponsibilities: [{ ...retainedExecutor, plannedAttempt: independentAttempt }]
      }
    })
    expectInvalid(recovery, {
      ...recovery.facets,
      recovery: {
        ...recovery.facets.recovery,
        retainedResponsibilities: [{ ...retainedAttempt, plannedAttempt: independentAttempt }]
      }
    })
    const missingItem = TraceItemIdentity.make({ runId, position: JournalPosition.make(1) })
    expectInvalid(recovery, {
      ...recovery.facets,
      recovery: { ...recovery.facets.recovery, observationGaps: [{ ...executorGap, action: missingItem }] }
    })
    expectInvalid(recovery, {
      ...recovery.facets,
      recovery: {
        ...recovery.facets.recovery,
        retainedResponsibilities: [{ ...retainedExecutor, source: missingItem }]
      }
    })
    const absentItem = TraceItemIdentity.make({ runId, position: JournalPosition.make(99) })
    vitestExpect(
      issue(recovery, {
        ...recovery.facets,
        recovery: { ...recovery.facets.recovery, observationGaps: [{ ...executorGap, action: absentItem }] }
      })
    ).toBe("Every historical facet source must resolve to an item in the cursor prefix")

    const lineage = yield* makeTraceReader({ read: () => Effect.succeed(integrationRecords().slice(0, 6)) }).readAt(
      TraceCursor.make({ position: JournalPosition.make(6), runId: integrationFinalityFixture.runId })
    )
    expectValid(lineage)
    const gitGap = lineage.facets.recovery.observationGaps.find(({ _tag }) => _tag === "GitObservation")
    if (gitGap?._tag !== "GitObservation") return yield* Effect.die("lineage gap fixture is incomplete")
    expectInvalid(lineage, {
      ...lineage.facets,
      recovery: {
        ...lineage.facets.recovery,
        observationGaps: [{ ...gitGap, required: "PlannedAttemptWorktreeObserved" }]
      }
    })

    const integration = yield* makeTraceReader({ read: () => Effect.succeed(integrationRecords()) }).readAt(
      TraceCursor.make({ position: JournalPosition.make(15), runId: integrationFinalityFixture.runId })
    )
    expectValid(integration)
    const accepted = integration.facets.integration.facts.find(({ _tag }) => _tag === "AcceptedResult")
    const qualification = integration.facets.integration.facts.find(({ _tag }) => _tag === "CandidateQualification")
    if (accepted?._tag !== "AcceptedResult" || qualification?._tag !== "CandidateQualification") {
      return yield* Effect.die("integration relation fixture is incomplete")
    }
    const withoutPreparedResult = integration.items.map(({ occurrence, ...item }) =>
      occurrence._tag === "IntegratorRunResultRecorded" && occurrence.result._tag === "PreparedCandidate"
        ? {
            ...item,
            occurrence: {
              ...occurrence,
              result: IntegratorResult.cases.NotPrepared.make({
                correlation: occurrence.run.session,
                detail: IntegratorNotPreparedDetail.make("prepared result was not retained")
              })
            }
          }
        : { ...item, occurrence }
    )
    expectInvalid(integration, integration.facets, withoutPreparedResult)
    expectInvalid(integration, {
      ...integration.facets,
      integration: {
        facts: integration.facets.integration.facts.map((fact) =>
          fact === accepted
            ? { ...fact, plannedAttempt: { ...fact.plannedAttempt, taskRevision: TaskRevision.make("wrong") } }
            : fact
        )
      }
    })

    const candidateRecord = integrationRecords().find(({ position }) => position === JournalPosition.make(12))
    if (candidateRecord?.event._tag !== "IntegratorRunCandidateGitObserved") {
      return yield* Effect.die("candidate observation fixture is missing")
    }
    const candidateEvent = candidateRecord.event
    const nonCommitRecords = integrationRecords().map((item) =>
      item.position === JournalPosition.make(12)
        ? withEvent(
            item,
            IntegratorRunCandidateGitObservedEvent.make({
              candidateText: candidateEvent.candidateText,
              observation: IntegratorGitObservation.cases.NonCommit.make({
                candidateText: candidateEvent.candidateText,
                objectType: "tree"
              }),
              run: candidateEvent.run,
              version: workflowJournalEventVersion
            })
          )
        : item
    )
    const nonCommitView = yield* makeTraceReader({ read: () => Effect.succeed(nonCommitRecords) }).readAt(
      TraceCursor.make({ position: JournalPosition.make(12), runId: integrationFinalityFixture.runId })
    )
    expectValid(nonCommitView)
    const wrongParentRecords = integrationRecords().map((item) =>
      item.position === JournalPosition.make(12)
        ? withEvent(
            item,
            IntegratorRunCandidateGitObservedEvent.make({
              candidateText: candidateEvent.candidateText,
              observation: IntegratorGitObservation.cases.Commit.make({
                candidateText: candidateEvent.candidateText,
                commit: integrationFinalityFixture.qualifiedCandidate.candidateCommit,
                directParents: [
                  GitCommitSha.make("9".repeat(40)),
                  integrationFinalityFixture.qualifiedCandidate.directParents[1]
                ]
              }),
              run: candidateEvent.run,
              version: workflowJournalEventVersion
            })
          )
        : item
    )
    const wrongParentView = yield* makeTraceReader({ read: () => Effect.succeed(wrongParentRecords) }).readAt(
      TraceCursor.make({ position: JournalPosition.make(12), runId: integrationFinalityFixture.runId })
    )
    expectValid(wrongParentView)

    const firstAttempt = integration.facets.integration.facts.find(
      (fact) => fact._tag === "PromotionAttempt" && fact.attemptOrdinal === TargetPromotionAttemptOrdinal.make(1)
    )
    if (firstAttempt?._tag !== "PromotionAttempt") return yield* Effect.die("first promotion attempt is missing")
    const firstAttemptItem = integration.items.find(
      ({ identity }) => identity.position === firstAttempt.source.position
    )
    if (firstAttemptItem?.occurrence._tag !== "TargetPromotionAttemptRequested") {
      return yield* Effect.die("first promotion attempt item is missing")
    }
    const firstAttemptOccurrence = firstAttemptItem.occurrence
    const invalidInitialItems = integration.items.map((item) =>
      item.identity.position === firstAttempt.source.position
        ? {
            ...item,
            occurrence: {
              ...item.occurrence,
              reason: {
                _tag: "ReconciledExpectedHead" as const,
                observedHeadSha: firstAttemptOccurrence.reason.observedHeadSha,
                previousAttemptOrdinal: TargetPromotionAttemptOrdinal.make(1)
              }
            }
          }
        : item
    )
    const invalidInitialFact = {
      ...firstAttempt,
      reason: {
        _tag: "ReconciledExpectedHead" as const,
        observedHeadSha: firstAttempt.reason.observedHeadSha,
        previousAttemptOrdinal: TargetPromotionAttemptOrdinal.make(1)
      }
    }
    expectInvalid(
      integration,
      {
        ...integration.facets,
        integration: {
          facts: integration.facets.integration.facts.map((fact) => (fact === firstAttempt ? invalidInitialFact : fact))
        }
      },
      invalidInitialItems
    )

    const retried = yield* makeTraceReader({ read: () => Effect.succeed(nonConvergentPromotionRecords()) }).readAt(
      TraceCursor.make({ position: JournalPosition.make(17), runId: integrationFinalityFixture.runId })
    )
    const retriedFact = retried.facets.integration.facts.find(
      (fact) => fact._tag === "PromotionAttempt" && fact.attemptOrdinal === TargetPromotionAttemptOrdinal.make(2)
    )
    if (retriedFact?._tag !== "PromotionAttempt") return yield* Effect.die("retried promotion attempt is missing")
    expectValid(retried)
    const retriedItem = retried.items.find(({ identity }) => identity.position === retriedFact.source.position)
    if (retriedItem?.occurrence._tag !== "TargetPromotionAttemptRequested") {
      return yield* Effect.die("retried promotion item is missing")
    }
    const retriedOccurrence = retriedItem.occurrence
    const wrongRetryItems = retried.items.map((item) =>
      item.identity.position === retriedItem.identity.position
        ? {
            ...item,
            occurrence: {
              ...item.occurrence,
              reason: { _tag: "Initial" as const, observedHeadSha: retriedOccurrence.reason.observedHeadSha }
            }
          }
        : item
    )
    const wrongRetryFact = {
      ...retriedFact,
      reason: { _tag: "Initial" as const, observedHeadSha: retriedFact.reason.observedHeadSha }
    }
    expectInvalid(
      retried,
      {
        ...retried.facets,
        integration: {
          facts: retried.facets.integration.facts.map((fact) => (fact === retriedFact ? wrongRetryFact : fact))
        }
      },
      wrongRetryItems
    )

    const finality = yield* makeTraceReader({ read: () => Effect.succeed(finalityRecords()) }).readAt(
      TraceCursor.make({ position: JournalPosition.make(36), runId: integrationFinalityFixture.runId })
    )
    expectValid(finality)
    const dependant = finality.facets.integration.facts.find(({ _tag }) => _tag === "DependantRelease")
    if (dependant?._tag !== "DependantRelease") return yield* Effect.die("dependant release fixture is missing")
    const wrongSettlementSource = finality.items.find(({ identity }) => identity.position === JournalPosition.make(2))
    if (wrongSettlementSource === undefined) return yield* Effect.die("settlement mismatch item is missing")
    expectInvalid(finality, {
      ...finality.facets,
      integration: {
        facts: finality.facets.integration.facts.map((fact) =>
          fact === dependant ? { ...fact, settlementSource: wrongSettlementSource.identity } : fact
        )
      }
    })

    const quarantine = yield* makeTraceReader({ read: () => Effect.succeed(quarantineRecords()) }).readAt(
      TraceCursor.make({ position: JournalPosition.make(12), runId: integrationFinalityFixture.runId })
    )
    expectValid(quarantine)
    const quarantineFact = quarantine.facets.integration.facts.find(({ _tag }) => _tag === "Quarantine")
    const absentFact = quarantine.facets.integration.facts.find(({ _tag }) => _tag === "ProviderActivityAbsent")
    const directionFact = quarantine.facets.integration.facts.find(({ _tag }) => _tag === "QuarantineDirection")
    const quarantineDisposition = quarantine.facets.recovery.preservationDispositions.find(
      ({ _tag }) => _tag === "IntegrationQuarantined"
    )
    if (
      quarantineFact?._tag !== "Quarantine" ||
      absentFact?._tag !== "ProviderActivityAbsent" ||
      directionFact?._tag !== "QuarantineDirection" ||
      quarantineDisposition?._tag !== "IntegrationQuarantined"
    ) {
      return yield* Effect.die("quarantine fixture did not produce all boundary facets")
    }
    const wrongDetail = IntegrationQuarantineFailureDetail.make("different provider absence detail")
    expectInvalid(quarantine, {
      ...quarantine.facets,
      integration: {
        facts: quarantine.facets.integration.facts.map((fact) =>
          fact === quarantineFact ? { ...fact, basis: { ...fact.basis, detail: wrongDetail } } : fact
        )
      }
    })
    expectInvalid(quarantine, {
      ...quarantine.facets,
      integration: {
        facts: quarantine.facets.integration.facts.map((fact) =>
          fact === absentFact ? { ...fact, run: { ...fact.run, ordinal: IntegratorRunOrdinal.make(2) } } : fact
        )
      }
    })
    expectInvalid(quarantine, {
      ...quarantine.facets,
      integration: {
        facts: quarantine.facets.integration.facts.map((fact) =>
          fact === directionFact
            ? {
                ...fact,
                fingerprint: {
                  ...fact.fingerprint,
                  direction: fact.fingerprint.direction === "Retry" ? "FullRerun" : "Retry"
                }
              }
            : fact
        )
      }
    })
    expectInvalid(quarantine, {
      ...quarantine.facets,
      recovery: {
        ...quarantine.facets.recovery,
        preservationDispositions: [
          {
            ...quarantineDisposition,
            correlation: { ...quarantineDisposition.correlation, sessionId: IntegratorSessionId.make("wrong-session") }
          }
        ]
      }
    })

    const worktreeOperation = makeTaskWorktreeReconciliationOperation({
      operationId: OperationId.make("historical-ready-operation"),
      plannedAttempt,
      predecessorOperationIds: []
    })
    const worktreeProof = PlannedWorktreeReady.make({
      baseSha: plannedAttempt.baseSha,
      branch: plannedAttempt.branch,
      headSha: plannedAttempt.baseSha,
      worktree: plannedAttempt.worktree
    })
    const worktree = yield* makeTraceReader({
      read: () =>
        Effect.succeed([
          record(1, runBeginning),
          record(
            2,
            TaskWorktreeReconciliationIntendedEvent.make({
              operation: worktreeOperation,
              version: workflowJournalEventVersion
            })
          ),
          record(
            3,
            TaskWorktreeReadyEvent.make({
              operationId: worktreeOperation.operationId,
              proof: worktreeProof,
              version: workflowJournalEventVersion
            })
          )
        ])
    }).readAt(TraceCursor.make({ position: JournalPosition.make(3), runId }))
    expectValid(worktree)

    const completeReader = makeTraceReader({ read: () => Effect.succeed(integrationRecords()) })
    const completeCursor = TraceCursor.make({
      position: JournalPosition.make(15),
      runId: integrationFinalityFixture.runId
    })
    const firstComplete = yield* completeReader.readAt(completeCursor)
    const secondComplete = yield* completeReader.readAt(completeCursor)
    vitestExpect(secondComplete).toEqual(firstComplete)
    const committed = integrationRecords()
    const duplicate = committed[1]
    if (duplicate === undefined) return yield* Effect.die("cache fixture is missing a duplicateable record")
    const malformed = [
      ...committed,
      { ...duplicate, key: JournalRecordKey.make("historical-cache-duplicate"), position: JournalPosition.make(16) }
    ]
    const fallbackReader = makeTraceReader({ read: () => Effect.succeed(malformed) })
    const fallbackCursor = TraceCursor.make({
      position: JournalPosition.make(15),
      runId: integrationFinalityFixture.runId
    })
    const firstFallback = yield* fallbackReader.readAt(fallbackCursor)
    const secondFallback = yield* fallbackReader.readAt(fallbackCursor)
    vitestExpect(secondFallback).toEqual(firstFallback)
  })
)
