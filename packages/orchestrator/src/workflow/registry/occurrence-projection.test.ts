import { taskTrackerGraphFactsObserved } from "../../../test/task-tracker-facts.js"
import { it } from "@effect/vitest"
import {
  plannedAttemptExecutorCorrelation,
  PlannedAttemptExecutorReport,
  AcceptedResult,
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
import { controlledFakePlannedAttemptExecutorLayer } from "../../../test/controlled-planned-attempt-executor.js"
import { TrackerRevision } from "../../authorities/task-tracker/task.js"
import { FixtureTarget } from "../../authorities/task-tracker/fixture/target.js"
import { JournalPosition, JournalRecordKey } from "../../workflow-journal/identity.js"
import { OperationId } from "../identity.js"
import { TaskWorkCapacity } from "../../coordination/admission/capacity.js"
import { InitialControlPolicy, initialRunPolicyRevision, RunControlPolicy } from "../../control/policy.js"
import { TaskWorkCapacityControl } from "../../control/task-work-capacity.js"
import { type JournalRecord, JournalStore } from "../../workflow-journal/store.js"
import { journaledWorkflowInterpreterLayer } from "../../workflow-journal/journaled-interpreter.js"
import {
  GitReadIntentRecordedEvent,
  PlannedAttemptWorktreeObservedEvent,
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
  controlDirectionAppliedRecordKey
} from "../../workflow-journal/record-key.js"
import {
  PlannedAttemptExecutorReportOrdinal,
  PlannedAttemptExecutorWorkReportedEvent,
  PlannedAttemptExecutorWorkResponsibilityBeganEvent
} from "../protocols/planned-attempt-executor-work/events.js"
import { makeRunRecoveryActivation, RunRecoveryActivation } from "../../coordination/run/recovery-activation.js"
import { projectTrackerSnapshot } from "../../authorities/task-tracker/graph.js"
import { TaskClaimAcquisitionPlanner } from "../protocols/task-claim-acquisition/plan.js"
import {
  makeFocusedTaskWorkSpecificationFactsObserved,
  taskTrackerFactsObservedEvent
} from "../task-tracker-facts/observation.js"
import { makeTaskWorkSpecification } from "../../authorities/task-tracker/task-work-specification.js"
import { OperationIdAllocator, PlannedTaskAttemptPlanner } from "../protocols/task-attempt-planning/plan.js"
import {
  makeTaskWorkSpecificationObservationOperation,
  makeTaskWorktreeObservationOperation,
  makeTrackerGraphObservationOperation
} from "./operation.js"
import { AttemptWorktreeLost } from "../protocols/planned-attempt-worktree-observation/protocol.js"
import { runRecoveredWorkflow } from "../../coordination/run/run.js"
import { WorkflowInterpreter, WorkflowTrace } from "../interpretation/interpreter.js"
import {
  AppliedControlDirection,
  decodeWorkflowOccurrence,
  originatingActionForPlannedAttemptWorktreeObservation,
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
import {
  IntegrationResponsibilityBeganEvent,
  IntegrationStartedEvent
} from "../protocols/integration-admission/events.js"
import {
  ControlDirectionAppliedEvent,
  ControlDirectionApplicationOrdinal
} from "../protocols/control-direction-application/events.js"

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
const acceptedResult = AcceptedResult.make({ commit: GitCommitSha.make("a".repeat(40)) })
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
    { ...started, acceptedResult: AcceptedResult.make({ commit: GitCommitSha.make("b".repeat(40)) }) },
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
        Layer.succeed(JournalStore, journal),
        Layer.succeed(WorkflowInterpreter, interpreter),
        Layer.succeed(WorkflowTrace, WorkflowTrace.of({ emit: () => Effect.void })),
        controlledFakePlannedAttemptExecutorLayer
      )
      const recovery = yield* makeRunRecoveryActivation(runId).pipe(Effect.provide(startupLayer))
      const journalLayer = Layer.succeed(JournalStore, journal)
      const workflowLayer = Layer.mergeAll(
        journalLayer,
        Layer.succeed(RunRecoveryActivation, recovery),
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
      yield* runRecoveredWorkflow(target).pipe(Effect.provide(workflowLayer))
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

it("compile-time exhaustive fixtures cover every occurrence and actor variant", () => {
  const occurrenceVariants = {
    AppliedControlDirection: true,
    AppliedTaskClaimReacquisitionDirection: true,
    AppliedTaskWorkCapacity: true,
    IntegrationResponsibilityBegan: true,
    IntegrationStarted: true,
    GitReadInitiated: true,
    PlannedAttemptExecutorWorkReported: true,
    PlannedAttemptExecutorWorkResponsibilityBegan: true,
    PlannedAttemptWorktreeObserved: true,
    TargetLineageObserved: true,
    TaskTrackerFactsObserved: true,
    TaskTrackerReadInitiated: true
  } satisfies Record<WorkflowOccurrence["_tag"], true>
  const actorVariants = { DalphCoordinator: true, Operator: true } satisfies Record<WorkflowActor["_tag"], true>

  expect(Object.keys(occurrenceVariants)).toHaveLength(12)
  expect(Object.keys(actorVariants)).toHaveLength(2)
})
