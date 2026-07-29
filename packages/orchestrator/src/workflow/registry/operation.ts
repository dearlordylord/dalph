import { Schema } from "effect"
import { type TaskId } from "@dalph/contracts"
import { type TrackerTarget } from "../../authorities/task-tracker/target.js"
import { PlannedTaskAttempt, TaskId as TaskIdSchema } from "@dalph/contracts"
import { OperationId } from "../identity.js"
import { TrackerTarget as TrackerTargetSchema } from "../../authorities/task-tracker/target.js"
import { TaskClaimAcquisition } from "../../authorities/task-tracker/claim-mutation.js"

const CausalPredecessorOperationIds = Schema.Array(OperationId).check(Schema.isUnique())

/** A complete target-closure graph read that explicitly names decision-sensitive subjects. */
const TaskGraphReadShape = Schema.TaggedUnion({
  CompleteTargetClosure: { explicitlyCoveredTaskIds: Schema.Array(TaskIdSchema).check(Schema.isUnique()) }
})

const ReadTrackerGraphOperation = Schema.TaggedStruct("ReadTrackerGraph", {
  operationId: OperationId,
  predecessorOperationIds: CausalPredecessorOperationIds,
  readShape: TaskGraphReadShape,
  target: TrackerTargetSchema
})

const withoutSelfPredecessor = <
  A extends {
    readonly operationId: typeof OperationId.Type
    readonly predecessorOperationIds: ReadonlyArray<typeof OperationId.Type>
  }
>(
  operation: A
) =>
  operation.predecessorOperationIds.includes(operation.operationId)
    ? { issue: "an operation cannot causally precede itself", path: ["predecessorOperationIds"] }
    : undefined

/** Reads one task's exact normalized authored instructions for a planned attempt. */
const ReadTaskWorkSpecificationOperation = Schema.TaggedStruct("ReadTaskWorkSpecification", {
  operationId: OperationId,
  predecessorOperationIds: CausalPredecessorOperationIds,
  target: TrackerTargetSchema,
  taskId: TaskIdSchema
}).check(Schema.makeFilter(withoutSelfPredecessor))

const AcquireTaskClaimOperation = Schema.TaggedStruct("AcquireTaskClaim", {
  acquisition: TaskClaimAcquisition,
  predecessorOperationIds: CausalPredecessorOperationIds
}).check(
  Schema.makeFilter((operation) =>
    withoutSelfPredecessor({
      operationId: operation.acquisition.operationId,
      predecessorOperationIds: operation.predecessorOperationIds
    })
  )
)

const RecordTaskAttemptPlanOperation = Schema.TaggedStruct("RecordTaskAttemptPlan", {
  operationId: OperationId,
  plannedAttempt: PlannedTaskAttempt,
  predecessorOperationIds: CausalPredecessorOperationIds
}).check(Schema.makeFilter(withoutSelfPredecessor))

const ReconcileTaskWorktreeOperation = Schema.TaggedStruct("ReconcileTaskWorktree", {
  operationId: OperationId,
  plannedAttempt: PlannedTaskAttempt,
  predecessorOperationIds: CausalPredecessorOperationIds
}).check(Schema.makeFilter(withoutSelfPredecessor))

/**
 * Generic orchestration knows only tracker, claim, plan, and Git operations.
 * Complete-attempt executor work crosses its own service boundary.
 */
export const WorkflowOperation = Object.assign(
  Schema.Union([
    ReadTrackerGraphOperation,
    ReadTaskWorkSpecificationOperation,
    AcquireTaskClaimOperation,
    RecordTaskAttemptPlanOperation,
    ReconcileTaskWorktreeOperation
  ]),
  {
    cases: {
      AcquireTaskClaim: AcquireTaskClaimOperation,
      RecordTaskAttemptPlan: RecordTaskAttemptPlanOperation,
      ReconcileTaskWorktree: ReconcileTaskWorktreeOperation,
      ReadTrackerGraph: ReadTrackerGraphOperation,
      ReadTaskWorkSpecification: ReadTaskWorkSpecificationOperation
    }
  }
)
export type WorkflowOperation = typeof WorkflowOperation.Type

interface CausalGraphEntry {
  readonly operationId: typeof OperationId.Type
  readonly predecessorOperationIds: ReadonlyArray<typeof OperationId.Type>
}

export const workflowOperationId = (operation: WorkflowOperation): typeof OperationId.Type =>
  operation._tag === "AcquireTaskClaim" ? operation.acquisition.operationId : operation.operationId

const orderedBefore = -1
const orderedSame = 0
const orderedAfter = 1

/** Canonical code-unit order; independent of host locale and presentation rules. */
const compareOperationIds = (left: typeof OperationId.Type, right: typeof OperationId.Type): number =>
  left < right ? orderedBefore : left > right ? orderedAfter : orderedSame

export const causalGraphProjection = (operations: ReadonlyArray<WorkflowOperation>): ReadonlyArray<CausalGraphEntry> =>
  operations
    .map((operation) => ({
      operationId: workflowOperationId(operation),
      predecessorOperationIds: operation.predecessorOperationIds
    }))
    .toSorted((left, right) => compareOperationIds(left.operationId, right.operationId))

const canonicalPredecessors = (predecessorOperationIds: ReadonlyArray<typeof OperationId.Type>) =>
  [...new Set(predecessorOperationIds)].sort(compareOperationIds)

export const makeTrackerGraphObservationOperation = (
  operationId: typeof OperationId.Type,
  target: TrackerTarget,
  predecessorOperationIds: ReadonlyArray<typeof OperationId.Type> = [],
  explicitlyCoveredTaskIds: ReadonlyArray<TaskId> = []
): typeof WorkflowOperation.cases.ReadTrackerGraph.Type =>
  WorkflowOperation.cases.ReadTrackerGraph.make({
    operationId,
    predecessorOperationIds: canonicalPredecessors(predecessorOperationIds),
    readShape: TaskGraphReadShape.cases.CompleteTargetClosure.make({
      explicitlyCoveredTaskIds: [...new Set(explicitlyCoveredTaskIds)].sort()
    }),
    target
  })

export const makeTaskWorkSpecificationObservationOperation = (
  operationId: typeof OperationId.Type,
  target: TrackerTarget,
  taskId: TaskId,
  predecessorOperationIds: ReadonlyArray<typeof OperationId.Type> = []
): typeof WorkflowOperation.cases.ReadTaskWorkSpecification.Type =>
  WorkflowOperation.cases.ReadTaskWorkSpecification.make({
    operationId,
    predecessorOperationIds: canonicalPredecessors(predecessorOperationIds),
    target,
    taskId
  })

export const makeTaskClaimAcquisitionOperation = (fields: {
  readonly acquisition: TaskClaimAcquisition
  readonly predecessorOperationIds: ReadonlyArray<typeof OperationId.Type>
}): typeof WorkflowOperation.cases.AcquireTaskClaim.Type =>
  WorkflowOperation.cases.AcquireTaskClaim.make({
    acquisition: fields.acquisition,
    predecessorOperationIds: canonicalPredecessors(fields.predecessorOperationIds)
  })

export const makeTaskAttemptPlanOperation = (fields: {
  readonly operationId: typeof OperationId.Type
  readonly plannedAttempt: typeof PlannedTaskAttempt.Type
  readonly predecessorOperationIds: ReadonlyArray<typeof OperationId.Type>
}): typeof WorkflowOperation.cases.RecordTaskAttemptPlan.Type =>
  WorkflowOperation.cases.RecordTaskAttemptPlan.make({
    ...fields,
    predecessorOperationIds: canonicalPredecessors(fields.predecessorOperationIds)
  })

export const makeTaskWorktreeReconciliationOperation = (fields: {
  readonly operationId: typeof OperationId.Type
  readonly plannedAttempt: typeof PlannedTaskAttempt.Type
  readonly predecessorOperationIds: ReadonlyArray<typeof OperationId.Type>
}): typeof WorkflowOperation.cases.ReconcileTaskWorktree.Type =>
  WorkflowOperation.cases.ReconcileTaskWorktree.make({
    ...fields,
    predecessorOperationIds: canonicalPredecessors(fields.predecessorOperationIds)
  })
