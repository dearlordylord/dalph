// @effect-diagnostics multipleEffectProvide:off
import { expect, it } from "@effect/vitest"
import { ConfigProvider, Effect, Layer, Option, Redacted, Ref, Schema } from "effect"
import * as Headers from "effect/unstable/http/Headers"
import * as HttpClient from "effect/unstable/http/HttpClient"
import * as HttpClientResponse from "effect/unstable/http/HttpClientResponse"
import { GithubIssueNumber, GithubIssueTarget, GithubRepositoryName, GithubRepositoryOwner } from "./target.js"
import { OperationId } from "../../../workflow/identity.js"
import {
  GithubCursor,
  GithubGraphqlClient,
  githubGraphqlClientConfigLayer,
  githubGraphqlClientLayer,
  GithubGraphqlRequest,
  GithubGraphqlThrottled,
  GithubIssueNodeId,
  GithubLabelName,
  GithubLabelNodeId,
  GithubRepositoryNodeId
} from "./graphql-client.js"
import { GithubGraphqlReadThrottled } from "./graphql-read-throttle.js"

const EncodedRequestBody = Schema.Struct({ body: Schema.String })
const ResolveRequestBody = Schema.Struct({
  query: Schema.String,
  variables: Schema.Struct({ issueNumber: Schema.Int, owner: Schema.String, repository: Schema.String })
})

const target = GithubIssueTarget.make({
  issueNumber: GithubIssueNumber.make(42),
  owner: GithubRepositoryOwner.make("octo"),
  repository: GithubRepositoryName.make("dalph")
})

it.effect("executes authenticated GitHub GraphQL requests", () =>
  Effect.gen(function* () {
    const observed = yield* Ref.make<
      ReadonlyArray<{
        readonly authorization: string | undefined
        readonly body: string
        readonly globalIdVersion: string | undefined
        readonly method: string
        readonly url: string
        readonly userAgent: string | undefined
      }>
    >([])
    const httpClient = HttpClient.make((request) =>
      Effect.gen(function* () {
        const encodedBody = Schema.decodeUnknownSync(EncodedRequestBody)(request.body.toJSON())
        yield* Ref.update(observed, (requests) => [
          ...requests,
          {
            authorization: Option.getOrUndefined(Headers.get(request.headers, "authorization")),
            body: encodedBody.body,
            globalIdVersion: Option.getOrUndefined(Headers.get(request.headers, "x-github-next-global-id")),
            method: request.method,
            url: request.url,
            userAgent: Option.getOrUndefined(Headers.get(request.headers, "user-agent"))
          }
        ])
        return HttpClientResponse.fromWeb(
          request,
          new Response(JSON.stringify({ data: { repository: { id: "repo", issue: { id: "issue" } } } }), {
            status: 200
          })
        )
      })
    )
    const clientLayer = githubGraphqlClientLayer({ token: Redacted.make("secret-token") }).pipe(
      Layer.provide(Layer.succeed(HttpClient.HttpClient, httpClient))
    )
    yield* Effect.gen(function* () {
      const client = yield* GithubGraphqlClient
      return yield* Effect.forEach(
        [
          GithubGraphqlRequest.cases.ResolveIssue.make({ target }),
          GithubGraphqlRequest.cases.ResolveRepository.make({
            owner: GithubRepositoryOwner.make("octo"),
            repository: GithubRepositoryName.make("dalph")
          }),
          GithubGraphqlRequest.cases.ReadIssue.make({ issueNodeId: GithubIssueNodeId.make("issue") }),
          GithubGraphqlRequest.cases.ReadIssueDetails.make({ issueNodeId: GithubIssueNodeId.make("issue") }),
          GithubGraphqlRequest.cases.ReadTaskWorkSpecification.make({ issueNodeId: GithubIssueNodeId.make("issue") }),
          GithubGraphqlRequest.cases.ReadSubIssues.make({ cursor: null, issueNodeId: GithubIssueNodeId.make("issue") }),
          GithubGraphqlRequest.cases.ReadBlockedBy.make({
            cursor: GithubCursor.make("cursor"),
            issueNodeId: GithubIssueNodeId.make("issue")
          }),
          GithubGraphqlRequest.cases.CreateIssue.make({
            body: "fixture body",
            operationId: OperationId.make("create-issue-operation"),
            repositoryNodeId: GithubRepositoryNodeId.make("repository-node"),
            title: "fixture title"
          }),
          GithubGraphqlRequest.cases.AddSubIssue.make({
            operationId: OperationId.make("sub-issue-operation"),
            parentIssueNodeId: GithubIssueNodeId.make("parent-issue"),
            subIssueNodeId: GithubIssueNodeId.make("sub-issue")
          }),
          GithubGraphqlRequest.cases.AddBlockedBy.make({
            blockingIssueNodeId: GithubIssueNodeId.make("blocking-issue"),
            issueNodeId: GithubIssueNodeId.make("blocked-issue"),
            operationId: OperationId.make("blocked-by-operation")
          }),
          GithubGraphqlRequest.cases.AddIssueComment.make({
            body: "fixture comment",
            issueNodeId: GithubIssueNodeId.make("issue"),
            operationId: OperationId.make("comment-operation")
          }),
          GithubGraphqlRequest.cases.CloseIssue.make({
            issueNodeId: GithubIssueNodeId.make("issue"),
            operationId: OperationId.make("close-operation")
          }),
          GithubGraphqlRequest.cases.ReopenIssue.make({
            issueNodeId: GithubIssueNodeId.make("issue"),
            operationId: OperationId.make("reopen-operation")
          }),
          GithubGraphqlRequest.cases.DeleteIssue.make({
            issueNodeId: GithubIssueNodeId.make("issue"),
            operationId: OperationId.make("delete-operation")
          }),
          GithubGraphqlRequest.cases.FindClaimLabel.make({
            labelName: GithubLabelName.make("dalph-claim-task"),
            repositoryNodeId: GithubRepositoryNodeId.make("repository-node")
          }),
          GithubGraphqlRequest.cases.CreateClaimLabel.make({
            description: "claim-description",
            labelName: GithubLabelName.make("dalph-claim-task"),
            operationId: OperationId.make("claim-operation"),
            repositoryNodeId: GithubRepositoryNodeId.make("repository-node")
          }),
          GithubGraphqlRequest.cases.DeleteClaimLabel.make({
            labelNodeId: GithubLabelNodeId.make("claim-label-node"),
            operationId: OperationId.make("release-operation")
          })
        ],
        (request) => client.execute(request)
      )
    }).pipe(Effect.provide(clientLayer))

    const requests = yield* Ref.get(observed)
    expect(requests).toHaveLength(17)
    const request = requests[0]
    expect(request).toBeDefined()
    if (request === undefined) return
    expect(request.authorization).toBe("Bearer secret-token")
    expect(request.globalIdVersion).toBe("1")
    expect(request.method).toBe("POST")
    expect(request.url).toBe("https://api.github.com/graphql")
    expect(request.userAgent).toBe("dalph-orchestrator")
    const payload = Schema.decodeUnknownSync(ResolveRequestBody)(JSON.parse(request.body))
    expect(payload.variables).toEqual({ issueNumber: 42, owner: "octo", repository: "dalph" })
    expect(payload.query).toContain("repository(owner: $owner, name: $repository)")
    expect(requests.map(({ body }) => body)).toEqual(
      expect.arrayContaining([
        expect.stringContaining("query ResolveRepository"),
        expect.stringContaining("query ReadIssue"),
        expect.stringContaining("query ReadIssueDetails"),
        expect.stringContaining("query ReadTaskWorkSpecification"),
        expect.stringContaining("query ReadSubIssues"),
        expect.stringContaining("query ReadBlockedBy"),
        expect.stringContaining("mutation CreateIssue"),
        expect.stringContaining("mutation AddSubIssue"),
        expect.stringContaining("mutation AddBlockedBy"),
        expect.stringContaining("mutation AddIssueComment"),
        expect.stringContaining("mutation CloseIssue"),
        expect.stringContaining("stateReason: COMPLETED"),
        expect.stringContaining("mutation ReopenIssue"),
        expect.stringContaining("mutation DeleteIssue"),
        expect.stringContaining("query FindClaimLabel"),
        expect.stringContaining("mutation CreateClaimLabel"),
        expect.stringContaining("mutation DeleteClaimLabel")
      ])
    )
    const focusedRequest = requests.find(({ body }) => body.includes("query ReadTaskWorkSpecification"))
    expect(focusedRequest?.body).toContain("repository { id }")
    for (const forbiddenField of [
      "updatedAt",
      "comments",
      "state",
      "stateReason",
      "labels",
      "subIssues",
      "blockedBy"
    ]) {
      expect(focusedRequest?.body).not.toContain(forbiddenField)
    }
    const connectionRequests = requests.filter(
      ({ body }) => body.includes("query ReadSubIssues") || body.includes("query ReadBlockedBy")
    )
    expect(connectionRequests).toHaveLength(2)
    for (const { body } of connectionRequests) {
      const payload = yield* Schema.decodeUnknownEffect(
        Schema.Struct({ variables: Schema.Struct({ pageSize: Schema.Finite }) })
      )(JSON.parse(body))
      expect(payload.variables.pageSize).toBe(100)
    }
  })
)

const executeResponse = (
  response: Response,
  request: GithubGraphqlRequest,
  layerFactory: typeof githubGraphqlClientLayer = githubGraphqlClientLayer
) => {
  const httpClient = HttpClient.make((request) => Effect.succeed(HttpClientResponse.fromWeb(request, response)))
  const layer = layerFactory({ token: Redacted.make("token") }).pipe(
    Layer.provide(Layer.succeed(HttpClient.HttpClient, httpClient))
  )
  return Effect.gen(function* () {
    const client = yield* GithubGraphqlClient
    return yield* client.execute(request)
  }).pipe(Effect.provide(layer))
}

const executeResolve = (response: Response, layerFactory: typeof githubGraphqlClientLayer = githubGraphqlClientLayer) =>
  executeResponse(response, GithubGraphqlRequest.cases.ResolveIssue.make({ target }), layerFactory)

it.effect("classifies HTTP and JSON failures", () =>
  Effect.gen(function* () {
    const failures = yield* Effect.forEach(
      [
        new Response("server error", { status: 500 }),
        new Response("not-json", { status: 200 }),
        new Response("not-json", { status: 403 }),
        new Response(JSON.stringify({ message: "Forbidden" }), { status: 403 })
      ],
      (response) => executeResolve(response).pipe(Effect.flip, Effect.orDie)
    )

    expect(failures).toHaveLength(4)
    for (const failure of failures) {
      expect(failure._tag).toBe("GithubGraphqlClient.RequestError")
      expect(failure.operation).toBe("ResolveIssue")
    }
  })
)

it.effect("maps malformed GraphQL bodies after checking deterministic throttle evidence", () =>
  Effect.gen(function* () {
    const mutation = GithubGraphqlRequest.cases.CloseIssue.make({
      issueNodeId: GithubIssueNodeId.make("malformed-throttle-issue"),
      operationId: OperationId.make("malformed-throttle-close")
    })
    const throttled = yield* executeResponse(
      new Response("not-json", { headers: { "x-ratelimit-remaining": "0", "x-ratelimit-reset": "2300" }, status: 403 }),
      mutation
    ).pipe(Effect.flip, Effect.orDie)

    expect(throttled).toMatchObject({
      _tag: "GithubGraphqlClient.Throttled",
      kind: "Primary",
      operation: "CloseIssue",
      timingEvidence: { _tag: "ResetAt", epochSeconds: 2_300 }
    })
  })
)

it.effect("classifies primary and secondary GitHub read throttling before generic HTTP failures", () =>
  Effect.gen(function* () {
    const failures = yield* Effect.forEach(
      [
        new Response("", { headers: { "retry-after": "7" }, status: 429 }),
        new Response(JSON.stringify({ message: "You have exceeded a secondary rate limit." }), { status: 403 }),
        new Response("", { headers: { "x-ratelimit-remaining": "0", "x-ratelimit-reset": "1900000000" }, status: 403 }),
        new Response(JSON.stringify({ message: "API rate limit exceeded" }), { status: 403 })
      ],
      (response) => executeResolve(response).pipe(Effect.flip, Effect.orDie)
    )

    expect(failures[0]).toBeInstanceOf(GithubGraphqlReadThrottled)
    expect(failures[0]).toMatchObject({
      detail: "GitHub request throttled",
      operation: "ResolveIssue",
      retry: { _tag: "RetryAfterSeconds", seconds: 7 }
    })
    expect(failures[1]).toBeInstanceOf(GithubGraphqlReadThrottled)
    expect(failures[1]).toMatchObject({
      detail: "GitHub request throttled",
      operation: "ResolveIssue",
      retry: { _tag: "Unavailable" }
    })
    expect(failures[2]).toMatchObject({
      detail: "GitHub request throttled",
      operation: "ResolveIssue",
      retry: { _tag: "RateLimitResetEpochSeconds", epochSeconds: 1_900_000_000 }
    })
    expect(failures[3]).toMatchObject({
      detail: "GitHub request throttled",
      operation: "ResolveIssue",
      retry: { _tag: "Unavailable" }
    })
    expect(JSON.stringify(failures)).not.toContain("secondary rate limit")
  })
)

it.effect("leaves throttled mutation responses outside the read-only classifier", () =>
  Effect.gen(function* () {
    const request = GithubGraphqlRequest.cases.CreateIssue.make({
      body: "body",
      operationId: OperationId.make("throttled-mutation"),
      repositoryNodeId: GithubRepositoryNodeId.make("repository-node"),
      title: "title"
    })
    const failures = yield* Effect.forEach(
      [
        new Response("", { headers: { "retry-after": "7" }, status: 429 }),
        new Response(JSON.stringify({ errors: [{ message: "You have exceeded a secondary rate limit." }] }), {
          status: 403
        })
      ],
      (response) => executeResponse(response, request).pipe(Effect.flip, Effect.orDie)
    )

    for (const failure of failures) {
      expect(failure).not.toBeInstanceOf(GithubGraphqlReadThrottled)
      expect(failure).toBeInstanceOf(GithubGraphqlThrottled)
      expect(failure).toMatchObject({ kind: "Secondary", operation: "CreateIssue" })
    }
  })
)

it.effect("classifies primary and secondary GitHub mutation limits before generic request failure mapping", () =>
  Effect.gen(function* () {
    const credential = "credential-must-stay-redacted"
    const providerPayload = "provider-payload-must-stay-redacted"
    const request = GithubGraphqlRequest.cases.CloseIssue.make({
      issueNodeId: GithubIssueNodeId.make("rate-limited-issue"),
      operationId: OperationId.make("rate-limited-close")
    })
    const failures = yield* Effect.forEach(
      [
        new Response(JSON.stringify({ errors: [{ message: providerPayload }] }), {
          headers: { "x-ratelimit-remaining": "0", "x-ratelimit-reset": "2000" },
          status: 200
        }),
        new Response(
          JSON.stringify({ errors: [{ message: `You have exceeded a secondary rate limit: ${providerPayload}` }] }),
          {
            headers: { "retry-after": "17", "x-private-credential": credential, "x-ratelimit-remaining": "0" },
            status: 403
          }
        )
      ],
      (response) => executeResponse(response, request).pipe(Effect.flip, Effect.orDie)
    )

    expect(failures).toHaveLength(2)
    const [primary, secondary] = failures
    expect(primary).toBeInstanceOf(GithubGraphqlThrottled)
    expect(primary).toMatchObject({
      kind: "Primary",
      operation: "CloseIssue",
      timingEvidence: { _tag: "ResetAt", epochSeconds: 2_000 }
    })
    expect(secondary).toBeInstanceOf(GithubGraphqlThrottled)
    expect(secondary).toMatchObject({
      kind: "Secondary",
      operation: "CloseIssue",
      timingEvidence: { _tag: "RetryAfter", seconds: 17 }
    })
    const publicFailure = JSON.stringify(failures)
    expect(publicFailure).not.toContain(credential)
    expect(publicFailure).not.toContain(providerPayload)
    expect(publicFailure).not.toContain("x-private-credential")
  })
)

it.effect("keeps throttled GitHub reads in the read-only classifier with only safe timing evidence", () =>
  Effect.gen(function* () {
    const unsafeHeader = "unsafe-retry-evidence"
    const request = GithubGraphqlRequest.cases.ReadIssue.make({ issueNodeId: GithubIssueNodeId.make("throttled-read") })
    const failures = yield* Effect.forEach(
      [
        new Response("not-provider-json", {
          headers: { "retry-after": unsafeHeader, "x-ratelimit-reset": "-1" },
          status: 429
        }),
        new Response(JSON.stringify({ errors: [{ message: "primary limit" }] }), {
          headers: { "x-ratelimit-remaining": "0", "x-ratelimit-reset": "2100" },
          status: 200
        })
      ],
      (response) => executeResponse(response, request).pipe(Effect.flip, Effect.orDie)
    )

    for (const failure of failures) expect(failure).toBeInstanceOf(GithubGraphqlReadThrottled)
    expect(failures[0]).toMatchObject({ operation: "ReadIssue", retry: { _tag: "Unavailable" } })
    expect(failures[1]).toMatchObject({
      operation: "ReadIssue",
      retry: { _tag: "RateLimitResetEpochSeconds", epochSeconds: 2_100 }
    })
    expect(JSON.stringify(failures)).not.toContain(unsafeHeader)
  })
)

it.effect("decodes read throttle timing from GraphQL error bodies when HTTP status remains successful", () =>
  Effect.gen(function* () {
    const body = JSON.stringify({ errors: [{ message: "You have exceeded a secondary rate limit." }] })
    const request = GithubGraphqlRequest.cases.ReadIssue.make({
      issueNodeId: GithubIssueNodeId.make("successful-status-throttled-read")
    })
    const failures = yield* Effect.forEach(
      [new Response(body, { status: 200 }), new Response(body, { headers: { "retry-after": "19" }, status: 200 })],
      (response) => executeResponse(response, request).pipe(Effect.flip, Effect.orDie)
    )

    expect(failures[0]).toMatchObject({
      _tag: "GithubGraphqlClient.ReadThrottled",
      operation: "ReadIssue",
      retry: { _tag: "Unavailable" }
    })
    expect(failures[1]).toMatchObject({
      _tag: "GithubGraphqlClient.ReadThrottled",
      operation: "ReadIssue",
      retry: { _tag: "RetryAfterSeconds", seconds: 19 }
    })
  })
)

it.effect("loads the GitHub token through injected Effect configuration", () => {
  const httpClient = HttpClient.make((request) =>
    Effect.succeed(HttpClientResponse.fromWeb(request, new Response("{}", { status: 200 })))
  )
  const layer = githubGraphqlClientConfigLayer.pipe(Layer.provide(Layer.succeed(HttpClient.HttpClient, httpClient)))
  return Effect.gen(function* () {
    const client = yield* GithubGraphqlClient
    const response = yield* client.execute(GithubGraphqlRequest.cases.ResolveIssue.make({ target }))
    expect(response.body).toEqual({})
  }).pipe(
    Effect.provide(layer),
    Effect.provide(ConfigProvider.layer(ConfigProvider.fromUnknown({ GITHUB_TOKEN: "configured-token" })))
  )
})
