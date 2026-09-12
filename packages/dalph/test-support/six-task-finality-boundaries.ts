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
  EvidenceStore,
  type TargetPromotionGitRequest,
  type CompletionTaskClaim,
  type CompletionTaskRequest,
  type CompletionClaimBoundaryService,
  type CompletionTaskBoundaryService,
  type TrackerMutationService
} from "@dalph/orchestrator"
import { Effect, Ref } from "effect"
import type { EvidenceReference, GitCommitSha, TaskId } from "@dalph/contracts"

/** Exact expected-head control shared by the six serialized integration turns. */
const makeSixTaskPromotionGit = (head: Ref.Ref<GitCommitSha>) =>
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

/** Records actual owning-boundary reads and offers without choosing workflow actions. */
export const makeSixTaskGitAndEvidence = Effect.fn("SixTaskDelivery.makeGitAndEvidence")(function* (
  underlyingEvidence: EvidenceStore["Service"],
  initialHead: GitCommitSha
) {
  const evidenceReads = yield* Ref.make<ReadonlyArray<EvidenceReference>>([])
  const evidence = EvidenceStore.of({
    ...underlyingEvidence,
    read: (reference) =>
      Ref.update(evidenceReads, (all) => [...all, reference]).pipe(Effect.andThen(underlyingEvidence.read(reference)))
  })
  const head = yield* Ref.make(initialHead)
  const underlyingGit = makeSixTaskPromotionGit(head)
  const promotions = yield* Ref.make<ReadonlyArray<TargetPromotionGitRequest>>([])
  const promotionReads = yield* Ref.make<ReadonlyArray<TargetPromotionGitRequest>>([])
  const promotionGit = TargetPromotionGit.of({
    compareAndSet: (request) =>
      Ref.update(promotions, (all) => [...all, request]).pipe(Effect.andThen(underlyingGit.compareAndSet(request))),
    read: (request) =>
      Ref.update(promotionReads, (all) => [...all, request]).pipe(Effect.andThen(underlyingGit.read(request)))
  })
  return { evidence, evidenceReads, head, promotions, promotionReads, promotionGit }
})

/**
 * Owns controlled tracker facts for both six-task fixtures. Tests must inspect
 * production records and exact boundary calls rather than infer finality here.
 */
interface SixTaskFinalityBoundaries {
  readonly claimBoundary: CompletionClaimBoundaryService
  readonly taskBoundary: CompletionTaskBoundaryService
}

export const makeSixTaskFinalityBoundaries = Effect.fn("SixTaskDelivery.makeFinalityBoundaries")(function* (
  tracker: TrackerMutationService
): Effect.fn.Return<SixTaskFinalityBoundaries> {
  const boundaries = yield* Ref.make<ReadonlyMap<TaskId, CompletionClaimBoundaryService>>(new Map())
  const completed = yield* Ref.make<ReadonlyMap<TaskId, CompletionTaskRequest>>(new Map())
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
  const existingFor = (taskId: TaskId) =>
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
})
