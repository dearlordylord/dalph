import { Effect, Queue, Ref } from "effect"
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
import { makeSixTaskDeliveryRuntime } from "./six-task-delivery-runtime.js"
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

export const makeIssue277DistinctFinality = Effect.fn("Issue277.makeDistinctFinality")(function* () {
  const facts = makeSixTaskDeliveryFacts("issue-277")
  const calls = yield* Ref.make<ReadonlyArray<Issue277FinalityCall>>([])
  const cut = yield* Ref.make<
    { readonly _tag: "Disabled" } | { readonly _tag: "Armed"; readonly at: Issue277Cut; readonly attemptId: AttemptId }
  >({ _tag: "Disabled" })
  const reached = yield* Queue.unbounded<Issue277Cut | "Finished">()
  const events = yield* Queue.unbounded<WorkflowEvent>()
  const record = (call: Issue277FinalityCall) => Ref.update(calls, (all) => [...all, call])
  const interruptAt = (at: Issue277Cut, attemptId: AttemptId) =>
    Effect.gen(function* () {
      const selected = yield* Ref.get(cut)
      if (selected._tag === "Armed" && selected.at === at && selected.attemptId === attemptId) {
        yield* Queue.offer(reached, at)
        return yield* Effect.interrupt
      }
    })
  const afterAppend = (event: WorkflowEvent) =>
    Effect.gen(function* () {
      yield* Queue.offer(events, event)
      if (
        event._tag !== "PlannedAttemptExecutorWorkReported" &&
        event._tag !== "IntegratorRunResultRecorded" &&
        event._tag !== "TargetPromotionObservedSuccess" &&
        event._tag !== "TargetPromotionIntended" &&
        event._tag !== "CompletionClaimDeletionIntended" &&
        event._tag !== "CompletionTaskAcknowledged" &&
        event._tag !== "CompletionClaimDeleted" &&
        event._tag !== "IntegrationFinalitySettled"
      )
        return
      switch (event._tag) {
        case "PlannedAttemptExecutorWorkReported":
          if (event.report._tag === "ExecutorWorkTerminal")
            yield* interruptAt("AcceptedResult", event.report.correlation.attemptId)
          break
        case "IntegratorRunResultRecorded":
          yield* interruptAt("IntegratorResult", event.run.session.plannedAttempt.attemptId)
          break
        case "TargetPromotionObservedSuccess":
          yield* interruptAt("Promotion", event.correlation.qualifiedCandidate.run.session.plannedAttempt.attemptId)
          break
        case "TargetPromotionIntended":
          yield* interruptAt(
            "PromotionIntent",
            event.correlation.qualifiedCandidate.run.session.plannedAttempt.attemptId
          )
          break
        case "CompletionClaimDeletionIntended":
          yield* interruptAt("ClaimDeletionIntent", event.claim.plannedAttempt.attemptId)
          break
        case "CompletionTaskAcknowledged":
          yield* interruptAt("CompletionAcknowledgement", event.request.claim.plannedAttempt.attemptId)
          break
        case "CompletionClaimDeleted":
          yield* interruptAt("ClaimDeletion", event.claim.plannedAttempt.attemptId)
          break
        case "IntegrationFinalitySettled":
          if (event.claim.plannedAttempt.taskId === "G") {
            yield* Queue.offer(reached, "Finished")
            return yield* Effect.interrupt
          }
          break
      }
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
