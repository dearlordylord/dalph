import { taskTrackerGraphFactsObserved } from "../../../test/task-tracker-facts.js"
import { it } from "@effect/vitest"
import {
  plannedAttemptExecutorCorrelation,
  PlannedAttemptExecutorReport,
  AttemptId,
  GitCommitSha,
  PlannedTaskAttempt,
  RunId,
  TaskBranchRef,
  TaskExecutorLocator,
  TaskId,
  TaskRevision,
  WorktreeLocator
} from "@dalph/contracts"
import { controlledFakePlannedAttemptExecutorLayer } from "../../../test/controlled-planned-attempt-executor.js"
import { AuthenticatedOperatorIdentity, ControlCommandId } from "../../control/identity.js"
import { TrackerRevision } from "../../authorities/task-tracker/task.js"
import { FixtureTarget } from "../../authorities/task-tracker/fixture/target.js"
import { JournalPosition, JournalRecordKey } from "../../workflow-journal/identity.js"
import { OperationId } from "../identity.js"
import { TaskWorkCapacity } from "../../coordination/admission/capacity.js"
import { InitialControlPolicy } from "../../control/policy.js"
import { ControlCommand, ControlCommandRecordedEvent } from "../../control/command.js"
import { type JournalRecord, JournalStore } from "../../workflow-journal/store.js"
import { taskTrackerReadIntent, WorkflowJournalEvent } from "./event.js"
import { workflowJournalEventVersion } from "../kernel/event.js"
import {
  intentRecordKey,
  outcomeRecordKey,
  plannedAttemptExecutorWorkReportedRecordKey,
  plannedAttemptExecutorWorkResponsibilityBeganRecordKey
} from "../../workflow-journal/record-key.js"
import {
  PlannedAttemptExecutorReportOrdinal,
  PlannedAttemptExecutorWorkReportedEvent,
  PlannedAttemptExecutorWorkResponsibilityBeganEvent
} from "../protocols/planned-attempt-executor-work/events.js"
import { makeRunRecoveryActivation, RunRecoveryActivation } from "../../coordination/run/recovery-activation.js"
import { trustedPlannedAttemptRecoveryAuthorityLayer } from "../../coordination/run/recovery-authority.js"
import { projectTrackerSnapshot } from "../../authorities/task-tracker/graph.js"
import { TaskClaimAcquisitionPlanner } from "../protocols/task-claim-acquisition/plan.js"
import {
  makeFocusedTaskWorkSpecificationFactsObserved,
  taskTrackerFactsObservedEvent
} from "../task-tracker-facts/observation.js"
import { makeTaskWorkSpecification } from "../../authorities/task-tracker/task-work-specification.js"
import { OperationIdAllocator, PlannedTaskAttemptPlanner } from "../protocols/task-attempt-planning/plan.js"
import { makeTaskWorkSpecificationObservationOperation, makeTrackerGraphObservationOperation } from "./operation.js"
import { runRecoveredWorkflow } from "../../coordination/run/run.js"
import { WorkflowInterpreter, WorkflowTrace } from "../interpretation/interpreter.js"
import {
  AppliedControlDirection,
  decodeWorkflowOccurrence,
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

const record = (position: number, event: JournalRecord["event"]): JournalRecord => ({
  event,
  key: JournalRecordKey.make(`occurrence-record-${position}`),
  position: JournalPosition.make(position),
  runId
})

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
    subject: { _tag: "Task", runId, taskId: TaskId.make("paused-task") }
  })

  expect(occurrence).toMatchObject({
    _tag: "AppliedControlDirection",
    direction: "Pause",
    initiatedBy: { _tag: "Operator" },
    occurrenceClassification: "InitiatedAction"
  })
})

it.effect("rejects operator identity and command receipt as occurrence classification", () =>
  Effect.gen(function* () {
    const appliedDirection = {
      _tag: "AppliedControlDirection",
      direction: "Pause",
      initiatedBy: { _tag: "Operator" },
      occurrenceClassification: "InitiatedAction",
      operatorId: "unsupported-operator-identity",
      subject: { _tag: "Run", runId }
    }
    const commandReceipt = { _tag: "ControlCommandRecorded", occurrenceClassification: "InitiatedAction" }

    expect((yield* decodeWorkflowOccurrence(appliedDirection).pipe(Effect.flip))._tag).toBe("SchemaError")
    expect((yield* decodeWorkflowOccurrence(commandReceipt).pipe(Effect.flip))._tag).toBe("SchemaError")
    const receiptEvent = ControlCommandRecordedEvent.make({
      command: ControlCommand.cases.RequestRunPause.make({
        commandId: ControlCommandId.make("receipt-is-not-occurrence"),
        operatorId: AuthenticatedOperatorIdentity.make("transitional-operator"),
        runId
      }),
      version: workflowJournalEventVersion
    })
    expect((yield* projectWorkflowOccurrences([record(1, receiptEvent)])).occurrences).toEqual([])
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
      const interpreter = WorkflowInterpreter.of({
        acquireTaskClaim: () => Effect.die("startup authority reread must not reach task claiming"),
        readTrackerGraph: () => Ref.update(trackerReads, (count) => count + 1).pipe(Effect.as(snapshot)),
        readTaskWorkSpecification: () => Effect.die("startup must not read task-work specifications"),
        reconcileTaskWorktree: () => Effect.die("startup authority reread must not reach Git"),
        recordTaskAttemptPlan: () => Effect.die("startup authority reread must not reach attempt planning")
      })
      const startupLayer = Layer.mergeAll(
        Layer.succeed(
          JournalStore,
          JournalStore.of({
            append: () => Effect.die("startup authority reread must not append"),
            read: () => Effect.succeed(prefix),
            scan: () => Effect.die("startup authority reread must not scan")
          })
        ),
        Layer.succeed(WorkflowInterpreter, interpreter),
        Layer.succeed(WorkflowTrace, WorkflowTrace.of({ emit: () => Effect.void })),
        controlledFakePlannedAttemptExecutorLayer,
        trustedPlannedAttemptRecoveryAuthorityLayer
      )
      const recovery = yield* makeRunRecoveryActivation(runId).pipe(Effect.provide(startupLayer))
      const workflowLayer = Layer.mergeAll(
        Layer.succeed(RunRecoveryActivation, recovery),
        Layer.succeed(WorkflowInterpreter, interpreter),
        Layer.succeed(WorkflowTrace, WorkflowTrace.of({ emit: () => Effect.void })),
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
      yield* runRecoveredWorkflow(
        FixtureTarget.make("occurrence-fixture"),
        InitialControlPolicy.make({ taskExecutionCapacity: TaskWorkCapacity.make(1) })
      ).pipe(Effect.provide(workflowLayer))
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
    PlannedAttemptExecutorWorkReported: true,
    PlannedAttemptExecutorWorkResponsibilityBegan: true,
    TaskTrackerFactsObserved: true,
    TaskTrackerReadInitiated: true
  } satisfies Record<WorkflowOccurrence["_tag"], true>
  const actorVariants = { DalphCoordinator: true, Operator: true } satisfies Record<WorkflowActor["_tag"], true>

  expect(Object.keys(occurrenceVariants)).toHaveLength(5)
  expect(Object.keys(actorVariants)).toHaveLength(2)
})
