import { NodeCrypto } from "@effect/platform-node"
import { Crypto, Effect, Layer, Schema } from "effect"
import type { TaskId } from "./domain.js"
import {
  GithubGraphqlClient,
  githubGraphqlClientNodeLayer,
  GithubGraphqlRequest,
  GithubIssueNodeId,
  GithubLabelName,
  GithubLabelNodeId,
  GithubRepositoryNodeId
} from "./github-graphql-client.js"
import {
  ActiveTaskClaim,
  isExactTaskClaim,
  TaskClaimConflict,
  TaskClaimOwnershipConflict,
  TaskClaimReadFailure,
  TaskClaimReleaseFailure,
  TaskClaimRequestFailure,
  TrackerMutation,
  UnclaimedTask
} from "./tracker-mutation.js"
import type { TaskClaimAcquisition } from "./tracker-mutation.js"

const githubTaskIdEncodingVersion = "t1."
const GithubTaskCoordinates = Schema.Tuple([
  GithubRepositoryNodeId,
  GithubIssueNodeId
])

const GithubClaimDescriptionFields = Schema.Struct({
  operationId: ActiveTaskClaim.fields.operationId,
  owner: ActiveTaskClaim.fields.owner,
  token: ActiveTaskClaim.fields.token
})

const githubClaimDescriptionVersion = "1"
const githubClaimDescriptionSeparator = "|"
const githubClaimDescriptionMaximumLength = 100
const hexadecimalRadix = 16
const hexadecimalByteLength = 2
const claimLabelDigestLength = 32

const GithubClaimLabel = Schema.Struct({
  description: Schema.NonEmptyString,
  id: GithubLabelNodeId,
  name: GithubLabelName
})

const GraphqlErrors = Schema.Struct({
  errors: Schema.optionalKey(Schema.Array(Schema.Struct({ message: Schema.String })))
})

const FindClaimLabelResponse = Schema.Struct({
  data: Schema.Struct({
    node: Schema.NullOr(Schema.Struct({
      id: GithubRepositoryNodeId,
      label: Schema.NullOr(GithubClaimLabel)
    }))
  })
})

const CreateClaimLabelResponse = Schema.Struct({
  data: Schema.Struct({
    createLabel: Schema.Struct({ label: GithubClaimLabel })
  })
})

const DeleteClaimLabelResponse = Schema.Struct({
  data: Schema.Struct({
    deleteLabel: Schema.Struct({
      clientMutationId: Schema.NullOr(Schema.String)
    })
  })
})

type GithubClaimRecord =
  | {
    readonly _tag: "Unclaimed"
    readonly observation: UnclaimedTask
  }
  | {
    readonly _tag: "Active"
    readonly labelId: GithubLabelNodeId
    readonly observation: ActiveTaskClaim
  }

const decodeCoordinates = (taskId: TaskId) => {
  if (!taskId.startsWith(githubTaskIdEncodingVersion)) {
    return Effect.fail(
      new TaskClaimReadFailure({
        detail: "task identity is not owned by the GitHub adapter",
        taskId
      })
    )
  }
  return Effect.try({
    try: (): unknown =>
      JSON.parse(
        Buffer.from(
          taskId.slice(githubTaskIdEncodingVersion.length),
          "base64url"
        ).toString("utf8")
      ),
    catch: (cause) => new TaskClaimReadFailure({ detail: String(cause), taskId })
  }).pipe(
    Effect.flatMap(Schema.decodeUnknownEffect(GithubTaskCoordinates)),
    Effect.mapError((cause) =>
      cause instanceof TaskClaimReadFailure
        ? cause
        : new TaskClaimReadFailure({ detail: String(cause), taskId })
    )
  )
}

const descriptionFor = (
  acquisition: TaskClaimAcquisition
): Effect.Effect<string, TaskClaimRequestFailure> => {
  const components = [
    acquisition.operationId,
    acquisition.owner,
    acquisition.token
  ]
  const description = [githubClaimDescriptionVersion, ...components].join(
    githubClaimDescriptionSeparator
  )
  return components.some((component) => component.includes(githubClaimDescriptionSeparator))
      || description.length > githubClaimDescriptionMaximumLength
    ? Effect.fail(
      new TaskClaimRequestFailure({
        acquisition,
        detail: "GitHub claim operation, owner, and token must fit the 100-character label description without '|'",
        outcome: "DefinitelyNotApplied"
      })
    )
    : Effect.succeed(description)
}

const decodeDescription = (
  taskId: TaskId,
  description: string
) => {
  const [version, operationId, owner, token, overflow] = description.split(
    githubClaimDescriptionSeparator
  )
  if (
    version !== githubClaimDescriptionVersion
    || operationId === undefined
    || owner === undefined
    || token === undefined
    || overflow !== undefined
  ) {
    return Effect.fail(
      new TaskClaimReadFailure({
        detail: "GitHub claim label has an unsupported description encoding",
        taskId
      })
    )
  }
  return Schema.decodeUnknownEffect(GithubClaimDescriptionFields)({
    operationId,
    owner,
    token
  }).pipe(
    Effect.mapError((cause) => new TaskClaimReadFailure({ detail: String(cause), taskId }))
  )
}

export const githubTrackerMutationLayer = Layer.effect(
  TrackerMutation,
  Effect.gen(function*() {
    const client = yield* GithubGraphqlClient
    const crypto = yield* Crypto.Crypto
    const claimLabelName = Effect.fn("GithubTrackerMutation.claimLabelName")(
      function*(taskId: TaskId) {
        const digest = yield* crypto.digest(
          "SHA-256",
          new TextEncoder().encode(taskId)
        ).pipe(
          Effect.mapError((cause) => new TaskClaimReadFailure({ detail: String(cause), taskId }))
        )
        const hash = [...digest]
          .map((byte) => byte.toString(hexadecimalRadix).padStart(hexadecimalByteLength, "0"))
          .join("")
        return GithubLabelName.make(
          `dalph-claim-${hash.slice(0, claimLabelDigestLength)}`
        )
      }
    )

    const readGithubClaim = Effect.fn("GithubTrackerMutation.readGithubClaim")(
      function*(taskId: TaskId) {
        const [repositoryNodeId] = yield* decodeCoordinates(taskId)
        const labelName = yield* claimLabelName(taskId)
        const response = yield* client.execute(
          GithubGraphqlRequest.cases.FindClaimLabel.make({
            labelName,
            repositoryNodeId
          })
        ).pipe(
          Effect.mapError((cause) => new TaskClaimReadFailure({ detail: cause.detail, taskId }))
        )
        const header = yield* Schema.decodeUnknownEffect(GraphqlErrors)(
          response.body
        ).pipe(
          Effect.mapError((cause) => new TaskClaimReadFailure({ detail: String(cause), taskId }))
        )
        if (header.errors !== undefined && header.errors.length > 0) {
          return yield* new TaskClaimReadFailure({
            detail: header.errors.map(({ message }) => message).join("; "),
            taskId
          })
        }
        const decoded = yield* Schema.decodeUnknownEffect(
          FindClaimLabelResponse
        )(response.body).pipe(
          Effect.mapError((cause) => new TaskClaimReadFailure({ detail: String(cause), taskId }))
        )
        const repository = decoded.data.node
        if (repository === null) {
          return yield* new TaskClaimReadFailure({
            detail: "GitHub repository node is inaccessible or no longer exists",
            taskId
          })
        }
        if (repository.id !== repositoryNodeId) {
          return yield* new TaskClaimReadFailure({
            detail: `GitHub returned repository ${repository.id} while reading ${repositoryNodeId}`,
            taskId
          })
        }
        const label = repository.label
        if (label === null) {
          return {
            _tag: "Unclaimed" as const,
            observation: UnclaimedTask.make({ taskId })
          } satisfies GithubClaimRecord
        }
        if (label.name !== labelName) {
          return yield* new TaskClaimReadFailure({
            detail: `GitHub returned claim label ${label.name} while reading ${labelName}`,
            taskId
          })
        }
        const description = yield* decodeDescription(taskId, label.description)
        return {
          _tag: "Active" as const,
          labelId: label.id,
          observation: ActiveTaskClaim.make({ ...description, taskId })
        } satisfies GithubClaimRecord
      }
    )

    const readTaskClaim = Effect.fn("GithubTrackerMutation.readTaskClaim")(
      function*(taskId: TaskId) {
        return (yield* readGithubClaim(taskId)).observation
      }
    )

    const acquireTaskClaim = Effect.fn(
      "GithubTrackerMutation.acquireTaskClaim"
    )(function*(acquisition: TaskClaimAcquisition) {
      const [repositoryNodeId] = yield* decodeCoordinates(acquisition.taskId)
      const labelName = yield* claimLabelName(acquisition.taskId)
      const description = yield* descriptionFor(acquisition)
      const response = yield* client.execute(
        GithubGraphqlRequest.cases.CreateClaimLabel.make({
          description,
          labelName,
          operationId: acquisition.operationId,
          repositoryNodeId
        })
      ).pipe(
        Effect.mapError((cause) =>
          new TaskClaimRequestFailure({
            acquisition,
            detail: cause.detail,
            outcome: "Unknown"
          })
        )
      )
      const header = yield* Schema.decodeUnknownEffect(GraphqlErrors)(
        response.body
      ).pipe(
        Effect.mapError((cause) =>
          new TaskClaimRequestFailure({
            acquisition,
            detail: String(cause),
            outcome: "Unknown"
          })
        )
      )
      if (header.errors !== undefined && header.errors.length > 0) {
        const observed = yield* readTaskClaim(acquisition.taskId)
        return observed._tag === "ActiveTaskClaim"
          ? isExactTaskClaim(observed, ActiveTaskClaim.make(acquisition))
            ? observed
            : yield* new TaskClaimConflict({ attempted: acquisition, observed })
          : yield* new TaskClaimRequestFailure({
            acquisition,
            detail: header.errors.map(({ message }) => message).join("; "),
            outcome: "DefinitelyNotApplied"
          })
      }
      yield* Schema.decodeUnknownEffect(CreateClaimLabelResponse)(
        response.body
      ).pipe(
        Effect.mapError((cause) =>
          new TaskClaimRequestFailure({
            acquisition,
            detail: String(cause),
            outcome: "Unknown"
          })
        )
      )
      return ActiveTaskClaim.make(acquisition)
    })

    const releaseTaskClaim = Effect.fn(
      "GithubTrackerMutation.releaseTaskClaim"
    )(function*(claim: ActiveTaskClaim) {
      const current = yield* readGithubClaim(claim.taskId)
      if (
        current._tag !== "Active"
        || !isExactTaskClaim(current.observation, claim)
      ) {
        return yield* new TaskClaimOwnershipConflict({
          attempted: claim,
          observed: current.observation
        })
      }
      const response = yield* client.execute(
        GithubGraphqlRequest.cases.DeleteClaimLabel.make({
          labelNodeId: current.labelId,
          operationId: claim.operationId
        })
      ).pipe(
        Effect.mapError((cause) => new TaskClaimReleaseFailure({ claim, detail: cause.detail }))
      )
      yield* Schema.decodeUnknownEffect(DeleteClaimLabelResponse)(
        response.body
      ).pipe(
        Effect.mapError((cause) => new TaskClaimReleaseFailure({ claim, detail: String(cause) }))
      )
    })

    return TrackerMutation.of({
      acquireTaskClaim,
      readTaskClaim,
      releaseTaskClaim
    })
  })
)

export const githubTrackerMutationNodeLayer = githubTrackerMutationLayer.pipe(
  Layer.provide(githubGraphqlClientNodeLayer),
  Layer.provide(NodeCrypto.layer)
)
