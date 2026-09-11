import { RunId } from "@dalph/contracts"
import { Context, Effect, Layer, Option, PubSub, Schema, Semaphore, Stream, SubscriptionRef } from "effect"
import type { TaskDagSnapshot } from "../../authorities/task-tracker/graph.js"
import { advanceWorkflowJournalHistory } from "../reconstruction/history.js"
import type { ValidWorkflowJournalHistory } from "../reconstruction/history-result.js"
import type { AcceptedReconstructedRunState } from "../reconstruction/state.js"
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
import type { TrackerGraphReadCause } from "../../workflow/registry/operation.js"
import type { AcceptedJournalPrefix } from "../../workflow-journal/accepted-prefix.js"
import { AcceptedJournalReader } from "../../workflow-journal/accepted-reader.js"
import { journalRecordAt, materializeJournalRecords } from "../../workflow-journal/record-sequence.js"
import { acceptedJournalRecordForKey } from "../../workflow-journal/accepted-prefix.js"
import { intentRecordKey } from "../../workflow-journal/record-key.js"
import {
  journalGraphObservationAt,
  journalGraphSnapshotForObservation
} from "../../workflow-journal/record-evidence.js"
import { exactWorkflowRunTargetFor } from "../../workflow-journal/run-target.js"

const latestJournalRecordOffset = -1

const JournaledGraphReceiptTypeId: unique symbol = Symbol("JournaledGraphReceipt")
const JournaledTrackerGraphObservationTypeId: unique symbol = Symbol("JournaledTrackerGraphObservation")

/** Journaled graph observation evidence is privately branded inside this journal boundary. */
export interface JournaledTrackerGraphObservation extends JournaledGraphObservationFields {
  readonly [JournaledTrackerGraphObservationTypeId]: typeof JournaledTrackerGraphObservationTypeId
  readonly cause: typeof TrackerGraphReadCause.Type
}

/** The journal prefix and its process-local projections at one exact position. */
export interface JournalState {
  readonly _tag: "JournalState"
  readonly position: JournalPosition
  readonly graph: TrackerGraphState
  readonly reconstructed: AcceptedReconstructedRunState
  readonly prefix: AcceptedJournalPrefix
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
  readonly readAccepted: (runId: RunId) => Effect.Effect<AcceptedJournalPrefix, JournalError | InRunJournalRunMismatch>
}

export class Journal extends Context.Service<Journal, JournalService>()("@dalph/Journal") {}

/** Bootstrap supplied no matching begun Run prefix from which journal state can start. */
export class JournalInitialHistoryInvalid extends Schema.TaggedError<JournalInitialHistoryInvalid>()(
  "JournalInitialHistoryInvalid",
  {
    historyRunId: RunId,
    reason: Schema.Literals(["EmptyHistory", "MissingRunBeginning", "RunIdentityMismatch"]),
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
/** One complete/reconfirmed event journaled for this service's configured target. */
interface JournaledGraphReceipt {
  readonly [JournaledGraphReceiptTypeId]: typeof JournaledGraphReceiptTypeId
  readonly event: JournaledGraphEvent
  readonly cause: typeof TrackerGraphReadCause.Type
  readonly position: JournalPosition
  readonly snapshot: TaskDagSnapshot
}

const isJournaledGraphEvent = (event: TaskTrackerFactsObservedEvent): event is JournaledGraphEvent =>
  event.observation._tag === "CompleteTaskTrackerFacts" ||
  event.observation._tag === "UnchangedTaskTrackerFactsReconfirmed"

/** Mints a receipt only after this journal has selected a complete/reconfirmed event. */
const journaledGraphReceiptFromEvent = (input: {
  readonly event: JournaledGraphEvent
  readonly cause: typeof TrackerGraphReadCause.Type
  readonly position: JournalPosition
  readonly snapshot: TaskDagSnapshot
}): JournaledGraphReceipt => ({
  [JournaledGraphReceiptTypeId]: JournaledGraphReceiptTypeId,
  event: input.event,
  cause: input.cause,
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
    (fields) => ({
      [JournaledTrackerGraphObservationTypeId]: JournaledTrackerGraphObservationTypeId,
      cause: receipt.cause,
      ...fields
    })
  )

const graphObservationFromAcceptedRecord = (
  record: JournalRecord,
  prefix: AcceptedJournalPrefix,
  snapshot: TaskDagSnapshot,
  target: TrackerTarget
): Option.Option<JournaledTrackerGraphObservation> => {
  const event = record.event
  const targetKey = taskTrackerTargetKey(target)
  if (
    event._tag !== "TaskTrackerFactsObserved" ||
    !isJournaledGraphEvent(event) ||
    taskTrackerTargetKey(event.observation.target) !== targetKey
  ) {
    return Option.none()
  }
  const intent = acceptedJournalRecordForKey(prefix, intentRecordKey(event.operationId))
  return intent?.event._tag === "TaskTrackerReadIntentRecorded" && intent.event.operation._tag === "ReadTrackerGraph"
    ? journaledTrackerGraphObservationFromReceipt(
        journaledGraphReceiptFromEvent({
          cause: intent.event.operation.cause,
          event,
          position: record.position,
          snapshot
        })
      )
    : Option.none()
}

const graphStateFrom = (
  reconstructed: ReconstructedRunState,
  record: JournalRecord,
  prefix: AcceptedJournalPrefix,
  target: TrackerTarget
): TrackerGraphState => {
  const source = reconstructed.workflowHistory.evidence
  const establishedTarget = exactWorkflowRunTargetFor(source)
  if (establishedTarget === undefined || taskTrackerTargetKey(establishedTarget) !== taskTrackerTargetKey(target)) {
    return TrackerGraphState.cases.GraphNotEstablished.make({})
  }
  const observation = journalGraphObservationAt(source, { target: establishedTarget })
  if (observation === undefined) return TrackerGraphState.cases.GraphNotEstablished.make({})
  return Option.match(journalGraphSnapshotForObservation(source, observation.position), {
    /* v8 ignore next -- A newly journaled complete/reconfirmed graph event necessarily reconstructs graph knowledge. */
    onNone: () => TrackerGraphState.cases.GraphNotEstablished.make({}),
    onSome: (graph) => {
      return Option.match(graphObservationFromAcceptedRecord(record, prefix, graph, target), {
        /* v8 ignore next -- @preserve An established graph and its latest observation derive from the same accepted journal prefix, so the source observation cannot be absent here. */
        onNone: () => TrackerGraphState.cases.GraphNotEstablished.make({}),
        onSome: (observation) => TrackerGraphState.cases.GraphEstablished.make({ observation })
      })
    }
  })
}

const acceptedRecordPublishesGraph = (record: JournalRecord, target: TrackerTarget): boolean => {
  const targetKey = taskTrackerTargetKey(target)
  const event = record.event
  return (
    event._tag === "TaskTrackerFactsObserved" &&
    isJournaledGraphEvent(event) &&
    taskTrackerTargetKey(event.observation.target) === targetKey
  )
}

const advanceJournalState = (
  history: ValidWorkflowJournalHistory,
  prior: JournalState,
  record: JournalRecord,
  target: TrackerTarget
): JournalState => {
  const graph = acceptedRecordPublishesGraph(record, target)
    ? graphStateFrom(history.runState, record, history.prefix, target)
    : prior.graph
  return {
    _tag: "JournalState",
    position: record.position,
    graph,
    reconstructed: history.runState,
    prefix: history.prefix
  }
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
  storage: JournalStorageAppend,
  onAcceptedRecord: (record: JournalRecord) => Effect.Effect<void> = () => Effect.void
) {
  const first = journalRecordAt(initial.prefix.records, 0)
  const last = journalRecordAt(initial.prefix.records, latestJournalRecordOffset)
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
  const initialPosition = last.position
  const publicationState = yield* SubscriptionRef.make<JournalStatus>({
    _tag: "JournalOpen",
    history: initial,
    value: {
      _tag: "JournalState",
      position: initialPosition,
      graph: TrackerGraphState.cases.GraphNotEstablished.make({}),
      reconstructed: initial.runState,
      prefix: initial.prefix
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
            const existing = acceptedJournalRecordForKey(before.prefix, record.key)
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
          const next = advanceJournalState(nextHistory, before, record, target)
          yield* SubscriptionRef.set(publicationState, { _tag: "JournalOpen", history: nextHistory, value: next })
          yield* onAcceptedRecord(record)
          return record
        })
      )
    )
  const read: JournalService["read"] = (requestedRunId: RunId) =>
    requestedRunId === runId
      ? state.get.pipe(Effect.map(({ prefix }) => materializeJournalRecords(prefix.records)))
      : Effect.fail(new InRunJournalRunMismatch({ expectedRunId: runId, requestedRunId }))
  const readAccepted: JournalService["readAccepted"] = (requestedRunId: RunId) =>
    requestedRunId === runId
      ? state.get.pipe(Effect.map(({ prefix }) => prefix))
      : Effect.fail(new InRunJournalRunMismatch({ expectedRunId: runId, requestedRunId }))
  return { state, append, read, readAccepted } satisfies JournalService
})

/** Installs the one journal and exposes only its in-Run and descriptive capabilities. */
export const journalLayer = (
  runId: RunId,
  target: TrackerTarget,
  initial: ValidWorkflowJournalHistory,
  storage: JournalStorageAppend,
  onAcceptedRecord?: (record: JournalRecord) => Effect.Effect<void>
) =>
  Layer.effectContext(
    makeJournal(runId, target, initial, storage, onAcceptedRecord).pipe(
      Effect.map((journal) =>
        Context.empty().pipe(
          Context.add(Journal, journal),
          Context.add(AcceptedJournalReader, AcceptedJournalReader.of({ readAccepted: journal.readAccepted })),
          Context.add(InRunJournal, InRunJournal.of({ append: journal.append, read: journal.read }))
        )
      )
    )
  )
