import { Effect } from "effect"
import { expect, it } from "vitest"
import {
  AcceptedResult,
  AttemptId,
  GitCommitSha,
  GitRepositoryLocator,
  IntegrationTarget,
  IntegrationTargetRef,
  PlannedTaskAttempt,
  RunId,
  TaskBranchRef,
  TaskExecutorLocator,
  TaskId,
  TaskRevision,
  WorktreeLocator
} from "@dalph/contracts"
import { InRunJournal } from "../../workflow-journal/store.js"
import {
  AcceptedResultNotDurable,
  IntegrationJournalUnavailable
} from "../../workflow/protocols/integration-admission/protocol.js"
import { makeIntegrationStageContext } from "./integration-stage-context.js"

it("fails with a typed error when a fresh accepted result has no ambient journal", async () => {
  const plannedAttempt = PlannedTaskAttempt.make({
    attemptId: AttemptId.make("missing-integration-journal-attempt"),
    baseSha: GitCommitSha.make("1".repeat(40)),
    branch: TaskBranchRef.make("refs/heads/dalph/missing-integration-journal"),
    executor: TaskExecutorLocator.make("executor:controlled-fake"),
    runId: RunId.make("missing-integration-journal-run"),
    taskId: TaskId.make("A"),
    taskRevision: TaskRevision.make("revision-A"),
    worktree: WorktreeLocator.make("/worktrees/missing-integration-journal")
  })
  const context = await Effect.runPromise(makeIntegrationStageContext())
  const failure = await Effect.runPromise(
    Effect.flip(
      context.queueAcceptedResult(
        plannedAttempt,
        AcceptedResult.make({ commit: GitCommitSha.make("a".repeat(40)) }),
        IntegrationTarget.make({
          repository: GitRepositoryLocator.make("/repo/.git"),
          ref: IntegrationTargetRef.make("refs/heads/master")
        })
      ) as Effect.Effect<void, IntegrationJournalUnavailable>
    )
  )

  expect(failure).toEqual(
    new IntegrationJournalUnavailable({ attemptId: plannedAttempt.attemptId, runId: plannedAttempt.runId })
  )
})

it("uses the ambient journal when a fresh accepted result is queued", async () => {
  const plannedAttempt = PlannedTaskAttempt.make({
    attemptId: AttemptId.make("available-integration-journal-attempt"),
    baseSha: GitCommitSha.make("1".repeat(40)),
    branch: TaskBranchRef.make("refs/heads/dalph/available-integration-journal"),
    executor: TaskExecutorLocator.make("executor:controlled-fake"),
    runId: RunId.make("available-integration-journal-run"),
    taskId: TaskId.make("A"),
    taskRevision: TaskRevision.make("revision-A"),
    worktree: WorktreeLocator.make("/worktrees/available-integration-journal")
  })
  const context = await Effect.runPromise(
    makeIntegrationStageContext().pipe(
      Effect.provideService(
        InRunJournal,
        InRunJournal.of({
          append: () => Effect.die("append is unreachable without a durable accepted result"),
          read: () => Effect.succeed([])
        })
      )
    )
  )
  const failure = await Effect.runPromise(
    Effect.flip(
      Effect.gen(function* () {
        yield* context.queueAcceptedResult(
          plannedAttempt,
          AcceptedResult.make({ commit: GitCommitSha.make("a".repeat(40)) }),
          IntegrationTarget.make({
            repository: GitRepositoryLocator.make("/repo/.git"),
            ref: IntegrationTargetRef.make("refs/heads/master")
          })
        )
      })
    )
  )

  expect(failure).toEqual(
    new AcceptedResultNotDurable({ attemptId: plannedAttempt.attemptId, runId: plannedAttempt.runId })
  )
})
