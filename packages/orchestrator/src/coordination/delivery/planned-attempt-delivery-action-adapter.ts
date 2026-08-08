import { plannedAttemptExecutorCorrelation } from "@dalph/contracts"
import { Effect } from "effect"
import {
  continuePlannedAttemptExecutorWork,
  observePlannedAttemptExecutorState,
  requestPlannedAttemptExecutorSuspension
} from "../../workflow/protocols/planned-attempt-executor-work/protocol.js"
import {
  advanceAttemptStoppage,
  recordStoppedAttemptClaimNoRelease
} from "../../workflow/protocols/attempt-choice/stop.js"
import { deliveryActionCompleted } from "./delivery-action-adapter-common.js"
import type { DeliveryActionExecutionLease, MaterializedDeliveryAction } from "./delivery-action-executor.js"
import type { IdentityFreeWorkflowRoute, IdentityFreeWorkflowTransition } from "./delivery-action-proposal.js"

type IdentityFreeAction = Extract<MaterializedDeliveryAction, { readonly _tag: "IdentityFreeAction" }>
type PlannedAttemptTransition = Extract<
  IdentityFreeWorkflowTransition,
  {
    readonly _tag:
      | "ContinuePlannedAttemptExecutorWork"
      | "AdvanceAttemptStoppage"
      | "ObservePlannedAttemptContinuationExecutor"
      | "RecordStoppedAttemptClaimNoRelease"
      | "SuspendPlannedAttemptExecutorWork"
  }
>

export const executeFreshPlannedAttempt = Effect.fn("DeliveryAction.executeFreshPlannedAttempt")(function* (
  action: IdentityFreeAction,
  route: Extract<IdentityFreeWorkflowRoute, { readonly _tag: "FreshExecutorWorkflowRoute" }>,
  lease: DeliveryActionExecutionLease
) {
  const plannedAttempt = route.step.plannedAttempt
  const correlation = plannedAttemptExecutorCorrelation(plannedAttempt)
  yield* lease.bindPlannedAttemptPosition(correlation)
  const report = yield* continuePlannedAttemptExecutorWork(plannedAttempt)
  if (report._tag === "SafelySuspended" || report._tag === "Terminal") {
    yield* lease.releasePlannedAttemptPosition(correlation)
  }
  return { _tag: "ExecutorReportPublished" as const, plannedAttempt, proposalId: action.proposal.id, report }
})

export const executePlannedAttemptTransition = Effect.fn("DeliveryAction.executePlannedAttemptTransition")(function* (
  action: IdentityFreeAction,
  transition: PlannedAttemptTransition,
  lease: DeliveryActionExecutionLease
) {
  if (transition._tag === "AdvanceAttemptStoppage") {
    const result = yield* advanceAttemptStoppage(transition.requestId, transition.subject)
    if (transition.taskWorkPosition === "Existing" && result._tag === "AttemptImplementationAbandoned") {
      yield* lease.releasePlannedAttemptPosition(plannedAttemptExecutorCorrelation(transition.subject.plannedAttempt))
    }
    return deliveryActionCompleted(action.proposal.id)
  }
  if (transition._tag === "RecordStoppedAttemptClaimNoRelease") {
    yield* recordStoppedAttemptClaimNoRelease(
      transition.requestId,
      transition.subject,
      transition.observationOperationId,
      transition.observation
    )
    return deliveryActionCompleted(action.proposal.id)
  }
  const correlation = plannedAttemptExecutorCorrelation(transition.plannedAttempt)
  if (transition._tag === "ContinuePlannedAttemptExecutorWork") {
    yield* lease.bindPlannedAttemptPosition(correlation)
  }
  const report = yield* transition._tag === "ContinuePlannedAttemptExecutorWork"
    ? continuePlannedAttemptExecutorWork(transition.plannedAttempt)
    : transition._tag === "ObservePlannedAttemptContinuationExecutor"
      ? observePlannedAttemptExecutorState(transition.plannedAttempt)
      : requestPlannedAttemptExecutorSuspension(transition.plannedAttempt)
  if (
    transition._tag !== "ObservePlannedAttemptContinuationExecutor" &&
    (report._tag === "SafelySuspended" || report._tag === "Terminal")
  ) {
    yield* lease.releasePlannedAttemptPosition(correlation)
  }
  return {
    _tag: "ExecutorReportPublished" as const,
    plannedAttempt: transition.plannedAttempt,
    proposalId: action.proposal.id,
    report
  }
})
