import type { AttemptId, RunId, TaskId } from "@dalph/contracts"
import { Schema } from "effect"
import type { JournalPosition } from "../../workflow-journal/identity.js"
import type { OperationId } from "../../workflow/identity.js"
import type { DeliveryActionProposal, DeliveryProposalId } from "./delivery-action-proposal.js"
import type { DeliveryProposalFrontier } from "./relations.js"

/**
 * Process-local identity of an action that must not overlap itself. A recovered
 * observation keeps this identity when a newer causal predecessor changes its
 * proposal identity while the earlier boundary call is still owned.
 */
export const LiveDeliveryActionKey = Schema.NonEmptyString.pipe(Schema.brand("LiveDeliveryActionKey"))
export type LiveDeliveryActionKey = typeof LiveDeliveryActionKey.Type

const liveActionKey = (parts: ReadonlyArray<string>): LiveDeliveryActionKey =>
  LiveDeliveryActionKey.make(JSON.stringify(parts))

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

/** Stable subject of one recovered task-tracker read across changes to its causal route. */
type RecoveredReadSubject =
  | {
      readonly _tag: "Attempt"
      readonly attemptId: AttemptId
      readonly runId: RunId
      readonly transition: AttemptBoundRecoveredReadTransition
    }
  | { readonly _tag: "Task"; readonly taskId: TaskId; readonly transition: "ObserveResponsibleTaskClaim" }

const attemptBoundRecoveredReadTransitionSet: ReadonlySet<RecoveredTransition> = new Set(
  attemptBoundRecoveredReadTransitions
)

const isAttemptBoundRecoveredReadTransition = (
  transition: RecoveredTransition
): transition is AttemptBoundRecoveredReadTransition => attemptBoundRecoveredReadTransitionSet.has(transition)

const isRecoveredReadAction = (action: RecoveredAction): action is RecoveredReadAction =>
  "operation" in action && action.operation._tag !== "ReleaseTaskClaim"

const recoveredReadSubject = (proposal: DeliveryActionProposal): RecoveredReadSubject | undefined => {
  const route = proposal.route
  if (route._tag !== "RecoveredNewActionRoute" || proposal.order._tag !== "RecoveredWorkflowOrder") return undefined
  const action = route.action
  if (!isRecoveredReadAction(action)) return undefined
  if (action.plannedAttempt !== null && isAttemptBoundRecoveredReadTransition(proposal.order.transition)) {
    return {
      _tag: "Attempt",
      attemptId: action.plannedAttempt.attemptId,
      runId: action.plannedAttempt.runId,
      transition: proposal.order.transition
    }
  }
  /* v8 ignore start -- the closed observation derivation pairs the sole uncorrelated read with this exact transition. */
  return action._tag === "ReadTaskClaim" && proposal.order.transition === "ObserveResponsibleTaskClaim"
    ? { _tag: "Task", taskId: action.taskId, transition: proposal.order.transition }
    : undefined
  /* v8 ignore stop */
}

export const liveActionKeyOf = (proposal: DeliveryActionProposal): LiveDeliveryActionKey => {
  const subject = recoveredReadSubject(proposal)
  return subject === undefined
    ? liveActionKey(["DeliveryProposal", proposal.id])
    : subject._tag === "Attempt"
      ? liveActionKey(["RecoveredRead", subject.transition, subject._tag, subject.runId, subject.attemptId])
      : liveActionKey(["RecoveredRead", subject.transition, subject._tag, subject.taskId])
}

export const proposalIsAvailable = (
  proposal: DeliveryActionProposal,
  live: ReadonlyMap<DeliveryProposalId, unknown>,
  liveActionKeys: ReadonlySet<LiveDeliveryActionKey>,
  liveOperationIds: ReadonlySet<OperationId>,
  deferred: ReadonlyMap<DeliveryProposalId, JournalPosition | null>,
  acceptedAt: JournalPosition | null
): boolean =>
  !live.has(proposal.id) &&
  !liveActionKeys.has(liveActionKeyOf(proposal)) &&
  deferred.get(proposal.id) !== acceptedAt &&
  (proposal.waitsForLiveOperationId === null || !liveOperationIds.has(proposal.waitsForLiveOperationId))

/** A settled semantic owner remains until the ordinary relation no longer proposes the same live action. */
export const liveActionIsPresent = (frontier: DeliveryProposalFrontier, proposal: DeliveryActionProposal): boolean => {
  if (frontier._tag === "DeliveryProposalOwnershipConflict") {
    return frontier.conflicts.some(({ id }) => id === proposal.id)
  }
  const key = liveActionKeyOf(proposal)
  return frontier.proposals.some((candidate) => liveActionKeyOf(candidate) === key)
}
