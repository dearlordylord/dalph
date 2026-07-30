import { Schema } from "effect"
import { type IntegrationTarget, type TaskId } from "@dalph/contracts"
import { type TrackerTarget } from "../../authorities/task-tracker/target.js"
import {
  IntegrationTarget as IntegrationTargetSchema,
  PlannedTaskAttempt,
  TaskId as TaskIdSchema
} from "@dalph/contracts"
import { OperationId } from "../identity.js"
import { TrackerTarget as TrackerTargetSchema } from "../../authorities/task-tracker/target.js"
import { TaskClaimAcquisition, TaskClaimRelease } from "../../authorities/task-tracker/claim-mutation.js"
import { ControlCommandId } from "../../control/identity.js"

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
  A extends { readonly operationId: OperationId; readonly predecessorOperationIds: ReadonlyArray<OperationId> }
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

/** Reads the tracker's current exact claim record for one responsible task. */
const ReadTaskClaimOperation = Schema.TaggedStruct("ReadTaskClaim", {
  operationId: OperationId,
  predecessorOperationIds: CausalPredecessorOperationIds,
  target: TrackerTargetSchema,
  taskId: TaskIdSchema
}).check(Schema.makeFilter(withoutSelfPredecessor))

/**
 * The durable authority for one claim acquisition. Ordinary task selection and
 * an authenticated operator request are distinct domain phenomena.
 */
export const TaskClaimAcquisitionAuthority = Schema.TaggedUnion({
  ExplicitTaskClaimReacquisitionAuthority: { commandId: ControlCommandId },
  TaskSelectionAuthority: {}
})
export type TaskClaimAcquisitionAuthority = typeof TaskClaimAcquisitionAuthority.Type

const AcquireTaskClaimOperation = Schema.TaggedStruct("AcquireTaskClaim", {
  acquisition: TaskClaimAcquisition,
  authority: TaskClaimAcquisitionAuthority,
  predecessorOperationIds: CausalPredecessorOperationIds
}).check(
  Schema.makeFilter((operation) =>
    withoutSelfPredecessor({
      operationId: operation.acquisition.operationId,
      predecessorOperationIds: operation.predecessorOperationIds
    })
  )
)

const ReleaseTaskClaimOperation = Schema.TaggedStruct("ReleaseTaskClaim", {
  predecessorOperationIds: CausalPredecessorOperationIds,
  release: TaskClaimRelease
}).check(
  Schema.makeFilter((operation) => {
    const selfPredecessor = withoutSelfPredecessor({
      operationId: operation.release.operationId,
      predecessorOperationIds: operation.predecessorOperationIds
    })
    if (selfPredecessor !== undefined) return selfPredecessor
    return operation.predecessorOperationIds.includes(operation.release.claim.operationId)
      ? undefined
      : { issue: "a claim release must causally name the exact claim acquisition", path: ["predecessorOperationIds"] }
  })
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

/** Reads Git's current registration for one previously prepared planned-attempt worktree. */
const ReadTaskWorktreeOperation = Schema.TaggedStruct("ReadTaskWorktree", {
  operationId: OperationId,
  plannedAttempt: PlannedTaskAttempt,
  predecessorOperationIds: CausalPredecessorOperationIds
}).check(Schema.makeFilter(withoutSelfPredecessor))

/** Reads the exact configured target head and its ancestry relationship to one planned Base SHA. */
const ReadTargetLineageOperation = Schema.TaggedStruct("ReadTargetLineage", {
  integrationTarget: IntegrationTargetSchema,
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
    ReadTaskClaimOperation,
    AcquireTaskClaimOperation,
    ReleaseTaskClaimOperation,
    RecordTaskAttemptPlanOperation,
    ReconcileTaskWorktreeOperation,
    ReadTaskWorktreeOperation,
    ReadTargetLineageOperation
  ]),
  {
    cases: {
      AcquireTaskClaim: AcquireTaskClaimOperation,
      ReleaseTaskClaim: ReleaseTaskClaimOperation,
      RecordTaskAttemptPlan: RecordTaskAttemptPlanOperation,
      ReconcileTaskWorktree: ReconcileTaskWorktreeOperation,
      ReadTaskClaim: ReadTaskClaimOperation,
      ReadTaskWorktree: ReadTaskWorktreeOperation,
      ReadTargetLineage: ReadTargetLineageOperation,
      ReadTrackerGraph: ReadTrackerGraphOperation,
      ReadTaskWorkSpecification: ReadTaskWorkSpecificationOperation
    }
  }
)
export type WorkflowOperation = typeof WorkflowOperation.Type

interface CausalGraphEntry {
  readonly operationId: OperationId
  readonly predecessorOperationIds: ReadonlyArray<OperationId>
}

export const workflowOperationId = (operation: WorkflowOperation): OperationId =>
  operation._tag === "AcquireTaskClaim"
    ? operation.acquisition.operationId
    : operation._tag === "ReleaseTaskClaim"
      ? operation.release.operationId
      : operation.operationId

const orderedBefore = -1
const orderedSame = 0
const orderedAfter = 1

/** Canonical code-unit order; independent of host locale and presentation rules. */
const compareOperationIds = (left: OperationId, right: OperationId): number =>
  left < right ? orderedBefore : left > right ? orderedAfter : orderedSame

export const causalGraphProjection = (operations: ReadonlyArray<WorkflowOperation>): ReadonlyArray<CausalGraphEntry> =>
  operations
    .map((operation) => ({
      operationId: workflowOperationId(operation),
      predecessorOperationIds: operation.predecessorOperationIds
    }))
    .toSorted((left, right) => compareOperationIds(left.operationId, right.operationId))

const canonicalPredecessors = (predecessorOperationIds: ReadonlyArray<OperationId>) =>
  [...new Set(predecessorOperationIds)].sort(compareOperationIds)

export const makeTrackerGraphObservationOperation = (
  operationId: OperationId,
  target: TrackerTarget,
  predecessorOperationIds: ReadonlyArray<OperationId> = [],
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
  operationId: OperationId,
  target: TrackerTarget,
  taskId: TaskId,
  predecessorOperationIds: ReadonlyArray<OperationId> = []
): typeof WorkflowOperation.cases.ReadTaskWorkSpecification.Type =>
  WorkflowOperation.cases.ReadTaskWorkSpecification.make({
    operationId,
    predecessorOperationIds: canonicalPredecessors(predecessorOperationIds),
    target,
    taskId
  })

export const makeTaskClaimObservationOperation = (
  operationId: OperationId,
  target: TrackerTarget,
  taskId: TaskId,
  predecessorOperationIds: ReadonlyArray<OperationId> = []
): typeof WorkflowOperation.cases.ReadTaskClaim.Type =>
  WorkflowOperation.cases.ReadTaskClaim.make({
    operationId,
    predecessorOperationIds: canonicalPredecessors(predecessorOperationIds),
    target,
    taskId
  })

export const makeTaskClaimAcquisitionOperation = (fields: {
  readonly acquisition: TaskClaimAcquisition
  readonly authority?: TaskClaimAcquisitionAuthority
  readonly predecessorOperationIds: ReadonlyArray<OperationId>
}): typeof WorkflowOperation.cases.AcquireTaskClaim.Type =>
  WorkflowOperation.cases.AcquireTaskClaim.make({
    acquisition: fields.acquisition,
    authority: fields.authority ?? TaskClaimAcquisitionAuthority.cases.TaskSelectionAuthority.make({}),
    predecessorOperationIds: canonicalPredecessors(fields.predecessorOperationIds)
  })

export const makeTaskClaimReleaseOperation = (fields: {
  readonly predecessorOperationIds: ReadonlyArray<OperationId>
  readonly release: TaskClaimRelease
}): typeof WorkflowOperation.cases.ReleaseTaskClaim.Type =>
  WorkflowOperation.cases.ReleaseTaskClaim.make({
    ...fields,
    predecessorOperationIds: canonicalPredecessors(fields.predecessorOperationIds)
  })

export const makeTaskAttemptPlanOperation = (fields: {
  readonly operationId: OperationId
  readonly plannedAttempt: PlannedTaskAttempt
  readonly predecessorOperationIds: ReadonlyArray<OperationId>
}): typeof WorkflowOperation.cases.RecordTaskAttemptPlan.Type =>
  WorkflowOperation.cases.RecordTaskAttemptPlan.make({
    ...fields,
    predecessorOperationIds: canonicalPredecessors(fields.predecessorOperationIds)
  })

export const makeTaskWorktreeReconciliationOperation = (fields: {
  readonly operationId: OperationId
  readonly plannedAttempt: PlannedTaskAttempt
  readonly predecessorOperationIds: ReadonlyArray<OperationId>
}): typeof WorkflowOperation.cases.ReconcileTaskWorktree.Type =>
  WorkflowOperation.cases.ReconcileTaskWorktree.make({
    ...fields,
    predecessorOperationIds: canonicalPredecessors(fields.predecessorOperationIds)
  })

export const makeTaskWorktreeObservationOperation = (fields: {
  readonly operationId: OperationId
  readonly plannedAttempt: PlannedTaskAttempt
  readonly predecessorOperationIds: ReadonlyArray<OperationId>
}): typeof WorkflowOperation.cases.ReadTaskWorktree.Type =>
  WorkflowOperation.cases.ReadTaskWorktree.make({
    ...fields,
    predecessorOperationIds: canonicalPredecessors(fields.predecessorOperationIds)
  })

export const makeTargetLineageObservationOperation = (fields: {
  readonly integrationTarget: IntegrationTarget
  readonly operationId: OperationId
  readonly plannedAttempt: PlannedTaskAttempt
  readonly predecessorOperationIds: ReadonlyArray<OperationId>
}): typeof WorkflowOperation.cases.ReadTargetLineage.Type =>
  WorkflowOperation.cases.ReadTargetLineage.make({
    ...fields,
    predecessorOperationIds: canonicalPredecessors(fields.predecessorOperationIds)
  })
