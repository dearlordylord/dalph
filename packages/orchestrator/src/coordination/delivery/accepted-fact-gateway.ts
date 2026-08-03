import { RunId } from "@dalph/contracts"
import { Context, Effect, Layer, Option, PubSub, Schema, Semaphore, Stream, SubscriptionRef } from "effect"
import * as Cause from "effect/Cause"
import { latestReconstructedTaskGraph } from "../reconstruction/graph-knowledge.js"
import type { TaskDagSnapshot } from "../../authorities/task-tracker/graph.js"
import { reduceWorkflowJournalHistory } from "../reconstruction/history.js"
import type { ValidWorkflowJournalHistory } from "../reconstruction/history-result.js"
import type { ReconstructedRunState } from "../reconstruction/state.js"
import { JournalPosition, type JournalRecordKey } from "../../workflow-journal/identity.js"
import type {
  AppendableWorkflowJournalEvent,
  AcceptedFactPublicationError,
  JournalAppendError,
  JournalRecord,
  JournalStorageAppendError
} from "../../workflow-journal/store.js"
import {
  AcceptedJournalHistoryInvalid,
  AcceptedJournalPositionGap,
  AcceptedJournalRecordMismatch,
  InRunJournal,
  InRunJournalRunMismatch
} from "../../workflow-journal/store.js"
import {
  mapCurrentSignal,
  TrackerGraphRelationError,
  TrackerGraphState,
  type CurrentSignal,
  type TrackerGraphActionProposal
} from "./relations.js"
import {
  acceptedTrackerGraphObservationFromRecord,
  type AcceptedTrackerGraphObservation
} from "./accepted-graph-observation.js"
import type { TrackerTarget } from "../../authorities/task-tracker/target.js"
import { trackerGraphReadProposalOf } from "./delivery-proposal.js"
import type { OperationId } from "../../workflow/identity.js"

const lastElementOffset = -1

/** Accepted gateway graph facts before policy/evidence are assembled into delivery publication. */
export interface AcceptedTrackerGraphRelationService {
  readonly proposedActions: CurrentSignal<ReadonlyArray<TrackerGraphActionProposal>, TrackerGraphRelationError>
  readonly signal: CurrentSignal<TrackerGraphState, TrackerGraphRelationError>
}

export class AcceptedTrackerGraphRelation extends Context.Service<
  AcceptedTrackerGraphRelation,
  AcceptedTrackerGraphRelationService
>()("@dalph/AcceptedTrackerGraphRelation") {}

/** The accepted journal prefix and its process-local projections at one exact position. */
export interface AcceptedFactPublicationState {
  readonly _tag: "AcceptedFactPublicationState"
  readonly appliedPosition: JournalPosition
  readonly graph: TrackerGraphState
  readonly reconstructed: ReconstructedRunState
  readonly records: ReadonlyArray<JournalRecord>
}

/** The raw persistence operations needed beneath the accepted-fact publication gateway. */
export interface AcceptedFactJournalStorage {
  readonly append: (
    runId: RunId,
    key: JournalRecordKey,
    event: AppendableWorkflowJournalEvent
  ) => Effect.Effect<JournalRecord, JournalStorageAppendError>
}

/** The only in-Run journal capability: accepted appends publish before returning. */
export interface PublishedRunJournal {
  readonly append: (
    runId: RunId,
    key: JournalRecordKey,
    event: AppendableWorkflowJournalEvent
  ) => Effect.Effect<JournalRecord, JournalAppendError>
  readonly read: (
    runId: RunId
  ) => Effect.Effect<ReadonlyArray<JournalRecord>, AcceptedFactPublicationError | InRunJournalRunMismatch>
}

export interface AcceptedFactPublicationGatewayService {
  readonly current: CurrentSignal<AcceptedFactPublicationState, AcceptedFactPublicationError>
  readonly journal: PublishedRunJournal
  readonly readCurrent: Effect.Effect<AcceptedFactPublicationState, AcceptedFactPublicationError>
  readonly trackerGraph: AcceptedTrackerGraphRelationService
}

export class AcceptedFactPublicationGateway extends Context.Service<
  AcceptedFactPublicationGateway,
  AcceptedFactPublicationGatewayService
>()("@dalph/AcceptedFactPublicationGateway") {}

/** Bootstrap supplied no matching begun Run prefix from which publication can start. */
export class AcceptedFactGatewayInitialHistoryInvalid extends Schema.TaggedErrorClass<AcceptedFactGatewayInitialHistoryInvalid>()(
  "AcceptedFactGatewayInitialHistoryInvalid",
  {
    historyRunId: RunId,
    reason: Schema.Literals(["EmptyHistory", "InvalidHistory", "MissingRunBeginning", "RunIdentityMismatch"]),
    requestedRunId: RunId
  }
) {}

type AcceptedFactPublicationStatus =
  | { readonly _tag: "PublicationOpen"; readonly value: AcceptedFactPublicationState }
  | { readonly _tag: "PublicationFailed"; readonly failure: AcceptedFactPublicationError }

const readOpenPublication = (
  status: AcceptedFactPublicationStatus
): Effect.Effect<AcceptedFactPublicationState, AcceptedFactPublicationError> =>
  status._tag === "PublicationOpen" ? Effect.succeed(status.value) : Effect.fail(status.failure)

const latestGraphObservationFrom = (
  records: ReadonlyArray<JournalRecord>,
  snapshot: TaskDagSnapshot
): AcceptedTrackerGraphObservation => {
  let latest: AcceptedTrackerGraphObservation | undefined
  for (const record of records) {
    if (record.event._tag !== "TaskTrackerFactsObserved") continue
    const observation = record.event.observation
    if (
      observation._tag !== "CompleteTaskTrackerFacts" &&
      observation._tag !== "UnchangedTaskTrackerFactsReconfirmed"
    ) {
      continue
    }
    latest = acceptedTrackerGraphObservationFromRecord({ event: record.event, position: record.position }, snapshot)
  }
  return Option.getOrThrow(Option.fromUndefinedOr(latest))
}

const graphStateFrom = (
  reconstructed: ReconstructedRunState,
  records: ReadonlyArray<JournalRecord>
): TrackerGraphState =>
  Option.match(latestReconstructedTaskGraph(reconstructed.graphKnowledge), {
    /* v8 ignore next -- A newly accepted complete/reconfirmed graph event necessarily reconstructs graph knowledge. */
    onNone: () => TrackerGraphState.cases.GraphNotEstablished.make({}),
    onSome: (graph) => {
      const observation = latestGraphObservationFrom(records, graph)
      return TrackerGraphState.cases.GraphEstablished.make({ observation })
    }
  })

const acceptedGraphWasPublished = (records: ReadonlyArray<JournalRecord>, after: JournalPosition): boolean =>
  records.some(
    ({ event, position }) =>
      position > after &&
      event._tag === "TaskTrackerFactsObserved" &&
      (event.observation._tag === "CompleteTaskTrackerFacts" ||
        event.observation._tag === "UnchangedTaskTrackerFactsReconfirmed")
  )

const reduceAccepted = (
  runId: RunId,
  records: ReadonlyArray<JournalRecord>,
  prior: AcceptedFactPublicationState
):
  | AcceptedFactPublicationState
  | Extract<ReturnType<typeof reduceWorkflowJournalHistory>, { _tag: "InvalidWorkflowJournalHistory" }> => {
  const reduced = reduceWorkflowJournalHistory(runId, records)
  if (reduced._tag === "InvalidWorkflowJournalHistory") return reduced
  const appliedPosition = Option.getOrThrow(Option.fromUndefinedOr(records.at(lastElementOffset))).position
  const graph = acceptedGraphWasPublished(records, prior.appliedPosition)
    ? graphStateFrom(reduced.runState, records)
    : prior.graph
  return { _tag: "AcceptedFactPublicationState", appliedPosition, graph, reconstructed: reduced.runState, records }
}

/**
 * Installs one current-first publication point after bootstrap has validated a
 * complete Run history. Reconstructed graph knowledge stays unusable until a
 * later complete graph observation is accepted through this gateway.
 */
export const makeAcceptedFactPublicationGateway = Effect.fn("AcceptedFacts.makeGateway")(function* (
  runId: RunId,
  target: TrackerTarget,
  initial: ValidWorkflowJournalHistory,
  storage: AcceptedFactJournalStorage
) {
  const first = initial.records.at(0)
  const last = initial.records.at(lastElementOffset)
  if (first === undefined || last === undefined) {
    return yield* new AcceptedFactGatewayInitialHistoryInvalid({
      historyRunId: initial.runId,
      reason: "EmptyHistory",
      requestedRunId: runId
    })
  }
  if (initial.runId !== runId || first.runId !== runId) {
    return yield* new AcceptedFactGatewayInitialHistoryInvalid({
      historyRunId: initial.runId,
      reason: "RunIdentityMismatch",
      requestedRunId: runId
    })
  }
  if (first.event._tag !== "WorkflowRunBegan") {
    return yield* new AcceptedFactGatewayInitialHistoryInvalid({
      historyRunId: initial.runId,
      reason: "MissingRunBeginning",
      requestedRunId: runId
    })
  }
  const validated = reduceWorkflowJournalHistory(runId, initial.records)
  if (validated._tag === "InvalidWorkflowJournalHistory") {
    return yield* new AcceptedFactGatewayInitialHistoryInvalid({
      historyRunId: initial.runId,
      reason: "InvalidHistory",
      requestedRunId: runId
    })
  }
  const initialPosition = last.position
  const state = yield* SubscriptionRef.make<AcceptedFactPublicationStatus>({
    _tag: "PublicationOpen",
    value: {
      _tag: "AcceptedFactPublicationState",
      appliedPosition: initialPosition,
      graph: TrackerGraphState.cases.GraphNotEstablished.make({}),
      reconstructed: validated.runState,
      records: validated.records
    }
  })
  yield* Effect.addFinalizer(() => PubSub.shutdown(state.pubsub))
  const publication = yield* Semaphore.make(1)
  const readCurrent = SubscriptionRef.get(state).pipe(Effect.flatMap(readOpenPublication))
  const current: CurrentSignal<AcceptedFactPublicationState, AcceptedFactPublicationError> = {
    changes: SubscriptionRef.changes(state).pipe(
      Stream.mapEffect((published) =>
        SubscriptionRef.get(state).pipe(
          Effect.flatMap((latest) =>
            latest._tag === "PublicationFailed" ? Effect.fail(latest.failure) : readOpenPublication(published)
          )
        )
      )
    )
  }
  const failPublication = (failure: AcceptedFactPublicationError) =>
    SubscriptionRef.set(state, { _tag: "PublicationFailed", failure }).pipe(Effect.andThen(Effect.fail(failure)))
  const append = (run: RunId, key: JournalRecordKey, event: AppendableWorkflowJournalEvent) =>
    publication.withPermit(
      Effect.uninterruptible(
        Effect.gen(function* () {
          if (run !== runId) return yield* new InRunJournalRunMismatch({ expectedRunId: runId, requestedRunId: run })
          const status = yield* SubscriptionRef.get(state)
          if (status._tag === "PublicationFailed") return yield* status.failure
          const accepted = yield* storage.append(run, key, event)
          const before = status.value
          if (accepted.position <= before.appliedPosition) {
            const existing = before.records.find(({ position }) => position === accepted.position)
            if (JSON.stringify(existing) !== JSON.stringify(accepted)) {
              const failure = new AcceptedJournalRecordMismatch({ acceptedPosition: accepted.position, key, runId })
              return yield* failPublication(failure)
            }
            return accepted
          }
          const expectedPosition = JournalPosition.make(before.appliedPosition + 1)
          if (accepted.position !== expectedPosition) {
            const failure = new AcceptedJournalPositionGap({
              acceptedPosition: accepted.position,
              expectedPosition,
              runId
            })
            return yield* failPublication(failure)
          }
          const records = [...before.records, accepted]
          const next = reduceAccepted(runId, records, before)
          if (next._tag === "InvalidWorkflowJournalHistory") {
            const failure = new AcceptedJournalHistoryInvalid({
              acceptedPosition: accepted.position,
              detail: JSON.stringify(next.issues),
              runId
            })
            return yield* failPublication(failure)
          }
          yield* SubscriptionRef.set(state, { _tag: "PublicationOpen", value: next })
          return accepted
        })
      )
    )
  const journal: PublishedRunJournal = {
    append,
    read: (requestedRunId) =>
      requestedRunId === runId
        ? readCurrent.pipe(Effect.map(({ records }) => records))
        : Effect.fail(new InRunJournalRunMismatch({ expectedRunId: runId, requestedRunId }))
  }
  const graphCurrent: CurrentSignal<AcceptedFactPublicationState, TrackerGraphRelationError> = {
    changes: current.changes.pipe(
      Stream.mapError(
        (failure) =>
          new TrackerGraphRelationError({
            cause: Cause.fail(failure),
            summary: `${failure._tag} stopped accepted-fact publication`
          })
      )
    )
  }
  const graphSignal: CurrentSignal<TrackerGraphState, TrackerGraphRelationError> = {
    changes: mapCurrentSignal(graphCurrent, ({ graph }) => graph).changes.pipe(
      Stream.mapAccum<OperationId | undefined, TrackerGraphState, TrackerGraphState>(
        () => undefined,
        (lastOperationId, graph): readonly [OperationId | undefined, ReadonlyArray<TrackerGraphState>] => {
          if (graph._tag !== "GraphEstablished") return [undefined, [graph]] as const
          if (lastOperationId === graph.observation.operationId) return [lastOperationId, []] as const
          return [graph.observation.operationId, [graph]] as const
        }
      )
    )
  }
  const trackerGraph: AcceptedTrackerGraphRelationService = {
    proposedActions: mapCurrentSignal(graphCurrent, ({ appliedPosition, graph }) =>
      graph._tag === "GraphNotEstablished"
        ? [trackerGraphReadProposalOf({ acceptedAt: appliedPosition, purpose: "EstablishCurrentGraph", runId, target })]
        : ([] satisfies ReadonlyArray<TrackerGraphActionProposal>)
    ),
    signal: graphSignal
  }
  return { current, journal, readCurrent, trackerGraph } satisfies AcceptedFactPublicationGatewayService
})

/** Installs the one gateway and exposes only its in-Run and descriptive capabilities. */
export const acceptedFactPublicationGatewayLayer = (
  runId: RunId,
  target: TrackerTarget,
  initial: ValidWorkflowJournalHistory,
  storage: AcceptedFactJournalStorage
) =>
  Layer.effectContext(
    makeAcceptedFactPublicationGateway(runId, target, initial, storage).pipe(
      Effect.map((gateway) =>
        Context.empty().pipe(
          Context.add(AcceptedFactPublicationGateway, gateway),
          Context.add(InRunJournal, InRunJournal.of(gateway.journal)),
          Context.add(AcceptedTrackerGraphRelation, gateway.trackerGraph)
        )
      )
    )
  )
