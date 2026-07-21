import { TaskId, TrackerRevision, type TrackerTask } from "./domain.js"
import type { GithubIssueNodeId, GithubRepositoryNodeId } from "./github-graphql-client.js"

// Reversible encoding, not encryption or a hash: opacity prevents consumers
// from depending on provider structure while diagnostics can restore it.
const githubTaskIdEncodingVersion = "t1."

export const githubTaskIdFor = (
  repositoryNodeId: GithubRepositoryNodeId,
  issueNodeId: GithubIssueNodeId
): TaskId =>
  TaskId.make(
    `${githubTaskIdEncodingVersion}${
      Buffer.from(
        JSON.stringify([repositoryNodeId, issueNodeId]),
        "utf8"
      ).toString("base64url")
    }`
  )

/** Keeps canonical snapshot content directly reversible for revision diagnostics. */
export const trackerRevisionFor = (tasks: ReadonlyArray<TrackerTask>): TrackerRevision =>
  TrackerRevision.make(JSON.stringify(
    [...tasks]
      .sort((left, right) => left.id.localeCompare(right.id))
      .map((task) => ({
        ...task,
        prerequisiteIds: [...task.prerequisiteIds].sort((left, right) => left.localeCompare(right))
      }))
  ))
