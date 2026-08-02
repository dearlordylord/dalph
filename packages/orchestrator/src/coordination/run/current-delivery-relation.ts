import { Effect, Option, Ref, Schema } from "effect"
import type { TaskDagSnapshot } from "../../authorities/task-tracker/graph.js"
import type { OperationId } from "../../workflow/identity.js"
import type { RunControlPolicy } from "../../control/policy.js"
import { latestReconstructedTaskGraph } from "../reconstruction/graph-knowledge.js"
import {
  ReconstructedPauseState,
  ReconstructedRunPauseState,
  ReconstructedTaskPauseState,
  type ReconstructedRunState,
  WorkflowResponsibilityState
} from "../reconstruction/state.js"
import type { SyntheticWorkflowFact } from "./fresh-workflow-fact.js"
import type {
  AcceptedFactPublicationGatewayService,
  AcceptedFactPublicationState
} from "../delivery/accepted-fact-gateway.js"
import type { RunId } from "@dalph/contracts"
import type { JournalPosition } from "../../workflow-journal/identity.js"
import type {
  AcceptedFactPublicationError,
  InRunJournalRunMismatch,
  JournalRecord,
  JournalStoreError
} from "../../workflow-journal/store.js"
import { reduceWorkflowJournalHistory } from "../reconstruction/history.js"
import type { InvalidWorkflowJournalHistory } from "../reconstruction/history-result.js"

/** Accepted journal history does not yet contain a complete graph usable by a delivery turn. */
export class CurrentDeliveryGraphUnavailable extends Schema.TaggedErrorClass<CurrentDeliveryGraphUnavailable>()(
  "CurrentDeliveryGraphUnavailable",
  {}
) {}

/** Validated accepted history unexpectedly lacks the Run policy established by its beginning. */
export class CurrentDeliveryControlPolicyUnavailable extends Schema.TaggedErrorClass<CurrentDeliveryControlPolicyUnavailable>()(
  "CurrentDeliveryControlPolicyUnavailable",
  {}
) {}

/**
 * One immutable view used to decide a delivery-activation turn. Runtime
 * ownership, task positions, queues, wakeups, and fibers deliberately remain
 * outside this value.
 */
interface CurrentDeliveryFrameBase {
  readonly currentGraph: TaskDagSnapshot
  readonly currentGraphOperationId: OperationId
  readonly pause: ReconstructedRunState["pause"]
  readonly responsibility: ReconstructedRunState["responsibility"]
  readonly runControlPolicy: RunControlPolicy
}

export type CurrentDeliveryFrame = CurrentDeliveryFrameBase &
  (
    | {
        readonly _tag: "JournaledCurrentDeliveryFrame"
        readonly acceptedAt: JournalPosition
        readonly workflowHistory: ReconstructedRunState["workflowHistory"]
      }
    | { readonly _tag: "SyntheticCurrentDeliveryFrame"; readonly workflowFacts: ReadonlyArray<SyntheticWorkflowFact> }
  )

interface SyntheticCurrentDeliveryState {
  readonly _tag: "SyntheticCurrentDeliveryState"
  readonly currentGraph: TaskDagSnapshot
  readonly currentGraphOperationId: OperationId
  readonly workflowFacts: ReadonlyArray<SyntheticWorkflowFact>
}

export interface CurrentDeliveryRelation<E> {
  readonly read: Effect.Effect<CurrentDeliveryFrame, CurrentDeliveryGraphUnavailable | E>
}

export interface JournaledCurrentDeliveryRelation<E> extends CurrentDeliveryRelation<E> {
  readonly _tag: "JournaledCurrentDeliveryRelation"
}

export interface SyntheticCurrentDeliveryRelation<E> extends CurrentDeliveryRelation<E> {
  readonly _tag: "SyntheticCurrentDeliveryRelation"
  readonly acceptWorkflowFact: (fact: SyntheticWorkflowFact) => Effect.Effect<void>
  readonly acceptTrackerGraphObservation: (operationId: OperationId, snapshot: TaskDagSnapshot) => Effect.Effect<void>
}

const emptyPause = ReconstructedPauseState.make({
  run: ReconstructedRunPauseState.cases.RunUnpaused.make({}),
  tasks: ReconstructedTaskPauseState.cases.NoTaskPauses.make({})
})

const makeJournaledRelationFromAcceptedState = <E, F>(
  readAcceptedState: Effect.Effect<AcceptedFactPublicationState, F>,
  selectRunControlPolicy: (published: RunControlPolicy) => Effect.Effect<RunControlPolicy, E>
): JournaledCurrentDeliveryRelation<CurrentDeliveryControlPolicyUnavailable | E | F> => {
  const read = Effect.gen(function* () {
    const current = yield* readAcceptedState
    if (current.graph._tag === "GraphNotEstablished") return yield* new CurrentDeliveryGraphUnavailable()
    const currentGraph = Option.getOrUndefined(latestReconstructedTaskGraph(current.reconstructed.graphKnowledge))
    /* v8 ignore start -- Gateway GraphEstablished is projected from this exact reconstructed graph knowledge. */
    if (currentGraph === undefined) return yield* new CurrentDeliveryGraphUnavailable()
    /* v8 ignore stop */
    const currentGraphOperationId = current.reconstructed.graphKnowledge.taskTrackerFacts.findLast(
      (observation) =>
        observation._tag === "CompleteTaskTrackerFacts" || observation._tag === "UnchangedTaskTrackerFactsReconfirmed"
    )?.operationId
    /* v8 ignore start -- A latest reconstructed complete graph necessarily retains its originating accepted observation. */
    if (currentGraphOperationId === undefined) return yield* new CurrentDeliveryGraphUnavailable()
    /* v8 ignore stop */
    const publishedRunControlPolicy = Option.getOrUndefined(current.reconstructed.controlPolicy)
    /* v8 ignore start -- Bootstrap accepts only a Run history whose beginning establishes this policy. */
    if (publishedRunControlPolicy === undefined) return yield* new CurrentDeliveryControlPolicyUnavailable()
    /* v8 ignore stop */
    return {
      _tag: "JournaledCurrentDeliveryFrame",
      acceptedAt: current.appliedPosition,
      currentGraph,
      currentGraphOperationId,
      pause: current.reconstructed.pause,
      responsibility: current.reconstructed.responsibility,
      runControlPolicy: yield* selectRunControlPolicy(publishedRunControlPolicy),
      workflowHistory: current.reconstructed.workflowHistory
    } satisfies CurrentDeliveryFrame
  })
  return { _tag: "JournaledCurrentDeliveryRelation", read }
}

/** Reads one immutable frame from the gateway's latest already-published current value. */
export const makeJournaledCurrentDeliveryRelation = (
  gateway: AcceptedFactPublicationGatewayService
): JournaledCurrentDeliveryRelation<AcceptedFactPublicationError | CurrentDeliveryControlPolicyUnavailable> =>
  makeJournaledRelationFromAcceptedState(gateway.readCurrent, Effect.succeed)

/** Projects one already-coherent accepted snapshot without rereading its publication gateway. */
export const journaledCurrentDeliveryFrameOf = (
  accepted: AcceptedFactPublicationState
): Effect.Effect<CurrentDeliveryFrame, CurrentDeliveryControlPolicyUnavailable | CurrentDeliveryGraphUnavailable> =>
  makeJournaledRelationFromAcceptedState(Effect.succeed(accepted), Effect.succeed).read

/**
 * Temporary view for the scheduler deleted by #184. The gateway remains live;
 * fresh planning sees accepted state sampled at the old scheduler's successful
 * operation boundaries while recovery reads the live gateway-backed journal.
 */
export interface LegacySchedulerCurrentDeliveryCompatibility<E> {
  readonly afterGraphAccepted: Effect.Effect<void, AcceptedFactPublicationError>
  readonly afterOperationSucceeded: Effect.Effect<void, AcceptedFactPublicationError>
  readonly relation: JournaledCurrentDeliveryRelation<
    AcceptedFactPublicationError | CurrentDeliveryControlPolicyUnavailable | E
  >
}

export const makeLegacySchedulerCurrentDeliveryCompatibility = Effect.fn(
  "CurrentDeliveryRelation.makeLegacySchedulerCompatibility"
)(function* <E>(
  gateway: AcceptedFactPublicationGatewayService,
  readRunControlPolicy: Effect.Effect<RunControlPolicy, E>
) {
  const acceptedEpoch = yield* Ref.make(yield* gateway.readCurrent)
  const samplePublishedState = Effect.flatMap(gateway.readCurrent, (current) => Ref.set(acceptedEpoch, current))
  return {
    afterGraphAccepted: samplePublishedState,
    afterOperationSucceeded: samplePublishedState,
    relation: makeJournaledRelationFromAcceptedState(Ref.get(acceptedEpoch), () => readRunControlPolicy)
  } satisfies LegacySchedulerCurrentDeliveryCompatibility<E>
})

/**
 * Compatibility view for deterministic and authored harnesses that do not
 * install the production gateway. It owns no private cache: every read folds
 * the currently accepted in-Run prefix.
 */
export const makeLegacyJournaledCurrentDeliveryRelation = <E>(
  runId: RunId,
  readRunControlPolicy: Effect.Effect<RunControlPolicy, E>,
  journal: {
    readonly read: (
      runId: RunId
    ) => Effect.Effect<
      ReadonlyArray<JournalRecord>,
      AcceptedFactPublicationError | InRunJournalRunMismatch | JournalStoreError
    >
  }
): JournaledCurrentDeliveryRelation<
  AcceptedFactPublicationError | E | InRunJournalRunMismatch | InvalidWorkflowJournalHistory | JournalStoreError
> => ({
  _tag: "JournaledCurrentDeliveryRelation",
  read: Effect.gen(function* () {
    const runControlPolicy = yield* readRunControlPolicy
    const reduced = reduceWorkflowJournalHistory(runId, yield* journal.read(runId))
    if (reduced._tag === "InvalidWorkflowJournalHistory") return yield* Effect.fail(reduced)
    const currentGraph = Option.getOrUndefined(latestReconstructedTaskGraph(reduced.runState.graphKnowledge))
    if (currentGraph === undefined) return yield* new CurrentDeliveryGraphUnavailable()
    const acceptedAt = reduced.runState.appliedThrough
    /* v8 ignore start -- A complete accepted graph cannot exist before any accepted journal record. */
    if (acceptedAt === null) return yield* new CurrentDeliveryGraphUnavailable()
    /* v8 ignore stop */
    const currentGraphOperationId = reduced.runState.graphKnowledge.taskTrackerFacts.findLast(
      (observation) =>
        observation._tag === "CompleteTaskTrackerFacts" || observation._tag === "UnchangedTaskTrackerFactsReconfirmed"
    )?.operationId
    /* v8 ignore start -- A latest reconstructed complete graph necessarily retains its originating accepted observation. */
    if (currentGraphOperationId === undefined) return yield* new CurrentDeliveryGraphUnavailable()
    /* v8 ignore stop */
    return {
      _tag: "JournaledCurrentDeliveryFrame",
      acceptedAt,
      currentGraph,
      currentGraphOperationId,
      pause: reduced.runState.pause,
      responsibility: reduced.runState.responsibility,
      runControlPolicy,
      workflowHistory: reduced.runState.workflowHistory
    } satisfies CurrentDeliveryFrame
  })
})

/** Creates the non-durable relation used by dry-run and deterministic tests. */
export const makeSyntheticCurrentDeliveryRelation = Effect.fn("CurrentDeliveryRelation.makeSynthetic")(function* <E>(
  initialGraph: TaskDagSnapshot,
  initialGraphOperationId: OperationId,
  readRunControlPolicy: Effect.Effect<RunControlPolicy, E>
) {
  const state = yield* Ref.make<SyntheticCurrentDeliveryState>({
    _tag: "SyntheticCurrentDeliveryState",
    currentGraph: initialGraph,
    currentGraphOperationId: initialGraphOperationId,
    workflowFacts: []
  })
  const read = Effect.gen(function* () {
    const current = yield* Ref.get(state)
    return {
      _tag: "SyntheticCurrentDeliveryFrame",
      currentGraph: current.currentGraph,
      currentGraphOperationId: current.currentGraphOperationId,
      pause: emptyPause,
      responsibility: WorkflowResponsibilityState.make({ entries: [] }),
      runControlPolicy: yield* readRunControlPolicy,
      workflowFacts: current.workflowFacts
    } satisfies CurrentDeliveryFrame
  })
  return {
    _tag: "SyntheticCurrentDeliveryRelation" as const,
    acceptTrackerGraphObservation: (currentGraphOperationId: OperationId, currentGraph: TaskDagSnapshot) =>
      Ref.update(state, (current) => ({ ...current, currentGraph, currentGraphOperationId })),
    read,
    acceptWorkflowFact: (fact: SyntheticWorkflowFact) =>
      Ref.update(state, (current) => ({ ...current, workflowFacts: [...current.workflowFacts, fact] }))
  }
})
