import { plannedAttemptExecutorCorrelation, type AttemptId, type RunId } from "@dalph/contracts"
import { Effect, Layer, Option, Ref, Schema, Semaphore, Stream, SubscriptionRef } from "effect"
import * as Cause from "effect/Cause"
import type { TrackerTarget } from "../../authorities/task-tracker/target.js"
import type { RunControlPolicy } from "../../control/policy.js"
import { deriveIntegrationAdmission } from "../../workflow/protocols/integration-admission/protocol.js"
import type { JournalRecord } from "../../workflow-journal/store.js"
import { runnableTransitionTaskId, type RunnableFrontierTransition } from "../frontier/frontier.js"
import type { RunRecoveryActivationError, RunRecoveryProjectionSnapshot } from "../run/recovery-activation.js"
import { journaledCurrentDeliveryFrameOf } from "../run/current-delivery-relation.js"
import { deriveFreshWorkflowDecisions } from "../run/fresh-workflow.js"
import { acceptedOperationIdsOf } from "./delivery-shadow.js"
import { ticketDeliveryEvidenceOf, journaledIntegrationEvidenceOf } from "./delivery-shadow-evidence.js"
import { deliveryProposalsOf, trackerGraphReadProposalOf } from "./delivery-proposal.js"
import { makeDeliveryRelationsLayer } from "./in-memory-relations.js"
import {
  type CurrentSignal,
  type DeliveryInvalidation,
  DeliveryRelationReconciliationError,
  type DeliveryRelationSourceError,
  DeliveryRelationRevision,
  type DeliveryRuntimeFacts,
  type TicketDeliveryEvidence,
  type TrackerGraphActionProposal,
  type TrackerGraphState
} from "./relations.js"
import type { DeliveryProposalContributions } from "./delivery-action-proposal.js"
import type { AcceptedFactPublicationGatewayService } from "./accepted-fact-gateway.js"

/** Accepted Run history cannot drive delivery until its initial control policy exists. */
export class DeliveryControlPolicyMissing extends Schema.TaggedErrorClass<DeliveryControlPolicyMissing>()(
  "DeliveryControlPolicyMissing",
  {}
) {}

interface ReactiveDeliveryBundle {
  readonly exactEvidence: ReadonlyArray<TicketDeliveryEvidence>
  readonly graph: TrackerGraphState
  readonly policy: RunControlPolicy
  readonly proposalContributions: DeliveryProposalContributions
  readonly runtimeFacts: DeliveryRuntimeFacts
  readonly trackerGraphProposals: ReadonlyArray<TrackerGraphActionProposal>
}

export interface DeliveryRecoveryRelationSource {
  readonly readDeliveryProjection: Effect.Effect<RunRecoveryProjectionSnapshot, RunRecoveryActivationError>
  readonly reconstructedPlannedAttemptPositions: ReadonlyArray<{ readonly attemptId: AttemptId }>
}

const boundaryTransitionAllowed = (transition: RunnableFrontierTransition): boolean =>
  transition._tag === "SuspendPlannedAttemptExecutorWork" ||
  transition._tag === "ObservePlannedAttemptContinuationWorktree" ||
  transition._tag === "ObservePlannedAttemptContinuationTargetLineage" ||
  transition._tag === "CheckTaskClaim" ||
  transition._tag === "ReconcileTaskClaim" ||
  transition._tag === "ReconcileTaskClaimRelease" ||
  transition._tag === "ReconcileTaskWorktree" ||
  transition._tag === "ReleaseStartedIntegrationTarget"

const latestExecutorReport = (records: ReadonlyArray<JournalRecord>, attemptId: AttemptId) =>
  records.findLast(
    ({ event }) =>
      event._tag === "PlannedAttemptExecutorWorkReported" && event.report.correlation.attemptId === attemptId
  )?.event

const activeAttemptPositions = (
  state: Effect.Success<AcceptedFactPublicationGatewayService["readCurrent"]>
): DeliveryRuntimeFacts["taskWork"]["held"] =>
  state.reconstructed.responsibility.entries.flatMap((responsibility) => {
    if (responsibility._tag !== "PlannedAttemptExecutorWorkResponsibility") return []
    const latest = latestExecutorReport(state.records, responsibility.plannedAttempt.attemptId)
    return latest?._tag === "PlannedAttemptExecutorWorkReported" &&
      (latest.report._tag === "SafelySuspended" || latest.report._tag === "Terminal")
      ? []
      : [
          {
            correlation: plannedAttemptExecutorCorrelation(responsibility.plannedAttempt),
            taskId: responsibility.plannedAttempt.taskId
          }
        ]
  })

/**
 * Keeps one effectful reconciliation subscription hot while all exposed
 * delivery signals remain descriptive and safe to observe repeatedly.
 */
export const makeReactiveDeliveryRelationsLayer = Effect.fn("DeliveryRelations.makeReactiveLayer")(function* (
  runId: RunId,
  target: TrackerTarget,
  gateway: AcceptedFactPublicationGatewayService,
  recovery: DeliveryRecoveryRelationSource
) {
  const recoveredAttemptIds = new Set(recovery.reconstructedPlannedAttemptPositions.map(({ attemptId }) => attemptId))
  const probe = yield* Ref.make<Option.Option<TrackerGraphActionProposal>>(Option.none())
  const revision = yield* Ref.make(DeliveryRelationRevision.make(0))

  const readCoherentAcceptedProjection = Effect.fn("DeliveryRelations.readCoherentAcceptedProjection")(function* () {
    for (;;) {
      const acceptedBefore = yield* gateway.readCurrent
      const projection = yield* recovery.readDeliveryProjection
      const acceptedAfter = yield* gateway.readCurrent
      const projectionAcceptedAt =
        projection.evidence._tag === "AvailableDeliveryProjectionEvidence"
          ? projection.evidence.acceptedAt
          : acceptedAfter.appliedPosition
      if (
        acceptedBefore.appliedPosition === acceptedAfter.appliedPosition &&
        projectionAcceptedAt === acceptedAfter.appliedPosition
      ) {
        return { accepted: acceptedAfter, projection }
      }
    }
  })

  const deriveBundle = Effect.fn("DeliveryRelations.deriveBundle")(function* (
    currentRevision: DeliveryRelationRevision
  ) {
    const { accepted, projection } = yield* readCoherentAcceptedProjection()
    const policy = yield* Option.match(accepted.reconstructed.controlPolicy, {
      onNone: () => Effect.fail(new DeliveryControlPolicyMissing()),
      onSome: Effect.succeed
    })
    const frame =
      accepted.graph._tag === "GraphEstablished" ? yield* journaledCurrentDeliveryFrameOf(accepted) : undefined
    const fresh = frame === undefined ? [] : deriveFreshWorkflowDecisions(frame, recoveredAttemptIds)
    const freshTaskIds = new Set(fresh.map(({ transition }) => runnableTransitionTaskId(transition)))
    const recovered = projection.frontier.transitions.filter(
      (transition) =>
        !freshTaskIds.has(runnableTransitionTaskId(transition)) &&
        (accepted.graph._tag === "GraphEstablished" || boundaryTransitionAllowed(transition))
    )
    const transitions = [...recovered, ...fresh.map(({ transition }) => transition)]
    const records = accepted.records
    const integrationResponsibilities = deriveIntegrationAdmission(records).responsibilities
    const proposalContributions = deliveryProposalsOf({
      acceptedAt: accepted.appliedPosition,
      acceptedOperationIds: acceptedOperationIdsOf(records),
      fresh,
      integrationResponsibilities,
      responsibilities: accepted.reconstructed.responsibility.entries,
      runId,
      transitions
    })
    const exactEvidence: ReadonlyArray<TicketDeliveryEvidence> =
      frame === undefined
        ? [
            ...(projection.evidence._tag === "AvailableDeliveryProjectionEvidence"
              ? projection.evidence.facts.map(
                  (facts): TicketDeliveryEvidence => ({ _tag: "ResponsibilityFacts", facts })
                )
              : []),
            ...journaledIntegrationEvidenceOf(records)
          ]
        : projection.evidence._tag === "AvailableDeliveryProjectionEvidence"
          ? [
              ...ticketDeliveryEvidenceOf(frame, projection.evidence.facts),
              ...projection.evidence.integrationWaits.map(
                (wait): TicketDeliveryEvidence => ({ _tag: "IntegrationWait", wait })
              )
            ]
          : []
    const activeProbe = Option.toArray(yield* Ref.get(probe))
    const trackerGraphProposals =
      accepted.graph._tag === "GraphNotEstablished"
        ? [
            trackerGraphReadProposalOf({
              acceptedAt: accepted.appliedPosition,
              purpose: "EstablishCurrentGraph",
              runId,
              target
            })
          ]
        : activeProbe
    return {
      exactEvidence,
      graph: accepted.graph,
      policy,
      proposalContributions,
      runtimeFacts: {
        acceptedAt: accepted.appliedPosition,
        quiescence:
          accepted.reconstructed.pause.run._tag === "RunPaused"
            ? { _tag: "QuiescencePassive" }
            : { _tag: "QuiescenceProbeAllowed" },
        revision: currentRevision,
        taskWork: { capacity: policy.taskExecutionCapacity, held: activeAttemptPositions(accepted) }
      },
      trackerGraphProposals
    } satisfies ReactiveDeliveryBundle
  })

  type ReactiveDeliveryFailure = Effect.Error<ReturnType<typeof deriveBundle>>
  type ReactiveDeliveryStatus =
    | { readonly _tag: "ReactiveDeliveryFailed"; readonly cause: Cause.Cause<ReactiveDeliveryFailure> }
    | { readonly _tag: "ReactiveDeliveryOpen"; readonly bundle: ReactiveDeliveryBundle }

  const statusSignal = <A>(
    project: (bundle: ReactiveDeliveryBundle) => A
  ): CurrentSignal<A, DeliveryRelationSourceError> => ({
    changes: SubscriptionRef.changes(state).pipe(
      Stream.mapEffect((status) =>
        status._tag === "ReactiveDeliveryOpen"
          ? Effect.succeed(project(status.bundle))
          : Effect.fail(new DeliveryRelationReconciliationError({ cause: status.cause }))
      )
    )
  })

  const initial = yield* deriveBundle(yield* Ref.get(revision))
  const state = yield* SubscriptionRef.make<ReactiveDeliveryStatus>({ _tag: "ReactiveDeliveryOpen", bundle: initial })
  const gate = yield* Semaphore.make(1)
  const refresh = gate.withPermit(
    Ref.updateAndGet(revision, (current) => DeliveryRelationRevision.make(current + 1)).pipe(
      Effect.flatMap((nextRevision) =>
        deriveBundle(nextRevision).pipe(Effect.map((bundle) => [nextRevision, bundle] as const))
      ),
      Effect.matchCauseEffect({
        onFailure: (cause) =>
          SubscriptionRef.set(state, { _tag: "ReactiveDeliveryFailed", cause }).pipe(Effect.andThen(Ref.get(revision))),
        onSuccess: ([nextRevision, bundle]) =>
          SubscriptionRef.set(state, { _tag: "ReactiveDeliveryOpen", bundle }).pipe(Effect.as(nextRevision))
      })
    )
  )
  const invalidate = Effect.fn("DeliveryRelations.invalidate")(function* (cause: DeliveryInvalidation) {
    if (cause._tag === "QuiescenceProbeRequested" && Option.isNone(yield* Ref.get(probe))) {
      const accepted = yield* gateway.readCurrent.pipe(
        Effect.matchEffect({
          onFailure: (failure) =>
            SubscriptionRef.set(state, { _tag: "ReactiveDeliveryFailed", cause: Cause.fail(failure) }).pipe(
              Effect.as(Option.none())
            ),
          onSuccess: (current) => Effect.succeed(Option.some(current))
        })
      )
      if (Option.isNone(accepted)) return yield* Ref.get(revision)
      yield* Ref.set(
        probe,
        Option.some(
          trackerGraphReadProposalOf({
            acceptedAt: accepted.value.appliedPosition,
            purpose: "QuiescenceProbe",
            runId,
            target
          })
        )
      )
    }
    if (cause._tag === "ProposalCompleted") {
      const currentProbe = yield* Ref.get(probe)
      if (Option.isSome(currentProbe) && currentProbe.value.id === cause.proposalId) {
        yield* Ref.set(probe, Option.none())
      }
    }
    return yield* refresh
  })

  yield* gateway.current.changes.pipe(
    Stream.runForEach(() => refresh),
    Effect.catchCause((cause) => SubscriptionRef.set(state, { _tag: "ReactiveDeliveryFailed", cause })),
    Effect.forkScoped
  )

  const bundleSignal = <A>(project: (bundle: ReactiveDeliveryBundle) => A) => statusSignal(project)
  return makeDeliveryRelationsLayer({
    evaluationConsistency: {
      currentRevision: Ref.get(revision),
      withStableRevision: (effect) => gate.withPermit(effect)
    },
    exactEvidence: bundleSignal(({ exactEvidence }) => exactEvidence),
    graph: bundleSignal(({ graph }) => graph),
    invalidate,
    policy: bundleSignal(({ policy }) => policy),
    proposalContributions: bundleSignal(({ proposalContributions }) => proposalContributions),
    runtimeFacts: bundleSignal(({ runtimeFacts }) => runtimeFacts),
    trackerGraphProposals: bundleSignal(({ trackerGraphProposals }) => trackerGraphProposals)
  })
})

/** Scoped Layer form used by the package-private candidate application seam. */
export const reactiveDeliveryRelationsLayer = (
  runId: RunId,
  target: TrackerTarget,
  gateway: AcceptedFactPublicationGatewayService,
  recovery: DeliveryRecoveryRelationSource
) => Layer.unwrap(makeReactiveDeliveryRelationsLayer(runId, target, gateway, recovery))
