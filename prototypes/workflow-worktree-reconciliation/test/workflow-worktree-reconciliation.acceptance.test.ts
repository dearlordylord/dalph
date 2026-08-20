import { describe, expect, it } from "vitest"
import { runBlindRetryNegativeControl, runHistoricalReplayNegativeControl, runWorkflowReconciliationScenario } from "../src/harness.ts"

describe("Effect Workflow deletion-leverage worktree prototype", () => {
  it("reconciles the controlled worktree after an unstored Activity result without creating twice", async () => {
    const result = await runWorkflowReconciliationScenario({ scenario: "UnstoredActivityResult" })

    expect(result.executionIds).toHaveLength(2)
    expect(new Set(result.executionIds).size).toBe(1)
    expect(result.activityEvidence).toEqual([
      expect.objectContaining({
        activityName: "ReconcileTaskWorktree/operation-234-worktree-0001",
        attemptId: "attempt-234-worktree-0001",
        baseSha: "b0b4a15d3a4c1e75b129c0c620042a64c2178692",
        branch: "refs/heads/dalph/issue-234-worktree-0001",
        operationId: "operation-234-worktree-0001",
        runId: "run-234-worktree-0001",
        worktree: "/controlled/prototype/worktrees/issue-234-worktree-0001"
      })
    ])
    expect(result.gitCalls.filter(({ _tag }) => _tag === "CreatePlannedWorktree")).toHaveLength(1)
    expect(result.gitCalls.filter(({ _tag }) => _tag === "ReadPlannedWorktree")).toHaveLength(3)
    expect(result.journalEventTags.filter((tag) => tag === "TaskWorktreeReconciliationIntended")).toHaveLength(1)
    expect(result.journalEventTags.filter((tag) => tag === "TaskWorktreeReady")).toHaveLength(1)
    expect(result.proposalObservations.map(({ _tag }) => _tag)).toEqual([
      "PresentBeforeActivity",
      "PresentAfterRestartBeforeJournal",
      "AbsentAfterJournalPublication"
    ])
    expect(result.decisionEvidence.at(-1)?.decision).toBe("ContinueWorktreeReady")
    expect(result.decisionEvidence.at(-1)?.source).toBe("ControlledGitFreshRead")
    expect(result.physicalWorktreeCreated).toBe(false)
    expect(result.gitCalls.every(({ _tag }) => _tag.startsWith("Read") || _tag === "CreatePlannedWorktree")).toBe(true)
    expect(result.childMessages.filter(({ _tag }) => _tag === "Completed")).toHaveLength(1)
  })

  it("replays the stored worktree result into the Journal without another controlled Git call", async () => {
    const result = await runWorkflowReconciliationScenario({ scenario: "StoredResultBeforeJournal" })

    expect(result.executionIds).toHaveLength(2)
    expect(new Set(result.executionIds).size).toBe(1)
    expect(result.activityEvidence).toHaveLength(2)
    expect(result.activityEvidence.every(({ attemptId, baseSha, branch, operationId, runId, worktree }) =>
      attemptId === "attempt-234-worktree-0001" &&
      baseSha === "b0b4a15d3a4c1e75b129c0c620042a64c2178692" &&
      branch === "refs/heads/dalph/issue-234-worktree-0001" &&
      operationId === "operation-234-worktree-0001" &&
      runId === "run-234-worktree-0001" &&
      worktree === "/controlled/prototype/worktrees/issue-234-worktree-0001"
    )).toBe(true)
    expect(result.gitCalls.filter(({ _tag }) => _tag === "CreatePlannedWorktree")).toHaveLength(1)
    expect(result.gitCalls.filter(({ _tag }) => _tag === "ReadPlannedWorktree")).toHaveLength(2)
    expect(result.journalEventTags.filter((tag) => tag === "TaskWorktreeReady")).toHaveLength(1)
    expect(result.proposalObservations.at(-1)?._tag).toBe("AbsentAfterJournalPublication")
    expect(result.decisionEvidence).toHaveLength(0)
    expect(result.terminalDecision).toBe("ContinueWorktreeReady")
    expect(result.physicalWorktreeCreated).toBe(false)
  })

  it("reads controlled Git again before using replayed worktree readiness for a current decision", async () => {
    const result = await runWorkflowReconciliationScenario({ scenario: "FactsChangedDuringDowntime" })

    expect(result.gitCalls.filter(({ _tag }) => _tag === "CreatePlannedWorktree")).toHaveLength(1)
    expect(result.gitCalls.filter(({ _tag }) => _tag === "ReadPlannedWorktree")).toHaveLength(3)
    expect(result.gitCalls.at(-1)).toMatchObject({ _tag: "ReadPlannedWorktree", result: "PlannedWorktreeAbsent" })
    expect(result.decisionEvidence).toEqual([
      expect.objectContaining({ decision: "WaitWorktreeNotReady", executorAdmissions: 0, source: "ControlledGitFreshRead" })
    ])
    expect(result.terminalDecision).toBe("WaitWorktreeNotReady")
    expect(result.physicalWorktreeCreated).toBe(false)
  })

  it("proves that a blind Activity retry repeats controlled create as a negative control", async () => {
    const result = await runBlindRetryNegativeControl()

    expect(result.gitCalls.filter(({ _tag }) => _tag === "CreatePlannedWorktree")).toHaveLength(2)
    expect(result.gitCalls.filter(({ _tag }) => _tag === "ReadPlannedWorktree")).toHaveLength(2)
  })

  it("proves that suppressed Journal publication retains the proposal as a negative control", async () => {
    const result = await runWorkflowReconciliationScenario({
      publicationMode: "Suppress",
      scenario: "StoredResultBeforeJournal"
    })

    expect(result.journalEventTags).not.toContain("TaskWorktreeReady")
    expect(result.proposalObservations.map(({ _tag }) => _tag)).toEqual([
      "PresentBeforeActivity",
      "PresentAfterRestartBeforeJournal"
    ])
    expect(result.childMessages.some(({ _tag }) => _tag === "PublicationSuppressed")).toBe(true)
  })

  it("proves that replayed historical readiness would incorrectly authorize a current decision as a negative control", async () => {
    const result = await runHistoricalReplayNegativeControl()

    expect(result.gitCalls.filter(({ _tag }) => _tag === "ReadPlannedWorktree")).toHaveLength(2)
    expect(result.decisionEvidence).toEqual([
      expect.objectContaining({ decision: "ContinueWorktreeReady", source: "ReplayedWorkflowResult" })
    ])
    expect(result.terminalDecision).toBe("ContinueWorktreeReady")
  })
})
