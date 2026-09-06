/* eslint-disable max-lines -- Delivery proposal types and their private authority constructors remain colocated. */
import { plannedTaskAttemptEquivalence, TaskId } from "@dalph/contracts"
import type { IntegrationTarget, PlannedAttemptExecutorCorrelation, PlannedTaskAttempt, RunId } from "@dalph/contracts"
import { Match, Result, Schema } from "effect"
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
import { runnableTransitionTaskId, type RunnableFrontierTransition } from "../frontier/frontier.js"
import type { WorkflowResponsibilityEntry } from "../reconstruction/state.js"
import type { FreshWorkflowStep } from "./fresh-workflow-step.js"
import type { TransitionForRoute } from "./delivery-transition-policy.js"
import type { FreshTaskCommitment } from "../admission/fresh-task-admission.js"
import { immutableSnapshot } from "../immutable-snapshot.js"
import {
  replacementContinuationAuthorityMatchesStep,
  replacementContinuationAuthorityOf,
  type ReplacementContinuationAuthority
} from "./replacement-continuation-authority.js"

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
  { readonly _tag: "ObservePlannedAttemptExecutorWork" | "BeginPlannedAttemptExecutorWork" }
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
    /** A recovery boundary selected this exact identity before admission. */
    | { readonly _tag: "Preserve"; readonly operationId: OperationId }
    | { readonly _tag: "ExternalSuccessReleaseClaim"; readonly claimOperationId: OperationId }
    | { readonly _tag: "TaskClaimReacquisitionRequest"; readonly requestId: TaskClaimReacquisitionRequestId }
}

/** A fresh action operation identity is declared before admission; projection never allocates it. */
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

type FreshContinuationProposalAuthority = {
  readonly authority:
    | { readonly _tag: "FreshCommitmentAuthority"; readonly commitment: FreshTaskCommitment }
    | { readonly _tag: "ReplacementAuthority"; readonly replacement: ReplacementContinuationAuthority }
  readonly continuationSnapshot: FreshContinuationAuthoritySnapshot
}

const issuedFreshContinuationProposals = new WeakMap<object, FreshContinuationProposalAuthority>()

type FreshContinuationAuthoritySnapshot =
  | {
      readonly _tag: "FreshOperationContinuationAuthority"
      readonly claimOperationId: OperationId
      readonly predecessorOperationId: OperationId
      readonly runId: RunId
      readonly step: FreshCommittedContinuationOperationStep["_tag"]
      readonly taskId: TaskId
    }
  | {
      readonly _tag: "FreshAttemptHandoffAuthority"
      readonly claimOperationId: OperationId
      readonly plannedAttempt: PlannedTaskAttempt
      readonly runId: RunId
      readonly step: FreshContinuationBeginStep["_tag"]
      readonly taskId: TaskId
    }

export type FreshContinuationCommitmentRequirement =
  | { readonly _tag: "FreshContinuationCommitmentNotRequired" }
  | { readonly _tag: "FreshContinuationCommitmentMissing" }
  | { readonly _tag: "FreshContinuationCommitmentRequired"; readonly commitment: FreshTaskCommitment }
  | { readonly _tag: "ReplacementContinuationRequired"; readonly replacement: ReplacementContinuationAuthority }

const proposalNeedsFreshCommitment = (proposal: DeliveryActionProposal): boolean => {
  const route = proposal.route
  if (route._tag === "FreshExecutorWorkflowRoute") return route.step._tag === "BeginPlannedAttemptExecutorWork"
  if (route._tag !== "FreshWorkflowRoute") return false
  return (
    route.step._tag === "ReadPostClaimGraph" ||
    route.step._tag === "ReadTaskWorkSpecification" ||
    route.step._tag === "RecordTaskAttemptPlan" ||
    route.step._tag === "ReconcileTaskWorktree"
  )
}

const proposalContinuationStep = (proposal: DeliveryActionProposal): FreshWorkflowStep | undefined => {
  const route = proposal.route
  return route._tag === "FreshWorkflowRoute" || route._tag === "FreshExecutorWorkflowRoute" ? route.step : undefined
}

const continuationClaimOperationIdOrNull = (step: FreshWorkflowStep): OperationId | null =>
  step._tag === "ReadPostClaimGraph"
    ? step.claimOperation.acquisition.operationId
    : "claimOperationId" in step
      ? step.claimOperationId
      : null

const continuationSnapshotMatches = (
  proposal: DeliveryActionProposal,
  step: FreshWorkflowStep,
  snapshot: FreshContinuationAuthoritySnapshot
): boolean => {
  const claimOperationId = continuationClaimOperationIdOrNull(step)
  return Match.valueTags(snapshot, {
    FreshAttemptHandoffAuthority: (attempt) =>
      step._tag === attempt.step &&
      step.task.id === attempt.taskId &&
      claimOperationId === attempt.claimOperationId &&
      proposal.waitsForLiveOperationId === null &&
      "plannedAttempt" in step &&
      step.plannedAttempt.runId === attempt.runId &&
      plannedTaskAttemptEquivalence(step.plannedAttempt, attempt.plannedAttempt),
    FreshOperationContinuationAuthority: (operation) =>
      step._tag === operation.step &&
      step.task.id === operation.taskId &&
      claimOperationId === operation.claimOperationId &&
      "predecessorOperationId" in step &&
      step.predecessorOperationId === operation.predecessorOperationId &&
      proposal.waitsForLiveOperationId === operation.predecessorOperationId
  })
}

/** Reveals whether one proposal carries the private exact-commitment capability required by its route. */
export const freshContinuationCommitmentRequirementOf = (
  proposal: DeliveryActionProposal
): FreshContinuationCommitmentRequirement => {
  if (!proposalNeedsFreshCommitment(proposal)) return { _tag: "FreshContinuationCommitmentNotRequired" }
  const authority = issuedFreshContinuationProposals.get(proposal)
  if (authority === undefined) return { _tag: "FreshContinuationCommitmentMissing" }
  const step = proposalContinuationStep(proposal)
  if (step === undefined || !continuationSnapshotMatches(proposal, step, authority.continuationSnapshot)) {
    return { _tag: "FreshContinuationCommitmentMissing" }
  }
  return authority.authority._tag === "FreshCommitmentAuthority"
    ? { _tag: "FreshContinuationCommitmentRequired", commitment: authority.authority.commitment }
    : { _tag: "ReplacementContinuationRequired", replacement: authority.authority.replacement }
}

/**
 * A proposal derived from an already-started responsibility. Runtime uses
 * this durable order evidence to preserve existing responsibility priority
 * when its reservation is deferred; it must not infer priority from a route
 * or transition tag.
 */
type ExistingResponsibilityOrderEvidence = Extract<
  DeliveryProposalOrderEvidence,
  { readonly _tag: "RecoveredWorkflowOrder" }
> & { readonly responsibilityBeganAt: JournalPosition }

export type ExistingResponsibilityDeliveryProposal = DeliveryActionProposal & {
  readonly order: ExistingResponsibilityOrderEvidence
}

export const isExistingResponsibilityDeliveryProposal = (
  proposal: DeliveryActionProposal
): proposal is ExistingResponsibilityDeliveryProposal => {
  const order = proposal.order
  return order._tag === "RecoveredWorkflowOrder" && order.responsibilityBeganAt !== null
}

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
        | "BeginPlannedAttemptExecutorWork"
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

type FreshCommittedContinuationOperationStep = Extract<
  FreshWorkflowStep,
  {
    readonly _tag:
      | "ReadPostClaimGraph"
      | "ReadTaskWorkSpecification"
      | "RecordTaskAttemptPlan"
      | "ReconcileTaskWorktree"
  }
>
type FreshPositionFreeContinuationOperationStep = Extract<FreshWorkflowStep, { readonly _tag: "ReadRejectedTaskClaim" }>
type FreshContinuationOperationTransition = Extract<
  RunnableFrontierTransition,
  { readonly _tag: "ContinueFreshWorkflowOperation" }
>
type FreshContinuationBeginStep = Extract<FreshWorkflowStep, { readonly _tag: "BeginPlannedAttemptExecutorWork" }>
type FreshContinuationBeginTransition = Extract<
  RunnableFrontierTransition,
  { readonly _tag: "BeginPlannedAttemptExecutorWork" }
>
type FreshContinuationObserveStep = Extract<FreshWorkflowStep, { readonly _tag: "ObservePlannedAttemptExecutorWork" }>
type FreshContinuationObserveTransition = Extract<
  RunnableFrontierTransition,
  { readonly _tag: "ObservePlannedAttemptExecutorWork" }
>

type FreshCommitmentBoundContinuationPair =
  | {
      readonly step: FreshCommittedContinuationOperationStep
      readonly transition: FreshContinuationOperationTransition
    }
  | { readonly step: FreshContinuationBeginStep; readonly transition: FreshContinuationBeginTransition }

type FreshPositionFreeContinuationPair =
  | {
      readonly step: FreshPositionFreeContinuationOperationStep
      readonly transition: FreshContinuationOperationTransition
    }
  | { readonly step: FreshContinuationObserveStep; readonly transition: FreshContinuationObserveTransition }

const issuedFreshContinuationDecisions = new WeakSet<object>()

/**
 * Checked post-entry route evidence. A fresh entry decision cannot satisfy
 * this type and therefore cannot be handed to ordinary proposal derivation.
 */
export type FreshContinuationDecision =
  | (FreshCommitmentBoundContinuationPair & {
      readonly authority: { readonly _tag: "FreshCommitmentAuthority"; readonly commitment: FreshTaskCommitment }
    })
  | (FreshPositionFreeContinuationPair & { readonly authority: { readonly _tag: "FreshPositionFreeAuthority" } })
  | (FreshCommitmentBoundContinuationPair & {
      readonly authority: {
        readonly _tag: "ReplacementAuthority"
        readonly replacement: ReplacementContinuationAuthority
      }
    })

/** Runtime guard for the private continuation authority at module boundaries. */
export const isFreshContinuationDecision = (decision: FreshDecision): decision is FreshContinuationDecision =>
  issuedFreshContinuationDecisions.has(decision)

const freshCommitmentBoundContinuationOf = (
  pair: FreshCommitmentBoundContinuationPair,
  commitment: FreshTaskCommitment
): FreshContinuationDecision => {
  const decision: FreshContinuationDecision = Object.freeze({
    ...immutableSnapshot(pair),
    authority: Object.freeze({ _tag: "FreshCommitmentAuthority", commitment })
  })
  issuedFreshContinuationDecisions.add(decision)
  return decision
}

const freshPositionFreeContinuationOf = (pair: FreshPositionFreeContinuationPair): FreshContinuationDecision => {
  const decision: FreshContinuationDecision = Object.freeze({
    ...immutableSnapshot(pair),
    authority: Object.freeze({ _tag: "FreshPositionFreeAuthority" })
  })
  issuedFreshContinuationDecisions.add(decision)
  return decision
}

const replacementBoundContinuationOf = (
  pair: FreshCommitmentBoundContinuationPair,
  replacement: ReplacementContinuationAuthority
): FreshContinuationDecision => {
  const decision: FreshContinuationDecision = Object.freeze({
    ...immutableSnapshot(pair),
    authority: Object.freeze({ _tag: "ReplacementAuthority", replacement })
  })
  issuedFreshContinuationDecisions.add(decision)
  return decision
}

const continuationAuthorityMatchesRun = (decision: FreshContinuationDecision, runId: RunId): boolean => {
  const authority = decision.authority
  if (authority._tag === "FreshPositionFreeAuthority") return false
  return authority._tag === "FreshCommitmentAuthority"
    ? authority.commitment.runId === runId
    : authority.replacement.plannedAttempt.runId === runId
}

const freshContinuationSnapshotOf = (
  step: FreshWorkflowStep,
  runId: RunId
): FreshContinuationAuthoritySnapshot | undefined =>
  step._tag === "BeginPlannedAttemptExecutorWork"
    ? Object.freeze({
        _tag: "FreshAttemptHandoffAuthority",
        claimOperationId: continuationClaimOperationId(step),
        plannedAttempt: immutableSnapshot(step.plannedAttempt),
        runId,
        step: step._tag,
        taskId: step.task.id
      })
    : step._tag === "ReadPostClaimGraph" ||
        step._tag === "ReadTaskWorkSpecification" ||
        step._tag === "RecordTaskAttemptPlan" ||
        step._tag === "ReconcileTaskWorktree"
      ? Object.freeze({
          _tag: "FreshOperationContinuationAuthority",
          claimOperationId: continuationClaimOperationId(step),
          predecessorOperationId: step.predecessorOperationId,
          runId,
          step: step._tag,
          taskId: step.task.id
        })
      : undefined

/** Mints the private proposal capability only from an already checked exact fresh continuation. */
export const authorizeFreshContinuationProposal = (
  proposal: DeliveryActionProposal,
  decision: FreshContinuationDecision,
  runId: RunId
): DeliveryActionProposal => {
  if (!isFreshContinuationDecision(decision)) return proposal
  if (decision.authority._tag === "FreshPositionFreeAuthority") return proposal
  if (!continuationAuthorityMatchesRun(decision, runId)) return proposal
  const proposalStep = proposalContinuationStep(proposal)
  if (proposalStep !== decision.step || !proposalNeedsFreshCommitment(proposal)) return proposal
  const immutableProposal = immutableSnapshot(proposal)
  const continuationSnapshot = freshContinuationSnapshotOf(decision.step, runId)
  if (continuationSnapshot === undefined) return proposal
  const authorized = Object.freeze(immutableProposal)
  issuedFreshContinuationProposals.set(authorized, { authority: decision.authority, continuationSnapshot })
  return authorized
}

/**
 * Validates the route evidence needed to continue an already-entered fresh
 * task. Entry steps are intentionally rejected: only
 * `AcceptedFreshTaskAdmission` can materialize that first proposal.
 */
const continuationClaimOperationId = (step: FreshCommitmentBoundContinuationPair["step"]): OperationId => {
  switch (step._tag) {
    case "ReadPostClaimGraph":
      return step.claimOperation.acquisition.operationId
    case "ReadTaskWorkSpecification":
    case "RecordTaskAttemptPlan":
    case "ReconcileTaskWorktree":
    case "BeginPlannedAttemptExecutorWork":
      return step.claimOperationId
  }
}

const beginContinuationDecisionOf = (
  step: FreshContinuationBeginStep,
  transition: RunnableFrontierTransition,
  commitments: ReadonlyArray<FreshTaskCommitment>
): FreshContinuationDecision | undefined => {
  if (
    transition._tag !== "BeginPlannedAttemptExecutorWork" ||
    !plannedTaskAttemptEquivalence(transition.plannedAttempt, step.plannedAttempt)
  ) {
    return undefined
  }
  const pair: FreshCommitmentBoundContinuationPair = { step, transition }
  const replacement = replacementContinuationAuthorityOf(step)
  if (replacement !== undefined && replacementContinuationAuthorityMatchesStep(replacement, step)) {
    return replacementBoundContinuationOf(pair, replacement)
  }
  const commitment = commitments.find(
    (candidate) =>
      candidate.operation.acquisition.taskId === step.task.id &&
      candidate.operation.acquisition.operationId === step.claimOperationId
  )
  return commitment === undefined ? undefined : freshCommitmentBoundContinuationOf(pair, commitment)
}

const observedContinuationDecisionOf = (
  step: FreshContinuationObserveStep,
  transition: RunnableFrontierTransition
): FreshContinuationDecision | undefined =>
  transition._tag === "ObservePlannedAttemptExecutorWork" &&
  plannedTaskAttemptEquivalence(transition.plannedAttempt, step.plannedAttempt)
    ? freshPositionFreeContinuationOf({ step, transition })
    : undefined

const operationContinuationDecisionOf = (
  step: FreshCommittedContinuationOperationStep | FreshPositionFreeContinuationOperationStep,
  transition: RunnableFrontierTransition,
  commitments: ReadonlyArray<FreshTaskCommitment>
): FreshContinuationDecision | undefined => {
  if (
    transition._tag !== "ContinueFreshWorkflowOperation" ||
    transition.taskId !== step.task.id ||
    transition.operationId !== step.predecessorOperationId
  ) {
    return undefined
  }
  if (step._tag === "ReadRejectedTaskClaim") return freshPositionFreeContinuationOf({ step, transition })
  const pair: FreshCommitmentBoundContinuationPair = { step, transition }
  const replacement = replacementContinuationAuthorityOf(step)
  if (replacement !== undefined && replacementContinuationAuthorityMatchesStep(replacement, step)) {
    return replacementBoundContinuationOf(pair, replacement)
  }
  const claimOperationId = continuationClaimOperationId(pair.step)
  const commitment = commitments.find(
    (candidate) =>
      candidate.operation.acquisition.taskId === step.task.id &&
      candidate.operation.acquisition.operationId === claimOperationId
  )
  return commitment === undefined ? undefined : freshCommitmentBoundContinuationOf(pair, commitment)
}

const isFreshContinuationOperationStep = (
  step: FreshOperationStep
): step is FreshCommittedContinuationOperationStep | FreshPositionFreeContinuationOperationStep =>
  step._tag !== "ReadCurrentTaskGraph" && step._tag !== "AcquireTaskClaim"

export const freshContinuationDecisionOf = (
  decision: FreshDecision,
  commitments: ReadonlyArray<FreshTaskCommitment>
): FreshContinuationDecision | undefined => {
  if (decision.step._tag === "BeginPlannedAttemptExecutorWork") {
    return beginContinuationDecisionOf(decision.step, decision.transition, commitments)
  }
  if (decision.step._tag === "ObservePlannedAttemptExecutorWork") {
    return observedContinuationDecisionOf(decision.step, decision.transition)
  }
  if (!isFreshContinuationOperationStep(decision.step)) return undefined
  return operationContinuationDecisionOf(decision.step, decision.transition, commitments)
}

/** A derived fresh step and frontier transition disagree and therefore cannot be authorized as either entry or continuation. */
export class FreshDecisionPartitionInvalid extends Schema.TaggedError<FreshDecisionPartitionInvalid>()(
  "FreshDecisionPartitionInvalid",
  { step: Schema.String, stepTaskId: TaskId, transition: Schema.String, transitionTaskId: TaskId }
) {}

const isFreshEntryDecision = (decision: FreshDecision): boolean =>
  (decision.step._tag === "ReadCurrentTaskGraph" &&
    decision.transition._tag === "ContinueFreshWorkflowOperation" &&
    decision.transition.taskId === decision.step.task.id) ||
  (decision.step._tag === "AcquireTaskClaim" &&
    decision.transition._tag === "CommitFreshTaskClaimIntent" &&
    decision.transition.taskId === decision.step.task.id)

/**
 * Checks a batch of fresh route evidence at the ordinary-proposal boundary.
 * Fresh entry decisions are intentionally omitted; only post-entry
 * continuations can cross this boundary.
 */
export const freshContinuationDecisionsOf = (
  decisions: ReadonlyArray<FreshDecision>,
  commitments: ReadonlyArray<FreshTaskCommitment>
): Result.Result<ReadonlyArray<FreshContinuationDecision>, FreshDecisionPartitionInvalid> => {
  const evaluated = decisions
    .filter((decision) => !isFreshEntryDecision(decision))
    .map((decision) => ({ continuation: freshContinuationDecisionOf(decision, commitments), decision }))
  const invalid = evaluated.find(({ continuation }) => continuation === undefined)
  if (invalid !== undefined) {
    return Result.fail(
      new FreshDecisionPartitionInvalid({
        step: invalid.decision.step._tag,
        stepTaskId: invalid.decision.step.task.id,
        transition: invalid.decision.transition._tag,
        transitionTaskId: runnableTransitionTaskId(invalid.decision.transition)
      })
    )
  }
  return Result.succeed(evaluated.flatMap(({ continuation }) => (continuation === undefined ? [] : [continuation])))
}

export interface DeliveryProposalsInput {
  readonly acceptedAt?: JournalPosition | null
  readonly acceptedOperationIds: ReadonlySet<OperationId>
  readonly fresh: ReadonlyArray<FreshContinuationDecision>
  readonly integrationResponsibilities?: ReadonlyArray<IntegrationResponsibility>
  readonly pendingReadOperationIds?: ReadonlySet<OperationId>
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
      plannedAttemptProtocol: { _tag: "NoPlannedAttemptProtocol" },
      taskWorkPosition: { _tag: "NoTaskWorkPosition" }
    },
    id: deliveryProposalIdOf(input.runId, route),
    order: { _tag: "TrackerGraphOrder", acceptedAt: input.acceptedAt },
    owner: "TrackerGraph",
    route,
    waitsForLiveOperationId: null
  }
}
