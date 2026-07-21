import { TaskId, TrackerRevision, type TrackerTask } from "./domain.js"
import type { GithubIssueNodeId, GithubRepositoryNodeId } from "./github-graphql-client.js"

export const githubTaskIdFor = (
  repositoryNodeId: GithubRepositoryNodeId,
  issueNodeId: GithubIssueNodeId
): TaskId => TaskId.make(JSON.stringify([repositoryNodeId, issueNodeId]))

/** Identifies equal projected task content with an equal tracker revision. */
export const trackerRevisionFor = (tasks: ReadonlyArray<TrackerTask>): TrackerRevision =>
  TrackerRevision.make(JSON.stringify(
    [...tasks]
      .sort((left, right) => left.id.localeCompare(right.id))
      .map((task) => ({
        ...task,
        prerequisiteIds: [...task.prerequisiteIds].sort((left, right) => left.localeCompare(right))
      }))
  ))
