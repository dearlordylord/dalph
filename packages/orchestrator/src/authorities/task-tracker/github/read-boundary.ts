import { Effect, Match, Schema } from "effect"
import type { TrackerTarget } from "../target.js"
import {
  type GithubTrackerReadOperation,
  TrackerAdapterReadContext,
  TrackerAdapterReadError,
  TrackerAdapterReadFailureReason
} from "../graph-reader.js"
import type { GithubIssueTarget } from "./target.js"
import type { GithubGraphqlResponse, GithubGraphqlRequest } from "./graphql-client.js"
import { GraphqlErrorsEnvelope } from "./graph-schema.js"
import { isGithubRateLimitErrorMessage } from "./graphql-read-throttle.js"

/** The closed GitHub requests from which the tracker graph reader may construct facts. */
export type GithubTrackerGraphReadRequest = Extract<
  GithubGraphqlRequest,
  { readonly _tag: "ReadBlockedBy" | "ReadIssue" | "ReadSubIssues" | "ReadTaskWorkSpecification" | "ResolveIssue" }
>

export const adapterError = (
  operation: GithubTrackerReadOperation,
  reason: TrackerAdapterReadFailureReason,
  detail: string
) =>
  new TrackerAdapterReadError({ context: TrackerAdapterReadContext.cases.Github.make({ operation }), detail, reason })

export const decodeResponse = <S extends Schema.Constraint>(
  schema: S,
  operation: GithubTrackerReadOperation,
  response: GithubGraphqlResponse
) =>
  Effect.gen(function* () {
    const header = yield* Schema.decodeUnknownEffect(GraphqlErrorsEnvelope)(response.body).pipe(
      Effect.mapError((cause) =>
        adapterError(operation, TrackerAdapterReadFailureReason.cases.BoundaryDecode.make({}), String(cause))
      )
    )
    if (header.errors !== undefined && header.errors.length > 0) {
      const throttled = header.errors.some(({ message, type }) => {
        return type?.toUpperCase() === "RATE_LIMITED" || isGithubRateLimitErrorMessage(message)
      })
      return yield* adapterError(
        operation,
        throttled
          ? TrackerAdapterReadFailureReason.cases.Throttled.make({})
          : TrackerAdapterReadFailureReason.cases.IncompleteSnapshot.make({}),
        throttled ? "GitHub throttled the tracker read" : header.errors.map(({ message }) => message).join("; ")
      )
    }
    return yield* Schema.decodeUnknownEffect(schema)(response.body).pipe(
      Effect.mapError((cause) =>
        adapterError(operation, TrackerAdapterReadFailureReason.cases.BoundaryDecode.make({}), String(cause))
      )
    )
  })

export const incomplete = (operation: GithubTrackerReadOperation, detail: string) =>
  adapterError(operation, TrackerAdapterReadFailureReason.cases.IncompleteSnapshot.make({}), detail)

export const resourceLimitExceeded = (operation: GithubTrackerReadOperation, detail: string) =>
  adapterError(operation, TrackerAdapterReadFailureReason.cases.ResourceLimitExceeded.make({}), detail)

export const githubTarget = (target: TrackerTarget): Effect.Effect<GithubIssueTarget, TrackerAdapterReadError> =>
  typeof target === "string"
    ? Effect.fail(
        adapterError(
          "GithubTrackerGraphReader.selectAdapter",
          TrackerAdapterReadFailureReason.cases.UnsupportedTarget.make({}),
          "GitHub reader cannot read a fixture target"
        )
      )
    : Effect.succeed(target)

export const operationForRequest = (request: GithubTrackerGraphReadRequest): GithubTrackerReadOperation =>
  Match.valueTags(request, {
    ResolveIssue: (): GithubTrackerReadOperation => "GithubTrackerGraphReader.resolveIssue",
    ReadIssue: (): GithubTrackerReadOperation => "GithubTrackerGraphReader.readIssue",
    ReadTaskWorkSpecification: (): GithubTrackerReadOperation => "GithubTrackerGraphReader.readTaskWorkSpecification",
    ReadSubIssues: (): GithubTrackerReadOperation => "GithubTrackerGraphReader.readSubIssues",
    ReadBlockedBy: (): GithubTrackerReadOperation => "GithubTrackerGraphReader.readBlockedBy"
  })
