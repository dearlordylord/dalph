import { Effect } from "effect"
import { makeTaskWorkSpecification, type TaskId } from "@dalph/contracts"
import type { TrackerTarget } from "../target.js"
import { TrackerAdapterReadFailureReason, type TrackerAdapterReadError } from "../graph-reader.js"
import type { GithubGraphqlResponse, GithubRepositoryNodeId } from "./graphql-client.js"
import { GithubGraphqlRequest } from "./graphql-client.js"
import { ReadTaskWorkSpecificationResponse } from "./graph-schema.js"
import { decodeGithubTaskId } from "./task-identity.js"
import { adapterError, decodeResponse, incomplete, type GithubTrackerGraphReadRequest } from "./read-boundary.js"

interface ResolvedGithubRepository {
  readonly repositoryNodeId: GithubRepositoryNodeId
}

/**
 * Builds the focused all-or-nothing title/body read from the same exact target
 * resolution and read-only request boundary used by the complete graph read.
 */
export const makeReadTaskWorkSpecification = (
  execute: (request: GithubTrackerGraphReadRequest) => Effect.Effect<GithubGraphqlResponse, TrackerAdapterReadError>,
  resolveTarget: (target: TrackerTarget) => Effect.Effect<ResolvedGithubRepository, TrackerAdapterReadError>
) =>
  Effect.fn("GithubTrackerGraphReader.readTaskWorkSpecification")(function* (target: TrackerTarget, taskId: TaskId) {
    const identity = yield* decodeGithubTaskId(taskId).pipe(
      Effect.mapError((error) =>
        adapterError(
          "GithubTrackerGraphReader.readTaskWorkSpecification",
          TrackerAdapterReadFailureReason.cases.BoundaryDecode.make({}),
          error.detail
        )
      )
    )
    const { repositoryNodeId } = yield* resolveTarget(target)
    if (identity.repositoryNodeId !== repositoryNodeId) {
      return yield* incomplete(
        "GithubTrackerGraphReader.readTaskWorkSpecification",
        "GitHub task identity belongs to another repository"
      )
    }
    const response = yield* execute(
      GithubGraphqlRequest.cases.ReadTaskWorkSpecification.make({ issueNodeId: identity.issueNodeId })
    )
    const decoded = yield* decodeResponse(
      ReadTaskWorkSpecificationResponse,
      "GithubTrackerGraphReader.readTaskWorkSpecification",
      response
    )
    const issue = decoded.data.node
    if (issue === null) {
      return yield* incomplete(
        "GithubTrackerGraphReader.readTaskWorkSpecification",
        `GitHub issue ${identity.issueNodeId} is inaccessible`
      )
    }
    if (issue.id !== identity.issueNodeId) {
      return yield* incomplete(
        "GithubTrackerGraphReader.readTaskWorkSpecification",
        `GitHub returned issue ${issue.id} while reading ${identity.issueNodeId}`
      )
    }
    if (issue.repository.id !== repositoryNodeId) {
      return yield* incomplete(
        "GithubTrackerGraphReader.readTaskWorkSpecification",
        `GitHub issue ${identity.issueNodeId} is outside the target repository`
      )
    }
    return makeTaskWorkSpecification({ body: issue.body, taskId, title: issue.title })
  })
