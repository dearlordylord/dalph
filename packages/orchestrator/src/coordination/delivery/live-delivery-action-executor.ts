import type { RunId } from "@dalph/contracts"
import { Effect, Layer, Match } from "effect"
import type { TrackerTarget } from "../../authorities/task-tracker/target.js"
import { deliveryActionCompleted, executeFreshTrackerGraphRead } from "./delivery-action-adapter-common.js"
import {
  optionalEvidenceStoreOf,
  provideOptionalEvidenceStore,
  type DeliveryActionAdapterEnvironment
} from "./delivery-action-adapter-environment.js"
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
  executeAttemptRestartTransition,
  executeFreshPlannedAttempt,
  executePlannedAttemptTransition
} from "./planned-attempt-delivery-action-adapter.js"
import { executeAcceptedWorkflowAction, executeNewRecoveredAction } from "./recovered-delivery-action-adapter.js"

type AcceptedOperationAction = Extract<MaterializedDeliveryAction, { readonly _tag: "AcceptedOperationAction" }>
type FreshOperationAction = Extract<MaterializedDeliveryAction, { readonly _tag: "FreshOperationAction" }>
type IdentityFreeAction = Extract<MaterializedDeliveryAction, { readonly _tag: "IdentityFreeAction" }>
type IdentityFreeTransition = Extract<
  IdentityFreeAction["proposal"]["route"],
  { readonly _tag: "IdentityFreeWorkflowRoute" }
>["transition"]

const plannedAttemptTransitionTags: ReadonlySet<IdentityFreeTransition["_tag"]> = new Set([
  "AdvanceAttemptStoppage",
  "RelinquishCancelledAttemptImplementation",
  "ContinuePlannedAttemptExecutorWork",
  "ContinuePlannedAttemptExecutorWorkAfterCurrentFacts",
  "ObservePlannedAttemptContinuationExecutor",
  "ObserveAttemptStoppageExecutor",
  "RecordStoppedAttemptClaimNoRelease",
  "RecordCancelledAttemptClaimNoRelease",
  "SuspendPlannedAttemptExecutorWork"
])

const isPlannedAttemptTransition = (
  transition: IdentityFreeTransition
): transition is Parameters<typeof executePlannedAttemptTransition>[1] =>
  plannedAttemptTransitionTags.has(transition._tag)

const executeAcceptedAction = Effect.fn("DeliveryAction.executeAccepted")(function* (
  action: AcceptedOperationAction,
  runId: RunId,
  lease: DeliveryActionExecutionLease
) {
  yield* executeAcceptedWorkflowAction(runId, action.proposal.route.transition, lease)
  return deliveryActionCompleted(action.proposal.id)
})

const executeIdentityFreeTransitionAction = Effect.fn("DeliveryAction.executeIdentityFreeTransition")(function* (
  action: IdentityFreeAction,
  transition: IdentityFreeTransition,
  lease: DeliveryActionExecutionLease,
  target: TrackerTarget
) {
  if (transition._tag === "AdvanceAttemptRestart") {
    return yield* executeAttemptRestartTransition(action, transition, lease)
  }
  if (isPlannedAttemptTransition(transition)) {
    return yield* executePlannedAttemptTransition(action, transition, lease)
  }
  return yield* executeIntegrationAction(action, transition, lease, target)
})

const executeIdentityFreeAction = Effect.fn("DeliveryAction.executeIdentityFree")(function* (
  action: IdentityFreeAction,
  lease: DeliveryActionExecutionLease,
  target: TrackerTarget
) {
  const route = action.proposal.route
  if (route._tag === "FreshExecutorWorkflowRoute") return yield* executeFreshPlannedAttempt(action, route, lease)
  return yield* executeIdentityFreeTransitionAction(action, route.transition, lease, target)
})

const executeFreshOperationAction = Effect.fn("DeliveryAction.executeFreshOperation")(function* (
  action: FreshOperationAction,
  lease: DeliveryActionExecutionLease,
  runId: RunId,
  target: TrackerTarget
) {
  const route = action.proposal.route
  return yield* Match.valueTags(route, {
    FreshWorkflowRoute: (route) => executeFreshWorkflowOperation(action, route, lease, target),
    RecoveredNewActionRoute: (route) =>
      executeNewRecoveredAction(route.action, action.operationId, lease, runId).pipe(
        Effect.as(deliveryActionCompleted(action.proposal.id))
      ),
    TrackerGraphReadRoute: (route) => executeFreshTrackerGraphRead(action, route, lease)
  })
})

/** Exhaustively routes one materialized proposal; protocol work belongs to typed leaf adapters. */
const executeLiveAction = Effect.fn("DeliveryAction.executeLive")(function* (
  action: MaterializedDeliveryAction,
  lease: DeliveryActionExecutionLease,
  runId: RunId,
  target: TrackerTarget
): Effect.fn.Return<DeliveryActionResult, DeliveryActionExecutionError, DeliveryActionAdapterEnvironment> {
  return yield* Match.valueTags(action, {
    AcceptedOperationAction: (action) => executeAcceptedAction(action, runId, lease),
    IdentityFreeAction: (action) => executeIdentityFreeAction(action, lease, target),
    FreshAttemptAction: executeFreshAttemptPlanning,
    FreshOperationAction: (action) => executeFreshOperationAction(action, lease, runId, target)
  })
})

/** Builds the closed live adapter over existing typed protocols; it owns no scheduling decision. */
export const makeLiveDeliveryActionExecutor = Effect.fn("DeliveryActionExecutor.makeLive")(function* (
  runId: RunId,
  target: TrackerTarget
) {
  const dependencies = yield* Effect.context<DeliveryActionAdapterEnvironment>()
  const evidenceStore = optionalEvidenceStoreOf(yield* Effect.context<never>())
  const acceptedFactPublication = yield* DeliveryAcceptedFactPublication
  return DeliveryActionExecutor.of({
    execute: (action, lease) => {
      const execution = executeLiveAction(action, lease, runId, target).pipe(Effect.provide(dependencies))
      return provideOptionalEvidenceStore(execution, evidenceStore).pipe(
        Effect.tap(() => acceptedFactPublication.awaitCurrent)
      )
    }
  })
})

export const liveDeliveryActionExecutorLayer = (runId: RunId, target: TrackerTarget) =>
  Layer.effect(DeliveryActionExecutor, makeLiveDeliveryActionExecutor(runId, target))
