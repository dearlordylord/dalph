import {
  deliveryProposalIdOf,
  WorkflowOperation,
  TrackerTarget,
  IntegratorSessionCorrelation,
  QueuedIntegrationResponsibility,
  UnqueuedAcceptedResult,
  TargetLineageObservation,
  PromotionStaleIntegrationQuarantineInput,
  integratorCorrelationFor,
  completionClaimReplacementRequestFor,
  type DeliveryActionProposal
} from "@dalph/orchestrator"
import { Effect, Schema } from "effect"

import {
  sourceRejected,
  strictSource,
  validateOperationId,
  validateWorkflowOperationId,
  validatePlannedAttempt,
  validateTarget,
  type QualificationContext
} from "./production-hermetic-qualification-attempt-source.js"
import {
  validateResponsibility,
  validateRunCorrelation,
  validateCandidate,
  validateCompletionRequest,
  validateReplacementRequest,
  validateDeletionRequest
} from "./production-hermetic-qualification-fixture-source.js"
import { validateFreshStep } from "./production-hermetic-qualification-fresh-source.js"
import { validateContinuationRead } from "./production-hermetic-qualification-continuation-source.js"

type RecoveredAction = Extract<DeliveryActionProposal["route"], { readonly _tag: "RecoveredNewActionRoute" }>["action"]
const { operationId: _targetLineageOperationId, ...newLineageFields } = WorkflowOperation.cases.ReadTargetLineage.fields
const NewLineageOperation = Schema.Struct(newLineageFields)
const { operationId: _claimReadOperationId, ...newClaimReadFields } = WorkflowOperation.cases.ReadTaskClaim.fields
const NewClaimReadOperation = Schema.Struct(newClaimReadFields)
const validateRecoveredAction = Effect.fn("HermeticQualification.validateRecoveredAction")(function* (
  action: RecoveredAction,
  context: QualificationContext
) {
  switch (action._tag) {
    case "ReadTrackerGraph":
    case "ReadTaskWorkSpecification":
    case "ReadTaskWorktree":
      return yield* validateContinuationRead(action, context)
    case "ReadTargetLineage": {
      const operation = yield* Schema.decodeUnknownEffect(
        NewLineageOperation,
        strictSource
      )(action.operation).pipe(Effect.mapError(sourceRejected))
      yield* validateTarget(operation.integrationTarget, context)
      yield* validatePlannedAttempt(operation.plannedAttempt, context)
      yield* Effect.forEach(operation.predecessorOperationIds, validateOperationId)
      return {
        _tag: action._tag,
        operation,
        plannedAttempt: yield* validatePlannedAttempt(action.plannedAttempt, context)
      }
    }
    case "ReadTaskClaim":
      return yield* validateRecoveredTaskClaimRead(action, context)
    case "ReleaseCancelledAttemptClaim":
    case "ReleaseExternallyCompletedTaskClaim":
    case "ReleaseStoppedAttemptClaim":
    case "TaskClaimReacquisition":
    default:
      return yield* sourceRejected()
  }
})

const validateRecoveredTaskClaimRead = Effect.fn("HermeticQualification.validateRecoveredTaskClaimRead")(function* (
  action: Extract<RecoveredAction, { readonly _tag: "ReadTaskClaim" }>,
  context: QualificationContext
) {
  const operation = yield* Schema.decodeUnknownEffect(
    NewClaimReadOperation,
    strictSource
  )(action.operation).pipe(Effect.mapError(sourceRejected))
  if (
    operation.taskId !== context.taskId ||
    action.taskId !== context.taskId ||
    !Schema.toEquivalence(TrackerTarget)(operation.target, context.configuration.target)
  )
    return yield* sourceRejected()
  yield* Effect.forEach(operation.predecessorOperationIds, validateOperationId)
  return {
    _tag: action._tag,
    operation,
    taskId: context.taskId,
    plannedAttempt:
      action.plannedAttempt === null ? null : yield* validatePlannedAttempt(action.plannedAttempt, context)
  }
})

type AcceptedTransition = Extract<
  DeliveryActionProposal["route"],
  { readonly _tag: "AcceptedWorkflowRoute" }
>["transition"]
const validateAcceptedTransition = Effect.fn("HermeticQualification.validateAcceptedTransition")(function* (
  transition: AcceptedTransition,
  context: QualificationContext
) {
  if (
    transition._tag !== "CheckTaskClaim" &&
    transition._tag !== "ReconcileTaskClaimRelease" &&
    transition._tag !== "ReconcileTaskWorktree"
  )
    return yield* sourceRejected()
  switch (transition._tag) {
    case "CheckTaskClaim":
    case "ReconcileTaskClaimRelease":
    case "ReconcileTaskWorktree":
      if (transition.taskId !== context.taskId) return yield* sourceRejected()
      yield* validateWorkflowOperationId(transition.operationId, context)
      return { _tag: transition._tag, operationId: transition.operationId, taskId: context.taskId }
    default:
      return yield* sourceRejected()
  }
})

type IntegrationTransition = Extract<
  DeliveryActionProposal["route"],
  { readonly _tag: "IdentityFreeWorkflowRoute" }
>["transition"]
const validateIntegrationTransition = Effect.fn("HermeticQualification.validateIntegrationTransition")(function* (
  transition: IntegrationTransition,
  context: QualificationContext
) {
  if (
    transition._tag === "QueueAcceptedResultIntegrationResponsibility" ||
    transition._tag === "StartQueuedIntegration" ||
    transition._tag === "AcquireStartedIntegrationTarget"
  )
    return yield* validateQueuedIntegrationTransition(transition, context)
  return yield* validateRunningIntegrationTransition(transition, context)
})

const validateQueuedIntegrationTransition = Effect.fn("HermeticQualification.validateQueuedIntegrationTransition")(
  function* (
    transition: Extract<
      IntegrationTransition,
      {
        readonly _tag:
          | "QueueAcceptedResultIntegrationResponsibility"
          | "StartQueuedIntegration"
          | "AcquireStartedIntegrationTarget"
      }
    >,
    context: QualificationContext
  ) {
    switch (transition._tag) {
      case "QueueAcceptedResultIntegrationResponsibility": {
        const accepted = yield* Schema.decodeUnknownEffect(
          UnqueuedAcceptedResult,
          strictSource
        )(transition.accepted).pipe(Effect.mapError(sourceRejected))
        yield* validatePlannedAttempt(accepted.plannedAttempt, context)
        return {
          _tag: transition._tag,
          accepted,
          integrationTarget: yield* validateTarget(transition.integrationTarget, context)
        }
      }
      case "StartQueuedIntegration": {
        const responsibility = yield* Schema.decodeUnknownEffect(
          QueuedIntegrationResponsibility,
          strictSource
        )(transition.responsibility).pipe(Effect.mapError(sourceRejected))
        yield* validatePlannedAttempt(responsibility.plannedAttempt, context)
        yield* validateTarget(responsibility.integrationTarget, context)
        if (
          responsibility.preIntegrationCancellation.runId !== context.runId ||
          responsibility.preIntegrationCancellation.attemptId !== responsibility.plannedAttempt.attemptId ||
          responsibility.preIntegrationCancellation.queuedAt !== responsibility.queuedAt
        )
          return yield* sourceRejected()
        return { _tag: transition._tag, responsibility }
      }
      case "AcquireStartedIntegrationTarget":
        return {
          _tag: transition._tag,
          responsibility: yield* validateResponsibility(transition.responsibility, context)
        }
      default:
        return yield* sourceRejected()
    }
  }
)

const validateRunningIntegrationTransition = Effect.fn("HermeticQualification.validateRunningIntegrationTransition")(
  function* (transition: IntegrationTransition, context: QualificationContext) {
    if (transition._tag === "ReconcilePlannedAttemptExecutorWork")
      return {
        _tag: transition._tag,
        plannedAttempt: yield* validatePlannedAttempt(transition.plannedAttempt, context)
      }
    if (
      transition._tag === "RunIntegrator" ||
      transition._tag === "RunTargetPromotion" ||
      transition._tag === "RecordPromotionStaleIntegrationQuarantine"
    )
      return yield* validateIntegrationRunTransition(transition, context)
    return yield* validateCompletionTransition(transition, context)
  }
)

const validateIntegrationRunTransition = Effect.fn("HermeticQualification.validateIntegrationRunTransition")(function* (
  transition: Extract<
    IntegrationTransition,
    { readonly _tag: "RunIntegrator" | "RunTargetPromotion" | "RecordPromotionStaleIntegrationQuarantine" }
  >,
  context: QualificationContext
) {
  switch (transition._tag) {
    case "RunIntegrator": {
      const responsibility = yield* validateResponsibility(transition.responsibility, context)
      const lineage = yield* Schema.decodeUnknownEffect(
        TargetLineageObservation,
        strictSource
      )(transition.lineage).pipe(Effect.mapError(sourceRejected))
      const run = yield* validateRunCorrelation(transition.run, context)
      const expectedSession = integratorCorrelationFor({
        responsibility,
        targetLineage: lineage,
        targetLineageObservedAt: transition.lineageObservedAt
      })
      if (!Schema.toEquivalence(IntegratorSessionCorrelation)(run.session, expectedSession))
        return yield* sourceRejected()
      return { _tag: transition._tag, responsibility, lineage, lineageObservedAt: transition.lineageObservedAt, run }
    }
    case "RunTargetPromotion":
      return {
        _tag: transition._tag,
        candidate: yield* validateCandidate(transition.candidate, context),
        responsibility: yield* validateResponsibility(transition.responsibility, context)
      }
    case "RecordPromotionStaleIntegrationQuarantine": {
      const input = yield* Schema.decodeUnknownEffect(
        PromotionStaleIntegrationQuarantineInput,
        strictSource
      )(transition.input).pipe(Effect.mapError(sourceRejected))
      yield* validateCandidate(input.correlation.qualifiedCandidate, context)
      return {
        _tag: transition._tag,
        input,
        responsibility: yield* validateResponsibility(transition.responsibility, context)
      }
    }
    default:
      return yield* sourceRejected()
  }
})

const validateCompletionTransition = Effect.fn("HermeticQualification.validateCompletionTransition")(function* (
  transition: IntegrationTransition,
  context: QualificationContext
) {
  if (
    transition._tag === "ReplacePromotedTaskClaim" ||
    transition._tag === "CompletePromotedTask" ||
    transition._tag === "ObserveFocusedTaskCompletion" ||
    transition._tag === "DeleteCompletedTaskCompletionClaim"
  )
    return yield* validateCompletionRequestTransition(transition, context)
  return yield* sourceRejected()
})

const validateCompletionRequestTransition = Effect.fn("HermeticQualification.validateCompletionRequestTransition")(
  function* (
    transition: Extract<
      IntegrationTransition,
      {
        readonly _tag:
          | "ReplacePromotedTaskClaim"
          | "CompletePromotedTask"
          | "ObserveFocusedTaskCompletion"
          | "DeleteCompletedTaskCompletionClaim"
      }
    >,
    context: QualificationContext
  ) {
    switch (transition._tag) {
      case "ReplacePromotedTaskClaim":
        return {
          _tag: transition._tag,
          request: yield* validateReplacementRequest(transition.request, context),
          responsibility: yield* validateResponsibility(transition.responsibility, context)
        }
      case "CompletePromotedTask":
      case "ObserveFocusedTaskCompletion":
        return {
          _tag: transition._tag,
          request: yield* validateCompletionRequest(transition.request, context),
          responsibility: yield* validateResponsibility(transition.responsibility, context)
        }
      case "DeleteCompletedTaskCompletionClaim": {
        const request = yield* validateDeletionRequest(transition.request, context)
        if (transition.replacementOperationId !== completionClaimReplacementRequestFor(request.claim).operationId)
          return yield* sourceRejected()
        return {
          _tag: transition._tag,
          replacementOperationId: transition.replacementOperationId,
          request,
          responsibility: yield* validateResponsibility(transition.responsibility, context)
        }
      }
      default:
        return yield* sourceRejected()
    }
  }
)

const validateRoute = Effect.fn("HermeticQualification.validateRoute")(function* (
  route: DeliveryActionProposal["route"],
  context: QualificationContext
) {
  switch (route._tag) {
    case "TrackerGraphReadRoute":
      return { _tag: route._tag, purpose: "EstablishCurrentGraph" as const, target: context.configuration.target }
    case "FreshWorkflowRoute":
    case "FreshExecutorWorkflowRoute":
      return yield* validateFreshRoute(route, context)
    case "RecoveredNewActionRoute":
      return { _tag: route._tag, action: yield* validateRecoveredAction(route.action, context) }
    case "AcceptedWorkflowRoute":
      return { _tag: route._tag, transition: yield* validateAcceptedTransition(route.transition, context) }
    case "IdentityFreeWorkflowRoute":
      return { _tag: route._tag, transition: yield* validateIntegrationTransition(route.transition, context) }
    default:
      return yield* sourceRejected()
  }
})

const validateFreshRoute = Effect.fn("HermeticQualification.validateFreshRoute")(function* (
  route: Extract<
    DeliveryActionProposal["route"],
    { readonly _tag: "FreshWorkflowRoute" | "FreshExecutorWorkflowRoute" }
  >,
  context: QualificationContext
) {
  const step = yield* validateFreshStep(route.step, context)
  // Preserve the original workflow/executor route distinction as well as every step field.
  if (route._tag === "FreshExecutorWorkflowRoute") {
    if (step._tag !== "BeginPlannedAttemptExecutorWork" && step._tag !== "ObservePlannedAttemptExecutorWork")
      return yield* sourceRejected()
    return { _tag: route._tag, step }
  }
  if (step._tag === "BeginPlannedAttemptExecutorWork" || step._tag === "ObservePlannedAttemptExecutorWork")
    return yield* sourceRejected()
  // Planning needs both a fresh operation and attempt identity, unlike the other fresh operation routes.
  if (step._tag === "RecordTaskAttemptPlan") return { _tag: route._tag, step }
  return { _tag: route._tag, step }
})

export const validateProposal = Effect.fn("HermeticQualification.validateProposal")(function* (
  proposal: DeliveryActionProposal,
  context: QualificationContext
) {
  const route = proposal.route
  const expected = yield* validateRoute(route, context)
  const expectedId = deliveryProposalIdOf(context.runId, expected)
  if (deliveryProposalIdOf(context.runId, route) !== expectedId || proposal.id !== expectedId)
    return yield* sourceRejected()
  if (proposal.order._tag !== "TrackerGraphOrder" && proposal.order.taskId !== context.taskId)
    return yield* sourceRejected()
  if (proposal.waitsForLiveOperationId !== null)
    yield* validateWorkflowOperationId(proposal.waitsForLiveOperationId, context)
  yield* validateProposalIdentitySource(proposal.actionIdentity, context)
})

const validateProposalIdentitySource = Effect.fn("HermeticQualification.validateProposalIdentitySource")(function* (
  identity: DeliveryActionProposal["actionIdentity"],
  context: QualificationContext
) {
  if (identity._tag === "FreshOperationIdRequired") {
    const source = identity.source
    if (source._tag === "Preserve") yield* validateWorkflowOperationId(source.operationId, context)
    else if (source._tag === "ExternalSuccessReleaseClaim") yield* validateOperationId(source.claimOperationId)
    else if (source._tag !== "Allocate") return yield* sourceRejected()
  }
})
