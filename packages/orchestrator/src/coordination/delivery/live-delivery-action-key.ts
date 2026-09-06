import type { AttemptId, RunId, TaskId } from "@dalph/contracts"
import { Schema } from "effect"
import type { JournalPosition } from "../../workflow-journal/identity.js"
import type { DeliveryActionProposal } from "./delivery-action-proposal.js"

/**
 * Process-local identity of an action that must not overlap itself. A recovered
 * observation keeps this identity when a newer causal predecessor changes its
 * proposal identity while the earlier boundary call or passive attachment is
 * still owned by this activation.
 */
export const LiveDeliveryActionKey = Schema.NonEmptyString.pipe(Schema.brand("LiveDeliveryActionKey"))
export type LiveDeliveryActionKey = typeof LiveDeliveryActionKey.Type

const makeLiveDeliveryActionKey = (parts: ReadonlyArray<string | number>): LiveDeliveryActionKey =>
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

/** Derives the only stable process-local identity valid for this exact proposal. */
export const liveActionKeyOf = (proposal: DeliveryActionProposal): LiveDeliveryActionKey => {
  if (proposal.route._tag === "FreshExecutorWorkflowRoute") {
    return makeLiveDeliveryActionKey([
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
    return makeLiveDeliveryActionKey(["FreshCurrentTaskGraphRead", proposal.route.step.task.id])
  }
  const subject = recoveredReadSubject(proposal)
  return subject === undefined
    ? makeLiveDeliveryActionKey(["DeliveryProposal", proposal.id])
    : subject._tag === "Attempt"
      ? makeLiveDeliveryActionKey(["RecoveredRead", subject.transition, subject._tag, subject.runId, subject.attemptId])
      : subject._tag === "Task"
        ? makeLiveDeliveryActionKey(["RecoveredRead", subject.transition, subject._tag, subject.taskId])
        : makeLiveDeliveryActionKey([
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
