import { plannedAttemptExecutorCorrelation, type RunId, type TaskId } from "@dalph/contracts"
import { Effect, Ref, Semaphore, Stream, SubscriptionRef } from "effect"
import type { TrackerTarget } from "../../authorities/task-tracker/target.js"
import { initialRunPolicyRevision, RunControlPolicy, type InitialControlPolicy } from "../../control/policy.js"
import type { OperationId } from "../../workflow/identity.js"
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
import {
  DeliveryRelationRevision,
  TrackerGraphState,
  type CurrentSignal,
  type DeliveryInvalidation,
  type DeliveryRuntimeFacts,
  type TicketDeliveryEvidence,
  type TrackerGraphActionProposal,
  type TrackerGraphState as TrackerGraphStateType
} from "./relations.js"

interface SyntheticDeliveryState {
  readonly facts: ReadonlyArray<FreshWorkflowActionFact>
  readonly graph: TrackerGraphStateType
  readonly graphOperationId: OperationId | null
  readonly probe: TrackerGraphActionProposal | null
}

interface SyntheticDeliveryBundle {
  readonly exactEvidence: ReadonlyArray<TicketDeliveryEvidence>
  readonly graph: TrackerGraphStateType
  readonly policy: RunControlPolicy
  readonly proposalContributions: ReturnType<typeof deliveryProposalsOf>
  readonly runtimeFacts: DeliveryRuntimeFacts
  readonly trackerGraphProposals: ReadonlyArray<TrackerGraphActionProposal>
}

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
      return {
        ...current,
        graph: TrackerGraphState.cases.GraphEstablished.make({ snapshot: result.snapshot }),
        graphOperationId: result.operationId
      }
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
 * Synthetic facts advance dry/test projections but never enter the journal or
 * claim authority beyond this scoped runtime.
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
  const source = yield* Ref.make<SyntheticDeliveryState>({
    facts: [],
    graph: TrackerGraphState.cases.GraphNotEstablished.make({}),
    graphOperationId: null,
    probe: null
  })
  const revision = yield* Ref.make(DeliveryRelationRevision.make(0))

  const deriveBundle = (current: SyntheticDeliveryState, currentRevision: DeliveryRelationRevision) => {
    const frame: CurrentDeliveryFrame | undefined =
      current.graph._tag === "GraphEstablished" && current.graphOperationId !== null
        ? {
            _tag: "SyntheticCurrentDeliveryFrame",
            currentGraph: current.graph.snapshot,
            currentGraphOperationId: current.graphOperationId,
            pause: emptyPause,
            responsibility: emptyResponsibilities,
            runControlPolicy: policy,
            workflowFacts: current.facts
          }
        : undefined
    const fresh = frame === undefined ? [] : deriveFreshWorkflowDecisions(frame)
    return {
      exactEvidence: frame === undefined ? [] : ticketDeliveryEvidenceOf(frame, []),
      graph: current.graph,
      policy,
      proposalContributions: deliveryProposalsOf({
        acceptedAt: null,
        acceptedOperationIds: new Set(),
        fresh,
        runId,
        transitions: fresh.map(({ transition }) => transition)
      }),
      runtimeFacts: {
        acceptedAt: null,
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
      yield* Ref.update(source, (current) => {
        const next = applySyntheticProposalResult(current, cause.result)
        return next.probe?.id === cause.proposalId ? { ...next, probe: null } : next
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
    exactEvidence: signal(({ exactEvidence }) => exactEvidence),
    graph: signal(({ graph }) => graph),
    invalidate,
    policy: signal(({ policy }) => policy),
    proposalContributions: signal(({ proposalContributions }) => proposalContributions),
    runtimeFacts: signal(({ runtimeFacts }) => runtimeFacts),
    trackerGraphProposals: signal(({ trackerGraphProposals }) => trackerGraphProposals)
  })
})
