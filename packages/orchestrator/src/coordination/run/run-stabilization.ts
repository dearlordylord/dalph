import { Effect, Option, Stream } from "effect"
import { taskTrackerTargetKey, type TrackerTarget } from "../../authorities/task-tracker/target.js"
import {
  DeliveryRuntimePhase,
  runDeliveryRuntimePhase,
  type DeliveryRuntimeInput,
  type DeliveryRuntimeQuiescence,
  type ActiveRefreshPreG2Subject
} from "../delivery/run-delivery-runtime.js"
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
import { InRunJournal, type InRunJournalService, type JournalRecord } from "../../workflow-journal/store.js"
import type { RunActivationOpportunity } from "./run-activation-opportunity.js"
import { pendingActiveRefreshG2OperationFor } from "./recovery-activation.js"
import { currentAcceptedPlannedAttemptExecutorLifecycleFor } from "../../workflow/protocols/planned-attempt-executor-work/evidence.js"

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
  /* v8 ignore next -- @preserve A terminal delivery decision requires an established graph; nonterminal callers retain undefined. */
  return graph._tag === "GraphEstablished" ? graph : undefined
}

const rootTaskIdOf = (
  graph: EstablishedTrackerGraph
): EstablishedTrackerGraph["observation"]["snapshot"]["rootTaskId"] => {
  const taskIds = graph.observation.snapshot.taskIds()
  if (taskIds.length === 0) return undefined
  const rootTaskId = graph.observation.snapshot.rootTaskId
  /* v8 ignore next -- @preserve TaskDagSnapshot projection retains only a root that belongs to its task set. */
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
  /* v8 ignore next -- @preserve deliveryFinalityOf cannot return RunMayTerminate without an established graph. */
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
  /* v8 ignore next -- @preserve Non-cancelled passive quiescence is classified RunMustRemainActive before this terminal-proof path. */
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
  /* v8 ignore next -- @preserve RunMayTerminate plus valid finality inputs always yields Completed, Blocked, or Cancelled. */
  return disposition === undefined
    ? unsettledProof(inputs.acceptedAt)
    : { acceptedAt: inputs.acceptedAt, decision, disposition, evidence }
}

/**
 * Uses the accepted G2 graph as the proof boundary for an active refresh that
 * reconciled a persisted Suspend. The active subject remains suppressed by
 * its typed boundary, while a second ordinary runtime phase may admit work
 * that G2 discovered for an independent subject.
 */
const proofOfAcceptedActiveRefreshG2 = <E>(
  target: TrackerTarget,
  evaluations: DeliveryRuntimeInput<E>,
  accepted: DeliveryRuntimeEvaluation,
  subjects: ReadonlyArray<ActiveRefreshPreG2Subject>
) =>
  Effect.gen(function* () {
    if (accepted.acceptedAt === null || accepted.current.trackerGraph._tag !== "GraphEstablished") {
      return unsettledProof(accepted.acceptedAt)
    }
    if (accepted.quiescence._tag === "QuiescencePassive") return unsettledProof(accepted.acceptedAt)
    if (accepted.proposedActions._tag === "DeliveryProposalOwnershipConflict") {
      return unsettledProof(accepted.acceptedAt)
    }
    const phaseTwo = yield* runDeliveryRuntimePhase(evaluations, DeliveryRuntimePhase.ActiveRefreshPostG2(subjects))
    return proofOf(target, phaseTwo)
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

/**
 * Runs ordinary delivery actions to quiescence, obtains one later complete
 * tracker observation through the journaled read protocol, then lets the same
 * runtime react once more before returning finality to the Run bootstrap.
 */
export const runStabilizedDelivery = Effect.fn("RunStabilization.run")(function* <E>(
  target: TrackerTarget,
  evaluations: DeliveryRuntimeInput<E>,
  opportunity: RunActivationOpportunity = { _tag: "OrdinaryRunEntry" }
) {
  return yield* Effect.scoped(
    Effect.gen(function* () {
      const firstPhase =
        opportunity._tag === "ActiveWorkAuthorityRefresh"
          ? DeliveryRuntimePhase.ActiveRefreshPreG2([...opportunity.subjects])
          : DeliveryRuntimePhase.Ordinary
      const firstQuiescence = yield* runDeliveryRuntimePhase(evaluations, firstPhase)
      if (shouldReturnInitialProof(firstQuiescence)) {
        return proofOf(target, firstQuiescence)
      }
      if (firstQuiescence.acceptedAt === null) {
        return proofOf(target, firstQuiescence)
      }
      const currentGraph = establishedGraphOf(firstQuiescence)
      /* v8 ignore next -- @preserve shouldReturnInitialProof accepts every first phase without an established graph. */
      if (currentGraph === undefined) return proofOf(target, firstQuiescence)

      const journal = yield* InRunJournal
      const currentGraphOperationId = currentGraph.observation.operationId
      const runId = firstQuiescence.current.runId
      let journalRecords: ReadonlyArray<JournalRecord> = []
      if (runId !== undefined) journalRecords = yield* journal.read(runId)
      if (
        opportunity._tag === "ActiveWorkAuthorityRefresh" &&
        currentGraph.observation.cause._tag !== "ExecutingWorkAuthorityCheck"
      ) {
        const everyActiveSubjectSettled = [...opportunity.subjects].every(
          (subject) => currentAcceptedPlannedAttemptExecutorLifecycleFor(journalRecords, subject)._tag === "Settled"
        )
        if (everyActiveSubjectSettled) {
          return proofOf(target, yield* runDeliveryRuntimePhase(evaluations))
        }
        return proofOf(target, firstQuiescence)
      }

      const applicationExitAdmission = (yield* DeliveryRuntimeResources).applicationExitAdmission
      const owner = yield* applicationExitAdmission.acquireForwardOwner("InterruptibleBoundary").pipe(Effect.option)
      if (Option.isNone(owner)) return proofOf(target, firstQuiescence)
      const pendingOperation =
        opportunity._tag === "ActiveWorkAuthorityRefresh" && runId !== undefined
          ? pendingActiveRefreshG2OperationFor(journalRecords, runId, target, {
              operationId: currentGraphOperationId,
              recordedAt: currentGraph.observation.recordedAt
            })
          : undefined
      const operation =
        pendingOperation ??
        (yield* Effect.gen(function* () {
          const allocator = yield* OperationIdAllocator
          const operationId = yield* allocator.allocate()
          const journaledPredecessors = yield* journaledPredecessorOperationIds(journal, runId, target)
          const predecessorOperationIds = distinctOperationIds([...journaledPredecessors, currentGraphOperationId])
          return makeTrackerGraphObservationOperation(
            { _tag: "PostQuiescenceReconfirmation", quiescentGraphOperationId: currentGraphOperationId },
            operationId,
            target,
            predecessorOperationIds
          )
        }))
      const operationId = operation.operationId
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
      if (opportunity._tag === "ActiveWorkAuthorityRefresh") {
        return yield* proofOfAcceptedActiveRefreshG2(target, evaluations, accepted, [...opportunity.subjects])
      }
      return proofOf(target, yield* runDeliveryRuntimePhase(evaluations))
    })
  ).pipe(
    Effect.ensuring(Effect.flatMap(DeliveryRuntimeResources, ({ integrationTargets }) => integrationTargets.releaseAll))
  )
})
