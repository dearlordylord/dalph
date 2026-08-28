import { NodeHttpClient } from "@effect/platform-node"
import { Config, Context, Effect, Layer, Match, type Redacted, Schema } from "effect"
import * as HttpClient from "effect/unstable/http/HttpClient"
import * as HttpClientRequest from "effect/unstable/http/HttpClientRequest"
import * as HttpClientResponse from "effect/unstable/http/HttpClientResponse"
import { GithubIssueTarget, GithubRepositoryName, GithubRepositoryOwner } from "./target.js"
import { OperationId } from "../../../workflow/identity.js"
import {
  GithubGraphqlOperation,
  githubGraphqlForbiddenStatus,
  type GithubGraphqlThrottled,
  githubGraphqlThrottleFromResponse,
  githubGraphqlTooManyRequestsStatus
} from "./graphql-throttling.js"

export { GithubGraphqlThrottled } from "./graphql-throttling.js"

/** Identifies one GitHub issue node at the provider boundary, not a tracker-neutral task. */
export const GithubIssueNodeId = Schema.NonEmptyString.pipe(Schema.brand("GithubIssueNodeId"))
export type GithubIssueNodeId = typeof GithubIssueNodeId.Type

/** Identifies one GitHub repository node at the provider boundary, not its owner/name locator. */
export const GithubRepositoryNodeId = Schema.NonEmptyString.pipe(Schema.brand("GithubRepositoryNodeId"))
export type GithubRepositoryNodeId = typeof GithubRepositoryNodeId.Type

/** Identifies one GitHub label record used only inside the tracker adapter. */
export const GithubLabelNodeId = Schema.NonEmptyString.pipe(Schema.brand("GithubLabelNodeId"))
export type GithubLabelNodeId = typeof GithubLabelNodeId.Type

/** Identifies one repository-scoped GitHub label by its provider name. */
export const GithubLabelName = Schema.NonEmptyString.pipe(Schema.brand("GithubLabelName"))
export type GithubLabelName = typeof GithubLabelName.Type

/** Continues one GitHub connection read; it is not a journal or presentation position. */
export const GithubCursor = Schema.NonEmptyString.pipe(Schema.brand("GithubCursor"))
export type GithubCursor = typeof GithubCursor.Type

export const GithubGraphqlRequest = Schema.TaggedUnion({
  AddBlockedBy: { blockingIssueNodeId: GithubIssueNodeId, issueNodeId: GithubIssueNodeId, operationId: OperationId },
  AddIssueComment: { body: Schema.NonEmptyString, issueNodeId: GithubIssueNodeId, operationId: OperationId },
  AddSubIssue: { operationId: OperationId, parentIssueNodeId: GithubIssueNodeId, subIssueNodeId: GithubIssueNodeId },
  CloseIssue: { issueNodeId: GithubIssueNodeId, operationId: OperationId },
  FindClaimLabel: { labelName: GithubLabelName, repositoryNodeId: GithubRepositoryNodeId },
  CreateClaimLabel: {
    description: Schema.NonEmptyString,
    labelName: GithubLabelName,
    operationId: OperationId,
    repositoryNodeId: GithubRepositoryNodeId
  },
  CreateIssue: {
    body: Schema.String,
    operationId: OperationId,
    repositoryNodeId: GithubRepositoryNodeId,
    title: Schema.NonEmptyString
  },
  DeleteIssue: { issueNodeId: GithubIssueNodeId, operationId: OperationId },
  DeleteClaimLabel: { labelNodeId: GithubLabelNodeId, operationId: OperationId },
  ReadIssueDetails: { issueNodeId: GithubIssueNodeId },
  ReopenIssue: { issueNodeId: GithubIssueNodeId, operationId: OperationId },
  ResolveRepository: { owner: GithubRepositoryOwner, repository: GithubRepositoryName },
  ResolveIssue: { target: GithubIssueTarget },
  ReadIssue: { issueNodeId: GithubIssueNodeId },
  ReadSubIssues: { cursor: Schema.NullOr(GithubCursor), issueNodeId: GithubIssueNodeId },
  ReadBlockedBy: { cursor: Schema.NullOr(GithubCursor), issueNodeId: GithubIssueNodeId }
})
export type GithubGraphqlRequest = typeof GithubGraphqlRequest.Type

export const GithubGraphqlResponse = Schema.Struct({ body: Schema.Unknown })
export type GithubGraphqlResponse = typeof GithubGraphqlResponse.Type

export class GithubGraphqlRequestError extends Schema.TaggedError<GithubGraphqlRequestError>()(
  "GithubGraphqlClient.RequestError",
  { detail: Schema.String, operation: GithubGraphqlOperation }
) {}

interface GithubGraphqlClientService {
  readonly execute: (
    request: GithubGraphqlRequest
  ) => Effect.Effect<GithubGraphqlResponse, GithubGraphqlRequestError | GithubGraphqlThrottled>
}

/** Executes authenticated GitHub GraphQL requests; adapter services retain domain authority. */
export class GithubGraphqlClient extends Context.Service<GithubGraphqlClient, GithubGraphqlClientService>()(
  "@dalph/GithubGraphqlClient"
) {}

const graphqlEndpoint = "https://api.github.com/graphql"
const githubUserAgent = "dalph-orchestrator"
const connectionPageSize = 100
// Stable identity format guidance:
// https://docs.github.com/en/graphql/guides/migrating-graphql-global-node-ids
const nextGlobalIdHeaderValue = "1"

const resolveIssueQuery = `query ResolveIssue($owner: String!, $repository: String!, $issueNumber: Int!) {
  repository(owner: $owner, name: $repository) {
    id
    issue(number: $issueNumber) { id }
  }
}`

const resolveRepositoryQuery = `query ResolveRepository($owner: String!, $repository: String!) {
  repository(owner: $owner, name: $repository) { id }
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

const readIssueDetailsQuery = `query ReadIssueDetails($issueNodeId: ID!) {
  node(id: $issueNodeId) {
    ... on Issue {
      __typename
      id
      number
      state
      stateReason(enableDuplicate: true)
      repository { id }
      body
      updatedAt
      url
      comments(first: 100) {
        nodes { id body }
      }
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

const findClaimLabelQuery = `query FindClaimLabel($repositoryNodeId: ID!, $labelName: String!) {
  node(id: $repositoryNodeId) {
    ... on Repository {
      id
      label(name: $labelName) { id name description }
    }
  }
}`

const createClaimLabelMutation = `mutation CreateClaimLabel($repositoryNodeId: ID!, $labelName: String!, $description: String!, $operationId: String!) {
  createLabel(input: { repositoryId: $repositoryNodeId, name: $labelName, color: "5319E7", description: $description, clientMutationId: $operationId }) {
    label { id name description }
  }
}`

const deleteClaimLabelMutation = `mutation DeleteClaimLabel($labelNodeId: ID!, $operationId: String!) {
  deleteLabel(input: { id: $labelNodeId, clientMutationId: $operationId }) {
    clientMutationId
  }
}`

const createIssueMutation = `mutation CreateIssue($repositoryNodeId: ID!, $title: String!, $body: String!, $operationId: String!) {
  createIssue(input: { repositoryId: $repositoryNodeId, title: $title, body: $body, clientMutationId: $operationId }) {
    clientMutationId
    issue { id number state stateReason }
  }
}`

const deleteIssueMutation = `mutation DeleteIssue($issueNodeId: ID!, $operationId: String!) {
  deleteIssue(input: { issueId: $issueNodeId, clientMutationId: $operationId }) {
    clientMutationId
  }
}`

const addIssueCommentMutation = `mutation AddIssueComment($issueNodeId: ID!, $body: String!, $operationId: String!) {
  addComment(input: { subjectId: $issueNodeId, body: $body, clientMutationId: $operationId }) {
    clientMutationId
  }
}`

const addSubIssueMutation = `mutation AddSubIssue($parentIssueNodeId: ID!, $subIssueNodeId: ID!, $operationId: String!) {
  addSubIssue(input: { issueId: $parentIssueNodeId, subIssueId: $subIssueNodeId, clientMutationId: $operationId }) {
    clientMutationId
    issue { id }
    subIssue { id }
  }
}`

const addBlockedByMutation = `mutation AddBlockedBy($issueNodeId: ID!, $blockingIssueNodeId: ID!, $operationId: String!) {
  addBlockedBy(input: { issueId: $issueNodeId, blockingIssueId: $blockingIssueNodeId, clientMutationId: $operationId }) {
    clientMutationId
    issue { id }
    blockingIssue { id }
  }
}`

const closeIssueMutation = `mutation CloseIssue($issueNodeId: ID!, $operationId: String!) {
  closeIssue(input: { issueId: $issueNodeId, stateReason: COMPLETED, clientMutationId: $operationId }) {
    clientMutationId
    issue { id state stateReason }
  }
}`

const reopenIssueMutation = `mutation ReopenIssue($issueNodeId: ID!, $operationId: String!) {
  reopenIssue(input: { issueId: $issueNodeId, clientMutationId: $operationId }) {
    clientMutationId
    issue { id state stateReason }
  }
}`

const requestBody = (
  request: GithubGraphqlRequest
): { readonly query: string; readonly variables: Readonly<Record<string, unknown>> } => {
  return Match.valueTags(request, {
    AddBlockedBy: (request) => ({
      query: addBlockedByMutation,
      variables: {
        blockingIssueNodeId: request.blockingIssueNodeId,
        issueNodeId: request.issueNodeId,
        operationId: request.operationId
      }
    }),
    AddIssueComment: (request) => ({
      query: addIssueCommentMutation,
      variables: { body: request.body, issueNodeId: request.issueNodeId, operationId: request.operationId }
    }),
    AddSubIssue: (request) => ({
      query: addSubIssueMutation,
      variables: {
        operationId: request.operationId,
        parentIssueNodeId: request.parentIssueNodeId,
        subIssueNodeId: request.subIssueNodeId
      }
    }),
    CloseIssue: (request) => ({
      query: closeIssueMutation,
      variables: { issueNodeId: request.issueNodeId, operationId: request.operationId }
    }),
    FindClaimLabel: (request) => ({
      query: findClaimLabelQuery,
      variables: { labelName: request.labelName, repositoryNodeId: request.repositoryNodeId }
    }),
    CreateClaimLabel: (request) => ({
      query: createClaimLabelMutation,
      variables: {
        description: request.description,
        labelName: request.labelName,
        operationId: request.operationId,
        repositoryNodeId: request.repositoryNodeId
      }
    }),
    CreateIssue: (request) => ({
      query: createIssueMutation,
      variables: {
        body: request.body,
        operationId: request.operationId,
        repositoryNodeId: request.repositoryNodeId,
        title: request.title
      }
    }),
    DeleteIssue: (request) => ({
      query: deleteIssueMutation,
      variables: { issueNodeId: request.issueNodeId, operationId: request.operationId }
    }),
    DeleteClaimLabel: (request) => ({
      query: deleteClaimLabelMutation,
      variables: { labelNodeId: request.labelNodeId, operationId: request.operationId }
    }),
    ReadIssueDetails: (request) => ({ query: readIssueDetailsQuery, variables: { issueNodeId: request.issueNodeId } }),
    ReopenIssue: (request) => ({
      query: reopenIssueMutation,
      variables: { issueNodeId: request.issueNodeId, operationId: request.operationId }
    }),
    ResolveRepository: (request) => ({
      query: resolveRepositoryQuery,
      variables: { owner: request.owner, repository: request.repository }
    }),
    ResolveIssue: (request) => ({
      query: resolveIssueQuery,
      variables: {
        issueNumber: request.target.issueNumber,
        owner: request.target.owner,
        repository: request.target.repository
      }
    }),
    ReadIssue: (request) => ({ query: readIssueQuery, variables: { issueNodeId: request.issueNodeId } }),
    ReadSubIssues: (request) => ({
      query: readSubIssuesQuery,
      variables: { cursor: request.cursor, issueNodeId: request.issueNodeId, pageSize: connectionPageSize }
    }),
    ReadBlockedBy: (request) => ({
      query: readBlockedByQuery,
      variables: { cursor: request.cursor, issueNodeId: request.issueNodeId, pageSize: connectionPageSize }
    })
  })
}

const requestError = (operation: typeof GithubGraphqlOperation.Type, cause: unknown) =>
  new GithubGraphqlRequestError({ detail: String(cause), operation })

const ensureResponseCanHaveGraphqlBody = Effect.fn("GithubGraphqlClient.ensureResponseCanHaveGraphqlBody")(function* (
  operation: typeof GithubGraphqlOperation.Type,
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
  operation: typeof GithubGraphqlOperation.Type,
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

const makeClient = Effect.fn("GithubGraphqlClient.make")(function* (token: Redacted.Redacted<string>) {
  const httpClient = yield* HttpClient.HttpClient
  const execute = Effect.fn("GithubGraphqlClient.execute")(function* (request: GithubGraphqlRequest) {
    const httpRequest = HttpClientRequest.post(graphqlEndpoint).pipe(
      HttpClientRequest.acceptJson,
      HttpClientRequest.bearerToken(token),
      HttpClientRequest.setHeader("user-agent", githubUserAgent),
      HttpClientRequest.setHeader("x-github-next-global-id", nextGlobalIdHeaderValue),
      HttpClientRequest.bodyJsonUnsafe(requestBody(request))
    )
    const response = yield* httpClient
      .execute(httpRequest)
      .pipe(Effect.mapError((cause) => requestError(request._tag, cause)))
    return yield* decodeGraphqlResponse(request._tag, response)
  })

  return GithubGraphqlClient.of({ execute })
})

export const githubGraphqlClientLayer = (options: {
  readonly token: Redacted.Redacted<string>
}): Layer.Layer<GithubGraphqlClient, never, HttpClient.HttpClient> =>
  Layer.effect(GithubGraphqlClient, makeClient(options.token))

export const githubGraphqlClientConfigLayer: Layer.Layer<
  GithubGraphqlClient,
  Config.ConfigError,
  HttpClient.HttpClient
> = Layer.effect(
  GithubGraphqlClient,
  Effect.gen(function* () {
    const token = yield* Config.redacted("GITHUB_TOKEN")
    return yield* makeClient(token)
  })
)

export const githubGraphqlClientNodeLayer = githubGraphqlClientConfigLayer.pipe(
  Layer.provide(NodeHttpClient.layerUndici)
)
