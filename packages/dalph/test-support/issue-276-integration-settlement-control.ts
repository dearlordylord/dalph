import {
  CompletionClaimBoundary,
  CompletionTaskBoundary,
  controlledCompletionClaimBoundaryLayerFrom,
  CompletionTaskAcknowledgement,
  CompletionTaskRequestLookup,
  completionTaskRequestEquals,
  FocusedTaskCompletionFacts,
  TrackerRevision,
  TargetPromotionGit,
  TargetPromotionCompareAndSetResult,
  TargetPromotionGitReadObservation,
  type CompletionTaskClaim,
  type CompletionTaskRequest,
  type TrackerMutation
} from "@dalph/orchestrator"
import { Effect, Ref } from "effect"
import type { GitCommitSha } from "@dalph/contracts"

/** Exact expected-head control shared by the six serialized integration turns. */
export const makeIssue276PromotionGit = (head: Ref.Ref<GitCommitSha>) =>
  TargetPromotionGit.of({
    compareAndSet: (request) =>
      Effect.gen(function* () {
        const current = yield* Ref.get(head)
        if (current !== request.expectedTargetHead) return yield* Effect.die("unexpected promotion head")
        yield* Ref.set(head, request.candidateCommit)
        return TargetPromotionCompareAndSetResult.cases.Applied.make({ newHeadSha: request.candidateCommit })
      }),
    read: (request) =>
      Ref.get(head).pipe(
        Effect.map((currentHeadSha) =>
          currentHeadSha === request.candidateCommit
            ? TargetPromotionGitReadObservation.cases.CandidateCurrent.make({ currentHeadSha })
            : TargetPromotionGitReadObservation.cases.CandidateNotInAncestry.make({ currentHeadSha })
        )
      )
  })

/**
 * Lets the next integration turn proceed using existing finality protocols.
 * This is controlled support for #276's ordering assertions, not #277 evidence.
 */
export const makeIssue276IntegrationSettlementControl = Effect.fn("Issue276.makeIntegrationSettlementControl")(
  function* (tracker: TrackerMutation["Service"]) {
    const boundaries = yield* Ref.make<ReadonlyMap<string, CompletionClaimBoundary["Service"]>>(new Map())
    const completed = yield* Ref.make<ReadonlyMap<string, CompletionTaskRequest>>(new Map())
    const boundaryFor = (claim: CompletionTaskClaim) =>
      Effect.gen(function* () {
        const taskId = claim.plannedAttempt.taskId
        const existing = (yield* Ref.get(boundaries)).get(taskId)
        if (existing !== undefined) return existing
        const active = yield* tracker.readTaskClaim(taskId).pipe(Effect.orDie)
        const boundary = yield* CompletionClaimBoundary.pipe(
          Effect.provide(controlledCompletionClaimBoundaryLayerFrom([active]))
        )
        yield* Ref.update(boundaries, (all) => new Map(all).set(taskId, boundary))
        return boundary
      })
    const existingFor = (taskId: string) =>
      Ref.get(boundaries).pipe(
        Effect.flatMap((all) => {
          const boundary = all.get(taskId)
          return boundary === undefined
            ? Effect.die("settlement control has no exact integration turn")
            : Effect.succeed(boundary)
        })
      )
    const claimBoundary = CompletionClaimBoundary.of({
      readTaskClaim: (request) =>
        boundaryFor(request.expectedClaim).pipe(Effect.flatMap((boundary) => boundary.readTaskClaim(request))),
      readCompletionClaimMarker: (request) =>
        boundaryFor(request.expectedClaim).pipe(
          Effect.flatMap((boundary) => boundary.readCompletionClaimMarker(request))
        ),
      replaceTaskClaim: (request) =>
        boundaryFor(request.claim).pipe(Effect.flatMap((boundary) => boundary.replaceTaskClaim(request))),
      deleteTaskClaim: (request) =>
        boundaryFor(request.claim).pipe(Effect.flatMap((boundary) => boundary.deleteTaskClaim(request))),
      readOriginalTaskClaim: (taskId) =>
        existingFor(taskId).pipe(Effect.flatMap((boundary) => boundary.readOriginalTaskClaim(taskId))),
      releaseOriginalTaskClaim: (request) =>
        existingFor(request.claim.taskId).pipe(Effect.flatMap((boundary) => boundary.releaseOriginalTaskClaim(request)))
    })
    const taskBoundary = CompletionTaskBoundary.of({
      completeTask: (request) =>
        Ref.update(completed, (all) => new Map(all).set(request.taskId, request)).pipe(
          Effect.as(CompletionTaskAcknowledgement.make({ operationId: request.operationId, taskId: request.taskId }))
        ),
      readCompletionRequest: (request) =>
        Ref.get(completed).pipe(
          Effect.map((all) => {
            const applied = all.get(request.taskId)
            return applied !== undefined && completionTaskRequestEquals(applied, request)
              ? CompletionTaskRequestLookup.cases.Applied.make({ request })
              : CompletionTaskRequestLookup.cases.NotApplied.make({ request })
          })
        ),
      readFocusedTaskCompletion: (request) =>
        Effect.gen(function* () {
          const currentClaim = yield* claimBoundary.readTaskClaim(request).pipe(Effect.orDie)
          return FocusedTaskCompletionFacts.make({
            currentClaim,
            lifecycle: (yield* Ref.get(completed)).has(request.taskId) ? "CompletedSuccessfully" : "Open",
            operationId: request.operationId,
            target: request.target,
            targetMembership: "Member",
            taskId: request.taskId,
            taskRevision: request.expectedClaim.plannedAttempt.taskRevision,
            trackerRevision: TrackerRevision.make("issue-276-controlled-turn"),
            unfinishedPrerequisiteTaskIds: []
          })
        })
    })
    return { claimBoundary, taskBoundary }
  }
)
