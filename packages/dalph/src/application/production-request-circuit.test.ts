import { expect, it } from "@effect/vitest"
import { Effect, Layer, Ref } from "effect"
import {
  GithubGraphqlClient,
  GithubGraphqlRequest,
  GithubRepositoryName,
  GithubRepositoryOwner,
  type GithubGraphqlRequest as GithubGraphqlRequestType
} from "@dalph/orchestrator"
import { guardedGithubClientLayer } from "./production-host.js"

it.effect("production GitHub wrapper rejects before its transport after the bounded window", () =>
  Effect.gen(function* () {
    const transportCalls = yield* Ref.make(0)
    const client = GithubGraphqlClient.of({
      execute: (request: GithubGraphqlRequestType) =>
        Ref.update(transportCalls, (count) => count + 1).pipe(Effect.as({ body: { operation: request._tag } }))
    })
    const request = GithubGraphqlRequest.cases.ResolveRepository.make({
      owner: GithubRepositoryOwner.make("octo"),
      repository: GithubRepositoryName.make("dalph")
    })

    const failure = yield* Effect.gen(function* () {
      const guarded = yield* GithubGraphqlClient
      yield* Effect.forEach(Array.from({ length: 120 }), () => guarded.execute(request))
      return yield* guarded.execute(request).pipe(Effect.flip)
    }).pipe(Effect.provide(guardedGithubClientLayer(Layer.succeed(GithubGraphqlClient, client))))

    expect(failure).toMatchObject({
      _tag: "GithubGraphqlClient.RequestError",
      kind: "CircuitOpen",
      operation: "ResolveRepository"
    })
    expect(yield* Ref.get(transportCalls)).toBe(120)
  })
)
