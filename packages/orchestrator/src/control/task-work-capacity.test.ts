import { it } from "@effect/vitest"
import {
  AttemptId,
  GitCommitSha,
  PlannedAttemptExecutor,
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
import { reduceWorkflowJournalHistory } from "../coordination/reconstruction/history.js"
import { legacyMemoryJournalStoreLayer } from "../workflow-journal/adapters/memory-store.js"
import { InRunJournal, JournalStore } from "../workflow-journal/store.js"
import { JournalPosition } from "../workflow-journal/identity.js"
import { OperationId } from "../workflow/identity.js"
import { TaskAttemptPlannedEvent, TaskWorkCapacityChangedEvent } from "../workflow/registry/event.js"
import { makeTaskAttemptPlanOperation } from "../workflow/registry/operation.js"
import { workflowJournalEventVersion } from "../workflow/kernel/event.js"
import {
  attemptPlanRecordKey,
  plannedAttemptExecutorWorkResponsibilityBeganRecordKey
} from "../workflow-journal/record-key.js"
import { PlannedAttemptExecutorWorkResponsibilityBeganEvent } from "../workflow/protocols/planned-attempt-executor-work/events.js"
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
  }).pipe(Effect.provide(legacyMemoryJournalStoreLayer))
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
    }).pipe(Effect.provide(taskWorkCapacityControlLayer), Effect.provide(legacyMemoryJournalStoreLayer))
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
  }).pipe(Effect.provide(taskWorkCapacityControlLayer), Effect.provide(legacyMemoryJournalStoreLayer))
)

it.effect("reports that capacity has no durable value before the Run begins", () =>
  Effect.gen(function* () {
    const control = yield* TaskWorkCapacityControl
    const failure = yield* control.read(RunId.make("unbegun-capacity-run")).pipe(Effect.flip)

    expect(failure).toMatchObject({ _tag: "WorkflowRunNotBegan", runId: "unbegun-capacity-run" })
  }).pipe(Effect.provide(taskWorkCapacityControlLayer), Effect.provide(legacyMemoryJournalStoreLayer))
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
  }).pipe(Effect.provide(legacyMemoryJournalStoreLayer))
)

it.effect("restart reconstructs the latest applied capacity and both unfinished task positions", () =>
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
    yield* control.apply({ capacity: 1, expectedRevision: initialRunPolicyRevision, runId })
    const attempts = ["A", "B"].map((task) =>
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
            )
          )
      },
      { discard: true }
    )
    const recovery = yield* makeRunRecoveryProjection(runId).pipe(
      Effect.provideService(
        PlannedAttemptExecutor,
        PlannedAttemptExecutor.of({
          project: () => Effect.die("restart construction does not ask the stopped fake for a report"),
          requestSuspension: () => Effect.die("restart construction does not suspend work"),
          startOrContinue: () => Effect.die("restart construction does not continue work")
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
    const controller = yield* makeDeliveryRuntimeAdmissionController(
      {
        capacity: current.taskExecutionCapacity,
        held: recovery.reconstructedPlannedAttemptPositions.map(({ attemptId, runId, taskId }) => ({
          correlation: { attemptId, runId },
          taskId
        }))
      },
      yield* makeIntegrationTargetResourceController(),
      yield* makeApplicationExitLifecycle()
    )

    expect(current).toEqual({ revision: 2, taskExecutionCapacity: 1 })
    expect([...(yield* controller.snapshot).positions.keys()]).toEqual([TaskId.make("A"), TaskId.make("B")])
  }).pipe(
    Effect.provide(taskWorkCapacityControlLayer),
    Effect.provide(legacyMemoryJournalStoreLayer),
    Effect.provide(plannedAttemptProtocolControllerLayer)
  )
)
