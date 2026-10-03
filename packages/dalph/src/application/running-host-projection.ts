import { type PlannedTaskAttempt, type RunId } from "@dalph/contracts"
import {
  deliveryStatusObligationReference,
  deliveryStatusOf,
  type DeliveryRuntimeObservationState,
  type JournaledRunTermination,
  type TraceCursor
} from "@dalph/orchestrator"
import { Effect, Order, Schema } from "effect"
import { publicDeliveryStatusOf } from "./production-cli-status-schema.js"
import { type RunningHostError, RunningHostRunControl, RunningHostSnapshot } from "./running-host-contract.js"

type Ready = Extract<DeliveryRuntimeObservationState, { readonly _tag: "Ready" }>
type Obligation = Ready["evaluation"]["current"]["ticketDeliveries"]["deliveries"][number]["obligations"][number]
const plannedAttemptOf = (obligation: Obligation): PlannedTaskAttempt | null => {
  if (obligation._tag === "AcceptedAwaitingIntegration") return obligation.accepted.plannedAttempt
  if (obligation._tag !== "WorkflowResponsibility") return obligation.responsibility.plannedAttempt
  const responsibility = obligation.responsibility
  if (responsibility._tag === "PlannedAttemptExecutorWorkResponsibility") return responsibility.plannedAttempt
  if (responsibility._tag === "TaskWorktreeResponsibility") return responsibility.operation.plannedAttempt
  return null
}
const compare = Order.String
const failed = (causeTag: string, detail: string): RunningHostError => ({ _tag: "ProjectionFailed", causeTag, detail })

const readyProjection = Effect.fn("RunningHost.projectReady")(function* (runId: RunId, ready: Ready) {
  const evaluation = ready.evaluation
  if (evaluation.runId !== runId || evaluation.taskWork.runId !== runId) {
    return yield* Effect.fail(failed("RunIdentityConflict", "The publication belongs to another Run."))
  }
  const status = deliveryStatusOf({ _tag: "Run", runId }, ready)
  if (status._tag !== "DeliveryStatusAvailable") {
    return yield* Effect.fail(failed(status._tag, "The publication cannot establish coherent Run delivery status."))
  }
  const tickets = evaluation.current.ticketDeliveries.source
  const graph = evaluation.current.trackerGraph
  const retained = evaluation.current.ticketDeliveries.deliveries
    .flatMap((delivery) =>
      delivery.obligations.map((obligation) => ({
        taskId: delivery.taskId,
        obligationReference: deliveryStatusObligationReference(obligation),
        kind: obligation._tag,
        plannedAttempt: plannedAttemptOf(obligation)
      }))
    )
    .toSorted(
      (left, right) =>
        compare(left.taskId, right.taskId) || compare(left.obligationReference, right.obligationReference)
    )
  if (
    new Set(retained.map(({ obligationReference }) => obligationReference)).size !== retained.length ||
    retained.some(
      ({ plannedAttempt, taskId }) =>
        plannedAttempt !== null && (plannedAttempt.runId !== runId || plannedAttempt.taskId !== taskId)
    ) ||
    evaluation.taskWork.held.some(({ correlation }) => correlation.runId !== runId)
  ) {
    return yield* Effect.fail(
      failed(
        "RetainedIdentityConflict",
        "Retained obligations and held attempts must identify this Run and exact task."
      )
    )
  }
  return yield* Schema.decodeUnknownEffect(RunningHostSnapshot)(
    {
      _tag: "Ready",
      runId,
      acceptedAt: evaluation.acceptedAt === null ? null : { runId, position: evaluation.acceptedAt },
      graph:
        graph._tag === "GraphNotEstablished"
          ? { _tag: "GraphNotEstablished" }
          : { _tag: "GraphEstablished", snapshot: graph.observation.snapshot.toWire() },
      frontier: { policy: tickets.policy, standings: tickets.source.standings, placements: tickets.placements },
      delivery: publicDeliveryStatusOf(status),
      retained,
      held: [...evaluation.taskWork.held].toSorted(
        (left, right) =>
          compare(left.taskId, right.taskId) || compare(left.correlation.attemptId, right.correlation.attemptId)
      )
    },
    { onExcessProperty: "error" }
  ).pipe(
    Effect.mapError(() =>
      failed("SnapshotSchemaInvalid", "The complete publication does not satisfy the public snapshot schema.")
    )
  )
})

/** Projects only the supplied publication; it cannot attach, fetch authority facts or append history. */
export const projectRunningHostSnapshot = Effect.fn("RunningHost.projectSnapshot")(function* (
  runId: RunId,
  state: DeliveryRuntimeObservationState
) {
  if (state._tag === "NotReady") return { _tag: "NotReady" as const, runId }
  if (state._tag === "Ready") return yield* readyProjection(runId, state)
  const final = state.final === null ? null : yield* readyProjection(runId, state.final)
  return yield* Schema.decodeUnknownEffect(RunningHostSnapshot)({ _tag: "Closed", runId, final }).pipe(
    Effect.mapError(() =>
      failed("SnapshotSchemaInvalid", "The final publication does not satisfy the public snapshot schema.")
    )
  )
})

export interface RunningHostControlObservation {
  readonly direction: "RunPaused" | "RunUnpaused" | "RunTerminated"
  readonly observedAt: TraceCursor
  readonly termination: JournaledRunTermination | null
}
export interface RunningHostFinalityFailure {
  readonly _tag: "WorkflowRunTerminationEvidenceInvalid"
  readonly runId: RunId
  readonly detail: string
}
/** Keeps exact accepted termination separate from the current runtime publication. */
export const projectRunningHostRunControl = Effect.fn("RunningHost.projectRunControl")(function* (
  observation: RunningHostControlObservation,
  failure: RunningHostFinalityFailure | null
) {
  if (observation.direction === "RunTerminated") {
    if (
      observation.termination === null ||
      observation.termination.terminatedAt.runId !== observation.observedAt.runId ||
      observation.termination.terminatedAt.position > observation.observedAt.position
    ) {
      return yield* Effect.fail(
        failed("TerminationEvidenceMissing", "Terminal control requires its exact accepted termination occurrence.")
      )
    }
    return RunningHostRunControl.cases.RunTerminated.make({
      terminationEvidence: { _tag: "Accepted", ...observation.termination }
    })
  }
  if (observation.termination !== null || (failure !== null && failure.runId !== observation.observedAt.runId)) {
    return yield* Effect.fail(
      failed("ControlEvidenceConflict", "Control evidence must belong to the one observed Run prefix.")
    )
  }
  return yield* Schema.decodeUnknownEffect(RunningHostRunControl)({
    _tag: observation.direction,
    controlObservedAt: observation.observedAt,
    terminationEvidence:
      failure === null
        ? { _tag: "Pending" }
        : { _tag: "FinalityFailed", failure: { _tag: failure._tag, runId: failure.runId, detail: failure.detail } }
  }).pipe(
    Effect.mapError(() => failed("ControlSchemaInvalid", "The control observation does not satisfy the public schema."))
  )
})
