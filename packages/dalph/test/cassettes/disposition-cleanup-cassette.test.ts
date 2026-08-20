import { it } from "@effect/vitest"
import { Effect } from "effect"
import { expect } from "vitest"
import {
  dispositionCleanupAuthoredCassetteCatalog,
  dispositionCleanupRecordedCassetteCatalog,
  projectRecordedCassette,
  renderRecordedCassetteLyrics,
  runDispositionCleanupCassette
} from "../../src/cassettes/index.js"
import { JournalPosition } from "../../../orchestrator/src/workflow-journal/identity.js"

it.effect("runs each authored cleanup chronology and records its exact event family", () =>
  Effect.gen(function* () {
    for (const [key, cassette] of Object.entries(dispositionCleanupAuthoredCassetteCatalog)) {
      const run = yield* runDispositionCleanupCassette(cassette)
      // The maintained production transcript contains upstream terminal and
      // FullRerun evidence.  The generic cassette projection here intentionally
      // folds the cleanup slice only; those upstream records are asserted
      // directly below because their producers own their larger histories.
      // The maintained transcript carries upstream authority records owned by
      // the restart and Integrator protocols.  Project the cleanup slice with
      // its original chronology while asserting the upstream records exactly
      // below.
      const cleanupProjectionRecords = run.records
        .filter(({ event }) => event._tag === "WorkflowRunBegan" || event._tag.includes("Cleanup"))
        .map((record, index) => ({ ...record, position: JournalPosition.make(index + 1) }))
      const recorded = yield* projectRecordedCassette(cleanupProjectionRecords)
      const expected =
        dispositionCleanupRecordedCassetteCatalog[key as keyof typeof dispositionCleanupRecordedCassetteCatalog]
      const recordedTags = recorded.entries.map(({ _tag }) => _tag)
      const filteredCleanupTags = recordedTags.filter((tag) => tag.includes("Cleanup"))
      expect(filteredCleanupTags).toEqual(expected.events)
      if (expected.events.length > 0) expect(renderRecordedCassetteLyrics(recorded)).toContain("cleanup")
      else expect(filteredCleanupTags).toEqual([])
      expect(run.boundaryCalls).toEqual(cassette.expectedBoundaryCalls)
      const tags = run.records.map(({ event }) => event._tag)
      if (cassette.scenario === "SupersededWorktreeAndBranch") {
        expect(tags).toEqual([
          "WorkflowRunBegan",
          "GitReadIntentRecorded",
          "PlannedAttemptWorktreeObserved",
          "TaskClaimAcquisitionIntended",
          "TaskClaimAcquired",
          "AttemptChoiceApplied",
          "PlannedAttemptExecutorWorkResponsibilityBegan",
          "PlannedAttemptExecutorWorkReported",
          "PlannedAttemptReplaced",
          ...expected.events
        ])
        const replacement = run.records[8]?.event
        if (replacement?._tag !== "PlannedAttemptReplaced")
          return yield* Effect.die("missing exact replacement evidence")
        expect(replacement.successorPlan.plannedAttempt).toMatchObject({
          attemptId: "issue-69-maintained-p2",
          branch: "refs/heads/task/issue-69-maintained-p2",
          worktree: "/tmp/issue-69-maintained-p2",
          taskRevision: "issue-69-maintained-revision:successor"
        })
      }
      if (cassette.scenario === "ChangedGitFactsPreserveResources") {
        expect(tags).toEqual([
          "WorkflowRunBegan",
          "GitReadIntentRecorded",
          "PlannedAttemptWorktreeObserved",
          "TaskClaimAcquisitionIntended",
          "TaskClaimAcquired",
          "AttemptChoiceApplied",
          "PlannedAttemptExecutorWorkResponsibilityBegan",
          "PlannedAttemptExecutorWorkReported",
          "PlannedAttemptReplaced",
          ...expected.events
        ])
      }
      if (cassette.scenario === "FullRerunPredecessorCandidate") {
        expect(tags).toEqual([
          "WorkflowRunBegan",
          "IntegrationResponsibilityBegan",
          "GitReadIntentRecorded",
          "TargetLineageObserved",
          "IntegratorSessionFixed",
          "IntegrationStarted",
          "IntegratorRunStarted",
          "IntegrationProviderRunActivityAbsent",
          "IntegrationQuarantined",
          "IntegrationQuarantineDirectionApplied",
          "GitReadIntentRecorded",
          "TargetLineageObserved",
          "IntegratorSuccessorSessionFixed",
          ...expected.events
        ])
        const successorFixed = run.records[12]?.event
        if (successorFixed?._tag !== "IntegratorSuccessorSessionFixed") {
          return yield* Effect.die("missing exact successor session evidence")
        }
        expect(successorFixed.predecessor.candidateResource).toBe("candidate:issue-69-maintained-p1")
        expect(successorFixed.successor.candidateResource).toBe("candidate:issue-69-maintained-p2")
        expect(successorFixed.predecessor.sessionId).not.toBe(successorFixed.successor.sessionId)
      }
      if (cassette.scenario === "CurrentQuarantinePreserved") {
        expect(tags).toEqual([
          "WorkflowRunBegan",
          "IntegrationResponsibilityBegan",
          "GitReadIntentRecorded",
          "TargetLineageObserved",
          "IntegratorSessionFixed",
          "IntegrationStarted",
          "IntegratorRunStarted",
          "IntegrationProviderRunActivityAbsent",
          "IntegrationQuarantined"
        ])
        expect(run.records.some(({ event }) => event._tag === "IntegrationQuarantineDirectionApplied")).toBe(false)
        expect(run.records.some(({ event }) => event._tag === "IntegratorSuccessorSessionFixed")).toBe(false)
      }
    }
  })
)
