import {
  AttemptBasePolicy,
  WorkflowOperation,
  taskAttemptBaseRetryFactOperationId,
  JournalPosition,
  PlannedTaskAttemptOrdinal,
  PlannedAttemptExecutorReportOrdinal,
  taskAttemptBaseReadOperationIdFor,
  type DeliveryActionProposal
} from "@dalph/orchestrator"
import { GitCommitSha } from "@dalph/contracts"
import { Effect, Schema } from "effect"
import {
  sourceRejected,
  sourceRejectedBecause,
  strictSource,
  validateOperationId,
  validateClaimOperation,
  validateSpecification,
  validatePlannedAttempt,
  validateWorkflowOperationId,
  qualificationPlannedAttemptFor,
  type HermeticQualificationSourceRejected,
  type QualificationContext
} from "./production-hermetic-qualification-attempt-source.js"
import { validateOperation, validateTask } from "./production-hermetic-qualification-fixture-source.js"

const acceptedProgress = Schema.TaggedUnion({
  ExecutorResponsibilityBegan: { acceptedAt: JournalPosition },
  ExecutorReportAccepted: { ordinal: PlannedAttemptExecutorReportOrdinal }
})

export const validateAcceptedExecutorProgress = (value: unknown) =>
  Schema.decodeUnknownEffect(
    acceptedProgress,
    strictSource
  )(value).pipe(Effect.mapError(sourceRejectedBecause("InvalidAcceptedProgress")))

type FreshStep = Extract<
  DeliveryActionProposal["route"],
  { readonly _tag: "FreshWorkflowRoute" | "FreshExecutorWorkflowRoute" }
>["step"]

export const validateFreshStep: (
  step: FreshStep,
  context: QualificationContext
) => Effect.Effect<
  Exclude<FreshStep, { readonly _tag: "ReadRejectedTaskClaim" }>,
  HermeticQualificationSourceRejected
> = Effect.fn("HermeticQualification.validateFreshStep")(function* (
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
      yield* validateWorkflowOperationId(step.predecessorOperationId, context)
      if (step.baseSha !== qualificationPlannedAttemptFor(context, task.id).baseSha || step.ordinal !== 0)
        return yield* sourceRejectedBecause("PlannedAttemptMismatch")()
      yield* validateOperationId(step.claimOperationId)
      return {
        _tag: step._tag,
        baseSha: yield* Schema.decodeUnknownEffect(GitCommitSha)(step.baseSha).pipe(
          Effect.mapError(sourceRejectedBecause("InvalidPlannedAttempt"))
        ),
        ordinal: yield* Schema.decodeUnknownEffect(PlannedTaskAttemptOrdinal)(step.ordinal).pipe(
          Effect.mapError(sourceRejectedBecause("InvalidPlannedAttempt"))
        ),
        predecessorOperationId: step.predecessorOperationId,
        claimOperationId: step.claimOperationId,
        specification: yield* validateSpecification(step.specification, context),
        task
      }
    case "ReadTaskAttemptBaseRetryFacts": {
      const operation = yield* Schema.decodeUnknownEffect(
        WorkflowOperation,
        strictSource
      )(step.operation).pipe(Effect.mapError(sourceRejected))
      if (
        operation._tag !== "ReadTrackerGraph" &&
        operation._tag !== "ReadTaskClaim" &&
        operation._tag !== "ReadTaskWorkSpecification"
      )
        return yield* sourceRejected()
      const family =
        operation._tag === "ReadTrackerGraph" ? "Graph" : operation._tag === "ReadTaskClaim" ? "Claim" : "Specification"
      const retry = context.acceptedBaseRetries?.find(
        ({ claimOperationId, request }) =>
          request.subject.taskId === task.id &&
          claimOperationId === step.claimOperationId &&
          taskAttemptBaseRetryFactOperationId(request.requestId, family) === step.operationId
      )
      if (
        retry === undefined ||
        operation.operationId !== step.operationId ||
        operation.predecessorOperationIds.length !== 1 ||
        operation.predecessorOperationIds[0] !== step.predecessorOperationId
      )
        return yield* sourceRejected()
      const expectedPredecessor =
        family === "Graph"
          ? retry.claimOperationId
          : taskAttemptBaseRetryFactOperationId(retry.request.requestId, family === "Claim" ? "Graph" : "Claim")
      if (
        step.predecessorOperationId !== expectedPredecessor ||
        (operation._tag === "ReadTrackerGraph"
          ? operation.cause._tag !== "WorkflowEstablishment" ||
            operation.readShape.explicitlyCoveredTaskIds.length !== 1 ||
            operation.readShape.explicitlyCoveredTaskIds[0] !== task.id
          : operation.taskId !== task.id)
      )
        return yield* sourceRejected()
      yield* validateOperationId(step.claimOperationId)
      yield* validateOperation(operation, context)
      return {
        _tag: step._tag,
        operation,
        operationId: step.operationId,
        claimOperationId: step.claimOperationId,
        predecessorOperationId: step.predecessorOperationId,
        task
      }
    }
    case "ReadTaskAttemptBase": {
      if (step.specification.taskId !== task.id) return yield* sourceRejectedBecause("SpecificationMismatch")()
      yield* validateWorkflowOperationId(step.predecessorOperationId, context)
      yield* validateOperationId(step.claimOperationId)
      if (
        step.retryRequestId !== undefined &&
        !context.acceptedBaseRetries?.some(
          ({ claimOperationId, request }) =>
            request.requestId === step.retryRequestId &&
            request.subject.taskId === task.id &&
            claimOperationId === step.claimOperationId
        )
      )
        return yield* sourceRejected()
      if (step.operationId !== taskAttemptBaseReadOperationIdFor(step.claimOperationId, step.predecessorOperationId))
        return yield* sourceRejected()
      const policy = yield* Schema.decodeUnknownEffect(AttemptBasePolicy)(step.policy).pipe(
        Effect.mapError(sourceRejectedBecause("InvalidPlannedAttempt"))
      )
      const expected = AttemptBasePolicy.cases.QualifiedCurrentIntegrationHead.make({
        executionRepository: context.configuration.repository,
        integrationTarget: { repository: context.configuration.repository, ref: context.configuration.integrationRef },
        lineageAnchor: context.configuration.plannedAttemptBaseSha
      })
      if (!Schema.toEquivalence(AttemptBasePolicy)(policy, expected)) return yield* sourceRejected()
      return {
        _tag: step._tag,
        policy,
        ...(step.retryRequestId === undefined ? {} : { retryRequestId: step.retryRequestId }),
        task,
        operationId: step.operationId,
        claimOperationId: step.claimOperationId,
        predecessorOperationId: step.predecessorOperationId,
        specification: yield* validateSpecification(step.specification, context)
      }
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
    /* v8 ignore next -- @preserve Fresh operation schema narrows this union before exhaustive routing. */
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
        acceptedProgress: yield* validateAcceptedExecutorProgress(step.acceptedProgress),
        task
      }
    /* v8 ignore next -- @preserve Executor-step schema narrows this union before exhaustive routing. */
    default:
      return yield* sourceRejected()
  }
})
