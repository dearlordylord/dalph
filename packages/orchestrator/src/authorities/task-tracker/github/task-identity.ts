import { TaskId } from "@dalph/contracts"
import { Effect, Schema } from "effect"
import { TrackerRevision, type TrackerTask } from "../task.js"
import { GithubIssueNodeId, GithubRepositoryNodeId } from "./graphql-client.js"

// Reversible encoding, not encryption or a hash: opacity prevents consumers
// from depending on provider structure while diagnostics can restore it.
const githubTaskIdEncodingVersion = "t1."

/** Exact repository and issue node identities reversibly carried by a GitHub-owned task identity. */
const GithubTaskCoordinates = Schema.Tuple([GithubRepositoryNodeId, GithubIssueNodeId])
type GithubTaskCoordinates = typeof GithubTaskCoordinates.Type

/** A task identity could not be decoded as one complete GitHub repository/issue pair. */
class GithubTaskIdentityDecodeFailure extends Schema.TaggedError<GithubTaskIdentityDecodeFailure>()(
  "GithubTaskIdentity.DecodeFailure",
  { detail: Schema.String, taskId: TaskId }
) {}

export const githubTaskIdFor = (repositoryNodeId: GithubRepositoryNodeId, issueNodeId: GithubIssueNodeId): TaskId =>
  TaskId.make(
    `${githubTaskIdEncodingVersion}${Buffer.from(JSON.stringify([repositoryNodeId, issueNodeId]), "utf8").toString(
      "base64url"
    )}`
  )

/** Decodes only the reversible task identity format owned by the GitHub adapter. */
export const githubTaskCoordinatesFor = Effect.fn("GithubTaskIdentity.coordinatesFor")(function* (taskId: TaskId) {
  if (!taskId.startsWith(githubTaskIdEncodingVersion)) {
    return yield* new GithubTaskIdentityDecodeFailure({
      detail: "task identity is not owned by the GitHub adapter",
      taskId
    })
  }
  const encoded: unknown = yield* Effect.try({
    try: () => JSON.parse(Buffer.from(taskId.slice(githubTaskIdEncodingVersion.length), "base64url").toString("utf8")),
    catch: (cause) => new GithubTaskIdentityDecodeFailure({ detail: String(cause), taskId })
  })
  return yield* Schema.decodeUnknownEffect(GithubTaskCoordinates)(encoded).pipe(
    Effect.mapError((cause) => new GithubTaskIdentityDecodeFailure({ detail: String(cause), taskId }))
  )
})

/** Keeps canonical snapshot content directly reversible for revision diagnostics. */
export const trackerRevisionFor = (tasks: ReadonlyArray<TrackerTask>): TrackerRevision =>
  TrackerRevision.make(
    JSON.stringify(
      [...tasks]
        .sort((left, right) => left.id.localeCompare(right.id))
        .map((task) => ({
          ...task,
          prerequisiteIds: [...task.prerequisiteIds].sort((left, right) => left.localeCompare(right))
        }))
    )
  )
