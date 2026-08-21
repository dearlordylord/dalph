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
import {
  OperationIdAllocator,
  type OperationIdAllocatorService
} from "../../workflow/protocols/task-attempt-planning/plan.js"
import { makeTrackerGraphObservationOperation } from "../../workflow/registry/operation.js"
import { executeTrackerGraphRead } from "../delivery/delivery-action-adapter-common.js"
import { RunFinalityDecision } from "../frontier/frontier.js"
import { InRunJournal, type InRunJournalService } from "../../workflow-journal/store.js"

type EstablishedTrackerGraph = Extract<
  DeliveryRuntimeQuiescence["current"]["trackerGraph"],
  { readonly _tag: "GraphEstablished" }
>

const unsettledProof = (acceptedAt: JournalPosition | null): RunFinalityProof => ({
  acceptedAt,
  decision: RunFinalityDecision.RunMustRemainActive({ reason: "TrackerTargetUnsettled" })
})

const passiveCancellationApplied = (quiescence: DeliveryRuntimeQuiescence): boolean =>
  quiescence._tag === "PassiveRuntimeQuiescence" && quiescence.current.cancellationApplied === true

const establishedGraphOf = (quiescence: DeliveryRuntimeQuiescence): EstablishedTrackerGraph | undefined => {
  const graph = quiescence.current.trackerGraph
  return graph._tag === "GraphEstablished" ? graph : undefined
}

const rootTaskIdOf = (
  graph: EstablishedTrackerGraph
): EstablishedTrackerGraph["observation"]["snapshot"]["rootTaskId"] => {
  const taskIds = graph.observation.snapshot.taskIds()
  if (taskIds.length === 0) return undefined
  const rootTaskId = graph.observation.snapshot.rootTaskId
  return rootTaskId !== undefined && taskIds.includes(rootTaskId) ? rootTaskId : undefined
}

const finalityInputsOf = (
  quiescence: DeliveryRuntimeQuiescence
):
  | {
      readonly acceptedAt: JournalPosition
      readonly graph: EstablishedTrackerGraph
      readonly rootTaskId: NonNullable<EstablishedTrackerGraph["observation"]["snapshot"]["rootTaskId"]>
      readonly runId: NonNullable<DeliveryRuntimeQuiescence["current"]["runId"]>
    }
  | undefined => {
  if (quiescence.acceptedAt === null || quiescence.current.runId === undefined) return undefined
  const graph = establishedGraphOf(quiescence)
  if (graph === undefined) return undefined
  const rootTaskId = rootTaskIdOf(graph)
  if (rootTaskId === undefined) return undefined
  return { acceptedAt: quiescence.acceptedAt, graph, rootTaskId, runId: quiescence.current.runId }
}

const proofOf = (target: TrackerTarget, quiescence: DeliveryRuntimeQuiescence): RunFinalityProof => {
  const cancellationAppliedWhilePassive = passiveCancellationApplied(quiescence)
  const decision = deliveryFinalityOf(
    quiescence.current,
    quiescence.proposedActions,
    cancellationAppliedWhilePassive ? { _tag: "TrackerReconfirmationAllowed" } : quiescence.disposition
  )
  if (decision._tag === "RunMustRemainActive") return { acceptedAt: quiescence.acceptedAt, decision }
  if (quiescence._tag === "PassiveRuntimeQuiescence" && !cancellationAppliedWhilePassive) {
    return unsettledProof(quiescence.acceptedAt)
  }
  const inputs = finalityInputsOf(quiescence)
  if (inputs === undefined) return unsettledProof(quiescence.acceptedAt)
  const evidence = makeRunFinalityEvidence({
    operationId: inputs.graph.observation.operationId,
    observedAt: inputs.graph.observation.recordedAt,
    readShape: RunFinalityReadShape.make({
      explicitlyCoveredTaskIds: inputs.graph.observation.explicitlyCoveredTaskIds
    }),
    rootTaskId: inputs.rootTaskId,
    runId: inputs.runId,
    snapshot: inputs.graph.observation.snapshot,
    target
  })
  const disposition = runTerminationDispositionOf(
    evidence.graphOutcome,
    quiescence.current.cancellationApplied === true
  )
  return disposition === undefined
    ? unsettledProof(inputs.acceptedAt)
    : { acceptedAt: inputs.acceptedAt, decision, disposition, evidence }
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

const shouldReturnInitialProof = (quiescence: DeliveryRuntimeQuiescence): boolean => {
  if (quiescence._tag === "PassiveRuntimeQuiescence") return !passiveCancellationApplied(quiescence)
  return false
}

const journaledPredecessorOperationIds = (
  journal: InRunJournalService,
  runId: DeliveryRuntimeQuiescence["current"]["runId"],
  target: TrackerTarget
) =>
  runId === undefined
    ? Effect.succeed<ReadonlyArray<ReturnType<typeof makeTrackerGraphObservationOperation>["operationId"]>>([])
    : journal
        .read(runId)
        .pipe(
          Effect.map((records) =>
            records.flatMap(({ event }) =>
              event._tag === "TaskTrackerReadIntentRecorded" &&
              event.operation._tag === "ReadTrackerGraph" &&
              taskTrackerTargetKey(event.operation.target) === taskTrackerTargetKey(target)
                ? [event.operation.operationId]
                : []
            )
          )
        )

const distinctOperationIds = <OperationId>(operationIds: ReadonlyArray<OperationId>): ReadonlyArray<OperationId> =>
  operationIds.filter((candidate, index, all) => all.indexOf(candidate) === index)

const allocateUnjournaledOperationId = Effect.fn("RunStabilization.allocateUnjournaledOperationId")(function* (
  allocator: OperationIdAllocatorService,
  journaledOperationIds: ReadonlyArray<ReturnType<typeof makeTrackerGraphObservationOperation>["operationId"]>
) {
  const journaled = new Set(journaledOperationIds)
  for (let attempt = 0; attempt <= journaled.size; attempt += 1) {
    const candidate = yield* allocator.allocate()
    if (!journaled.has(candidate)) return candidate
  }
  return yield* Effect.die("operation id allocator repeated only journaled graph-read identities")
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
      if (shouldReturnInitialProof(firstQuiescence)) {
        return proofOf(target, firstQuiescence)
      }
      if (firstQuiescence.acceptedAt === null) {
        return proofOf(target, firstQuiescence)
      }
      const currentGraph = establishedGraphOf(firstQuiescence)
      if (currentGraph === undefined) return proofOf(target, firstQuiescence)

      const applicationExitAdmission = (yield* DeliveryRuntimeResources).applicationExitAdmission
      const owner = yield* applicationExitAdmission.acquireForwardOwner("InterruptibleBoundary").pipe(Effect.option)
      if (Option.isNone(owner)) return proofOf(target, firstQuiescence)

      const allocator = yield* OperationIdAllocator
      const currentGraphOperationId = currentGraph.observation.operationId
      const runId = firstQuiescence.current.runId
      const journal = yield* InRunJournal
      const journaledPredecessors = yield* journaledPredecessorOperationIds(journal, runId, target)
      const predecessorOperationIds = distinctOperationIds([...journaledPredecessors, currentGraphOperationId])
      const operationId = yield* allocateUnjournaledOperationId(allocator, predecessorOperationIds)
      const operation = makeTrackerGraphObservationOperation(
        operationId,
        target,
        predecessorOperationIds,
        currentGraph.observation.snapshot.taskIds()
      )
      const accepted = yield* executeTrackerGraphRead(operation).pipe(
        Effect.andThen(awaitAcceptedObservation(evaluations, operationId, currentGraph.observation.recordedAt)),
        Effect.ensuring(owner.value.release)
      )
      if ((yield* applicationExitAdmission.snapshot).cutoffClosed) {
        return {
          acceptedAt: accepted.acceptedAt,
          decision: RunFinalityDecision.RunMustRemainActive({ reason: "UnsettledResponsibility" })
        }
      }
      return proofOf(target, yield* runDeliveryRuntimePhase(evaluations))
    })
  ).pipe(
    Effect.ensuring(Effect.flatMap(DeliveryRuntimeResources, ({ integrationTargets }) => integrationTargets.releaseAll))
  )
})
