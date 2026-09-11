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
import { Effect, Layer, Option } from "effect"
import { expect } from "vitest"
import { ClaimOwner, ClaimToken } from "../../authorities/task-tracker/claim.js"
import { ActiveTaskClaim } from "../../authorities/task-tracker/claim-mutation.js"
import { FixtureTarget } from "../../authorities/task-tracker/fixture/target.js"
import { InitialControlPolicy } from "../../control/policy.js"
import { memoryJournalTestLayer } from "../../workflow-journal/adapters/memory-store.js"
import { journaledWorkflowInterpreterLayer } from "../../workflow-journal/journaled-interpreter.js"
import { JournalPosition } from "../../workflow-journal/identity.js"
import {
  journalEvidenceFrom,
  journalGraphSnapshotForObservation
} from "../../workflow-journal/record-evidence.js"
import { attemptPlanRecordKey, intentRecordKey, outcomeRecordKey } from "../../workflow-journal/record-key.js"
import { observeJournalRecordSequenceOperations } from "../../workflow-journal/record-sequence.js"
import { JournalStore, type JournalRecord } from "../../workflow-journal/store.js"
import { OperationId } from "../../workflow/identity.js"
import { WorkflowInterpreter, type WorkflowInterpreterService } from "../../workflow/interpretation/interpreter.js"
import { workflowJournalEventVersion } from "../../workflow/kernel/event.js"
import { beginPlannedAttemptExecutorResponsibility } from "../../workflow/protocols/planned-attempt-executor-work/responsibility.js"
import {
  TaskAttemptPlannedEvent,
  TaskClaimAcquiredEvent,
  TaskClaimAcquisitionIntendedEvent,
  taskTrackerReadIntent
} from "../../workflow/registry/event.js"
import {
  makeTaskAttemptPlanOperation,
  makeTaskClaimAcquisitionOperation,
  makeTaskWorkSpecificationObservationOperation,
  makeTrackerGraphObservationOperation
} from "../../workflow/registry/operation.js"
import {
  makeCompleteTaskTrackerFactsObserved,
  makeFocusedTaskWorkSpecificationFactsObserved,
  taskTrackerFactsObservedEvent
} from "../../workflow/task-tracker-facts/observation.js"
import { makeTaskTrackerFactsObservedFromRead } from "../../workflow/protocols/task-tracker-read/protocol.js"
import { acceptedFreshAttemptLineage, freshAttemptPlanPredecessorLineageWasAccepted } from "./fresh-attempt-lineage.js"
import { TaskWorkCapacity } from "./capacity.js"
import { validSnapshot } from "../../../test/task-dag.js"

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

const repeatedUnchangedLineage = (count: number) => {
  const taskId = TaskId.make(`fresh-attempt-lineage-repeated-${count}`)
  const target = FixtureTarget.make(`fresh-attempt-lineage-repeated-target-${count}`)
  const specification = makeTaskWorkSpecification({ body: "Repeated graph reads", taskId, title: "Repeated" })
  const attempt = PlannedTaskAttempt.make({
    ...plannedAttempt,
    attemptId: AttemptId.make(`fresh-attempt-lineage-repeated-attempt-${count}`),
    taskId,
    taskRevision: TaskRevision.make(specification.fingerprint)
  })
  const claimOperation = makeTaskClaimAcquisitionOperation({
    acquisition: {
      operationId: OperationId.make(`fresh-attempt-lineage-repeated-claim-${count}`),
      owner: ClaimOwner.make("dalph:fresh-attempt-lineage-repeated"),
      taskId,
      token: ClaimToken.make(`fresh-attempt-lineage-repeated-token-${count}`)
    },
    predecessorOperationIds: []
  })
  const snapshot = validSnapshot({
    revision: `fresh-attempt-lineage-repeated-revision-${count}`,
    tasks: [{ id: taskId, lifecycle: { _tag: "Open" }, parentTaskId: null, prerequisiteIds: [] }]
  })
  const records: Array<JournalRecord> = []
  const append = (event: JournalRecord["event"], key: JournalRecord["key"]) =>
    records.push({ event, key, position: JournalPosition.make(records.length + 1), runId })
  append(
    TaskClaimAcquisitionIntendedEvent.make({ operation: claimOperation, version: workflowJournalEventVersion }),
    intentRecordKey(claimOperation.acquisition.operationId)
  )
  append(
    TaskClaimAcquiredEvent.make({
      claim: ActiveTaskClaim.make(claimOperation.acquisition),
      version: workflowJournalEventVersion
    }),
    outcomeRecordKey(claimOperation.acquisition.operationId)
  )
  const fullRead = makeTrackerGraphObservationOperation(
    { _tag: "WorkflowEstablishment" },
    OperationId.make(`fresh-attempt-lineage-repeated-full-${count}`),
    target,
    [claimOperation.acquisition.operationId],
    [taskId]
  )
  append(taskTrackerReadIntent(fullRead), intentRecordKey(fullRead.operationId))
  append(
    taskTrackerFactsObservedEvent(
      fullRead.operationId,
      makeCompleteTaskTrackerFactsObserved(fullRead, snapshot)
    ),
    outcomeRecordKey(fullRead.operationId)
  )
  let latestRead = fullRead
  for (let index = 0; index < count; index += 1) {
    latestRead = makeTrackerGraphObservationOperation(
      { _tag: "WorkflowEstablishment" },
      OperationId.make(`fresh-attempt-lineage-repeated-unchanged-${count}-${index}`),
      target,
      [claimOperation.acquisition.operationId],
      [taskId]
    )
    append(taskTrackerReadIntent(latestRead), intentRecordKey(latestRead.operationId))
    append(makeTaskTrackerFactsObservedFromRead(records, latestRead, snapshot), outcomeRecordKey(latestRead.operationId))
  }
  const graphPosition = JournalPosition.make(records.length)
  const specificationRead = makeTaskWorkSpecificationObservationOperation(
    OperationId.make(`fresh-attempt-lineage-repeated-specification-${count}`),
    target,
    taskId,
    [latestRead.operationId]
  )
  append(taskTrackerReadIntent(specificationRead), intentRecordKey(specificationRead.operationId))
  append(
    taskTrackerFactsObservedEvent(
      specificationRead.operationId,
      makeFocusedTaskWorkSpecificationFactsObserved(specificationRead, specification)
    ),
    outcomeRecordKey(specificationRead.operationId)
  )
  const operation = makeTaskAttemptPlanOperation({
    operationId: OperationId.make(`fresh-attempt-lineage-repeated-plan-${count}`),
    plannedAttempt: attempt,
    predecessorOperationIds: [claimOperation.acquisition.operationId, specificationRead.operationId]
  })
  return { evidence: journalEvidenceFrom(records), graphPosition, operation }
}

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

it("checks one task without traversing the full graph after 64 and 256 unchanged observations", () => {
  const fixtures = [repeatedUnchangedLineage(64), repeatedUnchangedLineage(256)]
  const visits = fixtures.map(({ evidence, graphPosition, operation }) => {
    const graph = Option.getOrThrow(journalGraphSnapshotForObservation(evidence, graphPosition))
    Object.defineProperty(graph, "eligibleTasks", {
      value: () => expect.fail("live eligibility must not traverse the full graph")
    })
    let count = 0
    const stop = observeJournalRecordSequenceOperations(() => {
      count += 1
    })
    try {
      expect(freshAttemptPlanPredecessorLineageWasAccepted(evidence, operation)).toBe(true)
    } finally {
      stop()
    }
    return count
  })
  expect(visits[0]).toBeGreaterThan(0)
  expect(visits[1]).toBe(visits[0])
})

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
