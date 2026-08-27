import { Effect, Option, Result, Schema } from "effect"
import * as Headers from "effect/unstable/http/Headers"
import type * as HttpClientResponse from "effect/unstable/http/HttpClientResponse"

/** The closed GitHub operations whose HTTP responses may become typed read throttles. */
export const GithubGraphqlReadOperation = Schema.Literals([
  "FindClaimLabel",
  "ReadBlockedBy",
  "ReadIssueDetails",
  "ReadTaskWorkSpecification",
  "ReadIssue",
  "ReadSubIssues",
  "ResolveIssue",
  "ResolveRepository"
])
export type GithubGraphqlReadOperation = typeof GithubGraphqlReadOperation.Type

const SafeRateLimitInteger = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))

/** Whole seconds GitHub asks the client to wait after one throttled read. */
const GithubRetryAfterSeconds = SafeRateLimitInteger.pipe(Schema.brand("GithubRetryAfterSeconds"))

/** Unix epoch seconds at which GitHub reports that one request limit resets. */
const GithubRateLimitResetEpochSeconds = SafeRateLimitInteger.pipe(Schema.brand("GithubRateLimitResetEpochSeconds"))

/** Safe provider timing evidence retained without response bodies, request data, or credentials. */
export const GithubGraphqlThrottleEvidence = Schema.TaggedUnion({
  RateLimitResetEpochSeconds: { epochSeconds: GithubRateLimitResetEpochSeconds },
  RetryAfterSeconds: { seconds: GithubRetryAfterSeconds },
  Unavailable: {}
})
export type GithubGraphqlThrottleEvidence = typeof GithubGraphqlThrottleEvidence.Type

/** GitHub rejected one read-only request because its primary or secondary request limit was active. */
export class GithubGraphqlReadThrottled extends Schema.TaggedError<GithubGraphqlReadThrottled>()(
  "GithubGraphqlClient.ReadThrottled",
  { detail: Schema.String, operation: GithubGraphqlReadOperation, retry: GithubGraphqlThrottleEvidence }
) {}

const decodedHeaderInteger = (headers: Headers.Headers, name: string): Option.Option<number> =>
  Option.filter(
    Option.flatMap(Headers.get(headers, name), Schema.decodeUnknownOption(Schema.FiniteFromString)),
    (value) => Number.isSafeInteger(value) && value >= 0
  )

const throttleEvidence = (headers: Headers.Headers): GithubGraphqlThrottleEvidence =>
  Option.match(decodedHeaderInteger(headers, "retry-after"), {
    onNone: () =>
      Option.match(decodedHeaderInteger(headers, "x-ratelimit-reset"), {
        onNone: () => GithubGraphqlThrottleEvidence.cases.Unavailable.make({}),
        onSome: (epochSeconds) =>
          GithubGraphqlThrottleEvidence.cases.RateLimitResetEpochSeconds.make({
            epochSeconds: GithubRateLimitResetEpochSeconds.make(epochSeconds)
          })
      }),
    onSome: (seconds) =>
      GithubGraphqlThrottleEvidence.cases.RetryAfterSeconds.make({ seconds: GithubRetryAfterSeconds.make(seconds) })
  })

const GithubHttpErrorEnvelope = Schema.Struct({ message: Schema.String })

/** Recognizes GitHub's primary and secondary request-limit messages after case normalization. */
export const isGithubRateLimitErrorMessage = (message: string): boolean => {
  const normalized = message.toLowerCase()
  return normalized.includes("secondary rate limit") || normalized.includes("api rate limit exceeded")
}

const rateLimitMessage = (body: unknown): boolean =>
  Option.match(Schema.decodeUnknownOption(GithubHttpErrorEnvelope)(body), {
    onNone: () => false,
    onSome: ({ message }) => isGithubRateLimitErrorMessage(message)
  })

const httpForbidden = 403
const httpTooManyRequests = 429

/** Returns safe throttle evidence only when one read response proves provider throttling. */
export const observeGithubGraphqlReadThrottle = Effect.fn("GithubGraphqlClient.observeReadThrottle")(function* (
  response: HttpClientResponse.HttpClientResponse
) {
  const retryAfter = Headers.has(response.headers, "retry-after")
  const exhaustedPrimaryLimit = Option.contains(Headers.get(response.headers, "x-ratelimit-remaining"), "0")
  if (
    response.status === httpTooManyRequests ||
    (response.status === httpForbidden && (retryAfter || exhaustedPrimaryLimit))
  ) {
    return Option.some(throttleEvidence(response.headers))
  }
  if (response.status !== httpForbidden) return Option.none<GithubGraphqlThrottleEvidence>()
  const body = yield* Effect.result(response.json)
  return Result.isSuccess(body) && rateLimitMessage(body.success)
    ? Option.some(throttleEvidence(response.headers))
    : Option.none<GithubGraphqlThrottleEvidence>()
})
