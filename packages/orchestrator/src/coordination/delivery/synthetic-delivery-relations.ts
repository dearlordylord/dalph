import {
  plannedAttemptExecutorCorrelation,
  type PlannedAttemptExecutorCorrelation,
  type RunId,
  type TaskId
} from "@dalph/contracts"
import { Context, Effect, Layer, Ref, Semaphore, Stream, SubscriptionRef } from "effect"
import * as Cause from "effect/Cause"
import type { TrackerTarget } from "../../authorities/task-tracker/target.js"
import { initialRunPolicyRevision, RunControlPolicy, type InitialControlPolicy } from "../../control/policy.js"
import { deriveFreshWorkflowDecisions } from "../run/fresh-workflow.js"
import type { FreshWorkflowActionFact } from "../run/fresh-workflow-fact.js"
import { PlannedAttemptExecutorReportOrdinal } from "../../workflow/protocols/planned-attempt-executor-work/events.js"
import {
  plannedAttemptExecutorContinuationDisposition,
  PlannedAttemptExecutorContinuationLimitReached
} from "../../workflow/protocols/planned-attempt-executor-work/protocol.js"
import type { CurrentDeliveryFrame } from "../run/current-delivery-frame.js"
import {
  ReconstructedPauseState,
  ReconstructedRunPauseState,
  ReconstructedTaskPauseState,
  WorkflowResponsibilityState
} from "../reconstruction/state.js"
import { ticketDeliveryEvidenceOf } from "./delivery-evidence.js"
import { deliveryProposalsOf, trackerGraphReadProposalOf } from "./delivery-proposal.js"
import type { DeliveryActionResult } from "./delivery-action-executor.js"
import { makeDeliveryRelationsLayer } from "./in-memory-relations.js"
import { DeliveryAcceptedFactPublication } from "./delivery-accepted-fact-publication.js"
import { Journal, type JournalService } from "./journal.js"
import {
  type DeliveryRelationInputBundle,
  type CurrentSignal,
  DeliveryRelationReconciliationError,
  type DeliveryRelationSourceError,
  type DeliveryRuntimeFacts,
  type TrackerGraphState as TrackerGraphStateType
} from "./relations.js"

interface SyntheticDeliveryState {
  readonly facts: ReadonlyArray<FreshWorkflowActionFact>
  readonly graph: TrackerGraphStateType
}

type SyntheticDeliveryBundle = DeliveryRelationInputBundle
type SyntheticDeliveryFailure = Effect.Error<JournalService["state"]["get"]>

type SyntheticDeliveryStatus =
  | { readonly _tag: "SyntheticDeliveryOpen"; readonly bundle: SyntheticDeliveryBundle }
  | { readonly _tag: "SyntheticDeliveryFailed"; readonly cause: Cause.Cause<SyntheticDeliveryFailure> }

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
  result: Exclude<DeliveryActionResult, { readonly _tag: "ActionCompleted" | "IntegrationCandidateAdvanced" }>
): SyntheticDeliveryState => {
  switch (result._tag) {
    case "TrackerGraphObservationPublished":
      return current
    case "FreshWorkflowActionFactProduced":
      return { ...current, facts: [...current.facts, result.fact] }
    case "ExecutorReportPublished":
      const ordinal = PlannedAttemptExecutorReportOrdinal.make(
        current.facts.filter(
          (fact) =>
            fact._tag === "PlannedAttemptExecutorWorkReported" &&
            fact.plannedAttempt.attemptId === result.plannedAttempt.attemptId
        ).length + 1
      )
      return {
        ...current,
        facts: [
          ...current.facts,
          {
            _tag: "PlannedAttemptExecutorWorkReported",
            ordinal,
            plannedAttempt: result.plannedAttempt,
            report: result.report,
            taskId: result.plannedAttempt.taskId
          }
        ]
      }
  }
}

/** Controlled accepted-fact publication used by the synthetic interpreter, never by the runtime. */
export interface SyntheticDeliveryAcceptedFactsService {
  readonly authorizeExecutorContinuation: (
    correlation: PlannedAttemptExecutorCorrelation
  ) => Effect.Effect<void, PlannedAttemptExecutorContinuationLimitReached>
  readonly publish: (result: DeliveryActionResult) => Effect.Effect<void>
}

export class SyntheticDeliveryAcceptedFacts extends Context.Service<
  SyntheticDeliveryAcceptedFacts,
  SyntheticDeliveryAcceptedFactsService
>()("@dalph/SyntheticDeliveryAcceptedFacts") {}

/**
 * Supplies the same flat delivery algebra with process-local journal state.
 * Synthetic executor facts remain process-local; graph observations cross the
 * ordinary journal boundary before they enter the public delivery.
 */
export const makeSyntheticDeliveryRelations = Effect.fn("DeliveryRelations.makeSynthetic")(function* (
  runId: RunId,
  target: TrackerTarget,
  initialControlPolicy: InitialControlPolicy
) {
  const policy = RunControlPolicy.make({
    revision: initialRunPolicyRevision,
    taskExecutionCapacity: initialControlPolicy.taskExecutionCapacity
  })
  const journal = yield* Journal
  const initialJournal = yield* journal.state.get
  const source = yield* Ref.make<SyntheticDeliveryState>({ facts: [], graph: initialJournal.graph })

  const deriveBundle = (current: SyntheticDeliveryState) => {
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
          acceptedAt: current.graph._tag === "GraphEstablished" ? current.graph.observation.recordedAt : null,
          quiescence: { _tag: "TrackerReconfirmationAllowed" },
          taskWork: { capacity: policy.taskExecutionCapacity, held: activeSyntheticAttempts(current.facts) }
        },
        trackerGraphProposals:
          current.graph._tag === "GraphNotEstablished"
            ? [trackerGraphReadProposalOf({ acceptedAt: null, purpose: "EstablishCurrentGraph", runId, target })]
            : []
      },
      publication: {
        exactEvidence: frame === undefined ? [] : ticketDeliveryEvidenceOf(frame, []),
        graph: current.graph,
        policy
      }
    } satisfies SyntheticDeliveryBundle
  }

  const state = yield* SubscriptionRef.make<SyntheticDeliveryStatus>({
    _tag: "SyntheticDeliveryOpen",
    bundle: deriveBundle(yield* Ref.get(source))
  })
  const gate = yield* Semaphore.make(1)
  const publish = () =>
    gate.withPermit(
      Effect.gen(function* () {
        yield* SubscriptionRef.set(state, {
          _tag: "SyntheticDeliveryOpen",
          bundle: deriveBundle(yield* Ref.get(source))
        })
      })
    )
  const publishFailure = (failure: SyntheticDeliveryFailure) =>
    gate.withPermit(SubscriptionRef.set(state, { _tag: "SyntheticDeliveryFailed", cause: Cause.fail(failure) }))
  const acceptedFacts = SyntheticDeliveryAcceptedFacts.of({
    authorizeExecutorContinuation: Effect.fn("SyntheticDeliveryAcceptedFacts.authorizeExecutorContinuation")(
      function* (correlation) {
        const reports = (yield* Ref.get(source)).facts.flatMap((fact) =>
          fact._tag === "PlannedAttemptExecutorWorkReported" ? [fact.report] : []
        )
        const disposition = plannedAttemptExecutorContinuationDisposition(correlation, reports)
        if (disposition._tag === "ExecutorContinuationLimitReached") {
          return yield* new PlannedAttemptExecutorContinuationLimitReached({ correlation, limit: disposition.limit })
        }
      }
    ),
    publish: Effect.fn("SyntheticDeliveryAcceptedFacts.publish")(function* (result) {
      if (result._tag === "ActionCompleted" || result._tag === "IntegrationCandidateAdvanced") return
      const journalState = yield* journal.state.get.pipe(
        Effect.matchEffect({
          onFailure: (failure) => publishFailure(failure).pipe(Effect.as(null)),
          onSuccess: (current) => Effect.succeed(current)
        })
      )
      if (journalState === null) return
      yield* Ref.update(source, (current) => {
        const next = applySyntheticProposalResult(current, result)
        return { ...next, graph: journalState.graph }
      })
      yield* publish()
    })
  })

  const signal = <A>(
    project: (bundle: SyntheticDeliveryBundle) => A
  ): CurrentSignal<A, DeliveryRelationSourceError> => ({
    get: Effect.gen(function* () {
      const status = yield* SubscriptionRef.get(state)
      if (status._tag === "SyntheticDeliveryFailed") {
        return yield* new DeliveryRelationReconciliationError({ cause: status.cause })
      }
      const [currentJournal, current] = yield* Effect.all([journal.state.get, Ref.get(source)]).pipe(
        Effect.mapError((failure) => new DeliveryRelationReconciliationError({ cause: Cause.fail(failure) }))
      )
      return project(deriveBundle({ ...current, graph: currentJournal.graph }))
    }),
    changes: SubscriptionRef.changes(state).pipe(
      Stream.mapEffect((status) =>
        status._tag === "SyntheticDeliveryOpen"
          ? Effect.succeed(project(status.bundle))
          : Effect.fail(new DeliveryRelationReconciliationError({ cause: status.cause }))
      )
    )
  })
  const relations = makeDeliveryRelationsLayer({
    publicationConsistency: { withStablePublication: (effect) => gate.withPermit(effect) },
    coherent: signal((bundle) => bundle)
  })
  return {
    acceptedFacts,
    layer: Layer.mergeAll(
      relations,
      Layer.succeed(SyntheticDeliveryAcceptedFacts, acceptedFacts),
      Layer.succeed(DeliveryAcceptedFactPublication, DeliveryAcceptedFactPublication.of({ awaitCurrent: Effect.void }))
    )
  }
})

export const makeSyntheticDeliveryRelationsLayer = Effect.fn("DeliveryRelations.makeSyntheticLayer")(function* (
  runId: RunId,
  target: TrackerTarget,
  initialControlPolicy: InitialControlPolicy
) {
  return (yield* makeSyntheticDeliveryRelations(runId, target, initialControlPolicy)).layer
})
