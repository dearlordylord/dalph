import { Effect, Option, Stream } from "effect"
import { taskTrackerTargetKey, type TrackerTarget } from "../../authorities/task-tracker/target.js"
import type { DeliveryRuntimeInput, DeliveryRuntimeQuiescence } from "../delivery/run-delivery-runtime.js"
import { runDeliveryRuntimePhase } from "../delivery/run-delivery-runtime.js"
import { DeliveryRuntimeResources } from "../delivery/delivery-runtime-resources.js"
import type { DeliveryRuntimeEvaluation } from "../delivery/relations.js"
import { attachCurrentSignal, deliveryFinalityOf } from "../delivery/relations.js"
import {
  makeRunFinalityEvidence,
  RunFinalityReadShape,
  runTerminationDispositionOf,
  type RunFinalityProof
} from "../frontier/run-finality.js"
import type { JournalPosition } from "../../workflow-journal/identity.js"
import { OperationIdAllocator } from "../../workflow/protocols/task-attempt-planning/plan.js"
import { makeTrackerGraphObservationOperation } from "../../workflow/registry/operation.js"
import { executeTrackerGraphRead } from "../delivery/delivery-action-adapter-common.js"
import { RunFinalityDecision } from "../frontier/frontier.js"
import { InRunJournal } from "../../workflow-journal/store.js"

const proofOf = (
  target: TrackerTarget,
  quiescence: DeliveryRuntimeQuiescence,
  readShape: RunFinalityReadShape
): RunFinalityProof => {
  const decision = deliveryFinalityOf(quiescence.current, quiescence.proposedActions, quiescence.disposition)
  if (decision._tag === "RunMustRemainActive") return { acceptedAt: quiescence.acceptedAt, decision }
  if (quiescence._tag === "PassiveRuntimeQuiescence") {
    return {
      acceptedAt: quiescence.acceptedAt,
      decision: RunFinalityDecision.RunMustRemainActive({ reason: "TrackerTargetUnsettled" })
    }
  }
  const acceptedAt = quiescence.acceptedAt
  const graph = quiescence.current.trackerGraph
  const runId = quiescence.current.runId
  if (
    runId === undefined ||
    graph.observation.snapshot.taskIds().length === 0 ||
    !graph.observation.snapshot.toWire().tasks.some(({ parentTaskId }) => parentTaskId === null)
  ) {
    return { acceptedAt, decision: RunFinalityDecision.RunMustRemainActive({ reason: "TrackerTargetUnsettled" }) }
  }
  const evidence = makeRunFinalityEvidence({
    operationId: graph.observation.operationId,
    observedAt: graph.observation.recordedAt,
    readShape,
    rootPresent: true,
    runId,
    snapshot: graph.observation.snapshot,
    target
  })
  const disposition = runTerminationDispositionOf(
    evidence.graphOutcome,
    quiescence.current.cancellationApplied === true
  )
  if (disposition === undefined) {
    return { acceptedAt, decision: RunFinalityDecision.RunMustRemainActive({ reason: "TrackerTargetUnsettled" }) }
  }
  return { acceptedAt, decision, disposition, evidence }
}

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
  return yield* Effect.scoped(
    Effect.gen(function* () {
      const attachment = yield* attachCurrentSignal(evaluations)
      if (acceptsObservation(operationId, attachment.current, after)) return attachment.current
      return Option.getOrThrow(
        yield* attachment.changes.pipe(
          Stream.filter((evaluation) => acceptsObservation(operationId, evaluation, after)),
          Stream.runHead
        )
      )
    })
  )
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
      const firstQuiescence = yield* runDeliveryRuntimePhase(evaluations)
      const defaultReadShape = RunFinalityReadShape.make({ explicitlyCoveredTaskIds: [] })
      if (firstQuiescence._tag === "PassiveRuntimeQuiescence") {
        return proofOf(target, firstQuiescence, defaultReadShape)
      }

      const applicationExitAdmission = (yield* DeliveryRuntimeResources).applicationExitAdmission
      const owner = yield* applicationExitAdmission.acquireForwardOwner("InterruptibleBoundary").pipe(Effect.option)
      if (Option.isNone(owner)) return proofOf(target, firstQuiescence, defaultReadShape)

      const allocator = yield* OperationIdAllocator
      const operationId = yield* allocator.allocate()
      const currentGraphOperationId = firstQuiescence.current.trackerGraph.observation.operationId
      const runId = firstQuiescence.current.runId
      const journal = yield* Effect.serviceOption(InRunJournal)
      const predecessorOperationIds =
        runId === undefined || Option.isNone(journal)
          ? [currentGraphOperationId]
          : (yield* journal.value.read(runId))
              .flatMap(({ event }) =>
                event._tag === "TaskTrackerReadIntentRecorded" &&
                event.operation._tag === "ReadTrackerGraph" &&
                taskTrackerTargetKey(event.operation.target) === taskTrackerTargetKey(target)
                  ? [event.operation.operationId]
                  : []
              )
              .filter((candidate, index, all) => all.indexOf(candidate) === index)
      const operation = makeTrackerGraphObservationOperation(operationId, target, predecessorOperationIds)
      const accepted = yield* executeTrackerGraphRead(operation).pipe(
        Effect.andThen(
          awaitAcceptedObservation(
            evaluations,
            operationId,
            firstQuiescence.current.trackerGraph.observation.recordedAt
          )
        ),
        Effect.ensuring(owner.value.release)
      )
      if ((yield* applicationExitAdmission.snapshot).cutoffClosed) {
        return {
          acceptedAt: accepted.acceptedAt,
          decision: RunFinalityDecision.RunMustRemainActive({ reason: "UnsettledResponsibility" })
        }
      }
      return proofOf(
        target,
        yield* runDeliveryRuntimePhase(evaluations),
        RunFinalityReadShape.make(operation.readShape)
      )
    })
  ).pipe(
    Effect.ensuring(Effect.flatMap(DeliveryRuntimeResources, ({ integrationTargets }) => integrationTargets.releaseAll))
  )
})
