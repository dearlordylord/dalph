import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Effect } from "effect"
import { ContradictoryWorktreeState, GitWorktree } from "@dalph/orchestrator"
import { describe, expect, it } from "vitest"
import {
  initializeControlledWorld,
  loadDecisionEvidence,
  loadGitCalls,
  setControlledObservation
} from "../src/controlled-world.ts"
import { controlledGitWorktreeLayer, runControlledGitWorktreeReconciliation } from "../src/controlled-git-worktree.ts"
import { establishJournal, loadJournalRecords } from "../src/journal.ts"
import {
  ControlledWorktreeObservation,
  fixture,
  plannedAttempt,
  WorktreeProcessInstance
} from "../src/contracts.ts"
import { mapWorktreeActivityFailure } from "../src/workflow-reconciliation.ts"
import { runBlindRetryNegativeControl, runHistoricalReplayNegativeControl, runWorkflowReconciliationScenario } from "../src/harness.ts"

describe("Effect Workflow deletion-leverage worktree prototype", () => {
  it("reconciles the controlled worktree after an unstored Activity result without creating twice", async () => {
    const result = await runWorkflowReconciliationScenario({ scenario: "UnstoredActivityResult" })

    expect(result.executionIds).toHaveLength(2)
    expect(new Set(result.executionIds).size).toBe(1)
    expect(result.firstExit).toEqual({ code: null, signal: "SIGKILL" })
    expect(result.secondExit).toEqual({ code: 0, signal: null })
    expect(result.childMessages).toContainEqual(
      expect.objectContaining({ _tag: "FaultReached", fault: "AfterCreateBeforeActivityStorage" })
    )
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
    expect(result.activityEvidence.every(({ executionId }) => executionId === result.executionIds[0])).toBe(true)
    expect(
      result.gitCalls.every(
        ({ attemptId, baseSha, branch, operationId, runId, worktree }) =>
          attemptId === "attempt-234-worktree-0001" &&
          baseSha === "b0b4a15d3a4c1e75b129c0c620042a64c2178692" &&
          branch === "refs/heads/dalph/issue-234-worktree-0001" &&
          operationId === "operation-234-worktree-0001" &&
          runId === "run-234-worktree-0001" &&
          worktree === "/controlled/prototype/worktrees/issue-234-worktree-0001"
      )
    ).toBe(true)
    expect(result.journalRecords.find(({ event }) => event._tag === "TaskWorktreeReady")?.event).toMatchObject({
      operationId: "operation-234-worktree-0001",
      proof: {
        baseSha: "b0b4a15d3a4c1e75b129c0c620042a64c2178692",
        branch: "refs/heads/dalph/issue-234-worktree-0001",
        worktree: "/controlled/prototype/worktrees/issue-234-worktree-0001"
      }
    })
    expect(result.gitCalls.filter(({ _tag }) => _tag === "CreatePlannedWorktree")).toHaveLength(1)
    expect(result.gitCalls.filter(({ _tag }) => _tag === "ReadPlannedWorktree")).toHaveLength(3)
    expect(result.journalEventTags.filter((tag) => tag === "TaskWorktreeReconciliationIntended")).toHaveLength(1)
    expect(result.journalEventTags.filter((tag) => tag === "TaskWorktreeReady")).toHaveLength(1)
    expect(result.journalEventTags.slice(0, 3)).toEqual([
      "WorkflowRunBegan",
      "TaskAttemptPlanned",
      "TaskWorktreeReconciliationIntended"
    ])
    expect(result.journalEventTags).not.toEqual(
      expect.arrayContaining(["TaskClaimAcquisitionIntended", "TaskClaimAcquired", "TaskTrackerFactsObserved"])
    )
    expect(result.proposalObservations.map(({ _tag }) => _tag)).toEqual([
      "PresentBeforeActivity",
      "PresentAfterRestartBeforeJournal",
      "AbsentAfterJournalPublication"
    ])
    expect(result.responsibilityProjections.map(({ disposition }) => disposition)).toEqual([
      "WorkflowOperationTaskClaimConstraint",
      "WorkflowOperationTaskClaimConstraint",
      "Settled"
    ])
    expect(result.decisionEvidence.at(-1)?.decision).toBe("ContinueWorktreeReady")
    expect(result.decisionEvidence.at(-1)?.source).toBe("ControlledGitFreshRead")
    expect(result.physicalWorktreeCreated).toBe(false)
    expect(result.executorBoundaryContacts).toHaveLength(0)
    expect(result.gitCalls.every(({ _tag }) => _tag.startsWith("Read") || _tag === "CreatePlannedWorktree")).toBe(true)
    expect(result.childMessages.filter(({ _tag }) => _tag === "Completed")).toHaveLength(1)
  })

  it("replays the stored worktree result into the Journal without another controlled Git call", async () => {
    const result = await runWorkflowReconciliationScenario({ scenario: "StoredResultBeforeJournal" })

    expect(result.executionIds).toHaveLength(2)
    expect(new Set(result.executionIds).size).toBe(1)
    expect(result.firstExit).toEqual({ code: null, signal: "SIGKILL" })
    expect(result.secondExit).toEqual({ code: 0, signal: null })
    expect(result.childMessages).toContainEqual(
      expect.objectContaining({ _tag: "FaultReached", fault: "AfterActivityStorageBeforeJournal" })
    )
    expect(result.activityEvidence).toHaveLength(2)
    expect(result.activityEvidence.every(({ attemptId, baseSha, branch, operationId, runId, worktree }) =>
      attemptId === "attempt-234-worktree-0001" &&
      baseSha === "b0b4a15d3a4c1e75b129c0c620042a64c2178692" &&
      branch === "refs/heads/dalph/issue-234-worktree-0001" &&
      operationId === "operation-234-worktree-0001" &&
      runId === "run-234-worktree-0001" &&
      worktree === "/controlled/prototype/worktrees/issue-234-worktree-0001"
    )).toBe(true)
    expect(result.activityEvidence.every(({ executionId }) => executionId === result.executionIds[0])).toBe(true)
    expect(result.gitCalls.filter(({ _tag }) => _tag === "CreatePlannedWorktree")).toHaveLength(1)
    expect(result.gitCalls.filter(({ _tag }) => _tag === "ReadPlannedWorktree")).toHaveLength(2)
    expect(result.journalEventTags.filter((tag) => tag === "TaskWorktreeReady")).toHaveLength(1)
    expect(result.proposalObservations.at(-1)?._tag).toBe("AbsentAfterJournalPublication")
    expect(result.responsibilityProjections.map(({ disposition }) => disposition)).toEqual([
      "WorkflowOperationTaskClaimConstraint",
      "WorkflowOperationTaskClaimConstraint",
      "Settled"
    ])
    expect(result.decisionEvidence).toHaveLength(0)
    expect(result.terminalDecision).toBe("ContinueWorktreeReady")
    expect(result.physicalWorktreeCreated).toBe(false)
    expect(result.executorBoundaryContacts).toHaveLength(0)
  })

  it("reads controlled Git again before using replayed worktree readiness for a current decision", async () => {
    const result = await runWorkflowReconciliationScenario({ scenario: "FactsChangedDuringDowntime" })

    expect(result.firstExit).toEqual({ code: null, signal: "SIGKILL" })
    expect(result.secondExit).toEqual({ code: 0, signal: null })
    expect(result.childMessages).toContainEqual(
      expect.objectContaining({ _tag: "FaultReached", fault: "AfterActivityStorageBeforeJournal" })
    )
    expect(result.gitCalls.filter(({ _tag }) => _tag === "CreatePlannedWorktree")).toHaveLength(1)
    expect(result.gitCalls.filter(({ _tag }) => _tag === "ReadPlannedWorktree")).toHaveLength(3)
    expect(result.gitCalls.at(-1)).toMatchObject({ _tag: "ReadPlannedWorktree", result: "PlannedWorktreeAbsent" })
    expect(result.decisionEvidence).toEqual([
      expect.objectContaining({ decision: "WaitWorktreeNotReady", source: "ControlledGitFreshRead" })
    ])
    expect(result.decisionEvidence.at(-1)?.executorBoundaryContacts).toBe(result.executorBoundaryContacts.length)
    expect(result.terminalDecision).toBe("WaitWorktreeNotReady")
    expect(result.physicalWorktreeCreated).toBe(false)
    expect(result.executorBoundaryContacts).toHaveLength(0)
    expect(result.responsibilityProjections.map(({ disposition }) => disposition)).toEqual([
      "WorkflowOperationTaskClaimConstraint",
      "WorkflowOperationTaskClaimConstraint",
      "Settled"
    ])
  })

  it("proves that a blind Activity retry repeats controlled create as a negative control", async () => {
    const result = await runBlindRetryNegativeControl()

    expect(result.firstExit).toEqual({ code: null, signal: "SIGKILL" })
    expect(result.secondExit).toEqual({ code: 0, signal: null })
    expect(result.childMessages).toContainEqual(
      expect.objectContaining({ _tag: "FaultReached", fault: "AfterCreateBeforeActivityStorage" })
    )
    expect(result.gitCalls.filter(({ _tag }) => _tag === "CreatePlannedWorktree")).toHaveLength(2)
    expect(result.gitCalls.filter(({ _tag }) => _tag === "ReadPlannedWorktree")).toHaveLength(1)
    expect(result.responsibilityProjections.map(({ disposition }) => disposition)).toEqual([
      "WorkflowOperationTaskClaimConstraint",
      "WorkflowOperationTaskClaimConstraint",
      "Settled"
    ])
  })

  it("proves that suppressed Journal publication retains the proposal as a negative control", async () => {
    const result = await runWorkflowReconciliationScenario({
      publicationMode: "Suppress",
      scenario: "StoredResultBeforeJournal"
    })

    expect(result.journalEventTags).not.toContain("TaskWorktreeReady")
    expect(result.firstExit).toEqual({ code: null, signal: "SIGKILL" })
    expect(result.secondExit).toEqual({ code: null, signal: "SIGKILL" })
    expect(result.childMessages).toContainEqual(
      expect.objectContaining({ _tag: "FaultReached", fault: "AfterActivityStorageBeforeJournal" })
    )
    expect(result.proposalObservations.map(({ _tag }) => _tag)).toEqual([
      "PresentBeforeActivity",
      "PresentAfterRestartBeforeJournal"
    ])
    expect(result.responsibilityProjections.map(({ disposition }) => disposition)).toEqual([
      "WorkflowOperationTaskClaimConstraint",
      "WorkflowOperationTaskClaimConstraint"
    ])
    expect(result.childMessages.some(({ _tag }) => _tag === "PublicationSuppressed")).toBe(true)
  })

  it("proves that replayed historical readiness would incorrectly authorize a current decision as a negative control", async () => {
    const result = await runHistoricalReplayNegativeControl()

    expect(result.firstExit).toEqual({ code: null, signal: "SIGKILL" })
    expect(result.secondExit).toEqual({ code: 0, signal: null })
    expect(result.childMessages).toContainEqual(
      expect.objectContaining({ _tag: "FaultReached", fault: "AfterActivityStorageBeforeJournal" })
    )
    expect(result.gitCalls.filter(({ _tag }) => _tag === "ReadPlannedWorktree")).toHaveLength(2)
    expect(result.decisionEvidence).toEqual([
      expect.objectContaining({ decision: "ContinueWorktreeReady", source: "ReplayedWorkflowResult" })
    ])
    expect(result.terminalDecision).toBe("ContinueWorktreeReady")
    expect(result.responsibilityProjections.map(({ disposition }) => disposition)).toEqual([
      "WorkflowOperationTaskClaimConstraint",
      "WorkflowOperationTaskClaimConstraint",
      "Settled"
    ])
  })

  it("fails closed on contradictory controlled facts with the exact Activity reason", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "dalph-234-contradictory-worktree-"))
    try {
      await initializeControlledWorld(workspace)
      await Effect.runPromise(establishJournal(workspace))
      await setControlledObservation(
        workspace,
        ControlledWorktreeObservation.cases.PlannedWorktreeContradictory.make({
          detail: "controlled branch and worktree registrations disagree"
        })
      )
      const failure = await Effect.runPromise(
        Effect.gen(function* () {
          const git = yield* GitWorktree
          return yield* runControlledGitWorktreeReconciliation(git, plannedAttempt).pipe(Effect.flip)
        }).pipe(
          Effect.provide(
            controlledGitWorktreeLayer({
              processInstance: WorktreeProcessInstance.make("contradictory-negative-control"),
              workspace
            })
          )
        )
      )
      expect(failure).toBeInstanceOf(ContradictoryWorktreeState)
      expect(failure._tag).toBe("ContradictoryWorktreeState")
      expect(mapWorktreeActivityFailure(failure, fixture.worktree).reason).toBe("ContradictoryWorktreeState")
      const gitCalls = await loadGitCalls(workspace)
      expect(gitCalls).toHaveLength(1)
      expect(gitCalls[0]?._tag).toBe("ReadPlannedWorktree")
      expect(gitCalls.some(({ _tag }) => _tag === "CreatePlannedWorktree")).toBe(false)
      const journalRecords = await loadJournalRecords(workspace)
      expect(journalRecords.some(({ event }) => event._tag === "TaskWorktreeReady")).toBe(false)
      expect(await loadDecisionEvidence(workspace)).toEqual([])
    } finally {
      await rm(workspace, { force: true, recursive: true })
    }
  })

  it("enumerates only the declared durable evidence and workflow stores", async () => {
    const result = await runWorkflowReconciliationScenario({ scenario: "FactsChangedDuringDowntime" })

    expect(result.inventory.forbiddenPersistedArtifacts).toEqual([])
    expect(result.inventory.files.every(({ category }) => category !== "UnknownPersistentArtifact")).toBe(true)
    expect(result.inventory.sqliteTables.every(({ category }) => category !== "UnknownPersistentTable")).toBe(true)
    expect(result.inventory.journalRecords.map(({ eventTag }) => eventTag)).toEqual(result.journalEventTags)
    expect(result.inventory.journalRecords.every(({ category }) => category !== "UnknownJournalRecord")).toBe(true)
    expect(result.inventory.workflowRecords.every(({ category }) =>
      category === "WorkflowInvocation" ||
      category === "WorkflowActivityReply" ||
      category === "WorkflowRuntimeMigration"
    )).toBe(true)
    expect(result.inventory.workflowRecords.filter(({ category }) => category === "WorkflowInvocation")).toHaveLength(2)
    expect(result.inventory.workflowRecords.filter(({ category }) => category === "WorkflowActivityReply")).toHaveLength(2)
    expect(result.inventory.workflowRecords.filter(({ category }) => category === "WorkflowRuntimeMigration")).toHaveLength(2)
    expect(result.inventory.sqliteTables).toEqual(expect.arrayContaining([
      expect.objectContaining({ database: "workflow.sqlite", name: "cluster_messages", rowCount: 2 }),
      expect.objectContaining({ database: "workflow.sqlite", name: "cluster_migrations", rowCount: 2 }),
      expect.objectContaining({ database: "workflow.sqlite", name: "cluster_replies", rowCount: 2 })
    ]))
    expect(result.inventory.files.map(({ name }) => name)).toEqual([
      "activity-evidence.ndjson",
      "controlled-git-calls.ndjson",
      "controlled-git-world.json",
      "decision-evidence.ndjson",
      "executor-boundary-contacts.ndjson",
      "journal.sqlite",
      "proposal-observations.ndjson",
      "responsibility-projections.ndjson",
      "workflow.sqlite"
    ])
  })

  it("guards Workflow and controlled adapter action modules from real providers and process boundaries", async () => {
    const candidateModuleNames = [
      "controlled-git-worktree.ts",
      "controlled-world.ts",
      "child.ts",
      "executor-trap.ts",
      "journal.ts",
      "workflow-reconciliation.ts"
    ] as const
    const candidateModules = await Promise.all(
      candidateModuleNames.map(async (name) => ({ name, source: await readFile(new URL(`../src/${name}`, import.meta.url), "utf8") }))
    )
    expect(candidateModules).toHaveLength(candidateModuleNames.length)
    const actionModules = candidateModules.map(({ source }) => source).join("\n")
    expect(actionModules).not.toMatch(
      /node:child_process|child_process|execFile|spawn\(|nodeGitWorktreeLayer|nodeGitCommandLayer|simple-git|@octokit|GitHub|Github|target-repository|targetRepo|physical-worktree-marker|executor-process|node:git/
    )
    const workflowSource = candidateModules.find(({ name }) => name === "workflow-reconciliation.ts")?.source
    expect(workflowSource).toBeDefined()
    expect(workflowSource).not.toContain("historicalDecision")
  })
})
