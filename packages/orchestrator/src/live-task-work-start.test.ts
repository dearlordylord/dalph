import { NodeFileSystem } from "@effect/platform-node"
import { it } from "@effect/vitest"
import { Effect, FileSystem, Layer, Ref } from "effect"
import { expect } from "vitest"
import {
  AttemptId,
  ClaimOwner,
  ClaimToken,
  GitCommitSha,
  GitCommonDirectoryTarget,
  OperationId,
  PlannedTaskAttempt,
  ProviderObservationId,
  ProviderRequestId,
  ReviewerSessionId,
  RunId,
  SemanticReviewRound,
  TaskBranchRef,
  TaskExecutorLocator,
  TaskId,
  TaskLifecycle,
  TaskRevision,
  TaskWorkSessionId,
  TaskWorkSessionLocator,
  WorktreeLocator
} from "./domain.js"
import { GitWorktree, gitWorktreeTestLayer, PlannedWorktreeAbsent } from "./git-worktree.js"
import {
  EvidenceDigest,
  EvidenceReference,
  ImplementationEvidenceManifest,
  SealedImplementationEvidence
} from "./implementation-evidence.js"
import {
  AuthorizedImplementationReviewRequest,
  ImplementationReviewDisposition,
  ImplementationReviewer,
  ReviewFindingsHandback,
  ReviewFindingsHandbackAcknowledged,
  ReviewFindingsHandbackRequest,
  SealedImplementationReview
} from "./implementation-review.js"
import {
  controlledCoordinatorLockLayer,
  controlledTrackerMutationLayer,
  coordinatorOwnedGitWorktreeLayer,
  coordinatorOwnedImplementationReviewLayer,
  coordinatorOwnedTaskRunnerLayer,
  coordinatorOwnedTrackerMutationLayer,
  coordinatorOwnershipLayer,
  TaskClaimAcquisition,
  TrackerMutation
} from "./index.js"
import { taskRevisionFor } from "./task-dag.js"
import { MatchingTaskWorkSessionReported, TaskRunner, TaskWorkStartRequest } from "./task-work-start.js"

it.effect("shares one ownership capability across guarded starts and read-only lookups", () =>
  Effect.gen(function*() {
    const fileSystem = yield* FileSystem.FileSystem
    const directory = yield* fileSystem.makeTempDirectoryScoped({ prefix: "dalph-owner-" })
    const target = GitCommonDirectoryTarget.make(directory)
    const starts = yield* Ref.make(0)
    const lookups = yield* Ref.make(0)
    const runnerLayer = Layer.succeed(
      TaskRunner,
      TaskRunner.of({
        lookupTaskWorkSession: Effect.fn("TaskRunner.OwnershipTest.lookup")(function*(lookup) {
          yield* Ref.update(lookups, (count) => count + 1)
          return MatchingTaskWorkSessionReported.make({
            observationId: ProviderObservationId.make("ownership-lookup"),
            sessionId: TaskWorkSessionId.make(`session:${lookup.operationId}`),
            work: { _tag: "NoProviderWorkReported" }
          })
        }),
        requestTaskWorkStart: Effect.fn("TaskRunner.OwnershipTest.start")(function*() {
          yield* Ref.update(starts, (count) => count + 1)
          return {
            observationId: ProviderObservationId.make("ownership-request-observation"),
            providerRequestId: ProviderRequestId.make("ownership-request")
          }
        })
      })
    )
    const ownedRunnerLayer = coordinatorOwnedTaskRunnerLayer(runnerLayer).pipe(
      Layer.provide(coordinatorOwnershipLayer(target)),
      Layer.provide(controlledCoordinatorLockLayer)
    )
    const taskId = TaskId.make("task")
    const task = {
      id: taskId,
      lifecycle: TaskLifecycle.cases.Open.make({}),
      parentTaskId: null,
      prerequisiteIds: []
    }
    const plannedAttempt = PlannedTaskAttempt.make({
      attemptId: AttemptId.make("attempt"),
      baseSha: GitCommitSha.make("0000000000000000000000000000000000000000"),
      branch: TaskBranchRef.make("refs/heads/task"),
      executor: TaskExecutorLocator.make("executor:ownership-test"),
      runId: RunId.make("run"),
      session: TaskWorkSessionLocator.make("session:ownership-test"),
      taskId,
      taskRevision: taskRevisionFor(task),
      worktree: WorktreeLocator.make(`${directory}/task`)
    })
    const request = TaskWorkStartRequest.make({
      operationId: OperationId.make("operation"),
      plannedAttempt,
      task
    })

    yield* Effect.gen(function*() {
      const runner = yield* TaskRunner
      yield* runner.requestTaskWorkStart(request)
      yield* runner.lookupTaskWorkSession({
        operationId: request.operationId,
        plannedAttempt
      })
    }).pipe(Effect.provide(ownedRunnerLayer))

    expect(yield* Ref.get(starts)).toBe(1)
    expect(yield* Ref.get(lookups)).toBe(1)
  }).pipe(Effect.provide(NodeFileSystem.layer)))

it.effect("guards claim acquisition and release while leaving observation read-only", () =>
  Effect.gen(function*() {
    const fileSystem = yield* FileSystem.FileSystem
    const directory = yield* fileSystem.makeTempDirectoryScoped({
      prefix: "dalph-claim-owner-"
    })
    const target = GitCommonDirectoryTarget.make(directory)
    const ownedTrackerLayer = coordinatorOwnedTrackerMutationLayer(
      controlledTrackerMutationLayer
    ).pipe(
      Layer.provide(coordinatorOwnershipLayer(target)),
      Layer.provide(controlledCoordinatorLockLayer)
    )
    const acquisition = TaskClaimAcquisition.make({
      operationId: OperationId.make("owned-claim-operation"),
      owner: ClaimOwner.make("owned-claim-owner"),
      taskId: TaskId.make("owned-claim-task"),
      token: ClaimToken.make("owned-claim-token")
    })

    yield* Effect.gen(function*() {
      const tracker = yield* TrackerMutation
      expect((yield* tracker.readTaskClaim(acquisition.taskId))._tag).toBe(
        "UnclaimedTask"
      )
      const claim = yield* tracker.acquireTaskClaim(acquisition)
      expect(yield* tracker.readTaskClaim(acquisition.taskId)).toEqual(claim)
      yield* tracker.releaseTaskClaim(claim)
    }).pipe(Effect.provide(ownedTrackerLayer))
  }).pipe(Effect.provide(NodeFileSystem.layer)))

it.effect("guards worktree creation while leaving Git observation read-only", () =>
  Effect.gen(function*() {
    const fileSystem = yield* FileSystem.FileSystem
    const directory = yield* fileSystem.makeTempDirectoryScoped({ prefix: "dalph-git-owner-" })
    const target = GitCommonDirectoryTarget.make(directory)
    const ownedGitLayer = coordinatorOwnedGitWorktreeLayer(
      gitWorktreeTestLayer(PlannedWorktreeAbsent.make({}))
    ).pipe(
      Layer.provide(coordinatorOwnershipLayer(target)),
      Layer.provide(controlledCoordinatorLockLayer)
    )
    const plannedAttempt = PlannedTaskAttempt.make({
      attemptId: AttemptId.make("git-owned-attempt"),
      baseSha: GitCommitSha.make("0000000000000000000000000000000000000000"),
      branch: TaskBranchRef.make("refs/heads/git-owned"),
      executor: TaskExecutorLocator.make("executor:test"),
      runId: RunId.make("git-owned-run"),
      session: TaskWorkSessionLocator.make("git-owned-session"),
      taskId: TaskId.make("git-owned-task"),
      taskRevision: TaskRevision.make("git-owned-revision"),
      worktree: WorktreeLocator.make(`${directory}/worktree`)
    })

    yield* Effect.gen(function*() {
      const git = yield* GitWorktree
      expect((yield* git.readPlannedWorktree(plannedAttempt))._tag)
        .toBe("PlannedWorktreeAbsent")
      yield* git.createPlannedWorktree(plannedAttempt)
      expect((yield* git.readPlannedWorktree(plannedAttempt))._tag)
        .toBe("PlannedWorktreeReady")
    }).pipe(Effect.provide(ownedGitLayer))
  }).pipe(Effect.provide(NodeFileSystem.layer)))

it.effect("guards reviewer invocation and exact findings handback", () =>
  Effect.gen(function*() {
    const fileSystem = yield* FileSystem.FileSystem
    const directory = yield* fileSystem.makeTempDirectoryScoped({ prefix: "dalph-review-owner-" })
    const target = GitCommonDirectoryTarget.make(directory)
    const calls = yield* Ref.make<ReadonlyArray<string>>([])
    const taskId = TaskId.make("review-owned-task")
    const task = {
      id: taskId,
      lifecycle: TaskLifecycle.cases.Open.make({}),
      parentTaskId: null,
      prerequisiteIds: []
    }
    const plannedAttempt = PlannedTaskAttempt.make({
      attemptId: AttemptId.make("review-owned-attempt"),
      baseSha: GitCommitSha.make("0000000000000000000000000000000000000000"),
      branch: TaskBranchRef.make("refs/heads/review-owned"),
      executor: TaskExecutorLocator.make("executor:review-owned"),
      runId: RunId.make("review-owned-run"),
      session: TaskWorkSessionLocator.make("session:review-owned"),
      taskId,
      taskRevision: taskRevisionFor(task),
      worktree: WorktreeLocator.make(`${directory}/review-worktree`)
    })
    const reference = EvidenceReference.make({
      byteLength: 1,
      digest: EvidenceDigest.make("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")
    })
    const implementationEvidence = SealedImplementationEvidence.make({
      manifest: ImplementationEvidenceManifest.make({
        diff: reference,
        implementationOutput: reference,
        plannedBaseSha: plannedAttempt.baseSha,
        predecessorOperationId: OperationId.make("review-owned-implementer"),
        runId: plannedAttempt.runId,
        stage: "Implementation",
        taskId
      }),
      manifestReference: reference
    })
    const request = AuthorizedImplementationReviewRequest.make({
      evidenceSealingOperationId: OperationId.make("review-owned-sealing"),
      findingHistory: [],
      implementationEvidence,
      implementerInvocationId: implementationEvidence.manifest.predecessorOperationId,
      implementerSessionId: TaskWorkSessionId.make("review-owned-session"),
      operationId: OperationId.make("review-owned-operation"),
      plannedAttempt,
      predecessorEvidenceReference: reference,
      reviewerSessionId: ReviewerSessionId.make("review-owned-reviewer"),
      round: SemanticReviewRound.make(1)
    })
    const review = SealedImplementationReview.make({
      manifest: {
        disposition: ImplementationReviewDisposition.cases.Accepted.make({}),
        findingHistory: [],
        implementationEvidenceReference: reference,
        implementerInvocationId: request.implementerInvocationId,
        implementerSessionId: request.implementerSessionId,
        operationId: request.operationId,
        plannedAttempt,
        predecessorEvidenceReference: reference,
        reviewerSessionId: request.reviewerSessionId,
        round: request.round,
        stage: "ImplementationReview"
      },
      manifestReference: reference
    })
    const handbackRequest = ReviewFindingsHandbackRequest.make({
      implementerInvocationId: request.implementerInvocationId,
      implementerSessionId: request.implementerSessionId,
      operationId: OperationId.make("review-owned-handback"),
      plannedAttempt,
      review,
      reviewOperationId: request.operationId
    })
    const adapter = Layer.merge(
      Layer.succeed(
        ImplementationReviewer,
        ImplementationReviewer.of({
          createOrResume: () =>
            Ref.update(calls, (current) => [...current, "review"]).pipe(
              Effect.as(ImplementationReviewDisposition.cases.Accepted.make({}))
            )
        })
      ),
      Layer.succeed(
        ReviewFindingsHandback,
        ReviewFindingsHandback.of({
          deliverOrResume: () =>
            Ref.update(calls, (current) => [...current, "handback"]).pipe(
              Effect.as(ReviewFindingsHandbackAcknowledged.make({
                operationId: handbackRequest.operationId,
                reviewEvidenceReference: reference
              }))
            )
        })
      )
    )
    const owned = coordinatorOwnedImplementationReviewLayer(adapter).pipe(
      Layer.provide(coordinatorOwnershipLayer(target)),
      Layer.provide(controlledCoordinatorLockLayer)
    )
    yield* Effect.gen(function*() {
      yield* (yield* ImplementationReviewer).createOrResume(request)
      yield* (yield* ReviewFindingsHandback).deliverOrResume(handbackRequest)
    }).pipe(Effect.provide(owned))
    expect(yield* Ref.get(calls)).toEqual(["review", "handback"])
  }).pipe(Effect.provide(NodeFileSystem.layer)))
