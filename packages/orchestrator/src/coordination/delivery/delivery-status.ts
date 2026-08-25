import { Effect, Schema, Stream } from "effect"
import type { RunId } from "@dalph/contracts"
import type {
  DeliveryRuntimeObservationState,
  DeliveryRuntimeReadyObservation
} from "./delivery-runtime-observation.js"
import { makeCurrentSignal, type CurrentSignal } from "./relations.js"
import {
  DeliveryStatusProjectionConflict,
  DeliveryStatusRunIdentityUnavailable,
  DeliveryStatusRunMismatch,
  DeliveryStatusSubject,
  type CurrentDeliveryStatus,
  type DeliveryStatusProjectionError,
  type DeliveryStatusSnapshot,
  type DeliveryStatusEntry
} from "./delivery-status-model.js"
import { statusEntriesFor } from "./delivery-status-entries.js"
import { graphSourceOf } from "./delivery-status-support.js"

export * from "./delivery-status-model.js"

const readyRunIdFor = (
  subject: DeliveryStatusSubject,
  ready: DeliveryRuntimeReadyObservation
): RunId | DeliveryStatusRunMismatch | DeliveryStatusRunIdentityUnavailable => {
  const expectedRunId = ready.evaluation.current.runId
  if (expectedRunId === undefined) return new DeliveryStatusRunIdentityUnavailable({ subject })
  return subject.runId === expectedRunId
    ? expectedRunId
    : new DeliveryStatusRunMismatch({ expectedRunId, requestedRunId: subject.runId })
}

const absentTaskFor = (
  subject: DeliveryStatusSubject,
  ready: DeliveryRuntimeReadyObservation
): Extract<DeliveryStatusSnapshot, { readonly _tag: "TaskAbsentFromCurrentGraph" }> | null => {
  const graph = ready.evaluation.current.trackerGraph
  if (subject._tag !== "Task" || graph._tag !== "GraphEstablished") return null
  const present = graph.observation.snapshot.toWire().tasks.some(({ id }) => id === subject.taskId)
  if (present) return null
  return { _tag: "TaskAbsentFromCurrentGraph", subject, graphSource: graphSourceOf(graph) }
}

const entriesForReady = (
  subject: DeliveryStatusSubject,
  ready: DeliveryRuntimeReadyObservation,
  entries: ReadonlyArray<DeliveryStatusEntry>
): ReadonlyArray<DeliveryStatusEntry> => {
  if (ready.evaluation.current.trackerGraph._tag !== "GraphNotEstablished") return entries
  return [
    {
      _tag: "TrackerFactWait",
      classification: "Waiting",
      subject,
      responsibility: null,
      fact: { _tag: "Unobserved", boundary: "TaskTracker" },
      wakeCondition: "TaskTrackerFactsObserved",
      standing: { _tag: "GraphNotEstablished" }
    } satisfies DeliveryStatusEntry,
    ...entries
  ]
}

const readyFor = (
  subject: DeliveryStatusSubject,
  ready: DeliveryRuntimeReadyObservation
): DeliveryStatusSnapshot | DeliveryStatusProjectionError => {
  const runId = readyRunIdFor(subject, ready)
  if (runId instanceof DeliveryStatusRunMismatch || runId instanceof DeliveryStatusRunIdentityUnavailable) {
    return runId
  }
  const absentTask = absentTaskFor(subject, ready)
  if (absentTask !== null) return absentTask
  const projectedEntries = statusEntriesFor(subject, ready.evaluation, runId, ready.liveOwners)
  if (projectedEntries instanceof DeliveryStatusProjectionConflict) return projectedEntries
  return {
    _tag: "DeliveryStatusAvailable",
    subject,
    acceptedAt: ready.evaluation.acceptedAt,
    entries: entriesForReady(subject, ready, projectedEntries)
  }
}

const snapshotFor = (
  subject: DeliveryStatusSubject,
  state: DeliveryRuntimeObservationState
): CurrentDeliveryStatus | DeliveryStatusProjectionError => {
  if (state._tag === "NotReady") return { _tag: "DeliveryStatusNotReady", subject }
  if (state._tag === "Ready") return readyFor(subject, state)
  if (state.final === null) return { _tag: "DeliveryStatusClosed", subject, final: null }
  if (state.final._tag === "NotReady") {
    return { _tag: "DeliveryStatusClosed", subject, final: { _tag: "DeliveryStatusNotReady", subject } }
  }
  const final = readyFor(subject, state.final)
  if (
    final instanceof DeliveryStatusRunMismatch ||
    final instanceof DeliveryStatusRunIdentityUnavailable ||
    final instanceof DeliveryStatusProjectionConflict
  ) {
    return final
  }
  return { _tag: "DeliveryStatusClosed", subject, final }
}

const statusOrFail = (
  subject: DeliveryStatusSubject,
  state: DeliveryRuntimeObservationState
): Effect.Effect<CurrentDeliveryStatus, DeliveryStatusProjectionError> => {
  const projected = snapshotFor(subject, state)
  return projected instanceof DeliveryStatusRunMismatch ||
    projected instanceof DeliveryStatusRunIdentityUnavailable ||
    projected instanceof DeliveryStatusProjectionConflict
    ? Effect.fail(projected)
    : Effect.succeed(projected)
}

/** Purely projects one decoded subject from one coherent runtime observation. */
export const deliveryStatusOf = snapshotFor

/** Decodes a public subject before opening the process-local current-first status source. */
export const deliveryStatusSignalOf = (
  source: CurrentSignal<DeliveryRuntimeObservationState>,
  input: unknown
): Effect.Effect<CurrentSignal<CurrentDeliveryStatus, DeliveryStatusProjectionError>, Schema.SchemaError> =>
  Schema.decodeUnknownEffect(DeliveryStatusSubject)(input).pipe(
    Effect.map((subject) =>
      makeCurrentSignal(
        source.attach.pipe(
          Effect.flatMap(({ changes, current }) =>
            statusOrFail(subject, current).pipe(
              Effect.map((projectedCurrent) => ({
                current: projectedCurrent,
                changes: changes.pipe(Stream.mapEffect((state) => statusOrFail(subject, state)))
              }))
            )
          )
        )
      )
    )
  )

/** Opens one passive current-first status stream; no authority or mutation boundary is available here. */
export const observeDeliveryStatus = (
  source: CurrentSignal<DeliveryRuntimeObservationState>,
  input: unknown
): Stream.Stream<CurrentDeliveryStatus, Schema.SchemaError | DeliveryStatusProjectionError> =>
  Stream.unwrap(deliveryStatusSignalOf(source, input).pipe(Effect.map((signal) => signal.changes)))
