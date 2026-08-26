import type {
  IntegrationTarget,
  PlannedAttemptExecutorCorrelation,
  PlannedTaskAttempt,
  RunId,
  TaskId
} from "@dalph/contracts"
import { Match, Schema } from "effect"
import type { TrackerTarget } from "../../authorities/task-tracker/target.js"
import type { JournalPosition } from "../../workflow-journal/identity.js"
import type { OperationId } from "../../workflow/identity.js"
import type {
  CancelledAttemptTaskClaimReleaseOperation,
  StoppedAttemptTaskClaimReleaseOperation,
  WorkflowOperation,
  WorkflowTaskClaimReleaseOperation
} from "../../workflow/registry/operation.js"
import type { IntegrationResponsibility } from "../../workflow/protocols/integration-admission/protocol.js"
import type { TaskClaimReacquisitionRequestId } from "../../workflow/protocols/task-claim-reacquisition/events.js"
import type { RunnableFrontierTransition } from "../frontier/frontier.js"
import type { WorkflowResponsibilityEntry } from "../reconstruction/state.js"
import type { FreshWorkflowStep } from "./fresh-workflow-step.js"
import type { TransitionForRoute } from "./delivery-transition-policy.js"
import type { ExecutorProgressGraphReadRequirement } from "../executor-progress-graph-read.js"

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

/** The exact task region ordered by a proposal, or null for the Run-wide tracker graph read. */
export const deliveryProposalOrderTaskId = (order: DeliveryProposalOrderEvidence): TaskId | null =>
  Match.valueTags(order, {
    FreshWorkflowOrder: ({ taskId }) => taskId,
    IntegrationOrder: ({ taskId }) => taskId,
    RecoveredWorkflowOrder: ({ taskId }) => taskId,
    TrackerGraphOrder: () => null,
    UnqueuedAcceptedResultOrder: ({ taskId }) => taskId
  })

/** The task-work position the runtime must prove before it may perform this action. */
export type TaskWorkPositionRequirement =
  | { readonly _tag: "NoTaskWorkPosition" }
  | { readonly _tag: "TaskWorkPositionRequired"; readonly mode: "Existing"; readonly taskId: TaskId }
  | { readonly _tag: "TaskWorkPositionRequired"; readonly mode: "ReserveOrReuse"; readonly taskId: TaskId }

/**
 * Process-local exclusion between executor commands and a Stop decision that may abandon the same exact attempt.
 * It is neither executor authority nor a task-work capacity position and disappears on process loss.
 */
export type PlannedAttemptProtocolRequirement =
  | { readonly _tag: "NoPlannedAttemptProtocol" }
  | { readonly _tag: "PlannedAttemptProtocolRequired"; readonly correlation: PlannedAttemptExecutorCorrelation }

/** Exact repository/ref resource use required by an integration action. */
export type IntegrationTargetResourceRequirement =
  | { readonly _tag: "NoIntegrationTargetResource" }
  | {
      readonly _tag: "IntegrationTargetResourceRequired"
      readonly access: "Acquire" | "Release" | "UseHeld"
      readonly integrationTarget: IntegrationTarget
      readonly queuedAt: JournalPosition
    }

type UncorrelatedTaskWorkPositionRequirement = Exclude<TaskWorkPositionRequirement, { readonly mode: "Existing" }>

/** One coherent admission requirement; an exact attempt correlation is carried once and shared by both resources. */
export type DeliveryAdmissionRequirements = { readonly integrationTarget: IntegrationTargetResourceRequirement } & (
  | {
      readonly plannedAttemptProtocol: Extract<
        PlannedAttemptProtocolRequirement,
        { readonly _tag: "NoPlannedAttemptProtocol" }
      >
      readonly taskWorkPosition: UncorrelatedTaskWorkPositionRequirement
    }
  | {
      readonly plannedAttemptProtocol: Extract<
        PlannedAttemptProtocolRequirement,
        { readonly _tag: "PlannedAttemptProtocolRequired" }
      >
      readonly taskWorkPosition: TaskWorkPositionRequirement
    }
)

type TrackerGraphReadOperation = typeof WorkflowOperation.cases.ReadTrackerGraph.Type
type TaskClaimReadOperation = typeof WorkflowOperation.cases.ReadTaskClaim.Type
type TaskSpecificationReadOperation = typeof WorkflowOperation.cases.ReadTaskWorkSpecification.Type
type WorktreeReadOperation = typeof WorkflowOperation.cases.ReadTaskWorktree.Type
type TargetLineageReadOperation = typeof WorkflowOperation.cases.ReadTargetLineage.Type
type TaskClaimReleaseOperation = typeof WorkflowOperation.cases.ReleaseTaskClaim.Type
type NewReleaseOperation<Operation extends TaskClaimReleaseOperation> = {
  readonly _tag: "ReleaseTaskClaim"
  readonly authority: Operation["authority"]
  readonly predecessorOperationIds: Operation["predecessorOperationIds"]
  readonly release: Omit<Operation["release"], "operationId">
}
type NonEmptyOperationIds = readonly [OperationId, ...ReadonlyArray<OperationId>]
type NonEmptyTaskIds = readonly [TaskId, ...ReadonlyArray<TaskId>]

/** Exact fields of a new authority action before its OperationId is allocated. */
export type NewRecoveredWorkflowAction =
  | {
      readonly _tag: "ReadTrackerGraph"
      readonly operation: Omit<TrackerGraphReadOperation, "operationId">
      /** Fresh recovery may carry a deterministic operation identity without treating it as accepted journal evidence. */
      readonly operationIdSource:
        | { readonly _tag: "Allocate" }
        | { readonly _tag: "DeterministicOperationId"; readonly operationId: OperationId }
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
      readonly operation: NewReleaseOperation<WorkflowTaskClaimReleaseOperation>
      readonly plannedAttempt: PlannedTaskAttempt
    }
  | {
      readonly _tag: "ReleaseStoppedAttemptClaim"
      readonly operation: NewReleaseOperation<StoppedAttemptTaskClaimReleaseOperation>
      readonly plannedAttempt: PlannedTaskAttempt
      readonly requestId: Extract<
        RunnableFrontierTransition,
        { readonly _tag: "ReleaseStoppedAttemptClaim" }
      >["requestId"]
    }
  | {
      readonly _tag: "ReleaseCancelledAttemptClaim"
      readonly operation: NewReleaseOperation<CancelledAttemptTaskClaimReleaseOperation>
      readonly plannedAttempt: PlannedTaskAttempt
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
  | TrackerGraphReadRoute

/**
 * One fresh tracker graph boundary carries the exact evidence needed by its
 * purpose. A post-claim refresh cannot silently fall back to an empty causal
 * predecessor or an unscoped task coverage list.
 */
export type TrackerGraphReadRoute =
  | {
      readonly _tag: "TrackerGraphReadRoute"
      /** The latest accepted graph read when this establishes current facts after restart. */
      readonly predecessorOperationIds?: NonEmptyOperationIds
      readonly purpose: "EstablishCurrentGraph"
      readonly target: TrackerTarget
    }
  | {
      readonly _tag: "TrackerGraphReadRoute"
      readonly explicitlyCoveredTaskIds: NonEmptyTaskIds
      readonly predecessorOperationIds: NonEmptyOperationIds
      readonly purpose: "RefreshCurrentGraph"
      readonly target: TrackerTarget
    }
  | {
      readonly _tag: "TrackerGraphReadRoute"
      readonly explicitlyCoveredTaskIds: NonEmptyTaskIds
      readonly pendingReports: ExecutorProgressGraphReadRequirement["pendingReports"]
      readonly purpose: "CheckExecutorProgress"
      readonly unresolvedReadOperationId: OperationId | null
      readonly target: TrackerTarget
    }

export interface FreshAttemptPlanningRoute {
  readonly _tag: "FreshWorkflowRoute"
  readonly step: FreshAttemptPlanningStep
}

export type FreshOperationRoute = FreshAttemptPlanningRoute | FreshOperationOnlyRoute

export type AcceptedWorkflowTransition = TransitionForRoute<"AcceptedOperation"> | TransitionForRoute<"Observation">

export interface AcceptedWorkflowRoute {
  readonly _tag: "AcceptedWorkflowRoute"
  readonly transition: AcceptedWorkflowTransition
}

/** The one operation identity already carried by an accepted route's transition. */
export const acceptedWorkflowTransitionOperationId = (transition: AcceptedWorkflowTransition): OperationId => {
  if ("operationId" in transition) return transition.operationId
  return transition.operation._tag === "ReleaseTaskClaim"
    ? transition.operation.release.operationId
    : transition.operation.operationId
}

export type IdentityFreeWorkflowTransition = TransitionForRoute<"IdentityFree">

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
    | { readonly _tag: "DeterministicOperationId"; readonly operationId: OperationId }
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
  readonly actionIdentity: { readonly _tag: "ExistingOperationId" }
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
  readonly route: TrackerGraphReadRoute
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

export type TrackerGraphReadProposalInput =
  | {
      readonly acceptedAt: JournalPosition | null
      readonly predecessorOperationIds?: NonEmptyOperationIds
      readonly purpose: "EstablishCurrentGraph"
      readonly runId: RunId
      readonly target: TrackerTarget
      /** A graph-read intent already recorded for this process-local requirement. */
      readonly waitsForLiveOperationId?: OperationId | null
    }
  | {
      readonly acceptedAt: JournalPosition | null
      readonly explicitlyCoveredTaskIds: NonEmptyTaskIds
      readonly predecessorOperationIds: NonEmptyOperationIds
      readonly purpose: "RefreshCurrentGraph"
      readonly runId: RunId
      readonly target: TrackerTarget
    }
  | {
      readonly acceptedAt: JournalPosition | null
      readonly purpose: "CheckExecutorProgress"
      readonly requirement: ExecutorProgressGraphReadRequirement
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

export const deliveryProposalIdOf = (runId: RunId, route: DeliveryActionProposal["route"]): DeliveryProposalId => {
  // Establishment reads retain one process-local identity. Each progress-read
  // batch retains its own accepted-report identity so a settled owner for an
  // earlier batch cannot hide a later report behind the same proposal ID.
  const identityRoute =
    route._tag === "TrackerGraphReadRoute"
      ? route.purpose === "EstablishCurrentGraph"
        ? { _tag: route._tag, purpose: route.purpose, target: route.target }
        : route.purpose === "CheckExecutorProgress"
          ? {
              _tag: route._tag,
              explicitlyCoveredTaskIds: [...route.explicitlyCoveredTaskIds].toSorted((left, right) =>
                left.localeCompare(right)
              ),
              pendingReports: route.pendingReports
                .map(({ acceptedAt, correlation, taskId }) => ({ acceptedAt, correlation, taskId }))
                .toSorted(
                  (left, right) =>
                    left.acceptedAt - right.acceptedAt ||
                    left.taskId.localeCompare(right.taskId) ||
                    left.correlation.runId.localeCompare(right.correlation.runId) ||
                    left.correlation.attemptId.localeCompare(right.correlation.attemptId)
                ),
              purpose: route.purpose,
              target: route.target
            }
          : route
      : route
  return DeliveryProposalId.make(`delivery:${JSON.stringify(canonical({ route: identityRoute, runId }))}`)
}

/** Describes one fresh complete-graph read without allocating or recording its OperationId. */
export const trackerGraphReadProposalOf = (input: TrackerGraphReadProposalInput): TrackerGraphActionProposal => {
  const route: FreshOperationRoute =
    input.purpose === "EstablishCurrentGraph"
      ? {
          _tag: "TrackerGraphReadRoute",
          ...(input.predecessorOperationIds === undefined
            ? {}
            : { predecessorOperationIds: input.predecessorOperationIds }),
          purpose: input.purpose,
          target: input.target
        }
      : input.purpose === "CheckExecutorProgress"
        ? {
            _tag: "TrackerGraphReadRoute",
            explicitlyCoveredTaskIds: input.requirement.explicitlyCoveredTaskIds,
            pendingReports: input.requirement.pendingReports,
            purpose: input.purpose,
            unresolvedReadOperationId: input.requirement.unresolvedReadOperationId,
            target: input.target
          }
        : {
            _tag: "TrackerGraphReadRoute",
            explicitlyCoveredTaskIds: input.explicitlyCoveredTaskIds,
            predecessorOperationIds: input.predecessorOperationIds,
            purpose: input.purpose,
            target: input.target
          }
  return {
    _tag: "DeliveryActionProposal",
    actionIdentity: { _tag: "FreshOperationIdRequired", source: { _tag: "Allocate" } },
    admission: {
      integrationTarget: { _tag: "NoIntegrationTargetResource" },
      plannedAttemptProtocol: { _tag: "NoPlannedAttemptProtocol" },
      taskWorkPosition: { _tag: "NoTaskWorkPosition" }
    },
    id: deliveryProposalIdOf(input.runId, route),
    order: { _tag: "TrackerGraphOrder", acceptedAt: input.acceptedAt },
    owner: "TrackerGraph",
    route,
    waitsForLiveOperationId:
      input.purpose === "CheckExecutorProgress"
        ? input.requirement.unresolvedReadOperationId
        : input.purpose === "EstablishCurrentGraph"
          ? (input.waitsForLiveOperationId ?? null)
          : null
  }
}
