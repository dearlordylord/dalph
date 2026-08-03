import { RunId } from "@dalph/contracts"
import { Context, Effect, Layer, Option, PubSub, Schema, Semaphore, Stream, SubscriptionRef } from "effect"
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
import { TrackerGraphState, type CurrentSignal } from "./relations.js"
import {
  acceptedTrackerGraphObservationFromAcceptedReceipt,
  type AcceptedTrackerGraphObservation
} from "./accepted-graph-observation.js"
import { taskTrackerTargetKey, type TrackerTarget } from "../../authorities/task-tracker/target.js"
import type {
  CompleteTaskTrackerFactsObserved,
  TaskTrackerFactsObservedEvent,
  UnchangedTaskTrackerFactsReconfirmed
} from "../../workflow/task-tracker-facts/observation.js"

const lastElementOffset = -1

const AcceptedGraphReceiptTypeId: unique symbol = Symbol("AcceptedGraphReceipt")

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

type AcceptedGraphFacts = CompleteTaskTrackerFactsObserved | UnchangedTaskTrackerFactsReconfirmed
type AcceptedGraphEvent = TaskTrackerFactsObservedEvent & { readonly observation: AcceptedGraphFacts }
type AcceptedGraphJournalRecord = Pick<JournalRecord, "position"> & { readonly event: AcceptedGraphEvent }

/** One complete/reconfirmed event accepted by this gateway's configured target. */
interface AcceptedGraphReceipt {
  readonly [AcceptedGraphReceiptTypeId]: typeof AcceptedGraphReceiptTypeId
  readonly event: AcceptedGraphEvent
  readonly position: JournalPosition
  readonly snapshot: TaskDagSnapshot
}

const isAcceptedGraphEvent = (event: TaskTrackerFactsObservedEvent): event is AcceptedGraphEvent =>
  event.observation._tag === "CompleteTaskTrackerFacts" ||
  event.observation._tag === "UnchangedTaskTrackerFactsReconfirmed"

/** Mints a receipt only after this gateway has selected a complete/reconfirmed event. */
const acceptedGraphReceiptFromEvent = (input: {
  readonly event: AcceptedGraphEvent
  readonly position: JournalPosition
  readonly snapshot: TaskDagSnapshot
}): AcceptedGraphReceipt => ({
  [AcceptedGraphReceiptTypeId]: AcceptedGraphReceiptTypeId,
  event: input.event,
  position: input.position,
  snapshot: input.snapshot
})

const latestGraphObservationFrom = (
  records: ReadonlyArray<JournalRecord>,
  snapshot: TaskDagSnapshot,
  target: TrackerTarget
): Option.Option<AcceptedTrackerGraphObservation> => {
  let latest: AcceptedGraphJournalRecord | undefined
  const targetKey = taskTrackerTargetKey(target)
  for (const record of records) {
    if (record.event._tag !== "TaskTrackerFactsObserved") continue
    if (!isAcceptedGraphEvent(record.event)) continue
    if (taskTrackerTargetKey(record.event.observation.target) !== targetKey) continue
    latest = { event: record.event, position: record.position }
  }
  return Option.flatMap(Option.fromUndefinedOr(latest), ({ event, position }) =>
    acceptedTrackerGraphObservationFromAcceptedReceipt(
      acceptedGraphReceiptFromEvent({ event, position, snapshot }),
      ({ event, position, snapshot }) => ({ event, position, snapshot })
    )
  )
}

const graphStateFrom = (
  reconstructed: ReconstructedRunState,
  records: ReadonlyArray<JournalRecord>,
  target: TrackerTarget
): TrackerGraphState =>
  Option.match(latestReconstructedTaskGraph(reconstructed.graphKnowledge), {
    /* v8 ignore next -- A newly accepted complete/reconfirmed graph event necessarily reconstructs graph knowledge. */
    onNone: () => TrackerGraphState.cases.GraphNotEstablished.make({}),
    onSome: (graph) => {
      return Option.match(latestGraphObservationFrom(records, graph, target), {
        onNone: () => TrackerGraphState.cases.GraphNotEstablished.make({}),
        onSome: (observation) => TrackerGraphState.cases.GraphEstablished.make({ observation })
      })
    }
  })

const acceptedGraphWasPublished = (
  records: ReadonlyArray<JournalRecord>,
  after: JournalPosition,
  target: TrackerTarget
): boolean => {
  const targetKey = taskTrackerTargetKey(target)
  return records.some(
    ({ event, position }) =>
      position > after &&
      event._tag === "TaskTrackerFactsObserved" &&
      isAcceptedGraphEvent(event) &&
      taskTrackerTargetKey(event.observation.target) === targetKey
  )
}

const reduceAccepted = (
  runId: RunId,
  records: ReadonlyArray<JournalRecord>,
  prior: AcceptedFactPublicationState,
  target: TrackerTarget
):
  | AcceptedFactPublicationState
  | Extract<ReturnType<typeof reduceWorkflowJournalHistory>, { _tag: "InvalidWorkflowJournalHistory" }> => {
  const reduced = reduceWorkflowJournalHistory(runId, records)
  if (reduced._tag === "InvalidWorkflowJournalHistory") return reduced
  const appliedPosition = Option.getOrThrow(Option.fromUndefinedOr(records.at(lastElementOffset))).position
  const graph = acceptedGraphWasPublished(records, prior.appliedPosition, target)
    ? graphStateFrom(reduced.runState, records, target)
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
          const next = reduceAccepted(runId, records, before, target)
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
  return { current, journal, readCurrent } satisfies AcceptedFactPublicationGatewayService
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
          Context.add(InRunJournal, InRunJournal.of(gateway.journal))
        )
      )
    )
  )
