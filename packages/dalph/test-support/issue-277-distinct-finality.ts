import { Effect, Match, Queue, Ref, type Crypto, type Scope } from "effect"
import {
  CompletionClaimBoundary,
  CompletionTaskBoundary,
  TrackerRevision,
  FocusedTaskCompletionFacts,
  type CompletionClaimDeletionRequest,
  type CompletionClaimReplacementRequest,
  type CompletionClaimMarkerObservation,
  type CompletionClaimReadRequest,
  type CompletionTaskRequest,
  type CompletionTaskRequestLookup,
  type TaskClaimRelease,
  type WorkflowJournalEvent as WorkflowEvent,
  type TaskClaimObservation,
  type TrackerMutation
} from "@dalph/orchestrator"
import { type TaskId, type AttemptId } from "@dalph/contracts"
import { makeSixTaskDeliveryFacts } from "./six-task-delivery-facts.js"
import { makeSixTaskDeliveryRuntime, type SixTaskDeliveryRuntime } from "./six-task-delivery-runtime.js"
import { makeSixTaskFinalityBoundaries } from "./six-task-finality-boundaries.js"

export type Issue277Cut =
  | "AcceptedResult"
  | "IntegratorResult"
  | "Promotion"
  | "PromotionIntent"
  | "ClaimDeletionIntent"
  | "CompletionRequest"
  | "ClaimDeletion"
  | "CompletionAcknowledgement"
  | "MarkerDeletion"

/** Outside occurrences recorded independently from Dalph's workflow journal. */
export type Issue277FinalityCall =
  | { readonly _tag: "Replace"; readonly request: CompletionClaimReplacementRequest }
  | { readonly _tag: "Complete"; readonly request: CompletionTaskRequest }
  | { readonly _tag: "Lookup"; readonly request: CompletionTaskRequest; readonly result: CompletionTaskRequestLookup }
  | { readonly _tag: "ReleaseOriginal"; readonly request: TaskClaimRelease }
  | { readonly _tag: "Delete"; readonly request: CompletionClaimDeletionRequest }
  | { readonly _tag: "Focused"; readonly facts: FocusedTaskCompletionFacts }
  | {
      readonly _tag: "Marker"
      readonly request: CompletionClaimReadRequest
      readonly observation: CompletionClaimMarkerObservation
    }
  | { readonly _tag: "Active"; readonly taskId: TaskId; readonly observation: TaskClaimObservation }

type Issue277CutState =
  | { readonly _tag: "Disabled" }
  | { readonly _tag: "Armed"; readonly at: Issue277Cut; readonly attemptId: AttemptId }

interface Issue277DistinctFinality extends SixTaskDeliveryRuntime {
  readonly facts: ReturnType<typeof makeSixTaskDeliveryFacts>
  readonly calls: Ref.Ref<ReadonlyArray<Issue277FinalityCall>>
  readonly finalityCut: Ref.Ref<Issue277CutState>
  readonly reached: Queue.Queue<{ readonly _tag: "Crash"; readonly at: Issue277Cut } | { readonly _tag: "Finished" }>
  readonly events: Queue.Queue<WorkflowEvent>
}

export const makeIssue277DistinctFinality = Effect.fn("Issue277.makeDistinctFinality")(function* (): Effect.fn.Return<
  Issue277DistinctFinality,
  never,
  Crypto.Crypto | Scope.Scope
> {
  const facts = makeSixTaskDeliveryFacts("issue-277")
  const calls = yield* Ref.make<ReadonlyArray<Issue277FinalityCall>>([])
  const cut = yield* Ref.make<
    { readonly _tag: "Disabled" } | { readonly _tag: "Armed"; readonly at: Issue277Cut; readonly attemptId: AttemptId }
  >({ _tag: "Disabled" })
  const reached = yield* Queue.unbounded<
    { readonly _tag: "Crash"; readonly at: Issue277Cut } | { readonly _tag: "Finished" }
  >()
  const events = yield* Queue.unbounded<WorkflowEvent>()
  const record = (call: Issue277FinalityCall) => Ref.update(calls, (all) => [...all, call])
  const interruptAt = (at: Issue277Cut, attemptId: AttemptId) =>
    Effect.gen(function* () {
      const selected = yield* Ref.get(cut)
      if (selected._tag === "Armed" && selected.at === at && selected.attemptId === attemptId) {
        yield* Queue.offer(reached, { _tag: "Crash", at })
        return yield* Effect.interrupt
      }
    })
  const applyAfterAppendCut = (event: WorkflowEvent) =>
    Match.value(event).pipe(
      Match.tags({
        PlannedAttemptExecutorWorkReported: ({ report }) =>
          report._tag === "ExecutorWorkTerminal"
            ? interruptAt("AcceptedResult", report.correlation.attemptId)
            : Effect.void,
        IntegratorRunResultRecorded: ({ run }) => interruptAt("IntegratorResult", run.session.plannedAttempt.attemptId),
        TargetPromotionObservedSuccess: ({ correlation }) =>
          interruptAt("Promotion", correlation.qualifiedCandidate.run.session.plannedAttempt.attemptId),
        TargetPromotionIntended: ({ correlation }) =>
          interruptAt("PromotionIntent", correlation.qualifiedCandidate.run.session.plannedAttempt.attemptId),
        CompletionClaimDeletionIntended: ({ claim }) =>
          interruptAt("ClaimDeletionIntent", claim.plannedAttempt.attemptId),
        CompletionTaskAcknowledged: ({ request }) =>
          interruptAt("CompletionAcknowledgement", request.claim.plannedAttempt.attemptId),
        CompletionClaimDeleted: ({ claim }) => interruptAt("ClaimDeletion", claim.plannedAttempt.attemptId),
        IntegrationFinalitySettled: ({ claim }) =>
          claim.plannedAttempt.taskId === "G"
            ? Queue.offer(reached, { _tag: "Finished" }).pipe(Effect.andThen(Effect.interrupt))
            : Effect.void
      }),
      Match.orElse(() => Effect.void)
    )
  const afterAppend = (event: WorkflowEvent) =>
    Effect.gen(function* () {
      yield* Queue.offer(events, event)
      yield* applyAfterAppendCut(event)
    })
  const runtime = yield* makeSixTaskDeliveryRuntime(facts, {
    beforeAppend: (event) =>
      event._tag === "CompletionTaskAcknowledged"
        ? interruptAt("CompletionRequest", event.request.claim.plannedAttempt.attemptId)
        : Effect.void,
    afterAppend,
    makeFinality: Effect.fn("Issue277.makeObservedFinality")(function* (tracker: TrackerMutation["Service"]) {
      const underlying = yield* makeSixTaskFinalityBoundaries(tracker)
      const claimBoundary = CompletionClaimBoundary.of({
        ...underlying.claimBoundary,
        replaceTaskClaim: (request) =>
          underlying.claimBoundary
            .replaceTaskClaim(request)
            .pipe(Effect.tap(() => record({ _tag: "Replace", request }))),
        deleteTaskClaim: (request) =>
          underlying.claimBoundary.deleteTaskClaim(request).pipe(
            Effect.tap(() => record({ _tag: "Delete", request })),
            Effect.tap(() => interruptAt("MarkerDeletion", request.claim.plannedAttempt.attemptId))
          ),
        readCompletionClaimMarker: (request) =>
          underlying.claimBoundary
            .readCompletionClaimMarker(request)
            .pipe(Effect.tap((observation) => record({ _tag: "Marker", request, observation }))),
        readOriginalTaskClaim: (taskId) =>
          underlying.claimBoundary
            .readOriginalTaskClaim(taskId)
            .pipe(Effect.tap((observation) => record({ _tag: "Active", taskId, observation }))),
        releaseOriginalTaskClaim: (request) =>
          underlying.claimBoundary
            .releaseOriginalTaskClaim(request)
            .pipe(Effect.tap(() => record({ _tag: "ReleaseOriginal", request })))
      })
      const taskBoundary = CompletionTaskBoundary.of({
        ...underlying.taskBoundary,
        completeTask: (request) =>
          underlying.taskBoundary.completeTask(request).pipe(Effect.tap(() => record({ _tag: "Complete", request }))),
        readCompletionRequest: (request) =>
          underlying.taskBoundary
            .readCompletionRequest(request)
            .pipe(Effect.tap((result) => record({ _tag: "Lookup", request, result }))),
        readFocusedTaskCompletion: (request) =>
          underlying.taskBoundary.readFocusedTaskCompletion(request).pipe(
            Effect.map((facts) =>
              FocusedTaskCompletionFacts.make({
                ...facts,
                trackerRevision: TrackerRevision.make(`issue-277:${facts.taskId}:${facts.lifecycle}`)
              })
            ),
            Effect.tap((facts) => record({ _tag: "Focused", facts }))
          )
      })
      return { claimBoundary, taskBoundary }
    })
  })
  return { ...runtime, facts, calls, finalityCut: cut, reached, events }
})
