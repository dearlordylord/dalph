import {
  GitCommitSha,
  GitRepositoryLocator,
  IntegrationTarget,
  IntegrationTargetRef,
  RunId,
  TaskId
} from "@dalph/contracts"
import { FixtureTarget, projectTrackerSnapshot } from "@dalph/orchestrator"

/** Controlled starting facts, not a replay or finality proof for A. */
export const names = ["B", "C", "D", "E", "F", "G"] as const
export const shaLength = 40
export const capacity = 3
export const candidateDigits = ["2", "3", "4", "5", "6", "7"]
export const acceptedDigits = ["8", "9", "a", "b", "c", "d"]
export const runId = RunId.make("run:issue-276")
export const target = FixtureTarget.make("fixture:issue-276")
export const baseSha = GitCommitSha.make("1".repeat(shaLength))
export const integrationTarget = IntegrationTarget.make({
  repository: GitRepositoryLocator.make("/controlled/issue-276.git"),
  ref: IntegrationTargetRef.make("refs/heads/main")
})
export const graph = projectTrackerSnapshot({
  revision: "G5",
  rootTaskId: TaskId.make("A"),
  tasks: ["A", ...names].map((id) => ({
    id: TaskId.make(id),
    lifecycle: id === "A" ? { _tag: "CompletedSuccessfully" as const } : { _tag: "Open" as const },
    parentTaskId: null,
    prerequisiteIds: []
  }))
})
