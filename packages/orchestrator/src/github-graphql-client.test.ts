import { expect, it } from "@effect/vitest"
import { ConfigProvider, Effect, Layer, Option, Redacted, Ref, Schema } from "effect"
import * as Headers from "effect/unstable/http/Headers"
import * as HttpClient from "effect/unstable/http/HttpClient"
import * as HttpClientResponse from "effect/unstable/http/HttpClientResponse"
import { GithubIssueNumber, GithubIssueTarget, GithubRepositoryName, GithubRepositoryOwner } from "./domain.js"
import {
  GithubCursor,
  GithubGraphqlClient,
  githubGraphqlClientConfigLayer,
  githubGraphqlClientLayer,
  GithubGraphqlRequest,
  GithubIssueNodeId
} from "./github-graphql-client.js"

const EncodedRequestBody = Schema.Struct({ body: Schema.String })
const ResolveRequestBody = Schema.Struct({
  query: Schema.String,
  variables: Schema.Struct({
    issueNumber: Schema.Int,
    owner: Schema.String,
    repository: Schema.String
  })
})

const target = GithubIssueTarget.make({
  issueNumber: GithubIssueNumber.make(42),
  owner: GithubRepositoryOwner.make("octo"),
  repository: GithubRepositoryName.make("dalph")
})

it.effect("executes a read-only authenticated GitHub GraphQL request", () =>
  Effect.gen(function*() {
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
      Effect.gen(function*() {
        const encodedBody = Schema.decodeUnknownSync(EncodedRequestBody)(request.body.toJSON())
        yield* Ref.update(observed, (requests) => [...requests, {
          authorization: Option.getOrUndefined(Headers.get(request.headers, "authorization")),
          body: encodedBody.body,
          globalIdVersion: Option.getOrUndefined(
            Headers.get(request.headers, "x-github-next-global-id")
          ),
          method: request.method,
          url: request.url,
          userAgent: Option.getOrUndefined(Headers.get(request.headers, "user-agent"))
        }])
        return HttpClientResponse.fromWeb(
          request,
          new Response(
            JSON.stringify({ data: { repository: { id: "repo", issue: { id: "issue" } } } }),
            { status: 200 }
          )
        )
      })
    )
    const clientLayer = githubGraphqlClientLayer({
      token: Redacted.make("secret-token")
    }).pipe(Layer.provide(Layer.succeed(HttpClient.HttpClient, httpClient)))
    yield* Effect.gen(function*() {
      const client = yield* GithubGraphqlClient
      return yield* Effect.forEach([
        GithubGraphqlRequest.cases.ResolveIssue.make({
          target
        }),
        GithubGraphqlRequest.cases.ReadIssue.make({
          issueNodeId: GithubIssueNodeId.make("issue")
        }),
        GithubGraphqlRequest.cases.ReadSubIssues.make({
          cursor: null,
          issueNodeId: GithubIssueNodeId.make("issue")
        }),
        GithubGraphqlRequest.cases.ReadBlockedBy.make({
          cursor: GithubCursor.make("cursor"),
          issueNodeId: GithubIssueNodeId.make("issue")
        })
      ], (request) => client.execute(request))
    }).pipe(Effect.provide(clientLayer))

    const requests = yield* Ref.get(observed)
    expect(requests).toHaveLength(4)
    const request = requests[0]
    expect(request).toBeDefined()
    if (request === undefined) return
    expect(request.authorization).toBe("Bearer secret-token")
    expect(request.globalIdVersion).toBe("1")
    expect(request.method).toBe("POST")
    expect(request.url).toBe("https://api.github.com/graphql")
    expect(request.userAgent).toBe("dalph-orchestrator")
    const payload = Schema.decodeUnknownSync(ResolveRequestBody)(JSON.parse(request.body))
    expect(payload.variables).toEqual({
      issueNumber: 42,
      owner: "octo",
      repository: "dalph"
    })
    expect(payload.query).toContain("repository(owner: $owner, name: $repository)")
    expect(requests.map(({ body }) => body)).toEqual(expect.arrayContaining([
      expect.stringContaining("query ReadIssue"),
      expect.stringContaining("query ReadSubIssues"),
      expect.stringContaining("query ReadBlockedBy")
    ]))
  }))

const executeResolve = (
  response: Response,
  layerFactory: typeof githubGraphqlClientLayer = githubGraphqlClientLayer
) => {
  const httpClient = HttpClient.make((request) => Effect.succeed(HttpClientResponse.fromWeb(request, response)))
  const layer = layerFactory({ token: Redacted.make("token") }).pipe(
    Layer.provide(Layer.succeed(HttpClient.HttpClient, httpClient))
  )
  return Effect.gen(function*() {
    const client = yield* GithubGraphqlClient
    return yield* client.execute(GithubGraphqlRequest.cases.ResolveIssue.make({
      target
    }))
  }).pipe(Effect.provide(layer))
}

it.effect("classifies HTTP and JSON failures", () =>
  Effect.gen(function*() {
    const failures = yield* Effect.forEach([
      new Response("server error", { status: 500 }),
      new Response("not-json", { status: 200 })
    ], (response) => executeResolve(response).pipe(Effect.flip, Effect.orDie))

    expect(failures).toHaveLength(2)
    for (const failure of failures) {
      expect(failure._tag).toBe("GithubGraphqlClient.RequestError")
      expect(failure.operation).toBe("ResolveIssue")
    }
  }))

it.effect("loads the GitHub token through injected Effect configuration", () => {
  const httpClient = HttpClient.make((request) =>
    Effect.succeed(
      HttpClientResponse.fromWeb(
        request,
        new Response("{}", {
          status: 200
        })
      )
    )
  )
  const layer = githubGraphqlClientConfigLayer.pipe(
    Layer.provide(Layer.succeed(HttpClient.HttpClient, httpClient))
  )
  return Effect.gen(function*() {
    const client = yield* GithubGraphqlClient
    const response = yield* client.execute(GithubGraphqlRequest.cases.ResolveIssue.make({
      target
    }))
    expect(response.body).toEqual({})
  }).pipe(
    Effect.provide(layer),
    Effect.provide(ConfigProvider.layer(ConfigProvider.fromUnknown({ GITHUB_TOKEN: "configured-token" })))
  )
})
