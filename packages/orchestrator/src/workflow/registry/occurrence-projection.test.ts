import { taskTrackerGraphFactsObserved } from "../../../test/task-tracker-facts.js"
import { acceptedResultFixture } from "../../../test/support/evidence.js"
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
  TaskWorkCapacityChangedEvent,
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
  makeTaskClaimObservationOperation,
  makeTaskWorkSpecificationObservationOperation,
  makeTaskWorktreeObservationOperation,
  makeTrackerGraphObservationOperation
} from "./operation.js"
import { AttemptWorktreeLost } from "../protocols/planned-attempt-worktree-observation/protocol.js"
import { WorkflowInterpreter, WorkflowTrace } from "../interpretation/interpreter.js"
import {
  AppliedControlDirection,
  decodeWorkflowOccurrence,
  originatingActionForPlannedAttemptWorktreeObservation,
  originatingActionForTargetLineageObservation,
  originatingActionForTrackerObservation,
  plannedAttemptExecutorResponsibilityForReport,
  presentWorkflowOccurrence,
  projectWorkflowOccurrences,
  WorkflowActor,
  type WorkflowOccurrence,
  WorkflowOccurrenceProjection
} from "./occurrence-projection.js"
import { Effect, Layer, Option, Ref, Schema } from "effect"
import { expect } from "vitest"
import { invalidIntegrationOccurrenceRelationship, projectIntegrationOccurrence } from "./integration-occurrence.js"
import { GitTargetLineageReadFailure } from "../../authorities/git/target-lineage.js"
import { GitWorktreeReadFailure, PlannedWorktreeReady } from "../../authorities/git/worktree.js"
import { ActiveTaskClaim } from "../../authorities/task-tracker/claim-mutation.js"
import { ClaimOwner, ClaimToken } from "../../authorities/task-tracker/claim.js"
import {
  IntegrationResponsibilityBeganEvent,
  IntegrationStartedEvent
} from "../protocols/integration-admission/events.js"
import {
  ControlDirectionAppliedEvent,
  ControlDirectionApplicationOrdinal
} from "../protocols/control-direction-application/events.js"
import { AttemptChoiceAppliedEvent, AttemptChoiceRequestId } from "../protocols/attempt-choice/events.js"
import {
  AttemptRestartAuthorityReadFailedEvent,
  AttemptRestartTaskFactsReadFailure,
  PlannedAttemptReplacedEvent,
  PlannedAttemptReplacementWitness
} from "../protocols/attempt-choice/replacement-events.js"
import {
  TaskClaimReacquisitionDirectedEvent,
  TaskClaimReacquisitionRequestId
} from "../protocols/task-claim-reacquisition/events.js"
import { integrationFinalityFixture } from "../protocols/integration-finality/fixtures.js"

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

it.effect("projects an operator task-work capacity change as an applied policy occurrence", () =>
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
    const running = PlannedAttemptExecutorReport.cases.Running.make({ correlation })
    const terminal = PlannedAttemptExecutorReport.cases.Terminal.make({ correlation, result: { _tag: "Completed" } })
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
          report: PlannedAttemptExecutorReport.cases.Running.make({ correlation }),
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
          report: PlannedAttemptExecutorReport.cases.Running.make({ correlation }),
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
      const terminated: JournalRecord = {
        event: WorkflowRunTerminatedEvent.make({
          disposition: "Completed",
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
        scan: () => Effect.die("startup authority reread must not scan"),
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
            scan: journal.scan,
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
      quiescenceProof: { _tag: "CommandResponse", reportOrdinal: PlannedAttemptExecutorReportOrdinal.make(1) },
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

it("compile-time exhaustive fixtures cover every occurrence and actor variant", () => {
  const occurrenceVariants = {
    AppliedAttemptChoice: true,
    AppliedControlDirection: true,
    AppliedTaskClaimReacquisitionDirection: true,
    AppliedTaskWorkCapacity: true,
    AttemptImplementationAbandoned: true,
    AttemptRestartAuthorityReadFailed: true,
    AttemptStoppageIntended: true,
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
    TaskWorktreeReady: true,
    TargetLineageObserved: true,
    TaskTrackerFactsObserved: true,
    TaskTrackerReadInitiated: true
  } satisfies Record<WorkflowOccurrence["_tag"], true>
  const actorVariants = { DalphCoordinator: true, Operator: true } satisfies Record<WorkflowActor["_tag"], true>

  expect(Object.keys(occurrenceVariants)).toHaveLength(42)
  expect(Object.keys(actorVariants)).toHaveLength(2)
})
