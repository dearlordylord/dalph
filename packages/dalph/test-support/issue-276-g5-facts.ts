import {
  GitCommitSha,
  AttemptId,
  GitRepositoryLocator,
  IntegrationTarget,
  IntegrationTargetRef,
  RunId,
  TaskId
} from "@dalph/contracts"
import { FixtureTarget, projectTrackerSnapshot } from "@dalph/orchestrator"

/** Controlled starting facts, not a replay or finality proof for A. */
const shaLength = 40
export const capacity = 3
const taskFact = (name: string, commits: { readonly candidate: string; readonly accepted: string }) =>
  ({
    taskId: TaskId.make(name),
    attemptId: AttemptId.make(`attempt:${name}`),
    candidateCommit: GitCommitSha.make(commits.candidate.repeat(shaLength)),
    acceptedCommit: GitCommitSha.make(commits.accepted.repeat(shaLength))
  }) as const
export const taskFacts = {
  B: taskFact("B", { candidate: "2", accepted: "8" }),
  C: taskFact("C", { candidate: "3", accepted: "9" }),
  D: taskFact("D", { candidate: "4", accepted: "a" }),
  E: taskFact("E", { candidate: "5", accepted: "b" }),
  F: taskFact("F", { candidate: "6", accepted: "c" }),
  G: taskFact("G", { candidate: "7", accepted: "d" })
} as const
export const tasks = Object.values(taskFacts)
export const taskFactsById: ReadonlyMap<TaskId, (typeof tasks)[number]> = new Map(
  tasks.map((task) => [task.taskId, task])
)
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
  tasks: ["A", ...tasks.map(({ taskId }) => taskId)].map((id) => ({
    id: TaskId.make(id),
    lifecycle: id === "A" ? { _tag: "CompletedSuccessfully" as const } : { _tag: "Open" as const },
    parentTaskId: null,
    prerequisiteIds: []
  }))
})
