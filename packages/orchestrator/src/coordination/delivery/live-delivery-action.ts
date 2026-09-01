import type { AttemptId, RunId, TaskId } from "@dalph/contracts"
import type { JournalPosition } from "../../workflow-journal/identity.js"
import type { OperationId } from "../../workflow/identity.js"
import type { DeliveryActionProposal, DeliveryProposalId } from "./delivery-action-proposal.js"
import type { DeliveryProposalFrontier } from "./relations.js"
import {
  deliveryRuntimeLocalDeferralAppliesAt,
  type DeliveryRuntimeLocalDeferral
} from "./delivery-runtime-local-deferral.js"
import { makeLiveDeliveryActionKey, type LiveDeliveryActionKey } from "./live-delivery-action-key.js"

export { LiveDeliveryActionKey } from "./live-delivery-action-key.js"

const liveActionKey = makeLiveDeliveryActionKey

type RecoveredTransition = Extract<
  DeliveryActionProposal["order"],
  { readonly _tag: "RecoveredWorkflowOrder" }
>["transition"]

const attemptBoundRecoveredReadTransitions = [
  "ObservePlannedAttemptContinuationClaim",
  "ObservePlannedAttemptContinuationGraph",
  "ObservePlannedAttemptContinuationSpecification",
  "ObservePlannedAttemptContinuationTargetLineage",
  "ObservePlannedAttemptContinuationWorktree",
  "ObserveStoppedAttemptClaim"
] as const satisfies ReadonlyArray<RecoveredTransition>
type AttemptBoundRecoveredReadTransition = (typeof attemptBoundRecoveredReadTransitions)[number]

type RecoveredAction = Extract<DeliveryActionProposal["route"], { readonly _tag: "RecoveredNewActionRoute" }>["action"]
type RecoveredReadAction = Extract<
  RecoveredAction,
  {
    readonly _tag:
      | "ReadTargetLineage"
      | "ReadTaskClaim"
      | "ReadTaskWorkSpecification"
      | "ReadTaskWorktree"
      | "ReadTrackerGraph"
  }
>
type RecoveredTargetLineageReadAction = Extract<RecoveredReadAction, { readonly _tag: "ReadTargetLineage" }>

/** Stable subject of one recovered task-tracker or Git read across changes to its causal route. */
type RecoveredReadSubject =
  | {
      readonly _tag: "Attempt"
      readonly attemptId: AttemptId
      readonly runId: RunId
      readonly transition: AttemptBoundRecoveredReadTransition
    }
  | { readonly _tag: "Task"; readonly taskId: TaskId; readonly transition: "ObserveResponsibleTaskClaim" }
  | {
      readonly _tag: "Integration"
      readonly attemptId: AttemptId
      readonly purpose: "PlannedAttemptContinuationTargetLineage"
      readonly queuedAt: JournalPosition
      readonly repository: RecoveredTargetLineageReadAction["operation"]["integrationTarget"]["repository"]
      readonly ref: RecoveredTargetLineageReadAction["operation"]["integrationTarget"]["ref"]
      readonly runId: RunId
      readonly startedAt: JournalPosition
      readonly transition: "ObservePlannedAttemptContinuationTargetLineage"
    }

const attemptBoundRecoveredReadTransitionSet: ReadonlySet<RecoveredTransition> = new Set(
  attemptBoundRecoveredReadTransitions
)

const isAttemptBoundRecoveredReadTransition = (
  transition: RecoveredTransition
): transition is AttemptBoundRecoveredReadTransition => attemptBoundRecoveredReadTransitionSet.has(transition)

const isRecoveredReadAction = (action: RecoveredAction): action is RecoveredReadAction =>
  "operation" in action && action.operation._tag !== "ReleaseTaskClaim"

const integrationReadSubject = (
  proposal: DeliveryActionProposal
): Extract<RecoveredReadSubject, { readonly _tag: "Integration" }> | undefined => {
  if (proposal.order._tag !== "IntegrationOrder" || proposal.order.startedAt === null) return undefined
  const route = proposal.route
  if (route._tag !== "RecoveredNewActionRoute") return undefined
  const action = route.action
  if (action._tag !== "ReadTargetLineage") return undefined
  return {
    _tag: "Integration",
    attemptId: action.plannedAttempt.attemptId,
    purpose: "PlannedAttemptContinuationTargetLineage",
    queuedAt: proposal.order.queuedAt,
    repository: action.operation.integrationTarget.repository,
    ref: action.operation.integrationTarget.ref,
    runId: action.plannedAttempt.runId,
    startedAt: proposal.order.startedAt,
    transition: "ObservePlannedAttemptContinuationTargetLineage"
  }
}

const recoveredWorkflowReadSubject = (proposal: DeliveryActionProposal): RecoveredReadSubject | undefined => {
  const route = proposal.route
  if (route._tag !== "RecoveredNewActionRoute") return undefined
  const action = route.action
  if (!isRecoveredReadAction(action)) return undefined
  if (proposal.order._tag !== "RecoveredWorkflowOrder") return undefined
  if (action.plannedAttempt !== null && isAttemptBoundRecoveredReadTransition(proposal.order.transition)) {
    return {
      _tag: "Attempt",
      attemptId: action.plannedAttempt.attemptId,
      runId: action.plannedAttempt.runId,
      transition: proposal.order.transition
    }
  }
  return action._tag === "ReadTaskClaim" && proposal.order.transition === "ObserveResponsibleTaskClaim"
    ? { _tag: "Task", taskId: action.taskId, transition: proposal.order.transition }
    : undefined
}

const recoveredReadSubject = (proposal: DeliveryActionProposal): RecoveredReadSubject | undefined =>
  integrationReadSubject(proposal) ?? recoveredWorkflowReadSubject(proposal)

export const liveActionKeyOf = (proposal: DeliveryActionProposal): LiveDeliveryActionKey => {
  if (proposal.route._tag === "FreshExecutorWorkflowRoute") {
    return liveActionKey([
      "FreshExecutor",
      proposal.route.step._tag,
      proposal.route.step.plannedAttempt.runId,
      proposal.route.step.plannedAttempt.attemptId
    ])
  }
  // Accepting another task's graph read can replace this read's causal
  // predecessor before its tracker call returns. The task is the stable
  // process-local subject; the predecessor is chronology, not a second call.
  if (proposal.route._tag === "FreshWorkflowRoute" && proposal.route.step._tag === "ReadCurrentTaskGraph") {
    return liveActionKey(["FreshCurrentTaskGraphRead", proposal.route.step.task.id])
  }
  const subject = recoveredReadSubject(proposal)
  return subject === undefined
    ? liveActionKey(["DeliveryProposal", proposal.id])
    : subject._tag === "Attempt"
      ? liveActionKey(["RecoveredRead", subject.transition, subject._tag, subject.runId, subject.attemptId])
      : subject._tag === "Task"
        ? liveActionKey(["RecoveredRead", subject.transition, subject._tag, subject.taskId])
        : liveActionKey([
            "RecoveredRead",
            subject.transition,
            subject._tag,
            subject.purpose,
            subject.runId,
            subject.attemptId,
            subject.repository,
            subject.ref,
            subject.queuedAt,
            subject.startedAt
          ])
}

export const proposalIsAvailable = (
  proposal: DeliveryActionProposal,
  live: ReadonlyMap<DeliveryProposalId, unknown>,
  liveActionKeys: ReadonlySet<LiveDeliveryActionKey>,
  liveOperationIds: ReadonlySet<OperationId>,
  deferred: ReadonlyMap<DeliveryProposalId, DeliveryRuntimeLocalDeferral>,
  acceptedAt: JournalPosition | null
): boolean => {
  const localDeferral = deferred.get(proposal.id)
  return (
    !live.has(proposal.id) &&
    !liveActionKeys.has(liveActionKeyOf(proposal)) &&
    (localDeferral === undefined || !deliveryRuntimeLocalDeferralAppliesAt(localDeferral, acceptedAt)) &&
    (proposal.waitsForLiveOperationId === null || !liveOperationIds.has(proposal.waitsForLiveOperationId))
  )
}

/** A proposal remains current only while its exact identity is present in the relation frontier. */
export const proposalIsPresent = (frontier: DeliveryProposalFrontier, proposalId: DeliveryProposalId): boolean =>
  frontier._tag === "DeliveryProposalsAvailable"
    ? frontier.proposals.some(({ id }) => id === proposalId)
    : frontier.conflicts.some(({ id }) => id === proposalId)

/** Current exact proposals covered by one already-installed process-local action owner. */
export const proposalsForLiveAction = (
  frontier: DeliveryProposalFrontier,
  proposal: DeliveryActionProposal
): ReadonlyArray<DeliveryActionProposal> =>
  frontier._tag === "DeliveryProposalsAvailable"
    ? frontier.proposals.filter((candidate) => liveActionKeyOf(candidate) === liveActionKeyOf(proposal))
    : []

/** A causally refreshed proposal still names the same process-local boundary action. */
export const liveActionIsPresent = (frontier: DeliveryProposalFrontier, proposal: DeliveryActionProposal): boolean =>
  frontier._tag === "DeliveryProposalsAvailable"
    ? proposalsForLiveAction(frontier, proposal).length > 0
    : frontier.conflicts.some(({ id }) => id === proposal.id)
