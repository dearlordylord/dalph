import { Effect, Queue, Ref, type Deferred } from "effect"
import type {
  EvidenceReference,
  GitCommitSha,
  PlannedAttemptExecutorProjection,
  PlannedTaskAttempt,
  RunId,
  TaskId
} from "@dalph/contracts"
import {
  type DeliveryRelationInputBundle,
  type EvidenceStoreFailure,
  type EvidenceStoreService,
  JournalStore,
  type IntegratorRunCorrelation,
  type JournalStoreService,
  type TrackerGraphReader,
  type TrackerMutationService,
  type CompletionClaimBoundaryService,
  type CompletionTaskBoundaryService,
  type JournalRecord,
  type JournalStorageUnavailable,
  type DeliveryRuntimeObservationState,
  type DeliveryRuntimeReadyObservation,
  type TargetPromotionGitRequest,
  type WorkflowJournalEvent as WorkflowEvent
} from "@dalph/orchestrator"
import type { makeSixTaskDeliveryFacts } from "./six-task-delivery-facts.js"
import type { SixTaskCandidateRead } from "./six-task-integrator-git.js"

export type SixTaskTerminalCut = "BeforeObservation" | "AfterObservation" | "AfterAcceptance"

export interface SixTaskRuntimeControl {
  readonly observeRuntime?: (observation: DeliveryRuntimeReadyObservation) => Effect.Effect<void>
  readonly initialize?: (input: {
    readonly journal: JournalStoreService
    readonly evidence: EvidenceStoreService
  }) => Effect.Effect<void>
  readonly makeTrackerReader?: (
    reader: TrackerGraphReader["Service"],
    journal: JournalStoreService
  ) => TrackerGraphReader["Service"]
  readonly beforeAppend: (event: WorkflowEvent) => Effect.Effect<void>
  readonly afterAppend: (event: WorkflowEvent) => Effect.Effect<void>
  readonly afterTermination?: (record: JournalRecord) => Effect.Effect<void, JournalStorageUnavailable>
  readonly makeFinality: (
    tracker: TrackerMutationService
  ) => Effect.Effect<{
    readonly claimBoundary: CompletionClaimBoundaryService
    readonly taskBoundary: CompletionTaskBoundaryService
  }>
}

interface SixTaskCutState {
  readonly _tag: "Disabled"
}

interface SixTaskArmedCutState {
  readonly _tag: "Armed"
  readonly at: SixTaskTerminalCut
}

export interface SixTaskRuntimeObservation {
  readonly appendAttempts: Ref.Ref<ReadonlyArray<WorkflowEvent>>
  readonly processEndRequests: Ref.Ref<number>
  readonly runtimeEntries: Ref.Ref<number>
  readonly terminationAttempts: Ref.Ref<ReadonlyArray<Parameters<JournalStoreService["terminateRun"]>>>
  readonly runtimeObservations: Ref.Ref<ReadonlyArray<DeliveryRuntimeObservationState>>
  readonly runtimeObservationQueue: Queue.Queue<DeliveryRuntimeReadyObservation>
  readonly cut: Ref.Ref<SixTaskCutState | SixTaskArmedCutState>
  readonly cutReached: Queue.Queue<SixTaskTerminalCut>
  readonly controlledJournal: JournalStoreService
}

type SixTaskName = keyof ReturnType<typeof makeSixTaskDeliveryFacts>["taskFacts"]
type SixTaskCut = { readonly _tag: "Disabled" } | { readonly _tag: "Armed"; readonly at: SixTaskTerminalCut }

export interface SixTaskDeliveryRuntime extends Omit<SixTaskRuntimeObservation, "controlledJournal"> {
  readonly activate: Effect.Effect<never, unknown>
  readonly commands: Ref.Ref<ReadonlyArray<PlannedTaskAttempt>>
  readonly integrationEntered: Queue.Queue<IntegratorRunCorrelation>
  readonly integrations: Ref.Ref<ReadonlyArray<IntegratorRunCorrelation>>
  readonly candidateReads: Ref.Ref<ReadonlyArray<SixTaskCandidateRead>>
  readonly journal: JournalStoreService
  readonly evidence: EvidenceStoreService
  readonly evidenceReads: Ref.Ref<ReadonlyArray<EvidenceReference>>
  readonly head: Ref.Ref<GitCommitSha>
  readonly promotions: Ref.Ref<ReadonlyArray<TargetPromotionGitRequest>>
  readonly promotionReads: Ref.Ref<ReadonlyArray<TargetPromotionGitRequest>>
  readonly publications: Ref.Ref<ReadonlyArray<DeliveryRelationInputBundle>>
  readonly publicationQueue: Queue.Queue<DeliveryRelationInputBundle>
  readonly releaseIntegration: ReadonlyMap<TaskId, Deferred.Deferred<void>>
  readonly runId: RunId
  readonly terminal: (name: SixTaskName) => Effect.Effect<void, EvidenceStoreFailure>
  readonly publish: (name: SixTaskName, projection: PlannedAttemptExecutorProjection) => Effect.Effect<void>
  readonly unresolved: (kind: "Unavailable" | "Foreign") => Effect.Effect<void, EvidenceStoreFailure>
  readonly cut: Ref.Ref<SixTaskCut>
}

/** Observes actual journal calls and process-local runtime publications in shared controlled fixtures. */
export const makeSixTaskRuntimeObservation = Effect.fn("SixTaskDelivery.makeRuntimeObservation")(function* (
  journal: JournalStoreService,
  control: SixTaskRuntimeControl
): Effect.fn.Return<SixTaskRuntimeObservation> {
  const appendAttempts = yield* Ref.make<ReadonlyArray<WorkflowEvent>>([])
  const processEndRequests = yield* Ref.make(0)
  const runtimeEntries = yield* Ref.make(0)
  const terminationAttempts = yield* Ref.make<ReadonlyArray<Parameters<JournalStoreService["terminateRun"]>>>([])
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
