import { TrackerTarget, WorkflowOperation, type DeliveryActionProposal } from "@dalph/orchestrator"
import { Effect, Schema } from "effect"
import {
  sourceRejected,
  strictSource,
  validateOperationId,
  validatePlannedAttempt,
  type QualificationContext
} from "./production-hermetic-qualification-attempt-source.js"

type RecoveredAction = Extract<DeliveryActionProposal["route"], { readonly _tag: "RecoveredNewActionRoute" }>["action"]
type ContinuationRead = Extract<
  RecoveredAction,
  { readonly _tag: "ReadTrackerGraph" | "ReadTaskWorkSpecification" | "ReadTaskWorktree" }
>

const { operationId: _graphOperationId, ...graphFields } = WorkflowOperation.cases.ReadTrackerGraph.fields
const { operationId: _specificationOperationId, ...specificationFields } =
  WorkflowOperation.cases.ReadTaskWorkSpecification.fields
const { operationId: _worktreeOperationId, ...worktreeFields } = WorkflowOperation.cases.ReadTaskWorktree.fields
const NewContinuationRead = Schema.Union([
  Schema.Struct(graphFields),
  Schema.Struct(specificationFields),
  Schema.Struct(worktreeFields)
])

/** Ordinary reactivation can reread the same executing attempt before its terminal report arrives. */
export const validateContinuationRead = Effect.fn("HermeticQualification.validateContinuationRead")(function* (
  action: ContinuationRead,
  context: QualificationContext
) {
  const operation = yield* Schema.decodeUnknownEffect(
    NewContinuationRead,
    strictSource
  )(action.operation).pipe(Effect.mapError(sourceRejected))
  if (operation._tag !== action._tag) return yield* sourceRejected()
  const plannedAttempt = yield* validatePlannedAttempt(action.plannedAttempt, context)
  yield* Effect.forEach(operation.predecessorOperationIds, validateOperationId)
  switch (operation._tag) {
    case "ReadTrackerGraph":
      if (
        !Schema.toEquivalence(TrackerTarget)(operation.target, context.configuration.target) ||
        operation.readShape.explicitlyCoveredTaskIds.length !== 1 ||
        operation.readShape.explicitlyCoveredTaskIds[0] !== context.taskId ||
        (operation.cause._tag !== "ExecutingWorkAuthorityCheck" && operation.cause._tag !== "AttemptContinuation")
      )
        return yield* sourceRejected()
      return { _tag: operation._tag, operation, plannedAttempt }
    case "ReadTaskWorkSpecification":
      if (
        operation.taskId !== context.taskId ||
        !Schema.toEquivalence(TrackerTarget)(operation.target, context.configuration.target)
      )
        return yield* sourceRejected()
      return { _tag: operation._tag, operation, plannedAttempt }
    case "ReadTaskWorktree":
      yield* validatePlannedAttempt(operation.plannedAttempt, context)
      return { _tag: operation._tag, operation, plannedAttempt }
  }
})
