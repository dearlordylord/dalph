import { NodeCrypto } from "@effect/platform-node"
import { it } from "@effect/vitest"
import { Context, Crypto, Effect, Layer, PlatformError, Ref } from "effect"
import { expect } from "vitest"
import type { GithubGraphqlRequest, GithubGraphqlResponse } from "./github-graphql-client.js"
import { GithubGraphqlRequestError } from "./github-graphql-client.js"
import { githubTaskIdFor } from "./github-task-identity.js"
import {
  ActiveTaskClaim,
  ClaimOwner,
  ClaimToken,
  GithubGraphqlClient,
  GithubIssueNodeId,
  GithubLabelNodeId,
  GithubRepositoryNodeId,
  githubTrackerMutationLayer,
  OperationId,
  TaskClaimAcquisition,
  TaskClaimConflict,
  TaskClaimOwnershipConflict,
  TaskClaimReadFailure,
  TaskClaimReleaseFailure,
  TaskClaimRequestFailure,
  TaskId,
  TrackerMutation
} from "./index.js"

const repositoryNodeId = GithubRepositoryNodeId.make("repository-node")
const issueNodeId = GithubIssueNodeId.make("issue-node")
const taskId = githubTaskIdFor(repositoryNodeId, issueNodeId)

const acquisition = (owner: string, token: string) =>
  TaskClaimAcquisition.make({
    operationId: OperationId.make(`acquire:${owner}`),
    owner: ClaimOwner.make(owner),
    taskId,
    token: ClaimToken.make(token)
  })

const githubClaimFixtureLayer = Layer.effectContext(
  Effect.gen(function*() {
    const label = yield* Ref.make<
      {
        readonly description: string
        readonly id: string
        readonly name: string
      } | null
    >(null)
    const client = GithubGraphqlClient.of({
      execute: Effect.fn("GithubGraphqlClient.ClaimFixture.execute")(
        function*(request: GithubGraphqlRequest) {
          switch (request._tag) {
            case "FindClaimLabel": {
              const current = yield* Ref.get(label)
              return {
                body: {
                  data: {
                    node: current === null
                      ? { id: repositoryNodeId, label: null }
                      : { id: repositoryNodeId, label: current }
                  }
                }
              }
            }
            case "CreateClaimLabel": {
              const created = yield* Ref.modify(label, (current) =>
                current === null
                  ? [true, {
                    description: request.description,
                    id: `label:${request.operationId}`,
                    name: request.labelName
                  }] as const
                  : [false, current] as const)
              return created
                ? {
                  body: {
                    data: {
                      createLabel: {
                        label: yield* Ref.get(label)
                      }
                    }
                  }
                }
                : { body: { errors: [{ message: "label name already exists" }] } }
            }
            case "DeleteClaimLabel": {
              yield* Ref.update(label, (current) => current?.id === request.labelNodeId ? null : current)
              return { body: { data: { deleteLabel: { clientMutationId: null } } } }
            }
            case "ResolveIssue":
            case "ReadIssue":
            case "ReadSubIssues":
            case "ReadBlockedBy":
              return yield* Effect.die(`unexpected ${request._tag} request`)
          }
        }
      )
    })
    return Context.empty().pipe(
      Context.add(GithubGraphqlClient, client)
    )
  })
)

const layer = githubTrackerMutationLayer.pipe(
  Layer.provide(githubClaimFixtureLayer),
  Layer.provide(NodeCrypto.layer)
)

const adapterLayer = (
  execute: (
    request: GithubGraphqlRequest
  ) => Effect.Effect<GithubGraphqlResponse, GithubGraphqlRequestError>
) =>
  githubTrackerMutationLayer.pipe(
    Layer.provide(Layer.succeed(
      GithubGraphqlClient,
      GithubGraphqlClient.of({ execute })
    )),
    Layer.provide(NodeCrypto.layer)
  )

const findResponse = (
  request: Extract<GithubGraphqlRequest, { readonly _tag: "FindClaimLabel" }>,
  description: string | null
): GithubGraphqlResponse => ({
  body: {
    data: {
      node: {
        id: repositoryNodeId,
        label: description === null
          ? null
          : {
            description,
            id: GithubLabelNodeId.make("claim-label"),
            name: request.labelName
          }
      }
    }
  }
})

it.effect("uses GitHub's unique label name to choose one competing owner", () =>
  Effect.gen(function*() {
    const tracker = yield* TrackerMutation
    const results = yield* Effect.all(
      [
        tracker.acquireTaskClaim(acquisition("owner-a", "token-a")),
        tracker.acquireTaskClaim(acquisition("owner-b", "token-b"))
      ].map(Effect.result),
      { concurrency: "unbounded" }
    )

    expect(results.filter((result) => result._tag === "Success")).toHaveLength(1)
    const failures = results.filter((result) => result._tag === "Failure")
    expect(failures).toHaveLength(1)
    expect(failures[0]?.failure).toBeInstanceOf(TaskClaimConflict)
    expect(yield* tracker.readTaskClaim(taskId)).toEqual(
      results.find((result) => result._tag === "Success")?.success
    )
  }).pipe(Effect.provide(layer)))

it.effect("deletes only the exact GitHub label node owned by the release token", () =>
  Effect.gen(function*() {
    const tracker = yield* TrackerMutation
    const first = yield* tracker.acquireTaskClaim(acquisition("first", "first-token"))
    yield* tracker.releaseTaskClaim(first)
    const second = yield* tracker.acquireTaskClaim(acquisition("second", "second-token"))

    yield* tracker.releaseTaskClaim(first).pipe(Effect.flip)

    expect(yield* tracker.readTaskClaim(taskId)).toEqual(second)
  }).pipe(Effect.provide(layer)))

it.effect("treats a repeated exact acquisition as idempotent", () =>
  Effect.gen(function*() {
    const tracker = yield* TrackerMutation
    const requested = acquisition("same", "same-token")
    const first = yield* tracker.acquireTaskClaim(requested)
    const second = yield* tracker.acquireTaskClaim(requested)

    expect(second).toEqual(first)
  }).pipe(Effect.provide(layer)))

it.effect("rejects task identities and descriptions outside the adapter boundary", () =>
  Effect.gen(function*() {
    const tracker = yield* TrackerMutation
    const malformedCoordinates = TaskId.make(
      `t1.${Buffer.from(JSON.stringify(["repository-only"])).toString("base64url")}`
    )
    const readFailures = yield* Effect.all([
      tracker.readTaskClaim(TaskId.make("foreign-task")).pipe(Effect.flip),
      tracker.readTaskClaim(TaskId.make("t1.not-json")).pipe(Effect.flip),
      tracker.readTaskClaim(malformedCoordinates).pipe(Effect.flip)
    ])
    const invalidSeparator = acquisition("owner|extra", "token")
    const tooLong = acquisition("x".repeat(101), "token")
    const requestFailures = yield* Effect.all([
      tracker.acquireTaskClaim(invalidSeparator).pipe(Effect.flip),
      tracker.acquireTaskClaim(tooLong).pipe(Effect.flip)
    ])

    readFailures.forEach((failure) => expect(failure).toBeInstanceOf(TaskClaimReadFailure))
    requestFailures.forEach((failure) => {
      expect(failure).toBeInstanceOf(TaskClaimRequestFailure)
      if (!(failure instanceof TaskClaimRequestFailure)) return
      expect(failure.outcome).toBe("DefinitelyNotApplied")
    })
  }).pipe(Effect.provide(layer)))

it.effect("maps malformed and failed GitHub observations to typed read failures", () =>
  Effect.gen(function*() {
    const bodies: ReadonlyArray<unknown> = [
      "not-an-envelope",
      { errors: [{ message: "denied" }] },
      {},
      { data: { node: null } },
      { data: { node: { id: "different-repository", label: null } } },
      {
        data: {
          node: {
            id: repositoryNodeId,
            label: {
              description: "1|operation|owner|token",
              id: "label",
              name: "unexpected-name"
            }
          }
        }
      },
      {
        data: {
          node: {
            id: repositoryNodeId,
            label: {
              description: "unsupported",
              id: "label",
              name: "MATCH_REQUEST"
            }
          }
        }
      },
      {
        data: {
          node: {
            id: repositoryNodeId,
            label: {
              description: "1||owner|token",
              id: "label",
              name: "MATCH_REQUEST"
            }
          }
        }
      }
    ]

    for (const body of bodies) {
      const caseLayer = adapterLayer(
        Effect.fn("GithubGraphqlClient.BadRead.execute")(
          function*(request) {
            if (request._tag !== "FindClaimLabel") return yield* Effect.die("unexpected mutation")
            const adjusted = JSON.parse(JSON.stringify(body)) as unknown
            if (
              typeof adjusted === "object"
              && adjusted !== null
              && "data" in adjusted
              && JSON.stringify(adjusted).includes("MATCH_REQUEST")
            ) {
              const envelope = adjusted as { data: { node: { label: { name: string } } } }
              envelope.data.node.label.name = request.labelName
            }
            return { body: adjusted }
          }
        )
      )
      const failure = yield* Effect.gen(function*() {
        const tracker = yield* TrackerMutation
        return yield* tracker.readTaskClaim(taskId).pipe(Effect.flip)
      }).pipe(Effect.provide(caseLayer))
      expect(failure).toBeInstanceOf(TaskClaimReadFailure)
    }

    const transportLayer = adapterLayer((request) =>
      Effect.fail(
        new GithubGraphqlRequestError({ detail: "offline", operation: request._tag })
      )
    )
    const transportFailure = yield* Effect.gen(function*() {
      const tracker = yield* TrackerMutation
      return yield* tracker.readTaskClaim(taskId).pipe(Effect.flip)
    }).pipe(Effect.provide(transportLayer))
    expect(transportFailure).toBeInstanceOf(TaskClaimReadFailure)

    const cryptoFailureLayer = githubTrackerMutationLayer.pipe(
      Layer.provide(Layer.succeed(
        GithubGraphqlClient,
        GithubGraphqlClient.of({ execute: () => Effect.die("unexpected request") })
      )),
      Layer.provide(Layer.succeed(
        Crypto.Crypto,
        Crypto.make({
          digest: () =>
            Effect.fail(
              new PlatformError.PlatformError(
                new PlatformError.BadArgument({
                  description: "digest unavailable",
                  method: "digest",
                  module: "TestCrypto"
                })
              )
            ),
          randomBytes: (size) => new Uint8Array(size)
        })
      ))
    )
    const cryptoFailure = yield* Effect.gen(function*() {
      const tracker = yield* TrackerMutation
      return yield* tracker.readTaskClaim(taskId).pipe(Effect.flip)
    }).pipe(Effect.provide(cryptoFailureLayer))
    expect(cryptoFailure).toBeInstanceOf(TaskClaimReadFailure)
  }))

it.effect("classifies ambiguous create outcomes after a fresh observation", () =>
  Effect.gen(function*() {
    const requested = acquisition("ambiguous", "ambiguous-token")
    const scenarios = [
      { body: "invalid", outcome: "Unknown" },
      { body: {}, outcome: "Unknown" },
      { body: { errors: [{ message: "create rejected" }] }, outcome: "DefinitelyNotApplied" }
    ] as const

    for (const scenario of scenarios) {
      const caseLayer = adapterLayer(
        Effect.fn("GithubGraphqlClient.BadCreate.execute")(
          function*(request) {
            if (request._tag === "CreateClaimLabel") return { body: scenario.body }
            if (request._tag === "FindClaimLabel") return findResponse(request, null)
            return yield* Effect.die("unexpected delete")
          }
        )
      )
      const failure = yield* Effect.gen(function*() {
        const tracker = yield* TrackerMutation
        return yield* tracker.acquireTaskClaim(requested).pipe(Effect.flip)
      }).pipe(Effect.provide(caseLayer))
      expect(failure).toBeInstanceOf(TaskClaimRequestFailure)
      if (!(failure instanceof TaskClaimRequestFailure)) continue
      expect(failure.outcome).toBe(scenario.outcome)
    }

    const transportLayer = adapterLayer((request) =>
      Effect.fail(
        new GithubGraphqlRequestError({ detail: "offline", operation: request._tag })
      )
    )
    const transportFailure = yield* Effect.gen(function*() {
      const tracker = yield* TrackerMutation
      return yield* tracker.acquireTaskClaim(requested).pipe(Effect.flip)
    }).pipe(Effect.provide(transportLayer))
    expect(transportFailure).toBeInstanceOf(TaskClaimRequestFailure)
    if (transportFailure instanceof TaskClaimRequestFailure) {
      expect(transportFailure.outcome).toBe("Unknown")
    }
  }))

it.effect("fails release when ownership is absent or deletion is ambiguous", () =>
  Effect.gen(function*() {
    const requested = acquisition("release", "release-token")
    const claim = ActiveTaskClaim.make(requested)
    const unclaimedLayer = adapterLayer(
      Effect.fn("GithubGraphqlClient.Unclaimed.execute")(
        function*(request) {
          if (request._tag === "FindClaimLabel") return findResponse(request, null)
          return yield* Effect.die("unexpected mutation")
        }
      )
    )
    const ownershipFailure = yield* Effect.gen(function*() {
      const tracker = yield* TrackerMutation
      return yield* tracker.releaseTaskClaim(claim).pipe(Effect.flip)
    }).pipe(Effect.provide(unclaimedLayer))
    expect(ownershipFailure).toBeInstanceOf(TaskClaimOwnershipConflict)

    const description = `1|${claim.operationId}|${claim.owner}|${claim.token}`
    for (
      const deleteResponse of [
        Effect.succeed({ body: {} }),
        Effect.fail(
          new GithubGraphqlRequestError({ detail: "offline", operation: "DeleteClaimLabel" })
        )
      ]
    ) {
      const deleteLayer = adapterLayer(
        Effect.fn("GithubGraphqlClient.BadDelete.execute")(
          function*(request) {
            if (request._tag === "FindClaimLabel") return findResponse(request, description)
            if (request._tag === "DeleteClaimLabel") return yield* deleteResponse
            return yield* Effect.die("unexpected create")
          }
        )
      )
      const failure = yield* Effect.gen(function*() {
        const tracker = yield* TrackerMutation
        return yield* tracker.releaseTaskClaim(claim).pipe(Effect.flip)
      }).pipe(Effect.provide(deleteLayer))
      expect(failure).toBeInstanceOf(TaskClaimReleaseFailure)
    }
  }))
