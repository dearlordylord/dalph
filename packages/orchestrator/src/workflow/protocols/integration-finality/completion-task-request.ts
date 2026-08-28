import { TaskId, TaskRevision } from "@dalph/contracts"
import { Schema } from "effect"
import type { TrackerTarget } from "../../../authorities/task-tracker/target.js"
import { OperationId } from "../../identity.js"
import { completionTaskClaimEquals, CompletionTaskClaim } from "./completion-claim.js"
import {
  FocusedTaskCompletionReadRequest,
  type FocusedTaskCompletionReadRequest as FocusedTaskCompletionReadRequestType
} from "./focused-task-completion-request.js"

/** Stable operation identity for the one task-completion request derived from promotion. */
export const completionTaskOperationIdFor = (claim: CompletionTaskClaim): OperationId =>
  OperationId.make(`completion-task:${claim.promotionCorrelation.requestId}`)

/** The immutable completion request Q; retries retain this exact identity. */
export const CompletionTaskRequest = Schema.Struct({
  claim: CompletionTaskClaim,
  operationId: OperationId,
  taskId: TaskId,
  taskRevision: TaskRevision
}).check(
  Schema.makeFilter((request) => {
    const exactBinding =
      request.claim.plannedAttempt.taskId === request.taskId &&
      request.claim.plannedAttempt.taskRevision === request.taskRevision &&
      request.operationId === completionTaskOperationIdFor(request.claim)
    return exactBinding ? undefined : "completion request must bind one exact task, revision, and claim"
  })
)
export type CompletionTaskRequest = typeof CompletionTaskRequest.Type

/** Compares the complete immutable task-completion request Q. */
export const completionTaskRequestEquals = (left: CompletionTaskRequest, right: CompletionTaskRequest): boolean =>
  left.operationId === right.operationId &&
  left.taskId === right.taskId &&
  left.taskRevision === right.taskRevision &&
  completionTaskClaimEquals(left.claim, right.claim)

/**
 * Purely derives Q's immutable value from a promoted claim. This value carries
 * no current authority and establishes no workflow occurrence; the completion
 * protocol rereads every premise before it durably establishes Q's intent.
 */
export const completionTaskRequestFor = (claim: CompletionTaskClaim): CompletionTaskRequest =>
  CompletionTaskRequest.make({
    claim,
    operationId: completionTaskOperationIdFor(claim),
    taskId: claim.plannedAttempt.taskId,
    taskRevision: claim.plannedAttempt.taskRevision
  })

/** Derives the exact provider read request for one immutable completion request Q. */
export const focusedTaskCompletionReadRequestFor = (
  request: CompletionTaskRequest,
  target: TrackerTarget,
  operationId: OperationId
): FocusedTaskCompletionReadRequestType =>
  FocusedTaskCompletionReadRequest.make({ expectedClaim: request.claim, operationId, target, taskId: request.taskId })
