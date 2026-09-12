import { Effect, Queue, Ref, type Crypto, type Scope } from "effect"
import { TaskId } from "@dalph/contracts"
import {
  CompletionClaimBoundary,
  CompletionTaskBoundary,
  TrackerGraphReader,
  JournalStorageUnavailable,
  FixtureTarget,
  projectTrackerSnapshot,
  type CompletionClaimDeletionRequest,
  type CompletionClaimReplacementRequest,
  type CompletionTaskRequest,
  type TaskClaimRelease,
  type CompletionClaimMarkerObservation,
  type CompletionClaimReadRequest,
  type FocusedTaskCompletionFacts,
  type JournalRecord,
  type DeliveryRuntimeReadyObservation,
  type InvalidWorkflowJournalHistory,
  type TaskDagSnapshot,
  type TaskClaimObservation,
  type TrackerTarget,
  type WorkflowJournalEvent as WorkflowEvent
} from "@dalph/orchestrator"
import type { AuthoredScenarioCassetteRunFailure } from "../src/cassettes/authored-runner.js"
import type { EmptyJournalCannotBeRecorded } from "../src/cassettes/recorded.js"
import { makeSixTaskDeliveryFacts } from "./six-task-delivery-facts.js"
import { makeSixTaskDeliveryRuntime, type SixTaskDeliveryRuntime } from "./six-task-delivery-runtime.js"
import { makeSixTaskFinalityBoundaries } from "./six-task-finality-boundaries.js"
import { makeIssue278SettledA, type Issue278SettledA } from "./issue-278-settled-a.js"

/** Actual tracker calls, correlated with the pending durable complete-read intent. */
export interface Issue278GraphRead {
  readonly target: TrackerTarget
  readonly intent: JournalRecord
  readonly settledTaskIds: ReadonlyArray<TaskId>
  readonly revision: string
  readonly runtime: DeliveryRuntimeReadyObservation | null
  readonly snapshot: TaskDagSnapshot
}

export type Issue278ClaimCall =
  | { readonly _tag: "Replace"; readonly request: CompletionClaimReplacementRequest }
  | { readonly _tag: "Complete"; readonly request: CompletionTaskRequest }
  | { readonly _tag: "Lookup"; readonly request: CompletionTaskRequest }
  | { readonly _tag: "ReleaseOriginal"; readonly request: TaskClaimRelease }
  | { readonly _tag: "Delete"; readonly request: CompletionClaimDeletionRequest }
  | {
      readonly _tag: "Marker"
      readonly request: CompletionClaimReadRequest
      readonly observation: CompletionClaimMarkerObservation
    }
  | { readonly _tag: "Active"; readonly taskId: TaskId; readonly observation: TaskClaimObservation }
  | { readonly _tag: "Focused"; readonly facts: FocusedTaskCompletionFacts }

export type Issue278Cut = "FinalGraphObserved" | "TerminationAppended"
export type Issue278DeliveryHold = "CompletionClaimReplaced" | "CompletionClaimDeletionIntended"
const allTaskNames = ["A", "B", "C", "D", "E", "F", "G"] as const

type Issue278CutState = { readonly _tag: "Disabled" } | { readonly _tag: "Armed"; readonly at: Issue278Cut }
type Issue278DeliveryHoldState =
  | { readonly _tag: "Disabled" }
  | { readonly _tag: "Armed"; readonly at: Issue278DeliveryHold }

export interface Issue278NormalTermination extends SixTaskDeliveryRuntime {
  readonly facts: ReturnType<typeof makeSixTaskDeliveryFacts>
  readonly settledA: Issue278SettledA
  readonly graphReads: Ref.Ref<ReadonlyArray<Issue278GraphRead>>
  readonly specificationReads: Ref.Ref<ReadonlyArray<{ readonly target: TrackerTarget; readonly taskId: TaskId }>>
  readonly claimCalls: Ref.Ref<ReadonlyArray<Issue278ClaimCall>>
  readonly events: Queue.Queue<WorkflowEvent>
  readonly reached: Queue.Queue<Issue278Cut>
  readonly terminationCut: Ref.Ref<Issue278CutState>
  readonly deliveryHold: Ref.Ref<Issue278DeliveryHoldState>
  readonly heldDelivery: Queue.Queue<Issue278DeliveryHold>
  readonly releaseDelivery: Queue.Queue<void>
}

export const makeIssue278NormalTermination = Effect.fn("Issue278.makeNormalTermination")(function* (): Effect.fn.Return<
  Issue278NormalTermination,
  AuthoredScenarioCassetteRunFailure | EmptyJournalCannotBeRecorded | InvalidWorkflowJournalHistory,
  Crypto.Crypto | Scope.Scope
> {
  const settledA = yield* makeIssue278SettledA()
  if (typeof settledA.target !== "string") return yield* Effect.die("controlled A prefix must use its fixture target")
  const facts = {
    ...makeSixTaskDeliveryFacts("issue-278"),
    runId: settledA.runId,
    target: FixtureTarget.make(settledA.target),
    integrationTarget: settledA.claim.promotionCorrelation.qualifiedCandidate.run.session.integrationTarget,
    baseSha: settledA.claim.promotionCorrelation.qualifiedCandidate.candidateCommit
  }
  const graphReads = yield* Ref.make<ReadonlyArray<Issue278GraphRead>>([])
  // Tracker-owned lifecycle state: only successful completion provider calls change it.
  const completedTasks = yield* Ref.make<ReadonlySet<TaskId>>(new Set([TaskId.make("A")]))
  const specificationReads = yield* Ref.make<
    ReadonlyArray<{ readonly target: TrackerTarget; readonly taskId: TaskId }>
  >([])
  const runtimeAtRead = yield* Ref.make<DeliveryRuntimeReadyObservation | null>(null)
  const claimCalls = yield* Ref.make<ReadonlyArray<Issue278ClaimCall>>([])
  const events = yield* Queue.unbounded<WorkflowEvent>()
  const reached = yield* Queue.unbounded<Issue278Cut>()
  const deliveryHold = yield* Ref.make<
    { readonly _tag: "Disabled" } | { readonly _tag: "Armed"; readonly at: Issue278DeliveryHold }
  >({ _tag: "Disabled" })
  const heldDelivery = yield* Queue.unbounded<Issue278DeliveryHold>()
  const releaseDelivery = yield* Queue.unbounded<void>()
  const cut = yield* Ref.make<{ readonly _tag: "Disabled" } | { readonly _tag: "Armed"; readonly at: Issue278Cut }>({
    _tag: "Disabled"
  })
  const record = (call: Issue278ClaimCall) => Ref.update(claimCalls, (all) => [...all, call])
  const runtime = yield* makeSixTaskDeliveryRuntime(facts, {
    initialize: settledA.seed,
    observeRuntime: (observation) => Ref.set(runtimeAtRead, observation),
    beforeAppend: () => Effect.void,
    afterTermination: () =>
      Effect.gen(function* () {
        const selected = yield* Ref.get(cut)
        if (selected._tag === "Armed" && selected.at === "TerminationAppended") {
          yield* Queue.offer(reached, selected.at)
          return yield* new JournalStorageUnavailable({
            operation: "JournalStore.terminateRun",
            detail: "controlled lost termination acknowledgement"
          })
        }
      }),
    afterAppend: (event) =>
      Effect.gen(function* () {
        yield* Queue.offer(events, event)
        const hold = yield* Ref.get(deliveryHold)
        if (hold._tag === "Armed" && event._tag === hold.at) {
          yield* Queue.offer(heldDelivery, hold.at)
          yield* Queue.take(releaseDelivery).pipe(Effect.interruptible)
        }
        const selected = yield* Ref.get(cut)
        if (selected._tag === "Disabled" || selected.at === "TerminationAppended") return
        const finalReads = yield* Ref.get(graphReads)
        const matches =
          event._tag === "TaskTrackerFactsObserved" &&
          finalReads.some(
            ({ intent, revision }) =>
              revision.startsWith("Gfinal") &&
              intent.event._tag === "TaskTrackerReadIntentRecorded" &&
              intent.event.operation._tag === "ReadTrackerGraph" &&
              intent.event.operation.cause._tag === "PostQuiescenceReconfirmation" &&
              intent.event.operation.operationId === event.operationId
          )
        if (matches) {
          yield* Queue.offer(reached, selected.at)
          return yield* Effect.interrupt
        }
      }),
    makeTrackerReader: (reader, journal) =>
      TrackerGraphReader.of({
        ...reader,
        readTaskWorkSpecification: (target, taskId) =>
          Ref.update(specificationReads, (all) => [...all, { target, taskId }]).pipe(
            Effect.andThen(reader.readTaskWorkSpecification(target, taskId))
          ),
        read: (target) =>
          Effect.gen(function* () {
            const records = yield* journal.read(facts.runId).pipe(Effect.orDie)
            const observed = new Set(
              records.flatMap(({ event }) => (event._tag === "TaskTrackerFactsObserved" ? [event.operationId] : []))
            )
            const pending = records.filter(
              ({ event }) =>
                event._tag === "TaskTrackerReadIntentRecorded" &&
                event.operation._tag === "ReadTrackerGraph" &&
                !observed.has(event.operation.operationId)
            )
            const intent = pending[0]
            if (
              pending.length !== 1 ||
              intent?.event._tag !== "TaskTrackerReadIntentRecorded" ||
              intent.event.operation._tag !== "ReadTrackerGraph"
            )
              return yield* Effect.die("complete tracker call requires one exact pending durable intent")
            if (intent.event.operation.target !== target)
              return yield* Effect.die("tracker target differs from pending intent")
            const settledTaskIds = records.flatMap(({ event }) =>
              event._tag === "IntegrationFinalitySettled" ? [event.claim.plannedAttempt.taskId] : []
            )
            const completed = yield* Ref.get(completedTasks)
            const completedNames = allTaskNames.filter((name) => completed.has(TaskId.make(name)))
            const revision =
              completedNames.length === allTaskNames.length
                ? "Gfinal"
                : completedNames.length === 1
                  ? "G5"
                  : `G5:${completedNames.join(",")}`
            const runtime = yield* Ref.get(runtimeAtRead)
            const recordGraph = (snapshot: TaskDagSnapshot) =>
              Ref.update(graphReads, (all) => [...all, { target, intent, settledTaskIds, revision, runtime, snapshot }])
            const projection = projectTrackerSnapshot({
              revision,
              rootTaskId: TaskId.make("A"),
              tasks: allTaskNames.map((id) => ({
                id: TaskId.make(id),
                lifecycle: completed.has(TaskId.make(id)) ? { _tag: "CompletedSuccessfully" } : { _tag: "Open" },
                parentTaskId: null,
                prerequisiteIds: []
              }))
            })
            if (projection._tag === "Invalid") return yield* Effect.die("invalid controlled tracker snapshot")
            yield* recordGraph(projection.snapshot)
            return projection.snapshot
          })
      }),
    makeFinality: Effect.fn("Issue278.makeObservedFinality")(function* (tracker) {
      const underlying = yield* makeSixTaskFinalityBoundaries(tracker)
      return {
        claimBoundary: CompletionClaimBoundary.of({
          ...underlying.claimBoundary,
          replaceTaskClaim: (request) =>
            underlying.claimBoundary
              .replaceTaskClaim(request)
              .pipe(Effect.tap(() => record({ _tag: "Replace", request }))),
          releaseOriginalTaskClaim: (request) =>
            underlying.claimBoundary
              .releaseOriginalTaskClaim(request)
              .pipe(Effect.tap(() => record({ _tag: "ReleaseOriginal", request }))),
          deleteTaskClaim: (request) =>
            underlying.claimBoundary
              .deleteTaskClaim(request)
              .pipe(Effect.tap(() => record({ _tag: "Delete", request }))),
          readCompletionClaimMarker: (request) =>
            underlying.claimBoundary
              .readCompletionClaimMarker(request)
              .pipe(Effect.tap((observation) => record({ _tag: "Marker", request, observation }))),
          readOriginalTaskClaim: (taskId) =>
            underlying.claimBoundary
              .readOriginalTaskClaim(taskId)
              .pipe(Effect.tap((observation) => record({ _tag: "Active", taskId, observation })))
        }),
        taskBoundary: CompletionTaskBoundary.of({
          ...underlying.taskBoundary,
          completeTask: (request) =>
            underlying.taskBoundary.completeTask(request).pipe(
              Effect.tap(() => Ref.update(completedTasks, (all) => new Set(all).add(request.taskId))),
              Effect.tap(() => record({ _tag: "Complete", request }))
            ),
          readCompletionRequest: (request) =>
            underlying.taskBoundary
              .readCompletionRequest(request)
              .pipe(Effect.tap(() => record({ _tag: "Lookup", request }))),
          readFocusedTaskCompletion: (request) =>
            underlying.taskBoundary
              .readFocusedTaskCompletion(request)
              .pipe(Effect.tap((facts) => record({ _tag: "Focused", facts })))
        })
      }
    })
  })
  return {
    ...runtime,
    facts,
    settledA,
    graphReads,
    specificationReads,
    claimCalls,
    events,
    reached,
    terminationCut: cut,
    deliveryHold,
    heldDelivery,
    releaseDelivery
  }
})
