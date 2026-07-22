import { describe, expect, it } from "vitest"
import {
  AttemptId,
  GitCommitSha,
  PlannedTaskAttempt,
  RunId,
  TaskBranchRef,
  TaskExecutorLocator,
  TaskId,
  TaskRevision,
  TaskWorkSessionLocator,
  WorktreeLocator
} from "./domain.js"
import {
  claimAuthorityMatches,
  executionAuthorityMatches,
  sessionAuthorityMatches,
  worktreeAuthorityMatches
} from "./workflow-authority-relations.js"

const plan = PlannedTaskAttempt.make({
  attemptId: AttemptId.make("authority-relations-attempt"),
  baseSha: GitCommitSha.make("0000000000000000000000000000000000000000"),
  branch: TaskBranchRef.make("refs/heads/authority-relations"),
  executor: TaskExecutorLocator.make("executor:authority-relations"),
  runId: RunId.make("authority-relations-run"),
  session: TaskWorkSessionLocator.make("session:authority-relations"),
  taskId: TaskId.make("authority-relations-task"),
  taskRevision: TaskRevision.make("authority-relations-revision"),
  worktree: WorktreeLocator.make("/tmp/authority-relations")
})

describe("workflow authority relations", () => {
  it("keeps exact claims while rejecting absence and owner-capability drift", () => {
    const durable = { operationId: "claim", owner: "owner", taskId: "task", token: "token" }
    expect(claimAuthorityMatches({ _tag: "ActiveTaskClaim", ...durable } as never, durable as never)).toBe(true)
    expect(claimAuthorityMatches({ _tag: "UnclaimedTask", taskId: "task" } as never, durable as never)).toBe(false)
    expect(claimAuthorityMatches(
      { _tag: "ActiveTaskClaim", ...durable, token: "foreign" } as never,
      durable as never
    )).toBe(false)
  })

  it("allows descendant HEAD progress but rejects branch, path, Base, and absent drift", () => {
    const ready = {
      _tag: "PlannedWorktreeReady",
      baseSha: plan.baseSha,
      branch: plan.branch,
      headSha: GitCommitSha.make("1111111111111111111111111111111111111111"),
      worktree: plan.worktree
    } as const
    expect(worktreeAuthorityMatches(ready, plan)).toBe(true)
    expect(worktreeAuthorityMatches({ ...ready, branch: TaskBranchRef.make("refs/heads/foreign") }, plan)).toBe(false)
    expect(worktreeAuthorityMatches({ ...ready, worktree: WorktreeLocator.make("/tmp/foreign") }, plan)).toBe(false)
    expect(worktreeAuthorityMatches({
      ...ready,
      baseSha: GitCommitSha.make("2222222222222222222222222222222222222222")
    }, plan)).toBe(false)
    expect(worktreeAuthorityMatches({ _tag: "PlannedWorktreeAbsent" }, plan)).toBe(false)
  })

  it("requires the exact completed session identity", () => {
    const matching = { _tag: "MatchingTaskWorkSessionReported", sessionId: "session" }
    expect(sessionAuthorityMatches(matching as never, "session" as never)).toBe(true)
    expect(sessionAuthorityMatches({ ...matching, sessionId: "foreign" } as never, "session" as never)).toBe(false)
    expect(sessionAuthorityMatches(
      { _tag: "NoMatchingTaskWorkSessionReported" } as never,
      "session" as never
    )).toBe(false)
  })

  it.each(
    [
      [
        { _tag: "Succeeded", operationId: "execution", output: "done", processId: "process", sessionId: "session" },
        {
          _tag: "SuccessfulTaskExecutionReported",
          operationId: "execution",
          output: "done",
          processId: "process",
          sessionId: "session"
        }
      ],
      [
        {
          _tag: "Failed",
          exitCode: 1,
          operationId: "execution",
          partialOutput: "failed",
          processId: "process",
          sessionId: "session"
        },
        {
          _tag: "FailedTaskExecutionReported",
          exitCode: 1,
          operationId: "execution",
          partialOutput: "failed",
          processId: "process",
          sessionId: "session"
        }
      ],
      [
        {
          _tag: "Interrupted",
          operationId: "execution",
          partialOutput: "interrupted",
          processId: "process",
          sessionId: "session"
        },
        {
          _tag: "InterruptedTaskExecutionReported",
          operationId: "execution",
          partialOutput: "interrupted",
          processId: "process",
          sessionId: "session"
        }
      ]
    ] as const
  )("matches immutable terminal %s evidence", (durable, observed) => {
    expect(executionAuthorityMatches(observed as never, durable as never)).toBe(true)
    expect(executionAuthorityMatches({ ...observed, operationId: "foreign" } as never, durable as never)).toBe(false)
    expect(executionAuthorityMatches({ ...observed, processId: "foreign" } as never, durable as never)).toBe(false)
  })
})
