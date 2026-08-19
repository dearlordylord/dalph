import { Effect } from "effect"
import { acceptedResultFixture } from "../../../test/support/evidence.js"
import { expect, it } from "vitest"
import {
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
  AcceptedResultEvidenceUnavailable,
  IntegrationJournalUnavailable
} from "../../workflow/protocols/integration-admission/protocol.js"
import { EvidenceStore } from "../../workflow/protocols/evidence-store.js"
import { makeIntegrationStageContext } from "./integration-stage-context.js"

const plannedAttemptFixture = (name: string) =>
  PlannedTaskAttempt.make({
    attemptId: AttemptId.make(`${name}-attempt`),
    baseSha: GitCommitSha.make("1".repeat(40)),
    branch: TaskBranchRef.make(`refs/heads/dalph/${name}`),
    executor: TaskExecutorLocator.make("executor:controlled-fake"),
    runId: RunId.make(`${name}-run`),
    taskId: TaskId.make("A"),
    taskRevision: TaskRevision.make("revision-A"),
    worktree: WorktreeLocator.make(`/worktrees/${name}`)
  })

const integrationTarget = IntegrationTarget.make({
  repository: GitRepositoryLocator.make("/repo/.git"),
  ref: IntegrationTargetRef.make("refs/heads/master")
})

it("fails with a typed error when a fresh accepted result has no ambient journal", async () => {
  const plannedAttempt = plannedAttemptFixture("missing-integration-journal")
  const context = await Effect.runPromise(makeIntegrationStageContext())
  const failure = await Effect.runPromise(
    Effect.flip(
      Effect.gen(function* () {
        yield* context.queueAcceptedResult(
          plannedAttempt,
          acceptedResultFixture(GitCommitSha.make("a".repeat(40))),
          integrationTarget
        )
      })
    )
  )

  expect(failure).toEqual(
    new IntegrationJournalUnavailable({ attemptId: plannedAttempt.attemptId, runId: plannedAttempt.runId })
  )
})

it("uses the ambient journal when a fresh accepted result is queued", async () => {
  const plannedAttempt = plannedAttemptFixture("available-integration-journal")
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
          acceptedResultFixture(GitCommitSha.make("a".repeat(40))),
          integrationTarget
        )
      })
    )
  )

  expect(failure).toEqual(
    new AcceptedResultEvidenceUnavailable({
      attemptId: plannedAttempt.attemptId,
      detail: "acceptance evidence store is not configured for this run activation",
      reference: acceptedResultFixture(GitCommitSha.make("a".repeat(40))).evidenceManifest,
      runId: plannedAttempt.runId
    })
  )
})

it("uses both ambient boundaries before delegating accepted-result admission", async () => {
  const plannedAttempt = plannedAttemptFixture("available-integration-boundaries")
  const context = await Effect.runPromise(
    makeIntegrationStageContext().pipe(
      Effect.provideService(
        InRunJournal,
        InRunJournal.of({ append: () => Effect.die("append is unreachable"), read: () => Effect.succeed([]) })
      ),
      Effect.provideService(
        EvidenceStore,
        EvidenceStore.of({ put: () => Effect.die("put is unreachable"), read: () => Effect.die("read is unreachable") })
      )
    )
  )

  const failure = await Effect.runPromise(
    Effect.flip(
      Effect.gen(function* () {
        yield* context.queueAcceptedResult(
          plannedAttempt,
          acceptedResultFixture(GitCommitSha.make("a".repeat(40))),
          integrationTarget
        )
      })
    )
  )

  expect(failure).toEqual(
    new AcceptedResultNotDurable({ attemptId: plannedAttempt.attemptId, runId: plannedAttempt.runId })
  )
})
