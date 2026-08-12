import {
  AttemptId,
  GitCommitSha,
  PlannedTaskAttempt,
  RunId,
  TaskBranchRef,
  TaskExecutorLocator,
  TaskId,
  TaskRevision,
  WorktreeLocator
} from "@dalph/contracts"
import { GitCommonDirectoryTarget } from "@dalph/orchestrator"
import { Schema } from "effect"

export const preservedArtifact = "dalph-preserved-work.txt"
export const preservedArtifactContents = "uncommitted executor work must survive application Exit\n"
export const fixtureTaskBranch = TaskBranchRef.make("refs/heads/dalph/linux-host-attempt")

/** Locates the fixture's optional plain-text evidence file, not Dalph's workflow-journal database or history authority. */
export const JournalEvidenceLocator = Schema.NonEmptyString.pipe(Schema.brand("JournalEvidenceLocator"))
export type JournalEvidenceLocator = typeof JournalEvidenceLocator.Type
const JournalPath = Schema.Union([JournalEvidenceLocator, Schema.Undefined])

export const RunningHostFixtureInput = Schema.Struct({
  baseSha: GitCommitSha,
  gitCommonDirectory: GitCommonDirectoryTarget,
  journalPath: JournalPath,
  mode: Schema.Literal("running"),
  worktree: WorktreeLocator
})
export type RunningHostFixtureInput = typeof RunningHostFixtureInput.Type

export const OtherHostFixtureInput = Schema.Struct({
  gitCommonDirectory: GitCommonDirectoryTarget,
  journalPath: JournalPath,
  mode: Schema.Literals(["acquire-once", "failed", "idle", "stuck", "stuck-repeat"])
})
export type OtherHostFixtureInput = typeof OtherHostFixtureInput.Type

export const HostFixtureInput = Schema.Union([RunningHostFixtureInput, OtherHostFixtureInput])
export type HostFixtureInput = typeof HostFixtureInput.Type

export const makeFixturePlannedAttempt = (input: RunningHostFixtureInput) =>
  PlannedTaskAttempt.make({
    attemptId: AttemptId.make("linux-host-attempt"),
    baseSha: input.baseSha,
    branch: fixtureTaskBranch,
    executor: TaskExecutorLocator.make("executor:controlled-fake"),
    runId: RunId.make("linux-host-run"),
    taskId: TaskId.make("linux-host-task"),
    taskRevision: TaskRevision.make("linux-host-task-revision"),
    worktree: input.worktree
  })
