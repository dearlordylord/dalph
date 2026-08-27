import { TaskId } from "@dalph/contracts"
import { Effect, Encoding, Result, Schema } from "effect"
import { TrackerRevision, type TrackerTask } from "../task.js"
import type { GithubIssueNodeId, GithubRepositoryNodeId } from "./graphql-client.js"
import {
  GithubIssueNodeId as GithubIssueNodeIdSchema,
  GithubRepositoryNodeId as GithubRepositoryNodeIdSchema
} from "./graphql-client.js"

// Reversible encoding, not encryption or a hash: opacity prevents consumers
// from depending on provider structure while diagnostics can restore it.
const githubTaskIdEncodingVersion = "t1."

const EncodedGithubTaskIdentity = Schema.Tuple([GithubRepositoryNodeIdSchema, GithubIssueNodeIdSchema])

/** The two GitHub authority identities carried by one provider-neutral task identity. */
const GithubTaskIdentity = Schema.Struct({
  issueNodeId: GithubIssueNodeIdSchema,
  repositoryNodeId: GithubRepositoryNodeIdSchema
})

/** A task identity could not be restored as one exact canonical GitHub repository/issue pair. */
class GithubTaskIdentityDecodeError extends Schema.TaggedError<GithubTaskIdentityDecodeError>()(
  "GithubTaskIdentityDecodeError",
  { detail: Schema.String, taskId: TaskId }
) {}

export const githubTaskIdFor = (repositoryNodeId: GithubRepositoryNodeId, issueNodeId: GithubIssueNodeId): TaskId =>
  TaskId.make(
    `${githubTaskIdEncodingVersion}${Encoding.encodeBase64Url(JSON.stringify([repositoryNodeId, issueNodeId]))}`
  )

/** Restores a GitHub task identity only when its opaque encoding is complete and canonical. */
export const decodeGithubTaskId = Effect.fn("GithubTaskIdentity.decode")(function* (taskId: TaskId) {
  if (!taskId.startsWith(githubTaskIdEncodingVersion)) {
    return yield* new GithubTaskIdentityDecodeError({ detail: "task identity has no GitHub encoding", taskId })
  }
  const encoded = taskId.slice(githubTaskIdEncodingVersion.length)
  const input = yield* Effect.try({
    try: (): unknown => JSON.parse(Result.getOrThrow(Encoding.decodeBase64UrlString(encoded))),
    catch: () => new GithubTaskIdentityDecodeError({ detail: "task identity has malformed GitHub encoding", taskId })
  })
  const [repositoryNodeId, issueNodeId] = yield* Schema.decodeUnknownEffect(EncodedGithubTaskIdentity, {
    onExcessProperty: "error"
  })(input).pipe(
    Effect.mapError(
      () => new GithubTaskIdentityDecodeError({ detail: "task identity has malformed GitHub authority fields", taskId })
    )
  )
  if (githubTaskIdFor(repositoryNodeId, issueNodeId) !== taskId) {
    return yield* new GithubTaskIdentityDecodeError({ detail: "task identity is not canonically encoded", taskId })
  }
  return GithubTaskIdentity.make({ issueNodeId, repositoryNodeId })
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
