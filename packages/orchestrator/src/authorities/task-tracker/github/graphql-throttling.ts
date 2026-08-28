import { Option, Schema } from "effect"
import * as Headers from "effect/unstable/http/Headers"
import type * as HttpClientResponse from "effect/unstable/http/HttpClientResponse"
import {
  TaskTrackerThrottleResetEpochSeconds,
  TaskTrackerThrottleTimingEvidence,
  TaskTrackerThrottleRetryAfterSeconds
} from "../mutation-throttling.js"

export const githubGraphqlForbiddenStatus = 403
export const githubGraphqlTooManyRequestsStatus = 429

export const GithubGraphqlOperation = Schema.Literals([
  "AddBlockedBy",
  "AddIssueComment",
  "AddSubIssue",
  "CloseIssue",
  "CreateClaimLabel",
  "CreateIssue",
  "DeleteIssue",
  "DeleteClaimLabel",
  "FindClaimLabel",
  "ReadBlockedBy",
  "ReadIssueDetails",
  "ReadTaskWorkSpecification",
  "ReadIssue",
  "ReadSubIssues",
  "ReopenIssue",
  "ResolveRepository",
  "ResolveIssue"
])
export type GithubGraphqlOperation = typeof GithubGraphqlOperation.Type

const GithubGraphqlThrottleKind = Schema.Literals(["Primary", "Secondary"])

/** GitHub conclusively refused one GraphQL request under a primary or secondary rate limit. */
export class GithubGraphqlThrottled extends Schema.TaggedError<GithubGraphqlThrottled>()(
  "GithubGraphqlClient.Throttled",
  {
    detail: Schema.String,
    kind: GithubGraphqlThrottleKind,
    operation: GithubGraphqlOperation,
    timingEvidence: Schema.NullOr(TaskTrackerThrottleTimingEvidence)
  }
) {}

const GithubGraphqlErrors = Schema.Struct({
  errors: Schema.optionalKey(Schema.Array(Schema.Struct({ message: Schema.String })))
})

const HeaderSeconds = Schema.FiniteFromString.pipe(
  Schema.check(Schema.isInt()),
  Schema.check(Schema.isGreaterThanOrEqualTo(0))
)

const headerSeconds = (headers: Headers.Headers, name: string): number | undefined =>
  Option.getOrUndefined(
    Headers.get(headers, name).pipe(Option.flatMap((value) => Schema.decodeUnknownOption(HeaderSeconds)(value)))
  )

const throttleTimingEvidenceFrom = (headers: Headers.Headers): TaskTrackerThrottleTimingEvidence | null => {
  const retryAfterSeconds = headerSeconds(headers, "retry-after")
  if (retryAfterSeconds !== undefined) {
    return TaskTrackerThrottleTimingEvidence.cases.RetryAfter.make({
      seconds: TaskTrackerThrottleRetryAfterSeconds.make(retryAfterSeconds)
    })
  }
  const resetEpochSeconds = headerSeconds(headers, "x-ratelimit-reset")
  return resetEpochSeconds === undefined
    ? null
    : TaskTrackerThrottleTimingEvidence.cases.ResetAt.make({
        epochSeconds: TaskTrackerThrottleResetEpochSeconds.make(resetEpochSeconds)
      })
}

const graphqlErrorMessages = (body: unknown): ReadonlyArray<string> =>
  Option.match(Schema.decodeUnknownOption(GithubGraphqlErrors)(body), {
    onNone: () => [],
    onSome: ({ errors }) => errors?.map(({ message }) => message) ?? []
  })

const isSecondaryRateLimitMessage = (message: string): boolean => message.toLowerCase().includes("secondary rate limit")

export const githubGraphqlThrottleFromResponse = (
  operation: GithubGraphqlOperation,
  response: HttpClientResponse.HttpClientResponse,
  body?: unknown
): GithubGraphqlThrottled | undefined => {
  const messages = body === undefined ? [] : graphqlErrorMessages(body)
  const kind =
    response.status === githubGraphqlTooManyRequestsStatus || messages.some(isSecondaryRateLimitMessage)
      ? "Secondary"
      : Headers.get(response.headers, "x-ratelimit-remaining").pipe(Option.contains("0")) &&
          (response.status === githubGraphqlForbiddenStatus || messages.length > 0)
        ? "Primary"
        : undefined
  return kind === undefined
    ? undefined
    : new GithubGraphqlThrottled({
        detail: `GitHub ${kind.toLowerCase()} rate limit rejected the GraphQL request`,
        kind,
        operation,
        timingEvidence: throttleTimingEvidenceFrom(response.headers)
      })
}
