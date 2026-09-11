import { it } from "@effect/vitest"
import {
  AttemptId,
  GitCommitSha,
  PlannedTaskAttempt,
  RunId,
  TaskBranchRef,
  TaskExecutorLocator,
  TaskId,
  WorktreeLocator,
  makeTaskWorkSpecification
} from "@dalph/contracts"
import {
  AcceptedJournalReader,
  FixtureTarget,
  InRunJournal,
  JournalDatabaseLocator,
  OperationId,
  intentRecordKey,
  makeTaskWorkSpecificationObservationOperation,
  taskTrackerReadIntent
} from "@dalph/orchestrator"
import { Effect } from "effect"
import { describe, expect } from "vitest"
import { qualificationWorkflowJournalLayer } from "./qualification-journal.js"

const runId = RunId.make("qualification-live-journal-test")
const taskId = TaskId.make("qualification-task")
const specification = makeTaskWorkSpecification({ body: "Qualify Codex.", taskId, title: "Qualification" })
const attempt = PlannedTaskAttempt.make({
  attemptId: AttemptId.make("qualification-attempt"),
  baseSha: GitCommitSha.make("a".repeat(40)),
  branch: TaskBranchRef.make("refs/heads/qualification"),
  executor: TaskExecutorLocator.make("executor:qualification"),
  runId,
  taskId,
  taskRevision: specification.fingerprint,
  worktree: WorktreeLocator.make("/worktrees/qualification")
})

describe("qualification workflow journal", () => {
  it.effect("publishes executor-boundary appends through the same accepted SQLite lifecycle", () =>
    Effect.gen(function* () {
      const journal = yield* InRunJournal
      const accepted = yield* AcceptedJournalReader
      expect((yield* accepted.readAccepted(runId)).lastPosition).toBe(3)

      const operation = makeTaskWorkSpecificationObservationOperation(
        OperationId.make("qualification-live-follow-up"),
        FixtureTarget.make("qualification"),
        taskId,
        [OperationId.make("qualification-original-specification")]
      )
      yield* journal.append(runId, intentRecordKey(operation.operationId), taskTrackerReadIntent(operation))

      expect((yield* accepted.readAccepted(runId)).lastPosition).toBe(4)
    }).pipe(
      Effect.provide(
        qualificationWorkflowJournalLayer({ attempt, filename: JournalDatabaseLocator.make(":memory:"), specification })
      )
    )
  )
})
