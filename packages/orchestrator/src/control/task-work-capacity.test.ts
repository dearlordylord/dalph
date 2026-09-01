import { it } from "@effect/vitest"
import {
  AttemptId,
  GitCommitSha,
  PlannedAttemptExecutor,
  PlannedAttemptExecutorReport,
  PlannedTaskAttempt,
  RunId,
  TaskBranchRef,
  TaskExecutorLocator,
  TaskId,
  TaskRevision,
  WorktreeLocator
} from "@dalph/contracts"
import { Effect, Layer, Option } from "effect"
import { expect } from "vitest"
import { FixtureTarget } from "../authorities/task-tracker/fixture/target.js"
import { TaskWorkCapacity } from "../coordination/admission/capacity.js"
import { makeIntegrationTargetResourceController } from "../coordination/admission/integration-target-resource.js"
import { makeDeliveryRuntimeAdmissionController } from "../coordination/delivery/delivery-runtime-admission.js"
import { makeApplicationExitLifecycle } from "../coordination/application-exit/lifecycle.js"
import { makeRunRecoveryProjection } from "../coordination/run/recovery-activation.js"
import { requiredPlannedAttemptPositionsOf } from "../coordination/run/required-planned-attempt-positions.js"
import { reduceWorkflowJournalHistory } from "../coordination/reconstruction/history.js"
import { memoryJournalTestLayer } from "../workflow-journal/adapters/memory-store.js"
import { InRunJournal, JournalStore } from "../workflow-journal/store.js"
import { JournalPosition } from "../workflow-journal/identity.js"
import { OperationId } from "../workflow/identity.js"
import { TaskAttemptPlannedEvent, TaskWorkCapacityChangedEvent } from "../workflow/registry/event.js"
import { makeTaskAttemptPlanOperation } from "../workflow/registry/operation.js"
import { workflowJournalEventVersion } from "../workflow/kernel/event.js"
import {
  attemptPlanRecordKey,
  plannedAttemptExecutorCommandIntendedRecordKey,
  plannedAttemptExecutorCommandResponseObservedRecordKey,
  plannedAttemptExecutorStateObservedRecordKey,
  plannedAttemptExecutorWorkReportedRecordKey,
  plannedAttemptExecutorWorkResponsibilityBeganRecordKey
} from "../workflow-journal/record-key.js"
import {
  PlannedAttemptExecutorCommandIntendedEvent,
  PlannedAttemptExecutorCommandOrdinal,
  PlannedAttemptExecutorCommandResponseObservedEvent,
  PlannedAttemptExecutorStateObservation,
  PlannedAttemptExecutorStateObservationOrdinal,
  PlannedAttemptExecutorStateObservedEvent,
  PlannedAttemptExecutorReportOrdinal,
  PlannedAttemptExecutorWorkReportedEvent,
  PlannedAttemptExecutorWorkResponsibilityBeganEvent
} from "../workflow/protocols/planned-attempt-executor-work/events.js"
import { plannedAttemptProtocolControllerLayer } from "../workflow/protocols/planned-attempt-executor-work/protocol-controller.js"
import { WorkflowInterpreter, WorkflowTrace } from "../workflow/interpretation/interpreter.js"
import { projectWorkflowOccurrences } from "../workflow/registry/occurrence-projection.js"
import { InitialControlPolicy, initialRunPolicyRevision, RunPolicyRevision } from "./policy.js"
import {
  reconstructTaskWorkCapacityPolicy,
  taskWorkCapacityControlLayer,
  TaskWorkCapacityControl
} from "./task-work-capacity.js"

it.effect("rejects an invalid journal prefix instead of deriving a capacity", () =>
  Effect.gen(function* () {
    const runId = RunId.make("invalid-capacity-prefix")
    const target = FixtureTarget.make("invalid-capacity-target")
    const journal = yield* JournalStore
    yield* journal.beginRun(
      runId,
      target,
      InitialControlPolicy.make({ taskExecutionCapacity: TaskWorkCapacity.make(2) })
    )
    const records = yield* journal.read(runId)
    const began = Option.getOrThrow(Option.fromUndefinedOr(records[0]))

    expect(
      yield* reconstructTaskWorkCapacityPolicy(runId, [
        ...records,
        { ...began, position: JournalPosition.make(2) }
      ]).pipe(Effect.flip)
    ).toMatchObject({ _tag: "InvalidWorkflowJournalHistory" })
  }).pipe(Effect.provide(memoryJournalTestLayer))
)

it.effect(
  "records initial task-work capacity with the run beginning and reconstructs the latest applied revision",
  () =>
    Effect.gen(function* () {
      const runId = RunId.make("durable-capacity-run")
      const target = FixtureTarget.make("durable-capacity-target")
      const journal = yield* JournalStore
      yield* journal.beginRun(
        runId,
        target,
        InitialControlPolicy.make({ taskExecutionCapacity: TaskWorkCapacity.make(2) })
      )
      const control = yield* TaskWorkCapacityControl

      yield* control.apply({ capacity: 1, expectedRevision: initialRunPolicyRevision, runId })

      const records = yield* journal.read(runId)
      const reduced = reduceWorkflowJournalHistory(runId, records)
      expect(reduced._tag).toBe("ValidWorkflowJournalHistory")
      if (reduced._tag !== "ValidWorkflowJournalHistory") return
      expect(Option.getOrThrow(reduced.runState.controlPolicy)).toEqual({
        revision: RunPolicyRevision.make(2),
        taskExecutionCapacity: TaskWorkCapacity.make(1)
      })
      expect(reduced.records.map(({ event }) => event._tag)).toEqual(["WorkflowRunBegan", "TaskWorkCapacityChanged"])
      expect((yield* projectWorkflowOccurrences(records)).occurrences).toEqual([
        {
          _tag: "AppliedTaskWorkCapacity",
          capacity: 1,
          initiatedBy: { _tag: "Operator" },
          occurrenceClassification: "InitiatedAction",
          policyRevision: 2,
          recordedAt: 2,
          runId
        }
      ])
    }).pipe(Effect.provide(taskWorkCapacityControlLayer), Effect.provide(memoryJournalTestLayer))
)

it.effect("rejects a stale capacity revision without appending another applied change", () =>
  Effect.gen(function* () {
    const runId = RunId.make("stale-capacity-run")
    const target = FixtureTarget.make("stale-capacity-target")
    const journal = yield* JournalStore
    yield* journal.beginRun(
      runId,
      target,
      InitialControlPolicy.make({ taskExecutionCapacity: TaskWorkCapacity.make(2) })
    )
    const control = yield* TaskWorkCapacityControl
    const request = { capacity: 1, expectedRevision: initialRunPolicyRevision, runId }

    yield* control.apply(request)
    const stale = yield* control.apply(request).pipe(Effect.flip)

    expect(stale).toMatchObject({
      _tag: "TaskWorkCapacityPolicyRevisionConflict",
      current: { revision: 2, taskExecutionCapacity: 1 },
      expectedRevision: 1,
      runId
    })
    expect((yield* journal.read(runId)).map(({ event }) => event._tag)).toEqual([
      "WorkflowRunBegan",
      "TaskWorkCapacityChanged"
    ])
  }).pipe(Effect.provide(taskWorkCapacityControlLayer), Effect.provide(memoryJournalTestLayer))
)

it.effect("reports that capacity has no durable value before the Run begins", () =>
  Effect.gen(function* () {
    const control = yield* TaskWorkCapacityControl
    const failure = yield* control.read(RunId.make("unbegun-capacity-run")).pipe(Effect.flip)

    expect(failure).toMatchObject({ _tag: "WorkflowRunNotBegan", runId: "unbegun-capacity-run" })
  }).pipe(Effect.provide(taskWorkCapacityControlLayer), Effect.provide(memoryJournalTestLayer))
)

it.effect("rereads the winning policy when another writer commits the requested revision first", () =>
  Effect.gen(function* () {
    const runId = RunId.make("racing-capacity-run")
    const target = FixtureTarget.make("racing-capacity-target")
    const journal = yield* JournalStore
    yield* journal.beginRun(
      runId,
      target,
      InitialControlPolicy.make({ taskExecutionCapacity: TaskWorkCapacity.make(2) })
    )
    const racingJournal = JournalStore.of({
      ...journal,
      append: (requestedRunId, key, event) =>
        event._tag === "TaskWorkCapacityChanged"
          ? journal
              .append(
                requestedRunId,
                key,
                TaskWorkCapacityChangedEvent.make({ ...event, capacity: TaskWorkCapacity.make(8) })
              )
              .pipe(Effect.andThen(journal.append(requestedRunId, key, event)))
          : journal.append(requestedRunId, key, event)
    })
    const conflict = yield* Effect.gen(function* () {
      const control = yield* TaskWorkCapacityControl
      return yield* control.apply({ capacity: 1, expectedRevision: initialRunPolicyRevision, runId }).pipe(Effect.flip)
    }).pipe(
      Effect.provide(
        taskWorkCapacityControlLayer.pipe(Layer.provide(Layer.succeed(InRunJournal, InRunJournal.of(racingJournal))))
      )
    )

    expect(conflict).toMatchObject({
      _tag: "TaskWorkCapacityPolicyRevisionConflict",
      current: { revision: 2, taskExecutionCapacity: 8 },
      expectedRevision: 1,
      runId
    })
  }).pipe(Effect.provide(memoryJournalTestLayer))
)

it.effect("restart reconstructs three unfinished task positions without an admission snapshot", () =>
  Effect.gen(function* () {
    const runId = RunId.make("restart-capacity-run")
    const target = FixtureTarget.make("restart-capacity-target")
    const journal = yield* JournalStore
    yield* journal.beginRun(
      runId,
      target,
      InitialControlPolicy.make({ taskExecutionCapacity: TaskWorkCapacity.make(2) })
    )
    const control = yield* TaskWorkCapacityControl
    yield* control.apply({ capacity: 3, expectedRevision: initialRunPolicyRevision, runId })
    const attempts = ["A", "B", "C"].map((task) =>
      PlannedTaskAttempt.make({
        attemptId: AttemptId.make(`restart-capacity-${task}`),
        baseSha: GitCommitSha.make("1".repeat(40)),
        branch: TaskBranchRef.make(`refs/heads/dalph/restart-capacity-${task}`),
        executor: TaskExecutorLocator.make("executor:controlled-fake"),
        runId,
        taskId: TaskId.make(task),
        taskRevision: TaskRevision.make(`revision-${task}`),
        worktree: WorktreeLocator.make(`/worktrees/restart-capacity-${task}`)
      })
    )
    yield* Effect.forEach(
      attempts,
      (plannedAttempt) => {
        const commandOrdinal = PlannedAttemptExecutorCommandOrdinal.make(1)
        const report = PlannedAttemptExecutorReport.cases.ExecutorWorkExecuting.make({
          correlation: { attemptId: plannedAttempt.attemptId, runId }
        })
        const operation = makeTaskAttemptPlanOperation({
          operationId: OperationId.make(`plan-${plannedAttempt.attemptId}`),
          plannedAttempt,
          predecessorOperationIds: []
        })
        return journal
          .append(
            runId,
            attemptPlanRecordKey(plannedAttempt.attemptId),
            TaskAttemptPlannedEvent.make({ operation, version: workflowJournalEventVersion })
          )
          .pipe(
            Effect.andThen(
              journal.append(
                runId,
                plannedAttemptExecutorWorkResponsibilityBeganRecordKey(plannedAttempt.attemptId),
                PlannedAttemptExecutorWorkResponsibilityBeganEvent.make({
                  plannedAttempt,
                  version: workflowJournalEventVersion
                })
              )
            ),
            Effect.andThen(
              journal.append(
                runId,
                plannedAttemptExecutorCommandIntendedRecordKey(plannedAttempt.attemptId, commandOrdinal),
                PlannedAttemptExecutorCommandIntendedEvent.make({
                  command: "Begin",
                  initiatedBy: { _tag: "DalphCoordinator" },
                  occurrenceClassification: "InitiatedAction",
                  ordinal: commandOrdinal,
                  plannedAttempt,
                  version: workflowJournalEventVersion
                })
              )
            ),
            Effect.andThen(
              journal.append(
                runId,
                plannedAttemptExecutorCommandResponseObservedRecordKey(plannedAttempt.attemptId, commandOrdinal),
                PlannedAttemptExecutorCommandResponseObservedEvent.make({
                  commandOrdinal,
                  occurrenceClassification: "NonActionOccurrence",
                  plannedAttempt,
                  report,
                  version: workflowJournalEventVersion
                })
              )
            ),
            Effect.andThen(
              journal.append(
                runId,
                plannedAttemptExecutorWorkReportedRecordKey(
                  plannedAttempt.attemptId,
                  PlannedAttemptExecutorReportOrdinal.make(1)
                ),
                PlannedAttemptExecutorWorkReportedEvent.make({
                  ordinal: PlannedAttemptExecutorReportOrdinal.make(1),
                  report,
                  version: workflowJournalEventVersion
                })
              )
            )
          )
      },
      { discard: true }
    )
    expect((yield* journal.read(runId)).map(({ event }) => event._tag)).toEqual([
      "WorkflowRunBegan",
      "TaskWorkCapacityChanged",
      "TaskAttemptPlanned",
      "PlannedAttemptExecutorWorkResponsibilityBegan",
      "PlannedAttemptExecutorCommandIntended",
      "PlannedAttemptExecutorCommandResponseObserved",
      "PlannedAttemptExecutorWorkReported",
      "TaskAttemptPlanned",
      "PlannedAttemptExecutorWorkResponsibilityBegan",
      "PlannedAttemptExecutorCommandIntended",
      "PlannedAttemptExecutorCommandResponseObserved",
      "PlannedAttemptExecutorWorkReported",
      "TaskAttemptPlanned",
      "PlannedAttemptExecutorWorkResponsibilityBegan",
      "PlannedAttemptExecutorCommandIntended",
      "PlannedAttemptExecutorCommandResponseObserved",
      "PlannedAttemptExecutorWorkReported"
    ])
    const recovery = yield* makeRunRecoveryProjection(runId).pipe(
      Effect.provideService(
        PlannedAttemptExecutor,
        PlannedAttemptExecutor.of({
          observe: () => Effect.die("restart construction does not ask the stopped fake for a report"),
          requestSuspension: () => Effect.die("restart construction does not suspend work"),
          begin: () => Effect.die("restart construction does not begin work"),
          resume: () => Effect.die("restart construction does not resume work")
        })
      ),
      Effect.provideService(
        WorkflowInterpreter,
        WorkflowInterpreter.of({
          acquireTaskClaim: () => Effect.die("restart construction does not call the tracker"),
          readTaskClaim: () => Effect.die("unexpected task claim read"),
          readTaskWorktree: () => Effect.die("unused worktree observation"),
          readTargetLineage: () => Effect.die("unused target-lineage observation"),
          readTrackerGraph: () => Effect.die("restart construction does not call the tracker"),
          readTaskWorkSpecification: () => Effect.die("restart construction does not call the tracker"),
          reconcileTaskWorktree: () => Effect.die("restart construction does not call Git"),
          recordTaskAttemptPlan: () => Effect.die("restart construction does not plan another attempt"),
          releaseTaskClaim: () => Effect.die("restart construction does not release a tracker claim")
        })
      ),
      Effect.provideService(WorkflowTrace, WorkflowTrace.of({ emit: () => Effect.void }))
    )
    const current = yield* control.read(runId)
    const exactReconstructedPositions = [
      { attemptId: AttemptId.make("restart-capacity-A"), runId, taskId: TaskId.make("A") },
      { attemptId: AttemptId.make("restart-capacity-B"), runId, taskId: TaskId.make("B") },
      { attemptId: AttemptId.make("restart-capacity-C"), runId, taskId: TaskId.make("C") }
    ]
    expect(recovery.reconstructedPlannedAttemptPositions).toEqual(exactReconstructedPositions)
    const controller = yield* makeDeliveryRuntimeAdmissionController(
      {
        capacity: current.taskExecutionCapacity,
        held: recovery.reconstructedPlannedAttemptPositions.map(({ attemptId, runId, taskId }) => ({
          correlation: { attemptId, runId },
          taskId
        }))
      },
      yield* makeIntegrationTargetResourceController(),
      (yield* makeApplicationExitLifecycle()).admission
    )

    expect(current).toEqual({ revision: 2, taskExecutionCapacity: 3 })
    expect([...(yield* controller.snapshot).positions]).toEqual(
      exactReconstructedPositions.map(({ attemptId, runId, taskId }) => [
        taskId,
        { _tag: "AcceptedAttemptPosition", correlation: { attemptId, runId } }
      ])
    )
  }).pipe(
    Effect.provide(taskWorkCapacityControlLayer),
    Effect.provide(memoryJournalTestLayer),
    Effect.provide(plannedAttemptProtocolControllerLayer)
  )
)

it.effect("restart holds the task-work position until an exact Safe or Terminal observation is accepted", () =>
  Effect.sync(() => {
    const runId = RunId.make("pending-executor-report-capacity-run")
    const plannedAttempt = PlannedTaskAttempt.make({
      attemptId: AttemptId.make("pending-executor-report-capacity-attempt"),
      baseSha: GitCommitSha.make("9".repeat(40)),
      branch: TaskBranchRef.make("refs/heads/dalph/pending-executor-report-capacity"),
      executor: TaskExecutorLocator.make("executor:controlled-fake"),
      runId,
      taskId: TaskId.make("pending-executor-report-capacity-task"),
      taskRevision: TaskRevision.make("pending-executor-report-capacity-revision"),
      worktree: WorktreeLocator.make("/worktrees/pending-executor-report-capacity")
    })
    const responsibility = {
      _tag: "PlannedAttemptExecutorWorkResponsibility" as const,
      beganAt: JournalPosition.make(1),
      plannedAttempt
    }

    for (const report of [
      PlannedAttemptExecutorReport.cases.ExecutorWorkSafelySuspended.make({
        correlation: { attemptId: plannedAttempt.attemptId, runId }
      }),
      PlannedAttemptExecutorReport.cases.ExecutorWorkTerminal.make({
        correlation: { attemptId: plannedAttempt.attemptId, runId },
        result: { _tag: "Completed" }
      })
    ]) {
      const ordinal = PlannedAttemptExecutorStateObservationOrdinal.make(1)
      const event = PlannedAttemptExecutorStateObservedEvent.make({
        observation: PlannedAttemptExecutorStateObservation.cases.ExactExecutorReport.make({ report }),
        occurrenceClassification: "NonActionOccurrence",
        ordinal,
        plannedAttempt,
        version: workflowJournalEventVersion
      })
      const positions = requiredPlannedAttemptPositionsOf({
        responsibility: { entries: [responsibility] },
        workflowHistory: {
          records: [
            {
              event,
              key: plannedAttemptExecutorStateObservedRecordKey(plannedAttempt.attemptId, ordinal),
              position: JournalPosition.make(2),
              runId
            }
          ]
        }
      })

      expect(positions).toEqual([{ attemptId: plannedAttempt.attemptId, runId, taskId: plannedAttempt.taskId }])
    }
  })
)

it.effect("restart releases the task-work position after an unchanged accepted Safe or Terminal passive replay", () =>
  Effect.sync(() => {
    const runId = RunId.make("accepted-replay-capacity-run")
    const plannedAttempt = PlannedTaskAttempt.make({
      attemptId: AttemptId.make("accepted-replay-capacity-attempt"),
      baseSha: GitCommitSha.make("8".repeat(40)),
      branch: TaskBranchRef.make("refs/heads/dalph/accepted-replay-capacity"),
      executor: TaskExecutorLocator.make("executor:controlled-fake"),
      runId,
      taskId: TaskId.make("accepted-replay-capacity-task"),
      taskRevision: TaskRevision.make("accepted-replay-capacity-revision"),
      worktree: WorktreeLocator.make("/worktrees/accepted-replay-capacity")
    })
    const responsibility = {
      _tag: "PlannedAttemptExecutorWorkResponsibility" as const,
      beganAt: JournalPosition.make(1),
      plannedAttempt
    }

    for (const report of [
      PlannedAttemptExecutorReport.cases.ExecutorWorkSafelySuspended.make({
        correlation: { attemptId: plannedAttempt.attemptId, runId }
      }),
      PlannedAttemptExecutorReport.cases.ExecutorWorkTerminal.make({
        correlation: { attemptId: plannedAttempt.attemptId, runId },
        result: { _tag: "Completed" }
      })
    ]) {
      const reportOrdinal = PlannedAttemptExecutorReportOrdinal.make(1)
      const observationOrdinal = PlannedAttemptExecutorStateObservationOrdinal.make(1)
      const accepted = PlannedAttemptExecutorWorkReportedEvent.make({
        ordinal: reportOrdinal,
        report,
        version: workflowJournalEventVersion
      })
      const replayed = PlannedAttemptExecutorStateObservedEvent.make({
        observation: PlannedAttemptExecutorStateObservation.cases.ExactExecutorReport.make({ report }),
        occurrenceClassification: "NonActionOccurrence",
        ordinal: observationOrdinal,
        plannedAttempt,
        version: workflowJournalEventVersion
      })
      const positions = requiredPlannedAttemptPositionsOf({
        responsibility: { entries: [responsibility] },
        workflowHistory: {
          records: [
            {
              event: accepted,
              key: plannedAttemptExecutorWorkReportedRecordKey(plannedAttempt.attemptId, reportOrdinal),
              position: JournalPosition.make(2),
              runId
            },
            {
              event: replayed,
              key: plannedAttemptExecutorStateObservedRecordKey(plannedAttempt.attemptId, observationOrdinal),
              position: JournalPosition.make(3),
              runId
            }
          ]
        }
      })

      expect(positions).toEqual([])
    }
  })
)
