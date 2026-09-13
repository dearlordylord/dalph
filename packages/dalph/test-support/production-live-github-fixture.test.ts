import {
  OperationId,
  GithubGraphqlClient,
  GithubRepositoryName,
  GithubRepositoryOwner,
  type GithubGraphqlRequest
} from "@dalph/orchestrator"
import { NodeCrypto } from "@effect/platform-node"
import { it } from "@effect/vitest"
import { Effect, Ref } from "effect"
import { expect } from "vitest"
import { githubGraphqlTestClient } from "../../orchestrator/src/authorities/task-tracker/github/graphql-client.test-fixture.js"
import {
  createProductionLiveGithubFixture,
  cleanupProductionLiveGithubFixture,
  makeProductionLiveGithubCleanupAdapter,
  ProductionLiveGithubRepository
} from "../src/qualification/live-github-fixture.js"
import { LiveQualificationInvocationId } from "../src/qualification/live-qualification-evidence.js"

const invocationId = LiveQualificationInvocationId.make("Q-307-fixture")
const repository = ProductionLiveGithubRepository.make({
  owner: GithubRepositoryOwner.make("fixture-owner"),
  name: GithubRepositoryName.make("fixture-repository")
})

it.effect("Alice creates exactly one Q-prefixed issue and records its exact structured receipt", () =>
  Effect.gen(function* () {
    const calls = yield* Ref.make<ReadonlyArray<GithubGraphqlRequest>>([])
    const client = githubGraphqlTestClient((request) =>
      Ref.update(calls, (current) => [...current, request]).pipe(
        Effect.as(
          request._tag === "ResolveRepository"
            ? { body: { data: { repository: { id: "repository-node" } } } }
            : {
                body: {
                  data: {
                    createIssue: {
                      clientMutationId: "create-live-Q",
                      issue: { id: "issue-node", number: 17, state: "OPEN", stateReason: null }
                    }
                  }
                }
              }
        )
      )
    )
    const fixture = yield* createProductionLiveGithubFixture({
      invocationId,
      repository,
      createIssueOperationId: OperationId.make("create-live-Q")
    }).pipe(Effect.provideService(GithubGraphqlClient, client))
    expect(fixture.manifest.invocationId).toBe(invocationId)
    expect(fixture.manifest.repository).toEqual({
      owner: "fixture-owner",
      name: "fixture-repository",
      nodeId: "repository-node"
    })
    expect(fixture.manifest.resources).toEqual([
      expect.objectContaining({ _tag: "Issue", number: 17, nodeId: "issue-node" })
    ])
    expect(fixture.issue.title.startsWith(`${invocationId}:`)).toBe(true)
    expect(fixture.issue.body.startsWith(`${invocationId}:`)).toBe(true)
    expect((yield* Ref.get(calls)).map(({ _tag }) => _tag)).toEqual(["ResolveRepository", "CreateIssue"])
  }).pipe(Effect.provide(NodeCrypto.layer))
)

it.effect("Alice deletes the exact live issue once and proves its absence with a fresh exact reread", () =>
  Effect.gen(function* () {
    const requests = yield* Ref.make<ReadonlyArray<GithubGraphqlRequest>>([])
    const deleted = yield* Ref.make(false)
    const title = `${invocationId}: one disposable Dalph qualification task`
    const body = `${invocationId}: create LIVE-QUALIFICATION.md with one sentence and commit the change.`
    const client = githubGraphqlTestClient(
      Effect.fn("ProductionLiveGithubFixtureTest.execute")(function* (request) {
        yield* Ref.update(requests, (current) => [...current, request])
        if (request._tag === "ResolveRepository") return { body: { data: { repository: { id: "repository-node" } } } }
        if (request._tag === "ResolveIssue") {
          const absent = yield* Ref.get(deleted)
          return {
            body: {
              data: {
                repository: absent
                  ? { id: "repository-node", issue: null }
                  : { id: "repository-node", issue: { id: "issue-node" } }
              }
            }
          }
        }
        if (request._tag === "ReadTaskWorkSpecification")
          return {
            body: {
              data: {
                node: { __typename: "Issue", id: "issue-node", repository: { id: "repository-node" }, title, body }
              }
            }
          }
        if (request._tag === "DeleteIssue") {
          yield* Ref.set(deleted, true)
          return { body: { data: { deleteIssue: { clientMutationId: request.operationId } } } }
        }
        return yield* Effect.die(`unexpected ${request._tag}`)
      })
    )
    const created = yield* createProductionLiveGithubFixture({
      invocationId,
      repository,
      createIssueOperationId: OperationId.make("create-live-Q")
    }).pipe(
      Effect.provideService(
        GithubGraphqlClient,
        githubGraphqlTestClient((request) =>
          Effect.succeed(
            request._tag === "ResolveRepository"
              ? { body: { data: { repository: { id: "repository-node" } } } }
              : {
                  body: {
                    data: {
                      createIssue: {
                        clientMutationId: "create-live-Q",
                        issue: { id: "issue-node", number: 17, state: "OPEN", stateReason: null }
                      }
                    }
                  }
                }
          )
        )
      )
    )
    const adapter = yield* makeProductionLiveGithubCleanupAdapter(invocationId).pipe(
      Effect.provideService(GithubGraphqlClient, client)
    )
    const result = yield* cleanupProductionLiveGithubFixture(
      created.manifest,
      { invocationId, repository: created.manifest.repository },
      adapter
    )
    expect(result.removed).toEqual(created.manifest.resources)
    expect(result.retained).toEqual([])
    expect((yield* Ref.get(requests)).map(({ _tag }) => _tag)).toEqual([
      "ResolveRepository",
      "ResolveIssue",
      "ReadTaskWorkSpecification",
      "DeleteIssue",
      "ResolveIssue"
    ])
  }).pipe(Effect.provide(NodeCrypto.layer))
)
