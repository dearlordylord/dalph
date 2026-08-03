import { plannedAttemptExecutorCorrelation, type RunId, type TaskId } from "@dalph/contracts"
import { Effect, Ref, Semaphore, Stream, SubscriptionRef } from "effect"
import type { TrackerTarget } from "../../authorities/task-tracker/target.js"
import { initialRunPolicyRevision, RunControlPolicy, type InitialControlPolicy } from "../../control/policy.js"
import { deriveFreshWorkflowDecisions } from "../run/fresh-workflow.js"
import type { FreshWorkflowActionFact } from "../run/fresh-workflow-fact.js"
import type { CurrentDeliveryFrame } from "../run/current-delivery-frame.js"
import {
  ReconstructedPauseState,
  ReconstructedRunPauseState,
  ReconstructedTaskPauseState,
  WorkflowResponsibilityState
} from "../reconstruction/state.js"
import { ticketDeliveryEvidenceOf } from "./delivery-evidence.js"
import { deliveryProposalsOf, trackerGraphReadProposalOf } from "./delivery-proposal.js"
import { makeDeliveryRelationsLayer } from "./in-memory-relations.js"
import { AcceptedFactPublicationGateway } from "./accepted-fact-gateway.js"
import {
  DeliveryRelationRevision,
  type DeliveryRelationInputBundle,
  type CurrentSignal,
  type DeliveryInvalidation,
  type DeliveryRuntimeFacts,
  type TrackerGraphActionProposal,
  type TrackerGraphState as TrackerGraphStateType
} from "./relations.js"

interface SyntheticDeliveryState {
  readonly facts: ReadonlyArray<FreshWorkflowActionFact>
  readonly graph: TrackerGraphStateType
  readonly probe: TrackerGraphActionProposal | null
}

type SyntheticDeliveryBundle = DeliveryRelationInputBundle

const emptyPause = ReconstructedPauseState.make({
  run: ReconstructedRunPauseState.cases.RunUnpaused.make({}),
  tasks: ReconstructedTaskPauseState.cases.NoTaskPauses.make({})
})

const emptyResponsibilities = WorkflowResponsibilityState.make({ entries: [] })

const activeSyntheticAttempts = (
  facts: ReadonlyArray<FreshWorkflowActionFact>
): DeliveryRuntimeFacts["taskWork"]["held"] => {
  const latest = new Map<
    TaskId,
    Extract<FreshWorkflowActionFact, { readonly _tag: "PlannedAttemptExecutorWorkReported" }>
  >()
  for (const fact of facts) {
    if (fact._tag === "PlannedAttemptExecutorWorkReported") latest.set(fact.taskId, fact)
  }
  return [...latest.values()].flatMap(({ plannedAttempt, report, taskId }) =>
    report._tag === "Running" ? [{ correlation: plannedAttemptExecutorCorrelation(plannedAttempt), taskId }] : []
  )
}

const applySyntheticProposalResult = (
  current: SyntheticDeliveryState,
  result: Extract<DeliveryInvalidation, { readonly _tag: "ProposalCompleted" }>["result"]
): SyntheticDeliveryState => {
  switch (result?._tag) {
    case "TrackerGraphObservationPublished":
      return current
    case "FreshWorkflowActionFactProduced":
      return { ...current, facts: [...current.facts, result.fact] }
    case "ExecutorReportPublished":
      return {
        ...current,
        facts: [
          ...current.facts,
          {
            _tag: "PlannedAttemptExecutorWorkReported",
            plannedAttempt: result.plannedAttempt,
            report: result.report,
            taskId: result.plannedAttempt.taskId
          }
        ]
      }
    case "ActionCompleted":
    case "IntegrationCandidateAdvanced":
    case undefined:
      return current
  }
}

/**
 * Supplies the same flat delivery algebra with process-local accepted facts.
 * Synthetic executor facts remain process-local; graph observations cross the
 * ordinary accepted journal boundary before they enter the public delivery.
 */
export const makeSyntheticDeliveryRelationsLayer = Effect.fn("DeliveryRelations.makeSyntheticLayer")(function* (
  runId: RunId,
  target: TrackerTarget,
  initialControlPolicy: InitialControlPolicy
) {
  const policy = RunControlPolicy.make({
    revision: initialRunPolicyRevision,
    taskExecutionCapacity: initialControlPolicy.taskExecutionCapacity
  })
  const gateway = yield* AcceptedFactPublicationGateway
  const initialAccepted = yield* gateway.readCurrent
  const source = yield* Ref.make<SyntheticDeliveryState>({ facts: [], graph: initialAccepted.graph, probe: null })
  const revision = yield* Ref.make(DeliveryRelationRevision.make(0))

  const deriveBundle = (current: SyntheticDeliveryState, currentRevision: DeliveryRelationRevision) => {
    const frame: CurrentDeliveryFrame | undefined =
      current.graph._tag === "GraphEstablished"
        ? {
            _tag: "SyntheticCurrentDeliveryFrame",
            currentGraph: current.graph.observation.snapshot,
            currentGraphOperationId: current.graph.observation.operationId,
            pause: emptyPause,
            responsibility: emptyResponsibilities,
            runControlPolicy: policy,
            workflowFacts: current.facts
          }
        : undefined
    const fresh = frame === undefined ? [] : deriveFreshWorkflowDecisions(frame)
    return {
      legacy: {
        proposalContributions: deliveryProposalsOf({
          acceptedAt: null,
          acceptedOperationIds: new Set(),
          fresh,
          runId,
          transitions: fresh.map(({ transition }) => transition)
        }),
        reflectionProposals: [],
        runtimeFacts: {
          acceptedAt: current.graph._tag === "GraphEstablished" ? current.graph.observation.acceptedAt : null,
          quiescence: { _tag: "QuiescenceProbeAllowed" },
          revision: currentRevision,
          taskWork: { capacity: policy.taskExecutionCapacity, held: activeSyntheticAttempts(current.facts) }
        },
        trackerGraphProposals:
          current.graph._tag === "GraphNotEstablished"
            ? [trackerGraphReadProposalOf({ acceptedAt: null, purpose: "EstablishCurrentGraph", runId, target })]
            : current.probe === null
              ? []
              : [current.probe]
      },
      publication: {
        exactEvidence: frame === undefined ? [] : ticketDeliveryEvidenceOf(frame, []),
        graph: current.graph,
        policy
      }
    } satisfies SyntheticDeliveryBundle
  }

  const state = yield* SubscriptionRef.make(deriveBundle(yield* Ref.get(source), yield* Ref.get(revision)))
  const gate = yield* Semaphore.make(1)
  const publish = gate.withPermit(
    Effect.gen(function* () {
      const nextRevision = yield* Ref.updateAndGet(revision, (value) => DeliveryRelationRevision.make(value + 1))
      yield* SubscriptionRef.set(state, deriveBundle(yield* Ref.get(source), nextRevision))
      return nextRevision
    })
  )
  const invalidate = Effect.fn("DeliveryRelations.invalidateSynthetic")(function* (cause: DeliveryInvalidation) {
    if (cause._tag === "QuiescenceProbeRequested") {
      yield* Ref.update(source, (current) =>
        current.probe !== null
          ? current
          : {
              ...current,
              probe: trackerGraphReadProposalOf({ acceptedAt: null, purpose: "QuiescenceProbe", runId, target })
            }
      )
    }
    if (cause._tag === "ProposalCompleted") {
      const accepted = yield* gateway.readCurrent.pipe(Effect.orDie)
      yield* Ref.update(source, (current) => {
        const next = applySyntheticProposalResult(current, cause.result)
        const withGraph = { ...next, graph: accepted.graph }
        return withGraph.probe?.id === cause.proposalId ? { ...withGraph, probe: null } : withGraph
      })
    }
    return yield* publish
  })

  const signal = <A>(project: (bundle: SyntheticDeliveryBundle) => A): CurrentSignal<A> => ({
    changes: SubscriptionRef.changes(state).pipe(Stream.map(project))
  })
  return makeDeliveryRelationsLayer({
    evaluationConsistency: {
      currentRevision: Ref.get(revision),
      withStableRevision: (effect) => gate.withPermit(effect)
    },
    invalidate,
    proposalContributions: signal(({ legacy }) => legacy.proposalContributions),
    runtimeFacts: signal(({ legacy }) => legacy.runtimeFacts),
    trackerGraphProposals: signal(({ legacy }) => legacy.trackerGraphProposals),
    coherent: signal((bundle) => bundle)
  })
})
