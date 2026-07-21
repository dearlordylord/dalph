import { NodeHttpClient } from "@effect/platform-node"
import { Config, Context, Effect, Layer, Option, type Redacted, Schema } from "effect"
import * as Headers from "effect/unstable/http/Headers"
import * as HttpClient from "effect/unstable/http/HttpClient"
import * as HttpClientRequest from "effect/unstable/http/HttpClientRequest"
import * as HttpClientResponse from "effect/unstable/http/HttpClientResponse"
import { GithubIssueTarget } from "./domain.js"

/** Identifies one GitHub issue node at the provider boundary, not a tracker-neutral task. */
export const GithubIssueNodeId = Schema.NonEmptyString.pipe(
  Schema.brand("GithubIssueNodeId")
)
export type GithubIssueNodeId = typeof GithubIssueNodeId.Type

/** Identifies one GitHub repository node at the provider boundary, not its owner/name locator. */
export const GithubRepositoryNodeId = Schema.NonEmptyString.pipe(
  Schema.brand("GithubRepositoryNodeId")
)
export type GithubRepositoryNodeId = typeof GithubRepositoryNodeId.Type

/** Continues one GitHub connection read; it is not a journal or presentation position. */
export const GithubCursor = Schema.NonEmptyString.pipe(Schema.brand("GithubCursor"))
export type GithubCursor = typeof GithubCursor.Type

export const GithubGraphqlRequest = Schema.TaggedUnion({
  ResolveIssue: { target: GithubIssueTarget },
  ReadIssue: { issueNodeId: GithubIssueNodeId },
  ReadSubIssues: {
    cursor: Schema.NullOr(GithubCursor),
    issueNodeId: GithubIssueNodeId
  },
  ReadBlockedBy: {
    cursor: Schema.NullOr(GithubCursor),
    issueNodeId: GithubIssueNodeId
  }
})
export type GithubGraphqlRequest = typeof GithubGraphqlRequest.Type

/** Identifies one GitHub HTTP response, not a tracker revision or journal position. */
export const GithubRequestId = Schema.NonEmptyString.pipe(
  Schema.brand("GithubRequestId")
)
export type GithubRequestId = typeof GithubRequestId.Type

export const GithubGraphqlResponse = Schema.Struct({
  body: Schema.Unknown,
  requestId: GithubRequestId
})
export type GithubGraphqlResponse = typeof GithubGraphqlResponse.Type

const GithubGraphqlOperation = Schema.Literals([
  "ReadBlockedBy",
  "ReadIssue",
  "ReadSubIssues",
  "ResolveIssue"
])

export class GithubGraphqlRequestError extends Schema.TaggedErrorClass<GithubGraphqlRequestError>()(
  "GithubGraphqlClient.RequestError",
  {
    detail: Schema.String,
    operation: GithubGraphqlOperation
  }
) {}

interface GithubGraphqlClientService {
  readonly execute: (
    request: GithubGraphqlRequest
  ) => Effect.Effect<GithubGraphqlResponse, GithubGraphqlRequestError>
}

/** Executes GitHub GraphQL reads without granting tracker mutation authority. */
export class GithubGraphqlClient extends Context.Service<GithubGraphqlClient, GithubGraphqlClientService>()(
  "@dalph/GithubGraphqlClient"
) {}

const graphqlEndpoint = "https://api.github.com/graphql"
const githubUserAgent = "dalph-orchestrator"
const connectionPageSize = 100

const resolveIssueQuery = `query ResolveIssue($owner: String!, $repository: String!, $issueNumber: Int!) {
  repository(owner: $owner, name: $repository) {
    id
    issue(number: $issueNumber) { id }
  }
}`

const readIssueQuery = `query ReadIssue($issueNodeId: ID!) {
  node(id: $issueNodeId) {
    ... on Issue {
      __typename
      id
      state
      stateReason(enableDuplicate: true)
      repository { id }
      parent { id }
    }
  }
}`

const readSubIssuesQuery = `query ReadSubIssues($issueNodeId: ID!, $cursor: String, $pageSize: Int!) {
  node(id: $issueNodeId) {
    ... on Issue {
      __typename
      id
      subIssues(first: $pageSize, after: $cursor) {
        nodes { id }
        pageInfo { hasNextPage endCursor }
      }
    }
  }
}`

const readBlockedByQuery = `query ReadBlockedBy($issueNodeId: ID!, $cursor: String, $pageSize: Int!) {
  node(id: $issueNodeId) {
    ... on Issue {
      __typename
      id
      blockedBy(first: $pageSize, after: $cursor) {
        nodes { id }
        pageInfo { hasNextPage endCursor }
      }
    }
  }
}`

const requestBody = (request: GithubGraphqlRequest): {
  readonly query: string
  readonly variables: Readonly<Record<string, unknown>>
} => {
  switch (request._tag) {
    case "ResolveIssue":
      return {
        query: resolveIssueQuery,
        variables: {
          issueNumber: request.target.issueNumber,
          owner: request.target.owner,
          repository: request.target.repository
        }
      }
    case "ReadIssue":
      return {
        query: readIssueQuery,
        variables: { issueNodeId: request.issueNodeId }
      }
    case "ReadSubIssues":
      return {
        query: readSubIssuesQuery,
        variables: {
          cursor: request.cursor,
          issueNodeId: request.issueNodeId,
          pageSize: connectionPageSize
        }
      }
    case "ReadBlockedBy":
      return {
        query: readBlockedByQuery,
        variables: {
          cursor: request.cursor,
          issueNodeId: request.issueNodeId,
          pageSize: connectionPageSize
        }
      }
  }
}

const requestError = (
  operation: typeof GithubGraphqlOperation.Type,
  cause: unknown
) => new GithubGraphqlRequestError({ detail: String(cause), operation })

const makeClient = Effect.fn("GithubGraphqlClient.make")(function*(
  token: Redacted.Redacted<string>
) {
  const httpClient = yield* HttpClient.HttpClient
  const execute = Effect.fn("GithubGraphqlClient.execute")(function*(
    request: GithubGraphqlRequest
  ) {
    const httpRequest = HttpClientRequest.post(graphqlEndpoint).pipe(
      HttpClientRequest.acceptJson,
      HttpClientRequest.bearerToken(token),
      HttpClientRequest.setHeader("user-agent", githubUserAgent),
      HttpClientRequest.bodyJsonUnsafe(requestBody(request))
    )
    const response = yield* httpClient.execute(httpRequest).pipe(
      Effect.flatMap(HttpClientResponse.filterStatusOk),
      Effect.mapError((cause) => requestError(request._tag, cause))
    )
    const body = yield* response.json.pipe(
      Effect.mapError((cause) => requestError(request._tag, cause))
    )
    const requestId = Option.getOrUndefined(
      Headers.get(response.headers, "x-github-request-id")
    )
    if (requestId === undefined || requestId.length === 0) {
      return yield* requestError(
        request._tag,
        "GitHub response omitted x-github-request-id"
      )
    }
    return GithubGraphqlResponse.make({ body, requestId: GithubRequestId.make(requestId) })
  })

  return GithubGraphqlClient.of({ execute })
})

export const githubGraphqlClientLayer = (
  options: { readonly token: Redacted.Redacted<string> }
): Layer.Layer<GithubGraphqlClient, never, HttpClient.HttpClient> =>
  Layer.effect(GithubGraphqlClient, makeClient(options.token))

export const githubGraphqlClientConfigLayer: Layer.Layer<
  GithubGraphqlClient,
  Config.ConfigError,
  HttpClient.HttpClient
> = Layer.effect(
  GithubGraphqlClient,
  Effect.gen(function*() {
    const token = yield* Config.redacted("GITHUB_TOKEN")
    return yield* makeClient(token)
  })
)

export const githubGraphqlClientNodeLayer = githubGraphqlClientConfigLayer.pipe(
  Layer.provide(NodeHttpClient.layerUndici)
)
