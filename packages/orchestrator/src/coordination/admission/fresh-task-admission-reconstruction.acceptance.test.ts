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
import { describe, expect } from "vitest"
import { validSnapshot } from "../../../test/task-dag.js"
import { PlannedWorktreeReady } from "../../authorities/git/worktree.js"
import { ClaimOwner, ClaimToken } from "../../authorities/task-tracker/claim.js"
import { ActiveTaskClaim } from "../../authorities/task-tracker/claim-mutation.js"
import { FixtureTarget } from "../../authorities/task-tracker/fixture/target.js"
import { TaskLifecycle } from "../../authorities/task-tracker/task.js"
import { InitialControlPolicy } from "../../control/policy.js"
import { makeFreshTaskAdmissionBasis, TaskAdmissionOccupancy } from "./fresh-task-admission.js"
import { projectFreshTaskAdmission } from "./fresh-task-admission-projection.js"
import { TaskWorkCapacity } from "./capacity.js"
import { makeIntegrationTargetResourceController } from "./integration-target-resource.js"
import { makeApplicationExitLifecycle } from "../application-exit/lifecycle.js"
import { deliveryProposalOfAcceptedFreshTask } from "../delivery/delivery-proposal-derivation.js"
import { makeDeliveryRuntimeAdmissionController } from "../delivery/delivery-runtime-admission.js"
import { FreshWorkflowStep } from "../delivery/fresh-workflow-step.js"
import { makeFreshTaskCandidateFrontierForTest } from "../../../test/support/fresh-task-candidate.js"
import {
  type PlannedAttemptProtocolController,
  plannedAttemptProtocolControllerLayer
} from "../../workflow/protocols/planned-attempt-executor-work/protocol-controller.js"
import { JournalPosition } from "../../workflow-journal/identity.js"
import {
  attemptPlanRecordKey,
  intentRecordKey,
  outcomeRecordKey,
  plannedAttemptExecutorWorkResponsibilityBeganRecordKey
} from "../../workflow-journal/record-key.js"
import type { JournalRecord } from "../../workflow-journal/store.js"
import { OperationId } from "../../workflow/identity.js"
import { workflowJournalEventVersion } from "../../workflow/kernel/event.js"
import { makeWorkflowRunBeganRecord } from "../../workflow-journal/run-lifecycle.js"
import {
  TaskAttemptPlannedEvent,
  TaskClaimAcquiredEvent,
  TaskClaimAcquisitionIntendedEvent,
  TaskWorktreeReadyEvent,
  TaskWorktreeReconciliationIntendedEvent,
  taskTrackerReadIntent
} from "../../workflow/registry/event.js"
import {
  makeTaskAttemptPlanOperation,
  makeTaskClaimAcquisitionOperation,
  makeTaskWorkSpecificationObservationOperation,
  makeTaskWorktreeReconciliationOperation,
  makeTrackerGraphObservationOperation
} from "../../workflow/registry/operation.js"
import {
  makeCompleteTaskTrackerFactsObserved,
  makeFocusedTaskWorkSpecificationFactsObserved,
  taskTrackerFactsObservedEvent
} from "../../workflow/task-tracker-facts/observation.js"
import { PlannedAttemptExecutorWorkResponsibilityBeganEvent } from "../../workflow/protocols/planned-attempt-executor-work/events.js"
import { reduceWorkflowJournalHistory } from "../reconstruction/history.js"

const runId = RunId.make("fresh-admission-reconstruction-acceptance")
const target = FixtureTarget.make("fresh-admission-reconstruction-target")
const capacity = TaskWorkCapacity.make(3)
const policy = InitialControlPolicy.make({ taskExecutionCapacity: capacity })
const taskIds = ["A", "B", "C", "D", "E"].map((value) => TaskId.make(value))
const taskId = Option.getOrThrowWith(Option.fromUndefinedOr(taskIds[0]), () => new Error("missing A fixture"))
const taskB = Option.getOrThrowWith(Option.fromUndefinedOr(taskIds[1]), () => new Error("missing B fixture"))
const taskC = Option.getOrThrowWith(Option.fromUndefinedOr(taskIds[2]), () => new Error("missing C fixture"))
const outsideTaskIds = taskIds.slice(3)

const graph = validSnapshot({
  revision: "fresh-admission-reconstruction-graph",
  tasks: taskIds.map((id) => ({ id, lifecycle: { _tag: "Open" as const }, parentTaskId: null, prerequisiteIds: [] }))
})

const graphOperation = makeTrackerGraphObservationOperation(
  { _tag: "WorkflowEstablishment" },
  OperationId.make("reconstruction:graph"),
  target
)
const claimOperation = makeTaskClaimAcquisitionOperation({
  acquisition: {
    operationId: OperationId.make("reconstruction:claim:A"),
    owner: ClaimOwner.make("dalph:reconstruction"),
    taskId,
    token: ClaimToken.make("reconstruction:claim:A-token")
  },
  predecessorOperationIds: [graphOperation.operationId]
})
const postClaimGraphOperation = makeTrackerGraphObservationOperation(
  { _tag: "WorkflowEstablishment" },
  OperationId.make("reconstruction:post-claim-graph:A"),
  target,
  [claimOperation.acquisition.operationId],
  [taskId]
)
const specificationOperation = makeTaskWorkSpecificationObservationOperation(
  OperationId.make("reconstruction:specification:A"),
  target,
  taskId,
  [postClaimGraphOperation.operationId]
)
const taskWorkSpecification = makeTaskWorkSpecification({ body: "Implement A", taskId, title: "Task A" })
const plannedAttempt = PlannedTaskAttempt.make({
  attemptId: AttemptId.make("reconstruction:attempt:A:1"),
  baseSha: GitCommitSha.make("1".repeat(40)),
  branch: TaskBranchRef.make("refs/heads/dalph/reconstruction-A-1"),
  executor: TaskExecutorLocator.make("executor:reconstruction"),
  runId,
  taskId,
  taskRevision: TaskRevision.make(taskWorkSpecification.fingerprint),
  worktree: WorktreeLocator.make("/worktrees/reconstruction-A-1")
})
const planOperation = makeTaskAttemptPlanOperation({
  operationId: OperationId.make("reconstruction:plan:A:1"),
  plannedAttempt,
  predecessorOperationIds: [specificationOperation.operationId]
})
const worktreeOperation = makeTaskWorktreeReconciliationOperation({
  operationId: OperationId.make("reconstruction:worktree:A:1"),
  plannedAttempt,
  predecessorOperationIds: [planOperation.operationId]
})
const worktreeProof = PlannedWorktreeReady.make({
  baseSha: plannedAttempt.baseSha,
  branch: plannedAttempt.branch,
  headSha: plannedAttempt.baseSha,
  worktree: plannedAttempt.worktree
})

type EventRow = Pick<JournalRecord, "event" | "key">

const recordsFrom = (rows: ReadonlyArray<EventRow>): ReadonlyArray<JournalRecord> =>
  rows.map((row, index) => ({ ...row, position: JournalPosition.make(index + 1), runId }))

const baseRows: ReadonlyArray<EventRow> = [
  makeWorkflowRunBeganRecord(runId, target, policy),
  { event: taskTrackerReadIntent(graphOperation), key: intentRecordKey(graphOperation.operationId) },
  {
    event: taskTrackerFactsObservedEvent(
      graphOperation.operationId,
      makeCompleteTaskTrackerFactsObserved(graphOperation, graph)
    ),
    key: outcomeRecordKey(graphOperation.operationId)
  }
]

const prefixRows: ReadonlyArray<ReadonlyArray<EventRow>> = [
  [
    {
      event: TaskClaimAcquisitionIntendedEvent.make({
        operation: claimOperation,
        version: workflowJournalEventVersion
      }),
      key: intentRecordKey(claimOperation.acquisition.operationId)
    }
  ],
  [
    {
      event: TaskClaimAcquiredEvent.make({
        claim: ActiveTaskClaim.make(claimOperation.acquisition),
        version: workflowJournalEventVersion
      }),
      key: outcomeRecordKey(claimOperation.acquisition.operationId)
    }
  ],
  [
    {
      event: taskTrackerReadIntent(postClaimGraphOperation),
      key: intentRecordKey(postClaimGraphOperation.operationId)
    },
    {
      event: taskTrackerFactsObservedEvent(
        postClaimGraphOperation.operationId,
        makeCompleteTaskTrackerFactsObserved(postClaimGraphOperation, graph)
      ),
      key: outcomeRecordKey(postClaimGraphOperation.operationId)
    }
  ],
  [
    { event: taskTrackerReadIntent(specificationOperation), key: intentRecordKey(specificationOperation.operationId) },
    {
      event: taskTrackerFactsObservedEvent(
        specificationOperation.operationId,
        makeFocusedTaskWorkSpecificationFactsObserved(specificationOperation, taskWorkSpecification)
      ),
      key: outcomeRecordKey(specificationOperation.operationId)
    }
  ],
  [
    {
      event: TaskAttemptPlannedEvent.make({ operation: planOperation, version: workflowJournalEventVersion }),
      key: attemptPlanRecordKey(plannedAttempt.attemptId)
    }
  ],
  [
    {
      event: TaskWorktreeReconciliationIntendedEvent.make({
        operation: worktreeOperation,
        version: workflowJournalEventVersion
      }),
      key: intentRecordKey(worktreeOperation.operationId)
    }
  ],
  [
    {
      event: TaskWorktreeReadyEvent.make({
        operationId: worktreeOperation.operationId,
        proof: worktreeProof,
        version: workflowJournalEventVersion
      }),
      key: outcomeRecordKey(worktreeOperation.operationId)
    }
  ],
  [
    {
      event: PlannedAttemptExecutorWorkResponsibilityBeganEvent.make({
        plannedAttempt,
        version: workflowJournalEventVersion
      }),
      key: plannedAttemptExecutorWorkResponsibilityBeganRecordKey(plannedAttempt.attemptId)
    }
  ]
]

const commitment = (() => {
  const projection = projectFreshTaskAdmission(runId, recordsFrom([...baseRows, ...(prefixRows[0] ?? [])]))
  if (projection._tag === "FreshTaskAdmissionProjectionInvalid") return expect.fail(projection.issues.join("; "))
  return Option.getOrThrowWith(
    Option.fromUndefinedOr(projection.commitments[0]?.commitment),
    () => new Error("reconstruction claim must be a fresh task commitment")
  )
})()

const occupiedAttemptFor = (id: TaskId, suffix: string) =>
  PlannedTaskAttempt.make({
    ...plannedAttempt,
    attemptId: AttemptId.make(`reconstruction:occupied:${suffix}`),
    branch: TaskBranchRef.make(`refs/heads/dalph/reconstruction-${suffix}`),
    taskId: id,
    taskRevision: TaskRevision.make(`reconstruction:${suffix}`),
    worktree: WorktreeLocator.make(`/worktrees/reconstruction-${suffix}`)
  })

const outsideFrontier = makeFreshTaskCandidateFrontierForTest({
  decisions: outsideTaskIds.map((id) => {
    const predecessorOperationId = OperationId.make(`reconstruction:entry:${id}`)
    const task = { id, lifecycle: TaskLifecycle.cases.Open.make({}), parentTaskId: null, prerequisiteIds: [] }
    return {
      step: FreshWorkflowStep.ReadCurrentTaskGraph({ predecessorOperationId, task }),
      transition: { _tag: "ContinueFreshWorkflowOperation" as const, operationId: predecessorOperationId, taskId: id }
    }
  }),
  runId
})

const basisFor = (prefixIndex: number, records: ReadonlyArray<JournalRecord>) => {
  const reduced = reduceWorkflowJournalHistory(runId, records)
  const reduction = Option.getOrThrowWith(
    Option.fromUndefinedOr(reduced._tag === "ValidWorkflowJournalHistory" ? reduced : undefined),
    () =>
      new Error(
        `reconstruction prefix ${prefixIndex + 1} is invalid: ${
          reduced._tag === "InvalidWorkflowJournalHistory" ? JSON.stringify(reduced.issues) : "unknown result"
        }`
      )
  )
  const freshAdmission = projectFreshTaskAdmission(runId, reduction.runState.workflowHistory.records)
  if (freshAdmission._tag === "FreshTaskAdmissionProjectionInvalid") {
    return expect.fail(
      `reconstruction prefix ${prefixIndex + 1} has invalid fresh admission: ${JSON.stringify(freshAdmission.issues)}`
    )
  }
  return {
    reduction,
    basis: Effect.runSync(
      makeFreshTaskAdmissionBasis({
        acceptedAt: freshAdmission.acceptedAt,
        capacity,
        entries: [
          TaskAdmissionOccupancy.ExactAttemptHeld({ plannedAttempt: occupiedAttemptFor(taskB, "B") }),
          TaskAdmissionOccupancy.ExactAttemptHeld({ plannedAttempt: occupiedAttemptFor(taskC, "C") })
        ],
        projection: freshAdmission,
        runId
      })
    )
  }
}

const withProtocolController = <A, E>(effect: Effect.Effect<A, E, PlannedAttemptProtocolController>) =>
  effect.pipe(Effect.provide(Layer.fresh(plannedAttemptProtocolControllerLayer)))

describe("fresh-task admission reconstruction acceptance", () => {
  it("rejects an attempt plan that has no exact prior acquired claim", () => {
    const records = recordsFrom([...baseRows, ...prefixRows.slice(2, 5).flat()])
    const reduced = reduceWorkflowJournalHistory(runId, records)

    expect(reduced._tag).toBe("InvalidWorkflowJournalHistory")
    if (reduced._tag !== "InvalidWorkflowJournalHistory") return
    expect(reduced.issues).toContainEqual(
      expect.objectContaining({
        detail: `planned attempt ${plannedAttempt.attemptId} requires exact claim, post-claim graph, and focused specification lineage`
      })
    )
  })

  it.each([
    {
      name: "the post-claim graph read",
      rows: (() => {
        const directSpecification = makeTaskWorkSpecificationObservationOperation(
          OperationId.make("reconstruction:direct-specification:A"),
          target,
          taskId,
          [claimOperation.acquisition.operationId]
        )
        const directPlan = makeTaskAttemptPlanOperation({
          operationId: OperationId.make("reconstruction:direct-plan:A"),
          plannedAttempt,
          predecessorOperationIds: [directSpecification.operationId]
        })
        return [
          ...prefixRows.slice(0, 2).flat(),
          { event: taskTrackerReadIntent(directSpecification), key: intentRecordKey(directSpecification.operationId) },
          {
            event: taskTrackerFactsObservedEvent(
              directSpecification.operationId,
              makeFocusedTaskWorkSpecificationFactsObserved(directSpecification, taskWorkSpecification)
            ),
            key: outcomeRecordKey(directSpecification.operationId)
          },
          {
            event: TaskAttemptPlannedEvent.make({ operation: directPlan, version: workflowJournalEventVersion }),
            key: attemptPlanRecordKey(plannedAttempt.attemptId)
          }
        ]
      })()
    },
    {
      name: "the focused task-work specification read",
      rows: (() => {
        const directPlan = makeTaskAttemptPlanOperation({
          operationId: OperationId.make("reconstruction:post-graph-direct-plan:A"),
          plannedAttempt,
          predecessorOperationIds: [postClaimGraphOperation.operationId]
        })
        return [
          ...prefixRows.slice(0, 3).flat(),
          {
            event: TaskAttemptPlannedEvent.make({ operation: directPlan, version: workflowJournalEventVersion }),
            key: attemptPlanRecordKey(plannedAttempt.attemptId)
          }
        ]
      })()
    }
  ])("rejects an attempt plan that skips $name", ({ rows }) => {
    const reduced = reduceWorkflowJournalHistory(runId, recordsFrom([...baseRows, ...rows]))

    expect(reduced._tag).toBe("InvalidWorkflowJournalHistory")
    if (reduced._tag !== "InvalidWorkflowJournalHistory") return
    expect(reduced.issues).toContainEqual(
      expect.objectContaining({
        detail: `planned attempt ${plannedAttempt.attemptId} requires exact claim, post-claim graph, and focused specification lineage`
      })
    )
  })

  it("rejects executor-work responsibility that skips the exact worktree-ready handoff", () => {
    const records = recordsFrom([
      ...baseRows,
      ...prefixRows.slice(0, 5).flat(),
      ...Option.getOrThrowWith(Option.fromUndefinedOr(prefixRows[7]), () => new Error("missing responsibility row"))
    ])
    const reduced = reduceWorkflowJournalHistory(runId, records)

    expect(reduced._tag).toBe("InvalidWorkflowJournalHistory")
    if (reduced._tag !== "InvalidWorkflowJournalHistory") return
    expect(reduced.issues).toContainEqual(
      expect.objectContaining({
        detail: `executor work for attempt ${plannedAttempt.attemptId} requires its exact accepted worktree-ready lineage`
      })
    )
  })

  it.effect("reconstructs every accepted restart prefix through the production admission controller", () =>
    withProtocolController(
      Effect.gen(function* () {
        for (const [prefixIndex] of prefixRows.entries()) {
          const records = recordsFrom([...baseRows, ...prefixRows.slice(0, prefixIndex + 1).flat()])
          const before = records.map(({ event, key, position, runId }) => ({ event, key, position, runId }))
          const first = basisFor(prefixIndex, records)
          const restartedRecords = records.map((record) => ({ ...record }))
          const second = basisFor(prefixIndex, restartedRecords)
          expect(second.reduction.runState).toEqual(first.reduction.runState)
          expect(restartedRecords).toEqual(before)

          const integrationTargets = yield* makeIntegrationTargetResourceController()
          const lifecycle = yield* makeApplicationExitLifecycle()
          const admission = yield* makeDeliveryRuntimeAdmissionController(
            first.basis,
            integrationTargets,
            lifecycle.admission
          )
          const snapshot = yield* admission.snapshot
          const position = snapshot.positions.get(taskId)
          expect(position?._tag).toBe(prefixIndex < 7 ? "FreshTaskCommitted" : "ExactAttemptHeld")
          if (prefixIndex < 7) {
            expect(position).toEqual(TaskAdmissionOccupancy.FreshTaskCommitted({ commitment }))
          } else {
            expect(position).toEqual(TaskAdmissionOccupancy.ExactAttemptHeld({ plannedAttempt }))
          }

          const firstOutsideAttempt = yield* admission.tryReserveFresh(
            outsideFrontier,
            deliveryProposalOfAcceptedFreshTask
          )
          const secondOutsideAttempt = yield* admission.tryReserveFresh(
            outsideFrontier,
            deliveryProposalOfAcceptedFreshTask
          )
          expect(firstOutsideAttempt).toEqual({ _tag: "Deferred", reason: "TaskWorkPositionUnavailable" })
          expect(secondOutsideAttempt).toEqual({ _tag: "Deferred", reason: "TaskWorkPositionUnavailable" })
          expect((yield* admission.snapshot).positions.size).toBe(3)
          expect(records).toEqual(before)
        }
      })
    )
  )
})
