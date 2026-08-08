import type { RunId } from "@dalph/contracts"
import { Effect, Layer } from "effect"
import type { TrackerTarget } from "../../authorities/task-tracker/target.js"
import { deliveryActionCompleted, executeFreshTrackerGraphRead } from "./delivery-action-adapter-common.js"
import type { DeliveryActionAdapterEnvironment } from "./delivery-action-adapter-environment.js"
import { DeliveryAcceptedFactPublication } from "./delivery-accepted-fact-publication.js"
import {
  DeliveryActionExecutor,
  type DeliveryActionExecutionError,
  type DeliveryActionExecutionLease,
  type DeliveryActionResult,
  type MaterializedDeliveryAction
} from "./delivery-action-executor.js"
import { executeFreshAttemptPlanning, executeFreshWorkflowOperation } from "./fresh-delivery-action-adapter.js"
import { executeIntegrationAction } from "./integration-delivery-action-adapter.js"
import {
  executeFreshPlannedAttempt,
  executePlannedAttemptTransition
} from "./planned-attempt-delivery-action-adapter.js"
import { executeAcceptedWorkflowAction, executeNewRecoveredAction } from "./recovered-delivery-action-adapter.js"

type AcceptedOperationAction = Extract<MaterializedDeliveryAction, { readonly _tag: "AcceptedOperationAction" }>
type FreshOperationAction = Extract<MaterializedDeliveryAction, { readonly _tag: "FreshOperationAction" }>
type IdentityFreeAction = Extract<MaterializedDeliveryAction, { readonly _tag: "IdentityFreeAction" }>

const executeAcceptedAction = Effect.fn("DeliveryAction.executeAccepted")(function* (
  action: AcceptedOperationAction,
  runId: RunId
) {
  yield* executeAcceptedWorkflowAction(runId, action.proposal.route.transition)
  return deliveryActionCompleted(action.proposal.id)
})

const executeIdentityFreeAction = Effect.fn("DeliveryAction.executeIdentityFree")(function* (
  action: IdentityFreeAction,
  lease: DeliveryActionExecutionLease
) {
  const route = action.proposal.route
  if (route._tag === "FreshExecutorWorkflowRoute") return yield* executeFreshPlannedAttempt(action, route, lease)
  const transition = route.transition
  if (
    transition._tag === "AdvanceAttemptStoppage" ||
    transition._tag === "ContinuePlannedAttemptExecutorWork" ||
    transition._tag === "ObservePlannedAttemptContinuationExecutor" ||
    transition._tag === "RecordStoppedAttemptClaimNoRelease" ||
    transition._tag === "SuspendPlannedAttemptExecutorWork"
  ) {
    return yield* executePlannedAttemptTransition(action, transition, lease)
  }
  return yield* executeIntegrationAction(action, transition, lease)
})

const executeFreshOperationAction = Effect.fn("DeliveryAction.executeFreshOperation")(function* (
  action: FreshOperationAction,
  lease: DeliveryActionExecutionLease,
  runId: RunId,
  target: TrackerTarget
) {
  const route = action.proposal.route
  switch (route._tag) {
    case "FreshWorkflowRoute":
      return yield* executeFreshWorkflowOperation(action, route, lease, target)
    case "RecoveredNewActionRoute":
      yield* executeNewRecoveredAction(route.action, action.operationId, lease, runId)
      return deliveryActionCompleted(action.proposal.id)
    case "TrackerGraphReadRoute":
      return yield* executeFreshTrackerGraphRead(action, route)
  }
})

/** Exhaustively routes one materialized proposal; protocol work belongs to typed leaf adapters. */
const executeLiveAction = Effect.fn("DeliveryAction.executeLive")(function* (
  action: MaterializedDeliveryAction,
  lease: DeliveryActionExecutionLease,
  runId: RunId,
  target: TrackerTarget
): Effect.fn.Return<DeliveryActionResult, DeliveryActionExecutionError, DeliveryActionAdapterEnvironment> {
  switch (action._tag) {
    case "AcceptedOperationAction":
      return yield* executeAcceptedAction(action, runId)
    case "IdentityFreeAction":
      return yield* executeIdentityFreeAction(action, lease)
    case "FreshAttemptAction":
      return yield* executeFreshAttemptPlanning(action)
    case "FreshOperationAction":
      return yield* executeFreshOperationAction(action, lease, runId, target)
  }
})

/** Builds the closed live adapter over existing typed protocols; it owns no scheduling decision. */
export const makeLiveDeliveryActionExecutor = Effect.fn("DeliveryActionExecutor.makeLive")(function* (
  runId: RunId,
  target: TrackerTarget
) {
  const dependencies = yield* Effect.context<DeliveryActionAdapterEnvironment>()
  const acceptedFactPublication = yield* DeliveryAcceptedFactPublication
  return DeliveryActionExecutor.of({
    execute: (action, lease) =>
      executeLiveAction(action, lease, runId, target).pipe(
        Effect.provide(dependencies),
        Effect.tap(() => acceptedFactPublication.awaitCurrent)
      )
  })
})

export const liveDeliveryActionExecutorLayer = (runId: RunId, target: TrackerTarget) =>
  Layer.effect(DeliveryActionExecutor, makeLiveDeliveryActionExecutor(runId, target))
