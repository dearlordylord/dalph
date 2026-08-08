import type {
  IntegrationTarget,
  PlannedAttemptExecutorCorrelation,
  PlannedTaskAttempt,
  RunId,
  TaskId
} from "@dalph/contracts"
import { Schema } from "effect"
import type { TrackerTarget } from "../../authorities/task-tracker/target.js"
import type { JournalPosition } from "../../workflow-journal/identity.js"
import type { OperationId } from "../../workflow/identity.js"
import type { WorkflowOperation } from "../../workflow/registry/operation.js"
import type { IntegrationResponsibility } from "../../workflow/protocols/integration-admission/protocol.js"
import type { TaskClaimReacquisitionRequestId } from "../../workflow/protocols/task-claim-reacquisition/events.js"
import type { RunnableFrontierTransition } from "../frontier/frontier.js"
import type { WorkflowResponsibilityEntry } from "../reconstruction/state.js"
import type { FreshWorkflowStep } from "./fresh-workflow-step.js"

/** Stable structural identity of one exact proposed action; it is not a journal OperationId. */
export const DeliveryProposalId = Schema.NonEmptyString.pipe(Schema.brand("DeliveryProposalId"))
export type DeliveryProposalId = typeof DeliveryProposalId.Type

/** Position assigned by pure domain reconciliation before live admission is consulted. */
export const DeliveryProposalOrdinal = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)).pipe(
  Schema.brand("DeliveryProposalOrdinal")
)
export type DeliveryProposalOrdinal = typeof DeliveryProposalOrdinal.Type

export type DeliveryProposalOwner = "DeliveryReflection" | "DeliverySettlement" | "TicketDelivery" | "TrackerGraph"

/** Why this proposal appears at this exact place in the immutable domain order. */
export type DeliveryProposalOrderEvidence =
  | {
      readonly _tag: "FreshWorkflowOrder"
      readonly frontierOrdinal: DeliveryProposalOrdinal
      readonly step: FreshWorkflowStep["_tag"]
      readonly taskId: TaskId
    }
  | {
      readonly _tag: "RecoveredWorkflowOrder"
      readonly acceptedAt: JournalPosition | null
      readonly frontierOrdinal: DeliveryProposalOrdinal
      readonly responsibilityBeganAt: JournalPosition | null
      readonly transition: RunnableFrontierTransition["_tag"]
      readonly taskId: TaskId
    }
  | {
      readonly _tag: "IntegrationOrder"
      readonly frontierOrdinal: DeliveryProposalOrdinal
      readonly queuedAt: JournalPosition
      readonly startedAt: JournalPosition | null
      readonly taskId: TaskId
    }
  | {
      readonly _tag: "UnqueuedAcceptedResultOrder"
      readonly frontierOrdinal: DeliveryProposalOrdinal
      readonly taskId: TaskId
      readonly terminalAt: JournalPosition
    }
  | { readonly _tag: "TrackerGraphOrder"; readonly acceptedAt: JournalPosition | null }

/** The task-work position the runtime must prove before it may perform this action. */
export type TaskWorkPositionRequirement =
  | { readonly _tag: "NoTaskWorkPosition" }
  | {
      readonly _tag: "TaskWorkPositionRequired"
      readonly correlation: PlannedAttemptExecutorCorrelation
      readonly mode: "Existing"
      readonly taskId: TaskId
    }
  | {
      readonly _tag: "TaskWorkPositionRequired"
      readonly mode: "ReserveOrReuse"
      /** The exact attempt identity this position retains once it is already known. */
      readonly retainAs?: PlannedAttemptExecutorCorrelation
      readonly taskId: TaskId
    }

/** Exact repository/ref resource use required by an integration action. */
export type IntegrationTargetResourceRequirement =
  | { readonly _tag: "NoIntegrationTargetResource" }
  | {
      readonly _tag: "IntegrationTargetResourceRequired"
      readonly access: "Acquire" | "Release" | "UseHeld"
      readonly integrationTarget: IntegrationTarget
      readonly queuedAt: JournalPosition
    }

export interface DeliveryAdmissionRequirements {
  readonly integrationTarget: IntegrationTargetResourceRequirement
  readonly taskWorkPosition: TaskWorkPositionRequirement
}

type TrackerGraphReadOperation = typeof WorkflowOperation.cases.ReadTrackerGraph.Type
type TaskClaimReadOperation = typeof WorkflowOperation.cases.ReadTaskClaim.Type
type TaskSpecificationReadOperation = typeof WorkflowOperation.cases.ReadTaskWorkSpecification.Type
type WorktreeReadOperation = typeof WorkflowOperation.cases.ReadTaskWorktree.Type
type TargetLineageReadOperation = typeof WorkflowOperation.cases.ReadTargetLineage.Type
type TaskClaimReleaseOperation = typeof WorkflowOperation.cases.ReleaseTaskClaim.Type

/** Exact fields of a new authority action before its OperationId is allocated. */
export type NewRecoveredWorkflowAction =
  | {
      readonly _tag: "ReadTrackerGraph"
      readonly operation: Omit<TrackerGraphReadOperation, "operationId">
      readonly plannedAttempt: PlannedTaskAttempt
    }
  | {
      readonly _tag: "ReadTaskClaim"
      readonly operation: Omit<TaskClaimReadOperation, "operationId">
      readonly plannedAttempt: PlannedTaskAttempt | null
      readonly taskId: TaskId
    }
  | {
      readonly _tag: "ReadTaskWorkSpecification"
      readonly operation: Omit<TaskSpecificationReadOperation, "operationId">
      readonly plannedAttempt: PlannedTaskAttempt
    }
  | {
      readonly _tag: "ReadTaskWorktree"
      readonly operation: Omit<WorktreeReadOperation, "operationId">
      readonly plannedAttempt: PlannedTaskAttempt
    }
  | {
      readonly _tag: "ReadTargetLineage"
      readonly operation: Omit<TargetLineageReadOperation, "operationId">
      readonly plannedAttempt: PlannedTaskAttempt
    }
  | {
      readonly _tag: "ReleaseExternallyCompletedTaskClaim"
      readonly operation: {
        readonly _tag: "ReleaseTaskClaim"
        readonly predecessorOperationIds: TaskClaimReleaseOperation["predecessorOperationIds"]
        readonly release: Omit<TaskClaimReleaseOperation["release"], "operationId">
      }
      readonly plannedAttempt: PlannedTaskAttempt
    }
  | {
      readonly _tag: "ReleaseStoppedAttemptClaim"
      readonly operation: {
        readonly _tag: "ReleaseTaskClaim"
        readonly predecessorOperationIds: TaskClaimReleaseOperation["predecessorOperationIds"]
        readonly release: Omit<TaskClaimReleaseOperation["release"], "operationId">
      }
      readonly plannedAttempt: PlannedTaskAttempt
      readonly requestId: Extract<
        RunnableFrontierTransition,
        { readonly _tag: "ReleaseStoppedAttemptClaim" }
      >["requestId"]
    }
  | {
      readonly _tag: "TaskClaimReacquisition"
      readonly plannedAttempt: PlannedTaskAttempt
      readonly requestId: Extract<
        RunnableFrontierTransition,
        { readonly _tag: "CommitTaskClaimReacquisitionIntent" }
      >["requestId"]
      readonly taskId: TaskId
    }

type FreshExecutorStep = Extract<
  FreshWorkflowStep,
  { readonly _tag: "ContinuePlannedAttemptExecutorWork" | "StartPlannedAttemptExecutorWork" }
>
export type FreshOperationStep = Exclude<FreshWorkflowStep, FreshExecutorStep>

type FreshAttemptPlanningStep = Extract<FreshOperationStep, { readonly _tag: "RecordTaskAttemptPlan" }>
type FreshWorkflowOperationStep = Exclude<FreshOperationStep, FreshAttemptPlanningStep>

export type FreshOperationOnlyRoute =
  | { readonly _tag: "FreshWorkflowRoute"; readonly step: FreshWorkflowOperationStep }
  | { readonly _tag: "RecoveredNewActionRoute"; readonly action: NewRecoveredWorkflowAction }
  | {
      readonly _tag: "TrackerGraphReadRoute"
      readonly purpose: "EstablishCurrentGraph"
      readonly target: TrackerTarget
    }

export interface FreshAttemptPlanningRoute {
  readonly _tag: "FreshWorkflowRoute"
  readonly step: FreshAttemptPlanningStep
}

export type FreshOperationRoute = FreshAttemptPlanningRoute | FreshOperationOnlyRoute

export type AcceptedWorkflowTransition = Extract<
  RunnableFrontierTransition,
  {
    readonly _tag:
      | "CheckTaskClaim"
      | "ReconcileTaskClaim"
      | "ReconcileTaskClaimRelease"
      | "ReconcileTaskWorktree"
      | "ObservePlannedAttemptContinuationClaim"
      | "ObservePlannedAttemptContinuationGraph"
      | "ObservePlannedAttemptContinuationSpecification"
      | "ObservePlannedAttemptContinuationTargetLineage"
      | "ObservePlannedAttemptContinuationWorktree"
      | "ObserveResponsibleTaskClaim"
      | "ObserveStoppedAttemptClaim"
  }
>

export interface AcceptedWorkflowRoute {
  readonly _tag: "AcceptedWorkflowRoute"
  readonly transition: AcceptedWorkflowTransition
}

export type IdentityFreeWorkflowTransition = Extract<
  RunnableFrontierTransition,
  {
    readonly _tag:
      | "AcquireStartedIntegrationTarget"
      | "AdvanceAttemptStoppage"
      | "ObserveAttemptStoppageExecutor"
      | "ContinuePlannedAttemptExecutorWork"
      | "ObservePlannedAttemptContinuationExecutor"
      | "ContinueStartedIntegrationCandidate"
      | "RunTargetVerification"
      | "RunTargetPromotion"
      | "ReplacePromotedTaskClaim"
      | "DeleteCompletedTaskCompletionClaim"
      | "QueueAcceptedResultIntegrationResponsibility"
      | "RecordStoppedAttemptClaimNoRelease"
      | "ReleaseStartedIntegrationTarget"
      | "StartQueuedIntegration"
      | "SuspendPlannedAttemptExecutorWork"
  }
>

export type IdentityFreeWorkflowRoute =
  | { readonly _tag: "FreshExecutorWorkflowRoute"; readonly step: FreshExecutorStep }
  | { readonly _tag: "IdentityFreeWorkflowRoute"; readonly transition: IdentityFreeWorkflowTransition }

export interface DeliveryProposalBase {
  readonly _tag: "DeliveryActionProposal"
  readonly admission: DeliveryAdmissionRequirements
  readonly id: DeliveryProposalId
  readonly order: DeliveryProposalOrderEvidence
  readonly owner: DeliveryProposalOwner
  /** A still-live owner of this exact operation must acknowledge completion before this proposal may start. */
  readonly waitsForLiveOperationId: OperationId | null
}

type FreshOperationIdentity = {
  readonly _tag: "FreshOperationIdRequired"
  readonly source:
    | { readonly _tag: "Allocate" }
    | { readonly _tag: "ExternalSuccessReleaseClaim"; readonly claimOperationId: OperationId }
    | { readonly _tag: "TaskClaimReacquisitionRequest"; readonly requestId: TaskClaimReacquisitionRequestId }
}

/** New identity allocation is declared, but projection never allocates either identity. */
export type FreshIdentityDeliveryProposal =
  | (DeliveryProposalBase & {
      readonly actionIdentity: { readonly _tag: "FreshOperationAndAttemptIdsRequired" }
      readonly route: FreshAttemptPlanningRoute
    })
  | (DeliveryProposalBase & {
      readonly actionIdentity: FreshOperationIdentity
      readonly route: FreshOperationOnlyRoute
    })

/** Reconciliation reuses the exact OperationId established by accepted intent. */
export interface AcceptedIdentityDeliveryProposal extends DeliveryProposalBase {
  readonly actionIdentity: { readonly _tag: "ExistingOperationId"; readonly operationId: OperationId }
  readonly route: AcceptedWorkflowRoute
}

/** Executor and integration actions use exact non-operation identities already carried by their route. */
export interface IdentityFreeDeliveryProposal extends DeliveryProposalBase {
  readonly actionIdentity: { readonly _tag: "NoWorkflowOperationIdentity" }
  readonly route: IdentityFreeWorkflowRoute
}

export type DeliveryActionProposal =
  | AcceptedIdentityDeliveryProposal
  | FreshIdentityDeliveryProposal
  | IdentityFreeDeliveryProposal

/** The tracker relation can propose only one typed graph-read route it owns. */
export type TrackerGraphActionProposal = FreshIdentityDeliveryProposal & {
  readonly owner: "TrackerGraph"
  readonly route: Extract<FreshOperationRoute, { readonly _tag: "TrackerGraphReadRoute" }>
}

export interface DeliveryProposalContributions {
  readonly deliverySettlement: ReadonlyArray<DeliveryActionProposal>
  readonly issues: ReadonlyArray<DeliveryProposalDerivationIssue>
  readonly ticketDelivery: ReadonlyArray<DeliveryActionProposal>
}

/** A transition cannot authorize action because its exact route evidence is incomplete. */
export type DeliveryProposalDerivationIssue =
  | {
      readonly _tag: "AcceptedOperationEvidenceMissing"
      readonly operationId: OperationId
      readonly taskId: TaskId
      readonly transition: RunnableFrontierTransition["_tag"]
    }
  | {
      readonly _tag: "FreshRouteProvenanceMissing"
      readonly taskId: TaskId
      readonly transition:
        | "CommitFreshTaskClaimIntent"
        | "ContinueFreshWorkflowOperation"
        | "StartPlannedAttemptExecutorWork"
    }
  | {
      readonly _tag: "TypedRoutePolicyContradiction"
      readonly taskId: TaskId
      readonly transition: RunnableFrontierTransition["_tag"]
    }

export interface FreshDecision {
  readonly step: FreshWorkflowStep
  readonly transition: RunnableFrontierTransition
}

export interface DeliveryProposalsInput {
  readonly acceptedAt?: JournalPosition | null
  readonly acceptedOperationIds: ReadonlySet<OperationId>
  readonly fresh: ReadonlyArray<FreshDecision>
  readonly integrationResponsibilities?: ReadonlyArray<IntegrationResponsibility>
  readonly responsibilities?: ReadonlyArray<WorkflowResponsibilityEntry>
  readonly runId: RunId
  readonly transitions: ReadonlyArray<RunnableFrontierTransition>
}

export interface TrackerGraphReadProposalInput {
  readonly acceptedAt: JournalPosition | null
  readonly purpose: "EstablishCurrentGraph"
  readonly runId: RunId
  readonly target: TrackerTarget
}

const canonical = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonical)
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .toSorted(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, canonical(entry)])
    )
  }
  return value
}

export const deliveryProposalIdOf = (runId: RunId, route: DeliveryActionProposal["route"]): DeliveryProposalId =>
  DeliveryProposalId.make(`delivery:${JSON.stringify(canonical({ route, runId }))}`)

/** Describes one fresh complete-graph read without allocating or recording its OperationId. */
export const trackerGraphReadProposalOf = (input: TrackerGraphReadProposalInput): TrackerGraphActionProposal => {
  const route: FreshOperationRoute = { _tag: "TrackerGraphReadRoute", purpose: input.purpose, target: input.target }
  return {
    _tag: "DeliveryActionProposal",
    actionIdentity: { _tag: "FreshOperationIdRequired", source: { _tag: "Allocate" } },
    admission: {
      integrationTarget: { _tag: "NoIntegrationTargetResource" },
      taskWorkPosition: { _tag: "NoTaskWorkPosition" }
    },
    id: deliveryProposalIdOf(input.runId, route),
    order: { _tag: "TrackerGraphOrder", acceptedAt: input.acceptedAt },
    owner: "TrackerGraph",
    route,
    waitsForLiveOperationId: null
  }
}
