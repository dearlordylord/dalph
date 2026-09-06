import { it } from "@effect/vitest"
import {
  AttemptId,
  GitCommitSha,
  PlannedTaskAttempt,
  RunId,
  TaskBranchRef,
  TaskExecutorLocator,
  TaskId,
  TaskRevision,
  WorktreeLocator,
  makeTaskWorkSpecification
} from "@dalph/contracts"
import { Effect, Layer } from "effect"
import { expect } from "vitest"
import { ClaimOwner, ClaimToken } from "../../authorities/task-tracker/claim.js"
import { ActiveTaskClaim } from "../../authorities/task-tracker/claim-mutation.js"
import { FixtureTarget } from "../../authorities/task-tracker/fixture/target.js"
import { InitialControlPolicy } from "../../control/policy.js"
import { memoryJournalTestLayer } from "../../workflow-journal/adapters/memory-store.js"
import { journaledWorkflowInterpreterLayer } from "../../workflow-journal/journaled-interpreter.js"
import { JournalPosition } from "../../workflow-journal/identity.js"
import { attemptPlanRecordKey, intentRecordKey, outcomeRecordKey } from "../../workflow-journal/record-key.js"
import { JournalStore } from "../../workflow-journal/store.js"
import { OperationId } from "../../workflow/identity.js"
import { WorkflowInterpreter, type WorkflowInterpreterService } from "../../workflow/interpretation/interpreter.js"
import { workflowJournalEventVersion } from "../../workflow/kernel/event.js"
import { beginPlannedAttemptExecutorResponsibility } from "../../workflow/protocols/planned-attempt-executor-work/responsibility.js"
import {
  TaskAttemptPlannedEvent,
  TaskClaimAcquiredEvent,
  TaskClaimAcquisitionIntendedEvent
} from "../../workflow/registry/event.js"
import {
  makeTaskAttemptPlanOperation,
  makeTaskClaimAcquisitionOperation,
  makeTaskWorkSpecificationObservationOperation
} from "../../workflow/registry/operation.js"
import {
  makeFocusedTaskWorkSpecificationFactsObserved,
  taskTrackerFactsObservedEvent
} from "../../workflow/task-tracker-facts/observation.js"
import { acceptedFreshAttemptLineage, freshAttemptPlanPredecessorLineageWasAccepted } from "./fresh-attempt-lineage.js"
import { TaskWorkCapacity } from "./capacity.js"

const runId = RunId.make("fresh-attempt-lineage-writers")
const plannedAttempt = PlannedTaskAttempt.make({
  attemptId: AttemptId.make("fresh-attempt-lineage-writers-attempt"),
  baseSha: GitCommitSha.make("a".repeat(40)),
  branch: TaskBranchRef.make("refs/heads/dalph/fresh-attempt-lineage-writers"),
  executor: TaskExecutorLocator.make("executor:fresh-attempt-lineage-writers"),
  runId,
  taskId: TaskId.make("fresh-attempt-lineage-writers-task"),
  taskRevision: TaskRevision.make("fresh-attempt-lineage-writers-revision"),
  worktree: WorktreeLocator.make("/worktrees/fresh-attempt-lineage-writers")
})
const planOperation = makeTaskAttemptPlanOperation({
  operationId: OperationId.make("fresh-attempt-lineage-writers-plan"),
  plannedAttempt,
  predecessorOperationIds: []
})

const unused = () => Effect.die("unused")
const provider = Layer.succeed(
  WorkflowInterpreter,
  WorkflowInterpreter.of({
    acquireTaskClaim: unused,
    readTaskClaim: unused,
    readTaskWorkSpecification: unused,
    readTaskWorktree: unused,
    readTargetLineage: unused,
    readTrackerGraph: unused,
    reconcileTaskWorktree: unused,
    recordTaskAttemptPlan: unused,
    releaseTaskClaim: unused
  } satisfies WorkflowInterpreterService)
)
const journaled = journaledWorkflowInterpreterLayer(runId, provider).pipe(Layer.provide(memoryJournalTestLayer))

const beginRun = Effect.fn("FreshAttemptLineageWritersTest.beginRun")(function* () {
  const journal = yield* JournalStore
  yield* journal.beginRun(
    runId,
    FixtureTarget.make("fresh-attempt-lineage-writers-target"),
    InitialControlPolicy.make({ taskExecutionCapacity: TaskWorkCapacity.make(1) })
  )
  return journal
})

it.effect("rejects a fresh attempt plan before append when its exact predecessor lineage is absent", () =>
  Effect.gen(function* () {
    const journal = yield* beginRun()
    const interpreter = yield* WorkflowInterpreter

    const failure = yield* Effect.flip(interpreter.recordTaskAttemptPlan(planOperation))

    expect(failure).toMatchObject({
      _tag: "TaskAttemptPlanHistoryContradiction",
      attemptId: plannedAttempt.attemptId,
      operationId: planOperation.operationId,
      reason: "CausalPredecessorMissing"
    })
    expect((yield* journal.read(runId)).some(({ event }) => event._tag === "TaskAttemptPlanned")).toBe(false)
  }).pipe(Effect.provide(journaled), Effect.provide(memoryJournalTestLayer))
)

it.effect("refuses a focused specification outcome without its exact read intent", () =>
  Effect.sync(() => {
    const hostileTaskId = TaskId.make("fresh-attempt-lineage-writers-hostile-task")
    const hostileTarget = FixtureTarget.make("fresh-attempt-lineage-writers-hostile-target")
    const hostileClaimOperation = makeTaskClaimAcquisitionOperation({
      acquisition: {
        operationId: OperationId.make("fresh-attempt-lineage-writers-hostile-claim"),
        owner: ClaimOwner.make("dalph:fresh-attempt-lineage-writers-hostile"),
        taskId: hostileTaskId,
        token: ClaimToken.make("fresh-attempt-lineage-writers-hostile-token")
      },
      predecessorOperationIds: []
    })
    const hostileSpecification = makeTaskWorkSpecification({
      body: "Hostile specification outcome",
      taskId: hostileTaskId,
      title: "Hostile specification"
    })
    const hostilePlannedAttempt = PlannedTaskAttempt.make({
      attemptId: AttemptId.make("fresh-attempt-lineage-writers-hostile-attempt"),
      baseSha: GitCommitSha.make("b".repeat(40)),
      branch: TaskBranchRef.make("refs/heads/dalph/fresh-attempt-lineage-writers-hostile"),
      executor: TaskExecutorLocator.make("executor:fresh-attempt-lineage-writers-hostile"),
      runId,
      taskId: hostileTaskId,
      taskRevision: TaskRevision.make(hostileSpecification.fingerprint),
      worktree: WorktreeLocator.make("/worktrees/fresh-attempt-lineage-writers-hostile")
    })
    const hostileSpecificationOperation = makeTaskWorkSpecificationObservationOperation(
      OperationId.make("fresh-attempt-lineage-writers-hostile-specification"),
      hostileTarget,
      hostileTaskId,
      [hostileClaimOperation.acquisition.operationId]
    )
    const hostilePlanOperation = makeTaskAttemptPlanOperation({
      operationId: OperationId.make("fresh-attempt-lineage-writers-hostile-plan"),
      plannedAttempt: hostilePlannedAttempt,
      predecessorOperationIds: [
        hostileClaimOperation.acquisition.operationId,
        hostileSpecificationOperation.operationId
      ]
    })
    const rows = [
      {
        event: TaskClaimAcquisitionIntendedEvent.make({
          operation: hostileClaimOperation,
          version: workflowJournalEventVersion
        }),
        key: intentRecordKey(hostileClaimOperation.acquisition.operationId)
      },
      {
        event: TaskClaimAcquiredEvent.make({
          claim: ActiveTaskClaim.make(hostileClaimOperation.acquisition),
          version: workflowJournalEventVersion
        }),
        key: outcomeRecordKey(hostileClaimOperation.acquisition.operationId)
      },
      {
        event: taskTrackerFactsObservedEvent(
          hostileSpecificationOperation.operationId,
          makeFocusedTaskWorkSpecificationFactsObserved(hostileSpecificationOperation, hostileSpecification)
        ),
        key: outcomeRecordKey(hostileSpecificationOperation.operationId)
      },
      {
        event: TaskAttemptPlannedEvent.make({ operation: hostilePlanOperation, version: workflowJournalEventVersion }),
        key: attemptPlanRecordKey(hostilePlannedAttempt.attemptId)
      }
    ].map((row, index) => ({ ...row, position: JournalPosition.make(index + 1), runId }))

    expect(acceptedFreshAttemptLineage(rows, hostilePlannedAttempt, "Plan")).toBeUndefined()
    expect(freshAttemptPlanPredecessorLineageWasAccepted(rows, hostilePlanOperation)).toBe(false)
  })
)

it.effect("rejects executor responsibility before append when an ordinary plan lacks worktree-ready lineage", () =>
  Effect.gen(function* () {
    const journal = yield* beginRun()
    yield* journal.append(
      runId,
      attemptPlanRecordKey(plannedAttempt.attemptId),
      TaskAttemptPlannedEvent.make({ operation: planOperation, version: workflowJournalEventVersion })
    )

    const failure = yield* Effect.flip(beginPlannedAttemptExecutorResponsibility(plannedAttempt))

    expect(failure).toMatchObject({
      _tag: "PlannedAttemptExecutorResponsibilityLineageMissing",
      correlation: { attemptId: plannedAttempt.attemptId, runId }
    })
    expect(
      (yield* journal.read(runId)).some(({ event }) => event._tag === "PlannedAttemptExecutorWorkResponsibilityBegan")
    ).toBe(false)
  }).pipe(Effect.provide(memoryJournalTestLayer))
)
