import { Effect } from "effect"
import { it } from "@effect/vitest"
import { acceptedResultFixture } from "../../../test/support/evidence.js"
import { expect } from "vitest"
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
import { InRunJournal, JournalStore } from "../../workflow-journal/store.js"
import { AcceptedJournalReader } from "../../workflow-journal/accepted-reader.js"
import { memoryJournalTestLayer } from "../../workflow-journal/adapters/memory-store.js"
import { reduceWorkflowJournalHistory } from "../reconstruction/history.js"
import { makeJournal } from "../delivery/journal.js"
import { FixtureTarget } from "../../authorities/task-tracker/fixture/target.js"
import { InitialControlPolicy } from "../../control/policy.js"
import { TaskWorkCapacity } from "../admission/capacity.js"
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

const makeIntegrationJournal = Effect.fn("IntegrationStageContextTest.makeJournal")(function* (
  plannedAttempt: PlannedTaskAttempt
) {
  const storage = yield* JournalStore
  const target = FixtureTarget.make(`${plannedAttempt.runId}-target`)
  yield* storage.beginRun(
    plannedAttempt.runId,
    target,
    InitialControlPolicy.make({ taskExecutionCapacity: TaskWorkCapacity.make(1) })
  )
  const initial = reduceWorkflowJournalHistory(plannedAttempt.runId, yield* storage.read(plannedAttempt.runId))
  if (initial._tag !== "ValidWorkflowJournalHistory") return yield* Effect.die(initial)
  return yield* makeJournal(plannedAttempt.runId, target, initial, storage)
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

it.effect("uses the ambient journal when a fresh accepted result is queued", () =>
  Effect.gen(function* () {
    const plannedAttempt = plannedAttemptFixture("available-integration-journal")
    const journal = yield* makeIntegrationJournal(plannedAttempt)
    const context = yield* makeIntegrationStageContext().pipe(
      Effect.provideService(InRunJournal, InRunJournal.of({ append: journal.append, read: journal.read })),
      Effect.provideService(AcceptedJournalReader, AcceptedJournalReader.of({ readAccepted: journal.readAccepted }))
    )
    const failure = yield* context
      .queueAcceptedResult(plannedAttempt, acceptedResultFixture(GitCommitSha.make("a".repeat(40))), integrationTarget)
      .pipe(Effect.flip)

    expect(failure).toEqual(
      new AcceptedResultEvidenceUnavailable({
        attemptId: plannedAttempt.attemptId,
        detail: "acceptance evidence store is not configured for this run activation",
        reference: acceptedResultFixture(GitCommitSha.make("a".repeat(40))).evidenceManifest,
        runId: plannedAttempt.runId
      })
    )
  }).pipe(Effect.provide(memoryJournalTestLayer))
)

it.effect("uses both ambient boundaries before delegating accepted-result admission", () =>
  Effect.gen(function* () {
    const plannedAttempt = plannedAttemptFixture("available-integration-boundaries")
    const journal = yield* makeIntegrationJournal(plannedAttempt)
    const context = yield* makeIntegrationStageContext().pipe(
      Effect.provideService(InRunJournal, InRunJournal.of({ append: journal.append, read: journal.read })),
      Effect.provideService(AcceptedJournalReader, AcceptedJournalReader.of({ readAccepted: journal.readAccepted })),
      Effect.provideService(
        EvidenceStore,
        EvidenceStore.of({ put: () => Effect.die("put is unreachable"), read: () => Effect.die("read is unreachable") })
      )
    )

    const failure = yield* context
      .queueAcceptedResult(plannedAttempt, acceptedResultFixture(GitCommitSha.make("a".repeat(40))), integrationTarget)
      .pipe(Effect.flip)

    expect(failure).toEqual(
      new AcceptedResultNotDurable({ attemptId: plannedAttempt.attemptId, runId: plannedAttempt.runId })
    )
  }).pipe(Effect.provide(memoryJournalTestLayer))
)
