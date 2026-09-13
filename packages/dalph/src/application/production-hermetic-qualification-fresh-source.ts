import { JournalPosition, PlannedAttemptExecutorReportOrdinal, type DeliveryActionProposal } from "@dalph/orchestrator"
import { Effect, Schema } from "effect"
import {
  sourceRejected,
  strictSource,
  validateOperationId,
  validateClaimOperation,
  validateSpecification,
  validatePlannedAttempt,
  type HermeticQualificationSourceRejected,
  type QualificationContext
} from "./production-hermetic-qualification-attempt-source.js"
import { validateTask } from "./production-hermetic-qualification-fixture-source.js"

const acceptedProgress = Schema.TaggedUnion({
  ExecutorResponsibilityBegan: { acceptedAt: JournalPosition },
  ExecutorReportAccepted: { ordinal: PlannedAttemptExecutorReportOrdinal }
})

type FreshStep = Extract<
  DeliveryActionProposal["route"],
  { readonly _tag: "FreshWorkflowRoute" | "FreshExecutorWorkflowRoute" }
>["step"]

export const validateFreshStep = Effect.fn("HermeticQualification.validateFreshStep")(function* (
  step: FreshStep,
  context: QualificationContext
): Effect.fn.Return<
  Exclude<FreshStep, { readonly _tag: "ReadRejectedTaskClaim" }>,
  HermeticQualificationSourceRejected
> {
  if (step._tag === "BeginPlannedAttemptExecutorWork" || step._tag === "ObservePlannedAttemptExecutorWork")
    return yield* validateExecutorStep(step, context)
  if (step._tag === "ReadRejectedTaskClaim") return yield* sourceRejected()
  return yield* validateFreshOperationStep(step, context)
})

const validateFreshOperationStep = Effect.fn("HermeticQualification.validateFreshOperationStep")(function* (
  step: Exclude<
    FreshStep,
    { readonly _tag: "BeginPlannedAttemptExecutorWork" | "ObservePlannedAttemptExecutorWork" | "ReadRejectedTaskClaim" }
  >,
  context: QualificationContext
) {
  const task = yield* validateTask(step.task, context)
  switch (step._tag) {
    case "ReadCurrentTaskGraph":
    case "AcquireTaskClaim":
      yield* validateOperationId(step.predecessorOperationId)
      return { _tag: step._tag, predecessorOperationId: step.predecessorOperationId, task }
    case "ReadPostClaimGraph":
      yield* validateOperationId(step.predecessorOperationId)
      return {
        _tag: step._tag,
        predecessorOperationId: step.predecessorOperationId,
        claimOperation: yield* validateClaimOperation(step.claimOperation, context),
        task
      }
    case "ReadTaskWorkSpecification":
      yield* validateOperationId(step.predecessorOperationId)
      yield* validateOperationId(step.claimOperationId)
      return {
        _tag: step._tag,
        predecessorOperationId: step.predecessorOperationId,
        claimOperationId: step.claimOperationId,
        task
      }
    case "RecordTaskAttemptPlan":
      yield* validateOperationId(step.predecessorOperationId)
      yield* validateOperationId(step.claimOperationId)
      return {
        _tag: step._tag,
        predecessorOperationId: step.predecessorOperationId,
        claimOperationId: step.claimOperationId,
        specification: yield* validateSpecification(step.specification, context),
        task
      }
    case "ReconcileTaskWorktree":
      yield* validateOperationId(step.predecessorOperationId)
      yield* validateOperationId(step.claimOperationId)
      return {
        _tag: step._tag,
        predecessorOperationId: step.predecessorOperationId,
        claimOperationId: step.claimOperationId,
        plannedAttempt: yield* validatePlannedAttempt(step.plannedAttempt, context),
        task
      }
    default:
      return yield* sourceRejected()
  }
})

const validateExecutorStep = Effect.fn("HermeticQualification.validateExecutorStep")(function* (
  step: Extract<FreshStep, { readonly _tag: "BeginPlannedAttemptExecutorWork" | "ObservePlannedAttemptExecutorWork" }>,
  context: QualificationContext
) {
  const task = yield* validateTask(step.task, context)
  switch (step._tag) {
    case "BeginPlannedAttemptExecutorWork":
      yield* validateOperationId(step.claimOperationId)
      return {
        _tag: step._tag,
        claimOperationId: step.claimOperationId,
        plannedAttempt: yield* validatePlannedAttempt(step.plannedAttempt, context),
        specification: yield* validateSpecification(step.specification, context),
        task
      }
    case "ObservePlannedAttemptExecutorWork":
      return {
        _tag: step._tag,
        plannedAttempt: yield* validatePlannedAttempt(step.plannedAttempt, context),
        specification: yield* validateSpecification(step.specification, context),
        acceptedProgress: yield* Schema.decodeUnknownEffect(
          acceptedProgress,
          strictSource
        )(step.acceptedProgress).pipe(Effect.mapError(sourceRejected)),
        task
      }
    default:
      return yield* sourceRejected()
  }
})
