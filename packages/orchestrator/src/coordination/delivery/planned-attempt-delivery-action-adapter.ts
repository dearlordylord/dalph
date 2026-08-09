import { plannedAttemptExecutorCorrelation } from "@dalph/contracts"
import { Effect } from "effect"
import {
  continuePlannedAttemptExecutorWorkWithPermit,
  observePlannedAttemptExecutorStateWithPermit,
  requestPlannedAttemptExecutorSuspensionWithPermit
} from "../../workflow/protocols/planned-attempt-executor-work/protocol.js"
import {
  advanceAttemptStoppageWithPermit,
  observeAttemptStoppageExecutorWithPermit,
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
      | "ObserveAttemptStoppageExecutor"
      | "ObservePlannedAttemptContinuationExecutor"
      | "RecordStoppedAttemptClaimNoRelease"
      | "SuspendPlannedAttemptExecutorWork"
  }
>

type AttemptStoppageTransition = Extract<
  PlannedAttemptTransition,
  { readonly _tag: "AdvanceAttemptStoppage" | "ObserveAttemptStoppageExecutor" }
>

const executeAttemptStoppageTransition = Effect.fn("DeliveryAction.executeAttemptStoppageTransition")(function* (
  transition: AttemptStoppageTransition,
  lease: DeliveryActionExecutionLease
) {
  const correlation = plannedAttemptExecutorCorrelation(transition.subject.plannedAttempt)
  const result = yield* transition._tag === "AdvanceAttemptStoppage"
    ? lease.withPlannedAttemptProtocol(correlation, (permit) =>
        advanceAttemptStoppageWithPermit(permit, transition.requestId, transition.subject)
      )
    : lease.withPlannedAttemptProtocol(correlation, (permit) =>
        observeAttemptStoppageExecutorWithPermit(permit, transition.requestId, transition.subject)
      )
  const taskWorkPositionWasRequired =
    transition._tag === "ObserveAttemptStoppageExecutor" || transition.taskWorkPosition === "ReserveOrReuse"
  if (taskWorkPositionWasRequired && result._tag === "AttemptImplementationAbandoned") {
    yield* lease.releasePlannedAttemptPosition(plannedAttemptExecutorCorrelation(transition.subject.plannedAttempt))
  }
})

type ExecutorTransition = Exclude<
  PlannedAttemptTransition,
  AttemptStoppageTransition | Extract<PlannedAttemptTransition, { readonly _tag: "RecordStoppedAttemptClaimNoRelease" }>
>

const executeExecutorTransition = Effect.fn("DeliveryAction.executeExecutorTransition")(function* (
  transition: ExecutorTransition,
  lease: DeliveryActionExecutionLease
) {
  const correlation = plannedAttemptExecutorCorrelation(transition.plannedAttempt)
  if (transition._tag === "ContinuePlannedAttemptExecutorWork") {
    yield* lease.bindPlannedAttemptPosition(correlation)
  }
  const report = yield* transition._tag === "ContinuePlannedAttemptExecutorWork"
    ? lease.withPlannedAttemptProtocol(correlation, (permit) =>
        continuePlannedAttemptExecutorWorkWithPermit(permit, transition.plannedAttempt)
      )
    : transition._tag === "ObservePlannedAttemptContinuationExecutor"
      ? lease.withPlannedAttemptProtocol(correlation, (permit) =>
          observePlannedAttemptExecutorStateWithPermit(permit, transition.plannedAttempt)
        )
      : lease.withPlannedAttemptProtocol(correlation, (permit) =>
          requestPlannedAttemptExecutorSuspensionWithPermit(permit, transition.plannedAttempt)
        )
  if (
    transition._tag !== "ObservePlannedAttemptContinuationExecutor" &&
    (report._tag === "SafelySuspended" || report._tag === "Terminal")
  ) {
    yield* lease.releasePlannedAttemptPosition(correlation)
  }
  return report
})

export const executeFreshPlannedAttempt = Effect.fn("DeliveryAction.executeFreshPlannedAttempt")(function* (
  action: IdentityFreeAction,
  route: Extract<IdentityFreeWorkflowRoute, { readonly _tag: "FreshExecutorWorkflowRoute" }>,
  lease: DeliveryActionExecutionLease
) {
  const plannedAttempt = route.step.plannedAttempt
  const correlation = plannedAttemptExecutorCorrelation(plannedAttempt)
  yield* lease.bindPlannedAttemptPosition(correlation)
  const report = yield* lease.withPlannedAttemptProtocol(correlation, (permit) =>
    continuePlannedAttemptExecutorWorkWithPermit(permit, plannedAttempt)
  )
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
  if (transition._tag === "AdvanceAttemptStoppage" || transition._tag === "ObserveAttemptStoppageExecutor") {
    yield* executeAttemptStoppageTransition(transition, lease)
    return deliveryActionCompleted(action.proposal.id)
  }
  if (transition._tag === "RecordStoppedAttemptClaimNoRelease") {
    yield* recordStoppedAttemptClaimNoRelease(
      transition.requestId,
      transition.subject,
      transition.observationOperationId
    )
    return deliveryActionCompleted(action.proposal.id)
  }
  const report = yield* executeExecutorTransition(transition, lease)
  return {
    _tag: "ExecutorReportPublished" as const,
    plannedAttempt: transition.plannedAttempt,
    proposalId: action.proposal.id,
    report
  }
})
