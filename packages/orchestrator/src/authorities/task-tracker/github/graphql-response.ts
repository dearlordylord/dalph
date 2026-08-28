import { Effect, Option, Schema } from "effect"
import * as HttpClientResponse from "effect/unstable/http/HttpClientResponse"
import {
  type GithubGraphqlReadOperation,
  GithubGraphqlThrottleEvidence,
  GithubGraphqlReadThrottled,
  observeGithubGraphqlReadThrottle
} from "./graphql-read-throttle.js"
import {
  GithubGraphqlOperation,
  githubGraphqlForbiddenStatus,
  GithubGraphqlThrottled,
  githubGraphqlThrottleFromResponse,
  githubGraphqlTooManyRequestsStatus
} from "./graphql-throttling.js"

export const GithubGraphqlResponse = Schema.Struct({ body: Schema.Unknown })
export type GithubGraphqlResponse = typeof GithubGraphqlResponse.Type

export class GithubGraphqlRequestError extends Schema.TaggedError<GithubGraphqlRequestError>()(
  "GithubGraphqlClient.RequestError",
  { detail: Schema.String, operation: GithubGraphqlOperation }
) {}

const requestError = (operation: GithubGraphqlOperation, cause: unknown) =>
  new GithubGraphqlRequestError({ detail: String(cause), operation })

const ensureResponseCanHaveGraphqlBody = Effect.fn("GithubGraphqlClient.ensureResponseCanHaveGraphqlBody")(function* (
  operation: GithubGraphqlOperation,
  response: HttpClientResponse.HttpClientResponse
) {
  // A 403 body can distinguish an explicit secondary limit from exhausted
  // primary-limit headers, so parse it before choosing between those kinds.
  if (response.status === githubGraphqlTooManyRequestsStatus) {
    const tooManyRequests = githubGraphqlThrottleFromResponse(operation, response)
    if (tooManyRequests !== undefined) return yield* tooManyRequests
  }
  if (response.status === githubGraphqlForbiddenStatus) return
  yield* HttpClientResponse.filterStatusOk(response).pipe(Effect.mapError((cause) => requestError(operation, cause)))
})

const decodeGraphqlResponse = Effect.fn("GithubGraphqlClient.decodeResponse")(function* (
  operation: GithubGraphqlOperation,
  response: HttpClientResponse.HttpClientResponse
) {
  yield* ensureResponseCanHaveGraphqlBody(operation, response)
  const bodyResult = yield* response.json.pipe(Effect.result)
  if (bodyResult._tag === "Failure") {
    const headerThrottle = githubGraphqlThrottleFromResponse(operation, response)
    if (headerThrottle !== undefined) return yield* headerThrottle
    yield* HttpClientResponse.filterStatusOk(response).pipe(Effect.mapError((cause) => requestError(operation, cause)))
    return yield* requestError(operation, bodyResult.failure)
  }
  const bodyThrottle = githubGraphqlThrottleFromResponse(operation, response, bodyResult.success)
  if (bodyThrottle !== undefined) return yield* bodyThrottle
  yield* HttpClientResponse.filterStatusOk(response).pipe(Effect.mapError((cause) => requestError(operation, cause)))
  return GithubGraphqlResponse.make({ body: bodyResult.success })
})

const readThrottleFrom = (
  operation: GithubGraphqlReadOperation,
  throttled: GithubGraphqlThrottled
): GithubGraphqlReadThrottled => {
  const retry =
    throttled.timingEvidence === null
      ? GithubGraphqlThrottleEvidence.cases.Unavailable.make({})
      : Schema.decodeUnknownSync(GithubGraphqlThrottleEvidence)(
          throttled.timingEvidence._tag === "RetryAfter"
            ? { _tag: "RetryAfterSeconds", seconds: throttled.timingEvidence.seconds }
            : { _tag: "RateLimitResetEpochSeconds", epochSeconds: throttled.timingEvidence.epochSeconds }
        )
  return new GithubGraphqlReadThrottled({ detail: "GitHub request throttled", operation, retry })
}

/** Decodes one read response without exposing mutation-throttle recovery semantics. */
export const decodeGithubGraphqlReadResponse = Effect.fn("GithubGraphqlClient.decodeReadResponse")(function* (
  operation: GithubGraphqlReadOperation,
  response: HttpClientResponse.HttpClientResponse
) {
  const throttled = yield* observeGithubGraphqlReadThrottle(response)
  if (Option.isSome(throttled)) {
    return yield* new GithubGraphqlReadThrottled({
      detail: "GitHub request throttled",
      operation,
      retry: throttled.value
    })
  }
  return yield* decodeGraphqlResponse(operation, response).pipe(
    Effect.mapError((failure) =>
      failure instanceof GithubGraphqlThrottled ? readThrottleFrom(operation, failure) : failure
    )
  )
})

/** Decodes one mutation response without retrying or scheduling another mutation. */
export const decodeGithubGraphqlMutationResponse = decodeGraphqlResponse
