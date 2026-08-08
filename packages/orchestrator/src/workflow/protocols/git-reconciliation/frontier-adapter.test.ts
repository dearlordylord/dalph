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
import { expect, it } from "vitest"
import { JournalPosition } from "../../../workflow-journal/identity.js"
import { deriveRunnableFrontier } from "../../../coordination/frontier/frontier.js"
import { decideTargetLineage, TargetLineageObservation } from "./decision.js"
import { responsibilityDispositionForTargetLineage } from "./frontier-adapter.js"

const plannedAttempt = PlannedTaskAttempt.make({
  attemptId: AttemptId.make("lineage-frontier-attempt-A"),
  baseSha: GitCommitSha.make("1".repeat(40)),
  branch: TaskBranchRef.make("refs/heads/dalph/lineage-frontier-A"),
  executor: TaskExecutorLocator.make("executor:controlled-fake"),
  runId: RunId.make("lineage-frontier-run"),
  taskId: TaskId.make("lineage-frontier-A"),
  taskRevision: TaskRevision.make("lineage-frontier-A-revision"),
  worktree: WorktreeLocator.make("/worktrees/lineage-frontier-A")
})
const responsibility = {
  _tag: "PlannedAttemptExecutorWorkResponsibility" as const,
  beganAt: JournalPosition.make(1),
  plannedAttempt
}
const independentTask = {
  taskId: TaskId.make("lineage-frontier-C"),
  taskRevision: TaskRevision.make("lineage-frontier-C-revision")
}
const acceptedProgress = { _tag: "ExecutorResponsibilityBegan" as const, acceptedAt: responsibility.beganAt }

const frontierFor = (plannedBaseIsAncestorOfTargetHead: boolean) => {
  const decision = decideTargetLineage(
    TargetLineageObservation.make({
      plannedBaseIsAncestorOfTargetHead,
      plannedBaseSha: plannedAttempt.baseSha,
      targetHeadSha: GitCommitSha.make((plannedBaseIsAncestorOfTargetHead ? "2" : "3").repeat(40))
    })
  )
  return deriveRunnableFrontier({
    freshEligibleTasks: [independentTask],
    responsibility: { entries: [responsibility] },
    responsibilityFacts: [
      {
        _tag: "PlannedAttemptExecutorFreshFacts",
        disposition: responsibilityDispositionForTargetLineage(
          acceptedProgress,
          decision,
          !plannedBaseIsAncestorOfTargetHead
        ),
        responsibility
      }
    ]
  })
}

it("continues A and keeps independent C eligible after compatible target advancement", () => {
  expect(frontierFor(true).transitions).toEqual([
    { _tag: "ContinuePlannedAttemptExecutorWork", acceptedProgress, plannedAttempt },
    { _tag: "CommitFreshTaskClaimIntent", ...independentTask }
  ])
})

it("constrains only A and keeps independent C eligible after an incompatible rewrite", () => {
  const frontier = frontierFor(false)
  expect(frontier.transitions).toEqual([{ _tag: "CommitFreshTaskClaimIntent", ...independentTask }])
  expect(frontier.explanations).toEqual([
    {
      _tag: "PlannedAttemptGitConstraint",
      correlation: { attemptId: plannedAttempt.attemptId, runId: plannedAttempt.runId },
      gitState: "TargetRewrite",
      taskId: plannedAttempt.taskId,
      wakeCondition: "GitFactsObserved"
    }
  ])
})
