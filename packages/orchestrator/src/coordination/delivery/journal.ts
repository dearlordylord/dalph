import { RunId } from "@dalph/contracts"
import { Context, Effect, Layer, Option, PubSub, Schema, Semaphore, Stream, SubscriptionRef } from "effect"
import { reconstructedTaskGraphFor } from "../reconstruction/graph-knowledge.js"
import type { TaskDagSnapshot } from "../../authorities/task-tracker/graph.js"
import { advanceWorkflowJournalHistory, reduceWorkflowJournalHistory } from "../reconstruction/history.js"
import type { ValidWorkflowJournalHistory } from "../reconstruction/history-result.js"
import type { ReconstructedRunState } from "../reconstruction/state.js"
import { JournalPosition, type JournalRecordKey } from "../../workflow-journal/identity.js"
import type {
  AppendableWorkflowJournalEvent,
  JournalError,
  JournalAppendError,
  JournalRecord,
  JournalStorageAppendError
} from "../../workflow-journal/store.js"
import {
  JournalHistoryInvalid,
  JournalPositionGap,
  JournalRecordMismatch,
  InRunJournal,
  InRunJournalRunMismatch
} from "../../workflow-journal/store.js"
import { currentSignalFromCurrentFirstStream, TrackerGraphState, type CurrentSignal } from "./relations.js"
import {
  journaledGraphObservationFieldsFromReceipt,
  type JournaledGraphObservationFields
} from "./journaled-graph-observation.js"
import { taskTrackerTargetKey, type TrackerTarget } from "../../authorities/task-tracker/target.js"
import type {
  CompleteTaskTrackerFactsObserved,
  TaskTrackerFactsObservedEvent,
  UnchangedTaskTrackerFactsReconfirmed
} from "../../workflow/task-tracker-facts/observation.js"

const lastElementOffset = -1

const JournaledGraphReceiptTypeId: unique symbol = Symbol("JournaledGraphReceipt")
const JournaledTrackerGraphObservationTypeId: unique symbol = Symbol("JournaledTrackerGraphObservation")

/** Journaled graph observation evidence is privately branded inside this journal boundary. */
export interface JournaledTrackerGraphObservation extends JournaledGraphObservationFields {
  readonly [JournaledTrackerGraphObservationTypeId]: typeof JournaledTrackerGraphObservationTypeId
}

/** The journal prefix and its process-local projections at one exact position. */
export interface JournalState {
  readonly _tag: "JournalState"
  readonly position: JournalPosition
  readonly graph: TrackerGraphState
  readonly reconstructed: ReconstructedRunState
  readonly records: ReadonlyArray<JournalRecord>
}

/** The raw append operation needed beneath the journal state service. */
export interface JournalStorageAppend {
  readonly append: (
    runId: RunId,
    key: JournalRecordKey,
    event: AppendableWorkflowJournalEvent
  ) => Effect.Effect<JournalRecord, JournalStorageAppendError>
}

/** The journal state plus the direct in-Run append/read operations it exposes. */
export interface JournalService {
  readonly state: CurrentSignal<JournalState, JournalError>
  readonly append: (
    runId: RunId,
    key: JournalRecordKey,
    event: AppendableWorkflowJournalEvent
  ) => Effect.Effect<JournalRecord, JournalAppendError>
  readonly read: (runId: RunId) => Effect.Effect<ReadonlyArray<JournalRecord>, JournalError | InRunJournalRunMismatch>
}

export class Journal extends Context.Service<Journal, JournalService>()("@dalph/Journal") {}

/** Bootstrap supplied no matching begun Run prefix from which journal state can start. */
export class JournalInitialHistoryInvalid extends Schema.TaggedError<JournalInitialHistoryInvalid>()(
  "JournalInitialHistoryInvalid",
  {
    historyRunId: RunId,
    reason: Schema.Literals(["EmptyHistory", "InvalidHistory", "MissingRunBeginning", "RunIdentityMismatch"]),
    requestedRunId: RunId
  }
) {}

type JournalStatus =
  | { readonly _tag: "JournalOpen"; readonly history: ValidWorkflowJournalHistory; readonly value: JournalState }
  | { readonly _tag: "JournalFailed"; readonly failure: JournalError }

const readOpenJournal = (status: JournalStatus): Effect.Effect<JournalState, JournalError> =>
  status._tag === "JournalOpen" ? Effect.succeed(status.value) : Effect.fail(status.failure)

type JournaledGraphFacts = CompleteTaskTrackerFactsObserved | UnchangedTaskTrackerFactsReconfirmed
type JournaledGraphEvent = TaskTrackerFactsObservedEvent & { readonly observation: JournaledGraphFacts }
type JournaledGraphRecord = Pick<JournalRecord, "position"> & { readonly event: JournaledGraphEvent }

/** One complete/reconfirmed event journaled for this service's configured target. */
interface JournaledGraphReceipt {
  readonly [JournaledGraphReceiptTypeId]: typeof JournaledGraphReceiptTypeId
  readonly event: JournaledGraphEvent
  readonly position: JournalPosition
  readonly snapshot: TaskDagSnapshot
}

const isJournaledGraphEvent = (event: TaskTrackerFactsObservedEvent): event is JournaledGraphEvent =>
  event.observation._tag === "CompleteTaskTrackerFacts" ||
  event.observation._tag === "UnchangedTaskTrackerFactsReconfirmed"

/** Mints a receipt only after this journal has selected a complete/reconfirmed event. */
const journaledGraphReceiptFromEvent = (input: {
  readonly event: JournaledGraphEvent
  readonly position: JournalPosition
  readonly snapshot: TaskDagSnapshot
}): JournaledGraphReceipt => ({
  [JournaledGraphReceiptTypeId]: JournaledGraphReceiptTypeId,
  event: input.event,
  position: input.position,
  snapshot: input.snapshot
})

const journaledTrackerGraphObservationFromReceipt = (
  receipt: JournaledGraphReceipt
): Option.Option<JournaledTrackerGraphObservation> =>
  Option.map(
    journaledGraphObservationFieldsFromReceipt(receipt, ({ event, position, snapshot }) => ({
      event,
      position,
      snapshot
    })),
    (fields) => ({ [JournaledTrackerGraphObservationTypeId]: JournaledTrackerGraphObservationTypeId, ...fields })
  )

const latestGraphObservationFrom = (
  records: ReadonlyArray<JournalRecord>,
  snapshot: TaskDagSnapshot,
  target: TrackerTarget
): Option.Option<JournaledTrackerGraphObservation> => {
  let latest: JournaledGraphRecord | undefined
  const targetKey = taskTrackerTargetKey(target)
  for (const record of records) {
    if (record.event._tag !== "TaskTrackerFactsObserved") continue
    if (!isJournaledGraphEvent(record.event)) continue
    if (taskTrackerTargetKey(record.event.observation.target) !== targetKey) continue
    latest = { event: record.event, position: record.position }
  }
  return Option.flatMap(Option.fromUndefinedOr(latest), ({ event, position }) =>
    journaledTrackerGraphObservationFromReceipt(journaledGraphReceiptFromEvent({ event, position, snapshot }))
  )
}

const graphStateFrom = (
  reconstructed: ReconstructedRunState,
  records: ReadonlyArray<JournalRecord>,
  target: TrackerTarget
): TrackerGraphState =>
  Option.match(reconstructedTaskGraphFor(reconstructed.graphKnowledge, target), {
    /* v8 ignore next -- A newly journaled complete/reconfirmed graph event necessarily reconstructs graph knowledge. */
    onNone: () => TrackerGraphState.cases.GraphNotEstablished.make({}),
    onSome: (graph) => {
      return Option.match(latestGraphObservationFrom(records, graph, target), {
        onNone: () => TrackerGraphState.cases.GraphNotEstablished.make({}),
        onSome: (observation) => TrackerGraphState.cases.GraphEstablished.make({ observation })
      })
    }
  })

const journaledGraphWasPublished = (
  records: ReadonlyArray<JournalRecord>,
  after: JournalPosition,
  target: TrackerTarget
): boolean => {
  const targetKey = taskTrackerTargetKey(target)
  return records.some(
    ({ event, position }) =>
      position > after &&
      event._tag === "TaskTrackerFactsObserved" &&
      isJournaledGraphEvent(event) &&
      taskTrackerTargetKey(event.observation.target) === targetKey
  )
}

const advanceJournalState = (
  history: ValidWorkflowJournalHistory,
  prior: JournalState,
  target: TrackerTarget
): JournalState => {
  const records = history.records
  const position = Option.getOrThrow(Option.fromUndefinedOr(records.at(lastElementOffset))).position
  const graph = journaledGraphWasPublished(records, prior.position, target)
    ? graphStateFrom(history.runState, records, target)
    : prior.graph
  return { _tag: "JournalState", position, graph, reconstructed: history.runState, records }
}

/**
 * Installs one current-first journal state after bootstrap has validated a
 * complete Run history. Reconstructed graph knowledge stays unusable until a
 * later complete graph observation is journaled through this service.
 */
export const makeJournal = Effect.fn("Journal.make")(function* (
  runId: RunId,
  target: TrackerTarget,
  initial: ValidWorkflowJournalHistory,
  storage: JournalStorageAppend
) {
  const first = initial.records.at(0)
  const last = initial.records.at(lastElementOffset)
  if (first === undefined || last === undefined) {
    return yield* new JournalInitialHistoryInvalid({
      historyRunId: initial.runId,
      reason: "EmptyHistory",
      requestedRunId: runId
    })
  }
  if (initial.runId !== runId || first.runId !== runId) {
    return yield* new JournalInitialHistoryInvalid({
      historyRunId: initial.runId,
      reason: "RunIdentityMismatch",
      requestedRunId: runId
    })
  }
  if (first.event._tag !== "WorkflowRunBegan") {
    return yield* new JournalInitialHistoryInvalid({
      historyRunId: initial.runId,
      reason: "MissingRunBeginning",
      requestedRunId: runId
    })
  }
  const validated = reduceWorkflowJournalHistory(runId, initial.records)
  if (validated._tag === "InvalidWorkflowJournalHistory") {
    return yield* new JournalInitialHistoryInvalid({
      historyRunId: initial.runId,
      reason: "InvalidHistory",
      requestedRunId: runId
    })
  }
  const initialPosition = last.position
  const publicationState = yield* SubscriptionRef.make<JournalStatus>({
    _tag: "JournalOpen",
    history: validated,
    value: {
      _tag: "JournalState",
      position: initialPosition,
      graph: TrackerGraphState.cases.GraphNotEstablished.make({}),
      reconstructed: validated.runState,
      records: validated.records
    }
  })
  yield* Effect.addFinalizer(() => PubSub.shutdown(publicationState.pubsub))
  const publication = yield* Semaphore.make(1)
  const state: CurrentSignal<JournalState, JournalError> = currentSignalFromCurrentFirstStream(
    SubscriptionRef.changes(publicationState).pipe(
      Stream.mapEffect((published) =>
        SubscriptionRef.get(publicationState).pipe(
          Effect.flatMap((latest) =>
            latest._tag === "JournalFailed" ? Effect.fail(latest.failure) : readOpenJournal(published)
          )
        )
      )
    )
  )
  const failJournal = (failure: JournalError) =>
    SubscriptionRef.set(publicationState, { _tag: "JournalFailed", failure }).pipe(Effect.andThen(Effect.fail(failure)))
  const append = (run: RunId, key: JournalRecordKey, event: AppendableWorkflowJournalEvent) =>
    publication.withPermit(
      Effect.uninterruptible(
        Effect.gen(function* () {
          if (run !== runId) return yield* new InRunJournalRunMismatch({ expectedRunId: runId, requestedRunId: run })
          const status = yield* SubscriptionRef.get(publicationState)
          if (status._tag === "JournalFailed") return yield* status.failure
          const record = yield* storage.append(run, key, event)
          const before = status.value
          if (record.position <= before.position) {
            const existing = before.records.find(({ position }) => position === record.position)
            if (JSON.stringify(existing) !== JSON.stringify(record)) {
              const failure = new JournalRecordMismatch({ position: record.position, key, runId })
              return yield* failJournal(failure)
            }
            return record
          }
          const expectedPosition = JournalPosition.make(before.position + 1)
          if (record.position !== expectedPosition) {
            const failure = new JournalPositionGap({ position: record.position, expectedPosition, runId })
            return yield* failJournal(failure)
          }
          const nextHistory = advanceWorkflowJournalHistory(status.history, record)
          if (nextHistory._tag === "InvalidWorkflowJournalHistory") {
            const failure = new JournalHistoryInvalid({
              position: record.position,
              detail: JSON.stringify(nextHistory.issues),
              runId
            })
            return yield* failJournal(failure)
          }
          const next = advanceJournalState(nextHistory, before, target)
          yield* SubscriptionRef.set(publicationState, { _tag: "JournalOpen", history: nextHistory, value: next })
          return record
        })
      )
    )
  const read: JournalService["read"] = (requestedRunId: RunId) =>
    requestedRunId === runId
      ? state.get.pipe(Effect.map(({ records }) => records))
      : Effect.fail(new InRunJournalRunMismatch({ expectedRunId: runId, requestedRunId }))
  return { state, append, read } satisfies JournalService
})

/** Installs the one journal and exposes only its in-Run and descriptive capabilities. */
export const journalLayer = (
  runId: RunId,
  target: TrackerTarget,
  initial: ValidWorkflowJournalHistory,
  storage: JournalStorageAppend
) =>
  Layer.effectContext(
    makeJournal(runId, target, initial, storage).pipe(
      Effect.map((journal) =>
        Context.empty().pipe(
          Context.add(Journal, journal),
          Context.add(InRunJournal, InRunJournal.of({ append: journal.append, read: journal.read }))
        )
      )
    )
  )
