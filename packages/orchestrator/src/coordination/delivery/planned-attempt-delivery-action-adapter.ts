import { plannedAttemptExecutorCorrelation } from "@dalph/contracts"
import { Effect } from "effect"
import { reconcileOrObservePlannedAttemptExecutorStateWithPermit } from "../../workflow/protocols/planned-attempt-executor-work/protocol.js"
import {
  continuePlannedAttemptExecutorWorkWithPermit,
  requestPlannedAttemptExecutorSuspensionWithPermit
} from "../../workflow/protocols/planned-attempt-executor-work/suspension-commands.js"
import { authorizePlannedAttemptContinuation } from "../../workflow/protocols/planned-attempt-continuation/protocol.js"
import {
  advanceAttemptStoppageWithPermit,
  observeAttemptStoppageExecutorWithPermit,
  recordStoppedAttemptClaimNoRelease
} from "../../workflow/protocols/attempt-choice/stop.js"
import { advanceAttemptRestartWithPermit } from "../../workflow/protocols/attempt-choice/restart.js"
import { deliveryActionCompleted, deliveryActionDeferred } from "./delivery-action-adapter-common.js"
import type { DeliveryActionExecutionLease, MaterializedDeliveryAction } from "./delivery-action-executor.js"
import type { IdentityFreeWorkflowRoute, IdentityFreeWorkflowTransition } from "./delivery-action-proposal.js"

type IdentityFreeAction = Extract<MaterializedDeliveryAction, { readonly _tag: "IdentityFreeAction" }>
type PlannedAttemptTransition = Extract<
  IdentityFreeWorkflowTransition,
  {
    readonly _tag:
      | "ContinuePlannedAttemptExecutorWork"
      | "AdvanceAttemptRestart"
      | "ContinuePlannedAttemptExecutorWorkAfterCurrentFacts"
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

type AttemptRestartTransition = Extract<PlannedAttemptTransition, { readonly _tag: "AdvanceAttemptRestart" }>
type NonRestartPlannedAttemptTransition = Exclude<PlannedAttemptTransition, AttemptRestartTransition>

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
  NonRestartPlannedAttemptTransition,
  | AttemptStoppageTransition
  | Extract<NonRestartPlannedAttemptTransition, { readonly _tag: "RecordStoppedAttemptClaimNoRelease" }>
>

export const executeAttemptRestartTransition = Effect.fn("DeliveryAction.executeAttemptRestartTransition")(function* (
  action: IdentityFreeAction,
  transition: AttemptRestartTransition,
  lease: DeliveryActionExecutionLease
) {
  yield* lease.withPlannedAttemptProtocol(plannedAttemptExecutorCorrelation(transition.plannedAttempt), (permit) =>
    advanceAttemptRestartWithPermit(permit, transition.requestId, transition.subject, transition.integrationTarget)
  )
  return deliveryActionCompleted(action.proposal.id)
})

const executorReportFor = (
  transition: ExecutorTransition,
  correlation: ReturnType<typeof plannedAttemptExecutorCorrelation>,
  lease: DeliveryActionExecutionLease
) =>
  transition._tag === "ContinuePlannedAttemptExecutorWorkAfterCurrentFacts"
    ? lease.withPlannedAttemptProtocol(correlation, (permit) =>
        authorizePlannedAttemptContinuation(transition.plannedAttempt, transition.witness).pipe(
          Effect.andThen(continuePlannedAttemptExecutorWorkWithPermit(permit, transition.plannedAttempt))
        )
      )
    : transition._tag === "ContinuePlannedAttemptExecutorWork"
      ? lease.withPlannedAttemptProtocol(correlation, (permit) =>
          continuePlannedAttemptExecutorWorkWithPermit(permit, transition.plannedAttempt)
        )
      : transition._tag === "ObservePlannedAttemptContinuationExecutor"
        ? lease.withPlannedAttemptProtocol(correlation, (permit) =>
            reconcileOrObservePlannedAttemptExecutorStateWithPermit(permit, transition.plannedAttempt)
          )
        : lease.withPlannedAttemptProtocol(correlation, (permit) =>
            requestPlannedAttemptExecutorSuspensionWithPermit(permit, transition.plannedAttempt)
          )

const executeExecutorTransition = Effect.fn("DeliveryAction.executeExecutorTransition")(function* (
  transition: ExecutorTransition,
  lease: DeliveryActionExecutionLease
) {
  const correlation = plannedAttemptExecutorCorrelation(transition.plannedAttempt)
  if (
    transition._tag === "ContinuePlannedAttemptExecutorWork" ||
    transition._tag === "ContinuePlannedAttemptExecutorWorkAfterCurrentFacts"
  ) {
    yield* lease.bindPlannedAttemptPosition(correlation)
  }
  const report = yield* executorReportFor(transition, correlation, lease)
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
    continuePlannedAttemptExecutorWorkWithPermit(permit, plannedAttempt, undefined, route.step.specification)
  )
  if (report._tag === "SafelySuspended" || report._tag === "Terminal") {
    yield* lease.releasePlannedAttemptPosition(correlation)
  }
  return { _tag: "ExecutorReportPublished" as const, plannedAttempt, proposalId: action.proposal.id, report }
})

export const executePlannedAttemptTransition = Effect.fn("DeliveryAction.executePlannedAttemptTransition")(function* (
  action: IdentityFreeAction,
  transition: NonRestartPlannedAttemptTransition,
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
  const report = yield* executeExecutorTransition(transition, lease).pipe(
    Effect.map((report) => ({ _tag: "ExecutorReport" as const, report })),
    Effect.catchTag("PlannedAttemptContinuationAuthorizationRejected", (rejection) =>
      rejection.reason === "StaleWitness"
        ? Effect.succeed({ _tag: "ContinuationAuthorizationStale" as const })
        : Effect.fail(rejection)
    )
  )
  if (report._tag === "ContinuationAuthorizationStale") {
    return deliveryActionDeferred(action.proposal.id, "ContinuationAuthorizationStale")
  }
  return {
    _tag: "ExecutorReportPublished" as const,
    plannedAttempt: transition.plannedAttempt,
    proposalId: action.proposal.id,
    report: report.report
  }
})
