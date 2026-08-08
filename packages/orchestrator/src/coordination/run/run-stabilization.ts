import { Effect, Option, Stream } from "effect"
import type { TrackerTarget } from "../../authorities/task-tracker/target.js"
import type { DeliveryRuntimeInput, DeliveryRuntimeQuiescence } from "../delivery/run-delivery-runtime.js"
import { runDeliveryRuntimePhase } from "../delivery/run-delivery-runtime.js"
import { DeliveryRuntimeResources } from "../delivery/delivery-runtime-resources.js"
import type { DeliveryRuntimeEvaluation } from "../delivery/relations.js"
import { deliveryFinalityOf } from "../delivery/relations.js"
import type { RunFinalityProof } from "../frontier/run-finality.js"
import type { JournalPosition } from "../../workflow-journal/identity.js"
import { OperationIdAllocator } from "../../workflow/protocols/task-attempt-planning/plan.js"
import { makeTrackerGraphObservationOperation } from "../../workflow/registry/operation.js"
import { executeTrackerGraphRead } from "../delivery/delivery-action-adapter-common.js"

const proofOf = (quiescence: DeliveryRuntimeQuiescence): RunFinalityProof => ({
  acceptedAt: quiescence.acceptedAt,
  decision: deliveryFinalityOf(quiescence.current, quiescence.proposedActions, quiescence.disposition)
})

const acceptsObservation = (
  operationId: ReturnType<typeof makeTrackerGraphObservationOperation>["operationId"],
  evaluation: DeliveryRuntimeEvaluation,
  after: JournalPosition
): boolean =>
  evaluation.current.trackerGraph._tag === "GraphEstablished" &&
  evaluation.current.trackerGraph.observation.operationId === operationId &&
  evaluation.current.trackerGraph.observation.recordedAt > after

/** Waits for delivery to publish the exact accepted logical read, including equal-content reconfirmations. */
const awaitAcceptedObservation = Effect.fn("RunStabilization.awaitAcceptedObservation")(function* <E>(
  evaluations: DeliveryRuntimeInput<E>,
  operationId: ReturnType<typeof makeTrackerGraphObservationOperation>["operationId"],
  after: JournalPosition
) {
  const accepted = yield* Stream.concat(Stream.fromEffect(evaluations.get), evaluations.changes).pipe(
    Stream.filter((evaluation) => acceptsObservation(operationId, evaluation, after)),
    Stream.runHead
  )
  return Option.getOrThrow(accepted)
})

/**
 * Runs ordinary delivery actions to quiescence, obtains one later complete
 * tracker observation through the journaled read protocol, then lets the same
 * runtime react once more before returning finality to the Run bootstrap.
 */
export const runStabilizedDelivery = Effect.fn("RunStabilization.run")(function* <E>(
  target: TrackerTarget,
  evaluations: DeliveryRuntimeInput<E>
) {
  return yield* Effect.scoped(
    Effect.gen(function* () {
      const g1 = yield* runDeliveryRuntimePhase(evaluations)
      if (g1._tag === "PassiveRuntimeQuiescence") return proofOf(g1)

      const allocator = yield* OperationIdAllocator
      const operationId = yield* allocator.allocate()
      const predecessorOperationIds = [g1.current.trackerGraph.observation.operationId]
      const operation = makeTrackerGraphObservationOperation(operationId, target, predecessorOperationIds)
      yield* executeTrackerGraphRead(operation)
      yield* awaitAcceptedObservation(evaluations, operationId, g1.current.trackerGraph.observation.recordedAt)
      return proofOf(yield* runDeliveryRuntimePhase(evaluations))
    })
  ).pipe(
    Effect.ensuring(Effect.flatMap(DeliveryRuntimeResources, ({ integrationTargets }) => integrationTargets.releaseAll))
  )
})
