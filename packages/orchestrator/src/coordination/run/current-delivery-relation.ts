import { Effect, Option, Ref, Schema } from "effect"
import type { TaskDagSnapshot } from "../../authorities/task-tracker/graph.js"
import type { RunId } from "@dalph/contracts"
import type { OperationId } from "../../workflow/identity.js"
import type { RunControlPolicy } from "../../control/policy.js"
import type { JournalRecord, JournalStoreError } from "../../workflow-journal/store.js"
import { latestReconstructedTaskGraph } from "../reconstruction/graph-knowledge.js"
import { reduceWorkflowJournalHistory } from "../reconstruction/history.js"
import {
  ReconstructedPauseState,
  ReconstructedRunPauseState,
  ReconstructedTaskPauseState,
  type ReconstructedRunState,
  WorkflowResponsibilityState
} from "../reconstruction/state.js"
import type { SyntheticWorkflowFact } from "./fresh-workflow-fact.js"

/** Accepted journal history does not yet contain a complete graph usable by a delivery turn. */
export class CurrentDeliveryGraphUnavailable extends Schema.TaggedErrorClass<CurrentDeliveryGraphUnavailable>()(
  "CurrentDeliveryGraphUnavailable",
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
        readonly workflowHistory: ReconstructedRunState["workflowHistory"]
      }
    | { readonly _tag: "SyntheticCurrentDeliveryFrame"; readonly workflowFacts: ReadonlyArray<SyntheticWorkflowFact> }
  )

interface JournaledCurrentDeliveryState {
  readonly _tag: "JournaledCurrentDeliveryState"
  readonly reconstructed: ReconstructedRunState
}

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
  readonly refreshAcceptedHistory: Effect.Effect<void, E>
}

export interface SyntheticCurrentDeliveryRelation<E> extends CurrentDeliveryRelation<E> {
  readonly _tag: "SyntheticCurrentDeliveryRelation"
  readonly acceptWorkflowFact: (fact: SyntheticWorkflowFact) => Effect.Effect<void>
  readonly acceptTrackerGraphObservation: (operationId: OperationId, snapshot: TaskDagSnapshot) => Effect.Effect<void>
}

/** Minimal durable-history boundary needed to reconstruct a delivery frame. */
export interface CurrentDeliveryJournalReader {
  readonly read: (runId: RunId) => Effect.Effect<ReadonlyArray<JournalRecord>, JournalStoreError>
}

const emptyPause = ReconstructedPauseState.make({
  run: ReconstructedRunPauseState.cases.RunUnpaused.make({}),
  tasks: ReconstructedTaskPauseState.cases.NoTaskPauses.make({})
})

/** Creates the live relation only after complete journal history has been validated. */
export const makeJournaledCurrentDeliveryRelation = Effect.fn("CurrentDeliveryRelation.makeJournaled")(function* <E>(
  runId: ReconstructedRunState["runId"],
  readRunControlPolicy: Effect.Effect<RunControlPolicy, E>,
  journal: CurrentDeliveryJournalReader
) {
  const readAcceptedState = Effect.gen(function* () {
    const reduction = reduceWorkflowJournalHistory(runId, yield* journal.read(runId))
    if (reduction._tag === "InvalidWorkflowJournalHistory") return yield* Effect.fail(reduction)
    return reduction.runState
  })
  const state = yield* Ref.make<JournaledCurrentDeliveryState>({
    _tag: "JournaledCurrentDeliveryState",
    reconstructed: yield* readAcceptedState
  })
  const refreshAcceptedHistory = readAcceptedState.pipe(
    Effect.flatMap((reconstructed) =>
      Ref.set(state, { _tag: "JournaledCurrentDeliveryState", reconstructed } satisfies JournaledCurrentDeliveryState)
    )
  )
  const read = Effect.gen(function* () {
    const current = yield* Ref.get(state)
    const currentGraph = Option.getOrUndefined(latestReconstructedTaskGraph(current.reconstructed.graphKnowledge))
    if (currentGraph === undefined) return yield* new CurrentDeliveryGraphUnavailable()
    const currentGraphOperationId = current.reconstructed.graphKnowledge.taskTrackerFacts.findLast(
      (observation) =>
        observation._tag === "CompleteTaskTrackerFacts" || observation._tag === "UnchangedTaskTrackerFactsReconfirmed"
    )?.operationId
    /* v8 ignore start -- A latest reconstructed complete graph necessarily retains its originating accepted observation. */
    if (currentGraphOperationId === undefined) return yield* new CurrentDeliveryGraphUnavailable()
    /* v8 ignore stop */
    return {
      _tag: "JournaledCurrentDeliveryFrame",
      currentGraph,
      currentGraphOperationId,
      pause: current.reconstructed.pause,
      responsibility: current.reconstructed.responsibility,
      runControlPolicy: yield* readRunControlPolicy,
      workflowHistory: current.reconstructed.workflowHistory
    } satisfies CurrentDeliveryFrame
  })
  return { _tag: "JournaledCurrentDeliveryRelation" as const, read, refreshAcceptedHistory }
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
