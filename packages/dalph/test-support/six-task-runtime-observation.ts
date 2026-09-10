import { Effect, Queue, Ref } from "effect"
import {
  JournalStore,
  type EvidenceStore,
  type TrackerGraphReader,
  type CompletionClaimBoundary,
  type CompletionTaskBoundary,
  type TrackerMutation,
  type JournalRecord,
  type JournalStorageUnavailable,
  type DeliveryRuntimeObservationState,
  type DeliveryRuntimeReadyObservation,
  type WorkflowJournalEvent as WorkflowEvent
} from "@dalph/orchestrator"

export type SixTaskTerminalCut = "BeforeObservation" | "AfterObservation" | "AfterAcceptance"

export interface SixTaskRuntimeControl {
  readonly observeRuntime?: (observation: DeliveryRuntimeReadyObservation) => Effect.Effect<void>
  readonly initialize?: (input: {
    readonly journal: JournalStore["Service"]
    readonly evidence: EvidenceStore["Service"]
  }) => Effect.Effect<void>
  readonly makeTrackerReader?: (
    reader: TrackerGraphReader["Service"],
    journal: JournalStore["Service"]
  ) => TrackerGraphReader["Service"]
  readonly beforeAppend: (event: WorkflowEvent) => Effect.Effect<void>
  readonly afterAppend: (event: WorkflowEvent) => Effect.Effect<void>
  readonly afterTermination?: (record: JournalRecord) => Effect.Effect<void, JournalStorageUnavailable>
  readonly makeFinality: (
    tracker: TrackerMutation["Service"]
  ) => Effect.Effect<{
    readonly claimBoundary: CompletionClaimBoundary["Service"]
    readonly taskBoundary: CompletionTaskBoundary["Service"]
  }>
}

/** Observes actual journal calls and process-local runtime publications in shared controlled fixtures. */
export const makeSixTaskRuntimeObservation = Effect.fn("SixTaskDelivery.makeRuntimeObservation")(function* (
  journal: JournalStore["Service"],
  control: SixTaskRuntimeControl
) {
  const appendAttempts = yield* Ref.make<ReadonlyArray<WorkflowEvent>>([])
  const processEndRequests = yield* Ref.make(0)
  const runtimeEntries = yield* Ref.make(0)
  const terminationAttempts = yield* Ref.make<ReadonlyArray<Parameters<JournalStore["Service"]["terminateRun"]>>>([])
  const runtimeObservations = yield* Ref.make<ReadonlyArray<DeliveryRuntimeObservationState>>([])
  const runtimeObservationQueue = yield* Queue.unbounded<DeliveryRuntimeReadyObservation>()
  const cut = yield* Ref.make<
    { readonly _tag: "Disabled" } | { readonly _tag: "Armed"; readonly at: SixTaskTerminalCut }
  >({ _tag: "Disabled" })
  const cutReached = yield* Queue.unbounded<SixTaskTerminalCut>()
  const controlledJournal = JournalStore.of({
    ...journal,
    terminateRun: (...request) =>
      Effect.gen(function* () {
        yield* Ref.update(terminationAttempts, (all) => [...all, request])
        const result = yield* journal.terminateRun(...request)
        yield* control.afterAppend(result.event)
        if (control.afterTermination !== undefined) yield* control.afterTermination(result)
        return result
      }),
    append: (id, key, event) =>
      Effect.gen(function* () {
        yield* Ref.update(appendAttempts, (all) => [...all, event])
        const selected = yield* Ref.get(cut)
        yield* control.beforeAppend(event)
        const matches =
          selected._tag === "Armed" &&
          (selected.at === "BeforeObservation"
            ? event._tag === "PlannedAttemptExecutorStateObserved"
            : selected.at === "AfterObservation"
              ? event._tag === "PlannedAttemptExecutorWorkReported" && event.report._tag === "ExecutorWorkTerminal"
              : event._tag === "IntegrationResponsibilityBegan")
        if (selected._tag === "Armed" && matches) {
          yield* Queue.offer(cutReached, selected.at)
          return yield* Effect.interrupt
        }
        const result = yield* journal.append(id, key, event)
        yield* control.afterAppend(event)
        return result
      })
  })
  return {
    appendAttempts,
    processEndRequests,
    runtimeEntries,
    terminationAttempts,
    runtimeObservations,
    runtimeObservationQueue,
    cut,
    cutReached,
    controlledJournal
  }
})
