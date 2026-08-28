import type { TaskId } from "@dalph/contracts"
import { Effect, Layer, Ref } from "effect"
import { taskTrackerTargetKey, type TrackerTarget } from "../../../authorities/task-tracker/target.js"
import { UnclaimedTask } from "../../../authorities/task-tracker/claim-mutation.js"
import type { OperationId } from "../../identity.js"
import {
  CompletionClaimBoundary,
  type CompletionClaimDeletionRequest,
  CompletionClaimDeletionFailure,
  type CompletionClaimObservation,
  type CompletionClaimReadRequest,
  type CompletionClaimReplacementRequest,
  CompletionClaimReplacementFailure,
  CompletionTaskAcknowledgement,
  CompletionTaskBoundary,
  type CompletionTaskRequest,
  CompletionTaskRequestFailure,
  CompletionTaskRequestLookup,
  type FocusedTaskCompletionFacts,
  FocusedTaskCompletionReadFailure,
  completionTaskClaimEquals,
  completionTaskRequestEquals,
  isExactTaskClaim
} from "./events.js"

/** Minimal in-memory boundary for deterministic completion-claim protocol tests. */
export const controlledCompletionClaimBoundaryLayerFrom = (initial: ReadonlyArray<CompletionClaimObservation>) =>
  Layer.effect(
    CompletionClaimBoundary,
    Effect.gen(function* () {
      const taskIdOf = (claim: CompletionClaimObservation): TaskId =>
        claim._tag === "CompletionTaskClaim" ? claim.plannedAttempt.taskId : claim.taskId
      const claims = yield* Ref.make<ReadonlyMap<TaskId, CompletionClaimObservation>>(
        new Map(initial.map((claim) => [taskIdOf(claim), claim] as const))
      )
      const readTaskClaim = Effect.fn("CompletionClaimBoundary.Controlled.readTaskClaim")(function* (
        request: CompletionClaimReadRequest
      ) {
        const current = (yield* Ref.get(claims)).get(request.taskId)
        return current ?? UnclaimedTask.make({ taskId: request.taskId })
      })
      const replaceTaskClaim = Effect.fn("CompletionClaimBoundary.Controlled.replaceTaskClaim")(function* (
        request: CompletionClaimReplacementRequest
      ) {
        const current = (yield* Ref.get(claims)).get(request.claim.plannedAttempt.taskId)
        if (current === undefined || current._tag === "UnclaimedTask") {
          return yield* new CompletionClaimReplacementFailure({
            detail: "active claim is absent",
            outcome: "DefinitelyNotApplied",
            request
          })
        }
        if (current._tag === "CompletionTaskClaim" && completionTaskClaimEquals(current, request.claim)) return current
        if (current._tag !== "ActiveTaskClaim" || !isExactTaskClaim(current, request.claim.originalClaim)) {
          return yield* new CompletionClaimReplacementFailure({
            detail: "current claim is not the exact active claim",
            outcome: "DefinitelyNotApplied",
            request
          })
        }
        yield* Ref.update(claims, (all) => new Map(all).set(request.claim.plannedAttempt.taskId, request.claim))
        return request.claim
      })
      const deleteTaskClaim = Effect.fn("CompletionClaimBoundary.Controlled.deleteTaskClaim")(function* (
        request: CompletionClaimDeletionRequest
      ) {
        const current = (yield* Ref.get(claims)).get(request.claim.plannedAttempt.taskId)
        if (current === undefined || current._tag === "UnclaimedTask") return
        if (current._tag !== "CompletionTaskClaim" || !completionTaskClaimEquals(current, request.claim)) {
          return yield* new CompletionClaimDeletionFailure({
            detail: "current claim is not the exact completion claim",
            outcome: "DefinitelyNotApplied",
            request
          })
        }
        yield* Ref.update(claims, (all) => {
          const next = new Map(all)
          next.delete(request.claim.plannedAttempt.taskId)
          return next
        })
      })
      return CompletionClaimBoundary.of({ readTaskClaim, replaceTaskClaim, deleteTaskClaim })
    })
  )

export const controlledCompletionClaimBoundaryLayer = controlledCompletionClaimBoundaryLayerFrom([])

type ControlledCompletionDecision =
  | { readonly _tag: "Accept"; readonly fact: FocusedTaskCompletionFacts }
  | { readonly _tag: "Reject"; readonly detail: string }

const decideControlledCompletion = (
  fact: FocusedTaskCompletionFacts | undefined,
  request: CompletionTaskRequest
): ControlledCompletionDecision => {
  if (fact === undefined) return { _tag: "Reject", detail: "current task completion facts are absent" }
  if (fact.lifecycle !== "Open") {
    return { _tag: "Reject", detail: `current task lifecycle is ${fact.lifecycle}, not Open` }
  }
  if (fact.targetMembership !== "Member") {
    return { _tag: "Reject", detail: "current task is not a member of the completion target" }
  }
  if (fact.unfinishedPrerequisiteTaskIds.length > 0) {
    return { _tag: "Reject", detail: "current task has unfinished prerequisites" }
  }
  if (fact.taskRevision !== request.taskRevision) {
    return { _tag: "Reject", detail: "current task revision does not match the completion request" }
  }
  if (
    fact.currentClaim._tag !== "CompletionTaskClaim" ||
    !completionTaskClaimEquals(fact.currentClaim, request.claim)
  ) {
    return { _tag: "Reject", detail: "current claim is not the exact completion claim" }
  }
  return { _tag: "Accept", fact }
}

/** Deterministic focused-completion boundary used by protocol and cassette tests. */
export const controlledCompletionTaskBoundaryLayerFrom = (
  initialFacts: ReadonlyArray<FocusedTaskCompletionFacts>,
  options: { readonly unreadableRequestOperationIds?: ReadonlySet<OperationId> } = {}
) =>
  Layer.effect(
    CompletionTaskBoundary,
    Effect.gen(function* () {
      const state = yield* Ref.make({
        appliedRequests: new Map<OperationId, CompletionTaskRequest>(),
        facts: new Map<TaskId, FocusedTaskCompletionFacts>(initialFacts.map((fact) => [fact.taskId, fact] as const))
      })
      const readFocusedTaskCompletion = Effect.fn("CompletionTaskBoundary.Controlled.readFocusedTaskCompletion")(
        function* (taskId: TaskId, target: TrackerTarget, operationId: OperationId) {
          const fact = (yield* Ref.get(state)).facts.get(taskId)
          if (fact === undefined || taskTrackerTargetKey(fact.target) !== taskTrackerTargetKey(target)) {
            return yield* new FocusedTaskCompletionReadFailure({
              detail: `no focused completion facts for ${taskId}`,
              taskId
            })
          }
          return { ...fact, operationId }
        }
      )
      const completeTask = Effect.fn("CompletionTaskBoundary.Controlled.completeTask")(function* (
        request: CompletionTaskRequest
      ) {
        const current = yield* Ref.get(state)
        const priorApplied = current.appliedRequests.get(request.operationId)
        if (priorApplied !== undefined) {
          if (!completionTaskRequestEquals(priorApplied, request)) {
            return yield* new CompletionTaskRequestFailure({
              detail: "completion operation identity is already bound to another request",
              outcome: "DefinitelyNotApplied",
              request
            })
          }
          return CompletionTaskAcknowledgement.make({ operationId: request.operationId, taskId: request.taskId })
        }
        const decision = decideControlledCompletion(current.facts.get(request.taskId), request)
        if (decision._tag === "Reject") {
          return yield* new CompletionTaskRequestFailure({
            detail: decision.detail,
            outcome: "DefinitelyNotApplied",
            request
          })
        }
        yield* Ref.set(state, {
          appliedRequests: new Map(current.appliedRequests).set(request.operationId, request),
          facts: new Map(current.facts).set(request.taskId, { ...decision.fact, lifecycle: "CompletedSuccessfully" })
        })
        return CompletionTaskAcknowledgement.make({ operationId: request.operationId, taskId: request.taskId })
      })
      const readCompletionRequest = Effect.fn("CompletionTaskBoundary.Controlled.readCompletionRequest")(function* (
        request: CompletionTaskRequest
      ) {
        if (options.unreadableRequestOperationIds?.has(request.operationId) === true) {
          return CompletionTaskRequestLookup.cases.Unreadable.make({
            detail: "controlled request lookup unreadable",
            request
          })
        }
        const applied = (yield* Ref.get(state)).appliedRequests.get(request.operationId)
        if (applied === undefined) return CompletionTaskRequestLookup.cases.NotApplied.make({ request })
        return completionTaskRequestEquals(applied, request)
          ? CompletionTaskRequestLookup.cases.Applied.make({ request })
          : CompletionTaskRequestLookup.cases.Unreadable.make({
              detail: "controlled request identity contradicts an already applied request",
              request
            })
      })
      return CompletionTaskBoundary.of({ readFocusedTaskCompletion, completeTask, readCompletionRequest })
    })
  )
