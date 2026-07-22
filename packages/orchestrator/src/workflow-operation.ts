import { Schema } from "effect"
import type { TrackerTarget } from "./domain.js"
import { OperationId, PlannedTaskAttempt, TrackerTarget as TrackerTargetSchema } from "./domain.js"
import { ImplementationReviewRequest, ReviewFindingsHandbackRequest } from "./implementation-review.js"
import { TaskExecutionOutcome, TaskExecutionRequest } from "./task-execution.js"
import { TaskWorkStartRequest } from "./task-work-start.js"
import { TaskClaimAcquisition } from "./tracker-mutation.js"

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

const AcquireTaskClaimOperation = Schema.TaggedStruct(
  "AcquireTaskClaim",
  {
    acquisition: TaskClaimAcquisition,
    predecessorOperationIds: CausalPredecessorOperationIds
  }
).check(
  Schema.makeFilter((operation) =>
    operation.predecessorOperationIds.includes(operation.acquisition.operationId)
      ? {
        path: ["predecessorOperationIds"],
        issue: "an operation cannot causally precede itself"
      }
      : undefined
  )
)

const RecordTaskAttemptPlanOperation = Schema.TaggedStruct(
  "RecordTaskAttemptPlan",
  {
    operationId: OperationId,
    plannedAttempt: PlannedTaskAttempt,
    predecessorOperationIds: CausalPredecessorOperationIds
  }
).check(
  Schema.makeFilter((operation) =>
    operation.predecessorOperationIds.includes(operation.operationId)
      ? {
        path: ["predecessorOperationIds"],
        issue: "an operation cannot causally precede itself"
      }
      : undefined
  )
)

const ReconcileTaskWorktreeOperation = Schema.TaggedStruct(
  "ReconcileTaskWorktree",
  {
    operationId: OperationId,
    plannedAttempt: PlannedTaskAttempt,
    predecessorOperationIds: CausalPredecessorOperationIds
  }
).check(
  Schema.makeFilter((operation) =>
    operation.predecessorOperationIds.includes(operation.operationId)
      ? {
        path: ["predecessorOperationIds"],
        issue: "an operation cannot causally precede itself"
      }
      : undefined
  )
)

const ExecuteTaskWorkOperation = Schema.TaggedStruct(
  "ExecuteTaskWork",
  {
    predecessorOperationIds: CausalPredecessorOperationIds,
    request: TaskExecutionRequest
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

const SealImplementationEvidenceOperation = Schema.TaggedStruct(
  "SealImplementationEvidence",
  {
    operationId: OperationId,
    execution: Schema.TaggedUnion({
      SuccessfulExecution: { outcome: TaskExecutionOutcome.cases.Succeeded },
      SimulatedExecution: { predecessorOperationId: OperationId }
    }),
    plannedAttempt: PlannedTaskAttempt,
    predecessorOperationIds: CausalPredecessorOperationIds
  }
).check(
  Schema.makeFilter((operation) =>
    operation.predecessorOperationIds.length === 1
      && operation.predecessorOperationIds[0] === (
          operation.execution._tag === "SuccessfulExecution"
            ? operation.execution.outcome.operationId
            : operation.execution.predecessorOperationId
        )
      ? undefined
      : {
        path: ["predecessorOperationIds"],
        issue: "implementation evidence must directly follow its successful execution"
      }
  )
)

const ReviewImplementationOperation = Schema.TaggedStruct(
  "ReviewImplementation",
  {
    predecessorOperationIds: CausalPredecessorOperationIds,
    request: ImplementationReviewRequest
  }
).check(
  Schema.makeFilter((operation) =>
    operation.predecessorOperationIds.length === 1
      && operation.predecessorOperationIds[0] === operation.request.evidenceSealingOperationId
      ? undefined
      : {
        path: ["predecessorOperationIds"],
        issue: "implementation review must directly follow its sealed evidence"
      }
  )
)

const HandBackReviewFindingsOperation = Schema.TaggedStruct(
  "HandBackReviewFindings",
  {
    predecessorOperationIds: CausalPredecessorOperationIds,
    request: ReviewFindingsHandbackRequest
  }
).check(
  Schema.makeFilter((operation) =>
    operation.predecessorOperationIds.length === 1
      && operation.predecessorOperationIds[0] === operation.request.reviewOperationId
      ? undefined
      : {
        path: ["predecessorOperationIds"],
        issue: "findings handback must directly follow its review evidence"
      }
  )
)

export const WorkflowOperation = Object.assign(
  Schema.Union([
    ReadTrackerGraphOperation,
    AcquireTaskClaimOperation,
    RecordTaskAttemptPlanOperation,
    ReconcileTaskWorktreeOperation,
    EstablishTaskWorkSessionOperation,
    ExecuteTaskWorkOperation,
    SealImplementationEvidenceOperation,
    ReviewImplementationOperation,
    HandBackReviewFindingsOperation
  ]),
  {
    cases: {
      AcquireTaskClaim: AcquireTaskClaimOperation,
      EstablishTaskWorkSession: EstablishTaskWorkSessionOperation,
      ExecuteTaskWork: ExecuteTaskWorkOperation,
      HandBackReviewFindings: HandBackReviewFindingsOperation,
      ReviewImplementation: ReviewImplementationOperation,
      SealImplementationEvidence: SealImplementationEvidenceOperation,
      RecordTaskAttemptPlan: RecordTaskAttemptPlanOperation,
      ReconcileTaskWorktree: ReconcileTaskWorktreeOperation,
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
    : operation._tag === "AcquireTaskClaim"
    ? operation.acquisition.operationId
    : operation._tag === "RecordTaskAttemptPlan"
    ? operation.operationId
    : operation._tag === "ReconcileTaskWorktree"
    ? operation.operationId
    : operation._tag === "ExecuteTaskWork"
    ? operation.request.operationId
    : operation._tag === "SealImplementationEvidence"
    ? operation.operationId
    : operation._tag === "ReviewImplementation"
    ? operation.request.operationId
    : operation._tag === "HandBackReviewFindings"
    ? operation.request.operationId
    : operation.request.operationId

const orderedBefore = -1
const orderedSame = 0
const orderedAfter = 1

/** Canonical code-unit order; independent of host locale and presentation rules. */
export const compareOperationIds = (left: OperationId, right: OperationId): number =>
  left < right ? orderedBefore : left > right ? orderedAfter : orderedSame

/** Projects causality independently of the journal order used to observe it. */
export const causalGraphProjection = (
  operations: ReadonlyArray<WorkflowOperation>
): ReadonlyArray<CausalGraphEntry> =>
  operations.map((operation) => ({
    operationId: workflowOperationId(operation),
    predecessorOperationIds: operation.predecessorOperationIds
  })).toSorted((left, right) => compareOperationIds(left.operationId, right.operationId))

export const makeTrackerGraphObservationOperation = (
  operationId: OperationId,
  target: TrackerTarget,
  predecessorOperationIds: ReadonlyArray<OperationId> = []
): typeof WorkflowOperation.cases.ReadTrackerGraph.Type =>
  WorkflowOperation.cases.ReadTrackerGraph.make({
    operationId,
    predecessorOperationIds: [...new Set(predecessorOperationIds)].sort(compareOperationIds),
    target
  })

export const makeTaskClaimAcquisitionOperation = (
  fields: {
    readonly acquisition: TaskClaimAcquisition
    readonly predecessorOperationIds: ReadonlyArray<OperationId>
  }
): typeof WorkflowOperation.cases.AcquireTaskClaim.Type =>
  WorkflowOperation.cases.AcquireTaskClaim.make({
    acquisition: fields.acquisition,
    predecessorOperationIds: [...new Set(fields.predecessorOperationIds)].sort(
      compareOperationIds
    )
  })

export const makeTaskAttemptPlanOperation = (
  fields: {
    readonly operationId: OperationId
    readonly plannedAttempt: PlannedTaskAttempt
    readonly predecessorOperationIds: ReadonlyArray<OperationId>
  }
): typeof WorkflowOperation.cases.RecordTaskAttemptPlan.Type =>
  WorkflowOperation.cases.RecordTaskAttemptPlan.make({
    ...fields,
    predecessorOperationIds: [...new Set(fields.predecessorOperationIds)].sort(
      compareOperationIds
    )
  })

export const makeTaskWorkSessionEstablishmentOperation = (
  fields: {
    readonly predecessorOperationIds: ReadonlyArray<OperationId>
    readonly request: TaskWorkStartRequest
  }
): typeof WorkflowOperation.cases.EstablishTaskWorkSession.Type =>
  WorkflowOperation.cases.EstablishTaskWorkSession.make({
    ...fields,
    predecessorOperationIds: [...new Set(fields.predecessorOperationIds)].sort(compareOperationIds)
  })

export const makeTaskWorktreeReconciliationOperation = (
  fields: {
    readonly operationId: OperationId
    readonly plannedAttempt: PlannedTaskAttempt
    readonly predecessorOperationIds: ReadonlyArray<OperationId>
  }
): typeof WorkflowOperation.cases.ReconcileTaskWorktree.Type =>
  WorkflowOperation.cases.ReconcileTaskWorktree.make({
    ...fields,
    predecessorOperationIds: [...new Set(fields.predecessorOperationIds)].sort(
      compareOperationIds
    )
  })

export const makeTaskExecutionOperation = (
  fields: {
    readonly predecessorOperationIds: ReadonlyArray<OperationId>
    readonly request: TaskExecutionRequest
  }
): typeof WorkflowOperation.cases.ExecuteTaskWork.Type =>
  WorkflowOperation.cases.ExecuteTaskWork.make({
    ...fields,
    predecessorOperationIds: [...new Set(fields.predecessorOperationIds)].sort(compareOperationIds)
  })

export const makeImplementationEvidenceSealingOperation = (
  fields: {
    readonly operationId: OperationId
    readonly plannedAttempt: PlannedTaskAttempt
    readonly execution:
      | { readonly _tag: "SuccessfulExecution"; readonly outcome: typeof TaskExecutionOutcome.cases.Succeeded.Type }
      | { readonly _tag: "SimulatedExecution"; readonly predecessorOperationId: OperationId }
  }
): typeof WorkflowOperation.cases.SealImplementationEvidence.Type =>
  WorkflowOperation.cases.SealImplementationEvidence.make({
    ...fields,
    predecessorOperationIds: [
      fields.execution._tag === "SuccessfulExecution"
        ? fields.execution.outcome.operationId
        : fields.execution.predecessorOperationId
    ]
  })

export const makeImplementationReviewOperation = (
  request: ImplementationReviewRequest
): typeof WorkflowOperation.cases.ReviewImplementation.Type =>
  WorkflowOperation.cases.ReviewImplementation.make({
    predecessorOperationIds: [request.evidenceSealingOperationId],
    request
  })

export const makeReviewFindingsHandbackOperation = (
  request: ReviewFindingsHandbackRequest
): typeof WorkflowOperation.cases.HandBackReviewFindings.Type =>
  WorkflowOperation.cases.HandBackReviewFindings.make({
    predecessorOperationIds: [request.reviewOperationId],
    request
  })
