import { Data, Effect, Schema } from "effect"
import type { WorkflowOperation } from "../registry/operation.js"
import type { OperationId } from "../identity.js"
import type {
  CompletionClaimDeletionRequest,
  CompletionClaimCleanupReadOrdinal,
  CompletionClaimRequestOrdinal
} from "../protocols/integration-finality/events.js"

export type InterruptibleWorkflowBoundaryFamily = "Git" | "TaskTracker"

/** One exact tracker call within a bounded completion-claim cleanup sequence. */
export type CompletionClaimCleanupBoundaryCall = Data.TaggedEnum<{
  ReadBeforeDeletionAttempt: {
    readonly attemptOrdinal: CompletionClaimRequestOrdinal
    readonly readOrdinal: CompletionClaimCleanupReadOrdinal
  }
  DeleteAttempt: { readonly attemptOrdinal: CompletionClaimRequestOrdinal }
  ReadAfterDeletionAttemptsExhausted: {
    readonly attemptOrdinal: CompletionClaimRequestOrdinal
    readonly readOrdinal: CompletionClaimCleanupReadOrdinal
  }
}>

export const CompletionClaimCleanupBoundaryCall = Data.taggedEnum<CompletionClaimCleanupBoundaryCall>()

/** Value-safe identity shared by every call serving one exact cleanup disposition. */
export const CompletionClaimCleanupSequenceId = Schema.String.pipe(Schema.brand("CompletionClaimCleanupSequenceId"))
export type CompletionClaimCleanupSequenceId = typeof CompletionClaimCleanupSequenceId.Type

/** Value-safe identity of one exact read or deletion call within a cleanup sequence. */
export const CompletionClaimCleanupBoundaryCallId = Schema.String.pipe(
  Schema.brand("CompletionClaimCleanupBoundaryCallId")
)
export type CompletionClaimCleanupBoundaryCallId = typeof CompletionClaimCleanupBoundaryCallId.Type

const sequenceIdFor = (
  request: CompletionClaimDeletionRequest,
  replacementOperationId: OperationId
): CompletionClaimCleanupSequenceId =>
  CompletionClaimCleanupSequenceId.make(JSON.stringify([request.operationId, replacementOperationId]))

const callIdFor = (
  sequenceId: CompletionClaimCleanupSequenceId,
  call: CompletionClaimCleanupBoundaryCall
): CompletionClaimCleanupBoundaryCallId =>
  CompletionClaimCleanupBoundaryCallId.make(
    JSON.stringify([sequenceId, call._tag, call.attemptOrdinal, "readOrdinal" in call ? call.readOrdinal : "mutation"])
  )

/** Exact acknowledged workflow intent and owning external family for one interruptible local wait. */
export type InterruptibleWorkflowBoundaryIntent =
  | {
      readonly _tag: "AuthorityRequest"
      readonly family: InterruptibleWorkflowBoundaryFamily
      readonly operationId: OperationId
    }
  | {
      readonly _tag: "TaskClaimCleanup"
      readonly family: "TaskTracker"
      /** One exact tracker-owned claim and its unchanged workflow cleanup disposition. */
      readonly operation: typeof WorkflowOperation.cases.ReleaseTaskClaim.Type
    }
  | {
      readonly _tag: "CompletionClaimCleanup"
      readonly call: CompletionClaimCleanupBoundaryCall
      readonly callId: CompletionClaimCleanupBoundaryCallId
      readonly family: "TaskTracker"
      readonly replacementOperationId: OperationId
      /** The exact completion claim, focused-success proof, and deletion identity. */
      readonly request: CompletionClaimDeletionRequest
      readonly sequenceId: CompletionClaimCleanupSequenceId
    }

export const InterruptibleWorkflowBoundaryIntent = {
  AuthorityRequest: (fields: {
    readonly family: InterruptibleWorkflowBoundaryFamily
    readonly operationId: OperationId
  }): Extract<InterruptibleWorkflowBoundaryIntent, { readonly _tag: "AuthorityRequest" }> => ({
    _tag: "AuthorityRequest",
    ...fields
  }),
  TaskClaimCleanup: (fields: {
    readonly family: "TaskTracker"
    readonly operation: typeof WorkflowOperation.cases.ReleaseTaskClaim.Type
  }): Extract<InterruptibleWorkflowBoundaryIntent, { readonly _tag: "TaskClaimCleanup" }> => ({
    _tag: "TaskClaimCleanup",
    ...fields
  }),
  CompletionClaimCleanup: (fields: {
    readonly call: CompletionClaimCleanupBoundaryCall
    readonly family: "TaskTracker"
    readonly replacementOperationId: OperationId
    readonly request: CompletionClaimDeletionRequest
  }): Extract<InterruptibleWorkflowBoundaryIntent, { readonly _tag: "CompletionClaimCleanup" }> => {
    const sequenceId = sequenceIdFor(fields.request, fields.replacementOperationId)
    return { _tag: "CompletionClaimCleanup", ...fields, callId: callIdFor(sequenceId, fields.call), sequenceId }
  }
}

/** Runtime capability that keeps a produced result and its recording inside one Exit-safe boundary. */
export interface InterruptibleWorkflowBoundaryExecution {
  readonly run: <A, E, R, B, E2, R2>(
    intent: InterruptibleWorkflowBoundaryIntent,
    call: Effect.Effect<A, E, R>,
    recordResult: (result: A) => Effect.Effect<B, E2, R2>
  ) => Effect.Effect<B, E | E2, R | R2>
}

/** Runs the same call/result algebra with or without an application Exit owner. */
export const runInterruptibleBoundary = <A, E, R, B, E2, R2>(
  execution: InterruptibleWorkflowBoundaryExecution | undefined,
  intent: InterruptibleWorkflowBoundaryIntent,
  call: Effect.Effect<A, E, R>,
  recordResult: (result: A) => Effect.Effect<B, E2, R2>
): Effect.Effect<B, E | E2, R | R2> =>
  execution === undefined ? call.pipe(Effect.flatMap(recordResult)) : execution.run(intent, call, recordResult)
