import { Schema } from "effect"
import type { TrackerTarget } from "./domain.js"
import { OperationId, TrackerTarget as TrackerTargetSchema } from "./domain.js"
import { TaskWorkStartRequest } from "./task-work-start.js"

const CausalPredecessorOperationIds = Schema.Array(OperationId).check(
  Schema.isUnique()
)

const ReadTrackerGraphOperation = Schema.TaggedStruct(
  "ReadTrackerGraph",
  {
    operationId: OperationId,
    predecessorOperationIds: CausalPredecessorOperationIds,
    target: TrackerTargetSchema
  }
)

const EstablishTaskWorkSessionOperation = Schema.TaggedStruct(
  "EstablishTaskWorkSession",
  {
    predecessorOperationIds: CausalPredecessorOperationIds,
    request: TaskWorkStartRequest
  }
).check(
  Schema.makeFilter((operation) =>
    operation.predecessorOperationIds.includes(operation.request.operationId)
      ? {
        path: ["predecessorOperationIds"],
        issue: "an operation cannot causally precede itself"
      }
      : undefined
  )
)

export const WorkflowOperation = Object.assign(
  Schema.Union([ReadTrackerGraphOperation, EstablishTaskWorkSessionOperation]),
  {
    cases: {
      EstablishTaskWorkSession: EstablishTaskWorkSessionOperation,
      ReadTrackerGraph: ReadTrackerGraphOperation
    }
  }
)
export type WorkflowOperation = typeof WorkflowOperation.Type

/** One operation and its immutable direct edges in the causal graph. */
interface CausalGraphEntry {
  readonly operationId: OperationId
  readonly predecessorOperationIds: ReadonlyArray<OperationId>
}

export const workflowOperationId = (operation: WorkflowOperation): OperationId =>
  operation._tag === "ReadTrackerGraph"
    ? operation.operationId
    : operation.request.operationId

/** Projects causality independently of the journal order used to observe it. */
export const causalGraphProjection = (
  operations: ReadonlyArray<WorkflowOperation>
): ReadonlyArray<CausalGraphEntry> =>
  operations.map((operation) => ({
    operationId: workflowOperationId(operation),
    predecessorOperationIds: operation.predecessorOperationIds
  })).toSorted((left, right) => left.operationId.localeCompare(right.operationId))

export const makeTrackerGraphObservationOperation = (
  operationId: OperationId,
  target: TrackerTarget
): typeof WorkflowOperation.cases.ReadTrackerGraph.Type =>
  WorkflowOperation.cases.ReadTrackerGraph.make({
    operationId,
    predecessorOperationIds: [],
    target
  })

export const makeTaskWorkSessionEstablishmentOperation = (
  fields: {
    readonly predecessorOperationIds: ReadonlyArray<OperationId>
    readonly request: TaskWorkStartRequest
  }
): typeof WorkflowOperation.cases.EstablishTaskWorkSession.Type =>
  WorkflowOperation.cases.EstablishTaskWorkSession.make({
    ...fields,
    predecessorOperationIds: [...new Set(fields.predecessorOperationIds)].sort()
  })
