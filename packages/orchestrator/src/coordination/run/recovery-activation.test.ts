import { it as effectIt } from "@effect/vitest"
import { Effect, Option } from "effect"
import { expect, it } from "vitest"
import {
  activeWorkAuthorityRefreshForOwner,
  activeWorkAuthorityRefreshSubjectsFor,
  RunActivationOpportunity
} from "./run-activation-opportunity.js"
import { acceptedResultFixture } from "../../../test/support/evidence.js"
import {
  AttemptId,
  GitCommitSha,
  GitRepositoryLocator,
  IntegrationTarget,
  IntegrationTargetRef,
  PlannedAttemptExecutorReport,
  PlannedTaskAttempt,
  RunId,
  TaskBranchRef,
  TaskExecutorLocator,
  TaskId,
  TaskRevision,
  WorktreeLocator,
  makeTaskWorkSpecification,
  plannedAttemptExecutorCorrelation
} from "@dalph/contracts"
import { validSnapshot } from "../../../test/task-dag.js"
import { ClaimOwner, ClaimToken } from "../../authorities/task-tracker/claim.js"
import { ActiveTaskClaim } from "../../authorities/task-tracker/claim-mutation.js"
import { InitialControlPolicy, initialRunPolicyRevision } from "../../control/policy.js"
import { TaskWorkCapacity } from "../admission/capacity.js"
import { UntrackedWorktreePath, PlannedWorktreeReady } from "../../authorities/git/worktree.js"
import { TargetLineageObservation } from "../../authorities/git/target-lineage.js"
import { FixtureTarget } from "../../authorities/task-tracker/fixture/target.js"
import { JournalPosition } from "../../workflow-journal/identity.js"
import { workflowJournalEventVersion } from "../../workflow/kernel/event.js"
import { OperationId } from "../../workflow/identity.js"
import { describeJournalEvent } from "../../workflow/registry/event-descriptor.js"
import type { TrackerGraphReadCause } from "../../workflow/registry/operation.js"
import {
  makeTaskAttemptPlanOperation,
  makeTaskClaimAcquisitionOperation,
  makeTaskClaimObservationOperation,
  makeTargetLineageObservationOperation,
  makeTaskWorkSpecificationObservationOperation,
  makeTaskWorktreeObservationOperation,
  makeTrackerGraphObservationOperation
} from "../../workflow/registry/operation.js"
import {
  makeCompleteTaskTrackerFactsObserved,
  makeFocusedTaskClaimFactsObserved,
  makeFocusedTaskClaimFactsUnreadable,
  makeFocusedTaskWorkSpecificationFactsObserved,
  TaskTrackerFactsReadFailed,
  taskTrackerFactsObservedEvent
} from "../../workflow/task-tracker-facts/observation.js"
import { makeTaskTrackerFactsObservedFromRead } from "../../workflow/protocols/task-tracker-read/protocol.js"
import {
  ControlDirectionApplicationOrdinal,
  ControlDirectionAppliedEvent
} from "../../workflow/protocols/control-direction-application/events.js"
import {
  PlannedAttemptExecutorCommandIntendedEvent,
  PlannedAttemptExecutorCommandOrdinal,
  PlannedAttemptExecutorCommandResponseObservedEvent,
  PlannedAttemptExecutorCommandProjectionObservedEvent,
  PlannedAttemptExecutorCommandProjectionObservation,
  PlannedAttemptExecutorCommandProjectionOrdinal,
  PlannedAttemptExecutorReportOrdinal,
  PlannedAttemptExecutorStateObservation,
  PlannedAttemptExecutorStateObservationOrdinal,
  PlannedAttemptExecutorStateObservedEvent,
  defaultPlannedAttemptExecutorSuspensionLimit,
  PlannedAttemptExecutorWorkResponsibilityBeganEvent,
  PlannedAttemptExecutorWorkReportedEvent
} from "../../workflow/protocols/planned-attempt-executor-work/events.js"
import { StartedIntegrationResponsibility } from "../../workflow/protocols/integration-admission/protocol.js"
import {
  TargetPromotionIntendedEvent,
  targetPromotionCorrelationFor
} from "../../workflow/protocols/target-promotion/events.js"
import {
  IntegratorCandidateResourceLocator,
  IntegratorCandidateText,
  IntegratorSessionCorrelation,
  IntegratorNotPreparedDetail,
  IntegratorRunCorrelation,
  IntegratorRunOrdinal,
  IntegratorRunQualifiedCandidate,
  IntegratorResult,
  IntegratorRunResultRecordedEvent,
  IntegratorRunStartedEvent,
  IntegratorSessionFixedEvent,
  IntegratorSessionId as OuterIntegratorSessionId
} from "../../workflow/protocols/integrator/events.js"
import {
  IntegrationQuarantineBasis,
  IntegrationQuarantineCause,
  IntegrationQuarantineDirectionAppliedEvent,
  IntegrationQuarantineDirectionFingerprint,
  IntegrationQuarantineDirectionRequestId,
  IntegrationQuarantineDirectionSubject,
  IntegrationQuarantineResultEvidence,
  IntegrationQuarantinedEvent
} from "../../workflow/protocols/integration-quarantine/events.js"
import {
  IntegrationResponsibilityBeganEvent,
  IntegrationStartedEvent
} from "../../workflow/protocols/integration-admission/events.js"
import { integratorResponsibilityFactsFromCorrelation } from "../../workflow/protocols/integrator/state.js"
import { evaluateIntegratorRetryAuthorization } from "../../workflow/protocols/integrator/retry-authorization.js"
import {
  AttemptChoiceAppliedEvent,
  AttemptChoiceRequestId,
  AttemptImplementationAbandonedEvent
} from "../../workflow/protocols/attempt-choice/events.js"
import {
  CancelledAttemptClaimNoReleaseObservedEvent,
  CancelledAttemptImplementationResponsibilityRelinquishedEvent,
  RunCancellationAppliedEvent
} from "../../workflow/protocols/run-cancellation/events.js"
import type { PlannedAttemptWorktreeObservation } from "../../workflow/protocols/planned-attempt-worktree-observation/protocol.js"
import {
  GitReadIntentRecordedEvent,
  PlannedAttemptWorktreeObservedEvent,
  TargetLineageObservedEvent,
  TaskAttemptPlannedEvent,
  TaskClaimAcquiredEvent,
  TaskClaimAcquisitionIntendedEvent,
  TaskClaimReleaseIntendedEvent,
  taskTrackerReadIntent
} from "../../workflow/registry/event.js"
import { makeWorkflowRunBeganRecord } from "../../workflow-journal/run-lifecycle.js"
import { InRunJournal, type JournalRecord } from "../../workflow-journal/store.js"
import {
  integrationQuarantineDirectionAppliedRecordKey,
  integrationQuarantinedRecordKey,
  integratorRunResultRecordedRecordKey,
  integratorRunStartedRecordKey,
  integratorSessionFixedRecordKey,
  intentRecordKey,
  outcomeRecordKey
} from "../../workflow-journal/record-key.js"
import {
  continuationDecisionFor,
  continuationFreshnessBaselineForAttempt,
  deriveJournalResponsibilityFacts,
  filterFrontierForActivePauses,
  frontierForActivationOpportunity,
  makeRunRecoveryProjection,
  restartReplacementDisposition,
  pendingActiveRefreshGraphReadFor,
  pendingActiveRefreshG2OperationFor,
  safelySuspendedAttemptMayContinue,
  taskPauseSuspensionIsOwed
} from "./recovery-activation.js"
import { authorizedClaimForAttempt } from "./recovery-authority.js"
import { ReconstructedPauseState, type ReconstructedRunState } from "../reconstruction/state.js"
import { reduceWorkflowJournalHistory } from "../reconstruction/history.js"
import { workflowJournalHistoryIssueDetail } from "../reconstruction/history-result.js"
import {
  deriveRunnableFrontier,
  FrontierExplanation,
  ResponsibilityDisposition,
  RunnableFrontierTransition
} from "../frontier/frontier.js"
import type { PlannedAttemptExecutorDisposition } from "../frontier/fresh-facts.js"
import { makeIntegrationTargetResourceController } from "../admission/integration-target-resource.js"
import { graphKeepsTaskEligible } from "../../workflow/protocols/planned-attempt-continuation/authorization-graph.js"
import {
  continuationTrackerReadHasExactPlanPredecessor,
  latestContinuationTrackerReadStatusAfter
} from "../../workflow/protocols/planned-attempt-continuation/tracker-read-freshness.js"

const coverageRunId = RunId.make("recovery-activation-coverage-run")
const coverageTarget = FixtureTarget.make("recovery-activation-coverage-target")
const coverageAttempt = PlannedTaskAttempt.make({
  attemptId: AttemptId.make("recovery-activation-coverage-attempt"),
  baseSha: GitCommitSha.make("a".repeat(40)),
  branch: TaskBranchRef.make("refs/heads/dalph/recovery-activation-coverage"),
  executor: TaskExecutorLocator.make("executor:recovery-activation-coverage"),
  runId: coverageRunId,
  taskId: TaskId.make("recovery-activation-coverage-task"),
  taskRevision: TaskRevision.make("recovery-activation-planned-revision"),
  worktree: WorktreeLocator.make("/worktrees/recovery-activation-coverage")
})
const coveragePolicy = InitialControlPolicy.make({ taskExecutionCapacity: TaskWorkCapacity.make(1) })

const coverageRecord = (position: number, event: JournalRecord["event"], runId = coverageRunId): JournalRecord => ({
  event,
  key: describeJournalEvent(event).expectedKey,
  position: JournalPosition.make(position),
  runId
})

const coverageRunState = (
  records: ReadonlyArray<JournalRecord>,
  responsibility: ReconstructedRunState["responsibility"]["entries"] = [],
  runId = coverageRunId
): ReconstructedRunState => ({
  appliedThrough: records.at(-1)?.position ?? null,
  controlPolicy: Option.none(),
  graphKnowledge: { taskTrackerFacts: [] },
  pause: { run: { _tag: "RunUnpaused" }, tasks: { _tag: "NoTaskPauses" } },
  cancellation: { _tag: "RunCancellationNotApplied" },
  responsibility: { entries: responsibility },
  runId,
  workflowHistory: { records }
})

const coverageRecordsWithBeginning = (records: ReadonlyArray<JournalRecord>): ReadonlyArray<JournalRecord> => [
  makeWorkflowRunBeganRecord(coverageRunId, coverageTarget, coveragePolicy),
  ...records.map((record) => ({ ...record, position: JournalPosition.make(Number(record.position) + 1) }))
]

const coverageAcquisition = {
  operationId: OperationId.make("recovery-activation-coverage-acquisition"),
  owner: ClaimOwner.make("dalph"),
  taskId: coverageAttempt.taskId,
  token: ClaimToken.make("recovery-activation-coverage-token")
}
const coverageClaim = ActiveTaskClaim.make(coverageAcquisition)
const coverageAcquireOperation = makeTaskClaimAcquisitionOperation({
  acquisition: coverageAcquisition,
  predecessorOperationIds: []
})
const coveragePlanOperation = makeTaskAttemptPlanOperation({
  operationId: OperationId.make("recovery-activation-coverage-plan"),
  plannedAttempt: coverageAttempt,
  predecessorOperationIds: [coverageAcquisition.operationId]
})
const coverageResponsibility = {
  _tag: "PlannedAttemptExecutorWorkResponsibility" as const,
  beganAt: JournalPosition.make(4),
  plannedAttempt: coverageAttempt
}
const coverageResponsibilityAfterBeginning = {
  ...coverageResponsibility,
  beganAt: JournalPosition.make(Number(coverageResponsibility.beganAt) + 1)
}

const coveragePlanRecords = (): ReadonlyArray<JournalRecord> => [
  coverageRecord(
    1,
    TaskClaimAcquisitionIntendedEvent.make({
      operation: coverageAcquireOperation,
      version: workflowJournalEventVersion
    })
  ),
  coverageRecord(2, TaskClaimAcquiredEvent.make({ claim: coverageClaim, version: workflowJournalEventVersion })),
  coverageRecord(
    3,
    TaskAttemptPlannedEvent.make({ operation: coveragePlanOperation, version: workflowJournalEventVersion })
  ),
  coverageRecord(
    4,
    PlannedAttemptExecutorWorkResponsibilityBeganEvent.make({
      plannedAttempt: coverageAttempt,
      version: workflowJournalEventVersion
    })
  )
]

const coverageGraphOperation = makeTrackerGraphObservationOperation(
  { _tag: "AttemptContinuation" },
  OperationId.make("recovery-activation-coverage-graph"),
  coverageTarget,
  [coveragePlanOperation.operationId],
  [coverageAttempt.taskId]
)
const coverageGraph = validSnapshot({
  revision: "recovery-activation-coverage-graph-revision",
  tasks: [{ id: coverageAttempt.taskId, lifecycle: { _tag: "Open" }, parentTaskId: null, prerequisiteIds: [] }]
})
const coverageGraphEvent = taskTrackerFactsObservedEvent(
  coverageGraphOperation.operationId,
  makeCompleteTaskTrackerFactsObserved(coverageGraphOperation, coverageGraph)
)
const coverageSpecification = makeTaskWorkSpecification({
  body: "coverage body",
  taskId: coverageAttempt.taskId,
  title: "coverage title"
})
const coverageSpecificationOperation = makeTaskWorkSpecificationObservationOperation(
  OperationId.make("recovery-activation-coverage-specification"),
  coverageTarget,
  coverageAttempt.taskId,
  [coveragePlanOperation.operationId, coverageGraphOperation.operationId]
)
const coverageSpecificationEvent = taskTrackerFactsObservedEvent(
  coverageSpecificationOperation.operationId,
  makeFocusedTaskWorkSpecificationFactsObserved(coverageSpecificationOperation, coverageSpecification)
)
const coverageClaimOperation = makeTaskClaimObservationOperation(
  OperationId.make("recovery-activation-coverage-claim"),
  coverageTarget,
  coverageAttempt.taskId,
  [coveragePlanOperation.operationId, coverageGraphOperation.operationId, coverageSpecificationOperation.operationId]
)
const coverageClaimEvent = taskTrackerFactsObservedEvent(
  coverageClaimOperation.operationId,
  makeFocusedTaskClaimFactsObserved(coverageClaimOperation, coverageClaim)
)
const coverageContinuationTransition = RunnableFrontierTransition.ObservePlannedAttemptExecutorWork({
  acceptedProgress: { _tag: "ExecutorReportAccepted", ordinal: PlannedAttemptExecutorReportOrdinal.make(5) },
  plannedAttempt: coverageAttempt
})

const continuationRecords = (
  claimEvent: typeof coverageClaimEvent,
  worktreeObservation: PlannedAttemptWorktreeObservation,
  includeContinueChoice = false
): ReadonlyArray<JournalRecord> => {
  const worktreeOperation = makeTaskWorktreeObservationOperation({
    operationId: OperationId.make("recovery-activation-coverage-worktree"),
    plannedAttempt: coverageAttempt,
    predecessorOperationIds: [coverageClaimOperation.operationId]
  })
  const records = [
    ...coveragePlanRecords(),
    executorReport(
      5,
      PlannedAttemptExecutorReport.cases.ExecutorWorkSafelySuspended.make({
        correlation: plannedAttemptExecutorCorrelation(coverageAttempt)
      })
    ),
    coverageRecord(6, taskTrackerReadIntent(coverageGraphOperation)),
    coverageRecord(7, coverageGraphEvent),
    coverageRecord(8, taskTrackerReadIntent(coverageSpecificationOperation)),
    coverageRecord(9, coverageSpecificationEvent),
    coverageRecord(10, taskTrackerReadIntent(coverageClaimOperation)),
    coverageRecord(11, claimEvent),
    coverageRecord(
      12,
      GitReadIntentRecordedEvent.make({
        initiatedBy: { _tag: "DalphCoordinator" },
        occurrenceClassification: "InitiatedAction",
        operation: worktreeOperation,
        version: workflowJournalEventVersion
      })
    ),
    coverageRecord(
      13,
      PlannedAttemptWorktreeObservedEvent.make({
        observation: worktreeObservation,
        occurrenceClassification: "NonActionOccurrence",
        operationId: worktreeOperation.operationId,
        version: workflowJournalEventVersion
      })
    )
  ]
  const began = makeWorkflowRunBeganRecord(coverageRunId, coverageTarget, coveragePolicy)
  const shiftedRecords = records.map((record) => ({
    ...record,
    position: JournalPosition.make(Number(record.position) + 1)
  }))
  if (!includeContinueChoice) return [began, ...shiftedRecords]
  return [
    began,
    ...shiftedRecords,
    coverageRecord(
      shiftedRecords.length + 2,
      AttemptChoiceAppliedEvent.make({
        choice: "ContinueExistingAttempt",
        initiatedBy: { _tag: "Operator" },
        occurrenceClassification: "InitiatedAction",
        requestId: AttemptChoiceRequestId.make({
          nonce: "recovery-activation-coverage-continue",
          runId: coverageRunId
        }),
        subject: {
          observedTaskRevision: TaskRevision.make("recovery-activation-observed-revision"),
          plannedAttempt: coverageAttempt
        },
        version: workflowJournalEventVersion
      })
    )
  ]
}

const runPause = (ordinal: number) =>
  ControlDirectionAppliedEvent.make({
    direction: "Pause",
    initiatedBy: { _tag: "Operator" },
    occurrenceClassification: "InitiatedAction",
    ordinal: ControlDirectionApplicationOrdinal.make(ordinal),
    subject: { _tag: "Run", runId: coverageRunId },
    version: workflowJournalEventVersion
  })

const runUnpause = (ordinal: number) =>
  ControlDirectionAppliedEvent.make({
    direction: "Unpause",
    initiatedBy: { _tag: "Operator" },
    occurrenceClassification: "InitiatedAction",
    ordinal: ControlDirectionApplicationOrdinal.make(ordinal),
    subject: { _tag: "Run", runId: coverageRunId },
    version: workflowJournalEventVersion
  })

const executorReport = (position: number, report: PlannedAttemptExecutorReport, ordinal = position): JournalRecord =>
  coverageRecord(
    position,
    PlannedAttemptExecutorWorkReportedEvent.make({
      ordinal: PlannedAttemptExecutorReportOrdinal.make(ordinal),
      report,
      version: workflowJournalEventVersion
    })
  )

const stopChoiceRecord = (position: number): JournalRecord =>
  coverageRecord(
    position,
    AttemptChoiceAppliedEvent.make({
      choice: "StopTaskImplementation",
      initiatedBy: { _tag: "Operator" },
      occurrenceClassification: "InitiatedAction",
      requestId: AttemptChoiceRequestId.make({ nonce: `recovery-activation-stop-${position}`, runId: coverageRunId }),
      subject: {
        observedTaskRevision: TaskRevision.make(`recovery-activation-stop-observed-${position}`),
        plannedAttempt: coverageAttempt
      },
      version: workflowJournalEventVersion
    })
  )

const restartChoiceRecord = (position: number): JournalRecord =>
  coverageRecord(
    position,
    AttemptChoiceAppliedEvent.make({
      choice: "RestartTaskImplementation",
      initiatedBy: { _tag: "Operator" },
      occurrenceClassification: "InitiatedAction",
      requestId: AttemptChoiceRequestId.make({
        nonce: `recovery-activation-restart-${position}`,
        runId: coverageRunId
      }),
      subject: {
        observedTaskRevision: TaskRevision.make(`recovery-activation-restart-observed-${position}`),
        plannedAttempt: coverageAttempt
      },
      version: workflowJournalEventVersion
    })
  )

const executorStateObservation = (
  position: number,
  observation: PlannedAttemptExecutorStateObservation,
  ordinal = 1
): JournalRecord =>
  coverageRecord(
    position,
    PlannedAttemptExecutorStateObservedEvent.make({
      observation,
      occurrenceClassification: "NonActionOccurrence",
      ordinal: PlannedAttemptExecutorStateObservationOrdinal.make(ordinal),
      plannedAttempt: coverageAttempt,
      version: workflowJournalEventVersion
    })
  )

const settledSuspensionCommands = (startPosition: number, count: number): ReadonlyArray<JournalRecord> => {
  const executing = PlannedAttemptExecutorReport.cases.ExecutorWorkExecuting.make({
    correlation: plannedAttemptExecutorCorrelation(coverageAttempt)
  })
  return Array.from({ length: count }, (_, index) => {
    const commandOrdinal = PlannedAttemptExecutorCommandOrdinal.make(index + 1)
    const commandPosition = startPosition + index * 2
    return [
      coverageRecord(
        commandPosition,
        PlannedAttemptExecutorCommandIntendedEvent.make({
          command: "Suspend",
          initiatedBy: { _tag: "DalphCoordinator" },
          occurrenceClassification: "InitiatedAction",
          ordinal: commandOrdinal,
          plannedAttempt: coverageAttempt,
          version: workflowJournalEventVersion
        })
      ),
      coverageRecord(
        commandPosition + 1,
        PlannedAttemptExecutorCommandResponseObservedEvent.make({
          commandOrdinal,
          occurrenceClassification: "NonActionOccurrence",
          plannedAttempt: coverageAttempt,
          report: executing,
          version: workflowJournalEventVersion
        })
      )
    ]
  }).flat()
}

type PausedIntegrationScenario = {
  readonly responsibility: StartedIntegrationResponsibility
  readonly transitions: readonly [RunnableFrontierTransition]
  readonly intents: readonly [JournalRecord["event"]]
}

const pausedIntegrationScenario = (suffix: string, startedAt: number): PausedIntegrationScenario => {
  const acceptedResult = acceptedResultFixture(GitCommitSha.make("b".repeat(40)))
  const integrationTarget = IntegrationTarget.make({
    ref: IntegrationTargetRef.make("refs/heads/main"),
    repository: GitRepositoryLocator.make("/repositories/recovery-activation-paused-integration.git")
  })
  const responsibility = StartedIntegrationResponsibility.make({
    acceptedResult,
    integrationTarget,
    plannedAttempt: coverageAttempt,
    queuedAt: JournalPosition.make(7),
    startedAt: JournalPosition.make(startedAt)
  })
  const qualifiedCandidate = IntegratorRunQualifiedCandidate.make({
    candidateCommit: GitCommitSha.make("c".repeat(40)),
    candidateText: IntegratorCandidateText.make(`refs/candidates/paused-integration-${suffix}`),
    run: {
      ordinal: IntegratorRunOrdinal.make(1),
      session: {
        acceptedResult,
        candidateResource: IntegratorCandidateResourceLocator.make(`resource:paused-integration-${suffix}`),
        expectedTargetHead: coverageAttempt.baseSha,
        integrationTarget,
        plannedAttempt: coverageAttempt,
        queuedAt: responsibility.queuedAt,
        sessionId: OuterIntegratorSessionId.make(`session:paused-integration-${suffix}`),
        startedAt: responsibility.startedAt,
        targetLineageObservedAt: JournalPosition.make(6)
      }
    },
    directParents: [coverageAttempt.baseSha, acceptedResult.commit],
    qualifiedAt: JournalPosition.make(14)
  })
  const promotion = targetPromotionCorrelationFor(qualifiedCandidate)
  const promotionIntent = TargetPromotionIntendedEvent.make({
    correlation: promotion,
    version: workflowJournalEventVersion
  })
  return {
    responsibility,
    transitions: [RunnableFrontierTransition.RunTargetPromotion({ candidate: qualifiedCandidate, responsibility })],
    intents: [promotionIntent]
  }
}

const currentProjectionJournal = (
  runId: RunId,
  target: typeof coverageTarget,
  reconstructed: ReconstructedRunState
) => {
  const began = makeWorkflowRunBeganRecord(runId, target, coveragePolicy)
  const journal = InRunJournal.of({
    append: () => Effect.die("projection coverage does not append"),
    read: () => Effect.succeed([began])
  })
  return Object.assign(journal, { state: { get: Effect.succeed({ reconstructed }) } })
}

const directionProjectionFixture = (direction: "Retry" | "FullRerun", graphAfterDirection = true) => {
  const acceptedResult = acceptedResultFixture(GitCommitSha.make("b".repeat(40)))
  const integrationTarget = IntegrationTarget.make({
    ref: IntegrationTargetRef.make("refs/heads/main"),
    repository: GitRepositoryLocator.make(`/repositories/recovery-activation-direction-${direction}.git`)
  })
  const queuePosition = JournalPosition.make(graphAfterDirection ? 17 : 19)
  const startedPosition = JournalPosition.make(graphAfterDirection ? 18 : 20)
  const lineageIntentPosition = JournalPosition.make(graphAfterDirection ? 19 : 21)
  const lineageObservationPosition = JournalPosition.make(graphAfterDirection ? 20 : 22)
  const sessionPosition = JournalPosition.make(graphAfterDirection ? 21 : 23)
  const runStartedPosition = JournalPosition.make(graphAfterDirection ? 22 : 24)
  const resultPosition = JournalPosition.make(graphAfterDirection ? 23 : 25)
  const quarantinePosition = JournalPosition.make(graphAfterDirection ? 24 : 26)
  const directionPosition = JournalPosition.make(graphAfterDirection ? 25 : 27)
  const trackerReadStartPosition = 11
  const refreshedGraphStartPosition = graphAfterDirection ? 26 : 17
  const lineageOperation = makeTargetLineageObservationOperation({
    integrationTarget,
    operationId: OperationId.make(`direction-${direction.toLowerCase()}-fixed-lineage`),
    plannedAttempt: coverageAttempt,
    predecessorOperationIds: []
  })
  const lineageObservation = TargetLineageObservation.make({
    plannedBaseIsAncestorOfTargetHead: true,
    plannedBaseSha: coverageAttempt.baseSha,
    targetHeadSha: coverageAttempt.baseSha
  })
  const lineageRecord = coverageRecord(
    lineageObservationPosition,
    TargetLineageObservedEvent.make({
      observation: lineageObservation,
      occurrenceClassification: "NonActionOccurrence",
      operationId: lineageOperation.operationId,
      plannedAttempt: coverageAttempt,
      version: workflowJournalEventVersion
    })
  )
  const correlation = IntegratorSessionCorrelation.make({
    acceptedResult,
    candidateResource: IntegratorCandidateResourceLocator.make(`direction-resource-${direction.toLowerCase()}`),
    expectedTargetHead: coverageAttempt.baseSha,
    integrationTarget,
    plannedAttempt: coverageAttempt,
    queuedAt: queuePosition,
    sessionId: OuterIntegratorSessionId.make(`direction-session-${direction.toLowerCase()}`),
    startedAt: startedPosition,
    targetLineageObservedAt: lineageRecord.position
  })
  const run = IntegratorRunCorrelation.make({ ordinal: IntegratorRunOrdinal.make(1), session: correlation })
  const resultDetail = IntegratorNotPreparedDetail.make("the outer Integrator returned no candidate")
  const sessionRecord = {
    ...coverageRecord(
      sessionPosition,
      IntegratorSessionFixedEvent.make({ correlation, version: workflowJournalEventVersion })
    ),
    key: integratorSessionFixedRecordKey(integratorResponsibilityFactsFromCorrelation(correlation))
  }
  const runStartedRecord = {
    ...coverageRecord(
      runStartedPosition,
      IntegratorRunStartedEvent.make({ run, version: workflowJournalEventVersion })
    ),
    key: integratorRunStartedRecordKey(run)
  }
  const resultRecord = {
    ...coverageRecord(
      resultPosition,
      IntegratorRunResultRecordedEvent.make({
        result: IntegratorResult.cases.NotPrepared.make({ correlation, detail: resultDetail }),
        run,
        version: workflowJournalEventVersion
      })
    ),
    key: integratorRunResultRecordedRecordKey(run)
  }
  const quarantine = IntegrationQuarantinedEvent.make({
    basis: IntegrationQuarantineBasis.cases.ConclusiveResult.make({
      cause: IntegrationQuarantineCause.cases.NotPrepared.make({ detail: resultDetail }),
      evidence: IntegrationQuarantineResultEvidence.make({ resultRecordedAt: resultRecord.position })
    }),
    correlation,
    occurrenceClassification: "NonActionOccurrence",
    version: workflowJournalEventVersion
  })
  const quarantineRecord = {
    ...coverageRecord(quarantinePosition, quarantine),
    key: integrationQuarantinedRecordKey(correlation.sessionId, quarantine.basis)
  }
  const directionEvent = IntegrationQuarantineDirectionAppliedEvent.make({
    fingerprint: IntegrationQuarantineDirectionFingerprint.make({
      direction,
      quarantineAt: quarantineRecord.position,
      sessionId: correlation.sessionId
    }),
    initiatedBy: { _tag: "Operator" },
    occurrenceClassification: "InitiatedAction",
    requestId: IntegrationQuarantineDirectionRequestId.make({
      nonce: `direction-${direction.toLowerCase()}-request`,
      runId: coverageRunId
    }),
    version: workflowJournalEventVersion
  })
  const directionRecord = {
    ...coverageRecord(directionPosition, directionEvent),
    key: integrationQuarantineDirectionAppliedRecordKey(
      IntegrationQuarantineDirectionSubject.make({
        quarantineAt: quarantineRecord.position,
        sessionId: correlation.sessionId
      })
    )
  }
  const integrationRecords = [
    coverageRecord(
      Number(queuePosition),
      IntegrationResponsibilityBeganEvent.make({
        acceptedResult,
        integrationTarget,
        plannedAttempt: coverageAttempt,
        version: workflowJournalEventVersion
      })
    ),
    coverageRecord(
      Number(startedPosition),
      IntegrationStartedEvent.make({
        acceptedResult,
        integrationTarget,
        plannedAttempt: coverageAttempt,
        responsibilityBeganAt: queuePosition,
        version: workflowJournalEventVersion
      })
    )
  ]
  const executing = PlannedAttemptExecutorReport.cases.ExecutorWorkExecuting.make({
    correlation: plannedAttemptExecutorCorrelation(coverageAttempt)
  })
  const acceptedTerminal = PlannedAttemptExecutorReport.cases.ExecutorWorkTerminal.make({
    correlation: plannedAttemptExecutorCorrelation(coverageAttempt),
    result: { _tag: "Accepted", acceptedResult }
  })
  const beginOrdinal = PlannedAttemptExecutorCommandOrdinal.make(1)
  const executorBeginRecords = [
    coverageRecord(
      6,
      PlannedAttemptExecutorCommandIntendedEvent.make({
        command: "Begin",
        initiatedBy: { _tag: "DalphCoordinator" },
        occurrenceClassification: "InitiatedAction",
        ordinal: beginOrdinal,
        plannedAttempt: coverageAttempt,
        version: workflowJournalEventVersion
      })
    ),
    coverageRecord(
      7,
      PlannedAttemptExecutorCommandResponseObservedEvent.make({
        commandOrdinal: beginOrdinal,
        occurrenceClassification: "NonActionOccurrence",
        plannedAttempt: coverageAttempt,
        report: executing,
        version: workflowJournalEventVersion
      })
    ),
    executorReport(8, executing, 1),
    executorStateObservation(
      9,
      PlannedAttemptExecutorStateObservation.cases.ExactExecutorReport.make({ report: acceptedTerminal }),
      1
    ),
    executorReport(10, acceptedTerminal, 2)
  ]
  const beganRecord = makeWorkflowRunBeganRecord(coverageRunId, coverageTarget, coveragePolicy)
  const shiftedPlanRecords = coveragePlanRecords().map((record) => ({
    ...record,
    position: JournalPosition.make(Number(record.position) + 1)
  }))
  const trackerRecords = [
    coverageRecord(trackerReadStartPosition, taskTrackerReadIntent(coverageGraphOperation)),
    coverageRecord(Number(trackerReadStartPosition) + 1, coverageGraphEvent),
    coverageRecord(Number(trackerReadStartPosition) + 2, taskTrackerReadIntent(coverageSpecificationOperation)),
    coverageRecord(Number(trackerReadStartPosition) + 3, coverageSpecificationEvent),
    coverageRecord(Number(trackerReadStartPosition) + 4, taskTrackerReadIntent(coverageClaimOperation)),
    coverageRecord(Number(trackerReadStartPosition) + 5, coverageClaimEvent)
  ]
  const refreshedGraphOperation = makeTrackerGraphObservationOperation(
    { _tag: "WorkflowEstablishment" },
    OperationId.make(`recovery-activation-coverage-refreshed-graph-${direction.toLowerCase()}`),
    coverageTarget,
    [coverageClaimOperation.operationId],
    [coverageAttempt.taskId]
  )
  const refreshedGraphEvent = taskTrackerFactsObservedEvent(
    refreshedGraphOperation.operationId,
    makeCompleteTaskTrackerFactsObserved(refreshedGraphOperation, coverageGraph)
  )
  const refreshedGraphRecords = [
    coverageRecord(refreshedGraphStartPosition, taskTrackerReadIntent(refreshedGraphOperation)),
    coverageRecord(Number(refreshedGraphStartPosition) + 1, refreshedGraphEvent)
  ]
  const records = [
    beganRecord,
    ...shiftedPlanRecords,
    ...executorBeginRecords,
    ...integrationRecords,
    coverageRecord(
      lineageIntentPosition,
      GitReadIntentRecordedEvent.make({
        initiatedBy: { _tag: "DalphCoordinator" },
        occurrenceClassification: "InitiatedAction",
        operation: lineageOperation,
        version: workflowJournalEventVersion
      })
    ),
    lineageRecord,
    sessionRecord,
    runStartedRecord,
    resultRecord,
    quarantineRecord,
    directionRecord,
    ...trackerRecords,
    ...refreshedGraphRecords
  ].toSorted((left, right) => left.position - right.position)
  const reduction = reduceWorkflowJournalHistory(coverageRunId, records)
  if (reduction._tag === "InvalidWorkflowJournalHistory") {
    return expect.fail(
      `direction projection fixture must be a valid journal history: ${reduction.issues
        .map(workflowJournalHistoryIssueDetail)
        .join("; ")}`
    )
  }
  const reconstructed = reduction.runState
  return { direction, directionRecord, integrationTarget, lineageOperation, reconstructed }
}

effectIt.effect(
  "acquires the target before a fresh direction-bound lineage read and reuses the read after restart",
  () =>
    Effect.gen(function* () {
      const direction = "Retry" as const
      for (const graphAfterDirection of [true, false]) {
        const fixture = directionProjectionFixture(direction, graphAfterDirection)
        const resources = yield* makeIntegrationTargetResourceController()
        const recovery = yield* makeRunRecoveryProjection(coverageRunId, fixture.integrationTarget, resources).pipe(
          Effect.provideService(
            InRunJournal,
            currentProjectionJournal(coverageRunId, coverageTarget, fixture.reconstructed)
          )
        )
        const firstProjection = yield* recovery.readDeliveryProjection
        const acquire = firstProjection.frontier.transitions.find(
          ({ _tag }) => _tag === "AcquireStartedIntegrationTarget"
        )
        if (acquire?._tag !== "AcquireStartedIntegrationTarget") {
          return yield* Effect.die(
            `expected ${direction} to reacquire its integration target; got ${firstProjection.frontier.transitions.map(({ _tag }) => _tag).join(",")}; explanations ${firstProjection.frontier.explanations.map(({ _tag }) => _tag).join(",")}`
          )
        }
        expect(
          firstProjection.frontier.transitions.some(
            ({ _tag }) => _tag === "ObservePlannedAttemptContinuationTargetLineage"
          )
        ).toBe(false)
        yield* resources.acquire(acquire.responsibility)
        yield* resources.publishAcceptedOwnership(acquire.responsibility)

        const heldRecovery = yield* makeRunRecoveryProjection(coverageRunId, fixture.integrationTarget, resources).pipe(
          Effect.provideService(
            InRunJournal,
            currentProjectionJournal(coverageRunId, coverageTarget, fixture.reconstructed)
          )
        )
        const heldProjection = yield* heldRecovery.readDeliveryProjection
        const firstRead = heldProjection.frontier.transitions.find(
          ({ _tag }) => _tag === "ObservePlannedAttemptContinuationTargetLineage"
        )
        if (firstRead?._tag !== "ObservePlannedAttemptContinuationTargetLineage") {
          const sessionRecord = fixture.reconstructed.workflowHistory.records.find(
            ({ event }) => event._tag === "IntegratorSessionFixed"
          )
          const authorization =
            sessionRecord?.event._tag === "IntegratorSessionFixed"
              ? evaluateIntegratorRetryAuthorization(
                  fixture.reconstructed.workflowHistory.records,
                  IntegratorRunCorrelation.make({
                    ordinal: IntegratorRunOrdinal.make(2),
                    session: sessionRecord.event.correlation
                  })
                )
              : undefined
          return yield* Effect.die(
            `expected ${direction} direction-bound target-lineage read; got ${heldProjection.frontier.transitions.map(({ _tag }) => _tag).join(",")}; authorization ${JSON.stringify(authorization)}`
          )
        }
        expect(firstRead.operation.predecessorOperationIds).toEqual([fixture.lineageOperation.operationId])
        expect(firstRead.operation.operationId).toContain(`d:${Number(fixture.directionRecord.position)}`)

        const intent = GitReadIntentRecordedEvent.make({
          initiatedBy: { _tag: "DalphCoordinator" },
          occurrenceClassification: "InitiatedAction",
          operation: firstRead.operation,
          version: workflowJournalEventVersion
        })
        const intentPosition = JournalPosition.make(Number(fixture.reconstructed.appliedThrough ?? 0) + 1)
        const afterIntent = {
          ...fixture.reconstructed,
          appliedThrough: intentPosition,
          workflowHistory: {
            records: [...fixture.reconstructed.workflowHistory.records, coverageRecord(intentPosition, intent)]
          }
        }
        const restarted = yield* makeRunRecoveryProjection(coverageRunId, fixture.integrationTarget, resources).pipe(
          Effect.provideService(InRunJournal, currentProjectionJournal(coverageRunId, coverageTarget, afterIntent))
        )
        const restartedProjection = yield* restarted.readDeliveryProjection
        const restartedRead = restartedProjection.frontier.transitions.find(
          ({ _tag }) => _tag === "ObservePlannedAttemptContinuationTargetLineage"
        )
        expect(restartedRead).toEqual(firstRead)

        const fixedSession = fixture.reconstructed.workflowHistory.records.find(
          ({ event }) => event._tag === "IntegratorSessionFixed"
        )
        if (fixedSession?.event._tag !== "IntegratorSessionFixed") {
          return yield* Effect.die("expected fixed Integrator session")
        }
        const observationPosition = JournalPosition.make(Number(intentPosition) + 1)
        const observation = TargetLineageObservedEvent.make({
          observation: {
            plannedBaseIsAncestorOfTargetHead: true,
            plannedBaseSha: acquire.responsibility.plannedAttempt.baseSha,
            targetHeadSha: fixedSession.event.correlation.expectedTargetHead
          },
          occurrenceClassification: "NonActionOccurrence",
          operationId: firstRead.operation.operationId,
          plannedAttempt: acquire.responsibility.plannedAttempt,
          version: workflowJournalEventVersion
        })
        const afterObservation = {
          ...afterIntent,
          appliedThrough: observationPosition,
          workflowHistory: {
            records: [...afterIntent.workflowHistory.records, coverageRecord(observationPosition, observation)]
          }
        }
        const restartedResources = yield* makeIntegrationTargetResourceController()
        const afterObservationRecovery = yield* makeRunRecoveryProjection(
          coverageRunId,
          fixture.integrationTarget,
          restartedResources
        ).pipe(
          Effect.provideService(InRunJournal, currentProjectionJournal(coverageRunId, coverageTarget, afterObservation))
        )
        const reacquire = (yield* afterObservationRecovery.readDeliveryProjection).frontier.transitions.find(
          ({ _tag }) => _tag === "AcquireStartedIntegrationTarget"
        )
        if (reacquire?._tag !== "AcquireStartedIntegrationTarget") {
          const afterObservationProjection = yield* afterObservationRecovery.readDeliveryProjection
          return yield* Effect.die(
            `expected target reacquisition after the completed Retry lineage read; got ${afterObservationProjection.frontier.transitions.map(({ _tag }) => _tag).join(",")}; explanations ${afterObservationProjection.frontier.explanations.map(({ _tag }) => _tag).join(",")}`
          )
        }
        yield* restartedResources.acquire(reacquire.responsibility)
        yield* restartedResources.publishAcceptedOwnership(reacquire.responsibility)
        const heldAfterObservationRecovery = yield* makeRunRecoveryProjection(
          coverageRunId,
          fixture.integrationTarget,
          restartedResources
        ).pipe(
          Effect.provideService(InRunJournal, currentProjectionJournal(coverageRunId, coverageTarget, afterObservation))
        )
        const runTwo = (yield* heldAfterObservationRecovery.readDeliveryProjection).frontier.transitions.find(
          ({ _tag }) => _tag === "RunIntegrator"
        )
        expect(runTwo?._tag === "RunIntegrator" ? runTwo.run.ordinal : undefined).toBe(2)

        const laterClaimPosition = JournalPosition.make(Number(observationPosition) + 1)
        const laterGraphPosition = JournalPosition.make(Number(observationPosition) + 2)
        const laterGraphOperation = makeTrackerGraphObservationOperation(
          { _tag: "WorkflowEstablishment" },
          OperationId.make(`direction-retry-graph-after-lineage:${graphAfterDirection}`),
          coverageTarget,
          [],
          [coverageAttempt.taskId]
        )
        const laterClaimOperation = makeTaskClaimObservationOperation(
          OperationId.make(`direction-retry-claim-after-lineage:${graphAfterDirection}`),
          coverageTarget,
          coverageAttempt.taskId,
          [coverageGraphOperation.operationId]
        )
        const afterLaterGraph = {
          ...afterObservation,
          appliedThrough: laterGraphPosition,
          workflowHistory: {
            records: [
              ...afterObservation.workflowHistory.records,
              coverageRecord(
                laterClaimPosition,
                taskTrackerFactsObservedEvent(
                  laterClaimOperation.operationId,
                  makeFocusedTaskClaimFactsObserved(laterClaimOperation, coverageClaim)
                )
              ),
              coverageRecord(
                laterGraphPosition,
                taskTrackerFactsObservedEvent(
                  laterGraphOperation.operationId,
                  makeCompleteTaskTrackerFactsObserved(laterGraphOperation, coverageGraph)
                )
              )
            ]
          }
        }
        const graphRefreshRecovery = yield* makeRunRecoveryProjection(
          coverageRunId,
          fixture.integrationTarget,
          restartedResources
        ).pipe(
          Effect.provideService(InRunJournal, currentProjectionJournal(coverageRunId, coverageTarget, afterLaterGraph))
        )
        const refreshedRead = (yield* graphRefreshRecovery.readDeliveryProjection).frontier.transitions.find(
          ({ _tag }) => _tag === "ObservePlannedAttemptContinuationTargetLineage"
        )
        expect(refreshedRead?._tag === "ObservePlannedAttemptContinuationTargetLineage").toBe(true)
        expect(
          refreshedRead?._tag === "ObservePlannedAttemptContinuationTargetLineage"
            ? refreshedRead.operation.operationId
            : undefined
        ).not.toBe(firstRead.operation.operationId)
      }

      const withoutDirection = directionProjectionFixture("Retry")
      const recordsWithoutDirection = withoutDirection.reconstructed.workflowHistory.records.filter(
        ({ position }) => position !== withoutDirection.directionRecord.position
      )
      const noDirectionState = {
        ...withoutDirection.reconstructed,
        workflowHistory: { records: recordsWithoutDirection }
      }
      const noDirectionResources = yield* makeIntegrationTargetResourceController()
      const noDirectionRecovery = yield* makeRunRecoveryProjection(
        coverageRunId,
        withoutDirection.integrationTarget,
        noDirectionResources
      ).pipe(
        Effect.provideService(InRunJournal, currentProjectionJournal(coverageRunId, coverageTarget, noDirectionState))
      )
      expect(
        (yield* noDirectionRecovery.readDeliveryProjection).frontier.transitions.some(
          ({ _tag }) => _tag === "ObservePlannedAttemptContinuationTargetLineage"
        )
      ).toBe(false)

      const graphlessRecords = withoutDirection.reconstructed.workflowHistory.records.filter(({ event }) => {
        if (event._tag === "TaskTrackerReadIntentRecorded") return event.operation._tag !== "ReadTrackerGraph"
        if (event._tag !== "TaskTrackerFactsObserved") return true
        return (
          event.observation._tag !== "CompleteTaskTrackerFacts" &&
          event.observation._tag !== "UnchangedTaskTrackerFactsReconfirmed"
        )
      })
      const graphlessState = { ...withoutDirection.reconstructed, workflowHistory: { records: graphlessRecords } }
      const graphlessResources = yield* makeIntegrationTargetResourceController()
      const graphlessRecovery = yield* makeRunRecoveryProjection(
        coverageRunId,
        withoutDirection.integrationTarget,
        graphlessResources
      ).pipe(
        Effect.provideService(InRunJournal, currentProjectionJournal(coverageRunId, coverageTarget, graphlessState))
      )
      const graphlessProjection = yield* graphlessRecovery.readDeliveryProjection
      expect(
        graphlessProjection.frontier.transitions.some(
          ({ _tag }) => _tag === "ObservePlannedAttemptContinuationTargetLineage"
        )
      ).toBe(false)
    })
)

effectIt.effect("requests a fresh direction-bound lineage read for FullRerun before fixing a successor", () =>
  Effect.gen(function* () {
    const fixture = directionProjectionFixture("FullRerun")
    const resources = yield* makeIntegrationTargetResourceController()
    const recovery = yield* makeRunRecoveryProjection(coverageRunId, fixture.integrationTarget, resources).pipe(
      Effect.provideService(
        InRunJournal,
        currentProjectionJournal(coverageRunId, coverageTarget, fixture.reconstructed)
      )
    )
    const first = yield* recovery.readDeliveryProjection
    const acquire = first.frontier.transitions.find(({ _tag }) => _tag === "AcquireStartedIntegrationTarget")
    if (acquire?._tag !== "AcquireStartedIntegrationTarget") {
      return yield* Effect.die("FullRerun must reacquire its existing responsibility before the fresh Git read")
    }
    yield* resources.acquire(acquire.responsibility)
    yield* resources.publishAcceptedOwnership(acquire.responsibility)

    const heldRecovery = yield* makeRunRecoveryProjection(coverageRunId, fixture.integrationTarget, resources).pipe(
      Effect.provideService(
        InRunJournal,
        currentProjectionJournal(coverageRunId, coverageTarget, fixture.reconstructed)
      )
    )
    const read = (yield* heldRecovery.readDeliveryProjection).frontier.transitions.find(
      ({ _tag }) => _tag === "ObservePlannedAttemptContinuationTargetLineage"
    )
    if (read?._tag !== "ObservePlannedAttemptContinuationTargetLineage") {
      return yield* Effect.die("FullRerun must request its direction-bound target-lineage observation")
    }
    expect(read.operation.predecessorOperationIds).toEqual([fixture.lineageOperation.operationId])
    expect(read.operation.operationId).toContain(`d:${Number(fixture.directionRecord.position)}`)
  })
)

effectIt.effect(
  "reacquires a direction-quarantined target when an unfinished prerequisite suppresses ordinary admission",
  () =>
    Effect.gen(function* () {
      const fixture = directionProjectionFixture("Retry")
      const prerequisiteTaskId = TaskId.make("recovery-activation-direction-prerequisite")
      const blockedGraphOperation = makeTrackerGraphObservationOperation(
        { _tag: "WorkflowEstablishment" },
        OperationId.make("recovery-activation-direction-blocked-graph"),
        coverageTarget,
        [coverageClaimOperation.operationId],
        [coverageAttempt.taskId, prerequisiteTaskId]
      )
      const blockedGraph = validSnapshot({
        revision: "recovery-activation-direction-blocked-graph-revision",
        tasks: [
          {
            id: coverageAttempt.taskId,
            lifecycle: { _tag: "Open" },
            parentTaskId: null,
            prerequisiteIds: [prerequisiteTaskId]
          },
          { id: prerequisiteTaskId, lifecycle: { _tag: "Open" }, parentTaskId: null, prerequisiteIds: [] }
        ]
      })
      const blockedGraphRecords = [
        coverageRecord(28, taskTrackerReadIntent(blockedGraphOperation)),
        coverageRecord(
          29,
          taskTrackerFactsObservedEvent(
            blockedGraphOperation.operationId,
            makeCompleteTaskTrackerFactsObserved(blockedGraphOperation, blockedGraph)
          )
        )
      ]
      const reduced = reduceWorkflowJournalHistory(coverageRunId, [
        ...fixture.reconstructed.workflowHistory.records,
        ...blockedGraphRecords
      ])
      if (reduced._tag === "InvalidWorkflowJournalHistory") {
        return yield* Effect.die(
          `blocked prerequisite fixture must be a valid journal history: ${reduced.issues
            .map(workflowJournalHistoryIssueDetail)
            .join("; ")}`
        )
      }
      const resources = yield* makeIntegrationTargetResourceController()
      const recovery = yield* makeRunRecoveryProjection(coverageRunId, fixture.integrationTarget, resources).pipe(
        Effect.provideService(InRunJournal, currentProjectionJournal(coverageRunId, coverageTarget, reduced.runState))
      )

      const projection = yield* recovery.readDeliveryProjection
      const acquireTransitions = projection.frontier.transitions.filter(
        ({ _tag }) => _tag === "AcquireStartedIntegrationTarget"
      )
      expect(projection.frontier.transitions.map(({ _tag }) => _tag)).toEqual(["AcquireStartedIntegrationTarget"])
      expect(acquireTransitions).toHaveLength(1)
      expect(acquireTransitions[0]).toEqual(
        RunnableFrontierTransition.AcquireStartedIntegrationTarget({
          responsibility: expect.objectContaining({ plannedAttempt: coverageAttempt })
        })
      )
      expect(projection.frontier.explanations).toContainEqual(
        expect.objectContaining({ _tag: "IntegrationDependencyWait", prerequisiteTaskIds: [prerequisiteTaskId] })
      )
    })
)

effectIt.effect("fails closed when recovered quarantine-direction evidence is not exact", () =>
  Effect.gen(function* () {
    const fixture = directionProjectionFixture("Retry")
    const records = fixture.reconstructed.workflowHistory.records
    const session = records.find(({ event }) => event._tag === "IntegratorSessionFixed")
    const runStart = records.find(({ event }) => event._tag === "IntegratorRunStarted")
    const directionEvent = fixture.directionRecord.event
    if (
      session?.event._tag !== "IntegratorSessionFixed" ||
      runStart?.event._tag !== "IntegratorRunStarted" ||
      directionEvent._tag !== "IntegrationQuarantineDirectionApplied"
    ) {
      return yield* Effect.die("expected fixed session, initial run, and quarantine direction evidence")
    }
    const invalidHistories = [
      ["missing quarantine", records.filter(({ event }) => event._tag !== "IntegrationQuarantined")],
      ["duplicate session", [...records, { ...session, position: JournalPosition.make(24) }]],
      [
        "foreign session key",
        records.map((record) => (record === session ? { ...record, key: fixture.directionRecord.key } : record))
      ],
      ["duplicate run", [...records, { ...runStart }]],
      [
        "foreign run key",
        records.map((record) => (record === runStart ? { ...record, key: fixture.directionRecord.key } : record))
      ],
      [
        "missing fixed lineage",
        records.filter(
          ({ event }) =>
            event._tag !== "TargetLineageObserved" || event.operationId !== fixture.lineageOperation.operationId
        )
      ],
      [
        "foreign direction Journal Run",
        records.map((record) =>
          record !== fixture.directionRecord
            ? record
            : {
                ...record,
                event: IntegrationQuarantineDirectionAppliedEvent.make({
                  ...directionEvent,
                  requestId: IntegrationQuarantineDirectionRequestId.make({
                    nonce: "direction-retry-foreign-run",
                    runId: RunId.make("foreign-direction-run")
                  })
                })
              }
        )
      ]
    ] as const

    for (const [label, invalidRecords] of invalidHistories) {
      const resources = yield* makeIntegrationTargetResourceController()
      const invalidState = { ...fixture.reconstructed, workflowHistory: { records: invalidRecords } }
      const recovery = yield* makeRunRecoveryProjection(coverageRunId, fixture.integrationTarget, resources).pipe(
        Effect.provideService(InRunJournal, currentProjectionJournal(coverageRunId, coverageTarget, invalidState))
      )
      const projection = yield* recovery.readDeliveryProjection
      expect(
        projection.frontier.transitions.some(
          (transition) =>
            transition._tag === "ObservePlannedAttemptContinuationTargetLineage" &&
            transition.operation.operationId.includes(`d:${Number(fixture.directionRecord.position)}`)
        ),
        label
      ).toBe(false)
    }
  })
)

it("suspends a running grouping descendant and reopens it after current facts move it outside the parent", () => {
  const runId = RunId.make("grouping-descendant-suspension-run")
  const descendantTaskId = TaskId.make("D")
  const plannedAttempt = PlannedTaskAttempt.make({
    attemptId: AttemptId.make("grouping-descendant-attempt"),
    baseSha: GitCommitSha.make("1".repeat(40)),
    branch: TaskBranchRef.make("refs/heads/dalph/grouping-descendant-attempt"),
    executor: TaskExecutorLocator.make("executor:controlled-fake"),
    runId,
    taskId: descendantTaskId,
    taskRevision: TaskRevision.make("grouping-descendant-revision"),
    worktree: WorktreeLocator.make("/dalph/grouping-descendant-attempt")
  })
  const graph = validSnapshot({
    revision: "running-grouping-descendant-v1",
    tasks: [
      { id: "A", lifecycle: { _tag: "Open" }, parentTaskId: null, prerequisiteIds: [] },
      { id: "D", lifecycle: { _tag: "Open" }, parentTaskId: "A", prerequisiteIds: [] }
    ]
  })
  const graphRead = makeTrackerGraphObservationOperation(
    { _tag: "WorkflowEstablishment" },
    OperationId.make("grouping-descendant-graph-read"),
    FixtureTarget.make("grouping-descendant-target")
  )
  const records = [
    {
      position: JournalPosition.make(1),
      event: taskTrackerFactsObservedEvent(
        graphRead.operationId,
        makeCompleteTaskTrackerFactsObserved(graphRead, graph)
      )
    },
    {
      position: JournalPosition.make(3),
      event: PlannedAttemptExecutorWorkReportedEvent.make({
        ordinal: PlannedAttemptExecutorReportOrdinal.make(1),
        report: PlannedAttemptExecutorReport.cases.ExecutorWorkExecuting.make({
          correlation: plannedAttemptExecutorCorrelation(plannedAttempt)
        }),
        version: workflowJournalEventVersion
      })
    },
    {
      position: JournalPosition.make(4),
      event: ControlDirectionAppliedEvent.make({
        direction: "Pause",
        initiatedBy: { _tag: "Operator" },
        occurrenceClassification: "InitiatedAction",
        ordinal: ControlDirectionApplicationOrdinal.make(1),
        subject: { _tag: "Task", runId, taskId: TaskId.make("A") },
        version: workflowJournalEventVersion
      })
    }
  ]

  expect(taskPauseSuspensionIsOwed(records, plannedAttempt, JournalPosition.make(2), graph)).toBe(true)

  const regrouped = validSnapshot({
    revision: "regrouped-descendant-v2",
    tasks: [
      { id: "A", lifecycle: { _tag: "Open" }, parentTaskId: null, prerequisiteIds: [] },
      { id: "D", lifecycle: { _tag: "Open" }, parentTaskId: null, prerequisiteIds: [] }
    ]
  })
  const pause = ReconstructedPauseState.make({
    run: { _tag: "RunUnpaused" },
    tasks: { _tag: "TaskPauses", taskIds: [TaskId.make("A")] }
  })
  expect(safelySuspendedAttemptMayContinue(pause, plannedAttempt, graph)).toBe(false)
  expect(safelySuspendedAttemptMayContinue(pause, plannedAttempt, regrouped)).toBe(true)
  expect(taskPauseSuspensionIsOwed(records, plannedAttempt, JournalPosition.make(2), regrouped)).toBe(true)

  const lateGroupingGraphRead = makeTrackerGraphObservationOperation(
    { _tag: "WorkflowEstablishment" },
    OperationId.make("late-grouping-descendant-graph-read"),
    FixtureTarget.make("grouping-descendant-target")
  )
  const reconfirmedGroupingGraphRead = makeTrackerGraphObservationOperation(
    { _tag: "WorkflowEstablishment" },
    OperationId.make("reconfirmed-grouping-descendant-graph-read"),
    FixtureTarget.make("grouping-descendant-target")
  )
  const lateGroupingGraphEvent = taskTrackerFactsObservedEvent(
    lateGroupingGraphRead.operationId,
    makeCompleteTaskTrackerFactsObserved(lateGroupingGraphRead, graph)
  )
  const reconfirmedGroupingGraphEvent = makeTaskTrackerFactsObservedFromRead(
    [{ event: lateGroupingGraphEvent }],
    reconfirmedGroupingGraphRead,
    graph
  )
  const responsibilityBegan = records[1]
  const taskPaused = records[2]
  if (responsibilityBegan === undefined || taskPaused === undefined) return expect.fail("expected pause records")
  const lateGroupingRecords = [
    {
      position: JournalPosition.make(1),
      event: taskTrackerFactsObservedEvent(
        graphRead.operationId,
        makeCompleteTaskTrackerFactsObserved(graphRead, regrouped)
      )
    },
    responsibilityBegan,
    taskPaused,
    {
      position: JournalPosition.make(5),
      event: PlannedAttemptExecutorWorkReportedEvent.make({
        ordinal: PlannedAttemptExecutorReportOrdinal.make(2),
        report: PlannedAttemptExecutorReport.cases.ExecutorWorkSafelySuspended.make({
          correlation: plannedAttemptExecutorCorrelation(plannedAttempt)
        }),
        version: workflowJournalEventVersion
      })
    },
    {
      position: JournalPosition.make(6),
      event: PlannedAttemptExecutorWorkReportedEvent.make({
        ordinal: PlannedAttemptExecutorReportOrdinal.make(3),
        report: PlannedAttemptExecutorReport.cases.ExecutorWorkExecuting.make({
          correlation: plannedAttemptExecutorCorrelation(plannedAttempt)
        }),
        version: workflowJournalEventVersion
      })
    },
    { position: JournalPosition.make(7), event: lateGroupingGraphEvent },
    { position: JournalPosition.make(8), event: reconfirmedGroupingGraphEvent },
    {
      position: JournalPosition.make(9),
      event: ControlDirectionAppliedEvent.make({
        direction: "Unpause",
        initiatedBy: { _tag: "Operator" },
        occurrenceClassification: "InitiatedAction",
        ordinal: ControlDirectionApplicationOrdinal.make(2),
        subject: { _tag: "Task", runId, taskId: TaskId.make("A") },
        version: workflowJournalEventVersion
      })
    }
  ]
  expect(taskPauseSuspensionIsOwed(lateGroupingRecords, plannedAttempt, JournalPosition.make(2), regrouped)).toBe(true)

  const activePauseWithoutGraph = [responsibilityBegan, taskPaused]
  expect(taskPauseSuspensionIsOwed(activePauseWithoutGraph, plannedAttempt, JournalPosition.make(2), graph)).toBe(true)
  expect(taskPauseSuspensionIsOwed(activePauseWithoutGraph, plannedAttempt, JournalPosition.make(2), regrouped)).toBe(
    false
  )
  expect(
    taskPauseSuspensionIsOwed(
      [
        ...activePauseWithoutGraph,
        { position: JournalPosition.make(9), event: lateGroupingRecords.at(-1)?.event ?? taskPaused.event }
      ],
      plannedAttempt,
      JournalPosition.make(2),
      graph
    )
  ).toBe(false)
  const lostSuspensionCommand = PlannedAttemptExecutorCommandIntendedEvent.make({
    command: "Suspend",
    initiatedBy: { _tag: "DalphCoordinator" },
    occurrenceClassification: "InitiatedAction",
    ordinal: PlannedAttemptExecutorCommandOrdinal.make(1),
    plannedAttempt,
    version: workflowJournalEventVersion
  })
  const exactSafeProjection = PlannedAttemptExecutorCommandProjectionObservedEvent.make({
    commandOrdinal: PlannedAttemptExecutorCommandOrdinal.make(1),
    observation: PlannedAttemptExecutorCommandProjectionObservation.cases.ExactExecutorReport.make({
      report: PlannedAttemptExecutorReport.cases.ExecutorWorkSafelySuspended.make({
        correlation: plannedAttemptExecutorCorrelation(plannedAttempt)
      })
    }),
    occurrenceClassification: "NonActionOccurrence",
    plannedAttempt,
    projectionOrdinal: PlannedAttemptExecutorCommandProjectionOrdinal.make(1),
    version: workflowJournalEventVersion
  })
  expect(
    taskPauseSuspensionIsOwed(
      [
        ...records,
        { position: JournalPosition.make(5), event: lostSuspensionCommand },
        { position: JournalPosition.make(6), event: exactSafeProjection }
      ],
      plannedAttempt,
      JournalPosition.make(2),
      graph
    )
  ).toBe(true)
  expect(
    taskPauseSuspensionIsOwed(
      [
        ...records,
        {
          position: JournalPosition.make(5),
          event: PlannedAttemptExecutorWorkReportedEvent.make({
            ordinal: PlannedAttemptExecutorReportOrdinal.make(2),
            report: PlannedAttemptExecutorReport.cases.ExecutorWorkSafelySuspended.make({
              correlation: plannedAttemptExecutorCorrelation(plannedAttempt)
            }),
            version: workflowJournalEventVersion
          })
        }
      ],
      plannedAttempt,
      JournalPosition.make(2),
      graph
    )
  ).toBe(false)
  expect(
    taskPauseSuspensionIsOwed(
      [{ position: JournalPosition.make(1), event: taskPaused.event }],
      plannedAttempt,
      JournalPosition.make(2),
      graph
    )
  ).toBe(false)
  const exactTaskPause = ControlDirectionAppliedEvent.make({
    direction: "Pause",
    initiatedBy: { _tag: "Operator" },
    occurrenceClassification: "InitiatedAction",
    ordinal: ControlDirectionApplicationOrdinal.make(2),
    subject: { _tag: "Task", runId, taskId: descendantTaskId },
    version: workflowJournalEventVersion
  })
  expect(
    taskPauseSuspensionIsOwed(
      [responsibilityBegan, { position: JournalPosition.make(4), event: exactTaskPause }],
      plannedAttempt,
      JournalPosition.make(2),
      undefined
    )
  ).toBe(true)
  expect(
    taskPauseSuspensionIsOwed(
      [responsibilityBegan, taskPaused, { position: JournalPosition.make(5), event: reconfirmedGroupingGraphEvent }],
      plannedAttempt,
      JournalPosition.make(2),
      graph
    )
  ).toBe(true)

  const foreignGroupingGraphRead = makeTrackerGraphObservationOperation(
    { _tag: "WorkflowEstablishment" },
    OperationId.make("foreign-grouping-descendant-graph-read"),
    FixtureTarget.make("foreign-grouping-descendant-target")
  )
  const foreignGroupingGraphEvent = taskTrackerFactsObservedEvent(
    foreignGroupingGraphRead.operationId,
    makeCompleteTaskTrackerFactsObserved(foreignGroupingGraphRead, graph)
  )
  expect(
    taskPauseSuspensionIsOwed(
      [...activePauseWithoutGraph, { position: JournalPosition.make(5), event: foreignGroupingGraphEvent }],
      plannedAttempt,
      JournalPosition.make(2),
      regrouped,
      coverageTarget
    )
  ).toBe(false)
})

it("retains an owed Run Pause suspension after Unpause until the exact executor report arrives", () => {
  const pause = coverageRecord(5, runPause(1))
  const unpause = coverageRecord(6, runUnpause(2))
  const crashedAfterPause = [...coveragePlanRecords(), pause, unpause]
  const [owedFacts] = deriveJournalResponsibilityFacts(coverageRunState(crashedAfterPause, [coverageResponsibility]))

  expect(owedFacts).toMatchObject({
    _tag: "PlannedAttemptExecutorFreshFacts",
    disposition: { _tag: "PlannedAttemptExecutorSuspensionRequested" }
  })

  const safelySuspended = executorReport(
    7,
    PlannedAttemptExecutorReport.cases.ExecutorWorkSafelySuspended.make({
      correlation: plannedAttemptExecutorCorrelation(coverageAttempt)
    })
  )
  const [settledFacts] = deriveJournalResponsibilityFacts(
    coverageRunState([...crashedAfterPause, safelySuspended], [coverageResponsibility])
  )

  expect(settledFacts).toMatchObject({
    _tag: "PlannedAttemptExecutorFreshFacts",
    disposition: { _tag: "Ready", acceptedProgress: { _tag: "ExecutorReportAccepted", ordinal: 7 } }
  })
})

it.each(["StateObserved", "CommandProjection"] as const)(
  "waits for WorkReported after a changed exact Safe %s crash prefix",
  (source) => {
    const running = executorReport(
      5,
      PlannedAttemptExecutorReport.cases.ExecutorWorkExecuting.make({
        correlation: plannedAttemptExecutorCorrelation(coverageAttempt)
      })
    )
    const pause = coverageRecord(6, runPause(1))
    const safe = PlannedAttemptExecutorReport.cases.ExecutorWorkSafelySuspended.make({
      correlation: plannedAttemptExecutorCorrelation(coverageAttempt)
    })
    const unaccepted =
      source === "StateObserved"
        ? [
            coverageRecord(
              7,
              PlannedAttemptExecutorStateObservedEvent.make({
                observation: PlannedAttemptExecutorStateObservation.cases.ExactExecutorReport.make({ report: safe }),
                occurrenceClassification: "NonActionOccurrence",
                ordinal: PlannedAttemptExecutorStateObservationOrdinal.make(1),
                plannedAttempt: coverageAttempt,
                version: workflowJournalEventVersion
              })
            )
          ]
        : [
            coverageRecord(
              7,
              PlannedAttemptExecutorCommandIntendedEvent.make({
                command: "Suspend",
                initiatedBy: { _tag: "DalphCoordinator" },
                occurrenceClassification: "InitiatedAction",
                ordinal: PlannedAttemptExecutorCommandOrdinal.make(1),
                plannedAttempt: coverageAttempt,
                version: workflowJournalEventVersion
              })
            ),
            coverageRecord(
              8,
              PlannedAttemptExecutorCommandProjectionObservedEvent.make({
                commandOrdinal: PlannedAttemptExecutorCommandOrdinal.make(1),
                observation: PlannedAttemptExecutorCommandProjectionObservation.cases.ExactExecutorReport.make({
                  report: safe
                }),
                occurrenceClassification: "NonActionOccurrence",
                plannedAttempt: coverageAttempt,
                projectionOrdinal: PlannedAttemptExecutorCommandProjectionOrdinal.make(1),
                version: workflowJournalEventVersion
              })
            )
          ]
    const [facts] = deriveJournalResponsibilityFacts(
      coverageRunState([...coveragePlanRecords(), running, pause, ...unaccepted], [coverageResponsibility])
    )

    expect(facts).toMatchObject({
      _tag: "PlannedAttemptExecutorFreshFacts",
      disposition: { _tag: "PlannedAttemptExecutorSuspensionRequested" }
    })
  }
)

it.each(["StateObserved", "CommandProjection"] as const)(
  "does not finish from a changed exact Terminal %s crash prefix before WorkReported",
  (source) => {
    const running = executorReport(
      5,
      PlannedAttemptExecutorReport.cases.ExecutorWorkExecuting.make({
        correlation: plannedAttemptExecutorCorrelation(coverageAttempt)
      })
    )
    const terminal = PlannedAttemptExecutorReport.cases.ExecutorWorkTerminal.make({
      correlation: plannedAttemptExecutorCorrelation(coverageAttempt),
      result: { _tag: "Failed" }
    })
    const unaccepted =
      source === "StateObserved"
        ? [
            coverageRecord(
              6,
              PlannedAttemptExecutorStateObservedEvent.make({
                observation: PlannedAttemptExecutorStateObservation.cases.ExactExecutorReport.make({
                  report: terminal
                }),
                occurrenceClassification: "NonActionOccurrence",
                ordinal: PlannedAttemptExecutorStateObservationOrdinal.make(1),
                plannedAttempt: coverageAttempt,
                version: workflowJournalEventVersion
              })
            )
          ]
        : [
            coverageRecord(
              6,
              PlannedAttemptExecutorCommandIntendedEvent.make({
                command: "Suspend",
                initiatedBy: { _tag: "DalphCoordinator" },
                occurrenceClassification: "InitiatedAction",
                ordinal: PlannedAttemptExecutorCommandOrdinal.make(1),
                plannedAttempt: coverageAttempt,
                version: workflowJournalEventVersion
              })
            ),
            coverageRecord(
              7,
              PlannedAttemptExecutorCommandProjectionObservedEvent.make({
                commandOrdinal: PlannedAttemptExecutorCommandOrdinal.make(1),
                observation: PlannedAttemptExecutorCommandProjectionObservation.cases.ExactExecutorReport.make({
                  report: terminal
                }),
                occurrenceClassification: "NonActionOccurrence",
                plannedAttempt: coverageAttempt,
                projectionOrdinal: PlannedAttemptExecutorCommandProjectionOrdinal.make(1),
                version: workflowJournalEventVersion
              })
            )
          ]
    const [facts] = deriveJournalResponsibilityFacts(
      coverageRunState([...coveragePlanRecords(), running, ...unaccepted], [coverageResponsibility])
    )

    expect(facts).toMatchObject({
      _tag: "PlannedAttemptExecutorFreshFacts",
      disposition: { _tag: "Ready", acceptedProgress: { _tag: "ExecutorReportAccepted", ordinal: 5 } }
    })
  }
)

it("waits on a passive lifecycle contradiction without classifying it as a correlation contradiction", () => {
  const correlation = plannedAttemptExecutorCorrelation(coverageAttempt)
  const safe = PlannedAttemptExecutorReport.cases.ExecutorWorkSafelySuspended.make({ correlation })
  const contradiction = coverageRecord(
    6,
    PlannedAttemptExecutorStateObservedEvent.make({
      observation: PlannedAttemptExecutorStateObservation.cases.ExecutorLifecycleTransitionContradiction.make({
        accepted: safe,
        observed: PlannedAttemptExecutorReport.cases.ExecutorWorkExecuting.make({ correlation })
      }),
      occurrenceClassification: "NonActionOccurrence",
      ordinal: PlannedAttemptExecutorStateObservationOrdinal.make(1),
      plannedAttempt: coverageAttempt,
      version: workflowJournalEventVersion
    })
  )
  const [facts] = deriveJournalResponsibilityFacts(
    coverageRunState([...coveragePlanRecords(), executorReport(5, safe), contradiction], [coverageResponsibility])
  )

  expect(facts).toMatchObject({
    _tag: "PlannedAttemptExecutorFreshFacts",
    disposition: { _tag: "PlannedAttemptExecutorProjectionWait", reason: "LifecycleTransitionContradiction" }
  })
})

it.each([
  { name: "absent", observation: PlannedAttemptExecutorStateObservation.cases.ExecutorStateNoCurrentReport.make({}) },
  {
    name: "temporarily unavailable",
    observation: PlannedAttemptExecutorStateObservation.cases.ExecutorStateTemporarilyUnavailable.make({})
  },
  { name: "unreadable", observation: PlannedAttemptExecutorStateObservation.cases.ExecutorStateUnreadable.make({}) },
  {
    name: "foreign",
    observation: PlannedAttemptExecutorStateObservation.cases.ExecutorReportContradiction.make({
      observed: PlannedAttemptExecutorReport.cases.ExecutorWorkExecuting.make({
        correlation: { attemptId: AttemptId.make("recovery-activation-passive-foreign-attempt"), runId: coverageRunId }
      })
    })
  }
] as const)("does not schedule another passive executor read after an unresolved $name projection", ({ observation }) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const executing = PlannedAttemptExecutorReport.cases.ExecutorWorkExecuting.make({
        correlation: plannedAttemptExecutorCorrelation(coverageAttempt)
      })
      const beginOrdinal = PlannedAttemptExecutorCommandOrdinal.make(1)
      const began = makeWorkflowRunBeganRecord(coverageRunId, coverageTarget, coveragePolicy)
      const records = [
        began,
        ...coveragePlanRecords().map((record) => ({
          ...record,
          position: JournalPosition.make(Number(record.position) + 1)
        })),
        coverageRecord(
          6,
          PlannedAttemptExecutorCommandIntendedEvent.make({
            command: "Begin",
            initiatedBy: { _tag: "DalphCoordinator" },
            occurrenceClassification: "InitiatedAction",
            ordinal: beginOrdinal,
            plannedAttempt: coverageAttempt,
            version: workflowJournalEventVersion
          })
        ),
        coverageRecord(
          7,
          PlannedAttemptExecutorCommandResponseObservedEvent.make({
            commandOrdinal: beginOrdinal,
            occurrenceClassification: "NonActionOccurrence",
            plannedAttempt: coverageAttempt,
            report: executing,
            version: workflowJournalEventVersion
          })
        ),
        executorReport(8, executing, 1),
        executorStateObservation(9, observation)
      ]
      const reconstructed: ReconstructedRunState = {
        ...coverageRunState(records, [coverageResponsibilityAfterBeginning]),
        controlPolicy: Option.some({ ...coveragePolicy, revision: initialRunPolicyRevision })
      }
      const resources = yield* makeIntegrationTargetResourceController()
      const restartedJournal = Object.assign(
        InRunJournal.of({
          append: () => Effect.die("passive failure restart must not append during projection"),
          read: () => Effect.succeed(records)
        }),
        { state: { get: Effect.succeed({ reconstructed }) } }
      )
      const recovery = yield* makeRunRecoveryProjection(coverageRunId, undefined, resources).pipe(
        Effect.provideService(InRunJournal, restartedJournal)
      )

      const projection = yield* recovery.readDeliveryProjection

      expect(projection.evidence).toMatchObject({
        _tag: "AvailableDeliveryProjectionEvidence",
        facts: [
          {
            _tag: "PlannedAttemptExecutorFreshFacts",
            disposition: { _tag: "PlannedAttemptExecutorProjectionWait" },
            responsibility: { plannedAttempt: coverageAttempt }
          }
        ]
      })
      expect(
        projection.frontier.transitions.filter(
          (transition) =>
            transition._tag === "ObservePlannedAttemptExecutorWork" ||
            transition._tag === "ReconcilePlannedAttemptExecutorWork" ||
            transition._tag === "ResumePlannedAttemptExecutorWorkAfterCurrentFacts" ||
            transition._tag === "SuspendPlannedAttemptExecutorWork"
        )
      ).toEqual([])
    })
  )
)

it("reconciles one unsettled command when its prior activation recorded a non-exact projection", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const beginOrdinal = PlannedAttemptExecutorCommandOrdinal.make(1)
      const began = makeWorkflowRunBeganRecord(coverageRunId, coverageTarget, coveragePolicy)
      const records = [
        began,
        ...coveragePlanRecords().map((record) => ({
          ...record,
          position: JournalPosition.make(Number(record.position) + 1)
        })),
        coverageRecord(
          6,
          PlannedAttemptExecutorCommandIntendedEvent.make({
            command: "Begin",
            initiatedBy: { _tag: "DalphCoordinator" },
            occurrenceClassification: "InitiatedAction",
            ordinal: beginOrdinal,
            plannedAttempt: coverageAttempt,
            version: workflowJournalEventVersion
          })
        ),
        coverageRecord(
          7,
          PlannedAttemptExecutorCommandProjectionObservedEvent.make({
            commandOrdinal: beginOrdinal,
            observation:
              PlannedAttemptExecutorCommandProjectionObservation.cases.ExecutorStateTemporarilyUnavailable.make({}),
            occurrenceClassification: "NonActionOccurrence",
            plannedAttempt: coverageAttempt,
            projectionOrdinal: PlannedAttemptExecutorCommandProjectionOrdinal.make(1),
            version: workflowJournalEventVersion
          })
        )
      ]
      const reconstructed: ReconstructedRunState = {
        ...coverageRunState(records, [coverageResponsibilityAfterBeginning]),
        controlPolicy: Option.some({ ...coveragePolicy, revision: initialRunPolicyRevision })
      }
      const resources = yield* makeIntegrationTargetResourceController()
      const restartedJournal = Object.assign(
        InRunJournal.of({
          append: () => Effect.die("command projection selection must not append"),
          read: () => Effect.succeed(records)
        }),
        { state: { get: Effect.succeed({ reconstructed }) } }
      )
      const recovery = yield* makeRunRecoveryProjection(coverageRunId, undefined, resources).pipe(
        Effect.provideService(InRunJournal, restartedJournal)
      )

      const projection = yield* recovery.readDeliveryProjection
      expect(
        projection.frontier.transitions.filter(
          (transition) => transition._tag === "ReconcilePlannedAttemptExecutorWork"
        )
      ).toEqual([RunnableFrontierTransition.ReconcilePlannedAttemptExecutorWork({ plannedAttempt: coverageAttempt })])
      expect(
        projection.frontier.transitions.filter(
          (transition) =>
            transition._tag === "ObservePlannedAttemptExecutorWork" ||
            transition._tag === "BeginPlannedAttemptExecutorWork" ||
            transition._tag === "ResumePlannedAttemptExecutorWorkAfterCurrentFacts" ||
            transition._tag === "SuspendPlannedAttemptExecutorWork"
        )
      ).toEqual([])
    })
  ))

it.each([
  {
    name: "contradictory",
    reason: "ExecutorContradictory" as const,
    makeObservation: (correlation: ReturnType<typeof plannedAttemptExecutorCorrelation>) =>
      PlannedAttemptExecutorStateObservation.cases.ExecutorReportContradiction.make({
        observed: PlannedAttemptExecutorReport.cases.ExecutorWorkSafelySuspended.make({ correlation })
      })
  },
  {
    name: "executing",
    reason: "ExecutorExecuting" as const,
    makeObservation: (correlation: ReturnType<typeof plannedAttemptExecutorCorrelation>) =>
      PlannedAttemptExecutorStateObservation.cases.ExactExecutorReport.make({
        report: PlannedAttemptExecutorReport.cases.ExecutorWorkExecuting.make({ correlation })
      })
  },
  {
    name: "no-current-report",
    reason: "ExecutorUnavailable" as const,
    makeObservation: () => PlannedAttemptExecutorStateObservation.cases.ExecutorStateNoCurrentReport.make({})
  },
  {
    name: "temporarily-unavailable",
    reason: "ExecutorUnavailable" as const,
    makeObservation: () => PlannedAttemptExecutorStateObservation.cases.ExecutorStateTemporarilyUnavailable.make({})
  },
  {
    name: "unreadable",
    reason: "ExecutorUnavailable" as const,
    makeObservation: () => PlannedAttemptExecutorStateObservation.cases.ExecutorStateUnreadable.make({})
  }
] as const)(
  "keeps a stopped attempt waiting for the exact executor observation ($name)",
  ({ makeObservation, reason }) => {
    const correlation = plannedAttemptExecutorCorrelation(coverageAttempt)
    const running = PlannedAttemptExecutorReport.cases.ExecutorWorkExecuting.make({ correlation })
    const [facts] = deriveJournalResponsibilityFacts(
      coverageRunState(
        [
          ...coveragePlanRecords(),
          executorReport(5, running),
          stopChoiceRecord(6),
          executorStateObservation(7, makeObservation(correlation))
        ],
        [coverageResponsibility]
      )
    )

    expect(facts).toMatchObject({
      _tag: "PlannedAttemptExecutorFreshFacts",
      disposition: { _tag: "AttemptStoppageWait", reason }
    })
  }
)

it("does not infer Dalph claim authority from a readable focused tracker claim", () => {
  const correlation = plannedAttemptExecutorCorrelation(coverageAttempt)
  const safe = PlannedAttemptExecutorReport.cases.ExecutorWorkSafelySuspended.make({ correlation })
  const records = [
    ...coveragePlanRecords().filter((record) => record.event._tag !== "TaskClaimAcquired"),
    executorReport(5, safe),
    coverageRecord(6, taskTrackerReadIntent(coverageClaimOperation)),
    coverageRecord(7, coverageClaimEvent)
  ]
  const [facts] = deriveJournalResponsibilityFacts(
    {
      ...coverageRunState(records, [coverageResponsibility]),
      graphKnowledge: { taskTrackerFacts: [coverageGraphEvent.observation] }
    },
    Option.none(),
    Option.none(),
    coverageTarget
  )

  expect(facts).toMatchObject({
    _tag: "PlannedAttemptExecutorFreshFacts",
    disposition: { _tag: "Ready", acceptedProgress: { _tag: "ExecutorReportAccepted", ordinal: 5 } }
  })
})

it("waits for the Run target before planning release of an abandoned stopped claim", () => {
  const stop = stopChoiceRecord(6)
  if (stop.event._tag !== "AttemptChoiceApplied") return expect.fail("expected the Stop choice")
  const abandonment = coverageRecord(
    7,
    AttemptImplementationAbandonedEvent.make({
      expectedClaim: coverageClaim,
      initiatedBy: { _tag: "DalphCoordinator" },
      occurrenceClassification: "InitiatedAction",
      proof: { _tag: "AcceptedReport", reportOrdinal: PlannedAttemptExecutorReportOrdinal.make(5) },
      requestId: stop.event.requestId,
      subject: stop.event.subject,
      version: workflowJournalEventVersion
    })
  )
  const [facts] = deriveJournalResponsibilityFacts(
    coverageRunState(
      [
        ...coveragePlanRecords(),
        executorReport(
          5,
          PlannedAttemptExecutorReport.cases.ExecutorWorkSafelySuspended.make({
            correlation: plannedAttemptExecutorCorrelation(coverageAttempt)
          })
        ),
        stop,
        abandonment
      ],
      [coverageResponsibility]
    )
  )

  expect(facts).toMatchObject({
    _tag: "PlannedAttemptExecutorFreshFacts",
    disposition: { _tag: "StoppedAttemptClaimPlanningWait", reason: "TrackerTargetUnavailable" }
  })
})

it.each([
  {
    name: "contradictory",
    reason: "ExecutorContradictory" as const,
    makeObservation: (correlation: ReturnType<typeof plannedAttemptExecutorCorrelation>) =>
      PlannedAttemptExecutorStateObservation.cases.ExecutorReportContradiction.make({
        observed: PlannedAttemptExecutorReport.cases.ExecutorWorkSafelySuspended.make({ correlation })
      })
  },
  {
    name: "executing",
    reason: "ExecutorExecuting" as const,
    makeObservation: (correlation: ReturnType<typeof plannedAttemptExecutorCorrelation>) =>
      PlannedAttemptExecutorStateObservation.cases.ExactExecutorReport.make({
        report: PlannedAttemptExecutorReport.cases.ExecutorWorkExecuting.make({ correlation })
      })
  },
  {
    name: "no-current-report",
    reason: "ExecutorUnavailable" as const,
    makeObservation: () => PlannedAttemptExecutorStateObservation.cases.ExecutorStateNoCurrentReport.make({})
  },
  {
    name: "temporarily-unavailable",
    reason: "ExecutorUnavailable" as const,
    makeObservation: () => PlannedAttemptExecutorStateObservation.cases.ExecutorStateTemporarilyUnavailable.make({})
  },
  {
    name: "unreadable",
    reason: "ExecutorUnavailable" as const,
    makeObservation: () => PlannedAttemptExecutorStateObservation.cases.ExecutorStateUnreadable.make({})
  }
] as const)(
  "keeps a restarted attempt waiting for the exact executor authority ($name)",
  ({ makeObservation, reason }) => {
    const correlation = plannedAttemptExecutorCorrelation(coverageAttempt)
    const disposition = restartReplacementDisposition(
      [
        ...coveragePlanRecords(),
        executorReport(5, PlannedAttemptExecutorReport.cases.ExecutorWorkSafelySuspended.make({ correlation })),
        restartChoiceRecord(6),
        executorStateObservation(7, makeObservation(correlation))
      ],
      coverageAttempt,
      Option.none(),
      Option.none(),
      coverageTarget
    )

    expect(disposition).toEqual({ _tag: "AttemptRestartWait", reason })
  }
)

it("uses only the immutable Run target for restart graph eligibility", () => {
  const foreignTarget = FixtureTarget.make("recovery-activation-restart-foreign-target")
  const graphFor = (target: typeof coverageTarget, lifecycle: "Open" | "TerminalWithoutSuccess") => {
    const operation = makeTrackerGraphObservationOperation(
      { _tag: "WorkflowEstablishment" },
      OperationId.make(`recovery-activation-restart-${target === coverageTarget ? "exact" : "foreign"}-graph`),
      target,
      [coveragePlanOperation.operationId],
      [coverageAttempt.taskId]
    )
    const snapshot = validSnapshot({
      revision: `recovery-activation-restart-${target === coverageTarget ? "exact" : "foreign"}-revision`,
      tasks: [{ id: coverageAttempt.taskId, lifecycle: { _tag: lifecycle }, parentTaskId: null, prerequisiteIds: [] }]
    })
    return {
      intent: coverageRecord(7, taskTrackerReadIntent(operation)),
      observation: coverageRecord(
        8,
        taskTrackerFactsObservedEvent(operation.operationId, makeCompleteTaskTrackerFactsObserved(operation, snapshot))
      )
    }
  }

  const foreignGraph = graphFor(foreignTarget, "TerminalWithoutSuccess")
  expect(
    restartReplacementDisposition(
      [...coveragePlanRecords(), restartChoiceRecord(6), foreignGraph.intent, foreignGraph.observation],
      coverageAttempt,
      Option.none(),
      Option.none(),
      coverageTarget
    )
  ).toEqual({ _tag: "AttemptRestartWait", reason: "IntegrationTargetUnavailable" })

  const exactGraph = graphFor(coverageTarget, "TerminalWithoutSuccess")
  expect(
    restartReplacementDisposition(
      [...coveragePlanRecords(), restartChoiceRecord(6), exactGraph.intent, exactGraph.observation],
      coverageAttempt,
      Option.none(),
      Option.none(),
      coverageTarget
    )
  ).toEqual({ _tag: "AttemptRestartWait", reason: "TaskNotEligible" })
})

it("keeps Stop's executor boundary bounded and preserves the task position", () => {
  const correlation = plannedAttemptExecutorCorrelation(coverageAttempt)
  const running = PlannedAttemptExecutorReport.cases.ExecutorWorkExecuting.make({ correlation })

  const unsettledCommand = coverageRecord(
    7,
    PlannedAttemptExecutorCommandIntendedEvent.make({
      command: "Suspend",
      initiatedBy: { _tag: "DalphCoordinator" },
      occurrenceClassification: "InitiatedAction",
      ordinal: PlannedAttemptExecutorCommandOrdinal.make(1),
      plannedAttempt: coverageAttempt,
      version: workflowJournalEventVersion
    })
  )
  const [requiredFacts] = deriveJournalResponsibilityFacts(
    coverageRunState(
      [...coveragePlanRecords(), executorReport(5, running), stopChoiceRecord(6), unsettledCommand],
      [coverageResponsibility]
    ),
    Option.some(unsettledCommand.position)
  )
  expect(requiredFacts).toMatchObject({
    _tag: "PlannedAttemptExecutorFreshFacts",
    disposition: { _tag: "AttemptStoppageRequired", taskWorkPosition: "ReserveOrReuse" }
  })

  const [boundedFacts] = deriveJournalResponsibilityFacts(
    coverageRunState(
      [...coveragePlanRecords(), executorReport(5, running), stopChoiceRecord(6)],
      [coverageResponsibility]
    )
  )
  expect(boundedFacts).toMatchObject({
    _tag: "PlannedAttemptExecutorFreshFacts",
    disposition: { _tag: "AttemptStoppageRequired", taskWorkPosition: "ReserveOrReuse" }
  })

  const [observationFacts] = deriveJournalResponsibilityFacts(
    coverageRunState(
      [
        ...coveragePlanRecords(),
        executorReport(5, running),
        stopChoiceRecord(6),
        ...settledSuspensionCommands(7, Number(defaultPlannedAttemptExecutorSuspensionLimit))
      ],
      [coverageResponsibility]
    ),
    Option.some(JournalPosition.make(11))
  )
  expect(observationFacts).toMatchObject({
    _tag: "PlannedAttemptExecutorFreshFacts",
    disposition: { _tag: "AttemptStoppageExecutorObservationRequired" }
  })

  const safe = PlannedAttemptExecutorReport.cases.ExecutorWorkSafelySuspended.make({ correlation })
  const [quiescentFacts] = deriveJournalResponsibilityFacts(
    coverageRunState([...coveragePlanRecords(), executorReport(5, safe), stopChoiceRecord(6)], [coverageResponsibility])
  )
  expect(quiescentFacts).toMatchObject({
    _tag: "PlannedAttemptExecutorFreshFacts",
    disposition: { _tag: "AttemptStoppageRequired", taskWorkPosition: "None" }
  })
})

effectIt.effect("uses durable Run cancellation as the existing settlement selection boundary", () =>
  Effect.gen(function* () {
    const runningReport = executorReport(
      5,
      PlannedAttemptExecutorReport.cases.ExecutorWorkExecuting.make({
        correlation: plannedAttemptExecutorCorrelation(coverageAttempt)
      })
    )
    const cancellationPosition = JournalPosition.make(6)
    const cancellation = coverageRecord(
      Number(cancellationPosition),
      RunCancellationAppliedEvent.make({
        initiatedBy: { _tag: "Operator" },
        occurrenceClassification: "InitiatedAction",
        version: workflowJournalEventVersion
      })
    )
    const state = coverageRunState([...coveragePlanRecords(), runningReport, cancellation], [coverageResponsibility])
    const cancelledState: ReconstructedRunState = {
      ...state,
      cancellation: { _tag: "RunCancellationApplied", appliedAt: cancellationPosition },
      graphKnowledge: { taskTrackerFacts: [coverageGraphEvent.observation] }
    }
    const resources = yield* makeIntegrationTargetResourceController()
    const recovery = yield* makeRunRecoveryProjection(coverageRunId, undefined, resources).pipe(
      Effect.provideService(InRunJournal, currentProjectionJournal(coverageRunId, coverageTarget, cancelledState))
    )
    const projection = yield* recovery.readDeliveryProjection
    expect(projection.frontier.transitions).toContainEqual(
      RunnableFrontierTransition.SuspendPlannedAttemptExecutorWork({ plannedAttempt: coverageAttempt })
    )
    expect(projection.frontier.transitions.some(({ _tag }) => _tag === "ObservePlannedAttemptExecutorWork")).toBe(false)
  })
)

it("derives cancellation relinquishment, exact claim release, and typed no-release settlement", () => {
  const cancellationPosition = JournalPosition.make(6)
  const cancellation = coverageRecord(
    Number(cancellationPosition),
    RunCancellationAppliedEvent.make({
      initiatedBy: { _tag: "Operator" },
      occurrenceClassification: "InitiatedAction",
      version: workflowJournalEventVersion
    })
  )
  const preCancellationSafeReport = executorReport(
    5,
    PlannedAttemptExecutorReport.cases.ExecutorWorkSafelySuspended.make({
      correlation: plannedAttemptExecutorCorrelation(coverageAttempt)
    })
  )
  const [preCancellationSafeFacts] = deriveJournalResponsibilityFacts(
    coverageRunState([...coveragePlanRecords(), preCancellationSafeReport, cancellation], [coverageResponsibility])
  )
  expect(preCancellationSafeFacts).toMatchObject({
    disposition: { _tag: "CancelledAttemptRelinquishmentRequired", proof: { _tag: "AcceptedReport", reportOrdinal: 5 } }
  })
  const safeReport = executorReport(
    7,
    PlannedAttemptExecutorReport.cases.ExecutorWorkSafelySuspended.make({
      correlation: plannedAttemptExecutorCorrelation(coverageAttempt)
    })
  )
  const admittedIntegration = pausedIntegrationScenario("cancellation-started-branch", 5)
  const integrationStartedBeforeCancellation = coverageRecord(
    5,
    IntegrationStartedEvent.make({
      acceptedResult: admittedIntegration.responsibility.acceptedResult,
      integrationTarget: admittedIntegration.responsibility.integrationTarget,
      plannedAttempt: coverageAttempt,
      responsibilityBeganAt: JournalPosition.make(4),
      version: workflowJournalEventVersion
    })
  )
  expect(
    deriveJournalResponsibilityFacts(
      coverageRunState(
        [...coveragePlanRecords(), integrationStartedBeforeCancellation, cancellation, safeReport],
        [coverageResponsibility]
      )
    )[0]
  ).not.toMatchObject({ disposition: { _tag: "CancelledAttemptRelinquishmentRequired" } })
  const state = coverageRunState([...coveragePlanRecords(), cancellation, safeReport], [coverageResponsibility])
  const [relinquishmentFacts] = deriveJournalResponsibilityFacts(state)
  expect(relinquishmentFacts).toMatchObject({
    disposition: {
      _tag: "CancelledAttemptRelinquishmentRequired",
      plannedAttempt: coverageAttempt,
      proof: { _tag: "AcceptedReport", reportOrdinal: 7 }
    }
  })
  if (relinquishmentFacts?._tag !== "PlannedAttemptExecutorFreshFacts") return
  const frontier = deriveRunnableFrontier({
    freshEligibleTasks: [],
    responsibility: { entries: [coverageResponsibility] },
    responsibilityFacts: [relinquishmentFacts]
  })
  expect(frontier.transitions).toEqual([
    RunnableFrontierTransition.RelinquishCancelledAttemptImplementation({
      plannedAttempt: coverageAttempt,
      proof: { _tag: "AcceptedReport", reportOrdinal: PlannedAttemptExecutorReportOrdinal.make(7) }
    })
  ])
  const lateForwardCommand = coverageRecord(
    8,
    PlannedAttemptExecutorCommandIntendedEvent.make({
      command: "Resume",
      initiatedBy: { _tag: "DalphCoordinator" },
      occurrenceClassification: "InitiatedAction",
      ordinal: PlannedAttemptExecutorCommandOrdinal.make(8),
      plannedAttempt: coverageAttempt,
      version: workflowJournalEventVersion
    })
  )
  expect(
    deriveJournalResponsibilityFacts(
      coverageRunState(
        [...coveragePlanRecords(), cancellation, safeReport, lateForwardCommand],
        [coverageResponsibility]
      )
    )[0]
  ).not.toMatchObject({ disposition: { _tag: "CancelledAttemptRelinquishmentRequired" } })

  const relinquished = coverageRecord(
    8,
    CancelledAttemptImplementationResponsibilityRelinquishedEvent.make({
      authorizedClaim: coverageClaim,
      cancellationAppliedAt: cancellationPosition,
      initiatedBy: { _tag: "DalphCoordinator" },
      occurrenceClassification: "InitiatedAction",
      plannedAttempt: coverageAttempt,
      proof: { _tag: "AcceptedReport", reportOrdinal: PlannedAttemptExecutorReportOrdinal.make(7) },
      version: workflowJournalEventVersion
    })
  )
  const foreignClaim = ActiveTaskClaim.make({
    operationId: OperationId.make("recovery-activation-foreign-claim"),
    owner: ClaimOwner.make("another-run"),
    taskId: coverageAttempt.taskId,
    token: ClaimToken.make("recovery-activation-foreign-token")
  })
  const claimRead = makeTaskClaimObservationOperation(
    OperationId.make("cancelled-attempt-claim-observation"),
    coverageTarget,
    coverageAttempt.taskId,
    [coverageClaim.operationId]
  )
  const exactObservation = coverageRecord(
    10,
    taskTrackerFactsObservedEvent(claimRead.operationId, makeFocusedTaskClaimFactsObserved(claimRead, coverageClaim))
  )
  const unrelatedClaimRead = makeTaskClaimObservationOperation(
    OperationId.make("cancelled-attempt-unrelated-claim-observation"),
    coverageTarget,
    coverageAttempt.taskId
  )
  const unrelatedClaimObservation = coverageRecord(
    10,
    taskTrackerFactsObservedEvent(
      unrelatedClaimRead.operationId,
      makeFocusedTaskClaimFactsObserved(unrelatedClaimRead, coverageClaim)
    )
  )
  const unrelatedObservationState = coverageRunState(
    [
      makeWorkflowRunBeganRecord(coverageRunId, coverageTarget, coveragePolicy),
      ...coveragePlanRecords(),
      coverageRecord(5, coverageGraphEvent),
      cancellation,
      safeReport,
      relinquished,
      coverageRecord(9, taskTrackerReadIntent(unrelatedClaimRead)),
      unrelatedClaimObservation
    ],
    [coverageResponsibility]
  )
  const [unrelatedObservationFacts] = deriveJournalResponsibilityFacts(unrelatedObservationState)
  expect(unrelatedObservationFacts).toMatchObject({ disposition: { _tag: "CancelledAttemptClaimObservationRequired" } })
  const [missingTargetFacts] = deriveJournalResponsibilityFacts(
    coverageRunState([...coveragePlanRecords(), cancellation, safeReport, relinquished], [coverageResponsibility])
  )
  expect(missingTargetFacts).toMatchObject({ disposition: { _tag: "CancelledAttemptClaimPlanningWait" } })
  const unreadableObservation = coverageRecord(
    10,
    taskTrackerFactsObservedEvent(claimRead.operationId, makeFocusedTaskClaimFactsUnreadable(claimRead))
  )
  const [unreadableFacts] = deriveJournalResponsibilityFacts(
    coverageRunState(
      [
        ...coveragePlanRecords(),
        cancellation,
        safeReport,
        relinquished,
        coverageRecord(9, taskTrackerReadIntent(claimRead)),
        unreadableObservation
      ],
      [coverageResponsibility]
    )
  )
  expect(unreadableFacts).toMatchObject({ disposition: { _tag: "CancelledAttemptClaimUnreadableWait" } })
  const mismatchedClaimReads = [
    makeTrackerGraphObservationOperation({ _tag: "WorkflowEstablishment" }, claimRead.operationId, coverageTarget),
    makeTaskClaimObservationOperation(claimRead.operationId, coverageTarget, TaskId.make("other"), [
      coverageClaim.operationId
    ]),
    makeTaskClaimObservationOperation(claimRead.operationId, coverageTarget, coverageAttempt.taskId)
  ]
  for (const mismatchedRead of mismatchedClaimReads) {
    const [mismatchedFacts] = deriveJournalResponsibilityFacts(
      coverageRunState(
        [
          ...coveragePlanRecords(),
          cancellation,
          safeReport,
          relinquished,
          coverageRecord(9, taskTrackerReadIntent(mismatchedRead)),
          exactObservation
        ],
        [coverageResponsibility]
      )
    )
    expect(mismatchedFacts).toMatchObject({
      disposition: { _tag: expect.stringMatching(/^CancelledAttemptClaim(?:ObservationRequired|PlanningWait)$/) }
    })
  }
  const [releaseFacts] = deriveJournalResponsibilityFacts(
    coverageRunState(
      [
        ...coveragePlanRecords(),
        cancellation,
        safeReport,
        relinquished,
        coverageRecord(9, taskTrackerReadIntent(claimRead)),
        exactObservation
      ],
      [coverageResponsibility]
    )
  )
  expect(releaseFacts).toMatchObject({
    disposition: {
      _tag: "CancelledAttemptClaimReleaseRequired",
      plannedAttempt: coverageAttempt,
      operation: {
        authority: {
          _tag: "CancelledAttemptClaimReleaseAuthority",
          cancellationAppliedAt: cancellationPosition,
          implementationRelinquishedAt: JournalPosition.make(8),
          observationOperationId: claimRead.operationId
        },
        release: { claim: coverageClaim }
      }
    }
  })
  expect(
    deriveJournalResponsibilityFacts(
      coverageRunState(
        [
          ...coveragePlanRecords(),
          cancellation,
          safeReport,
          relinquished,
          coverageRecord(9, taskTrackerReadIntent(claimRead)),
          exactObservation,
          coverageRecord(11, coverageGraphEvent)
        ],
        [coverageResponsibility]
      )
    )[0]
  ).toMatchObject({ disposition: { _tag: "CancelledAttemptClaimReleaseRequired" } })
  if (releaseFacts?._tag !== "PlannedAttemptExecutorFreshFacts") return
  if (releaseFacts.disposition._tag !== "CancelledAttemptClaimReleaseRequired") return
  const releaseIntent = coverageRecord(
    11,
    TaskClaimReleaseIntendedEvent.make({
      operation: releaseFacts.disposition.operation,
      version: workflowJournalEventVersion
    })
  )
  const retryClaimRead = makeTaskClaimObservationOperation(
    OperationId.make("cancelled-attempt-claim-release-retry-observation"),
    coverageTarget,
    coverageAttempt.taskId,
    [coverageClaim.operationId, releaseFacts.disposition.operation.release.operationId]
  )
  const retryObservation = coverageRecord(
    13,
    taskTrackerFactsObservedEvent(
      retryClaimRead.operationId,
      makeFocusedTaskClaimFactsObserved(retryClaimRead, coverageClaim)
    )
  )
  const retryReadWithoutReleasePredecessor = makeTaskClaimObservationOperation(
    OperationId.make("cancelled-attempt-claim-release-missing-predecessor"),
    coverageTarget,
    coverageAttempt.taskId,
    [coverageClaim.operationId]
  )
  expect(
    deriveJournalResponsibilityFacts(
      coverageRunState(
        [
          ...coveragePlanRecords(),
          cancellation,
          safeReport,
          relinquished,
          coverageRecord(9, taskTrackerReadIntent(claimRead)),
          exactObservation,
          releaseIntent,
          coverageRecord(12, taskTrackerReadIntent(retryReadWithoutReleasePredecessor)),
          coverageRecord(
            13,
            taskTrackerFactsObservedEvent(
              retryReadWithoutReleasePredecessor.operationId,
              makeFocusedTaskClaimFactsObserved(retryReadWithoutReleasePredecessor, coverageClaim)
            )
          )
        ],
        [coverageResponsibility]
      )
    )[0]
  ).toMatchObject({
    disposition: { _tag: expect.stringMatching(/^CancelledAttemptClaim(?:ObservationRequired|PlanningWait)$/) }
  })
  expect(
    deriveJournalResponsibilityFacts(
      coverageRunState(
        [
          ...coveragePlanRecords(),
          cancellation,
          safeReport,
          relinquished,
          coverageRecord(9, taskTrackerReadIntent(claimRead)),
          exactObservation,
          releaseIntent,
          coverageRecord(12, taskTrackerReadIntent(retryClaimRead)),
          retryObservation
        ],
        [coverageResponsibility]
      )
    )[0]
  ).toMatchObject({ disposition: { _tag: "CancelledAttemptClaimReleaseRetryRequired" } })
  expect(
    deriveRunnableFrontier({
      freshEligibleTasks: [],
      responsibility: { entries: [coverageResponsibility] },
      responsibilityFacts: [releaseFacts]
    }).transitions
  ).toMatchObject([{ _tag: "ReleaseCancelledAttemptClaim", plannedAttempt: coverageAttempt }])
  const frontierForCancellationDisposition = (disposition: PlannedAttemptExecutorDisposition) =>
    deriveRunnableFrontier({
      freshEligibleTasks: [],
      responsibility: { entries: [coverageResponsibility] },
      responsibilityFacts: [{ ...releaseFacts, disposition }]
    })
  expect(
    frontierForCancellationDisposition(
      ResponsibilityDisposition.CancelledAttemptClaimReleaseRetryRequired({
        operation: releaseFacts.disposition.operation,
        plannedAttempt: coverageAttempt
      })
    ).transitions
  ).toMatchObject([{ _tag: "RetryCancelledAttemptClaimRelease" }])
  expect(
    frontierForCancellationDisposition(
      ResponsibilityDisposition.CancelledAttemptClaimReleasePending({
        operationId: releaseFacts.disposition.operation.release.operationId
      })
    ).explanations
  ).toMatchObject([{ _tag: "CancelledAttemptClaimReleasePending" }])
  expect(
    frontierForCancellationDisposition(
      ResponsibilityDisposition.CancelledAttemptClaimPlanningWait({ reason: "TrackerTargetUnavailable" })
    ).explanations
  ).toMatchObject([{ _tag: "CancelledAttemptClaimPlanningWait" }])
  expect(
    frontierForCancellationDisposition(
      ResponsibilityDisposition.CancelledAttemptClaimUnreadableWait({ observationOperationId: claimRead.operationId })
    ).explanations
  ).toMatchObject([{ _tag: "CancelledAttemptClaimWait" }])

  const foreignObservation = coverageRecord(
    10,
    taskTrackerFactsObservedEvent(claimRead.operationId, makeFocusedTaskClaimFactsObserved(claimRead, foreignClaim))
  )
  const [noReleaseFacts] = deriveJournalResponsibilityFacts(
    coverageRunState(
      [
        ...coveragePlanRecords(),
        cancellation,
        safeReport,
        relinquished,
        coverageRecord(9, taskTrackerReadIntent(claimRead)),
        foreignObservation
      ],
      [coverageResponsibility]
    )
  )
  expect(noReleaseFacts).toMatchObject({
    disposition: {
      _tag: "CancelledAttemptClaimNoReleaseRequired",
      observationOperationId: claimRead.operationId,
      plannedAttempt: coverageAttempt
    }
  })
  const [noReleaseFactsForFrontier] = [noReleaseFacts]
  if (noReleaseFactsForFrontier?._tag !== "PlannedAttemptExecutorFreshFacts") return
  expect(
    deriveRunnableFrontier({
      freshEligibleTasks: [],
      responsibility: { entries: [coverageResponsibility] },
      responsibilityFacts: [noReleaseFactsForFrontier]
    }).transitions
  ).toEqual([
    RunnableFrontierTransition.RecordCancelledAttemptClaimNoRelease({
      observationOperationId: claimRead.operationId,
      plannedAttempt: coverageAttempt
    })
  ])

  const noRelease = coverageRecord(
    11,
    CancelledAttemptClaimNoReleaseObservedEvent.make({
      cancellationAppliedAt: cancellationPosition,
      expectedClaim: coverageClaim,
      observation: foreignClaim,
      observationOperationId: claimRead.operationId,
      occurrenceClassification: "NonActionOccurrence",
      plannedAttempt: coverageAttempt,
      version: workflowJournalEventVersion
    })
  )
  const [settledFacts] = deriveJournalResponsibilityFacts(
    coverageRunState(
      [
        ...coveragePlanRecords(),
        cancellation,
        safeReport,
        relinquished,
        coverageRecord(9, taskTrackerReadIntent(claimRead)),
        foreignObservation,
        noRelease
      ],
      [coverageResponsibility]
    ),
    Option.none(),
    Option.none(),
    coverageTarget
  )
  expect(settledFacts).toMatchObject({
    disposition: { _tag: "CancelledAttemptSettled", claimDisposition: "NoRelease" }
  })
})

it("requires an accepted executor report, not a read-only projection, to prove cancellation quiescence", () => {
  const cancellation = coverageRecord(
    6,
    RunCancellationAppliedEvent.make({
      initiatedBy: { _tag: "Operator" },
      occurrenceClassification: "InitiatedAction",
      version: workflowJournalEventVersion
    })
  )
  const safeReport = PlannedAttemptExecutorReport.cases.ExecutorWorkSafelySuspended.make({
    correlation: plannedAttemptExecutorCorrelation(coverageAttempt)
  })
  const suspendIntent = coverageRecord(
    7,
    PlannedAttemptExecutorCommandIntendedEvent.make({
      command: "Suspend",
      initiatedBy: { _tag: "DalphCoordinator" },
      occurrenceClassification: "InitiatedAction",
      ordinal: PlannedAttemptExecutorCommandOrdinal.make(1),
      plannedAttempt: coverageAttempt,
      version: workflowJournalEventVersion
    })
  )
  const commandProjection = coverageRecord(
    8,
    PlannedAttemptExecutorCommandProjectionObservedEvent.make({
      commandOrdinal: PlannedAttemptExecutorCommandOrdinal.make(1),
      observation: PlannedAttemptExecutorCommandProjectionObservation.cases.ExactExecutorReport.make({
        report: safeReport
      }),
      occurrenceClassification: "NonActionOccurrence",
      plannedAttempt: coverageAttempt,
      projectionOrdinal: PlannedAttemptExecutorCommandProjectionOrdinal.make(1),
      version: workflowJournalEventVersion
    })
  )
  const stateProjection = coverageRecord(
    7,
    PlannedAttemptExecutorStateObservedEvent.make({
      observation: PlannedAttemptExecutorStateObservation.cases.ExactExecutorReport.make({ report: safeReport }),
      occurrenceClassification: "NonActionOccurrence",
      ordinal: PlannedAttemptExecutorStateObservationOrdinal.make(1),
      plannedAttempt: coverageAttempt,
      version: workflowJournalEventVersion
    })
  )

  for (const projectedRecords of [
    [...coveragePlanRecords(), cancellation, suspendIntent, commandProjection],
    [...coveragePlanRecords(), cancellation, stateProjection]
  ]) {
    expect(
      deriveJournalResponsibilityFacts(coverageRunState(projectedRecords, [coverageResponsibility]))[0]
    ).toMatchObject({ disposition: { _tag: "PlannedAttemptExecutorSuspensionRequested" } })
  }
  const accepted = executorReport(9, safeReport, 1)
  expect(
    deriveJournalResponsibilityFacts(
      coverageRunState(
        [...coveragePlanRecords(), cancellation, suspendIntent, commandProjection, accepted],
        [coverageResponsibility]
      )
    )[0]
  ).toMatchObject({ disposition: { proof: { _tag: "AcceptedReport", reportOrdinal: 1 } } })
})

it("does not suspend an attempt that began after a historical Run Pause or was already safely reported", () => {
  const historicalPause = coverageRecord(2, runPause(1))
  const beganAfterPause = deriveJournalResponsibilityFacts(
    coverageRunState([...coveragePlanRecords(), historicalPause], [coverageResponsibility])
  )[0]
  expect(beganAfterPause).toMatchObject({ _tag: "PlannedAttemptExecutorFreshFacts", disposition: { _tag: "Ready" } })

  const runningBeforePause = executorReport(
    5,
    PlannedAttemptExecutorReport.cases.ExecutorWorkExecuting.make({
      correlation: plannedAttemptExecutorCorrelation(coverageAttempt)
    })
  )
  const safeBeforePause = executorReport(
    6,
    PlannedAttemptExecutorReport.cases.ExecutorWorkSafelySuspended.make({
      correlation: plannedAttemptExecutorCorrelation(coverageAttempt)
    })
  )
  const pauseAfterSafeReport = coverageRecord(7, runPause(1))
  const [alreadySettledFacts] = deriveJournalResponsibilityFacts(
    coverageRunState(
      [...coveragePlanRecords(), runningBeforePause, safeBeforePause, pauseAfterSafeReport],
      [coverageResponsibility]
    )
  )
  expect(alreadySettledFacts).toMatchObject({
    _tag: "PlannedAttemptExecutorFreshFacts",
    disposition: { _tag: "Ready", acceptedProgress: { _tag: "ExecutorReportAccepted", ordinal: 6 } }
  })
})

it("keeps a claim-backed attempt suspended when Git reports an untracked worktree path", () => {
  const worktreeOperation = makeTaskWorktreeObservationOperation({
    operationId: OperationId.make("recovery-activation-coverage-untracked-worktree"),
    plannedAttempt: coverageAttempt,
    predecessorOperationIds: [coveragePlanOperation.operationId]
  })
  const records = [
    ...coveragePlanRecords(),
    coverageRecord(5, coverageClaimEvent),
    coverageRecord(
      6,
      GitReadIntentRecordedEvent.make({
        initiatedBy: { _tag: "DalphCoordinator" },
        occurrenceClassification: "InitiatedAction",
        operation: worktreeOperation,
        version: workflowJournalEventVersion
      })
    ),
    coverageRecord(
      7,
      PlannedAttemptWorktreeObservedEvent.make({
        observation: UntrackedWorktreePath.make({ worktree: coverageAttempt.worktree }),
        occurrenceClassification: "NonActionOccurrence",
        operationId: worktreeOperation.operationId,
        version: workflowJournalEventVersion
      })
    )
  ]
  expect(authorizedClaimForAttempt(records, coverageAttempt)?.claim).toEqual(coverageClaim)
  const [facts] = deriveJournalResponsibilityFacts(coverageRunState(records, [coverageResponsibility]))

  expect(facts).toMatchObject({
    _tag: "PlannedAttemptExecutorFreshFacts",
    disposition: { _tag: "PlannedAttemptExecutorSuspensionRequested" }
  })
})

it("uses the latest completed run pause as an attempt baseline and returns none without pause facts", () => {
  const pause = ControlDirectionAppliedEvent.make({
    direction: "Pause",
    initiatedBy: { _tag: "Operator" },
    occurrenceClassification: "InitiatedAction",
    ordinal: ControlDirectionApplicationOrdinal.make(1),
    subject: { _tag: "Run", runId: coverageRunId },
    version: workflowJournalEventVersion
  })
  const unpause = ControlDirectionAppliedEvent.make({
    direction: "Unpause",
    initiatedBy: { _tag: "Operator" },
    occurrenceClassification: "InitiatedAction",
    ordinal: ControlDirectionApplicationOrdinal.make(2),
    subject: { _tag: "Run", runId: coverageRunId },
    version: workflowJournalEventVersion
  })
  const pausedHistory = coverageRunState([coverageRecord(1, pause), coverageRecord(2, unpause)])

  expect(continuationFreshnessBaselineForAttempt(pausedHistory, Option.none(), coverageAttempt, undefined)).toEqual(
    Option.some(JournalPosition.make(2))
  )
  expect(
    continuationFreshnessBaselineForAttempt(
      pausedHistory,
      Option.some(JournalPosition.make(3)),
      coverageAttempt,
      undefined
    )
  ).toEqual(Option.some(JournalPosition.make(3)))
  expect(
    continuationFreshnessBaselineForAttempt(coverageRunState([]), Option.none(), coverageAttempt, undefined)
  ).toEqual(Option.none())
})

it("keeps an accepted executing attempt on its passive observation route without current-fact reads", () => {
  const transition = RunnableFrontierTransition.ObservePlannedAttemptExecutorWork({
    acceptedProgress: { _tag: "ExecutorReportAccepted", ordinal: PlannedAttemptExecutorReportOrdinal.make(1) },
    plannedAttempt: coverageAttempt
  })
  const records = coverageRecordsWithBeginning([
    ...coveragePlanRecords(),
    executorReport(
      5,
      PlannedAttemptExecutorReport.cases.ExecutorWorkExecuting.make({
        correlation: plannedAttemptExecutorCorrelation(coverageAttempt)
      })
    )
  ])

  expect(continuationDecisionFor(transition, records, undefined, Option.none(), Option.none())).toEqual({ transition })
})

it.each(["WorkReported", "StateObserved"] as const)(
  "waits for an executing executor after Stop from a %s observation",
  (source) => {
    const requestId = AttemptChoiceRequestId.make({ nonce: `recovery-activation-stop-${source}`, runId: coverageRunId })
    const subject = {
      observedTaskRevision: TaskRevision.make(`recovery-activation-stop-${source}-observed`),
      plannedAttempt: coverageAttempt
    }
    const stop = coverageRecord(
      6,
      AttemptChoiceAppliedEvent.make({
        choice: "StopTaskImplementation",
        initiatedBy: { _tag: "Operator" },
        occurrenceClassification: "InitiatedAction",
        requestId,
        subject,
        version: workflowJournalEventVersion
      })
    )
    const executing = PlannedAttemptExecutorReport.cases.ExecutorWorkExecuting.make({
      correlation: plannedAttemptExecutorCorrelation(coverageAttempt)
    })
    const observation =
      source === "WorkReported"
        ? executorReport(7, executing)
        : coverageRecord(
            7,
            PlannedAttemptExecutorStateObservedEvent.make({
              observation: PlannedAttemptExecutorStateObservation.cases.ExactExecutorReport.make({ report: executing }),
              occurrenceClassification: "NonActionOccurrence",
              ordinal: PlannedAttemptExecutorStateObservationOrdinal.make(2),
              plannedAttempt: coverageAttempt,
              version: workflowJournalEventVersion
            })
          )
    const [facts] = deriveJournalResponsibilityFacts(
      coverageRunState(
        [...coveragePlanRecords(), executorReport(5, executing), stop, observation],
        [coverageResponsibility]
      ),
      Option.none(),
      Option.none(),
      coverageTarget
    )

    expect(facts).toMatchObject({
      _tag: "PlannedAttemptExecutorFreshFacts",
      disposition: { _tag: "AttemptStoppageWait", reason: "ExecutorExecuting" }
    })
  }
)

it("recovers each later pending or unreadable tracker read before proposing Resume", () => {
  type RefreshFamily = "Graph" | "Specification" | "Claim"
  type RefreshState = "Pending" | "GraphFailed" | "ClaimUnreadable"
  const refreshOperationFor = (family: RefreshFamily) => {
    const operationId = OperationId.make(`recovery-activation-refresh-${family.toLowerCase()}`)
    if (family === "Graph") {
      return makeTrackerGraphObservationOperation(
        { _tag: "AttemptContinuation" },
        operationId,
        coverageTarget,
        [coveragePlanOperation.operationId],
        [coverageAttempt.taskId]
      )
    }
    if (family === "Specification") {
      return makeTaskWorkSpecificationObservationOperation(operationId, coverageTarget, coverageAttempt.taskId, [
        coveragePlanOperation.operationId
      ])
    }
    return makeTaskClaimObservationOperation(operationId, coverageTarget, coverageAttempt.taskId, [
      coveragePlanOperation.operationId
    ])
  }
  const refreshedRecords = (family: RefreshFamily, state: RefreshState): ReadonlyArray<JournalRecord> => {
    const operation = refreshOperationFor(family)
    const intent = coverageRecord(15, taskTrackerReadIntent(operation))
    if (state === "Pending")
      return [
        ...continuationRecords(
          coverageClaimEvent,
          PlannedWorktreeReady.make({
            baseSha: coverageAttempt.baseSha,
            branch: coverageAttempt.branch,
            headSha: coverageAttempt.baseSha,
            worktree: coverageAttempt.worktree
          })
        ),
        intent
      ]
    if (state === "ClaimUnreadable") {
      const claimOperation = makeTaskClaimObservationOperation(
        operation.operationId,
        coverageTarget,
        coverageAttempt.taskId
      )
      return [
        ...continuationRecords(
          coverageClaimEvent,
          PlannedWorktreeReady.make({
            baseSha: coverageAttempt.baseSha,
            branch: coverageAttempt.branch,
            headSha: coverageAttempt.baseSha,
            worktree: coverageAttempt.worktree
          })
        ),
        intent,
        coverageRecord(
          16,
          taskTrackerFactsObservedEvent(operation.operationId, makeFocusedTaskClaimFactsUnreadable(claimOperation))
        )
      ]
    }
    const failed = TaskTrackerFactsReadFailed.make({
      completeness: "Unreadable",
      failure: { _tag: "FixtureReadError", detail: `${family} refresh failed` },
      operationId: operation.operationId,
      target: coverageTarget
    })
    return [
      ...continuationRecords(
        coverageClaimEvent,
        PlannedWorktreeReady.make({
          baseSha: coverageAttempt.baseSha,
          branch: coverageAttempt.branch,
          headSha: coverageAttempt.baseSha,
          worktree: coverageAttempt.worktree
        })
      ),
      intent,
      coverageRecord(16, taskTrackerFactsObservedEvent(operation.operationId, failed))
    ]
  }

  for (const family of ["Graph", "Specification", "Claim"] as const) {
    const states: ReadonlyArray<RefreshState> =
      family === "Graph"
        ? ["Pending", "GraphFailed"]
        : family === "Specification"
          ? ["Pending"]
          : ["Pending", "ClaimUnreadable"]
    for (const state of states) {
      const records = refreshedRecords(family, state)
      const refreshOperation = refreshOperationFor(family)
      const expectedOperation =
        state === "Pending"
          ? refreshOperation
          : family === "Graph"
            ? makeTrackerGraphObservationOperation(
                { _tag: "AttemptContinuation" },
                OperationId.make(`continuation:${coverageAttempt.attemptId}:after:16:graph`),
                coverageTarget,
                [coveragePlanOperation.operationId],
                [coverageAttempt.taskId]
              )
            : family === "Specification"
              ? makeTaskWorkSpecificationObservationOperation(
                  OperationId.make(`continuation:${coverageAttempt.attemptId}:after:16:specification`),
                  coverageTarget,
                  coverageAttempt.taskId,
                  [coveragePlanOperation.operationId, coverageGraphOperation.operationId]
                )
              : makeTaskClaimObservationOperation(
                  OperationId.make(`continuation:${coverageAttempt.attemptId}:after:16:claim`),
                  coverageTarget,
                  coverageAttempt.taskId,
                  [
                    coveragePlanOperation.operationId,
                    coverageGraphOperation.operationId,
                    coverageSpecificationOperation.operationId
                  ]
                )
      const decision = continuationDecisionFor(
        coverageContinuationTransition,
        records,
        { event: coverageGraphEvent, position: JournalPosition.make(8) },
        Option.none(),
        Option.none()
      )
      expect(decision.transition?._tag, `${family} ${state}`).toBe(
        family === "Graph"
          ? "ObservePlannedAttemptContinuationGraph"
          : family === "Specification"
            ? "ObservePlannedAttemptContinuationSpecification"
            : "ObservePlannedAttemptContinuationClaim"
      )
      expect(decision.transition?._tag, `${family} ${state}`).not.toBe(
        "ResumePlannedAttemptExecutorWorkAfterCurrentFacts"
      )
      expect(decision.transition, `${family} ${state}`).toMatchObject({
        plannedAttempt: coverageAttempt,
        operation: expectedOperation
      })
    }
  }
})

it("fails closed without a Run target and reuses or refreshes exact tracker reads", () => {
  const correlation = plannedAttemptExecutorCorrelation(coverageAttempt)
  const safe = PlannedAttemptExecutorReport.cases.ExecutorWorkSafelySuspended.make({ correlation })

  const noBeginning = continuationDecisionFor(
    coverageContinuationTransition,
    [...coveragePlanRecords(), executorReport(5, safe)],
    undefined,
    Option.none(),
    Option.none()
  )
  expect(noBeginning).toEqual({
    explanation: FrontierExplanation.PlannedAttemptExecutorWorkTypedIssue({ correlation, reason: "MissingFreshFacts" })
  })

  const pendingGraph = makeTrackerGraphObservationOperation(
    { _tag: "AttemptContinuation" },
    OperationId.make("recovery-activation-pending-graph"),
    coverageTarget,
    [coveragePlanOperation.operationId],
    [coverageAttempt.taskId]
  )
  const pendingGraphRecords = coverageRecordsWithBeginning([
    ...coveragePlanRecords(),
    executorReport(5, safe),
    coverageRecord(6, taskTrackerReadIntent(pendingGraph))
  ])
  const pendingGraphDecision = continuationDecisionFor(
    coverageContinuationTransition,
    pendingGraphRecords,
    undefined,
    Option.none(),
    Option.none()
  )
  expect(pendingGraphDecision.transition).toEqual(
    RunnableFrontierTransition.ObservePlannedAttemptContinuationGraph({
      operation: pendingGraph,
      plannedAttempt: coverageAttempt
    })
  )

  const unreadableGraph = makeTrackerGraphObservationOperation(
    { _tag: "AttemptContinuation" },
    OperationId.make("recovery-activation-unreadable-graph"),
    coverageTarget,
    [coveragePlanOperation.operationId],
    [coverageAttempt.taskId]
  )
  const unreadableGraphDecision = continuationDecisionFor(
    coverageContinuationTransition,
    coverageRecordsWithBeginning([
      ...coveragePlanRecords(),
      executorReport(5, safe),
      coverageRecord(6, taskTrackerReadIntent(unreadableGraph)),
      coverageRecord(
        7,
        taskTrackerFactsObservedEvent(
          unreadableGraph.operationId,
          TaskTrackerFactsReadFailed.make({
            completeness: "Unreadable",
            failure: { _tag: "FixtureReadError", detail: "graph refresh failed" },
            operationId: unreadableGraph.operationId,
            target: coverageTarget
          })
        )
      )
    ]),
    undefined,
    Option.none(),
    Option.none()
  )
  expect(unreadableGraphDecision.transition).toEqual(
    RunnableFrontierTransition.ObservePlannedAttemptContinuationGraph({
      operation: makeTrackerGraphObservationOperation(
        { _tag: "AttemptContinuation" },
        OperationId.make(`continuation:${coverageAttempt.attemptId}:after:8:graph`),
        coverageTarget,
        [coveragePlanOperation.operationId],
        [coverageAttempt.taskId]
      ),
      plannedAttempt: coverageAttempt
    })
  )

  const graphRecords = coverageRecordsWithBeginning([
    ...coveragePlanRecords(),
    executorReport(5, safe),
    coverageRecord(6, taskTrackerReadIntent(coverageGraphOperation)),
    coverageRecord(7, coverageGraphEvent)
  ])
  const graphObservation = { event: coverageGraphEvent, position: JournalPosition.make(8) }
  const specification = makeTaskWorkSpecificationObservationOperation(
    OperationId.make("recovery-activation-pending-specification"),
    coverageTarget,
    coverageAttempt.taskId,
    [coveragePlanOperation.operationId, coverageGraphOperation.operationId]
  )
  const specificationIntent = coverageRecord(9, taskTrackerReadIntent(specification))
  const pendingSpecificationDecision = continuationDecisionFor(
    coverageContinuationTransition,
    [...graphRecords, specificationIntent],
    graphObservation,
    Option.none(),
    Option.none()
  )
  expect(pendingSpecificationDecision.transition).toEqual(
    RunnableFrontierTransition.ObservePlannedAttemptContinuationSpecification({
      operation: specification,
      plannedAttempt: coverageAttempt
    })
  )

  const failedSpecification = TaskTrackerFactsReadFailed.make({
    completeness: "Unreadable",
    failure: { _tag: "FixtureReadError", detail: "specification refresh failed" },
    operationId: specification.operationId,
    target: coverageTarget
  })
  const failedSpecificationDecision = continuationDecisionFor(
    coverageContinuationTransition,
    [
      ...graphRecords,
      specificationIntent,
      coverageRecord(10, taskTrackerFactsObservedEvent(specification.operationId, failedSpecification))
    ],
    graphObservation,
    Option.none(),
    Option.none()
  )
  expect(failedSpecificationDecision.transition).toEqual(
    RunnableFrontierTransition.ObservePlannedAttemptContinuationSpecification({
      operation: makeTaskWorkSpecificationObservationOperation(
        OperationId.make(`continuation:${coverageAttempt.attemptId}:after:10:specification`),
        coverageTarget,
        coverageAttempt.taskId,
        [coveragePlanOperation.operationId, coverageGraphOperation.operationId]
      ),
      plannedAttempt: coverageAttempt
    })
  )

  const staleGraphBase = continuationRecords(
    coverageClaimEvent,
    PlannedWorktreeReady.make({
      baseSha: coverageAttempt.baseSha,
      branch: coverageAttempt.branch,
      headSha: coverageAttempt.baseSha,
      worktree: coverageAttempt.worktree
    })
  )
  const lateExecutorReport = executorReport(Number(staleGraphBase.at(-1)?.position ?? 0) + 1, safe, 5)
  const staleGraphRecords = [
    ...staleGraphBase.filter((record) => record.event._tag !== "PlannedAttemptExecutorWorkReported"),
    lateExecutorReport
  ]
  const staleGraphDecision = continuationDecisionFor(
    coverageContinuationTransition,
    staleGraphRecords,
    graphObservation,
    Option.none(),
    Option.none()
  )
  expect(staleGraphDecision.transition?._tag).toBe("ObservePlannedAttemptContinuationGraph")
  if (staleGraphDecision.transition?._tag === "ObservePlannedAttemptContinuationGraph") {
    expect(staleGraphDecision.transition.operation.operationId).not.toBe(coverageGraphOperation.operationId)
    expect(staleGraphDecision.transition.operation.target).toEqual(coverageTarget)
  }
})

it("refreshes pending graph and specification reads after the accepted Safe boundary", () => {
  const safe = PlannedAttemptExecutorReport.cases.ExecutorWorkSafelySuspended.make({
    correlation: plannedAttemptExecutorCorrelation(coverageAttempt)
  })
  const ready = PlannedWorktreeReady.make({
    baseSha: coverageAttempt.baseSha,
    branch: coverageAttempt.branch,
    headSha: coverageAttempt.baseSha,
    worktree: coverageAttempt.worktree
  })
  const base = continuationRecords(coverageClaimEvent, ready)
  const pendingGraph = makeTrackerGraphObservationOperation(
    { _tag: "AttemptContinuation" },
    OperationId.make("recovery-activation-after-safe-pending-graph"),
    coverageTarget,
    [coveragePlanOperation.operationId],
    [coverageAttempt.taskId]
  )
  const graphDecision = continuationDecisionFor(
    coverageContinuationTransition,
    [...base, executorReport(15, safe, 6), coverageRecord(16, taskTrackerReadIntent(pendingGraph))],
    undefined,
    Option.none(),
    Option.none()
  )
  expect(graphDecision.transition).toEqual(
    RunnableFrontierTransition.ObservePlannedAttemptContinuationGraph({
      operation: pendingGraph,
      plannedAttempt: coverageAttempt
    })
  )

  const graphRecords = coverageRecordsWithBeginning([
    ...coveragePlanRecords(),
    executorReport(5, safe),
    coverageRecord(6, taskTrackerReadIntent(coverageGraphOperation)),
    coverageRecord(7, coverageGraphEvent)
  ])
  const graphObservation = { event: coverageGraphEvent, position: JournalPosition.make(8) }
  const pendingSpecification = makeTaskWorkSpecificationObservationOperation(
    OperationId.make("recovery-activation-after-graph-pending-specification"),
    coverageTarget,
    coverageAttempt.taskId,
    [coveragePlanOperation.operationId]
  )
  const specificationDecision = continuationDecisionFor(
    coverageContinuationTransition,
    [...graphRecords, coverageRecord(9, taskTrackerReadIntent(pendingSpecification))],
    graphObservation,
    Option.none(),
    Option.none()
  )
  expect(specificationDecision.transition).toEqual(
    RunnableFrontierTransition.ObservePlannedAttemptContinuationSpecification({
      operation: pendingSpecification,
      plannedAttempt: coverageAttempt
    })
  )
})

it("fails closed when Begin lacks both the immutable Run target and exact claim authority", () => {
  const transition = RunnableFrontierTransition.BeginPlannedAttemptExecutorWork({ plannedAttempt: coverageAttempt })

  expect(continuationDecisionFor(transition, coveragePlanRecords(), undefined, Option.none(), Option.none())).toEqual({
    explanation: FrontierExplanation.PlannedAttemptExecutorWorkTypedIssue({
      correlation: plannedAttemptExecutorCorrelation(coverageAttempt),
      reason: "MissingFreshFacts"
    })
  })
})

it("keeps an exact continuation from crossing a non-ancestor target-lineage result", () => {
  const ready = PlannedWorktreeReady.make({
    baseSha: coverageAttempt.baseSha,
    branch: coverageAttempt.branch,
    headSha: coverageAttempt.baseSha,
    worktree: coverageAttempt.worktree
  })
  const records = continuationRecords(coverageClaimEvent, ready)
  const worktreeOperationId = OperationId.make("recovery-activation-coverage-worktree")
  const integrationTarget = IntegrationTarget.make({
    ref: IntegrationTargetRef.make("refs/heads/main"),
    repository: GitRepositoryLocator.make("/repositories/recovery-activation-lineage.git")
  })
  const lineageOperation = makeTargetLineageObservationOperation({
    integrationTarget,
    operationId: OperationId.make("recovery-activation-invalid-lineage"),
    plannedAttempt: coverageAttempt,
    predecessorOperationIds: [worktreeOperationId]
  })
  const lineageIntent = coverageRecord(
    Number(records.at(-1)?.position ?? 0) + 1,
    GitReadIntentRecordedEvent.make({
      initiatedBy: { _tag: "DalphCoordinator" },
      occurrenceClassification: "InitiatedAction",
      operation: lineageOperation,
      version: workflowJournalEventVersion
    })
  )
  const lineageObservation = coverageRecord(
    Number(lineageIntent.position) + 1,
    TargetLineageObservedEvent.make({
      observation: TargetLineageObservation.make({
        plannedBaseIsAncestorOfTargetHead: false,
        plannedBaseSha: coverageAttempt.baseSha,
        targetHeadSha: coverageAttempt.baseSha
      }),
      occurrenceClassification: "NonActionOccurrence",
      operationId: lineageOperation.operationId,
      plannedAttempt: coverageAttempt,
      version: workflowJournalEventVersion
    })
  )
  const currentGraph = records.find(
    (record) =>
      record.event._tag === "TaskTrackerFactsObserved" &&
      record.event.operationId === coverageGraphOperation.operationId
  )
  if (currentGraph?.event._tag !== "TaskTrackerFactsObserved")
    return expect.fail("expected the exact graph observation")

  const decision = continuationDecisionFor(
    coverageContinuationTransition,
    [...records, lineageIntent, lineageObservation],
    { event: currentGraph.event, position: currentGraph.position },
    Option.none(),
    Option.some(integrationTarget)
  )
  expect(decision).toEqual({})
})

it("does not seed a continuation graph read from a foreign immutable Run target", () => {
  const foreignTarget = FixtureTarget.make("recovery-activation-foreign-target")
  const foreignGraphOperation = makeTrackerGraphObservationOperation(
    { _tag: "WorkflowEstablishment" },
    OperationId.make("recovery-activation-foreign-target-graph"),
    foreignTarget,
    [coveragePlanOperation.operationId],
    [coverageAttempt.taskId]
  )
  const foreignGraph = validSnapshot({
    revision: "recovery-activation-foreign-target-graph-revision",
    tasks: [{ id: coverageAttempt.taskId, lifecycle: { _tag: "Open" }, parentTaskId: null, prerequisiteIds: [] }]
  })
  const foreignGraphEvent = taskTrackerFactsObservedEvent(
    foreignGraphOperation.operationId,
    makeCompleteTaskTrackerFactsObserved(foreignGraphOperation, foreignGraph)
  )
  const began = makeWorkflowRunBeganRecord(coverageRunId, coverageTarget, coveragePolicy)
  const records = [
    began,
    ...coveragePlanRecords(),
    executorReport(
      5,
      PlannedAttemptExecutorReport.cases.ExecutorWorkSafelySuspended.make({
        correlation: plannedAttemptExecutorCorrelation(coverageAttempt)
      })
    ),
    coverageRecord(6, foreignGraphEvent)
  ]
  const reconstructed: ReconstructedRunState = {
    ...coverageRunState(records, [coverageResponsibility]),
    graphKnowledge: { taskTrackerFacts: [foreignGraphEvent.observation] }
  }

  return Effect.runPromise(
    Effect.gen(function* () {
      const resources = yield* makeIntegrationTargetResourceController()
      const recovery = yield* makeRunRecoveryProjection(coverageRunId, undefined, resources).pipe(
        Effect.provideService(InRunJournal, currentProjectionJournal(coverageRunId, coverageTarget, reconstructed))
      )
      const projection = yield* recovery.readDeliveryProjection
      const graphRead = projection.frontier.transitions.find(
        ({ _tag }) => _tag === "ObservePlannedAttemptContinuationGraph"
      )
      expect(graphRead?._tag).toBe("ObservePlannedAttemptContinuationGraph")
      if (graphRead?._tag === "ObservePlannedAttemptContinuationGraph") {
        expect(graphRead.operation.target).toEqual(coverageTarget)
        expect(graphRead.operation.operationId).toContain("continuation:")
        expect(graphRead.operation.operationId).not.toBe(foreignGraphOperation.operationId)
      }
      expect(
        projection.frontier.transitions.some(
          (transition) =>
            transition._tag === "ObservePlannedAttemptContinuationGraph" &&
            transition.operation.target === foreignTarget
        )
      ).toBe(false)
    })
  )
})

it("keeps graph eligibility on a readable full or correctly linked reconfirmed snapshot", () => {
  const snapshot = validSnapshot({
    revision: "recovery-activation-graph-reconfirmation",
    rootTaskId: "root",
    tasks: [
      { id: "root", lifecycle: { _tag: "Open" }, parentTaskId: null, prerequisiteIds: [] },
      {
        id: coverageAttempt.taskId,
        lifecycle: { _tag: "Open" },
        parentTaskId: "root",
        prerequisiteIds: ["prerequisite"]
      },
      { id: "prerequisite", lifecycle: { _tag: "CompletedSuccessfully" }, parentTaskId: "root", prerequisiteIds: [] }
    ]
  })
  const fullOperation = makeTrackerGraphObservationOperation(
    { _tag: "WorkflowEstablishment" },
    OperationId.make("recovery-activation-graph-reconfirmation-full"),
    coverageTarget,
    [],
    [coverageAttempt.taskId]
  )
  const fullEvent = taskTrackerFactsObservedEvent(
    fullOperation.operationId,
    makeCompleteTaskTrackerFactsObserved(fullOperation, snapshot)
  )
  const fullObservation = makeCompleteTaskTrackerFactsObserved(fullOperation, snapshot)
  const fullRecord = coverageRecord(2, fullEvent)
  expect(graphKeepsTaskEligible([fullRecord], fullObservation, fullRecord.position, coverageAttempt.taskId)).toBe(true)

  const reconfirmationOperation = makeTrackerGraphObservationOperation(
    { _tag: "WorkflowEstablishment" },
    OperationId.make("recovery-activation-graph-reconfirmation-later"),
    coverageTarget,
    [fullOperation.operationId],
    [coverageAttempt.taskId]
  )
  const reconfirmationEvent = makeTaskTrackerFactsObservedFromRead(
    [{ event: taskTrackerReadIntent(fullOperation) }, { event: fullEvent }],
    reconfirmationOperation,
    snapshot
  )
  if (reconfirmationEvent.observation._tag !== "UnchangedTaskTrackerFactsReconfirmed") {
    return expect.fail("reconfirmation fixture did not produce a reconfirmed graph observation")
  }
  expect(
    graphKeepsTaskEligible(
      [fullRecord],
      reconfirmationEvent.observation,
      JournalPosition.make(3),
      coverageAttempt.taskId
    )
  ).toBe(true)
  expect(
    graphKeepsTaskEligible([], reconfirmationEvent.observation, JournalPosition.make(3), coverageAttempt.taskId)
  ).toBe(false)

  const omittedTaskSnapshot = validSnapshot({
    revision: "recovery-activation-graph-omits-task-snapshot",
    rootTaskId: "root",
    tasks: [{ id: "root", lifecycle: { _tag: "Open" }, parentTaskId: null, prerequisiteIds: [] }]
  })
  const omittedTaskOperation = makeTrackerGraphObservationOperation(
    { _tag: "WorkflowEstablishment" },
    OperationId.make("recovery-activation-graph-omits-task"),
    coverageTarget,
    [],
    [TaskId.make("another-task")]
  )
  expect(
    graphKeepsTaskEligible(
      [],
      makeCompleteTaskTrackerFactsObserved(omittedTaskOperation, omittedTaskSnapshot),
      JournalPosition.make(2),
      coverageAttempt.taskId
    )
  ).toBe(false)

  const blockedSnapshot = validSnapshot({
    revision: "recovery-activation-graph-unsatisfied-prerequisite",
    rootTaskId: "root",
    tasks: [
      { id: "root", lifecycle: { _tag: "Open" }, parentTaskId: null, prerequisiteIds: [] },
      {
        id: coverageAttempt.taskId,
        lifecycle: { _tag: "Open" },
        parentTaskId: "root",
        prerequisiteIds: ["blocked-prerequisite"]
      },
      { id: "blocked-prerequisite", lifecycle: { _tag: "Open" }, parentTaskId: "root", prerequisiteIds: [] }
    ]
  })
  const blockedOperation = makeTrackerGraphObservationOperation(
    { _tag: "WorkflowEstablishment" },
    OperationId.make("recovery-activation-graph-blocked"),
    coverageTarget,
    [],
    [coverageAttempt.taskId]
  )
  const blockedObservation = makeCompleteTaskTrackerFactsObserved(blockedOperation, blockedSnapshot)
  expect(graphKeepsTaskEligible([], blockedObservation, JournalPosition.make(2), coverageAttempt.taskId)).toBe(false)

  const closedSnapshot = validSnapshot({
    revision: "recovery-activation-graph-closed-task",
    rootTaskId: "root",
    tasks: [
      { id: "root", lifecycle: { _tag: "Open" }, parentTaskId: null, prerequisiteIds: [] },
      {
        id: coverageAttempt.taskId,
        lifecycle: { _tag: "TerminalWithoutSuccess" },
        parentTaskId: "root",
        prerequisiteIds: []
      }
    ]
  })
  const closedOperation = makeTrackerGraphObservationOperation(
    { _tag: "WorkflowEstablishment" },
    OperationId.make("recovery-activation-graph-closed"),
    coverageTarget,
    [],
    [coverageAttempt.taskId]
  )
  expect(
    graphKeepsTaskEligible(
      [],
      makeCompleteTaskTrackerFactsObserved(closedOperation, closedSnapshot),
      JournalPosition.make(2),
      coverageAttempt.taskId
    )
  ).toBe(false)
})

it("classifies exact continuation reads by target and durable outcome state", () => {
  const operation = makeTaskClaimObservationOperation(
    OperationId.make("recovery-activation-freshness-claim"),
    coverageTarget,
    coverageAttempt.taskId
  )
  const foreignOperation = makeTaskClaimObservationOperation(
    OperationId.make("recovery-activation-freshness-foreign-claim"),
    FixtureTarget.make("recovery-activation-freshness-foreign-target"),
    coverageAttempt.taskId
  )
  const intentRecord = coverageRecord(2, taskTrackerReadIntent(operation))
  expect(
    latestContinuationTrackerReadStatusAfter(
      [coverageRecord(2, taskTrackerReadIntent(foreignOperation))],
      JournalPosition.make(1),
      "ReadTaskClaim",
      coverageTarget,
      coverageAttempt.taskId
    )
  ).toBeUndefined()
  expect(
    latestContinuationTrackerReadStatusAfter(
      [intentRecord],
      JournalPosition.make(1),
      "ReadTaskClaim",
      coverageTarget,
      coverageAttempt.taskId
    )
  ).toMatchObject({ _tag: "Pending" })
  expect(
    latestContinuationTrackerReadStatusAfter(
      [intentRecord],
      JournalPosition.make(1),
      "ReadTaskClaim",
      coverageTarget,
      coverageAttempt.taskId,
      coverageAttempt
    )
  ).toBeUndefined()

  const graphOperation = makeTrackerGraphObservationOperation(
    { _tag: "WorkflowEstablishment" },
    OperationId.make("recovery-activation-freshness-graph-failed"),
    coverageTarget,
    [],
    [coverageAttempt.taskId]
  )
  const failedGraph = TaskTrackerFactsReadFailed.make({
    completeness: "Unreadable",
    failure: { _tag: "FixtureReadError", detail: "graph unavailable" },
    operationId: graphOperation.operationId,
    target: coverageTarget
  })
  expect(
    latestContinuationTrackerReadStatusAfter(
      [
        coverageRecord(3, taskTrackerReadIntent(graphOperation)),
        coverageRecord(4, taskTrackerFactsObservedEvent(graphOperation.operationId, failedGraph))
      ],
      JournalPosition.make(1),
      "ReadTrackerGraph",
      coverageTarget,
      coverageAttempt.taskId
    )
  ).toMatchObject({ _tag: "Unreadable" })
})

it("fails closed for a valid no-begin prefix with a paired pending Git read", () => {
  const pendingWorktreeOperation = makeTaskWorktreeObservationOperation({
    operationId: OperationId.make("recovery-activation-no-begin-worktree"),
    plannedAttempt: coverageAttempt,
    predecessorOperationIds: [coveragePlanOperation.operationId]
  })
  const records = [
    ...coveragePlanRecords(),
    {
      ...coverageRecord(5, taskTrackerReadIntent(coverageGraphOperation)),
      key: intentRecordKey(coverageGraphOperation.operationId)
    },
    { ...coverageRecord(6, coverageGraphEvent), key: outcomeRecordKey(coverageGraphOperation.operationId) },
    {
      ...coverageRecord(
        7,
        GitReadIntentRecordedEvent.make({
          initiatedBy: { _tag: "DalphCoordinator" },
          occurrenceClassification: "InitiatedAction",
          operation: pendingWorktreeOperation,
          version: workflowJournalEventVersion
        })
      ),
      key: intentRecordKey(pendingWorktreeOperation.operationId)
    }
  ]
  const reduced = reduceWorkflowJournalHistory(coverageRunId, records)
  expect(reduced._tag).toBe("ValidWorkflowJournalHistory")
  if (reduced._tag !== "ValidWorkflowJournalHistory") return
  const reconstructed: ReconstructedRunState = {
    ...reduced.runState,
    responsibility: { entries: [coverageResponsibility] },
    graphKnowledge: { taskTrackerFacts: [coverageGraphEvent.observation] }
  }
  const journal = InRunJournal.of({
    append: () => Effect.die("no-begin projection must not append"),
    read: () => Effect.succeed(records)
  })
  const statefulJournal = Object.assign(journal, { state: { get: Effect.succeed({ reconstructed }) } })

  return Effect.runPromise(
    Effect.gen(function* () {
      const resources = yield* makeIntegrationTargetResourceController()
      const recovery = yield* makeRunRecoveryProjection(coverageRunId, undefined, resources).pipe(
        Effect.provideService(InRunJournal, statefulJournal)
      )
      const projection = yield* recovery.readDeliveryProjection
      expect(projection.frontier.transitions).toEqual([])
      expect(projection.frontier.explanations).toContainEqual(
        FrontierExplanation.PlannedAttemptExecutorWorkTypedIssue({
          correlation: plannedAttemptExecutorCorrelation(coverageAttempt),
          reason: "MissingFreshFacts"
        })
      )
    })
  )
})

effectIt.effect(
  "restart excludes premature worktree while specification is pending and replays the completed tracker chain",
  () =>
    Effect.gen(function* () {
      const worktreeOperation = makeTaskWorktreeObservationOperation({
        operationId: OperationId.make("recovery-activation-restart-pending-worktree"),
        plannedAttempt: coverageAttempt,
        predecessorOperationIds: [
          coveragePlanOperation.operationId,
          coverageGraphOperation.operationId,
          coverageSpecificationOperation.operationId,
          coverageClaimOperation.operationId
        ]
      })
      const lineageOperation = makeTargetLineageObservationOperation({
        integrationTarget: IntegrationTarget.make({
          ref: IntegrationTargetRef.make("refs/heads/main"),
          repository: GitRepositoryLocator.make("/repositories/recovery-activation.git")
        }),
        operationId: OperationId.make("recovery-activation-restart-pending-lineage"),
        plannedAttempt: coverageAttempt,
        predecessorOperationIds: [worktreeOperation.operationId]
      })
      const intentFor = (operation: typeof worktreeOperation | typeof lineageOperation) =>
        GitReadIntentRecordedEvent.make({
          initiatedBy: { _tag: "DalphCoordinator" },
          occurrenceClassification: "InitiatedAction",
          operation,
          version: workflowJournalEventVersion
        })
      const prefix = coverageRecordsWithBeginning([
        ...coveragePlanRecords(),
        coverageRecord(5, taskTrackerReadIntent(coverageGraphOperation)),
        coverageRecord(6, coverageGraphEvent),
        coverageRecord(7, taskTrackerReadIntent(coverageSpecificationOperation)),
        coverageRecord(8, coverageSpecificationEvent),
        coverageRecord(9, taskTrackerReadIntent(coverageClaimOperation)),
        coverageRecord(10, coverageClaimEvent),
        coverageRecord(11, intentFor(worktreeOperation))
      ])
      const worktreeObserved = coverageRecord(
        13,
        PlannedAttemptWorktreeObservedEvent.make({
          observation: PlannedWorktreeReady.make({
            baseSha: coverageAttempt.baseSha,
            branch: coverageAttempt.branch,
            headSha: coverageAttempt.baseSha,
            worktree: coverageAttempt.worktree
          }),
          occurrenceClassification: "NonActionOccurrence",
          operationId: worktreeOperation.operationId,
          version: workflowJournalEventVersion
        })
      )
      const projectionFor = (records: ReadonlyArray<JournalRecord>) =>
        Effect.gen(function* () {
          const reconstructed = {
            ...coverageRunState(records, [coverageResponsibilityAfterBeginning]),
            graphKnowledge: { taskTrackerFacts: [coverageGraphEvent.observation] }
          }
          const journal = Object.assign(
            InRunJournal.of({
              append: () => Effect.die("restart projection must not append"),
              read: () => Effect.succeed(records)
            }),
            { state: { get: Effect.succeed({ reconstructed }) } }
          )
          const resources = yield* makeIntegrationTargetResourceController()
          const recovery = yield* makeRunRecoveryProjection(
            coverageRunId,
            lineageOperation.integrationTarget,
            resources
          ).pipe(Effect.provideService(InRunJournal, journal))
          return (yield* recovery.readDeliveryProjection).frontier.transitions
        })

      const pendingSpecification = coverageRecordsWithBeginning([
        ...coveragePlanRecords(),
        coverageRecord(5, taskTrackerReadIntent(coverageGraphOperation)),
        coverageRecord(6, coverageGraphEvent),
        coverageRecord(7, taskTrackerReadIntent(coverageSpecificationOperation)),
        coverageRecord(8, taskTrackerReadIntent(coverageClaimOperation)),
        coverageRecord(9, intentFor(worktreeOperation))
      ])
      const whileSpecificationPending = yield* projectionFor(pendingSpecification)
      expect(
        whileSpecificationPending.filter(
          ({ _tag }) =>
            _tag === "ObservePlannedAttemptContinuationWorktree" ||
            _tag === "ObservePlannedAttemptContinuationTargetLineage"
        )
      ).toEqual([])

      const failedGraph = TaskTrackerFactsReadFailed.make({
        completeness: "Unreadable",
        failure: { _tag: "FixtureReadError", detail: "tracker unavailable before the pending worktree" },
        operationId: coverageGraphOperation.operationId,
        target: coverageTarget
      })
      const foreignSpecificationOperation = makeTaskWorkSpecificationObservationOperation(
        coverageSpecificationOperation.operationId,
        FixtureTarget.make("recovery-activation-foreign-target"),
        coverageAttempt.taskId,
        coverageSpecificationOperation.predecessorOperationIds
      )
      const invalidTrackerChains = [
        [
          ...coveragePlanRecords(),
          coverageRecord(5, taskTrackerReadIntent(coverageGraphOperation)),
          coverageRecord(6, taskTrackerFactsObservedEvent(coverageGraphOperation.operationId, failedGraph)),
          coverageRecord(7, taskTrackerReadIntent(coverageSpecificationOperation)),
          coverageRecord(8, coverageSpecificationEvent),
          coverageRecord(9, taskTrackerReadIntent(coverageClaimOperation)),
          coverageRecord(10, coverageClaimEvent),
          coverageRecord(11, intentFor(worktreeOperation))
        ],
        [
          ...coveragePlanRecords(),
          coverageRecord(5, taskTrackerReadIntent(coverageGraphOperation)),
          coverageRecord(6, coverageGraphEvent),
          coverageRecord(7, taskTrackerReadIntent(coverageSpecificationOperation)),
          coverageRecord(8, coverageSpecificationEvent),
          coverageRecord(9, taskTrackerReadIntent(coverageClaimOperation)),
          coverageRecord(
            10,
            taskTrackerFactsObservedEvent(
              coverageClaimOperation.operationId,
              makeFocusedTaskClaimFactsUnreadable(coverageClaimOperation)
            )
          ),
          coverageRecord(11, intentFor(worktreeOperation))
        ],
        [
          ...coveragePlanRecords(),
          coverageRecord(5, taskTrackerReadIntent(coverageGraphOperation)),
          coverageRecord(6, coverageGraphEvent),
          coverageRecord(7, taskTrackerReadIntent(foreignSpecificationOperation)),
          coverageRecord(
            8,
            taskTrackerFactsObservedEvent(
              foreignSpecificationOperation.operationId,
              makeFocusedTaskWorkSpecificationFactsObserved(foreignSpecificationOperation, coverageSpecification)
            )
          ),
          coverageRecord(9, taskTrackerReadIntent(coverageClaimOperation)),
          coverageRecord(10, coverageClaimEvent),
          coverageRecord(11, intentFor(worktreeOperation))
        ]
      ]
      for (const invalidTrackerChain of invalidTrackerChains) {
        const transitions = yield* projectionFor(coverageRecordsWithBeginning(invalidTrackerChain))
        expect(
          transitions.filter(
            ({ _tag }) =>
              _tag === "ObservePlannedAttemptContinuationWorktree" ||
              _tag === "ObservePlannedAttemptContinuationTargetLineage"
          )
        ).toEqual([])
      }

      const premature = yield* projectionFor([...prefix, coverageRecord(13, intentFor(lineageOperation))])
      expect(
        premature.filter(
          ({ _tag }) =>
            _tag === "ObservePlannedAttemptContinuationWorktree" ||
            _tag === "ObservePlannedAttemptContinuationTargetLineage"
        )
      ).toMatchObject([
        { _tag: "ObservePlannedAttemptContinuationWorktree", operation: { operationId: worktreeOperation.operationId } }
      ])

      const afterWorktree = yield* projectionFor([
        ...prefix,
        worktreeObserved,
        coverageRecord(14, intentFor(lineageOperation))
      ])
      expect(
        afterWorktree.filter(
          ({ _tag }) =>
            _tag === "ObservePlannedAttemptContinuationWorktree" ||
            _tag === "ObservePlannedAttemptContinuationTargetLineage"
        )
      ).toMatchObject([
        {
          _tag: "ObservePlannedAttemptContinuationTargetLineage",
          operation: { operationId: lineageOperation.operationId }
        }
      ])
    })
)

it("scopes recovery responsibility to the immutable Run target", () => {
  const foreignTarget = FixtureTarget.make("recovery-activation-responsibility-foreign-target")
  const foreignGraphOperation = makeTrackerGraphObservationOperation(
    { _tag: "WorkflowEstablishment" },
    OperationId.make("recovery-activation-responsibility-foreign-graph"),
    foreignTarget,
    [coveragePlanOperation.operationId],
    [coverageAttempt.taskId]
  )
  const foreignGraph = validSnapshot({
    revision: "recovery-activation-responsibility-foreign-graph-revision",
    tasks: [
      {
        id: coverageAttempt.taskId,
        lifecycle: { _tag: "CompletedSuccessfully" },
        parentTaskId: null,
        prerequisiteIds: []
      }
    ]
  })
  const foreignSpecificationOperation = makeTaskWorkSpecificationObservationOperation(
    OperationId.make("recovery-activation-responsibility-foreign-specification"),
    foreignTarget,
    coverageAttempt.taskId,
    [coveragePlanOperation.operationId]
  )
  const foreignSpecification = makeTaskWorkSpecification({
    body: "foreign body",
    taskId: coverageAttempt.taskId,
    title: "foreign title"
  })
  const foreignClaimOperation = makeTaskClaimObservationOperation(
    OperationId.make("recovery-activation-responsibility-foreign-claim"),
    foreignTarget,
    coverageAttempt.taskId,
    [coveragePlanOperation.operationId]
  )
  const foreignClaim = ActiveTaskClaim.make({
    operationId: OperationId.make("recovery-activation-responsibility-foreign-claim-acquired"),
    owner: ClaimOwner.make("foreign-owner"),
    taskId: coverageAttempt.taskId,
    token: ClaimToken.make("recovery-activation-responsibility-foreign-token")
  })
  const foreignEvents = [
    taskTrackerFactsObservedEvent(
      foreignGraphOperation.operationId,
      makeCompleteTaskTrackerFactsObserved(foreignGraphOperation, foreignGraph)
    ),
    taskTrackerFactsObservedEvent(
      foreignSpecificationOperation.operationId,
      makeFocusedTaskWorkSpecificationFactsObserved(foreignSpecificationOperation, foreignSpecification)
    ),
    taskTrackerFactsObservedEvent(
      foreignClaimOperation.operationId,
      makeFocusedTaskClaimFactsObserved(foreignClaimOperation, foreignClaim)
    )
  ]
  const began = makeWorkflowRunBeganRecord(coverageRunId, coverageTarget, coveragePolicy)
  const shiftedPlanRecords = coveragePlanRecords().map((record) => ({
    ...record,
    position: JournalPosition.make(Number(record.position) + 1)
  }))
  const exactRecords = [
    {
      ...coverageRecord(6, taskTrackerReadIntent(coverageGraphOperation)),
      key: intentRecordKey(coverageGraphOperation.operationId)
    },
    { ...coverageRecord(7, coverageGraphEvent), key: outcomeRecordKey(coverageGraphOperation.operationId) },
    {
      ...coverageRecord(8, taskTrackerReadIntent(coverageSpecificationOperation)),
      key: intentRecordKey(coverageSpecificationOperation.operationId)
    },
    {
      ...coverageRecord(9, coverageSpecificationEvent),
      key: outcomeRecordKey(coverageSpecificationOperation.operationId)
    },
    {
      ...coverageRecord(10, taskTrackerReadIntent(coverageClaimOperation)),
      key: intentRecordKey(coverageClaimOperation.operationId)
    },
    { ...coverageRecord(11, coverageClaimEvent), key: outcomeRecordKey(coverageClaimOperation.operationId) }
  ]
  const foreignRecords = foreignEvents.flatMap((event, index) => {
    const operationId = event.operationId
    const operation =
      index === 0 ? foreignGraphOperation : index === 1 ? foreignSpecificationOperation : foreignClaimOperation
    const intent = coverageRecord(12 + index * 2, taskTrackerReadIntent(operation))
    const outcome = coverageRecord(13 + index * 2, event)
    return [
      { ...intent, key: intentRecordKey(operationId) },
      { ...outcome, key: outcomeRecordKey(operationId) }
    ]
  })
  const records = [began, ...shiftedPlanRecords, ...exactRecords, ...foreignRecords]
  const reduced = reduceWorkflowJournalHistory(coverageRunId, records)
  expect(reduced._tag).toBe("ValidWorkflowJournalHistory")
  if (reduced._tag !== "ValidWorkflowJournalHistory") return

  const responsibilityFacts = deriveJournalResponsibilityFacts(
    reduced.runState,
    Option.none(),
    Option.none(),
    coverageTarget
  )
  expect(
    responsibilityFacts.some(
      ({ disposition }) =>
        disposition._tag === "TaskExternalSuccessConstraint" ||
        disposition._tag === "TaskExternalSuccessSettled" ||
        disposition._tag === "TaskMembershipConstraint" ||
        disposition._tag === "TaskLifecycleConstraint"
    )
  ).toBe(false)
  expect(
    responsibilityFacts.some(
      ({ disposition }) =>
        disposition._tag === "TaskSpecificationChangeConstraint" &&
        disposition.observedFingerprint === foreignSpecification.fingerprint
    )
  ).toBe(false)

  const result = Effect.runSync(
    Effect.gen(function* () {
      const resources = yield* makeIntegrationTargetResourceController()
      const recovery = yield* makeRunRecoveryProjection(coverageRunId, undefined, resources).pipe(
        Effect.provideService(InRunJournal, currentProjectionJournal(coverageRunId, coverageTarget, reduced.runState))
      )
      return yield* recovery.readDeliveryProjection
    })
  )
  expect(
    result.frontier.transitions.some(
      ({ _tag }) =>
        _tag === "ReleaseExternallyCompletedTaskClaim" ||
        _tag === "ReleaseCancelledAttemptClaim" ||
        _tag === "ReleaseStoppedAttemptClaim" ||
        _tag === "RelinquishCancelledAttemptImplementation"
    )
  ).toBe(false)
})

it("does not release a cancelled claim from a foreign-target observation", () => {
  const foreignTarget = FixtureTarget.make("recovery-activation-cancelled-foreign-target")
  const foreignClaimOperation = makeTaskClaimObservationOperation(
    OperationId.make("recovery-activation-cancelled-foreign-claim-read"),
    foreignTarget,
    coverageAttempt.taskId,
    [coverageClaim.operationId]
  )
  const foreignClaim = ActiveTaskClaim.make({
    operationId: OperationId.make("recovery-activation-cancelled-foreign-claim"),
    owner: ClaimOwner.make("foreign-owner"),
    taskId: coverageAttempt.taskId,
    token: ClaimToken.make("recovery-activation-cancelled-foreign-token")
  })
  const began = makeWorkflowRunBeganRecord(coverageRunId, coverageTarget, coveragePolicy)
  const shiftedPlanRecords = coveragePlanRecords().map((record) => ({
    ...record,
    position: JournalPosition.make(Number(record.position) + 1)
  }))
  const executing = PlannedAttemptExecutorReport.cases.ExecutorWorkExecuting.make({
    correlation: plannedAttemptExecutorCorrelation(coverageAttempt)
  })
  const safe = PlannedAttemptExecutorReport.cases.ExecutorWorkSafelySuspended.make({
    correlation: plannedAttemptExecutorCorrelation(coverageAttempt)
  })
  const beginIntent = coverageRecord(
    6,
    PlannedAttemptExecutorCommandIntendedEvent.make({
      command: "Begin",
      initiatedBy: { _tag: "DalphCoordinator" },
      occurrenceClassification: "InitiatedAction",
      ordinal: PlannedAttemptExecutorCommandOrdinal.make(1),
      plannedAttempt: coverageAttempt,
      version: workflowJournalEventVersion
    })
  )
  const beginResponse = coverageRecord(
    7,
    PlannedAttemptExecutorCommandResponseObservedEvent.make({
      commandOrdinal: PlannedAttemptExecutorCommandOrdinal.make(1),
      occurrenceClassification: "NonActionOccurrence",
      plannedAttempt: coverageAttempt,
      report: executing,
      version: workflowJournalEventVersion
    })
  )
  const executingReport = executorReport(8, executing, 1)
  const suspendIntent = coverageRecord(
    9,
    PlannedAttemptExecutorCommandIntendedEvent.make({
      command: "Suspend",
      initiatedBy: { _tag: "DalphCoordinator" },
      occurrenceClassification: "InitiatedAction",
      ordinal: PlannedAttemptExecutorCommandOrdinal.make(2),
      plannedAttempt: coverageAttempt,
      version: workflowJournalEventVersion
    })
  )
  const suspendResponse = coverageRecord(
    10,
    PlannedAttemptExecutorCommandResponseObservedEvent.make({
      commandOrdinal: PlannedAttemptExecutorCommandOrdinal.make(2),
      occurrenceClassification: "NonActionOccurrence",
      plannedAttempt: coverageAttempt,
      report: safe,
      version: workflowJournalEventVersion
    })
  )
  const cancellation = coverageRecord(
    12,
    RunCancellationAppliedEvent.make({
      initiatedBy: { _tag: "Operator" },
      occurrenceClassification: "InitiatedAction",
      version: workflowJournalEventVersion
    })
  )
  const safeReport = executorReport(11, safe, 2)
  const relinquished = coverageRecord(
    13,
    CancelledAttemptImplementationResponsibilityRelinquishedEvent.make({
      authorizedClaim: coverageClaim,
      cancellationAppliedAt: cancellation.position,
      initiatedBy: { _tag: "DalphCoordinator" },
      occurrenceClassification: "InitiatedAction",
      plannedAttempt: coverageAttempt,
      proof: { _tag: "AcceptedReport", reportOrdinal: PlannedAttemptExecutorReportOrdinal.make(2) },
      version: workflowJournalEventVersion
    })
  )
  const foreignIntent = {
    ...coverageRecord(14, taskTrackerReadIntent(foreignClaimOperation)),
    key: intentRecordKey(foreignClaimOperation.operationId)
  }
  const foreignObservation = {
    ...coverageRecord(
      15,
      taskTrackerFactsObservedEvent(
        foreignClaimOperation.operationId,
        makeFocusedTaskClaimFactsObserved(foreignClaimOperation, foreignClaim)
      )
    ),
    key: outcomeRecordKey(foreignClaimOperation.operationId)
  }
  const reduced = reduceWorkflowJournalHistory(coverageRunId, [
    began,
    ...shiftedPlanRecords,
    beginIntent,
    beginResponse,
    executingReport,
    suspendIntent,
    suspendResponse,
    safeReport,
    cancellation,
    relinquished,
    foreignIntent,
    foreignObservation
  ])
  expect(reduced._tag).toBe("ValidWorkflowJournalHistory")
  if (reduced._tag !== "ValidWorkflowJournalHistory") return

  const facts = deriveJournalResponsibilityFacts(reduced.runState, Option.none(), Option.none(), coverageTarget)
  const executorFacts = facts.find(
    ({ responsibility }) => responsibility._tag === "PlannedAttemptExecutorWorkResponsibility"
  )
  expect(executorFacts).toMatchObject({ disposition: { _tag: "CancelledAttemptClaimObservationRequired" } })

  const projection = Effect.runSync(
    Effect.gen(function* () {
      const resources = yield* makeIntegrationTargetResourceController()
      const recovery = yield* makeRunRecoveryProjection(coverageRunId, undefined, resources).pipe(
        Effect.provideService(InRunJournal, currentProjectionJournal(coverageRunId, coverageTarget, reduced.runState))
      )
      return yield* recovery.readDeliveryProjection
    })
  )
  expect(projection.frontier.transitions.some(({ _tag }) => _tag === "ReleaseCancelledAttemptClaim")).toBe(false)

  const foreignNoRelease = coverageRecord(
    16,
    CancelledAttemptClaimNoReleaseObservedEvent.make({
      cancellationAppliedAt: cancellation.position,
      expectedClaim: coverageClaim,
      observation: foreignClaim,
      observationOperationId: foreignClaimOperation.operationId,
      occurrenceClassification: "NonActionOccurrence",
      plannedAttempt: coverageAttempt,
      version: workflowJournalEventVersion
    })
  )
  const reducedWithForeignNoRelease = reduceWorkflowJournalHistory(coverageRunId, [
    began,
    ...shiftedPlanRecords,
    beginIntent,
    beginResponse,
    executingReport,
    suspendIntent,
    suspendResponse,
    safeReport,
    cancellation,
    relinquished,
    foreignIntent,
    foreignObservation,
    foreignNoRelease
  ])
  expect(reducedWithForeignNoRelease._tag).toBe("InvalidWorkflowJournalHistory")
  if (reducedWithForeignNoRelease._tag === "InvalidWorkflowJournalHistory") {
    expect(reducedWithForeignNoRelease.issues).toEqual(
      expect.arrayContaining([expect.objectContaining({ detail: expect.stringContaining("no-release requires") })])
    )
  }
})

it("ignores same-target foreign-plan tracker facts and schedules an exact replacement", () => {
  type Family = "Graph" | "Specification" | "Claim"
  const ready = PlannedWorktreeReady.make({
    baseSha: coverageAttempt.baseSha,
    branch: coverageAttempt.branch,
    headSha: coverageAttempt.baseSha,
    worktree: coverageAttempt.worktree
  })
  const operationIdFor = (family: Family) =>
    OperationId.make(`recovery-activation-foreign-plan-${family.toLowerCase()}`)
  const exactOperationIdFor = (family: Family) =>
    family === "Graph"
      ? coverageGraphOperation.operationId
      : family === "Specification"
        ? coverageSpecificationOperation.operationId
        : coverageClaimOperation.operationId

  for (const family of ["Graph", "Specification", "Claim"] as const) {
    const foreignAttempt = PlannedTaskAttempt.make({
      ...coverageAttempt,
      attemptId: AttemptId.make(`recovery-activation-foreign-${family.toLowerCase()}-attempt`)
    })
    const foreignPlanOperation = makeTaskAttemptPlanOperation({
      operationId: OperationId.make(`recovery-activation-foreign-${family.toLowerCase()}-plan`),
      plannedAttempt: foreignAttempt,
      predecessorOperationIds: [coverageAcquisition.operationId]
    })
    const foreignRead =
      family === "Graph"
        ? (() => {
            const operation = makeTrackerGraphObservationOperation(
              { _tag: "AttemptContinuation" },
              operationIdFor(family),
              coverageTarget,
              [foreignPlanOperation.operationId],
              [coverageAttempt.taskId]
            )
            return {
              operation,
              outcome: taskTrackerFactsObservedEvent(
                operation.operationId,
                makeCompleteTaskTrackerFactsObserved(
                  operation,
                  validSnapshot({
                    revision: `recovery-activation-foreign-${family.toLowerCase()}-revision`,
                    tasks: [
                      {
                        id: coverageAttempt.taskId,
                        lifecycle: { _tag: "Open" },
                        parentTaskId: null,
                        prerequisiteIds: []
                      }
                    ]
                  })
                )
              )
            }
          })()
        : family === "Specification"
          ? (() => {
              const operation = makeTaskWorkSpecificationObservationOperation(
                operationIdFor(family),
                coverageTarget,
                coverageAttempt.taskId,
                [foreignPlanOperation.operationId]
              )
              return {
                operation,
                outcome: taskTrackerFactsObservedEvent(
                  operation.operationId,
                  makeFocusedTaskWorkSpecificationFactsObserved(operation, coverageSpecification)
                )
              }
            })()
          : (() => {
              const operation = makeTaskClaimObservationOperation(
                operationIdFor(family),
                coverageTarget,
                coverageAttempt.taskId,
                [foreignPlanOperation.operationId]
              )
              return {
                operation,
                outcome: taskTrackerFactsObservedEvent(
                  operation.operationId,
                  makeFocusedTaskClaimFactsObserved(operation, coverageClaim)
                )
              }
            })()
    const foreignOperation = foreignRead.operation
    const foreignOutcome = foreignRead.outcome
    const exactOperationId = exactOperationIdFor(family)
    const baseRecords = continuationRecords(coverageClaimEvent, ready).filter((record) => {
      if (record.event._tag === "TaskTrackerReadIntentRecorded") {
        return record.event.operation.operationId !== exactOperationId
      }
      if (record.event._tag === "TaskTrackerFactsObserved") return record.event.operationId !== exactOperationId
      return true
    })
    const foreignPlanRecord = coverageRecord(
      baseRecords.length + 1,
      TaskAttemptPlannedEvent.make({ operation: foreignPlanOperation, version: workflowJournalEventVersion })
    )
    const foreignIntentRecord = coverageRecord(baseRecords.length + 2, taskTrackerReadIntent(foreignOperation))
    const foreignOutcomeRecord = coverageRecord(baseRecords.length + 3, foreignOutcome)
    const records = [...baseRecords, foreignPlanRecord, foreignIntentRecord, foreignOutcomeRecord]
    const graphObservation = family === "Graph" ? foreignOutcome.observation : coverageGraphEvent.observation
    const reconstructed: ReconstructedRunState = {
      ...coverageRunState(records, [coverageResponsibilityAfterBeginning]),
      graphKnowledge: { taskTrackerFacts: [graphObservation] }
    }

    const result = Effect.runSync(
      Effect.gen(function* () {
        const resources = yield* makeIntegrationTargetResourceController()
        const recovery = yield* makeRunRecoveryProjection(coverageRunId, undefined, resources).pipe(
          Effect.provideService(InRunJournal, currentProjectionJournal(coverageRunId, coverageTarget, reconstructed))
        )
        return yield* recovery.readDeliveryProjection
      })
    )
    const expectedTag =
      family === "Graph"
        ? "ObservePlannedAttemptContinuationGraph"
        : family === "Specification"
          ? "ObservePlannedAttemptContinuationSpecification"
          : "ObservePlannedAttemptContinuationClaim"
    const replacement = result.frontier.transitions.find(({ _tag }) => _tag === expectedTag)
    expect(replacement?._tag, family).toBe(expectedTag)
    expect(
      result.frontier.transitions.some(({ _tag }) => _tag === "ResumePlannedAttemptExecutorWorkAfterCurrentFacts"),
      family
    ).toBe(false)
    if (replacement !== undefined && "operation" in replacement) {
      const operation = replacement.operation as {
        readonly operationId: OperationId
        readonly target: typeof coverageTarget
      }
      expect(operation.operationId, family).not.toBe(foreignOperation.operationId)
      expect(operation.target, family).toEqual(coverageTarget)
    }
  }
})

it("stops continuation after a foreign current claim, and preserves a transition for a non-ready worktree", () => {
  const foreignClaim = ActiveTaskClaim.make({
    ...coverageAcquisition,
    owner: ClaimOwner.make("another-owner"),
    token: ClaimToken.make("another-token")
  })
  const foreignClaimEvent = taskTrackerFactsObservedEvent(
    coverageClaimOperation.operationId,
    makeFocusedTaskClaimFactsObserved(coverageClaimOperation, foreignClaim)
  )
  const foreignDecision = continuationDecisionFor(
    coverageContinuationTransition,
    continuationRecords(foreignClaimEvent, UntrackedWorktreePath.make({ worktree: coverageAttempt.worktree })),
    { event: coverageGraphEvent, position: JournalPosition.make(8) },
    Option.none(),
    Option.none()
  )
  expect(foreignDecision).toEqual({})

  const worktreeDecision = continuationDecisionFor(
    coverageContinuationTransition,
    continuationRecords(coverageClaimEvent, UntrackedWorktreePath.make({ worktree: coverageAttempt.worktree })),
    { event: coverageGraphEvent, position: JournalPosition.make(8) },
    Option.none(),
    Option.none()
  )
  expect(worktreeDecision).toEqual({ transition: coverageContinuationTransition })
})

it("uses only tracker or timer active refresh to bypass Running and reread current claim authority", () => {
  const running = executorReport(10, {
    _tag: "ExecutorWorkExecuting",
    correlation: plannedAttemptExecutorCorrelation(coverageAttempt)
  })
  const unreadableClaimEvent = taskTrackerFactsObservedEvent(
    coverageClaimOperation.operationId,
    makeFocusedTaskClaimFactsUnreadable(coverageClaimOperation)
  )
  const records = continuationRecords(
    coverageClaimEvent,
    UntrackedWorktreePath.make({ worktree: coverageAttempt.worktree })
  ).map((record) => (record.position === 7 ? coverageRecord(7, unreadableClaimEvent) : record))
  const runningRecords = [...records, running]

  const ordinary = continuationDecisionFor(
    coverageContinuationTransition,
    runningRecords,
    { event: coverageGraphEvent, position: JournalPosition.make(5) },
    Option.none(),
    Option.none(),
    RunActivationOpportunity.OrdinaryRunEntry()
  )
  const refresh = continuationDecisionFor(
    coverageContinuationTransition,
    runningRecords,
    { event: coverageGraphEvent, position: JournalPosition.make(5) },
    Option.none(),
    Option.none(),
    activeWorkAuthorityRefreshForOwner(
      "TrackerNotification",
      activeWorkAuthorityRefreshSubjectsFor([{ runId: coverageRunId, attemptId: coverageAttempt.attemptId }])
    )
  )

  expect(ordinary).toEqual({ transition: coverageContinuationTransition })
  expect(refresh).toEqual({})
})

it("removes only the exact post-baseline unreadable suspension during an active refresh", () => {
  const suspend = RunnableFrontierTransition.SuspendPlannedAttemptExecutorWork({ plannedAttempt: coverageAttempt })
  const unreadable = coverageRecord(
    21,
    taskTrackerFactsObservedEvent(
      coverageClaimOperation.operationId,
      makeFocusedTaskClaimFactsUnreadable(coverageClaimOperation)
    )
  )
  const running = executorReport(16, {
    _tag: "ExecutorWorkExecuting",
    correlation: plannedAttemptExecutorCorrelation(coverageAttempt)
  })
  const safelySuspended = executorReport(20, {
    _tag: "ExecutorWorkSafelySuspended",
    correlation: plannedAttemptExecutorCorrelation(coverageAttempt)
  })
  const frontier = { explanations: [], transitions: [suspend] }
  const baseline = Option.some(JournalPosition.make(15))

  expect(
    frontierForActivationOpportunity(
      frontier,
      [running, unreadable],
      baseline,
      activeWorkAuthorityRefreshForOwner(
        "Timer",
        activeWorkAuthorityRefreshSubjectsFor([{ runId: coverageRunId, attemptId: coverageAttempt.attemptId }])
      )
    ).transitions
  ).toEqual([])
  expect(
    frontierForActivationOpportunity(
      frontier,
      [running, unreadable],
      baseline,
      RunActivationOpportunity.OrdinaryRunEntry()
    ).transitions
  ).toEqual([suspend])
  expect(
    frontierForActivationOpportunity(
      frontier,
      [running, { ...unreadable, position: JournalPosition.make(15) }],
      baseline,
      activeWorkAuthorityRefreshForOwner(
        "Timer",
        activeWorkAuthorityRefreshSubjectsFor([{ runId: coverageRunId, attemptId: coverageAttempt.attemptId }])
      )
    ).transitions
  ).toEqual([suspend])
  expect(
    frontierForActivationOpportunity(
      frontier,
      [running, safelySuspended, unreadable],
      baseline,
      activeWorkAuthorityRefreshForOwner(
        "Timer",
        activeWorkAuthorityRefreshSubjectsFor([{ runId: coverageRunId, attemptId: coverageAttempt.attemptId }])
      )
    ).transitions
  ).toEqual([suspend])
})

it("keeps an independent continuation transition after the active subject reaches G2", () => {
  const independentAttempt = PlannedTaskAttempt.make({
    ...coverageAttempt,
    attemptId: AttemptId.make("recovery-activation-independent-attempt"),
    taskId: TaskId.make("recovery-activation-independent-task")
  })
  const independentOperation = makeTrackerGraphObservationOperation(
    { _tag: "WorkflowEstablishment" },
    OperationId.make("recovery-activation-independent-graph"),
    coverageTarget,
    [],
    [independentAttempt.taskId]
  )
  const active = RunnableFrontierTransition.ObservePlannedAttemptContinuationGraph({
    operation: coverageGraphOperation,
    plannedAttempt: coverageAttempt
  })
  const independent = RunnableFrontierTransition.ObservePlannedAttemptContinuationGraph({
    operation: independentOperation,
    plannedAttempt: independentAttempt
  })
  const filtered = frontierForActivationOpportunity(
    { explanations: [], transitions: [active, independent] },
    [],
    Option.some(JournalPosition.make(15)),
    activeWorkAuthorityRefreshForOwner(
      "Timer",
      activeWorkAuthorityRefreshSubjectsFor([{ runId: coverageRunId, attemptId: coverageAttempt.attemptId }])
    ),
    {
      _tag: "ActiveRefreshRuntimeBoundary",
      runId: coverageRunId,
      reconciledAttempts: [{ runId: coverageRunId, attemptId: coverageAttempt.attemptId }]
    }
  )

  expect(filtered.transitions).toEqual([independent])
})

it("suppresses every transition shape that still names the captured active attempt after G2", () => {
  const responsibility = pausedIntegrationScenario("post-g2-transition-shapes", 8).responsibility
  const transitions = [
    RunnableFrontierTransition.ObserveAttemptStoppageExecutor({
      requestId: AttemptChoiceRequestId.make({ nonce: "post-g2-stop", runId: coverageRunId }),
      subject: { observedTaskRevision: TaskRevision.make("post-g2-observed-revision"), plannedAttempt: coverageAttempt }
    }),
    RunnableFrontierTransition.ReleaseStartedIntegrationTarget({ responsibility }),
    RunnableFrontierTransition.ReconcileTaskClaim({
      operationId: OperationId.make("post-g2-reconcile-claim"),
      taskId: coverageAttempt.taskId
    })
  ]
  const boundary = {
    _tag: "ActiveRefreshRuntimeBoundary" as const,
    runId: coverageRunId,
    reconciledAttempts: [{ runId: coverageRunId, attemptId: coverageAttempt.attemptId }]
  }
  const filtered = frontierForActivationOpportunity(
    { explanations: [], transitions },
    coveragePlanRecords(),
    Option.some(JournalPosition.make(5)),
    activeWorkAuthorityRefreshForOwner(
      "Timer",
      activeWorkAuthorityRefreshSubjectsFor([{ runId: coverageRunId, attemptId: coverageAttempt.attemptId }])
    ),
    boundary
  )

  expect(filtered.transitions).toEqual([])
})

it("authorizes no executor command after a healthy refresh of Running work", () => {
  const ready = PlannedWorktreeReady.make({
    baseSha: coverageAttempt.baseSha,
    branch: coverageAttempt.branch,
    headSha: coverageAttempt.baseSha,
    worktree: coverageAttempt.worktree
  })
  const records = continuationRecords(coverageClaimEvent, ready).map((record) =>
    record.position >= 5 ? { ...record, position: JournalPosition.make(record.position + 10) } : record
  )
  const runningRecords = [
    ...records,
    executorReport(5, {
      _tag: "ExecutorWorkExecuting",
      correlation: plannedAttemptExecutorCorrelation(coverageAttempt)
    })
  ]
  const currentGraph = { event: coverageGraphEvent, position: JournalPosition.make(15) }

  const ordinary = continuationDecisionFor(
    coverageContinuationTransition,
    runningRecords,
    currentGraph,
    Option.none(),
    Option.none(),
    RunActivationOpportunity.OrdinaryRunEntry()
  )
  const refresh = continuationDecisionFor(
    coverageContinuationTransition,
    runningRecords,
    currentGraph,
    Option.none(),
    Option.none(),
    activeWorkAuthorityRefreshForOwner(
      "Timer",
      activeWorkAuthorityRefreshSubjectsFor([{ runId: coverageRunId, attemptId: coverageAttempt.attemptId }])
    )
  )

  expect(ordinary.transition?._tag).toBe("ObservePlannedAttemptExecutorWork")
  expect(refresh).toMatchObject({
    explanation: { _tag: "IntegrationConfigurationWait", wakeCondition: "IntegrationTargetConfigured" }
  })
  expect(refresh.transition).toBeUndefined()
})

it("replays G1 only when its exact run target subjects predecessors and missing outcome still agree", () => {
  const activeG1 = makeTrackerGraphObservationOperation(
    { _tag: "ExecutingWorkAuthorityCheck" },
    OperationId.make(`active-refresh:${coverageRunId}:after:18:graph-exact-replay`),
    coverageTarget,
    [coveragePlanOperation.operationId],
    [coverageAttempt.taskId]
  )
  const intent = coverageRecord(10, taskTrackerReadIntent(activeG1))
  const otherTarget = FixtureTarget.make("recovery-activation-other-target")
  const wrongTarget = makeTrackerGraphObservationOperation(
    { _tag: "ExecutingWorkAuthorityCheck" },
    activeG1.operationId,
    otherTarget,
    activeG1.predecessorOperationIds,
    activeG1.readShape.explicitlyCoveredTaskIds
  )
  const wrongSubjects = makeTrackerGraphObservationOperation(
    { _tag: "ExecutingWorkAuthorityCheck" },
    activeG1.operationId,
    coverageTarget,
    activeG1.predecessorOperationIds,
    [TaskId.make("recovery-activation-other-task")]
  )
  const wrongPredecessors = makeTrackerGraphObservationOperation(
    { _tag: "ExecutingWorkAuthorityCheck" },
    activeG1.operationId,
    coverageTarget,
    [OperationId.make("recovery-activation-other-plan")],
    activeG1.readShape.explicitlyCoveredTaskIds
  )
  const wrongCause = makeTrackerGraphObservationOperation(
    { _tag: "AttemptContinuation" },
    activeG1.operationId,
    coverageTarget,
    activeG1.predecessorOperationIds,
    activeG1.readShape.explicitlyCoveredTaskIds
  )
  const observed = coverageRecord(11, { ...coverageGraphEvent, operationId: activeG1.operationId })

  expect(
    pendingActiveRefreshGraphReadFor([...coveragePlanRecords(), intent], coverageRunId, coverageTarget, [
      coverageAttempt
    ])
  ).toEqual(activeG1)
  for (const records of [
    [...coveragePlanRecords(), coverageRecord(10, taskTrackerReadIntent(wrongTarget))],
    [...coveragePlanRecords(), coverageRecord(10, taskTrackerReadIntent(wrongSubjects))],
    [...coveragePlanRecords(), coverageRecord(10, taskTrackerReadIntent(wrongPredecessors))],
    [...coveragePlanRecords(), coverageRecord(10, taskTrackerReadIntent(wrongCause))],
    [...coveragePlanRecords(), intent, observed]
  ]) {
    expect(pendingActiveRefreshGraphReadFor(records, coverageRunId, coverageTarget, [coverageAttempt])).toBeUndefined()
  }
})

it("accepts only continuation and executing-authority graph causes as exact continuation evidence", () => {
  const records = coveragePlanRecords()
  const graphFor = (cause: typeof TrackerGraphReadCause.Type) => {
    const causalGraphOperationId =
      cause._tag === "PostQuiescenceReconfirmation" ? cause.quiescentGraphOperationId : undefined
    return makeTrackerGraphObservationOperation(
      cause,
      OperationId.make(`continuation-cause-${cause._tag}`),
      coverageTarget,
      [coveragePlanOperation.operationId, ...(causalGraphOperationId === undefined ? [] : [causalGraphOperationId])],
      [coverageAttempt.taskId]
    )
  }

  for (const cause of [{ _tag: "AttemptContinuation" }, { _tag: "ExecutingWorkAuthorityCheck" }] as const) {
    expect(continuationTrackerReadHasExactPlanPredecessor(records, graphFor(cause), coverageAttempt)).toBe(true)
  }
  for (const cause of [
    { _tag: "WorkflowEstablishment" },
    { _tag: "AttemptRestartAuthorityCheck" },
    {
      _tag: "PostQuiescenceReconfirmation",
      quiescentGraphOperationId: OperationId.make("foreign-post-quiescence-graph")
    },
    { _tag: "TaskControlMembershipCheck" }
  ] as const) {
    expect(continuationTrackerReadHasExactPlanPredecessor(records, graphFor(cause), coverageAttempt)).toBe(false)
  }
})

it("reuses the exact ordinary intent-only G2 after a crash", () => {
  const ordinaryG2 = makeTrackerGraphObservationOperation(
    { _tag: "PostQuiescenceReconfirmation", quiescentGraphOperationId: coverageGraphOperation.operationId },
    OperationId.make("ordinary-pending-g2"),
    coverageTarget,
    [coverageGraphOperation.operationId]
  )
  const records = [coverageRecord(20, taskTrackerReadIntent(ordinaryG2))]
  const currentGraph = { operationId: coverageGraphOperation.operationId, recordedAt: JournalPosition.make(6) }

  expect(pendingActiveRefreshG2OperationFor(records, coverageRunId, coverageTarget, currentGraph)).toEqual(ordinaryG2)
})

it("replays G2 only for the exact later empty-coverage read with the complete predecessor graph", () => {
  const earlierGraph = makeTrackerGraphObservationOperation(
    { _tag: "WorkflowEstablishment" },
    OperationId.make("active-g2-earlier-graph"),
    coverageTarget,
    [],
    [coverageAttempt.taskId]
  )
  const currentGraph = { operationId: coverageGraphOperation.operationId, recordedAt: JournalPosition.make(20) }
  const expectedPredecessors = [earlierGraph.operationId, currentGraph.operationId]
  const activeG2 = makeTrackerGraphObservationOperation(
    { _tag: "PostQuiescenceReconfirmation", quiescentGraphOperationId: currentGraph.operationId },
    OperationId.make("active-g2-exact-replay"),
    coverageTarget,
    expectedPredecessors
  )
  const prefix = [
    coverageRecord(10, taskTrackerReadIntent(earlierGraph)),
    coverageRecord(21, taskTrackerReadIntent(activeG2))
  ]
  expect(pendingActiveRefreshG2OperationFor(prefix, coverageRunId, coverageTarget, currentGraph)).toEqual(activeG2)

  const variants = [
    coverageRecord(21, taskTrackerReadIntent(activeG2), RunId.make("active-g2-foreign-run")),
    coverageRecord(20, taskTrackerReadIntent(activeG2)),
    coverageRecord(
      21,
      taskTrackerReadIntent(
        makeTrackerGraphObservationOperation(
          { _tag: "WorkflowEstablishment" },
          activeG2.operationId,
          FixtureTarget.make("active-g2-foreign-target"),
          expectedPredecessors
        )
      )
    ),
    coverageRecord(
      21,
      taskTrackerReadIntent(
        makeTrackerGraphObservationOperation(
          { _tag: "WorkflowEstablishment" },
          activeG2.operationId,
          coverageTarget,
          expectedPredecessors,
          [coverageAttempt.taskId]
        )
      )
    ),
    coverageRecord(
      21,
      taskTrackerReadIntent(
        makeTrackerGraphObservationOperation({ _tag: "WorkflowEstablishment" }, activeG2.operationId, coverageTarget, [
          currentGraph.operationId
        ])
      )
    )
  ]
  for (const candidate of variants) {
    expect(
      pendingActiveRefreshG2OperationFor(
        [coverageRecord(10, taskTrackerReadIntent(earlierGraph)), candidate],
        coverageRunId,
        coverageTarget,
        currentGraph
      )
    ).toBeUndefined()
  }
  expect(
    pendingActiveRefreshG2OperationFor(
      [...prefix, coverageRecord(22, { ...coverageGraphEvent, operationId: activeG2.operationId })],
      coverageRunId,
      coverageTarget,
      currentGraph
    )
  ).toBeUndefined()
})

it("requires each active refresh to reread authorities after its own activation baseline", () => {
  const ready = PlannedWorktreeReady.make({
    baseSha: coverageAttempt.baseSha,
    branch: coverageAttempt.branch,
    headSha: coverageAttempt.baseSha,
    worktree: coverageAttempt.worktree
  })
  const firstRefreshFacts = continuationRecords(coverageClaimEvent, ready)
    .filter(
      ({ event }) =>
        event._tag === "TaskTrackerReadIntentRecorded" ||
        event._tag === "TaskTrackerFactsObserved" ||
        event._tag === "GitReadIntentRecorded" ||
        event._tag === "PlannedAttemptWorktreeObserved"
    )
    .map((record) => ({ ...record, position: JournalPosition.make(record.position + 6) }))
  const records = [
    makeWorkflowRunBeganRecord(coverageRunId, coverageTarget, coveragePolicy),
    ...coveragePlanRecords(),
    executorReport(10, {
      _tag: "ExecutorWorkExecuting",
      correlation: plannedAttemptExecutorCorrelation(coverageAttempt)
    }),
    ...firstRefreshFacts
  ]
  const firstRefresh = continuationDecisionFor(
    coverageContinuationTransition,
    records,
    { event: coverageGraphEvent, position: JournalPosition.make(14) },
    Option.some(JournalPosition.make(10)),
    Option.none(),
    activeWorkAuthorityRefreshForOwner(
      "TrackerNotification",
      activeWorkAuthorityRefreshSubjectsFor([{ runId: coverageRunId, attemptId: coverageAttempt.attemptId }])
    )
  )
  expect(firstRefresh.transition).toBeUndefined()

  // The next opportunity starts after the first refresh's worktree outcome.
  // Its missing post-baseline graph cannot reuse the prior complete authority
  // chain, so it must begin a new graph read before any executor action.
  const secondRefresh = continuationDecisionFor(
    coverageContinuationTransition,
    records,
    undefined,
    Option.some(JournalPosition.make(20)),
    Option.none(),
    activeWorkAuthorityRefreshForOwner(
      "Timer",
      activeWorkAuthorityRefreshSubjectsFor([{ runId: coverageRunId, attemptId: coverageAttempt.attemptId }])
    )
  )
  expect(secondRefresh.transition).toMatchObject({
    _tag: "ObservePlannedAttemptContinuationGraph",
    operation: { operationId: OperationId.make(`continuation:${coverageAttempt.attemptId}:after:20:graph`) },
    plannedAttempt: coverageAttempt
  })
})

it("waits for integration configuration after an applied Continue choice has current ready facts", () => {
  const ready = PlannedWorktreeReady.make({
    baseSha: coverageAttempt.baseSha,
    branch: coverageAttempt.branch,
    headSha: coverageAttempt.baseSha,
    worktree: coverageAttempt.worktree
  })
  const decision = continuationDecisionFor(
    coverageContinuationTransition,
    continuationRecords(coverageClaimEvent, ready, true),
    { event: coverageGraphEvent, position: JournalPosition.make(8) },
    Option.none(),
    Option.none()
  )

  expect(decision).toEqual({
    explanation: {
      _tag: "IntegrationConfigurationWait",
      plannedAttempt: coverageAttempt,
      wakeCondition: "IntegrationTargetConfigured"
    }
  })
})

effectIt.effect("projects a continuation configuration explanation into the public frontier", () =>
  Effect.gen(function* () {
    const ready = PlannedWorktreeReady.make({
      baseSha: coverageAttempt.baseSha,
      branch: coverageAttempt.branch,
      headSha: coverageAttempt.baseSha,
      worktree: coverageAttempt.worktree
    })
    const records = continuationRecords(coverageClaimEvent, ready)
    const reconstructed: ReconstructedRunState = {
      ...coverageRunState(records, [coverageResponsibilityAfterBeginning]),
      graphKnowledge: { taskTrackerFacts: [coverageGraphEvent.observation] }
    }
    const resources = yield* makeIntegrationTargetResourceController()
    const recovery = yield* makeRunRecoveryProjection(coverageRunId, undefined, resources).pipe(
      Effect.provideService(InRunJournal, currentProjectionJournal(coverageRunId, coverageTarget, reconstructed))
    )
    const projection = yield* recovery.readDeliveryProjection
    expect(projection.frontier.explanations).toContainEqual(
      FrontierExplanation.IntegrationConfigurationWait({
        plannedAttempt: coverageAttempt,
        wakeCondition: "IntegrationTargetConfigured"
      })
    )
  })
)

it("reconciles each exact pre-Pause integration intent but filters a post-Pause request", () => {
  const beforePause = pausedIntegrationScenario("before", 8)
  const afterPause = pausedIntegrationScenario("after", 12)
  const runPausedWithTaskPause = coverageRunState(
    [
      coverageRecord(1, beforePause.intents[0]),
      coverageRecord(10, runPause(1)),
      coverageRecord(
        11,
        ControlDirectionAppliedEvent.make({
          direction: "Pause",
          initiatedBy: { _tag: "Operator" },
          occurrenceClassification: "InitiatedAction",
          ordinal: ControlDirectionApplicationOrdinal.make(2),
          subject: { _tag: "Task", runId: coverageRunId, taskId: coverageAttempt.taskId },
          version: workflowJournalEventVersion
        })
      ),
      coverageRecord(12, afterPause.intents[0])
    ],
    [],
    coverageRunId
  )
  const pausedState: ReconstructedRunState = {
    ...runPausedWithTaskPause,
    pause: { run: { _tag: "RunPaused" }, tasks: { _tag: "TaskPauses", taskIds: [coverageAttempt.taskId] } }
  }

  for (const index of [0]) {
    const beforeTransition = Option.getOrThrow(Option.fromUndefinedOr(beforePause.transitions[index]))
    const afterTransition = Option.getOrThrow(Option.fromUndefinedOr(afterPause.transitions[index]))
    const frontier = filterFrontierForActivePauses(
      { explanations: [], transitions: [beforeTransition, afterTransition] },
      pausedState,
      undefined,
      new Set(),
      new Set()
    )
    expect(frontier.transitions).toEqual([beforeTransition])
  }
})

it("reconciles an integration intent admitted before cancellation but filters a later one", () => {
  const beforeCancellation = pausedIntegrationScenario("cancel-before", 8)
  const afterCancellation = pausedIntegrationScenario("cancel-after", 12)
  const cancellationPosition = JournalPosition.make(10)
  const cancelledState: ReconstructedRunState = {
    ...coverageRunState(
      [
        coverageRecord(1, beforeCancellation.intents[0]),
        coverageRecord(
          Number(cancellationPosition),
          RunCancellationAppliedEvent.make({
            initiatedBy: { _tag: "Operator" },
            occurrenceClassification: "InitiatedAction",
            version: workflowJournalEventVersion
          })
        ),
        coverageRecord(12, afterCancellation.intents[0])
      ],
      [],
      coverageRunId
    ),
    cancellation: { _tag: "RunCancellationApplied", appliedAt: cancellationPosition }
  }
  const beforeTransition = Option.getOrThrow(Option.fromUndefinedOr(beforeCancellation.transitions[0]))
  const afterTransition = Option.getOrThrow(Option.fromUndefinedOr(afterCancellation.transitions[0]))
  const frontier = filterFrontierForActivePauses(
    { explanations: [], transitions: [beforeTransition, afterTransition] },
    cancelledState,
    undefined,
    new Set(),
    new Set()
  )
  expect(frontier.transitions).toEqual([beforeTransition])
})

it("keeps paused-task boundaries fail-closed while admitting only safe reconciliation work", () => {
  const taskPause = coverageRecord(
    5,
    ControlDirectionAppliedEvent.make({
      direction: "Pause",
      initiatedBy: { _tag: "Operator" },
      occurrenceClassification: "InitiatedAction",
      ordinal: ControlDirectionApplicationOrdinal.make(1),
      subject: { _tag: "Task", runId: coverageRunId, taskId: coverageAttempt.taskId },
      version: workflowJournalEventVersion
    })
  )
  const taskPausedState: ReconstructedRunState = {
    ...coverageRunState([taskPause]),
    pause: { run: { _tag: "RunUnpaused" }, tasks: { _tag: "TaskPauses", taskIds: [coverageAttempt.taskId] } }
  }
  const claimCheck = RunnableFrontierTransition.CheckTaskClaim({
    operationId: OperationId.make("recovery-activation-paused-task-claim-check"),
    taskId: coverageAttempt.taskId
  })
  const worktreeOperation = makeTaskWorktreeObservationOperation({
    operationId: OperationId.make("recovery-activation-paused-task-worktree"),
    plannedAttempt: coverageAttempt,
    predecessorOperationIds: []
  })
  const pendingWorktree = RunnableFrontierTransition.ObservePlannedAttemptContinuationWorktree({
    operation: worktreeOperation,
    plannedAttempt: coverageAttempt
  })
  expect(
    filterFrontierForActivePauses(
      { explanations: [], transitions: [claimCheck, pendingWorktree] },
      taskPausedState,
      undefined,
      new Set([pendingWorktree]),
      new Set()
    ).transitions
  ).toEqual([claimCheck, pendingWorktree])

  const heldIntegration = pausedIntegrationScenario("held-during-task-pause", 3)
  expect(
    filterFrontierForActivePauses(
      { explanations: [], transitions: [heldIntegration.transitions[0]] },
      taskPausedState,
      undefined,
      new Set(),
      new Set([coverageAttempt.taskId])
    ).transitions
  ).toEqual([heldIntegration.transitions[0]])

  const heldLineage = RunnableFrontierTransition.ObservePlannedAttemptContinuationTargetLineage({
    operation: makeTargetLineageObservationOperation({
      integrationTarget: heldIntegration.responsibility.integrationTarget,
      operationId: OperationId.make("recovery-activation-paused-held-lineage"),
      plannedAttempt: coverageAttempt,
      predecessorOperationIds: []
    }),
    plannedAttempt: coverageAttempt
  })
  expect(
    filterFrontierForActivePauses(
      { explanations: [], transitions: [heldLineage] },
      taskPausedState,
      undefined,
      new Set(),
      new Set([coverageAttempt.taskId])
    ).transitions
  ).toEqual([heldLineage])

  const prePauseIntegration = pausedIntegrationScenario("admitted-before-task-pause", 3)
  const prePauseState: ReconstructedRunState = {
    ...coverageRunState([coverageRecord(1, prePauseIntegration.intents[0]), taskPause]),
    pause: { run: { _tag: "RunUnpaused" }, tasks: { _tag: "TaskPauses", taskIds: [coverageAttempt.taskId] } }
  }
  expect(
    filterFrontierForActivePauses(
      { explanations: [], transitions: [prePauseIntegration.transitions[0]] },
      prePauseState,
      undefined,
      new Set(),
      new Set()
    ).transitions
  ).toEqual([prePauseIntegration.transitions[0]])
})

it("uses the later of Pause and cancellation as the integration reconciliation boundary", () => {
  const integration = pausedIntegrationScenario("pause-cancel-boundary", 8)
  const after = pausedIntegrationScenario("pause-cancel-after", 12)
  const beforeTransition = Option.getOrThrow(Option.fromUndefinedOr(integration.transitions[0]))
  const afterTransition = Option.getOrThrow(Option.fromUndefinedOr(after.transitions[0]))
  for (const [pauseAt, cancellationAt] of [
    [5, 10],
    [10, 5]
  ] as const) {
    const state: ReconstructedRunState = {
      ...coverageRunState([
        coverageRecord(1, integration.intents[0]),
        coverageRecord(pauseAt, runPause(1)),
        coverageRecord(
          cancellationAt,
          RunCancellationAppliedEvent.make({
            initiatedBy: { _tag: "Operator" },
            occurrenceClassification: "InitiatedAction",
            version: workflowJournalEventVersion
          })
        ),
        coverageRecord(12, after.intents[0])
      ]),
      cancellation: { _tag: "RunCancellationApplied", appliedAt: JournalPosition.make(cancellationAt) },
      pause: { run: { _tag: "RunPaused" }, tasks: { _tag: "NoTaskPauses" } }
    }
    expect(
      filterFrontierForActivePauses(
        { explanations: [], transitions: [beforeTransition, afterTransition] },
        state,
        undefined,
        new Set(),
        new Set()
      ).transitions
    ).toEqual([beforeTransition])
  }
})

it("reacquires an integration responsibility that started before cancellation", () => {
  const integration = pausedIntegrationScenario("cancel-reacquire", 8)
  const cancellationPosition = JournalPosition.make(10)
  const started = IntegrationStartedEvent.make({
    acceptedResult: integration.responsibility.acceptedResult,
    integrationTarget: integration.responsibility.integrationTarget,
    plannedAttempt: integration.responsibility.plannedAttempt,
    responsibilityBeganAt: integration.responsibility.queuedAt,
    version: workflowJournalEventVersion
  })
  const cancelledState: ReconstructedRunState = {
    ...coverageRunState(
      [
        coverageRecord(
          Number(integration.responsibility.queuedAt),
          IntegrationResponsibilityBeganEvent.make({
            acceptedResult: integration.responsibility.acceptedResult,
            integrationTarget: integration.responsibility.integrationTarget,
            plannedAttempt: integration.responsibility.plannedAttempt,
            version: workflowJournalEventVersion
          })
        ),
        coverageRecord(Number(integration.responsibility.startedAt), started),
        coverageRecord(
          Number(cancellationPosition),
          RunCancellationAppliedEvent.make({
            initiatedBy: { _tag: "Operator" },
            occurrenceClassification: "InitiatedAction",
            version: workflowJournalEventVersion
          })
        )
      ],
      [],
      coverageRunId
    ),
    cancellation: { _tag: "RunCancellationApplied", appliedAt: cancellationPosition }
  }
  const transition = RunnableFrontierTransition.AcquireStartedIntegrationTarget({
    responsibility: integration.responsibility
  })
  expect(
    filterFrontierForActivePauses(
      { explanations: [], transitions: [transition] },
      cancelledState,
      undefined,
      new Set(),
      new Set()
    ).transitions
  ).toEqual([transition])
})

it("hands a pre-cancellation integration responsibility to integration settlement without a duplicate claim release", () => {
  const integration = pausedIntegrationScenario("cancel-handoff", 5)
  const integrationBegan = coverageRecord(
    5,
    IntegrationResponsibilityBeganEvent.make({
      acceptedResult: integration.responsibility.acceptedResult,
      integrationTarget: integration.responsibility.integrationTarget,
      plannedAttempt: coverageAttempt,
      version: workflowJournalEventVersion
    })
  )
  const cancellation = coverageRecord(
    6,
    RunCancellationAppliedEvent.make({
      initiatedBy: { _tag: "Operator" },
      occurrenceClassification: "InitiatedAction",
      version: workflowJournalEventVersion
    })
  )
  const safelySuspended = executorReport(
    7,
    PlannedAttemptExecutorReport.cases.ExecutorWorkSafelySuspended.make({
      correlation: plannedAttemptExecutorCorrelation(coverageAttempt)
    })
  )
  const state = coverageRunState(
    [...coveragePlanRecords(), integrationBegan, cancellation, safelySuspended],
    [coverageResponsibility]
  )
  const [facts] = deriveJournalResponsibilityFacts(state)
  expect(facts).toMatchObject({ disposition: { _tag: "Ready" } })
  if (facts?._tag !== "PlannedAttemptExecutorFreshFacts") return
  const frontier = deriveRunnableFrontier({
    freshEligibleTasks: [],
    responsibility: { entries: [coverageResponsibility] },
    responsibilityFacts: [facts]
  })
  expect(
    frontier.transitions.some(
      ({ _tag }) =>
        _tag === "RelinquishCancelledAttemptImplementation" ||
        _tag === "ReleaseCancelledAttemptClaim" ||
        _tag === "RecordCancelledAttemptClaimNoRelease"
    )
  ).toBe(false)
})

effectIt.effect("uses the current reconstructed state for configured projection and rejects a mismatched run", () =>
  Effect.gen(function* () {
    const matchingState = coverageRunState([])
    const configuredJournal = currentProjectionJournal(coverageRunId, coverageTarget, matchingState)
    const integrationTarget = IntegrationTarget.make({
      ref: IntegrationTargetRef.make("refs/heads/main"),
      repository: GitRepositoryLocator.make("/repositories/recovery-activation-coverage.git")
    })
    const configuredRecovery = yield* makeRunRecoveryProjection(coverageRunId, integrationTarget).pipe(
      Effect.provideService(InRunJournal, configuredJournal)
    )
    const configuredProjection = yield* configuredRecovery.readDeliveryProjection
    if (configuredProjection.evidence._tag !== "AvailableDeliveryProjectionEvidence") {
      return expect.fail("expected configured delivery projection evidence")
    }
    expect(configuredProjection.evidence.facts).toEqual([])

    const otherRunId = RunId.make("recovery-activation-other-run")
    const mismatchedJournal = currentProjectionJournal(
      coverageRunId,
      coverageTarget,
      coverageRunState([], [], otherRunId)
    )
    const mismatchedRecovery = yield* makeRunRecoveryProjection(coverageRunId).pipe(
      Effect.provideService(InRunJournal, mismatchedJournal)
    )
    const failure = yield* mismatchedRecovery.readDeliveryProjection.pipe(Effect.flip)
    expect(failure).toMatchObject({
      _tag: "RunRecoveryProjectionRunMismatch",
      expectedRunId: coverageRunId,
      receivedRunId: otherRunId
    })
  })
)
