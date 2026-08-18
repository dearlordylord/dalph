import {
  PlannedAttemptExecutorCorrelation,
  type PlannedAttemptExecutorReport,
  type PlannedAttemptExecutorService,
  type PlannedTaskAttempt
} from "@dalph/contracts"
import { Context, Effect, Schema } from "effect"
import type { InRunJournalService } from "../../workflow-journal/store.js"
import type {
  InterruptibleWorkflowBoundaryExecution,
  WorkflowInterpreterService,
  WorkflowTraceService
} from "../../workflow/interpretation/interpreter.js"
import type { TaskClaimAcquisitionPlannerService } from "../../workflow/protocols/task-claim-acquisition/plan.js"
import type {
  PlannedAttemptExecutorCommandReconciliationRequired,
  PlannedAttemptExecutorContinuationLimitReached,
  PlannedAttemptExecutorCorrelationMismatch,
  PlannedAttemptExecutorProjectionCorrelationMismatch,
  PlannedAttemptExecutorProjectionTemporarilyUnavailable,
  PlannedAttemptExecutorProjectionUnreadable,
  PlannedAttemptExecutorProjectionNoCurrentReport,
  PlannedAttemptExecutorResponsibilityAbandoned,
  PlannedAttemptExecutorResponsibilityContradiction,
  PlannedAttemptExecutorResponsibilityMissing,
  PlannedAttemptExecutorStateNoCurrentReport,
  PlannedAttemptExecutorStateTemporarilyUnavailable,
  PlannedAttemptExecutorStateUnreadable,
  PlannedAttemptExecutorSuspensionLimitReached
} from "../../workflow/protocols/planned-attempt-executor-work/protocol.js"
import type { PlannedAttemptContinuationAuthorizationRejected } from "../../workflow/protocols/planned-attempt-continuation/protocol.js"
import type { PlannedAttemptProtocolPermit } from "../../workflow/protocols/planned-attempt-executor-work/protocol-controller.js"
import type {
  AcceptedResultEvidenceConflict,
  AcceptedResultEvidenceUnavailable,
  queueAcceptedResultIntegrationResponsibility,
  startQueuedIntegration
} from "../../workflow/protocols/integration-admission/protocol.js"
import type { runIntegrationCandidateConstruction } from "../run/integration-candidate-runtime.js"
import type {
  IntegratorGitReadFailure,
  prepareIntegrationCandidateRun
} from "../../workflow/protocols/integrator/protocol.js"
import type { appendChangedHeadRetryQuarantine } from "../../workflow/protocols/integration-quarantine/changed-head-retry.js"
import type { runTaskClaimReacquisition } from "../../workflow/protocols/task-claim-reacquisition/execute.js"
import type {
  recoverTaskClaimOperation,
  recoverTaskClaimReleaseOperation,
  recoverTaskWorktreeOperation
} from "../frontier/recovery.js"
import type { IntegrationCandidateBoundaryUnavailable } from "./integration-candidate-boundary.js"
import type { IntegratorBoundaryUnavailable } from "./integrator-boundary.js"
import type { IntegrationCandidateConstructionState } from "../../workflow/protocols/integration-candidate-construction/protocol.js"
import type { runTargetVerification } from "../../workflow/protocols/target-verification/protocol.js"
import type { TargetVerificationRuntimeUnavailable } from "./target-verification-boundary.js"
import type { runTargetPromotion } from "../../workflow/protocols/target-promotion/protocol.js"
import type { TargetPromotionRuntimeUnavailable } from "./target-promotion-boundary.js"
import type {
  runCompletionClaimDeletionProtocol,
  runCompletionClaimReplacementProtocol
} from "../../workflow/protocols/integration-finality/protocol.js"
import type { IntegrationFinalityRuntimeUnavailable } from "./integration-finality-boundary.js"
import type {
  CompletionTaskAmbiguousWait,
  CompletionTaskAuthorizationConflict,
  CompletionTaskAuthorizationWait,
  CompletionTaskConfirmationWait,
  CompletionTaskPreconditionConflict
} from "../../workflow/protocols/integration-finality/completion-task-protocol.js"
import type { OperationId } from "../../workflow/identity.js"
import type { TaskDagSnapshot } from "../../authorities/task-tracker/graph.js"
import type { IntegrationTargetResourceController } from "../admission/integration-target-resource.js"
import type { AtomicBoundaryExecution } from "../application-exit/lifecycle.js"
import {
  type AcceptedIdentityDeliveryProposal,
  DeliveryProposalId,
  type FreshIdentityDeliveryProposal,
  type IdentityFreeDeliveryProposal
} from "./delivery-action-proposal.js"
import type { DeliveryRelationSourceError } from "./relations.js"
import type {
  advanceAttemptStoppage,
  observeAttemptStoppageExecutor,
  recordStoppedAttemptClaimNoRelease
} from "../../workflow/protocols/attempt-choice/stop.js"
import type { advanceAttemptRestart } from "../../workflow/protocols/attempt-choice/restart.js"

type FreshOperationProposal = Extract<
  FreshIdentityDeliveryProposal,
  { readonly actionIdentity: { readonly _tag: "FreshOperationIdRequired" } }
>

type FreshAttemptProposal = Extract<
  FreshIdentityDeliveryProposal,
  { readonly actionIdentity: { readonly _tag: "FreshOperationAndAttemptIdsRequired" } }
>

/** One admitted proposal after every fresh identity has been materialized exactly once. */
export type MaterializedDeliveryAction =
  | { readonly _tag: "AcceptedOperationAction"; readonly proposal: AcceptedIdentityDeliveryProposal }
  | {
      readonly _tag: "FreshAttemptAction"
      readonly operationId: OperationId
      readonly plannedAttempt: PlannedTaskAttempt
      readonly proposal: FreshAttemptProposal
    }
  | {
      readonly _tag: "FreshOperationAction"
      readonly operationId: OperationId
      readonly proposal: FreshOperationProposal
    }
  | { readonly _tag: "IdentityFreeAction"; readonly proposal: IdentityFreeDeliveryProposal }

/** Process-local capabilities held by the one live owner of an admitted proposal. */
export type DeliveryActionForwardBoundary =
  | { readonly _tag: "AtomicBoundary"; readonly execution: AtomicBoundaryExecution }
  | { readonly _tag: "InterruptibleBoundary"; readonly execution: InterruptibleWorkflowBoundaryExecution }

export interface DeliveryActionExecutionLease {
  readonly acceptIntegrationTargetOwnership: Effect.Effect<void>
  readonly bindPlannedAttemptPosition: (correlation: PlannedAttemptExecutorCorrelation) => Effect.Effect<void>
  readonly forwardBoundary: DeliveryActionForwardBoundary
  readonly integrationTargets: IntegrationTargetResourceController
  readonly recordIntent: (operationId: OperationId) => Effect.Effect<void>
  readonly releasePlannedAttemptPosition: (correlation: PlannedAttemptExecutorCorrelation) => Effect.Effect<void>
  readonly withPlannedAttemptProtocol: <A, E, R>(
    correlation: PlannedAttemptExecutorCorrelation,
    effect: (permit: PlannedAttemptProtocolPermit) => Effect.Effect<A, E, R>
  ) => Effect.Effect<A, E | DeliveryActionProtocolAdmissionMissing, R>
}

const boundaryMismatch = (
  expected: DeliveryActionForwardBoundary["_tag"],
  actual: DeliveryActionForwardBoundary["_tag"]
) => ({ _tag: "DeliveryActionForwardBoundaryMismatch", actual, expected })

/** Fails closed if a route asks an atomic owner to perform an interruptible outside call. */
export const interruptibleBoundaryOf = (
  lease: Pick<DeliveryActionExecutionLease, "forwardBoundary">
): InterruptibleWorkflowBoundaryExecution =>
  lease.forwardBoundary._tag === "InterruptibleBoundary"
    ? lease.forwardBoundary.execution
    : { run: () => Effect.die(boundaryMismatch("InterruptibleBoundary", lease.forwardBoundary._tag)) }

/** Fails closed if a route asks an interruptible owner to enter an atomic integration section. */
export const runAtomicDeliveryBoundary = <A, E, R>(
  lease: Pick<DeliveryActionExecutionLease, "forwardBoundary">,
  execution: Effect.Effect<A, E, R>
): Effect.Effect<A, E, R> =>
  lease.forwardBoundary._tag === "AtomicBoundary"
    ? lease.forwardBoundary.execution.run(execution)
    : Effect.die(boundaryMismatch("AtomicBoundary", lease.forwardBoundary._tag))

/** A route attempted exact-attempt protocol work without declaring its admission requirement. */
export class DeliveryActionProtocolAdmissionMissing extends Schema.TaggedError<DeliveryActionProtocolAdmissionMissing>()(
  "DeliveryActionProtocolAdmissionMissing",
  { correlation: PlannedAttemptExecutorCorrelation, proposalId: DeliveryProposalId }
) {}

/** Typed semantic outcome; later domain work is always re-derived by the relation. */
export type DeliveryActionResult =
  | { readonly _tag: "ActionCompleted"; readonly proposalId: DeliveryProposalId }
  | {
      readonly _tag: "ActionDeferred"
      readonly proposalId: DeliveryProposalId
      readonly reason:
        | "CompletionClaimConflict"
        | "CompletionClaimNonConvergent"
        | "CompletionClaimReadUnavailable"
        | "CompletionClaimRejected"
        | "CompletionTaskNonConvergent"
        | "CompletionTaskUnavailable"
        | "ContinuationAuthorizationStale"
        | "FocusedTaskCompletionSuccessRequired"
        | AcceptedResultEvidenceConflict
        | AcceptedResultEvidenceUnavailable
        | CompletionTaskAmbiguousWait
        | CompletionTaskAuthorizationConflict
        | CompletionTaskAuthorizationWait
        | CompletionTaskConfirmationWait
        | IntegratorGitReadFailure
        | "TrackerGraphReadUnavailable"
        | CompletionTaskPreconditionConflict
    }
  | {
      readonly _tag: "ExecutorReportPublished"
      readonly plannedAttempt: PlannedTaskAttempt
      readonly proposalId: DeliveryProposalId
      readonly report: PlannedAttemptExecutorReport
    }
  | {
      readonly _tag: "IntegrationCandidateAdvanced"
      readonly proposalId: DeliveryProposalId
      readonly resourceDisposition: "Release" | "Retain"
      readonly state: IntegrationCandidateConstructionState
    }
  | {
      readonly _tag: "TrackerGraphObservationPublished"
      readonly operationId: OperationId
      readonly proposalId: DeliveryProposalId
      readonly snapshot: TaskDagSnapshot
    }

type ServiceFailure<S> = {
  [K in keyof S]: S[K] extends (...args: infer _Args) => Effect.Effect<infer _A, infer E, infer _R> ? E : never
}[keyof S]

type EffectFunctionFailure<F> = F extends (...args: infer _Args) => Effect.Effect<infer _A, infer E, infer _R>
  ? E
  : never

/** Exact typed protocol failures preserved by the action-coloured executor port. */
export type DeliveryActionExecutionError =
  | DeliveryActionProtocolAdmissionMissing
  | EffectFunctionFailure<typeof advanceAttemptRestart>
  | EffectFunctionFailure<typeof advanceAttemptStoppage>
  | EffectFunctionFailure<typeof observeAttemptStoppageExecutor>
  | EffectFunctionFailure<typeof recordStoppedAttemptClaimNoRelease>
  | EffectFunctionFailure<typeof queueAcceptedResultIntegrationResponsibility>
  | EffectFunctionFailure<typeof recoverTaskClaimOperation>
  | EffectFunctionFailure<typeof recoverTaskClaimReleaseOperation>
  | EffectFunctionFailure<typeof recoverTaskWorktreeOperation>
  | EffectFunctionFailure<typeof runIntegrationCandidateConstruction>
  | EffectFunctionFailure<typeof prepareIntegrationCandidateRun>
  | EffectFunctionFailure<typeof appendChangedHeadRetryQuarantine>
  | EffectFunctionFailure<typeof runTaskClaimReacquisition>
  | EffectFunctionFailure<typeof runTargetVerification>
  | EffectFunctionFailure<typeof runTargetPromotion>
  | EffectFunctionFailure<typeof runCompletionClaimReplacementProtocol>
  | EffectFunctionFailure<typeof runCompletionClaimDeletionProtocol>
  | EffectFunctionFailure<typeof startQueuedIntegration>
  | IntegrationCandidateBoundaryUnavailable
  | IntegratorBoundaryUnavailable
  | TargetVerificationRuntimeUnavailable
  | TargetPromotionRuntimeUnavailable
  | IntegrationFinalityRuntimeUnavailable
  | PlannedAttemptExecutorContinuationLimitReached
  | PlannedAttemptExecutorCommandReconciliationRequired
  | PlannedAttemptExecutorCorrelationMismatch
  | PlannedAttemptExecutorProjectionCorrelationMismatch
  | PlannedAttemptExecutorProjectionTemporarilyUnavailable
  | PlannedAttemptExecutorProjectionUnreadable
  | PlannedAttemptExecutorProjectionNoCurrentReport
  | PlannedAttemptExecutorResponsibilityAbandoned
  | PlannedAttemptExecutorResponsibilityContradiction
  | PlannedAttemptExecutorResponsibilityMissing
  | PlannedAttemptExecutorStateNoCurrentReport
  | PlannedAttemptExecutorStateTemporarilyUnavailable
  | PlannedAttemptExecutorStateUnreadable
  | PlannedAttemptContinuationAuthorizationRejected
  | PlannedAttemptExecutorSuspensionLimitReached
  | DeliveryRelationSourceError
  | ServiceFailure<InRunJournalService>
  | ServiceFailure<PlannedAttemptExecutorService>
  | ServiceFailure<TaskClaimAcquisitionPlannerService>
  | ServiceFailure<WorkflowInterpreterService>
  | ServiceFailure<WorkflowTraceService>

export interface DeliveryActionExecutorService {
  readonly execute: (
    action: MaterializedDeliveryAction,
    lease: DeliveryActionExecutionLease
  ) => Effect.Effect<DeliveryActionResult, DeliveryActionExecutionError>
}

/** Closed action-coloured interpreter used only by the delivery runtime owner. */
export class DeliveryActionExecutor extends Context.Service<DeliveryActionExecutor, DeliveryActionExecutorService>()(
  "@dalph/DeliveryActionExecutor"
) {}

export type DeliverySemanticTraceEvent =
  | { readonly _tag: "ActionOutcome"; readonly result: DeliveryActionResult }
  | { readonly _tag: "ProposalAdmitted"; readonly proposalId: DeliveryProposalId }
  | {
      readonly _tag: "ProposalDeferred"
      readonly proposalId: DeliveryProposalId
      readonly reason:
        | "IntegrationTargetUnavailable"
        | "PlannedAttemptProtocolUnavailable"
        | "TaskWorkPositionUnavailable"
    }

export interface DeliverySemanticTraceService {
  readonly emit: (event: DeliverySemanticTraceEvent) => Effect.Effect<void>
}

/** Optional semantic observer used to compare runtime meaning across Layers. */
export class DeliverySemanticTrace extends Context.Service<DeliverySemanticTrace, DeliverySemanticTraceService>()(
  "@dalph/DeliverySemanticTrace"
) {}
