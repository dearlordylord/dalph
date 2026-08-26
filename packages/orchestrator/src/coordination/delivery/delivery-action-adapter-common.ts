import { Effect } from "effect"
import { OperationSelected, TaskTrackerFactsObservedTrace } from "../../presentation/tracker-workflow-trace.js"
import { WorkflowInterpreter, WorkflowTrace } from "../../workflow/interpretation/interpreter.js"
import { makeTrackerGraphObservationOperation } from "../../workflow/registry/operation.js"
import { makeCompleteTaskTrackerFactsObserved } from "../../workflow/task-tracker-facts/observation.js"
import {
  type DeliveryActionExecutionLease,
  type DeliveryActionResult,
  interruptibleBoundaryOf,
  type MaterializedDeliveryAction
} from "./delivery-action-executor.js"
import type { FreshOperationOnlyRoute } from "./delivery-action-proposal.js"

export const deliveryActionCompleted = (
  proposalId: MaterializedDeliveryAction["proposal"]["id"]
): DeliveryActionResult => ({ _tag: "ActionCompleted", proposalId })

export const deliveryActionDeferred = (
  proposalId: MaterializedDeliveryAction["proposal"]["id"],
  reason: Extract<DeliveryActionResult, { readonly _tag: "ActionDeferred" }>["reason"]
): DeliveryActionResult => ({ _tag: "ActionDeferred", proposalId, reason })

export const executeTrackerGraphRead = Effect.fn("DeliveryAction.readGraph")(function* (
  operation: ReturnType<typeof makeTrackerGraphObservationOperation>,
  lease?: DeliveryActionExecutionLease
) {
  const interpreter = yield* WorkflowInterpreter
  const trace = yield* WorkflowTrace
  yield* trace.emit(OperationSelected.make({ operation }))
  const snapshot = yield* interpreter.readTrackerGraph(
    operation,
    lease?.recordIntent(operation.operationId),
    lease === undefined ? undefined : interruptibleBoundaryOf(lease)
  )
  yield* trace.emit(
    TaskTrackerFactsObservedTrace.make({
      observation: makeCompleteTaskTrackerFactsObserved(operation, snapshot),
      operation
    })
  )
  return snapshot
})

export const executeFreshTrackerGraphRead = Effect.fn("DeliveryAction.executeFreshTrackerGraphRead")(function* (
  action: Extract<MaterializedDeliveryAction, { readonly _tag: "FreshOperationAction" }>,
  route: Extract<FreshOperationOnlyRoute, { readonly _tag: "TrackerGraphReadRoute" }>,
  lease: DeliveryActionExecutionLease
) {
  const causalGraphReadShape = (() => {
    switch (route.purpose) {
      case "EstablishCurrentGraph":
        return {
          explicitlyCoveredTaskIds: [],
          predecessorOperationIds:
            route.establishment._tag === "InitialGraphEstablishment" ? [] : route.establishment.predecessorOperationIds
        }
      case "RefreshCurrentGraph":
        return {
          explicitlyCoveredTaskIds: route.explicitlyCoveredTaskIds,
          predecessorOperationIds: route.predecessorOperationIds
        }
      case "CheckExecutorProgress":
        return { explicitlyCoveredTaskIds: route.explicitlyCoveredTaskIds, predecessorOperationIds: [] }
      default: {
        const unreachableRoute: never = route
        return unreachableRoute
      }
    }
  })()
  const operation = makeTrackerGraphObservationOperation(
    action.operationId,
    route.target,
    causalGraphReadShape.predecessorOperationIds,
    causalGraphReadShape.explicitlyCoveredTaskIds
  )
  return yield* executeTrackerGraphRead(operation, lease).pipe(
    Effect.map((snapshot) => ({
      _tag: "TrackerGraphObservationPublished" as const,
      operationId: action.operationId,
      proposalId: action.proposal.id,
      snapshot
    })),
    Effect.catchTags({
      "FixtureReader.FixtureReadError": () =>
        Effect.succeed(deliveryActionDeferred(action.proposal.id, "TrackerGraphReadUnavailable")),
      "TaskDag.GraphProjectionError": () =>
        Effect.succeed(deliveryActionDeferred(action.proposal.id, "TrackerGraphReadUnavailable")),
      "TrackerGraphReader.AdapterReadError": (failure) =>
        failure.reason._tag === "BoundaryDecode"
          ? Effect.fail(failure)
          : Effect.succeed(deliveryActionDeferred(action.proposal.id, "TrackerGraphReadUnavailable")),
      "TrackerGraphReader.TrackerReadError": () =>
        Effect.succeed(deliveryActionDeferred(action.proposal.id, "TrackerGraphReadUnavailable")),
      TaskTrackerFactsReadUnavailable: () =>
        Effect.succeed(deliveryActionDeferred(action.proposal.id, "TrackerGraphReadUnavailable"))
    })
  )
})
