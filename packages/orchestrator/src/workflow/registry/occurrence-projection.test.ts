import { taskTrackerGraphFactsObserved } from "../../../test/task-tracker-facts.js"
import { acceptedResultFixture } from "../../../test/support/evidence.js"
import { completedRunFinalityFixture } from "../../../test/run-finality.js"
import { it } from "@effect/vitest"
import {
  plannedAttemptExecutorCorrelation,
  PlannedAttemptExecutorReport,
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
  WorktreeLocator,
  makeTaskWorkSpecification
} from "@dalph/contracts"
import { controlledFakePlannedAttemptExecutorLayer } from "../../../test/controlled-planned-attempt-executor.js"
import { TrackerRevision } from "../../authorities/task-tracker/task.js"
import { FixtureTarget } from "../../authorities/task-tracker/fixture/target.js"
import { JournalPosition, JournalRecordKey } from "../../workflow-journal/identity.js"
import { OperationId } from "../identity.js"
import { TaskWorkCapacity } from "../../coordination/admission/capacity.js"
import {
  InitialControlPolicy,
  initialRunPolicyRevision,
  RunControlPolicy,
  RunPolicyRevision
} from "../../control/policy.js"
import { TaskWorkCapacityControl } from "../../control/task-work-capacity.js"
import { InRunJournal, type JournalRecord, JournalStore, RunLifecycleJournal } from "../../workflow-journal/store.js"
import { journaledWorkflowInterpreterLayer } from "../../workflow-journal/journaled-interpreter.js"
import {
  GitReadIntentRecordedEvent,
  PlannedAttemptWorktreeObservedEvent,
  TaskAttemptPlannedEvent,
  TaskClaimAcquiredEvent,
  TaskClaimAcquisitionIntendedEvent,
  TaskClaimReleasedEvent,
  TaskClaimReleaseIntendedEvent,
  TaskWorkCapacityChangedEvent,
  TaskWorktreeReadyEvent,
  TaskWorktreeReconciliationIntendedEvent,
  TargetLineageObservedEvent,
  taskTrackerReadIntent,
  WorkflowJournalEvent,
  WorkflowRunBeganEvent,
  WorkflowRunTerminatedEvent
} from "./event.js"
import { workflowJournalEventVersion } from "../kernel/event.js"
import {
  intentRecordKey,
  outcomeRecordKey,
  plannedAttemptExecutorWorkReportedRecordKey,
  plannedAttemptExecutorWorkResponsibilityBeganRecordKey,
  workflowRunBeganRecordKey,
  workflowRunTerminatedRecordKey,
  controlDirectionAppliedRecordKey,
  attemptChoiceAppliedRecordKey,
  taskClaimReacquisitionDirectedRecordKey
} from "../../workflow-journal/record-key.js"
import {
  PlannedAttemptExecutorReportOrdinal,
  PlannedAttemptExecutorWorkReportedEvent,
  PlannedAttemptExecutorWorkResponsibilityBeganEvent
} from "../protocols/planned-attempt-executor-work/events.js"
import { makeRunRecoveryProjection, RunRecoveryProjection } from "../../coordination/run/recovery-activation.js"
import { projectTrackerSnapshot } from "../../authorities/task-tracker/graph.js"
import { TaskClaimAcquisitionPlanner } from "../protocols/task-claim-acquisition/plan.js"
import {
  makeFocusedTaskWorkSpecificationFactsObserved,
  taskTrackerFactsObservedEvent
} from "../task-tracker-facts/observation.js"
import { OperationIdAllocator, PlannedTaskAttemptPlanner } from "../protocols/task-attempt-planning/plan.js"
import {
  makeTargetLineageObservationOperation,
  makeTaskAttemptPlanOperation,
  makeTaskClaimAcquisitionOperation,
  makeTaskClaimObservationOperation,
  makeTaskClaimReleaseOperation,
  makeTaskWorkSpecificationObservationOperation,
  makeTaskWorktreeReconciliationOperation,
  makeTaskWorktreeObservationOperation,
  makeTrackerGraphObservationOperation,
  TaskClaimReleaseAuthority
} from "./operation.js"
import { AttemptWorktreeLost } from "../protocols/planned-attempt-worktree-observation/protocol.js"
import { WorkflowInterpreter, WorkflowTrace } from "../interpretation/interpreter.js"
import {
  AppliedControlDirection,
  decodeWorkflowOccurrence,
  describeWorkflowOccurrence,
  originatingActionForPlannedAttemptWorktreeObservation,
  originatingActionForTargetLineageObservation,
  originatingActionForTrackerObservation,
  PlannedAttemptExecutorWorkReported,
  PlannedAttemptExecutorWorkResponsibilityBegan,
  plannedAttemptExecutorResponsibilityForReport,
  presentWorkflowOccurrence,
  projectWorkflowOccurrences,
  WorkflowActor,
  WorkflowOccurrence,
  WorkflowOccurrenceProjection,
  workflowOccurrenceProjectionVersion
} from "./occurrence-projection.js"
import { Effect, Layer, Option, Ref, Schema } from "effect"
import { expect } from "vitest"
import { invalidIntegrationOccurrenceRelationship, projectIntegrationOccurrence } from "./integration-occurrence.js"
import { GitTargetLineageReadFailure } from "../../authorities/git/target-lineage.js"
import { GitWorktreeReadFailure, PlannedWorktreeReady } from "../../authorities/git/worktree.js"
import { ActiveTaskClaim, TaskClaimRelease, UnclaimedTask } from "../../authorities/task-tracker/claim-mutation.js"
import { ClaimOwner, ClaimToken } from "../../authorities/task-tracker/claim.js"
import {
  IntegrationResponsibilityBeganEvent,
  IntegrationStartedEvent
} from "../protocols/integration-admission/events.js"
import {
  ControlDirectionAppliedEvent,
  ControlDirectionApplicationOrdinal
} from "../protocols/control-direction-application/events.js"
import {
  AttemptChoiceAppliedEvent,
  AttemptChoiceRequestId,
  AttemptImplementationAbandonedEvent,
  AttemptStoppageIntendedEvent,
  StoppedAttemptClaimNoReleaseObservedEvent
} from "../protocols/attempt-choice/events.js"
import {
  AttemptRestartAuthorityReadFailedEvent,
  AttemptRestartTaskFactsReadFailure,
  PlannedAttemptReplacedEvent,
  PlannedAttemptReplacementWitness
} from "../protocols/attempt-choice/replacement-events.js"
import {
  ActiveWorkAuthorityRefreshAuthority,
  ActiveWorkAuthorityRefreshGitReadOperation,
  ActiveWorkAuthorityRefreshGitReadIntentRecordedEvent,
  ActiveWorkAuthorityRefreshGitReadFailedEvent,
  ActiveWorkAuthorityRefreshOrdinal,
  makeActiveWorkAuthorityRefreshGitReadOperation
} from "../protocols/active-work-authority-refresh/events.js"
import {
  TaskClaimReacquisitionDirectedEvent,
  TaskClaimReacquisitionRequestId
} from "../protocols/task-claim-reacquisition/events.js"
import { integrationFinalityFixture } from "../protocols/integration-finality/fixtures.js"
import {
  CompletionClaimDeletionIntendedEvent,
  CompletionClaimReplacementIntendedEvent,
  CompletionTaskIntendedEvent,
  IntegrationFinalitySettledEvent
} from "../protocols/integration-finality/events.js"
import {
  IntegrationQuarantineBasis,
  IntegrationQuarantineFailureDetail,
  IntegrationProviderRunActivityAbsentEvent,
  IntegrationQuarantineDirectionAppliedEvent,
  IntegrationQuarantineDirectionFingerprint,
  IntegrationQuarantineDirectionRequestId,
  IntegrationQuarantinedEvent
} from "../protocols/integration-quarantine/events.js"
import {
  IntegratorCandidateText,
  IntegratorGitObservation,
  IntegratorResult,
  IntegratorRunCorrelation,
  IntegratorRunQualifiedCandidate,
  IntegratorRunCandidateGitObservedEvent,
  IntegratorRunCandidateGitReadIntendedEvent,
  IntegratorRunResultRecordedEvent,
  IntegratorRunStartedEvent,
  IntegratorSessionCorrelation,
  IntegratorSessionFixedEvent,
  IntegratorSuccessorSessionFixedEvent,
  IntegratorCandidateResourceLocator,
  IntegratorSessionId,
  IntegratorRunOrdinal,
  firstFullRerunSuccessorGeneration
} from "../protocols/integrator/events.js"
import {
  TargetPromotionAttemptIntendedEvent,
  TargetPromotionAttemptOrdinal,
  TargetPromotionAttemptLimit,
  TargetPromotionIntendedEvent,
  TargetPromotionNonConvergenceEvent,
  TargetPromotionObservedSuccessEvent,
  TargetPromotionSuccessObservation,
  TargetPromotionStaleEvent,
  targetPromotionCorrelationFor
} from "../protocols/target-promotion/events.js"

const runId = RunId.make("occurrence-run")
const operation = makeTrackerGraphObservationOperation(
  OperationId.make("read-target-closure"),
  FixtureTarget.make("occurrence-fixture")
)
const plannedAttempt = PlannedTaskAttempt.make({
  attemptId: AttemptId.make("occurrence-attempt"),
  baseSha: GitCommitSha.make("1".repeat(40)),
  branch: TaskBranchRef.make("refs/heads/dalph/occurrence-attempt"),
  executor: TaskExecutorLocator.make("executor:controlled-fake"),
  runId,
  taskId: TaskId.make("occurrence-task"),
  taskRevision: TaskRevision.make("occurrence-revision"),
  worktree: WorktreeLocator.make("/worktrees/occurrence-attempt")
})
const acceptedResult = acceptedResultFixture(GitCommitSha.make("a".repeat(40)))
const integrationTarget = IntegrationTarget.make({
  repository: GitRepositoryLocator.make("/repo/.git"),
  ref: IntegrationTargetRef.make("refs/heads/master")
})

const record = (position: number, event: JournalRecord["event"]): JournalRecord => ({
  event,
  key: JournalRecordKey.make(`occurrence-record-${position}`),
  position: JournalPosition.make(position),
  runId
})

const historicalRunId = integrationFinalityFixture.runId

const historicalRecord = (position: number, event: JournalRecord["event"]): JournalRecord => ({
  event,
  key: JournalRecordKey.make(`historical-occurrence-record-${position}`),
  position: JournalPosition.make(position),
  runId: historicalRunId
})

/** One valid prefix reaches the candidate Git observation before any promotion. */
const historicalIntegrationPrefix = () => {
  const fixture = integrationFinalityFixture
  const session = IntegratorSessionCorrelation.make({
    ...fixture.qualifiedCandidate.run.session,
    queuedAt: JournalPosition.make(5),
    startedAt: JournalPosition.make(8),
    targetLineageObservedAt: JournalPosition.make(7)
  })
  const integratorRun = IntegratorRunCorrelation.make({ ordinal: IntegratorRunOrdinal.make(1), session })
  const candidateText = IntegratorCandidateText.make("refs/heads/historical-occurrence-candidate")
  const qualifiedCandidate = IntegratorRunQualifiedCandidate.make({
    ...fixture.qualifiedCandidate,
    candidateText,
    qualifiedAt: JournalPosition.make(14),
    run: integratorRun
  })
  const promotionCorrelation = targetPromotionCorrelationFor(qualifiedCandidate)
  const lineageOperation = makeTargetLineageObservationOperation({
    integrationTarget: fixture.integrationTarget,
    operationId: OperationId.make("historical-occurrence-lineage"),
    plannedAttempt: fixture.plannedAttempt,
    predecessorOperationIds: []
  })
  const candidateObservation = IntegratorGitObservation.cases.Commit.make({
    candidateText,
    commit: qualifiedCandidate.candidateCommit,
    directParents: qualifiedCandidate.directParents
  })
  return {
    candidateText,
    candidateObservation,
    integratorRun,
    lineageOperation,
    promotionCorrelation,
    qualifiedCandidate,
    records: [
      historicalRecord(
        5,
        IntegrationResponsibilityBeganEvent.make({
          acceptedResult: session.acceptedResult,
          integrationTarget: session.integrationTarget,
          plannedAttempt: session.plannedAttempt,
          version: workflowJournalEventVersion
        })
      ),
      historicalRecord(
        6,
        GitReadIntentRecordedEvent.make({
          initiatedBy: WorkflowActor.cases.DalphCoordinator.make({}),
          occurrenceClassification: "InitiatedAction",
          operation: lineageOperation,
          version: workflowJournalEventVersion
        })
      ),
      historicalRecord(
        7,
        TargetLineageObservedEvent.make({
          observation: {
            plannedBaseIsAncestorOfTargetHead: true,
            plannedBaseSha: fixture.plannedAttempt.baseSha,
            targetHeadSha: session.expectedTargetHead
          },
          occurrenceClassification: "NonActionOccurrence",
          operationId: lineageOperation.operationId,
          plannedAttempt: fixture.plannedAttempt,
          version: workflowJournalEventVersion
        })
      ),
      historicalRecord(
        8,
        IntegrationStartedEvent.make({
          acceptedResult: session.acceptedResult,
          integrationTarget: session.integrationTarget,
          plannedAttempt: session.plannedAttempt,
          responsibilityBeganAt: session.queuedAt,
          version: workflowJournalEventVersion
        })
      ),
      historicalRecord(
        10,
        IntegratorSessionFixedEvent.make({ correlation: session, version: workflowJournalEventVersion })
      ),
      historicalRecord(
        11,
        IntegratorRunStartedEvent.make({ run: integratorRun, version: workflowJournalEventVersion })
      ),
      historicalRecord(
        12,
        IntegratorRunResultRecordedEvent.make({
          result: IntegratorResult.cases.PreparedCandidate.make({ candidateText, correlation: session }),
          run: integratorRun,
          version: workflowJournalEventVersion
        })
      ),
      historicalRecord(
        13,
        IntegratorRunCandidateGitReadIntendedEvent.make({
          candidateText,
          run: integratorRun,
          version: workflowJournalEventVersion
        })
      ),
      historicalRecord(
        14,
        IntegratorRunCandidateGitObservedEvent.make({
          candidateText,
          observation: candidateObservation,
          run: integratorRun,
          version: workflowJournalEventVersion
        })
      )
    ] as const
  }
}

it("projects both integration actions and rejects every inexact start relationship", () => {
  const began = projectIntegrationOccurrence(
    record(
      1,
      IntegrationResponsibilityBeganEvent.make({
        acceptedResult,
        integrationTarget,
        plannedAttempt,
        version: workflowJournalEventVersion
      })
    ),
    IntegrationResponsibilityBeganEvent.make({
      acceptedResult,
      integrationTarget,
      plannedAttempt,
      version: workflowJournalEventVersion
    })
  )
  const started = projectIntegrationOccurrence(
    record(
      2,
      IntegrationStartedEvent.make({
        acceptedResult,
        integrationTarget,
        plannedAttempt,
        responsibilityBeganAt: JournalPosition.make(1),
        version: workflowJournalEventVersion
      })
    ),
    IntegrationStartedEvent.make({
      acceptedResult,
      integrationTarget,
      plannedAttempt,
      responsibilityBeganAt: JournalPosition.make(1),
      version: workflowJournalEventVersion
    })
  )

  expect(invalidIntegrationOccurrenceRelationship([began, started], began, 0)).toBeUndefined()
  expect(invalidIntegrationOccurrenceRelationship([began, started], started, 1)).toBeUndefined()

  const mismatches = [
    { ...started, runId: RunId.make("other-run") },
    { ...started, recordedAt: JournalPosition.make(1) },
    { ...started, plannedAttempt: { ...started.plannedAttempt, attemptId: AttemptId.make("other-attempt") } },
    { ...started, acceptedResult: acceptedResultFixture(GitCommitSha.make("b".repeat(40))) },
    {
      ...started,
      integrationTarget: IntegrationTarget.make({
        repository: GitRepositoryLocator.make("/other.git"),
        ref: started.integrationTarget.ref
      })
    },
    {
      ...started,
      integrationTarget: IntegrationTarget.make({
        repository: started.integrationTarget.repository,
        ref: IntegrationTargetRef.make("refs/heads/other")
      })
    }
  ] as const

  for (const mismatch of mismatches) {
    expect(invalidIntegrationOccurrenceRelationship([began, mismatch], mismatch, 1)).toEqual({
      issue: "integration start must have one exact earlier responsibility at 1",
      path: ["occurrences", 1]
    })
  }
  expect(invalidIntegrationOccurrenceRelationship([], started, 0)).toEqual({
    issue: "integration start must have one exact earlier responsibility at 1",
    path: ["occurrences", 0]
  })
})

it.effect("rejects an integration start whose responsibility facts are not exact", () =>
  Effect.gen(function* () {
    const mismatchedAttempt = PlannedTaskAttempt.make({
      ...plannedAttempt,
      attemptId: AttemptId.make("occurrence-mismatched-start-attempt")
    })
    const failure = yield* projectWorkflowOccurrences([
      record(
        1,
        IntegrationResponsibilityBeganEvent.make({
          acceptedResult,
          integrationTarget,
          plannedAttempt,
          version: workflowJournalEventVersion
        })
      ),
      record(
        2,
        IntegrationStartedEvent.make({
          acceptedResult,
          integrationTarget,
          plannedAttempt: mismatchedAttempt,
          responsibilityBeganAt: JournalPosition.make(1),
          version: workflowJournalEventVersion
        })
      )
    ]).pipe(Effect.flip)

    expect(failure._tag).toBe("SchemaError")
  })
)

it.effect("keeps duplicate integration responsibility occurrences fail-closed without mutating the first index", () =>
  Effect.gen(function* () {
    const first = record(
      1,
      IntegrationResponsibilityBeganEvent.make({
        acceptedResult,
        integrationTarget,
        plannedAttempt,
        version: workflowJournalEventVersion
      })
    )
    const duplicate = { ...first, key: JournalRecordKey.make("occurrence-duplicate-responsibility") }
    const projection = yield* projectWorkflowOccurrences([first, duplicate])

    expect(projection.occurrences).toHaveLength(2)
    expect(projection.occurrences[0]?.recordedAt).toEqual(JournalPosition.make(1))
    expect(projection.occurrences[1]?.recordedAt).toEqual(JournalPosition.make(1))
  })
)

it.effect("projects journaled integration actions through the complete occurrence boundary", () =>
  Effect.gen(function* () {
    const projection = yield* projectWorkflowOccurrences([
      record(
        1,
        IntegrationResponsibilityBeganEvent.make({
          acceptedResult,
          integrationTarget,
          plannedAttempt,
          version: workflowJournalEventVersion
        })
      ),
      record(
        2,
        IntegrationStartedEvent.make({
          acceptedResult,
          integrationTarget,
          plannedAttempt,
          responsibilityBeganAt: JournalPosition.make(1),
          version: workflowJournalEventVersion
        })
      )
    ])

    expect(projection.occurrences.map(({ _tag }) => _tag)).toEqual([
      "IntegrationResponsibilityBegan",
      "IntegrationStarted"
    ])
  })
)

it.effect("reuses the successful projection for one unchanged immutable record array", () =>
  Effect.gen(function* () {
    const records = [record(1, taskTrackerReadIntent(operation))]
    const first = yield* projectWorkflowOccurrences(records)
    const second = yield* projectWorkflowOccurrences(records)

    expect(second).toBe(first)
    expect(second.occurrences).toBe(first.occurrences)
  })
)

it.effect("shows that the operator changed task execution capacity to two", () =>
  Effect.gen(function* () {
    const projection = yield* projectWorkflowOccurrences([
      record(
        1,
        TaskWorkCapacityChangedEvent.make({
          capacity: TaskWorkCapacity.make(2),
          initiatedBy: { _tag: "Operator" },
          occurrenceClassification: "InitiatedAction",
          previousRevision: initialRunPolicyRevision,
          revision: RunPolicyRevision.make(2),
          version: workflowJournalEventVersion
        })
      )
    ])

    expect(projection.occurrences).toMatchObject([
      {
        _tag: "AppliedTaskWorkCapacity",
        capacity: 2,
        initiatedBy: { _tag: "Operator" },
        occurrenceClassification: "InitiatedAction",
        policyRevision: 2,
        recordedAt: 1,
        runId
      }
    ])
    const occurrence = projection.occurrences[0]
    if (occurrence === undefined) return yield* Effect.die("capacity occurrence is missing")
    expect(describeWorkflowOccurrence(occurrence).text).toContain("task work capacity")
    expect(occurrence).toMatchObject({ capacity: 2, initiatedBy: { _tag: "Operator" } })
  })
)

it.effect("classifies an initiated tracker read separately from its observed result", () =>
  Effect.gen(function* () {
    const projection = yield* projectWorkflowOccurrences([
      record(1, taskTrackerReadIntent(operation)),
      record(
        2,
        taskTrackerGraphFactsObserved(operation, { revision: TrackerRevision.make("tracker-revision-1"), taskIds: [] })
      )
    ])

    expect(projection.occurrences).toMatchObject([
      {
        _tag: "TaskTrackerReadInitiated",
        initiatedBy: { _tag: "DalphCoordinator" },
        occurrenceClassification: "InitiatedAction",
        recordedAt: 1
      },
      {
        _tag: "TaskTrackerFactsObserved",
        evidence: { _tag: "CompleteTaskTrackerFacts", target: "occurrence-fixture" },
        occurrenceClassification: "NonActionOccurrence",
        recordedAt: 2
      }
    ])
    const trackerOccurrence = projection.occurrences.at(1)
    if (
      trackerOccurrence?._tag !== "TaskTrackerFactsObserved" ||
      trackerOccurrence.evidence._tag !== "CompleteTaskTrackerFacts"
    ) {
      throw new Error("expected canonical tracker facts")
    }
    expect(trackerOccurrence.evidence.factFamilies[0]).toMatchObject({
      completeness: "Complete",
      consistency: "PotentiallyMixedTime",
      freshness: { _tag: "ObservedDuringLogicalRead", operationId: operation.operationId }
    })
    const observed = projection.occurrences.at(1)
    if (observed === undefined) throw new Error("expected the tracker observation occurrence")
    expect("initiatedBy" in observed).toBe(false)
  })
)

it.effect("projects focused completion facts as one canonical tracker read and its exact observation", () =>
  Effect.gen(function* () {
    const projection = yield* projectWorkflowOccurrences([
      record(1, integrationFinalityFixture.focusedSuccessFactsReadIntentEvent),
      record(2, integrationFinalityFixture.focusedSuccessFactsEvent)
    ])

    expect(projection.occurrences).toMatchObject([
      {
        _tag: "TaskTrackerReadInitiated",
        occurrenceClassification: "InitiatedAction",
        operation: { _tag: "ReadCompletionTaskFacts" }
      },
      {
        _tag: "TaskTrackerFactsObserved",
        evidence: { _tag: "FocusedTaskCompletionFacts" },
        occurrenceClassification: "NonActionOccurrence"
      }
    ])
    const observed = projection.occurrences.at(1)
    if (observed?._tag !== "TaskTrackerFactsObserved") throw new Error("expected focused tracker facts")
    expect(Option.getOrThrow(originatingActionForTrackerObservation(projection, observed))).toMatchObject({
      _tag: "TaskTrackerReadInitiated",
      operation: {
        _tag: "ReadCompletionTaskFacts",
        operationId: integrationFinalityFixture.focusedSuccessFactsEvent.operationId
      }
    })
  })
)

it.effect("classifies Dalph beginning executor-work responsibility separately from executor reports", () =>
  Effect.gen(function* () {
    const correlation = plannedAttemptExecutorCorrelation(plannedAttempt)
    const firstOrdinal = PlannedAttemptExecutorReportOrdinal.make(1)
    const secondOrdinal = PlannedAttemptExecutorReportOrdinal.make(2)
    const running = PlannedAttemptExecutorReport.cases.ExecutorWorkExecuting.make({ correlation })
    const terminal = PlannedAttemptExecutorReport.cases.ExecutorWorkTerminal.make({
      correlation,
      result: { _tag: "Completed" }
    })
    const projection = yield* projectWorkflowOccurrences([
      {
        event: PlannedAttemptExecutorWorkResponsibilityBeganEvent.make({
          plannedAttempt,
          version: workflowJournalEventVersion
        }),
        key: plannedAttemptExecutorWorkResponsibilityBeganRecordKey(plannedAttempt.attemptId),
        position: JournalPosition.make(1),
        runId
      },
      {
        event: PlannedAttemptExecutorWorkReportedEvent.make({
          ordinal: firstOrdinal,
          report: running,
          version: workflowJournalEventVersion
        }),
        key: plannedAttemptExecutorWorkReportedRecordKey(plannedAttempt.attemptId, firstOrdinal),
        position: JournalPosition.make(2),
        runId
      },
      {
        event: PlannedAttemptExecutorWorkReportedEvent.make({
          ordinal: secondOrdinal,
          report: terminal,
          version: workflowJournalEventVersion
        }),
        key: plannedAttemptExecutorWorkReportedRecordKey(plannedAttempt.attemptId, secondOrdinal),
        position: JournalPosition.make(3),
        runId
      }
    ])

    expect(projection.occurrences).toMatchObject([
      {
        _tag: "PlannedAttemptExecutorWorkResponsibilityBegan",
        initiatedBy: { _tag: "DalphCoordinator" },
        occurrenceClassification: "InitiatedAction",
        plannedAttempt,
        recordedAt: 1
      },
      {
        _tag: "PlannedAttemptExecutorWorkReported",
        occurrenceClassification: "NonActionOccurrence",
        report: running,
        recordedAt: 2
      },
      {
        _tag: "PlannedAttemptExecutorWorkReported",
        occurrenceClassification: "NonActionOccurrence",
        report: terminal,
        recordedAt: 3
      }
    ])
    const reports = projection.occurrences.filter(
      (occurrence) => occurrence._tag === "PlannedAttemptExecutorWorkReported"
    )
    expect(reports.every((report) => !("initiatedBy" in report))).toBe(true)
    expect(
      reports.map(
        (report) =>
          Option.getOrThrow(plannedAttemptExecutorResponsibilityForReport(projection, report)).plannedAttempt.attemptId
      )
    ).toEqual([plannedAttempt.attemptId, plannedAttempt.attemptId])
  })
)

it.effect("rejects an executor report without its responsibility-began occurrence", () =>
  Effect.gen(function* () {
    const correlation = plannedAttemptExecutorCorrelation(plannedAttempt)
    const failure = yield* projectWorkflowOccurrences([
      {
        event: PlannedAttemptExecutorWorkReportedEvent.make({
          ordinal: PlannedAttemptExecutorReportOrdinal.make(1),
          report: PlannedAttemptExecutorReport.cases.ExecutorWorkExecuting.make({ correlation }),
          version: workflowJournalEventVersion
        }),
        key: plannedAttemptExecutorWorkReportedRecordKey(
          plannedAttempt.attemptId,
          PlannedAttemptExecutorReportOrdinal.make(1)
        ),
        position: JournalPosition.make(1),
        runId
      }
    ]).pipe(Effect.flip)

    expect(failure).toMatchObject({
      _tag: "ExecutorReportWithoutResponsibilityBegan",
      attemptId: plannedAttempt.attemptId,
      position: 1,
      runId
    })
  })
)

it.effect("rejects an executor report whose exact responsibility is absent, later, or ambiguous", () =>
  Effect.gen(function* () {
    const correlation = plannedAttemptExecutorCorrelation(plannedAttempt)
    const projection = yield* projectWorkflowOccurrences([
      {
        event: PlannedAttemptExecutorWorkResponsibilityBeganEvent.make({
          plannedAttempt,
          version: workflowJournalEventVersion
        }),
        key: plannedAttemptExecutorWorkResponsibilityBeganRecordKey(plannedAttempt.attemptId),
        position: JournalPosition.make(1),
        runId
      },
      {
        event: PlannedAttemptExecutorWorkReportedEvent.make({
          ordinal: PlannedAttemptExecutorReportOrdinal.make(1),
          report: PlannedAttemptExecutorReport.cases.ExecutorWorkExecuting.make({ correlation }),
          version: workflowJournalEventVersion
        }),
        key: plannedAttemptExecutorWorkReportedRecordKey(
          plannedAttempt.attemptId,
          PlannedAttemptExecutorReportOrdinal.make(1)
        ),
        position: JournalPosition.make(2),
        runId
      }
    ])
    const responsibility = projection.occurrences.find(
      (occurrence) => occurrence._tag === "PlannedAttemptExecutorWorkResponsibilityBegan"
    )
    const report = projection.occurrences.find((occurrence) => occurrence._tag === "PlannedAttemptExecutorWorkReported")
    if (
      responsibility?._tag !== "PlannedAttemptExecutorWorkResponsibilityBegan" ||
      report?._tag !== "PlannedAttemptExecutorWorkReported"
    ) {
      throw new Error("expected executor responsibility and report occurrences")
    }

    const laterDurableResponsibility = { ...responsibility, recordedAt: JournalPosition.make(report.recordedAt + 1) }
    const invalidOccurrenceOrders = [
      [report],
      [report, responsibility],
      [responsibility, responsibility, report],
      [laterDurableResponsibility, report]
    ]
    for (const occurrences of invalidOccurrenceOrders) {
      const failure = yield* Schema.decodeUnknownEffect(WorkflowOccurrenceProjection)({
        occurrences,
        version: projection.version
      }).pipe(Effect.flip)
      expect(failure._tag).toBe("SchemaError")
    }

    expect(
      (yield* decodeWorkflowOccurrence({ ...responsibility, runId: RunId.make("wrong-responsibility-run") }).pipe(
        Effect.flip
      ))._tag
    ).toBe("SchemaError")
    expect(
      (yield* decodeWorkflowOccurrence({ ...report, runId: RunId.make("wrong-report-run") }).pipe(Effect.flip))._tag
    ).toBe("SchemaError")
  })
)

it.effect("follows a tracker observation to its exact initiating action without copying the actor", () =>
  Effect.gen(function* () {
    const projection = yield* projectWorkflowOccurrences([
      record(1, taskTrackerReadIntent(operation)),
      record(
        2,
        taskTrackerGraphFactsObserved(operation, { revision: TrackerRevision.make("tracker-revision-2"), taskIds: [] })
      )
    ])
    const observation = projection.occurrences.find((occurrence) => occurrence._tag === "TaskTrackerFactsObserved")
    if (observation?._tag !== "TaskTrackerFactsObserved") {
      throw new Error("expected a tracker observation occurrence")
    }

    const action = originatingActionForTrackerObservation(projection, observation)

    expect(Option.getOrThrow(action)).toMatchObject({
      _tag: "TaskTrackerReadInitiated",
      initiatedBy: { _tag: "DalphCoordinator" },
      operation: { operationId: observation.originatingActionOperationId }
    })
    expect("initiatedBy" in observation).toBe(false)
  })
)

it.effect("follows a lost planned worktree observation to its exact initiating Git read", () =>
  Effect.gen(function* () {
    const gitRead = makeTaskWorktreeObservationOperation({
      operationId: OperationId.make("read-planned-worktree"),
      plannedAttempt,
      predecessorOperationIds: []
    })
    const projection = yield* projectWorkflowOccurrences([
      record(
        1,
        GitReadIntentRecordedEvent.make({
          initiatedBy: { _tag: "DalphCoordinator" },
          occurrenceClassification: "InitiatedAction",
          operation: gitRead,
          version: workflowJournalEventVersion
        })
      ),
      record(
        2,
        PlannedAttemptWorktreeObservedEvent.make({
          observation: AttemptWorktreeLost.make({ plannedAttempt }),
          occurrenceClassification: "NonActionOccurrence",
          operationId: gitRead.operationId,
          version: workflowJournalEventVersion
        })
      )
    ])
    const observation = projection.occurrences.find(
      (occurrence) => occurrence._tag === "PlannedAttemptWorktreeObserved"
    )
    if (observation?._tag !== "PlannedAttemptWorktreeObserved") {
      throw new Error("expected a planned worktree observation occurrence")
    }

    expect(
      Option.getOrThrow(originatingActionForPlannedAttemptWorktreeObservation(projection, observation))
    ).toMatchObject({ _tag: "GitReadInitiated", operation: { operationId: observation.originatingActionOperationId } })
    expect("initiatedBy" in observation).toBe(false)
  })
)

it.effect("does not turn a constructed or proposed tracker read into a past-tense event", () =>
  Effect.gen(function* () {
    const failure = yield* decodeWorkflowOccurrence(operation).pipe(Effect.flip)
    expect(failure._tag).toBe("SchemaError")
  })
)

it.effect("rejects a tracker outcome without an earlier same-run read intent", () =>
  Effect.gen(function* () {
    const failure = yield* projectWorkflowOccurrences([
      record(
        1,
        taskTrackerGraphFactsObserved(operation, { revision: TrackerRevision.make("unmatched-outcome"), taskIds: [] })
      )
    ]).pipe(Effect.flip)

    expect(failure).toMatchObject({
      _tag: "TrackerOutcomeWithoutReadIntent",
      operationId: operation.operationId,
      position: 1,
      runId
    })
  })
)

it.effect("rejects each Git outcome without its distinct earlier same-run read intent", () =>
  Effect.gen(function* () {
    const worktreeFailure = yield* projectWorkflowOccurrences([
      record(
        1,
        PlannedAttemptWorktreeObservedEvent.make({
          observation: AttemptWorktreeLost.make({ plannedAttempt }),
          occurrenceClassification: "NonActionOccurrence",
          operationId: OperationId.make("unmatched-worktree-outcome"),
          version: workflowJournalEventVersion
        })
      )
    ]).pipe(Effect.flip)
    const lineageFailure = yield* projectWorkflowOccurrences([
      record(
        1,
        TargetLineageObservedEvent.make({
          observation: {
            plannedBaseIsAncestorOfTargetHead: true,
            plannedBaseSha: plannedAttempt.baseSha,
            targetHeadSha: plannedAttempt.baseSha
          },
          occurrenceClassification: "NonActionOccurrence",
          operationId: OperationId.make("unmatched-target-lineage-outcome"),
          plannedAttempt,
          version: workflowJournalEventVersion
        })
      )
    ]).pipe(Effect.flip)

    expect(worktreeFailure._tag).toBe("GitOutcomeWithoutReadIntent")
    expect(lineageFailure._tag).toBe("GitOutcomeWithoutReadIntent")
  })
)

it.effect("projects active-refresh Git failures as non-action trace occurrences", () =>
  Effect.gen(function* () {
    const gitRead = makeTaskWorktreeObservationOperation({
      operationId: OperationId.make("active-refresh-occurrence-read"),
      plannedAttempt,
      predecessorOperationIds: []
    })
    const authority = ActiveWorkAuthorityRefreshAuthority.make({ attemptId: plannedAttempt.attemptId, runId })
    const ordinal = ActiveWorkAuthorityRefreshOrdinal.make(1)
    const activeRead = makeActiveWorkAuthorityRefreshGitReadOperation(gitRead, authority, ordinal)
    const activeIntent = ActiveWorkAuthorityRefreshGitReadIntentRecordedEvent.make({
      initiatedBy: { _tag: "DalphCoordinator" },
      occurrenceClassification: "InitiatedAction",
      operation: activeRead,
      version: workflowJournalEventVersion
    })
    const failure = ActiveWorkAuthorityRefreshGitReadFailedEvent.make({
      authority,
      failure: new GitWorktreeReadFailure({
        detail: "Git is temporarily unreadable",
        worktree: plannedAttempt.worktree
      }),
      occurrenceClassification: "NonActionOccurrence",
      operation: activeRead,
      ordinal,
      source: "TrackerNotification",
      version: workflowJournalEventVersion
    })
    const projection = yield* projectWorkflowOccurrences([record(1, activeIntent), record(2, failure)])

    expect(projection.occurrences).toHaveLength(2)
    const occurrence = projection.occurrences[1]
    if (occurrence === undefined) return yield* Effect.die("active-refresh occurrence is missing")
    expect(occurrence).toMatchObject({
      _tag: "ActiveWorkAuthorityRefreshGitReadFailed",
      authority,
      failure: failure.failure,
      operation: activeRead,
      ordinal,
      occurrenceClassification: "NonActionOccurrence",
      recordedAt: JournalPosition.make(2),
      runId
    })
    expect(describeWorkflowOccurrence(occurrence)).toEqual({
      actorLabel: "no actor is proven",
      presentation: { classification: "NonActionOccurrence" },
      text: "active-work authority refresh Git read failed; no actor is proven"
    })
    const encodedOccurrence = Schema.encodeUnknownSync(WorkflowOccurrence)(occurrence)
    if (encodedOccurrence._tag !== "ActiveWorkAuthorityRefreshGitReadFailed") {
      return yield* Effect.die("encoded active-refresh occurrence changed variants")
    }
    const malformed = yield* decodeWorkflowOccurrence({
      ...encodedOccurrence,
      failure: {
        _tag: "GitWorktreeReadFailure",
        detail: "the decoded occurrence names another worktree",
        worktree: WorktreeLocator.make("/worktrees/another-active-refresh-worktree")
      }
    }).pipe(Effect.flip)
    expect(String(malformed)).toContain(
      "active-refresh worktree failure occurrence must name the exact planned worktree"
    )
  })
)

it.effect("rejects a coordinator's active-refresh failure when its Run, authority, or Git subject changes", () =>
  Effect.gen(function* () {
    const authority = ActiveWorkAuthorityRefreshAuthority.make({ attemptId: plannedAttempt.attemptId, runId })
    const ordinal = ActiveWorkAuthorityRefreshOrdinal.make(1)
    const worktreeRead = makeActiveWorkAuthorityRefreshGitReadOperation(
      makeTaskWorktreeObservationOperation({
        operationId: OperationId.make("active-refresh-schema-worktree"),
        plannedAttempt,
        predecessorOperationIds: []
      }),
      authority,
      ordinal
    )
    const worktreeIntent = ActiveWorkAuthorityRefreshGitReadIntentRecordedEvent.make({
      initiatedBy: WorkflowActor.cases.DalphCoordinator.make({}),
      occurrenceClassification: "InitiatedAction",
      operation: worktreeRead,
      version: workflowJournalEventVersion
    })
    const worktreeFailure = ActiveWorkAuthorityRefreshGitReadFailedEvent.make({
      authority,
      failure: new GitWorktreeReadFailure({ detail: "worktree read failed", worktree: plannedAttempt.worktree }),
      occurrenceClassification: "NonActionOccurrence",
      operation: worktreeRead,
      ordinal,
      source: "Timer",
      version: workflowJournalEventVersion
    })
    const worktreeProjection = yield* projectWorkflowOccurrences([
      record(1, worktreeIntent),
      record(2, worktreeFailure)
    ])
    const worktreeOccurrence = worktreeProjection.occurrences[1]
    if (worktreeOccurrence?._tag !== "ActiveWorkAuthorityRefreshGitReadFailed") {
      return yield* Effect.die("active-refresh worktree failure occurrence is missing")
    }
    const encodedWorktreeOccurrence = Schema.encodeUnknownSync(WorkflowOccurrence)(worktreeOccurrence)
    if (encodedWorktreeOccurrence._tag !== "ActiveWorkAuthorityRefreshGitReadFailed") {
      return yield* Effect.die("encoded active-refresh worktree occurrence changed variants")
    }
    yield* decodeWorkflowOccurrence(encodedWorktreeOccurrence)

    const foreignRunId = RunId.make("active-refresh-schema-foreign-run")
    const foreignAttempt = PlannedTaskAttempt.make({
      ...plannedAttempt,
      attemptId: AttemptId.make("active-refresh-schema-foreign-attempt"),
      branch: TaskBranchRef.make("refs/heads/dalph/active-refresh-schema-foreign-attempt"),
      worktree: WorktreeLocator.make("/worktrees/active-refresh-schema-foreign-attempt")
    })
    const foreignRunAttempt = PlannedTaskAttempt.make({ ...plannedAttempt, runId: foreignRunId })
    const foreignAuthority = { attemptId: foreignAttempt.attemptId, runId }
    const contradictoryWorktreeIdentities: ReadonlyArray<{ readonly detail: string; readonly value: unknown }> = [
      {
        detail: "active-refresh Git failure occurrence must bind one exact attempt, authority, run, and ordinal",
        value: { ...encodedWorktreeOccurrence, authority: foreignAuthority }
      },
      {
        detail: "an active-refresh Git intent must bind its exact planned attempt",
        value: {
          ...encodedWorktreeOccurrence,
          operation: {
            ...encodedWorktreeOccurrence.operation,
            authority: { attemptId: authority.attemptId, runId: foreignRunId }
          }
        }
      },
      {
        detail: "active-refresh Git failure occurrence must bind one exact attempt, authority, run, and ordinal",
        value: { ...encodedWorktreeOccurrence, ordinal: ActiveWorkAuthorityRefreshOrdinal.make(2) }
      },
      {
        detail: "an active-refresh Git intent must bind its exact planned attempt",
        value: {
          ...encodedWorktreeOccurrence,
          operation: { ...encodedWorktreeOccurrence.operation, plannedAttempt: foreignAttempt }
        }
      },
      {
        detail: "an active-refresh Git intent must bind its exact planned attempt",
        value: {
          ...encodedWorktreeOccurrence,
          operation: { ...encodedWorktreeOccurrence.operation, plannedAttempt: foreignRunAttempt }
        }
      }
    ]
    const contradictoryWorktreeSubjects: ReadonlyArray<unknown> = [
      {
        ...encodedWorktreeOccurrence,
        failure: {
          _tag: "GitTargetLineageReadFailure",
          detail: "the failure belongs to another Git boundary",
          plannedBaseSha: plannedAttempt.baseSha,
          target: integrationTarget
        }
      }
    ]

    const runMismatchFailure = yield* decodeWorkflowOccurrence({
      ...encodedWorktreeOccurrence,
      runId: foreignRunId
    }).pipe(Effect.flip)
    expect(String(runMismatchFailure)).toContain(
      "active-refresh Git failure occurrence must bind one exact attempt, authority, run, and ordinal"
    )

    const encodedWorktreeRead = Schema.encodeUnknownSync(ActiveWorkAuthorityRefreshGitReadOperation)(worktreeRead)
    for (const { detail, value } of [
      {
        detail: "an operation cannot causally precede itself",
        value: { ...encodedWorktreeRead, predecessorOperationIds: [encodedWorktreeRead.operationId] }
      },
      {
        detail: "an active-refresh Git intent must bind its exact planned attempt",
        value: { ...encodedWorktreeRead, authority: foreignAuthority }
      }
    ]) {
      const failure = yield* Schema.decodeUnknownEffect(ActiveWorkAuthorityRefreshGitReadOperation)(value).pipe(
        Effect.flip
      )
      expect(String(failure)).toContain(detail)
    }
    const encodedFailureEvent = Schema.encodeUnknownSync(WorkflowJournalEvent)(worktreeFailure)
    if (encodedFailureEvent._tag !== "ActiveWorkAuthorityRefreshGitReadFailed") {
      return yield* Effect.die("encoded active-refresh failure event changed variants")
    }
    const eventFailure = yield* Schema.decodeUnknownEffect(WorkflowJournalEvent)({
      ...encodedFailureEvent,
      authority: foreignAuthority
    }).pipe(Effect.flip)
    expect(String(eventFailure)).toContain(
      "active-refresh Git failure must bind one exact attempt, authority, and ordinal"
    )

    const targetRead = makeActiveWorkAuthorityRefreshGitReadOperation(
      makeTargetLineageObservationOperation({
        integrationTarget,
        operationId: OperationId.make("active-refresh-schema-target"),
        plannedAttempt,
        predecessorOperationIds: []
      }),
      authority,
      ordinal
    )
    const targetIntent = ActiveWorkAuthorityRefreshGitReadIntentRecordedEvent.make({
      initiatedBy: WorkflowActor.cases.DalphCoordinator.make({}),
      occurrenceClassification: "InitiatedAction",
      operation: targetRead,
      version: workflowJournalEventVersion
    })
    const targetFailure = ActiveWorkAuthorityRefreshGitReadFailedEvent.make({
      authority,
      failure: new GitTargetLineageReadFailure({
        detail: "target lineage read failed",
        plannedBaseSha: plannedAttempt.baseSha,
        target: integrationTarget
      }),
      occurrenceClassification: "NonActionOccurrence",
      operation: targetRead,
      ordinal,
      source: "TrackerNotification",
      version: workflowJournalEventVersion
    })
    const targetProjection = yield* projectWorkflowOccurrences([record(1, targetIntent), record(2, targetFailure)])
    const targetOccurrence = targetProjection.occurrences[1]
    if (targetOccurrence?._tag !== "ActiveWorkAuthorityRefreshGitReadFailed") {
      return yield* Effect.die("active-refresh target-lineage failure occurrence is missing")
    }
    const encodedTargetOccurrence = Schema.encodeUnknownSync(WorkflowOccurrence)(targetOccurrence)
    if (encodedTargetOccurrence._tag !== "ActiveWorkAuthorityRefreshGitReadFailed") {
      return yield* Effect.die("encoded active-refresh target occurrence changed variants")
    }
    const foreignRepositoryTarget = IntegrationTarget.make({
      ...integrationTarget,
      repository: GitRepositoryLocator.make("/foreign/repository.git")
    })
    const foreignRefTarget = IntegrationTarget.make({
      ...integrationTarget,
      ref: IntegrationTargetRef.make("refs/heads/foreign")
    })
    const contradictoryTargetOccurrences: ReadonlyArray<unknown> = [
      {
        ...encodedTargetOccurrence,
        failure: { ...encodedTargetOccurrence.failure, plannedBaseSha: GitCommitSha.make("9".repeat(40)) }
      },
      { ...encodedTargetOccurrence, failure: { ...encodedTargetOccurrence.failure, target: foreignRepositoryTarget } },
      { ...encodedTargetOccurrence, failure: { ...encodedTargetOccurrence.failure, target: foreignRefTarget } },
      {
        ...encodedTargetOccurrence,
        failure: {
          _tag: "GitWorktreeReadFailure",
          detail: "the failure belongs to another Git boundary",
          worktree: plannedAttempt.worktree
        }
      }
    ]

    for (const { detail, value } of contradictoryWorktreeIdentities) {
      const failure = yield* decodeWorkflowOccurrence(value).pipe(Effect.flip)
      expect(String(failure)).toContain(detail)
    }
    for (const contradictory of contradictoryWorktreeSubjects) {
      const failure = yield* decodeWorkflowOccurrence(contradictory).pipe(Effect.flip)
      expect(String(failure)).toContain(
        "active-refresh worktree failure occurrence must name the exact planned worktree"
      )
    }
    for (const contradictory of contradictoryTargetOccurrences) {
      const failure = yield* decodeWorkflowOccurrence(contradictory).pipe(Effect.flip)
      expect(String(failure)).toContain(
        "active-refresh target-lineage failure occurrence must name the exact target and planned Base SHA"
      )
    }
  })
)

it.effect("rejects a coordinator's active-refresh failure when its exact Git intent is absent", () =>
  Effect.gen(function* () {
    const authority = ActiveWorkAuthorityRefreshAuthority.make({ attemptId: plannedAttempt.attemptId, runId })
    const ordinal = ActiveWorkAuthorityRefreshOrdinal.make(1)
    const operationId = OperationId.make("active-refresh-exact-intent")
    const read = makeActiveWorkAuthorityRefreshGitReadOperation(
      makeTaskWorktreeObservationOperation({ operationId, plannedAttempt, predecessorOperationIds: [] }),
      authority,
      ordinal
    )
    const failure = ActiveWorkAuthorityRefreshGitReadFailedEvent.make({
      authority,
      failure: new GitWorktreeReadFailure({ detail: "worktree read failed", worktree: plannedAttempt.worktree }),
      occurrenceClassification: "NonActionOccurrence",
      operation: read,
      ordinal,
      source: "Timer",
      version: workflowJournalEventVersion
    })
    const mismatchedRead = makeActiveWorkAuthorityRefreshGitReadOperation(
      makeTaskWorktreeObservationOperation({
        operationId,
        plannedAttempt,
        predecessorOperationIds: [OperationId.make("active-refresh-foreign-predecessor")]
      }),
      authority,
      ordinal
    )
    const mismatchedIntent = ActiveWorkAuthorityRefreshGitReadIntentRecordedEvent.make({
      initiatedBy: WorkflowActor.cases.DalphCoordinator.make({}),
      occurrenceClassification: "InitiatedAction",
      operation: mismatchedRead,
      version: workflowJournalEventVersion
    })

    for (const records of [[record(1, failure)], [record(1, mismatchedIntent), record(2, failure)]]) {
      const projectionFailure = yield* projectWorkflowOccurrences(records).pipe(Effect.flip)
      expect(projectionFailure).toMatchObject({ _tag: "GitOutcomeWithoutReadIntent", operationId, runId })
    }
  })
)

it.effect("rejects an active-refresh failure whose persisted intent is positioned afterward", () =>
  Effect.gen(function* () {
    const gitRead = makeTaskWorktreeObservationOperation({
      operationId: OperationId.make("active-refresh-late-intent-read"),
      plannedAttempt,
      predecessorOperationIds: []
    })
    const authority = ActiveWorkAuthorityRefreshAuthority.make({ attemptId: plannedAttempt.attemptId, runId })
    const ordinal = ActiveWorkAuthorityRefreshOrdinal.make(1)
    const activeRead = makeActiveWorkAuthorityRefreshGitReadOperation(gitRead, authority, ordinal)
    const activeIntent = ActiveWorkAuthorityRefreshGitReadIntentRecordedEvent.make({
      initiatedBy: { _tag: "DalphCoordinator" },
      occurrenceClassification: "InitiatedAction",
      operation: activeRead,
      version: workflowJournalEventVersion
    })
    const failure = ActiveWorkAuthorityRefreshGitReadFailedEvent.make({
      authority,
      failure: new GitWorktreeReadFailure({
        detail: "Git is temporarily unreadable",
        worktree: plannedAttempt.worktree
      }),
      occurrenceClassification: "NonActionOccurrence",
      operation: activeRead,
      ordinal,
      source: "Timer",
      version: workflowJournalEventVersion
    })
    const invalid = yield* projectWorkflowOccurrences([record(2, activeIntent), record(1, failure)]).pipe(Effect.flip)
    expect(invalid._tag).toBe("SchemaError")
  })
)

it.effect("requires exact claim and worktree payloads at historical outcome boundaries", () =>
  Effect.gen(function* () {
    const acquisition = {
      operationId: OperationId.make("exact-claim-acquisition"),
      owner: ClaimOwner.make("dalph:exact-boundary"),
      taskId: plannedAttempt.taskId,
      token: ClaimToken.make("exact-claim-token")
    }
    const acquisitionOperation = makeTaskClaimAcquisitionOperation({ acquisition, predecessorOperationIds: [] })
    const acquisitionIntent = record(
      1,
      TaskClaimAcquisitionIntendedEvent.make({ operation: acquisitionOperation, version: workflowJournalEventVersion })
    )
    const validClaim = TaskClaimAcquiredEvent.make({
      claim: ActiveTaskClaim.make(acquisition),
      version: workflowJournalEventVersion
    })
    const mismatchedClaim = TaskClaimAcquiredEvent.make({
      claim: ActiveTaskClaim.make({ ...acquisition, token: ClaimToken.make("foreign-claim-token") }),
      version: workflowJournalEventVersion
    })

    const validClaimProjection = yield* projectWorkflowOccurrences([acquisitionIntent, record(2, validClaim)])
    expect(validClaimProjection.occurrences.map(({ _tag }) => _tag)).toEqual([
      "TaskClaimAcquisitionInitiated",
      "TaskClaimAcquired"
    ])
    const claimFailure = yield* projectWorkflowOccurrences([acquisitionIntent, record(2, mismatchedClaim)]).pipe(
      Effect.flip
    )
    expect(claimFailure).toMatchObject({ _tag: "TrackerOutcomeWithoutReadIntent" })

    const release = TaskClaimRelease.make({
      claim: ActiveTaskClaim.make(acquisition),
      operationId: OperationId.make("exact-claim-release")
    })
    const releaseOperation = makeTaskClaimReleaseOperation({
      authority: TaskClaimReleaseAuthority.cases.WorkflowClaimReleaseAuthority.make({}),
      predecessorOperationIds: [acquisition.operationId],
      release
    })
    const releaseIntent = record(
      1,
      TaskClaimReleaseIntendedEvent.make({ operation: releaseOperation, version: workflowJournalEventVersion })
    )
    const releaseOutcome = TaskClaimReleasedEvent.make({ release, version: workflowJournalEventVersion })
    const mismatchedRelease = TaskClaimReleasedEvent.make({
      release: TaskClaimRelease.make({
        ...release,
        claim: ActiveTaskClaim.make({ ...acquisition, token: ClaimToken.make("foreign-release-token") })
      }),
      version: workflowJournalEventVersion
    })
    const releaseProjection = yield* projectWorkflowOccurrences([releaseIntent, record(2, releaseOutcome)])
    expect(releaseProjection.occurrences.map(({ _tag }) => _tag)).toEqual([
      "TaskClaimReleaseInitiated",
      "TaskClaimReleased"
    ])
    const releaseFailure = yield* projectWorkflowOccurrences([releaseIntent, record(2, mismatchedRelease)]).pipe(
      Effect.flip
    )
    expect(releaseFailure).toMatchObject({ _tag: "TrackerOutcomeWithoutReadIntent" })

    const reconciliation = makeTaskWorktreeReconciliationOperation({
      operationId: OperationId.make("exact-worktree-reconciliation"),
      plannedAttempt,
      predecessorOperationIds: []
    })
    const reconciliationIntent = record(
      1,
      TaskWorktreeReconciliationIntendedEvent.make({ operation: reconciliation, version: workflowJournalEventVersion })
    )
    const validProof = PlannedWorktreeReady.make({
      baseSha: plannedAttempt.baseSha,
      branch: plannedAttempt.branch,
      headSha: plannedAttempt.baseSha,
      worktree: plannedAttempt.worktree
    })
    const mismatchedProof = PlannedWorktreeReady.make({
      ...validProof,
      branch: TaskBranchRef.make("refs/heads/dalph/foreign-worktree-proof")
    })
    const ready = (proof: typeof validProof) =>
      TaskWorktreeReadyEvent.make({
        operationId: reconciliation.operationId,
        proof,
        version: workflowJournalEventVersion
      })
    const worktreeProjection = yield* projectWorkflowOccurrences([reconciliationIntent, record(2, ready(validProof))])
    expect(worktreeProjection.occurrences.map(({ _tag }) => _tag)).toEqual([
      "TaskWorktreeReconciliationInitiated",
      "TaskWorktreeReady"
    ])
    const worktreeFailure = yield* projectWorkflowOccurrences([
      reconciliationIntent,
      record(2, ready(mismatchedProof))
    ]).pipe(Effect.flip)
    expect(worktreeFailure).toMatchObject({ _tag: "GitOutcomeWithoutReadIntent" })
  })
)

it.effect("rejects an already projected Git observation when its initiating action is removed", () =>
  Effect.gen(function* () {
    const gitRead = makeTaskWorktreeObservationOperation({
      operationId: OperationId.make("projected-worktree-without-action"),
      plannedAttempt,
      predecessorOperationIds: []
    })
    const valid = yield* projectWorkflowOccurrences([
      record(
        1,
        GitReadIntentRecordedEvent.make({
          initiatedBy: { _tag: "DalphCoordinator" },
          occurrenceClassification: "InitiatedAction",
          operation: gitRead,
          version: workflowJournalEventVersion
        })
      ),
      record(
        2,
        PlannedAttemptWorktreeObservedEvent.make({
          observation: AttemptWorktreeLost.make({ plannedAttempt }),
          occurrenceClassification: "NonActionOccurrence",
          operationId: gitRead.operationId,
          version: workflowJournalEventVersion
        })
      )
    ])
    const observation = valid.occurrences.find(({ _tag }) => _tag === "PlannedAttemptWorktreeObserved")
    if (observation?._tag !== "PlannedAttemptWorktreeObserved")
      return yield* Effect.die("expected worktree observation")

    const failure = yield* Schema.decodeUnknownEffect(WorkflowOccurrenceProjection)({
      occurrences: [observation],
      version: valid.version
    }).pipe(Effect.flip)
    expect(failure._tag).toBe("SchemaError")
  })
)

it.effect("rejects a Git observation when two earlier reads share its same-run operation identity", () =>
  Effect.gen(function* () {
    const gitRead = makeTaskWorktreeObservationOperation({
      operationId: OperationId.make("ambiguous-worktree-observation"),
      plannedAttempt,
      predecessorOperationIds: []
    })
    const intent = GitReadIntentRecordedEvent.make({
      initiatedBy: { _tag: "DalphCoordinator" },
      occurrenceClassification: "InitiatedAction",
      operation: gitRead,
      version: workflowJournalEventVersion
    })
    const valid = yield* projectWorkflowOccurrences([
      record(1, intent),
      record(
        3,
        PlannedAttemptWorktreeObservedEvent.make({
          observation: AttemptWorktreeLost.make({ plannedAttempt }),
          occurrenceClassification: "NonActionOccurrence",
          operationId: gitRead.operationId,
          version: workflowJournalEventVersion
        })
      )
    ])
    const action = valid.occurrences.find(({ _tag }) => _tag === "GitReadInitiated")
    const observation = valid.occurrences.find(({ _tag }) => _tag === "PlannedAttemptWorktreeObserved")
    if (action?._tag !== "GitReadInitiated" || observation?._tag !== "PlannedAttemptWorktreeObserved") {
      return expect.fail("expected Git read and worktree observation occurrences")
    }
    const equivalentFailure = yield* Schema.decodeUnknownEffect(WorkflowOccurrenceProjection)({
      occurrences: [action, { ...action, recordedAt: JournalPosition.make(2) }, observation],
      version: valid.version
    }).pipe(Effect.flip)
    expect(equivalentFailure._tag).toBe("SchemaError")

    const failure = yield* projectWorkflowOccurrences([
      record(1, intent),
      { ...record(2, intent), key: JournalRecordKey.make("ambiguous-worktree-observation-intent") },
      record(
        3,
        PlannedAttemptWorktreeObservedEvent.make({
          observation: AttemptWorktreeLost.make({ plannedAttempt }),
          occurrenceClassification: "NonActionOccurrence",
          operationId: gitRead.operationId,
          version: workflowJournalEventVersion
        })
      )
    ]).pipe(Effect.flip)

    expect(failure._tag).toBe("SchemaError")
  })
)

it.effect("rejects focused task-work facts attached to a graph read or the wrong focused task", () =>
  Effect.gen(function* () {
    const focusedRead = makeTaskWorkSpecificationObservationOperation(
      operation.operationId,
      operation.target,
      TaskId.make("focused-A")
    )
    const focusedObservation = makeFocusedTaskWorkSpecificationFactsObserved(
      focusedRead,
      makeTaskWorkSpecification({ body: "body", taskId: TaskId.make("focused-A"), title: "title" })
    )
    const graphMismatch = yield* projectWorkflowOccurrences([
      record(1, taskTrackerReadIntent(operation)),
      record(2, taskTrackerFactsObservedEvent(operation.operationId, focusedObservation))
    ]).pipe(Effect.flip)
    expect(graphMismatch._tag).toBe("SchemaError")

    const wrongTaskRead = makeTaskWorkSpecificationObservationOperation(
      operation.operationId,
      operation.target,
      TaskId.make("focused-B")
    )
    const taskMismatch = yield* projectWorkflowOccurrences([
      record(1, taskTrackerReadIntent(wrongTaskRead)),
      record(2, taskTrackerFactsObservedEvent(operation.operationId, focusedObservation))
    ]).pipe(Effect.flip)
    expect(taskMismatch._tag).toBe("SchemaError")

    const graphForFocusedRead = yield* projectWorkflowOccurrences([
      record(1, taskTrackerReadIntent(focusedRead)),
      record(
        2,
        taskTrackerGraphFactsObserved(operation, {
          revision: TrackerRevision.make("graph-for-focused-read"),
          taskIds: []
        })
      )
    ]).pipe(Effect.flip)
    expect(graphForFocusedRead._tag).toBe("SchemaError")
  })
)

it.effect("projects a large journal without rescanning each retained prefix", () =>
  Effect.gen(function* () {
    const pairCount = 3_000
    const records = Array.from({ length: pairCount }, (_, index) => {
      const pairOperation = makeTrackerGraphObservationOperation(
        OperationId.make(`large-journal-read-${index}`),
        FixtureTarget.make("large-journal-fixture")
      )
      const intentPosition = index * 2 + 1
      return [
        record(intentPosition, taskTrackerReadIntent(pairOperation)),
        record(
          intentPosition + 1,
          taskTrackerGraphFactsObserved(pairOperation, {
            revision: TrackerRevision.make(`large-journal-revision-${index}`),
            taskIds: []
          })
        )
      ]
    }).flat()

    const projection = yield* projectWorkflowOccurrences(records)

    expect(projection.occurrences).toHaveLength(pairCount * 2)
  })
)

it.effect("does not infer a tracker-edit action from changed observed facts", () =>
  Effect.gen(function* () {
    const laterOperation = makeTrackerGraphObservationOperation(
      OperationId.make("reread-target-closure"),
      FixtureTarget.make("occurrence-fixture"),
      [operation.operationId]
    )
    const projection = yield* projectWorkflowOccurrences([
      record(1, taskTrackerReadIntent(operation)),
      record(
        2,
        taskTrackerGraphFactsObserved(operation, {
          revision: TrackerRevision.make("before-external-edit"),
          taskIds: []
        })
      ),
      record(3, taskTrackerReadIntent(laterOperation)),
      record(
        4,
        taskTrackerGraphFactsObserved(laterOperation, {
          revision: TrackerRevision.make("after-external-edit"),
          taskIds: [TaskId.make("newly-observed-task")]
        })
      )
    ])

    expect(
      projection.occurrences.filter(({ occurrenceClassification }) => occurrenceClassification === "InitiatedAction")
    ).toHaveLength(2)
    expect(projection.occurrences.filter(({ _tag }) => _tag === "TaskTrackerFactsObserved")).toHaveLength(2)
    const occurrenceTags: ReadonlyArray<string> = projection.occurrences.map(({ _tag }) => _tag)
    expect(occurrenceTags).not.toContain("TrackerFactsEdited")
  })
)

it("classifies an applied operator direction as an initiated action", () => {
  const occurrence = AppliedControlDirection.make({
    direction: "Pause",
    initiatedBy: WorkflowActor.cases.Operator.make({}),
    occurrenceClassification: "InitiatedAction",
    ordinal: ControlDirectionApplicationOrdinal.make(1),
    recordedAt: JournalPosition.make(1),
    subject: { _tag: "Task", runId, taskId: TaskId.make("paused-task") }
  })

  expect(occurrence).toMatchObject({
    _tag: "AppliedControlDirection",
    direction: "Pause",
    initiatedBy: { _tag: "Operator" },
    occurrenceClassification: "InitiatedAction"
  })
})

it.effect("projects only the applied direction and rejects unsupported operator identity", () =>
  Effect.gen(function* () {
    const appliedDirection = {
      _tag: "AppliedControlDirection",
      direction: "Pause",
      initiatedBy: { _tag: "Operator" },
      occurrenceClassification: "InitiatedAction",
      ordinal: ControlDirectionApplicationOrdinal.make(1),
      recordedAt: JournalPosition.make(1),
      operatorId: "unsupported-operator-identity",
      subject: { _tag: "Run", runId }
    }
    expect((yield* decodeWorkflowOccurrence(appliedDirection).pipe(Effect.flip))._tag).toBe("SchemaError")
    const ordinal = ControlDirectionApplicationOrdinal.make(1)
    const appliedEvent = ControlDirectionAppliedEvent.make({
      direction: "Pause",
      initiatedBy: { _tag: "Operator" },
      occurrenceClassification: "InitiatedAction",
      ordinal,
      subject: { _tag: "Run", runId },
      version: workflowJournalEventVersion
    })
    expect(
      (yield* projectWorkflowOccurrences([
        {
          event: appliedEvent,
          key: controlDirectionAppliedRecordKey(ordinal),
          position: JournalPosition.make(1),
          runId
        }
      ])).occurrences
    ).toEqual([
      {
        _tag: "AppliedControlDirection",
        direction: "Pause",
        initiatedBy: { _tag: "Operator" },
        occurrenceClassification: "InitiatedAction",
        ordinal,
        recordedAt: JournalPosition.make(1),
        subject: { _tag: "Run", runId }
      }
    ])
  })
)

it.effect("projects Alice's distinct attempt-choice and claim-reacquisition actions", () =>
  Effect.gen(function* () {
    const choiceRequestId = AttemptChoiceRequestId.make({ nonce: "occurrence-choice", runId })
    const reacquisitionRequestId = TaskClaimReacquisitionRequestId.make("occurrence-reacquire")
    const projection = yield* projectWorkflowOccurrences([
      {
        event: AttemptChoiceAppliedEvent.make({
          choice: "ContinueExistingAttempt",
          initiatedBy: { _tag: "Operator" },
          occurrenceClassification: "InitiatedAction",
          requestId: choiceRequestId,
          subject: { observedTaskRevision: TaskRevision.make("occurrence-changed-revision"), plannedAttempt },
          version: workflowJournalEventVersion
        }),
        key: attemptChoiceAppliedRecordKey(choiceRequestId),
        position: JournalPosition.make(1),
        runId
      },
      {
        event: TaskClaimReacquisitionDirectedEvent.make({
          initiatedBy: { _tag: "Operator" },
          occurrenceClassification: "InitiatedAction",
          requestId: reacquisitionRequestId,
          subject: { runId, taskId: plannedAttempt.taskId },
          version: workflowJournalEventVersion
        }),
        key: taskClaimReacquisitionDirectedRecordKey(reacquisitionRequestId),
        position: JournalPosition.make(2),
        runId
      }
    ])

    expect(projection.occurrences).toMatchObject([
      { _tag: "AppliedAttemptChoice", requestId: choiceRequestId, subject: { plannedAttempt } },
      {
        _tag: "AppliedTaskClaimReacquisitionDirection",
        requestId: reacquisitionRequestId,
        runId,
        taskId: plannedAttempt.taskId
      }
    ])
  })
)

it.effect("reconstructs after process loss without a coordinator-crash journal event", () =>
  Effect.gen(function* () {
    const retainedIntent: JournalRecord = {
      event: taskTrackerReadIntent(operation),
      key: intentRecordKey(operation.operationId),
      position: JournalPosition.make(1),
      runId
    }
    const retainedOutcome: JournalRecord = {
      event: taskTrackerGraphFactsObserved(operation, {
        revision: TrackerRevision.make("retained-prefix-revision"),
        taskIds: []
      }),
      key: outcomeRecordKey(operation.operationId),
      position: JournalPosition.make(2),
      runId
    }
    const retainedPrefixes: ReadonlyArray<ReadonlyArray<JournalRecord>> = [
      [],
      [retainedIntent],
      [retainedIntent, retainedOutcome]
    ]
    const projected = projectTrackerSnapshot({ revision: "startup-authority-reread", tasks: [] })
    const snapshot = Option.getOrThrow(
      Option.fromUndefinedOr(projected._tag === "Valid" ? projected.snapshot : undefined)
    )

    for (const prefix of retainedPrefixes) {
      const trackerReads = yield* Ref.make(0)
      const target = FixtureTarget.make("occurrence-fixture")
      const began: JournalRecord = {
        event: WorkflowRunBeganEvent.make({
          initialControlPolicy: InitialControlPolicy.make({ taskExecutionCapacity: TaskWorkCapacity.make(1) }),
          initiatedBy: { _tag: "DalphCoordinator" },
          occurrenceClassification: "InitiatedAction",
          target,
          version: workflowJournalEventVersion
        }),
        key: workflowRunBeganRecordKey,
        position: JournalPosition.make(1),
        runId
      }
      const terminalFixture = completedRunFinalityFixture({
        observedAt: JournalPosition.make(prefix.length + 1),
        runId,
        target
      })
      const terminated: JournalRecord = {
        event: WorkflowRunTerminatedEvent.make({
          disposition: "Completed",
          evidence: terminalFixture.evidence,
          occurrenceClassification: "NonActionOccurrence",
          version: workflowJournalEventVersion
        }),
        key: workflowRunTerminatedRecordKey,
        position: JournalPosition.make(prefix.length + 2),
        runId
      }
      const interpreter = WorkflowInterpreter.of({
        acquireTaskClaim: () => Effect.die("startup authority reread must not reach task claiming"),
        readTaskClaim: () => Effect.die("unexpected task claim read"),
        readTaskWorktree: () => Effect.die("unused worktree observation"),
        readTargetLineage: () => Effect.die("unused target-lineage observation"),
        readTrackerGraph: () => Ref.update(trackerReads, (count) => count + 1).pipe(Effect.as(snapshot)),
        readTaskWorkSpecification: () => Effect.die("startup must not read task-work specifications"),
        reconcileTaskWorktree: () => Effect.die("startup authority reread must not reach Git"),
        recordTaskAttemptPlan: () => Effect.die("startup authority reread must not reach attempt planning"),
        releaseTaskClaim: () => Effect.die("startup authority reread must not release a tracker claim")
      })
      const records = yield* Ref.make(prefix)
      const journal = JournalStore.of({
        append: (recordRunId, key, event) =>
          Ref.modify(records, (current) => {
            const existing = current.find((record) => record.key === key)
            if (existing !== undefined) return [existing, current] as const
            const record = {
              event,
              key,
              position: JournalPosition.make(current.length + 1),
              runId: recordRunId
            } satisfies JournalRecord
            return [record, [...current, record]] as const
          }),
        beginRun: () => Effect.die("recovery must not begin the Run again"),
        read: () => Ref.get(records),
        readRunForRecovery: () => Effect.succeed(began),
        scanHot: () => Effect.die("startup authority reread must not scan"),
        auditAll: () => Effect.die("startup authority reread must not audit"),
        retireTerminalRun: () => Effect.die("startup authority reread must not retire"),
        terminateRun: () => Effect.succeed(terminated)
      })
      const startupLayer = Layer.mergeAll(
        Layer.succeed(InRunJournal, InRunJournal.of({ append: journal.append, read: journal.read })),
        Layer.succeed(WorkflowInterpreter, interpreter),
        Layer.succeed(WorkflowTrace, WorkflowTrace.of({ emit: () => Effect.void })),
        controlledFakePlannedAttemptExecutorLayer
      )
      const recovery = yield* makeRunRecoveryProjection(runId).pipe(Effect.provide(startupLayer))
      const journalLayer = Layer.succeed(InRunJournal, InRunJournal.of({ append: journal.append, read: journal.read }))
      const workflowLayer = Layer.mergeAll(
        journalLayer,
        Layer.succeed(
          RunLifecycleJournal,
          RunLifecycleJournal.of({
            beginRun: journal.beginRun,
            read: journal.read,
            readRunForRecovery: journal.readRunForRecovery,
            scanHot: journal.scanHot,
            auditAll: journal.auditAll,
            retireTerminalRun: journal.retireTerminalRun,
            terminateRun: journal.terminateRun
          })
        ),
        Layer.succeed(RunRecoveryProjection, recovery),
        journaledWorkflowInterpreterLayer(runId, Layer.succeed(WorkflowInterpreter, interpreter)).pipe(
          Layer.provide(journalLayer)
        ),
        Layer.succeed(WorkflowTrace, WorkflowTrace.of({ emit: () => Effect.void })),
        Layer.succeed(
          TaskWorkCapacityControl,
          TaskWorkCapacityControl.of({
            apply: () => Effect.die("recovery startup does not apply capacity"),
            read: () =>
              Effect.succeed(
                RunControlPolicy.make({
                  revision: initialRunPolicyRevision,
                  taskExecutionCapacity: TaskWorkCapacity.make(1)
                })
              )
          })
        ),
        Layer.succeed(
          OperationIdAllocator,
          OperationIdAllocator.of({ allocate: () => Effect.succeed(OperationId.make("startup-reread")) })
        ),
        Layer.succeed(
          TaskClaimAcquisitionPlanner,
          TaskClaimAcquisitionPlanner.of({ plan: () => Effect.die("no eligible startup task") })
        ),
        Layer.succeed(
          PlannedTaskAttemptPlanner,
          PlannedTaskAttemptPlanner.of({ plan: () => Effect.die("no eligible startup task") })
        )
      )
      yield* interpreter.readTrackerGraph(operation).pipe(Effect.provide(workflowLayer))
      expect(yield* Ref.get(trackerReads)).toBe(1)
    }

    const projection = yield* projectWorkflowOccurrences([retainedIntent])
    expect(projection.occurrences.map(({ _tag }) => _tag)).toEqual(["TaskTrackerReadInitiated"])
    expect(projection.occurrences.map(({ _tag }) => _tag)).not.toContain("CoordinatorCrashed")
  })
)

it.effect("rejects a synthetic coordinator-crash row from the workflow journal union", () =>
  Effect.gen(function* () {
    const failure = yield* Schema.decodeUnknownEffect(WorkflowJournalEvent)({
      _tag: "CoordinatorCrashed",
      version: workflowJournalEventVersion
    }).pipe(Effect.flip)

    expect(failure._tag).toBe("SchemaError")
  })
)

it.effect("generic occurrence consumer renders every runtime classification without event-name mapping", () =>
  Effect.gen(function* () {
    const projection = yield* projectWorkflowOccurrences([
      record(1, taskTrackerReadIntent(operation)),
      record(
        2,
        taskTrackerGraphFactsObserved(operation, {
          revision: TrackerRevision.make("generic-consumer-revision"),
          taskIds: []
        })
      )
    ])
    const appliedDirection = AppliedControlDirection.make({
      direction: "Unpause",
      initiatedBy: WorkflowActor.cases.Operator.make({}),
      occurrenceClassification: "InitiatedAction",
      ordinal: ControlDirectionApplicationOrdinal.make(1),
      recordedAt: JournalPosition.make(1),
      subject: { _tag: "Run", runId }
    })

    expect([...projection.occurrences, appliedDirection].map(presentWorkflowOccurrence)).toEqual([
      { actor: "DalphCoordinator", classification: "InitiatedAction" },
      { classification: "NonActionOccurrence" },
      { actor: "Operator", classification: "InitiatedAction" }
    ])
  })
)

it.effect("presents only the proven actor and keeps executor or Integrator details opaque", () =>
  Effect.gen(function* () {
    const projection = yield* projectWorkflowOccurrences([
      record(1, taskTrackerReadIntent(operation)),
      record(
        2,
        taskTrackerGraphFactsObserved(operation, {
          revision: TrackerRevision.make("truthful-presentation-revision"),
          taskIds: []
        })
      )
    ])
    const initiated = projection.occurrences[0]
    const observed = projection.occurrences[1]
    if (initiated === undefined || observed === undefined) return yield* Effect.die("presentation fixture is empty")

    expect(describeWorkflowOccurrence(initiated)).toEqual({
      actorLabel: "Dalph coordinator",
      presentation: { actor: "DalphCoordinator", classification: "InitiatedAction" },
      text: "Dalph coordinator initiated tracker read"
    })
    expect(describeWorkflowOccurrence(observed)).toEqual({
      actorLabel: "no actor is proven",
      presentation: { classification: "NonActionOccurrence" },
      text: "tracker facts observed; no actor is proven"
    })
    const operatorAction = AppliedControlDirection.make({
      direction: "Unpause",
      initiatedBy: WorkflowActor.cases.Operator.make({}),
      occurrenceClassification: "InitiatedAction",
      ordinal: ControlDirectionApplicationOrdinal.make(1),
      recordedAt: JournalPosition.make(1),
      subject: { _tag: "Run", runId }
    })
    expect(describeWorkflowOccurrence(operatorAction)).toEqual({
      actorLabel: "Operator",
      presentation: { actor: "Operator", classification: "InitiatedAction" },
      text: "Operator initiated control direction"
    })
    expect(describeWorkflowOccurrence(initiated).text).not.toMatch(/(?:session|turn|transcript)/iu)

    const responsibility = PlannedAttemptExecutorWorkResponsibilityBegan.make({
      initiatedBy: WorkflowActor.cases.DalphCoordinator.make({}),
      occurrenceClassification: "InitiatedAction",
      plannedAttempt,
      recordedAt: JournalPosition.make(3),
      runId
    })
    expect(describeWorkflowOccurrence(responsibility).text).toBe(
      "Dalph coordinator initiated coordinator responsibility record"
    )
    expect(describeWorkflowOccurrence(responsibility).text).not.toContain("executor activity")

    const report = PlannedAttemptExecutorWorkReported.make({
      occurrenceClassification: "NonActionOccurrence",
      ordinal: PlannedAttemptExecutorReportOrdinal.make(1),
      recordedAt: JournalPosition.make(4),
      report: PlannedAttemptExecutorReport.cases.ExecutorWorkExecuting.make({
        correlation: plannedAttemptExecutorCorrelation(plannedAttempt)
      }),
      runId
    })
    expect(describeWorkflowOccurrence(report)).toMatchObject({
      actorLabel: "no actor is proven",
      text: "executor report observed; no actor is proven"
    })
  })
)

it.effect("schema round-trip tests preserve classification and typed relationships", () =>
  Effect.gen(function* () {
    const projection = yield* projectWorkflowOccurrences([
      record(1, taskTrackerReadIntent(operation)),
      record(
        2,
        taskTrackerGraphFactsObserved(operation, { revision: TrackerRevision.make("round-trip-revision"), taskIds: [] })
      )
    ])

    const encoded = yield* Schema.encodeUnknownEffect(WorkflowOccurrenceProjection)(projection)
    const decoded = yield* Schema.decodeUnknownEffect(WorkflowOccurrenceProjection, { onExcessProperty: "error" })(
      encoded
    )

    expect(decoded).toEqual(projection)
    const observation = decoded.occurrences.find(({ _tag }) => _tag === "TaskTrackerFactsObserved")
    if (observation?._tag !== "TaskTrackerFactsObserved") {
      throw new Error("expected round-tripped tracker observation")
    }
    expect(Option.isSome(originatingActionForTrackerObservation(decoded, observation))).toBe(true)
  })
)

it.effect("rejects the pre-change occurrence projection version", () =>
  Effect.gen(function* () {
    const issue = yield* Schema.decodeUnknownEffect(WorkflowOccurrenceProjection)({
      occurrences: [],
      version: workflowOccurrenceProjectionVersion - 1
    }).pipe(Effect.flip)
    expect(issue._tag).toBe("SchemaError")
  })
)

it.effect("rejects an observation whose exact initiating action is absent, later, or ambiguous", () =>
  Effect.gen(function* () {
    const valid = yield* projectWorkflowOccurrences([
      record(1, taskTrackerReadIntent(operation)),
      record(
        2,
        taskTrackerGraphFactsObserved(operation, {
          revision: TrackerRevision.make("unrelated-observation-revision"),
          taskIds: []
        })
      )
    ])
    const observation = valid.occurrences.find(({ _tag }) => _tag === "TaskTrackerFactsObserved")
    if (observation?._tag !== "TaskTrackerFactsObserved") throw new Error("expected a tracker observation")

    const action = valid.occurrences.find(({ _tag }) => _tag === "TaskTrackerReadInitiated")
    if (action?._tag !== "TaskTrackerReadInitiated") throw new Error("expected a tracker action")
    const laterDurableAction = { ...action, recordedAt: JournalPosition.make(observation.recordedAt + 1) }
    const mismatchedEvidence = {
      ...observation,
      evidence: { ...observation.evidence, target: FixtureTarget.make("different-target") }
    }
    const mismatchedOperation = {
      ...observation,
      originatingActionOperationId: OperationId.make("different-operation")
    }
    const invalidOccurrenceOrders = [
      [observation],
      [observation, action],
      [action, action, observation],
      [laterDurableAction, observation],
      [action, mismatchedEvidence],
      [action, mismatchedOperation]
    ]
    for (const occurrences of invalidOccurrenceOrders) {
      const failure = yield* Schema.decodeUnknownEffect(WorkflowOccurrenceProjection)({
        occurrences,
        version: valid.version
      }).pipe(Effect.flip)
      expect(failure._tag).toBe("SchemaError")
    }

    const otherRunOutcome = {
      ...record(
        2,
        taskTrackerGraphFactsObserved(operation, {
          revision: TrackerRevision.make("cross-run-observation"),
          taskIds: []
        })
      ),
      runId: RunId.make("different-run")
    }
    const crossRunFailure = yield* projectWorkflowOccurrences([
      record(1, taskTrackerReadIntent(operation)),
      otherRunOutcome
    ]).pipe(Effect.flip)
    expect(crossRunFailure).toMatchObject({
      _tag: "TrackerOutcomeWithoutReadIntent",
      operationId: operation.operationId,
      runId: otherRunOutcome.runId
    })
  })
)

it.effect("rejects a Restart read failure without one exact earlier authority read", () =>
  Effect.gen(function* () {
    const restartRead = makeTrackerGraphObservationOperation(
      OperationId.make("restart-authority-read"),
      operation.target,
      [],
      [plannedAttempt.taskId]
    )
    const requestId = AttemptChoiceRequestId.make({ nonce: "restart-authority-failure", runId })
    const subject = { observedTaskRevision: TaskRevision.make("occurrence-revision-changed"), plannedAttempt }
    const projection = yield* projectWorkflowOccurrences([
      record(
        1,
        AttemptChoiceAppliedEvent.make({
          choice: "RestartTaskImplementation",
          initiatedBy: { _tag: "Operator" },
          occurrenceClassification: "InitiatedAction",
          requestId,
          subject,
          version: workflowJournalEventVersion
        })
      ),
      record(2, taskTrackerReadIntent(restartRead)),
      record(
        3,
        AttemptRestartAuthorityReadFailedEvent.make({
          failure: AttemptRestartTaskFactsReadFailure.make({
            detail: "tracker unavailable",
            source: "FixtureReader.FixtureReadError",
            target: restartRead.target
          }),
          occurrenceClassification: "NonActionOccurrence",
          operationId: restartRead.operationId,
          requestId,
          subject,
          version: workflowJournalEventVersion
        })
      )
    ])
    const action = projection.occurrences.find(({ _tag }) => _tag === "TaskTrackerReadInitiated")
    const applied = projection.occurrences.find(({ _tag }) => _tag === "AppliedAttemptChoice")
    const failure = projection.occurrences.find(({ _tag }) => _tag === "AttemptRestartAuthorityReadFailed")
    if (
      action?._tag !== "TaskTrackerReadInitiated" ||
      applied?._tag !== "AppliedAttemptChoice" ||
      failure?._tag !== "AttemptRestartAuthorityReadFailed"
    ) {
      return expect.fail("expected applied Restart, read action, and failure")
    }
    const laterAction = { ...action, recordedAt: JournalPosition.make(failure.recordedAt + 1) }
    const laterApplied = { ...applied, recordedAt: JournalPosition.make(failure.recordedAt + 1) }
    const wrongTarget = {
      ...failure,
      failure: AttemptRestartTaskFactsReadFailure.make({
        detail: "tracker unavailable",
        source: "FixtureReader.FixtureReadError",
        target: FixtureTarget.make("other-restart-target")
      })
    }
    const wrongRun = {
      ...failure,
      requestId: AttemptChoiceRequestId.make({ nonce: requestId.nonce, runId: RunId.make("other-run") })
    }
    const wrongApplied = { ...applied, requestId: AttemptChoiceRequestId.make({ nonce: "another-restart", runId }) }
    for (const occurrences of [
      [failure],
      [failure, applied, action],
      [laterApplied, failure],
      [applied, laterAction, failure],
      [applied, action, action, failure],
      [applied, action, wrongTarget],
      [applied, action, wrongRun],
      [wrongApplied, action, failure]
    ]) {
      const schemaFailure = yield* Schema.decodeUnknownEffect(WorkflowOccurrenceProjection)({
        occurrences,
        version: projection.version
      }).pipe(Effect.flip)
      expect(schemaFailure._tag).toBe("SchemaError")
    }
  })
)

it.effect("accepts specification Restart failures only from the exact focused read", () =>
  Effect.gen(function* () {
    const requestId = AttemptChoiceRequestId.make({ nonce: "restart-specification-failure", runId })
    const subject = { observedTaskRevision: TaskRevision.make("occurrence-specification-revision"), plannedAttempt }
    const applied = record(
      1,
      AttemptChoiceAppliedEvent.make({
        choice: "RestartTaskImplementation",
        initiatedBy: { _tag: "Operator" },
        occurrenceClassification: "InitiatedAction",
        requestId,
        subject,
        version: workflowJournalEventVersion
      })
    )
    const specificationRead = makeTaskWorkSpecificationObservationOperation(
      OperationId.make("restart-specification-failure-read"),
      operation.target,
      plannedAttempt.taskId
    )
    const failure = AttemptRestartAuthorityReadFailedEvent.make({
      failure: AttemptRestartTaskFactsReadFailure.make({
        detail: "specification unavailable",
        source: "FixtureReader.FixtureReadError",
        target: specificationRead.target
      }),
      occurrenceClassification: "NonActionOccurrence",
      operationId: specificationRead.operationId,
      requestId,
      subject,
      version: workflowJournalEventVersion
    })
    const projection = yield* projectWorkflowOccurrences([
      applied,
      record(2, taskTrackerReadIntent(specificationRead)),
      record(3, failure)
    ])
    expect(projection.occurrences).toContainEqual(
      expect.objectContaining({
        _tag: "AttemptRestartAuthorityReadFailed",
        originatingActionOperationId: specificationRead.operationId
      })
    )

    const uncoveredGraph = makeTrackerGraphObservationOperation(
      OperationId.make("restart-specification-failure-uncovered-graph"),
      operation.target,
      [],
      []
    )
    const rejected = yield* projectWorkflowOccurrences([
      applied,
      record(2, taskTrackerReadIntent(uncoveredGraph)),
      record(
        3,
        AttemptRestartAuthorityReadFailedEvent.make({
          ...failure,
          operationId: uncoveredGraph.operationId,
          failure: AttemptRestartTaskFactsReadFailure.make({
            detail: "graph unavailable",
            source: "FixtureReader.FixtureReadError",
            target: uncoveredGraph.target
          })
        })
      )
    ]).pipe(Effect.flip)
    expect(rejected).toMatchObject({ _tag: "TrackerOutcomeWithoutReadIntent", operationId: uncoveredGraph.operationId })
  })
)

it.effect("projects exact Git Restart failures and follows target-lineage observations", () =>
  Effect.gen(function* () {
    const requestId = AttemptChoiceRequestId.make({ nonce: "restart-git-failures", runId })
    const subject = { observedTaskRevision: TaskRevision.make("occurrence-git-revision"), plannedAttempt }
    const worktreeRead = makeTaskWorktreeObservationOperation({
      operationId: OperationId.make("restart-worktree-failure-read"),
      plannedAttempt,
      predecessorOperationIds: []
    })
    const targetRead = makeTargetLineageObservationOperation({
      integrationTarget,
      operationId: OperationId.make("restart-target-failure-read"),
      plannedAttempt,
      predecessorOperationIds: []
    })
    const applied = record(
      1,
      AttemptChoiceAppliedEvent.make({
        choice: "RestartTaskImplementation",
        initiatedBy: { _tag: "Operator" },
        occurrenceClassification: "InitiatedAction",
        requestId,
        subject,
        version: workflowJournalEventVersion
      })
    )
    const projection = yield* projectWorkflowOccurrences([
      applied,
      record(
        2,
        GitReadIntentRecordedEvent.make({
          initiatedBy: { _tag: "DalphCoordinator" },
          occurrenceClassification: "InitiatedAction",
          operation: worktreeRead,
          version: workflowJournalEventVersion
        })
      ),
      record(
        3,
        AttemptRestartAuthorityReadFailedEvent.make({
          failure: new GitWorktreeReadFailure({ detail: "worktree unavailable", worktree: plannedAttempt.worktree }),
          occurrenceClassification: "NonActionOccurrence",
          operationId: worktreeRead.operationId,
          requestId,
          subject,
          version: workflowJournalEventVersion
        })
      ),
      record(
        4,
        GitReadIntentRecordedEvent.make({
          initiatedBy: { _tag: "DalphCoordinator" },
          occurrenceClassification: "InitiatedAction",
          operation: targetRead,
          version: workflowJournalEventVersion
        })
      ),
      record(
        5,
        AttemptRestartAuthorityReadFailedEvent.make({
          failure: new GitTargetLineageReadFailure({
            detail: "target lineage unavailable",
            plannedBaseSha: plannedAttempt.baseSha,
            target: integrationTarget
          }),
          occurrenceClassification: "NonActionOccurrence",
          operationId: targetRead.operationId,
          requestId,
          subject,
          version: workflowJournalEventVersion
        })
      )
    ])

    const targetFailure = projection.occurrences.find(
      (occurrence) =>
        occurrence._tag === "AttemptRestartAuthorityReadFailed" &&
        occurrence.failure._tag === "GitTargetLineageReadFailure"
    )
    const targetAction = projection.occurrences.find(
      (occurrence) =>
        occurrence._tag === "GitReadInitiated" && occurrence.operation.operationId === targetRead.operationId
    )
    const appliedOccurrence = projection.occurrences.find((occurrence) => occurrence._tag === "AppliedAttemptChoice")
    if (
      targetFailure?._tag !== "AttemptRestartAuthorityReadFailed" ||
      targetFailure.failure._tag !== "GitTargetLineageReadFailure" ||
      targetAction?._tag !== "GitReadInitiated" ||
      appliedOccurrence?._tag !== "AppliedAttemptChoice"
    ) {
      return expect.fail("expected applied Restart, target read, and target-lineage failure")
    }
    expect(targetFailure.failure.target).toEqual(integrationTarget)

    const targetObservation = yield* projectWorkflowOccurrences([
      record(
        1,
        GitReadIntentRecordedEvent.make({
          initiatedBy: { _tag: "DalphCoordinator" },
          occurrenceClassification: "InitiatedAction",
          operation: targetRead,
          version: workflowJournalEventVersion
        })
      ),
      record(
        2,
        TargetLineageObservedEvent.make({
          observation: {
            plannedBaseIsAncestorOfTargetHead: true,
            plannedBaseSha: plannedAttempt.baseSha,
            targetHeadSha: GitCommitSha.make("4".repeat(40))
          },
          occurrenceClassification: "NonActionOccurrence",
          operationId: targetRead.operationId,
          plannedAttempt,
          version: workflowJournalEventVersion
        })
      )
    ])
    const observed = targetObservation.occurrences.find((occurrence) => occurrence._tag === "TargetLineageObserved")
    if (observed?._tag !== "TargetLineageObserved") return expect.fail("expected target-lineage observation")
    expect(Option.getOrThrow(originatingActionForTargetLineageObservation(targetObservation, observed))).toMatchObject({
      _tag: "GitReadInitiated",
      operation: { operationId: targetRead.operationId }
    })

    const unmatchedFailure = yield* projectWorkflowOccurrences([
      applied,
      record(
        2,
        AttemptRestartAuthorityReadFailedEvent.make({
          failure: new GitTargetLineageReadFailure({
            detail: "target lineage unavailable",
            plannedBaseSha: plannedAttempt.baseSha,
            target: integrationTarget
          }),
          occurrenceClassification: "NonActionOccurrence",
          operationId: OperationId.make("missing-target-failure-read"),
          requestId,
          subject,
          version: workflowJournalEventVersion
        })
      )
    ]).pipe(Effect.flip)
    expect(unmatchedFailure).toMatchObject({
      _tag: "GitOutcomeWithoutReadIntent",
      operationId: "missing-target-failure-read",
      position: 2,
      runId
    })

    const laterAction = { ...targetAction, recordedAt: JournalPosition.make(targetFailure.recordedAt + 1) }
    const mismatchedOperation = {
      ...targetFailure,
      originatingActionOperationId: OperationId.make("different-target-failure-operation")
    }
    const mismatchedTarget = {
      ...targetFailure,
      failure: new GitTargetLineageReadFailure({
        detail: "target lineage unavailable",
        plannedBaseSha: plannedAttempt.baseSha,
        target: IntegrationTarget.make({
          repository: GitRepositoryLocator.make("/other/repository.git"),
          ref: integrationTarget.ref
        })
      })
    }
    for (const occurrences of [
      [appliedOccurrence, targetFailure],
      [appliedOccurrence, targetAction, targetAction, targetFailure],
      [appliedOccurrence, laterAction, targetFailure],
      [appliedOccurrence, targetAction, mismatchedOperation],
      [appliedOccurrence, targetAction, mismatchedTarget]
    ]) {
      const schemaFailure = yield* Schema.decodeUnknownEffect(WorkflowOccurrenceProjection)({
        occurrences,
        version: projection.version
      }).pipe(Effect.flip)
      expect(schemaFailure._tag).toBe("SchemaError")
    }
  })
)

it.effect("projects an atomic replacement occurrence while ignoring lifecycle rows", () =>
  Effect.gen(function* () {
    const successor = PlannedTaskAttempt.make({
      ...plannedAttempt,
      attemptId: AttemptId.make("occurrence-successor-attempt"),
      baseSha: GitCommitSha.make("b".repeat(40)),
      branch: TaskBranchRef.make("refs/heads/dalph/occurrence-successor"),
      taskRevision: TaskRevision.make("occurrence-successor-revision"),
      worktree: WorktreeLocator.make("/worktrees/occurrence-successor")
    })
    const requestId = AttemptChoiceRequestId.make({ nonce: "occurrence-replacement", runId })
    const subject = { observedTaskRevision: successor.taskRevision, plannedAttempt }
    const expectedClaim = ActiveTaskClaim.make({
      operationId: OperationId.make("occurrence-replacement-claim"),
      owner: ClaimOwner.make("dalph"),
      taskId: plannedAttempt.taskId,
      token: ClaimToken.make("occurrence-replacement-token")
    })
    const graphRead = makeTrackerGraphObservationOperation(
      OperationId.make("occurrence-replacement-graph"),
      operation.target,
      [],
      [plannedAttempt.taskId]
    )
    const specificationRead = makeTaskWorkSpecificationObservationOperation(
      OperationId.make("occurrence-replacement-specification"),
      operation.target,
      plannedAttempt.taskId
    )
    const claimRead = makeTaskClaimObservationOperation(
      OperationId.make("occurrence-replacement-claim-read"),
      operation.target,
      plannedAttempt.taskId
    )
    const worktreeRead = makeTaskWorktreeObservationOperation({
      operationId: OperationId.make("occurrence-replacement-worktree"),
      plannedAttempt,
      predecessorOperationIds: []
    })
    const targetRead = makeTargetLineageObservationOperation({
      integrationTarget,
      operationId: OperationId.make("occurrence-replacement-target"),
      plannedAttempt,
      predecessorOperationIds: []
    })
    const witness = PlannedAttemptReplacementWitness.make({
      claimObservationOperationId: claimRead.operationId,
      expectedClaim,
      graphObservationOperationId: graphRead.operationId,
      oldWorktreeObservationOperationId: worktreeRead.operationId,
      oldWorktreeProof: PlannedWorktreeReady.make({
        baseSha: plannedAttempt.baseSha,
        branch: plannedAttempt.branch,
        headSha: plannedAttempt.baseSha,
        worktree: plannedAttempt.worktree
      }),
      quiescenceProof: { _tag: "AcceptedReport", reportOrdinal: PlannedAttemptExecutorReportOrdinal.make(1) },
      specificationObservationOperationId: specificationRead.operationId,
      targetHeadSha: successor.baseSha,
      targetLineageObservationOperationId: targetRead.operationId
    })
    const successorPlan = makeTaskAttemptPlanOperation({
      operationId: OperationId.make("occurrence-replacement-plan"),
      plannedAttempt: successor,
      predecessorOperationIds: [
        expectedClaim.operationId,
        graphRead.operationId,
        specificationRead.operationId,
        claimRead.operationId,
        worktreeRead.operationId,
        targetRead.operationId
      ]
    })
    const applied = AttemptChoiceAppliedEvent.make({
      choice: "RestartTaskImplementation",
      initiatedBy: { _tag: "Operator" },
      occurrenceClassification: "InitiatedAction",
      requestId,
      subject,
      version: workflowJournalEventVersion
    })
    const replacement = PlannedAttemptReplacedEvent.make({
      initiatedBy: { _tag: "DalphCoordinator" },
      occurrenceClassification: "InitiatedAction",
      requestId,
      subject,
      successorPlan,
      version: workflowJournalEventVersion,
      witness
    })
    const projection = yield* projectWorkflowOccurrences([
      record(
        1,
        WorkflowRunBeganEvent.make({
          initialControlPolicy: InitialControlPolicy.make({ taskExecutionCapacity: TaskWorkCapacity.make(1) }),
          initiatedBy: { _tag: "DalphCoordinator" },
          occurrenceClassification: "InitiatedAction",
          target: operation.target,
          version: workflowJournalEventVersion
        })
      ),
      record(2, applied),
      record(3, replacement)
    ])

    expect(projection.occurrences.map(({ _tag }) => _tag)).toEqual(["AppliedAttemptChoice", "PlannedAttemptReplaced"])
    expect(projection.occurrences.at(1)).toMatchObject({ _tag: "PlannedAttemptReplaced", successorPlan, witness })
    const replacementOccurrence = projection.occurrences.find(({ _tag }) => _tag === "PlannedAttemptReplaced")
    if (replacementOccurrence?._tag !== "PlannedAttemptReplaced") {
      return yield* Effect.die("expected replacement occurrence")
    }
    const missingChoice = yield* Schema.decodeUnknownEffect(WorkflowOccurrenceProjection)({
      occurrences: [replacementOccurrence],
      version: projection.version
    }).pipe(Effect.flip)
    expect(missingChoice._tag).toBe("SchemaError")
  })
)

it.effect("projects the historical #81 preservation variants and the #82 successor session", () =>
  Effect.gen(function* () {
    const fixture = integrationFinalityFixture
    const requestId = AttemptChoiceRequestId.make({ nonce: "historical-preservation", runId: fixture.runId })
    const subject = {
      observedTaskRevision: TaskRevision.make("historical-observed-revision"),
      plannedAttempt: fixture.plannedAttempt
    }
    const preservationRecords = [
      historicalRecord(
        1,
        AttemptStoppageIntendedEvent.make({
          initiatedBy: WorkflowActor.cases.DalphCoordinator.make({}),
          occurrenceClassification: "InitiatedAction",
          requestId,
          subject,
          version: workflowJournalEventVersion
        })
      ),
      historicalRecord(
        2,
        AttemptImplementationAbandonedEvent.make({
          expectedClaim: fixture.activeClaim,
          initiatedBy: WorkflowActor.cases.DalphCoordinator.make({}),
          occurrenceClassification: "InitiatedAction",
          proof: { _tag: "AcceptedReport", reportOrdinal: PlannedAttemptExecutorReportOrdinal.make(1) },
          requestId,
          subject,
          version: workflowJournalEventVersion
        })
      ),
      historicalRecord(
        3,
        StoppedAttemptClaimNoReleaseObservedEvent.make({
          expectedClaim: fixture.activeClaim,
          observation: UnclaimedTask.make({ taskId: fixture.plannedAttempt.taskId }),
          observationOperationId: OperationId.make("historical-preservation-claim-read"),
          occurrenceClassification: "NonActionOccurrence",
          requestId,
          subject,
          version: workflowJournalEventVersion
        })
      )
    ]
    const preservation = yield* projectWorkflowOccurrences(preservationRecords)
    expect(preservation.occurrences.map(({ _tag }) => _tag)).toEqual([
      "AttemptStoppageIntended",
      "AttemptImplementationAbandoned",
      "StoppedAttemptClaimPreserved"
    ])

    const prefix = historicalIntegrationPrefix()
    const predecessorSession = prefix.integratorRun.session
    const quarantineBasis = IntegrationQuarantineBasis.cases.ProviderRunFailure.make({
      detail: IntegrationQuarantineFailureDetail.make("historical successor provider absence"),
      ownedActivityProvenAbsentAt: JournalPosition.make(11)
    })
    const quarantine = IntegrationQuarantinedEvent.make({
      basis: quarantineBasis,
      correlation: predecessorSession,
      occurrenceClassification: "NonActionOccurrence",
      version: workflowJournalEventVersion
    })
    const directionFingerprint = IntegrationQuarantineDirectionFingerprint.make({
      direction: "FullRerun",
      quarantineAt: JournalPosition.make(11),
      sessionId: predecessorSession.sessionId
    })
    const direction = IntegrationQuarantineDirectionAppliedEvent.make({
      fingerprint: directionFingerprint,
      initiatedBy: WorkflowActor.cases.Operator.make({}),
      occurrenceClassification: "InitiatedAction",
      requestId: IntegrationQuarantineDirectionRequestId.make({ nonce: "historical-successor", runId: fixture.runId }),
      version: workflowJournalEventVersion
    })
    const successorSession = IntegratorSessionCorrelation.make({
      ...predecessorSession,
      candidateResource: IntegratorCandidateResourceLocator.make("historical-successor-resource"),
      sessionId: IntegratorSessionId.make("historical-successor-session"),
      targetLineageObservedAt: JournalPosition.make(14)
    })
    const successor = IntegratorSuccessorSessionFixedEvent.make({
      direction: "FullRerun",
      directionAppliedAt: JournalPosition.make(12),
      predecessor: predecessorSession,
      quarantineAt: JournalPosition.make(11),
      successor: successorSession,
      successorGeneration: firstFullRerunSuccessorGeneration,
      version: workflowJournalEventVersion
    })
    const successorRun = IntegratorRunCorrelation.make({
      ordinal: IntegratorRunOrdinal.make(1),
      session: successorSession
    })
    const successorProjection = yield* projectWorkflowOccurrences([
      ...prefix.records,
      historicalRecord(11, quarantine),
      historicalRecord(12, direction),
      historicalRecord(13, successor),
      historicalRecord(15, IntegratorRunStartedEvent.make({ run: successorRun, version: workflowJournalEventVersion }))
    ])
    expect(successorProjection.occurrences).toContainEqual(
      expect.objectContaining({
        _tag: "IntegratorSuccessorSessionFixed",
        predecessor: predecessorSession,
        successor: successorSession
      })
    )
    expect(successorProjection.occurrences.at(-1)).toMatchObject({ _tag: "IntegratorRunStarted", run: successorRun })
  })
)

it.effect("projects every historical boundary and finality event family", () =>
  Effect.gen(function* () {
    const fixture = integrationFinalityFixture
    const session = fixture.qualifiedCandidate.run.session
    const run = fixture.qualifiedCandidate.run
    const basis = IntegrationQuarantineBasis.cases.ProviderRunFailure.make({
      detail: IntegrationQuarantineFailureDetail.make("historical boundary provider absence"),
      ownedActivityProvenAbsentAt: JournalPosition.make(1)
    })
    const directionFingerprint = IntegrationQuarantineDirectionFingerprint.make({
      direction: "Retry",
      quarantineAt: JournalPosition.make(1),
      sessionId: session.sessionId
    })
    const replacementOperationId = OperationId.make("historical-finality-replacement")
    const deletionOperationId = OperationId.make("historical-finality-deletion")
    const events: ReadonlyArray<JournalRecord["event"]> = [
      IntegrationProviderRunActivityAbsentEvent.make({
        correlation: session,
        detail: IntegrationQuarantineFailureDetail.make("provider activity absent"),
        occurrenceClassification: "NonActionOccurrence",
        run,
        version: workflowJournalEventVersion
      }),
      IntegrationQuarantinedEvent.make({
        basis,
        correlation: session,
        occurrenceClassification: "NonActionOccurrence",
        version: workflowJournalEventVersion
      }),
      IntegrationQuarantineDirectionAppliedEvent.make({
        fingerprint: directionFingerprint,
        initiatedBy: WorkflowActor.cases.Operator.make({}),
        occurrenceClassification: "InitiatedAction",
        requestId: IntegrationQuarantineDirectionRequestId.make({ nonce: "historical-boundary", runId: fixture.runId }),
        version: workflowJournalEventVersion
      }),
      CompletionTaskIntendedEvent.make({ request: fixture.completionRequest, version: workflowJournalEventVersion }),
      CompletionClaimReplacementIntendedEvent.make({
        claim: fixture.claim,
        operationId: replacementOperationId,
        version: workflowJournalEventVersion
      }),
      CompletionClaimDeletionIntendedEvent.make({
        claim: fixture.claim,
        operationId: deletionOperationId,
        successObservation: fixture.successObservation,
        version: workflowJournalEventVersion
      }),
      IntegrationFinalitySettledEvent.make({
        claim: fixture.claim,
        deletionOperationId,
        replacementOperationId,
        successObservation: fixture.successObservation,
        version: workflowJournalEventVersion
      })
    ]
    const projection = yield* projectWorkflowOccurrences(
      events.map((event, index) => historicalRecord(index + 1, event))
    )
    expect(projection.occurrences.map(({ _tag }) => _tag)).toEqual([
      "IntegrationProviderRunActivityAbsent",
      "IntegrationQuarantined",
      "IntegrationQuarantineDirectionApplied",
      "IntegrationFocusedCompletionOccurred",
      "IntegrationClaimReplacementOccurred",
      "IntegrationClaimDeletionOccurred",
      "IntegrationFinalitySettledOccurred"
    ])
  })
)

it.effect("projects valid historical worktree and promotion terminal outcomes", () =>
  Effect.gen(function* () {
    const fixture = integrationFinalityFixture
    const worktree = yield* projectWorkflowOccurrences([
      historicalRecord(
        1,
        TaskAttemptPlannedEvent.make({ operation: fixture.planOperation, version: workflowJournalEventVersion })
      )
    ])
    expect(worktree.occurrences.map(({ _tag }) => _tag)).toEqual(["TaskAttemptPlanned"])

    const prefix = historicalIntegrationPrefix()
    const intent = TargetPromotionIntendedEvent.make({
      correlation: prefix.promotionCorrelation,
      version: workflowJournalEventVersion
    })
    const attempt = TargetPromotionAttemptIntendedEvent.make({
      attemptOrdinal: TargetPromotionAttemptOrdinal.make(1),
      correlation: prefix.promotionCorrelation,
      reason: { _tag: "Initial", observedHeadSha: prefix.integratorRun.session.expectedTargetHead },
      version: workflowJournalEventVersion
    })
    const success = TargetPromotionObservedSuccessEvent.make({
      basis: { _tag: "AfterAttempt", attemptOrdinal: TargetPromotionAttemptOrdinal.make(1) },
      correlation: prefix.promotionCorrelation,
      observation: TargetPromotionSuccessObservation.cases.CompareAndSetApplied.make({
        candidateAncestry: "Current",
        targetHeadSha: prefix.qualifiedCandidate.candidateCommit
      }),
      version: workflowJournalEventVersion
    })
    const stale = TargetPromotionStaleEvent.make({
      basis: { _tag: "AfterAttempt", attemptOrdinal: TargetPromotionAttemptOrdinal.make(1) },
      correlation: prefix.promotionCorrelation,
      observation: { _tag: "CompareAndSetRejected", observedHeadSha: prefix.integratorRun.session.expectedTargetHead },
      version: workflowJournalEventVersion
    })
    const nonConvergenceAttempt = TargetPromotionAttemptIntendedEvent.make({
      attemptOrdinal: TargetPromotionAttemptOrdinal.make(3),
      correlation: prefix.promotionCorrelation,
      reason: {
        _tag: "ReconciledExpectedHead",
        observedHeadSha: prefix.integratorRun.session.expectedTargetHead,
        previousAttemptOrdinal: TargetPromotionAttemptOrdinal.make(2)
      },
      version: workflowJournalEventVersion
    })
    const nonConvergence = TargetPromotionNonConvergenceEvent.make({
      attemptLimit: TargetPromotionAttemptLimit.make(3),
      attemptOrdinal: TargetPromotionAttemptOrdinal.make(3),
      correlation: prefix.promotionCorrelation,
      lastObservation: {
        _tag: "ExpectedHeadStillObserved",
        observedHeadSha: prefix.integratorRun.session.expectedTargetHead
      },
      version: workflowJournalEventVersion
    })
    const successProjection = yield* projectWorkflowOccurrences([
      ...prefix.records,
      historicalRecord(15, intent),
      historicalRecord(16, attempt),
      historicalRecord(17, success)
    ])
    expect(successProjection.occurrences.at(-1)?._tag).toBe("TargetPromotionSucceeded")

    const staleProjection = yield* projectWorkflowOccurrences([
      ...prefix.records,
      historicalRecord(15, intent),
      historicalRecord(16, attempt),
      historicalRecord(17, stale)
    ])
    expect(staleProjection.occurrences.at(-1)?._tag).toBe("TargetPromotionStale")

    const nonConvergenceProjection = yield* projectWorkflowOccurrences([
      ...prefix.records,
      historicalRecord(15, intent),
      historicalRecord(16, nonConvergenceAttempt),
      historicalRecord(17, nonConvergence)
    ])
    expect(nonConvergenceProjection.occurrences.at(-1)?._tag).toBe("TargetPromotionNonConvergent")
  })
)

it.effect("keeps non-occurrence journal events out of the occurrence projection", () =>
  Effect.gen(function* () {
    const projection = yield* projectWorkflowOccurrences([
      record(
        1,
        WorkflowRunBeganEvent.make({
          initialControlPolicy: InitialControlPolicy.make({ taskExecutionCapacity: TaskWorkCapacity.make(1) }),
          initiatedBy: WorkflowActor.cases.DalphCoordinator.make({}),
          occurrenceClassification: "InitiatedAction",
          target: operation.target,
          version: workflowJournalEventVersion
        })
      ),
      record(
        2,
        WorkflowRunTerminatedEvent.make({
          disposition: "Completed",
          evidence: completedRunFinalityFixture({
            observedAt: JournalPosition.make(1),
            runId,
            target: operation.target
          }).evidence,
          occurrenceClassification: "NonActionOccurrence",
          version: workflowJournalEventVersion
        })
      )
    ])
    expect(projection.occurrences).toEqual([])
  })
)

it.effect("rejects historical outcomes when exact earlier correlation or chronology is missing", () =>
  Effect.gen(function* () {
    const fixture = integrationFinalityFixture
    const prefix = historicalIntegrationPrefix()
    const session = prefix.integratorRun.session
    const fixed = IntegratorSessionFixedEvent.make({ correlation: session, version: workflowJournalEventVersion })
    const runStart = IntegratorRunStartedEvent.make({ run: prefix.integratorRun, version: workflowJournalEventVersion })
    const runResult = IntegratorRunResultRecordedEvent.make({
      result: IntegratorResult.cases.PreparedCandidate.make({
        candidateText: prefix.candidateText,
        correlation: session
      }),
      run: prefix.integratorRun,
      version: workflowJournalEventVersion
    })
    const candidateIntent = IntegratorRunCandidateGitReadIntendedEvent.make({
      candidateText: prefix.candidateText,
      run: prefix.integratorRun,
      version: workflowJournalEventVersion
    })
    const candidateObserved = IntegratorRunCandidateGitObservedEvent.make({
      candidateText: prefix.candidateText,
      observation: prefix.candidateObservation,
      run: prefix.integratorRun,
      version: workflowJournalEventVersion
    })
    const promotionIntent = TargetPromotionIntendedEvent.make({
      correlation: prefix.promotionCorrelation,
      version: workflowJournalEventVersion
    })
    const attempt = TargetPromotionAttemptIntendedEvent.make({
      attemptOrdinal: TargetPromotionAttemptOrdinal.make(1),
      correlation: prefix.promotionCorrelation,
      reason: { _tag: "Initial", observedHeadSha: session.expectedTargetHead },
      version: workflowJournalEventVersion
    })
    const successAfterAttempt = TargetPromotionObservedSuccessEvent.make({
      basis: { _tag: "AfterAttempt", attemptOrdinal: TargetPromotionAttemptOrdinal.make(1) },
      correlation: prefix.promotionCorrelation,
      observation: TargetPromotionSuccessObservation.cases.CompareAndSetApplied.make({
        candidateAncestry: "Current",
        targetHeadSha: prefix.qualifiedCandidate.candidateCommit
      }),
      version: workflowJournalEventVersion
    })
    const staleAfterAttempt = TargetPromotionStaleEvent.make({
      basis: { _tag: "AfterAttempt", attemptOrdinal: TargetPromotionAttemptOrdinal.make(1) },
      correlation: prefix.promotionCorrelation,
      observation: { _tag: "CompareAndSetRejected", observedHeadSha: GitCommitSha.make("8".repeat(40)) },
      version: workflowJournalEventVersion
    })
    const nonConvergence = TargetPromotionNonConvergenceEvent.make({
      attemptLimit: TargetPromotionAttemptLimit.make(3),
      attemptOrdinal: TargetPromotionAttemptOrdinal.make(3),
      correlation: prefix.promotionCorrelation,
      lastObservation: { _tag: "ExpectedHeadStillObserved", observedHeadSha: session.expectedTargetHead },
      version: workflowJournalEventVersion
    })
    const quarantineBasis = IntegrationQuarantineBasis.cases.ProviderRunFailure.make({
      detail: IntegrationQuarantineFailureDetail.make("historical invalid successor absence"),
      ownedActivityProvenAbsentAt: JournalPosition.make(11)
    })
    const quarantine = IntegrationQuarantinedEvent.make({
      basis: quarantineBasis,
      correlation: session,
      occurrenceClassification: "NonActionOccurrence",
      version: workflowJournalEventVersion
    })
    const directionFingerprint = IntegrationQuarantineDirectionFingerprint.make({
      direction: "FullRerun",
      quarantineAt: JournalPosition.make(11),
      sessionId: session.sessionId
    })
    const direction = IntegrationQuarantineDirectionAppliedEvent.make({
      fingerprint: directionFingerprint,
      initiatedBy: WorkflowActor.cases.Operator.make({}),
      occurrenceClassification: "InitiatedAction",
      requestId: IntegrationQuarantineDirectionRequestId.make({
        nonce: "historical-invalid-successor",
        runId: fixture.runId
      }),
      version: workflowJournalEventVersion
    })
    const successorSession = IntegratorSessionCorrelation.make({
      ...session,
      candidateResource: IntegratorCandidateResourceLocator.make("historical-invalid-successor-resource"),
      sessionId: IntegratorSessionId.make("historical-invalid-successor-session"),
      targetLineageObservedAt: JournalPosition.make(14)
    })
    const successor = IntegratorSuccessorSessionFixedEvent.make({
      direction: "FullRerun",
      directionAppliedAt: JournalPosition.make(12),
      predecessor: session,
      quarantineAt: JournalPosition.make(11),
      successor: successorSession,
      successorGeneration: firstFullRerunSuccessorGeneration,
      version: workflowJournalEventVersion
    })
    const missingPredecessor = IntegratorSuccessorSessionFixedEvent.make({
      ...successor,
      predecessor: IntegratorSessionCorrelation.make({
        ...session,
        candidateResource: IntegratorCandidateResourceLocator.make("historical-missing-predecessor-resource"),
        sessionId: IntegratorSessionId.make("historical-missing-predecessor-session")
      })
    })
    const expectHistoricalFailure = (records: ReadonlyArray<JournalRecord>) =>
      Effect.gen(function* () {
        const failure = yield* projectWorkflowOccurrences(records).pipe(Effect.flip)
        expect(failure._tag).toBe("HistoricalOutcomeWithoutInitiatingAction")
      })
    const historicalFailures = [
      [historicalRecord(10, fixed)],
      [...prefix.records, historicalRecord(15, fixed)],
      [historicalRecord(11, runStart)],
      [...prefix.records.slice(0, 5), historicalRecord(11, runStart), historicalRecord(12, runStart)],
      [historicalRecord(12, runResult)],
      [historicalRecord(13, candidateIntent)],
      [...prefix.records, historicalRecord(15, candidateIntent)],
      [...prefix.records.slice(0, -1), historicalRecord(15, promotionIntent)],
      [...prefix.records, historicalRecord(15, promotionIntent), historicalRecord(16, promotionIntent)],
      [historicalRecord(15, attempt)],
      [
        ...prefix.records,
        historicalRecord(15, promotionIntent),
        historicalRecord(16, attempt),
        historicalRecord(17, attempt)
      ],
      [historicalRecord(15, successAfterAttempt)],
      [...prefix.records, historicalRecord(15, promotionIntent), historicalRecord(16, successAfterAttempt)],
      [historicalRecord(15, staleAfterAttempt)],
      [...prefix.records, historicalRecord(15, promotionIntent), historicalRecord(16, staleAfterAttempt)],
      [historicalRecord(15, nonConvergence)],
      [...prefix.records, historicalRecord(15, promotionIntent), historicalRecord(16, nonConvergence)],
      [...prefix.records, historicalRecord(15, missingPredecessor)],
      [...prefix.records, historicalRecord(13, successor)]
    ]
    for (const records of historicalFailures) yield* expectHistoricalFailure(records)

    const duplicateSuccessor = [
      ...prefix.records,
      historicalRecord(11, quarantine),
      historicalRecord(12, direction),
      historicalRecord(13, successor),
      historicalRecord(14, successor)
    ]
    yield* expectHistoricalFailure(duplicateSuccessor)

    const claimFailure = yield* projectWorkflowOccurrences([
      historicalRecord(
        1,
        TaskClaimAcquiredEvent.make({ claim: fixture.activeClaim, version: workflowJournalEventVersion })
      )
    ]).pipe(Effect.flip)
    expect(claimFailure._tag).toBe("TrackerOutcomeWithoutReadIntent")

    const candidateObservationFailure = yield* projectWorkflowOccurrences([
      ...prefix.records.slice(0, 7),
      historicalRecord(15, candidateObserved)
    ]).pipe(Effect.flip)
    expect(candidateObservationFailure._tag).toBe("GitOutcomeWithoutReadIntent")
  })
)

it("compile-time exhaustive fixtures cover every occurrence and actor variant", () => {
  const occurrenceVariants = {
    AppliedAttemptChoice: true,
    AppliedControlDirection: true,
    AppliedTaskClaimReacquisitionDirection: true,
    AppliedTaskWorkCapacity: true,
    AttemptImplementationAbandoned: true,
    AttemptRestartAuthorityReadFailed: true,
    AttemptStoppageIntended: true,
    ActiveWorkAuthorityRefreshGitReadFailed: true,
    BranchCleanupOccurred: true,
    CancelledAttemptClaimNoReleaseObserved: true,
    CancelledAttemptImplementationResponsibilityRelinquished: true,
    IntegrationClaimDeletionOccurred: true,
    IntegrationClaimReplacementOccurred: true,
    IntegrationFinalitySettledOccurred: true,
    IntegrationFocusedCompletionOccurred: true,
    IntegrationProviderRunActivityAbsent: true,
    IntegrationQuarantineDirectionApplied: true,
    IntegrationQuarantined: true,
    IntegrationResponsibilityBegan: true,
    IntegrationStarted: true,
    IntegratorCandidateQualificationInitiated: true,
    IntegratorCandidateQualificationObserved: true,
    IntegratorCandidateCleanupOccurred: true,
    IntegratorRunResultRecorded: true,
    IntegratorRunStarted: true,
    IntegratorSessionFixed: true,
    IntegratorSuccessorSessionFixed: true,
    GitReadInitiated: true,
    PlannedAttemptExecutorWorkReported: true,
    PlannedAttemptExecutorWorkResponsibilityBegan: true,
    PlannedAttemptReplaced: true,
    PlannedAttemptWorktreeObserved: true,
    StoppedAttemptClaimPreserved: true,
    TargetPromotionAttemptRequested: true,
    TargetPromotionNonConvergent: true,
    TargetPromotionRequested: true,
    TargetPromotionStale: true,
    TargetPromotionSucceeded: true,
    TaskAttemptPlanned: true,
    TaskClaimAcquired: true,
    TaskClaimAcquisitionInitiated: true,
    TaskClaimReleased: true,
    TaskClaimReleaseInitiated: true,
    TaskWorktreeReconciliationInitiated: true,
    TaskWorktreeReady: true,
    TargetLineageObserved: true,
    TaskTrackerFactsObserved: true,
    TaskTrackerReadInitiated: true,
    RunCancellationApplied: true,
    WorktreeCleanupOccurred: true
  } satisfies Record<WorkflowOccurrence["_tag"], true>
  const actorVariants = { DalphCoordinator: true, Operator: true } satisfies Record<WorkflowActor["_tag"], true>

  expect(Object.keys(occurrenceVariants)).toHaveLength(50)
  expect(Object.keys(actorVariants)).toHaveLength(2)
})
