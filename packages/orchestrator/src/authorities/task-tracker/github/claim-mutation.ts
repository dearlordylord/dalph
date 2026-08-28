import { NodeCrypto } from "@effect/platform-node"
import { Crypto, Effect, Layer, Schema } from "effect"
import { type TaskId } from "@dalph/contracts"
import {
  GithubGraphqlClient,
  githubGraphqlClientNodeLayer,
  GithubGraphqlRequest,
  GithubLabelName,
  type GithubLabelNodeId
} from "./graphql-client.js"
import { githubTaskClaimLabelDigestFor } from "./claim-label-identity.js"
import {
  CreateClaimLabelResponse,
  DeleteClaimLabelResponse,
  FindClaimLabelResponse,
  GithubGraphqlErrors
} from "./claim-label-response.js"
import { decodeGithubTaskId } from "./task-identity.js"
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
} from "../claim-mutation.js"
import type { TaskClaimAcquisition, TaskClaimRelease } from "../claim-mutation.js"
import { mapGithubMutationFailure } from "./mutation-throttling.js"

const GithubClaimDescriptionFields = Schema.Struct({
  operationId: ActiveTaskClaim.fields.operationId,
  owner: ActiveTaskClaim.fields.owner,
  token: ActiveTaskClaim.fields.token
})

const githubClaimDescriptionVersion = "1"
const githubClaimDescriptionSeparator = "|"
const githubClaimDescriptionMaximumLength = 100
type GithubClaimRecord =
  | { readonly _tag: "Unclaimed"; readonly observation: UnclaimedTask }
  | { readonly _tag: "Active"; readonly labelId: GithubLabelNodeId; readonly observation: ActiveTaskClaim }

const decodeCoordinates = (taskId: TaskId) =>
  decodeGithubTaskId(taskId).pipe(
    Effect.mapError((cause) => new TaskClaimReadFailure({ detail: cause.detail, taskId }))
  )

const descriptionFor = (acquisition: TaskClaimAcquisition): Effect.Effect<string, TaskClaimRequestFailure> => {
  const components = [acquisition.operationId, acquisition.owner, acquisition.token]
  const description = [githubClaimDescriptionVersion, ...components].join(githubClaimDescriptionSeparator)
  return components.some((component) => component.includes(githubClaimDescriptionSeparator)) ||
    description.length > githubClaimDescriptionMaximumLength
    ? Effect.fail(
        new TaskClaimRequestFailure({
          acquisition,
          detail: "GitHub claim operation, owner, and token must fit the 100-character label description without '|'",
          outcome: "DefinitelyNotApplied"
        })
      )
    : Effect.succeed(description)
}

const decodeDescription = (taskId: TaskId, description: string) => {
  const [version, operationId, owner, token, overflow] = description.split(githubClaimDescriptionSeparator)
  if (
    version !== githubClaimDescriptionVersion ||
    operationId === undefined ||
    owner === undefined ||
    token === undefined ||
    overflow !== undefined
  ) {
    return Effect.fail(
      new TaskClaimReadFailure({ detail: "GitHub claim label has an unsupported description encoding", taskId })
    )
  }
  return Schema.decodeUnknownEffect(GithubClaimDescriptionFields)({ operationId, owner, token }).pipe(
    Effect.mapError((cause) => new TaskClaimReadFailure({ detail: String(cause), taskId }))
  )
}

/** Derives the exact repository label name that represents one GitHub task claim. */
export const githubClaimLabelNameFor = Effect.fn("GithubTrackerMutation.claimLabelName")(function* (
  crypto: Crypto.Crypto,
  taskId: TaskId
) {
  const digest = yield* githubTaskClaimLabelDigestFor(crypto, taskId).pipe(
    Effect.mapError((cause) => new TaskClaimReadFailure({ detail: String(cause), taskId }))
  )
  return GithubLabelName.make(`dalph-claim-${digest}`)
})

export const githubTrackerMutationLayer = Layer.effect(
  TrackerMutation,
  Effect.gen(function* () {
    const client = yield* GithubGraphqlClient
    const crypto = yield* Crypto.Crypto

    const readGithubClaim = Effect.fn("GithubTrackerMutation.readGithubClaim")(function* (taskId: TaskId) {
      const { repositoryNodeId } = yield* decodeCoordinates(taskId)
      const labelName = yield* githubClaimLabelNameFor(crypto, taskId)
      const response = yield* client
        .execute(GithubGraphqlRequest.cases.FindClaimLabel.make({ labelName, repositoryNodeId }))
        .pipe(Effect.mapError((cause) => new TaskClaimReadFailure({ detail: cause.detail, taskId })))
      const header = yield* Schema.decodeUnknownEffect(GithubGraphqlErrors)(response.body).pipe(
        Effect.mapError((cause) => new TaskClaimReadFailure({ detail: String(cause), taskId }))
      )
      if (header.errors !== undefined && header.errors.length > 0) {
        return yield* new TaskClaimReadFailure({
          detail: header.errors.map(({ message }) => message).join("; "),
          taskId
        })
      }
      const decoded = yield* Schema.decodeUnknownEffect(FindClaimLabelResponse)(response.body).pipe(
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
        return { _tag: "Unclaimed" as const, observation: UnclaimedTask.make({ taskId }) } satisfies GithubClaimRecord
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
    })

    const readTaskClaim = Effect.fn("GithubTrackerMutation.readTaskClaim")(function* (taskId: TaskId) {
      return (yield* readGithubClaim(taskId)).observation
    })

    const acquireTaskClaim = Effect.fn("GithubTrackerMutation.acquireTaskClaim")(function* (
      acquisition: TaskClaimAcquisition
    ) {
      const { repositoryNodeId } = yield* decodeCoordinates(acquisition.taskId)
      const labelName = yield* githubClaimLabelNameFor(crypto, acquisition.taskId)
      const description = yield* descriptionFor(acquisition)
      const response = yield* client
        .execute(
          GithubGraphqlRequest.cases.CreateClaimLabel.make({
            description,
            labelName,
            operationId: acquisition.operationId,
            repositoryNodeId
          })
        )
        .pipe(
          Effect.mapError(
            mapGithubMutationFailure(
              "AcquireTaskClaim",
              acquisition.operationId,
              (cause) => new TaskClaimRequestFailure({ acquisition, detail: cause.detail, outcome: "Unknown" })
            )
          )
        )
      const header = yield* Schema.decodeUnknownEffect(GithubGraphqlErrors)(response.body).pipe(
        Effect.mapError(
          (cause) => new TaskClaimRequestFailure({ acquisition, detail: String(cause), outcome: "Unknown" })
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
      yield* Schema.decodeUnknownEffect(CreateClaimLabelResponse)(response.body).pipe(
        Effect.mapError(
          (cause) => new TaskClaimRequestFailure({ acquisition, detail: String(cause), outcome: "Unknown" })
        )
      )
      return ActiveTaskClaim.make(acquisition)
    })

    const releaseTaskClaim = Effect.fn("GithubTrackerMutation.releaseTaskClaim")(function* (release: TaskClaimRelease) {
      const claim = release.claim
      const current = yield* readGithubClaim(claim.taskId)
      if (current._tag !== "Active" || !isExactTaskClaim(current.observation, claim)) {
        return yield* new TaskClaimOwnershipConflict({ attempted: claim, observed: current.observation })
      }
      const response = yield* client
        .execute(
          GithubGraphqlRequest.cases.DeleteClaimLabel.make({
            labelNodeId: current.labelId,
            operationId: release.operationId
          })
        )
        .pipe(
          Effect.mapError(
            mapGithubMutationFailure(
              "ReleaseTaskClaim",
              release.operationId,
              (cause) => new TaskClaimReleaseFailure({ release, detail: cause.detail })
            )
          )
        )
      yield* Schema.decodeUnknownEffect(DeleteClaimLabelResponse)(response.body).pipe(
        Effect.mapError((cause) => new TaskClaimReleaseFailure({ release, detail: String(cause) }))
      )
    })

    return TrackerMutation.of({ acquireTaskClaim, readTaskClaim, releaseTaskClaim })
  })
)

export const githubTrackerMutationNodeLayer = githubTrackerMutationLayer.pipe(
  Layer.provide(githubGraphqlClientNodeLayer),
  Layer.provide(NodeCrypto.layer)
)
