import type {
  PlannedAttemptExecutorCorrelation,
  PlannedAttemptExecutorReport,
  PlannedAttemptExecutorService,
  PlannedTaskAttempt
} from "@dalph/contracts"
import { Context, type Effect } from "effect"
import type { InRunJournalService } from "../../workflow-journal/store.js"
import type { WorkflowInterpreterService, WorkflowTraceService } from "../../workflow/interpretation/interpreter.js"
import type { TaskClaimAcquisitionPlannerService } from "../../workflow/protocols/task-claim-acquisition/plan.js"
import type {
  PlannedAttemptExecutorContinuationLimitReached,
  PlannedAttemptExecutorCorrelationMismatch
} from "../../workflow/protocols/planned-attempt-executor-work/protocol.js"
import type {
  queueAcceptedResultIntegrationResponsibility,
  startQueuedIntegration
} from "../../workflow/protocols/integration-admission/protocol.js"
import type { runIntegrationCandidateConstruction } from "../run/integration-candidate-runtime.js"
import type { runTaskClaimReacquisition } from "../../workflow/protocols/task-claim-reacquisition/execute.js"
import type {
  recoverTaskClaimOperation,
  recoverTaskClaimReleaseOperation,
  recoverTaskWorktreeOperation
} from "../frontier/recovery.js"
import type { IntegrationCandidateBoundaryUnavailable } from "./integration-candidate-boundary.js"
import type { IntegrationCandidateConstructionState } from "../../workflow/protocols/integration-candidate-construction/protocol.js"
import type { OperationId } from "../../workflow/identity.js"
import type { FreshWorkflowActionFact } from "../run/fresh-workflow-fact.js"
import type { TaskDagSnapshot } from "../../authorities/task-tracker/graph.js"
import type { IntegrationTargetResourceController } from "../admission/integration-target-resource.js"
import type {
  AcceptedIdentityDeliveryProposal,
  DeliveryProposalId,
  FreshIdentityDeliveryProposal,
  IdentityFreeDeliveryProposal
} from "./delivery-action-proposal.js"

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
export interface DeliveryActionExecutionLease {
  readonly acceptIntegrationTargetOwnership: Effect.Effect<void>
  readonly bindPlannedAttemptPosition: (correlation: PlannedAttemptExecutorCorrelation) => Effect.Effect<void>
  readonly integrationTargets: IntegrationTargetResourceController
  readonly recordIntent: (operationId: OperationId) => Effect.Effect<void>
  readonly releasePlannedAttemptPosition: (correlation: PlannedAttemptExecutorCorrelation) => Effect.Effect<void>
}

/** Typed semantic outcome; later domain work is always re-derived by the relation. */
export type DeliveryActionResult =
  | { readonly _tag: "ActionCompleted"; readonly proposalId: DeliveryProposalId }
  | {
      readonly _tag: "FreshWorkflowActionFactProduced"
      readonly fact: FreshWorkflowActionFact
      readonly proposalId: DeliveryProposalId
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
  | EffectFunctionFailure<typeof queueAcceptedResultIntegrationResponsibility>
  | EffectFunctionFailure<typeof recoverTaskClaimOperation>
  | EffectFunctionFailure<typeof recoverTaskClaimReleaseOperation>
  | EffectFunctionFailure<typeof recoverTaskWorktreeOperation>
  | EffectFunctionFailure<typeof runIntegrationCandidateConstruction>
  | EffectFunctionFailure<typeof runTaskClaimReacquisition>
  | EffectFunctionFailure<typeof startQueuedIntegration>
  | IntegrationCandidateBoundaryUnavailable
  | PlannedAttemptExecutorContinuationLimitReached
  | PlannedAttemptExecutorCorrelationMismatch
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
  | {
      readonly _tag: "ActionOutcome"
      readonly outcome: DeliveryActionResult["_tag"]
      readonly proposalId: DeliveryProposalId
    }
  | { readonly _tag: "ProposalAdmitted"; readonly proposalId: DeliveryProposalId }
  | {
      readonly _tag: "ProposalDeferred"
      readonly proposalId: DeliveryProposalId
      readonly reason: "IntegrationTargetUnavailable" | "TaskWorkPositionUnavailable"
    }

export interface DeliverySemanticTraceService {
  readonly emit: (event: DeliverySemanticTraceEvent) => Effect.Effect<void>
}

/** Optional semantic observer used to compare runtime meaning across Layers. */
export class DeliverySemanticTrace extends Context.Service<DeliverySemanticTrace, DeliverySemanticTraceService>()(
  "@dalph/DeliverySemanticTrace"
) {}
