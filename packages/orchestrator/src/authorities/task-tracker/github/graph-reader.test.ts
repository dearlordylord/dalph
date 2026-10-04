// @effect-diagnostics multipleEffectProvide:off
import { expect, it } from "@effect/vitest"
import { Effect, Layer, Match, Option, Ref } from "effect"
import { trackerGraphReaderContract } from "../../../../test/contracts/tracker-graph-reader-contract.js"
import { FixtureTarget } from "../fixture/target.js"
import { TaskLifecycle } from "../task.js"
import { GithubIssueNumber, GithubIssueTarget, GithubRepositoryName, GithubRepositoryOwner } from "./target.js"
import { makeTaskWorkSpecification, TaskId } from "@dalph/contracts"
import { type TrackerTarget } from "../target.js"
import {
  GithubGraphqlClient,
  type GithubGraphqlRequest,
  type GithubGraphqlReadExecution,
  GithubGraphqlRequestError,
  type GithubGraphqlResponse,
  GithubIssueNodeId,
  GithubRepositoryNodeId
} from "./graphql-client.js"
import { GithubGraphqlReadThrottled, GithubGraphqlThrottleEvidence } from "./graphql-read-throttle.js"
import {
  githubGraphqlTestClient,
  githubGraphqlBatchTestClient,
  interpretGithubGraphBatch
} from "./graphql-client.test-fixture.js"
import { githubTaskIdFor } from "./task-identity.js"
import { githubTrackerGraphReaderLayer } from "./graph-reader.js"
import { githubConnectionPageLimit, githubSnapshotTaskLimit } from "./read-limits.js"
import { TrackerAdapterReadError, type TrackerAdapterReadFailureReason, TrackerGraphReader } from "../graph-reader.js"

const page = (body: unknown): GithubGraphqlResponse => ({ body })

const issue = (
  id: string,
  parentId: string | null,
  state: "CLOSED" | "OPEN" = "OPEN",
  stateReason: "COMPLETED" | "DUPLICATE" | "NOT_PLANNED" | "REOPENED" | null = null,
  repositoryId = "repository-node"
) =>
  page({
    data: {
      node: {
        __typename: "Issue",
        id,
        parent: parentId === null ? null : { id: parentId },
        repository: { id: repositoryId },
        state,
        stateReason
      }
    }
  })

const connection = (
  field: "blockedBy" | "subIssues",
  ids: ReadonlyArray<string>,
  hasNextPage = false,
  endCursor: string | null = null,
  nodeId = "root-node"
) =>
  page({
    data: {
      node: {
        __typename: "Issue",
        id: nodeId,
        [field]: { nodes: ids.map((id) => ({ id })), pageInfo: { endCursor, hasNextPage } }
      }
    }
  })

const responseFor = (request: GithubGraphqlRequest): GithubGraphqlResponse => {
  return Match.valueTags(request, {
    AddBlockedBy: () => page({ errors: [{ message: "unexpected mutation request" }] }),
    AddIssueComment: () => page({ errors: [{ message: "unexpected mutation request" }] }),
    AddSubIssue: () => page({ errors: [{ message: "unexpected mutation request" }] }),
    CloseIssue: () => page({ errors: [{ message: "unexpected mutation request" }] }),
    FindClaimLabel: () => page({ errors: [{ message: "unexpected claim request" }] }),
    CreateClaimLabel: () => page({ errors: [{ message: "unexpected claim request" }] }),
    CreateIssue: () => page({ errors: [{ message: "unexpected mutation request" }] }),
    DeleteIssue: () => page({ errors: [{ message: "unexpected mutation request" }] }),
    DeleteClaimLabel: () => page({ errors: [{ message: "unexpected claim request" }] }),
    ReadGraphBatch: () => page({ errors: [{ message: "batch must be interpreted by controlled client" }] }),
    ReadIssueDetails: () => page({ errors: [{ message: "unexpected detail request" }] }),
    ReadTaskWorkSpecification: (request) =>
      page({
        data: {
          node: {
            __typename: "Issue",
            body: "Exact current body",
            id: request.issueNodeId,
            repository: { id: "repository-node" },
            title: "Exact current title"
          }
        }
      }),
    ReopenIssue: () => page({ errors: [{ message: "unexpected mutation request" }] }),
    ResolveRepository: () => page({ errors: [{ message: "unexpected repository request" }] }),
    ResolveIssue: () => page({ data: { repository: { id: "repository-node", issue: { id: "root-node" } } } }),
    ReadIssue: (request) =>
      Match.value(request.issueNodeId).pipe(
        Match.when("root-node", () => issue("root-node", null)),
        Match.when("child-node", () => issue("child-node", "root-node")),
        Match.when("first-blocker-node", () => issue("first-blocker-node", null, "CLOSED", "COMPLETED")),
        Match.when("second-blocker-node", () => issue("second-blocker-node", null, "CLOSED", "NOT_PLANNED")),
        Match.when("transitive-blocker-node", () => issue("transitive-blocker-node", null, "CLOSED", "COMPLETED")),
        Match.orElse(() => page({ data: null }))
      ),
    ReadSubIssues: (request) => {
      if (request.issueNodeId === "root-node" && request.cursor === null) {
        return connection("subIssues", ["child-node"], true, "next-child")
      }
      if (request.issueNodeId === "root-node" && request.cursor === "next-child") {
        return connection("subIssues", [])
      }
      return connection("subIssues", [], false, null, request.issueNodeId)
    },
    ReadBlockedBy: (request) => {
      if (request.issueNodeId === "child-node" && request.cursor === null) {
        return connection("blockedBy", ["first-blocker-node"], true, "next-blocker", "child-node")
      }
      if (request.issueNodeId === "child-node" && request.cursor === "next-blocker") {
        return connection("blockedBy", ["second-blocker-node"], false, null, "child-node")
      }
      if (request.issueNodeId === "first-blocker-node") {
        return connection("blockedBy", ["transitive-blocker-node"], false, null, "first-blocker-node")
      }
      return connection("blockedBy", [], false, null, request.issueNodeId)
    }
  })
}

const clientLayerFor = (handler: (request: GithubGraphqlRequest) => GithubGraphqlResponse) =>
  Layer.succeed(
    GithubGraphqlClient,
    GithubGraphqlClient.of({
      execute: Effect.fn("GithubGraphqlClient.Test.execute")((request) =>
        request._tag === "ReadGraphBatch"
          ? interpretGithubGraphBatch(request, (read) => Effect.succeed(handler(read)))
          : Effect.succeed(handler(request))
      )
    })
  )

const clientLayer = clientLayerFor(responseFor)

const target = GithubIssueTarget.make({
  issueNumber: GithubIssueNumber.make(42),
  owner: GithubRepositoryOwner.make("octo"),
  repository: GithubRepositoryName.make("dalph")
})

const taskIdFor = (issueNodeId: string): TaskId =>
  githubTaskIdFor(GithubRepositoryNodeId.make("repository-node"), GithubIssueNodeId.make(issueNodeId))
const root = taskIdFor("root-node")
const child = taskIdFor("child-node")
const firstBlocker = taskIdFor("first-blocker-node")
const secondBlocker = taskIdFor("second-blocker-node")
const transitiveBlocker = taskIdFor("transitive-blocker-node")

const incompleteClientLayer = clientLayerFor((request) =>
  request._tag === "ReadSubIssues" && request.issueNodeId === "root-node"
    ? connection("subIssues", [], true, null)
    : responseFor(request)
)

const malformedClientLayer = clientLayerFor((request) =>
  request._tag === "ResolveIssue" ? page({ data: { repository: { issue: 42 } } }) : responseFor(request)
)

const inaccessibleClientLayer = clientLayerFor((request) =>
  request._tag === "ResolveIssue" ? page({ data: { repository: null } }) : responseFor(request)
)

const failedRead = (layer: Layer.Layer<GithubGraphqlClient>, readTarget: TrackerTarget = target) =>
  Effect.gen(function* () {
    const reader = yield* TrackerGraphReader
    return yield* reader.read(readTarget)
  }).pipe(Effect.provide(githubTrackerGraphReaderLayer.pipe(Layer.provide(layer))), Effect.flip, Effect.orDie)

it.effect("projects paginated grouping and transitive prerequisite closure atomically", () =>
  Effect.gen(function* () {
    const reader = yield* TrackerGraphReader
    const graph = yield* reader.read(target)

    expect(graph.taskIds()).toEqual([transitiveBlocker, child, firstBlocker, root, secondBlocker])
    expect(graph.childrenOf(root)).toEqual([child])
    expect(graph.prerequisitesOf(child)).toEqual([firstBlocker, secondBlocker])
    expect(graph.prerequisitesOf(firstBlocker)).toEqual([transitiveBlocker])
    expect(graph.eligibleTaskIds()).toEqual([root])
  }).pipe(Effect.provide(githubTrackerGraphReaderLayer), Effect.provide(clientLayer))
)

it.effect("derives a stable revision from canonical snapshot content", () =>
  Effect.gen(function* () {
    const readWith = (layer: Layer.Layer<GithubGraphqlClient>) =>
      Effect.gen(function* () {
        const reader = yield* TrackerGraphReader
        return yield* reader.read(target)
      }).pipe(Effect.provide(githubTrackerGraphReaderLayer), Effect.provide(layer))

    const first = yield* readWith(clientLayer)
    const second = yield* readWith(
      clientLayerFor((request) =>
        request._tag === "ReadBlockedBy" && request.issueNodeId === "child-node"
          ? connection("blockedBy", ["second-blocker-node", "first-blocker-node"], false, null, "child-node")
          : responseFor(request)
      )
    )

    expect(second.revision).toBe(first.revision)
  })
)

it.effect("keeps grouping descendants of prerequisite-only tasks outside the target closure", () =>
  Effect.gen(function* () {
    const reader = yield* TrackerGraphReader
    const graph = yield* reader.read(target)

    expect(graph.taskIds()).toEqual([transitiveBlocker, child, firstBlocker, root, secondBlocker])
  }).pipe(
    Effect.provide(githubTrackerGraphReaderLayer),
    Effect.provide(
      clientLayerFor((request) => {
        if (request._tag === "ReadSubIssues" && request.issueNodeId === "first-blocker-node") {
          return connection("subIssues", ["outside-target-closure"], false, null, "first-blocker-node")
        }
        if (request._tag === "ReadIssue" && request.issueNodeId === "outside-target-closure") {
          return issue("outside-target-closure", "first-blocker-node")
        }
        return responseFor(request)
      })
    )
  )
)

it.effect("accepts a relation that completes on the exact page limit", () =>
  Effect.gen(function* () {
    const reader = yield* TrackerGraphReader
    const graph = yield* reader.read(target)
    expect(graph.taskIds()).toEqual([root])
  }).pipe(
    Effect.provide(githubTrackerGraphReaderLayer),
    Effect.provide(
      clientLayerFor((request) => {
        if (request._tag !== "ReadSubIssues" || request.issueNodeId !== "root-node") {
          return responseFor(request)
        }
        const pageIndex = request.cursor === null ? 0 : Number(request.cursor)
        const hasNextPage = pageIndex + 1 < githubConnectionPageLimit
        return connection("subIssues", [], hasNextPage, hasNextPage ? String(pageIndex + 1) : null)
      })
    )
  )
)

it.effect("rejects an incomplete pagination response without exposing a snapshot", () =>
  Effect.gen(function* () {
    const reader = yield* TrackerGraphReader
    const error = yield* reader.read(target).pipe(Effect.flip, Effect.orDie)

    expect(error).toBeInstanceOf(TrackerAdapterReadError)
    if (error._tag === "TrackerGraphReader.AdapterReadError") {
      expect(error.context.operation).toBe("GithubTrackerGraphReader.readSubIssues")
      expect(error.reason._tag).toBe("IncompleteSnapshot")
    }
  }).pipe(Effect.provide(githubTrackerGraphReaderLayer), Effect.provide(incompleteClientLayer))
)

it.effect("rejects GraphQL errors and malformed provider payloads as distinct failures", () =>
  Effect.gen(function* () {
    const graphqlError = yield* failedRead(
      clientLayerFor((request) =>
        request._tag === "ResolveIssue"
          ? page({ data: null, errors: [{ message: "forbidden" }] })
          : responseFor(request)
      )
    )
    const malformed = yield* failedRead(
      clientLayerFor((request) =>
        request._tag === "ResolveIssue" ? page({ data: { repository: { issue: 42 } } }) : responseFor(request)
      )
    )

    expect(graphqlError._tag).toBe("TrackerGraphReader.AdapterReadError")
    expect(malformed._tag).toBe("TrackerGraphReader.AdapterReadError")
    if (
      graphqlError._tag === "TrackerGraphReader.AdapterReadError" &&
      malformed._tag === "TrackerGraphReader.AdapterReadError"
    ) {
      expect(graphqlError.reason._tag).toBe("IncompleteSnapshot")
      expect(malformed.reason._tag).toBe("BoundaryDecode")
    }
  })
)

it.effect("preserves a locally opened provider circuit as a distinct read failure", () =>
  Effect.gen(function* () {
    const failure = yield* failedRead(
      Layer.succeed(
        GithubGraphqlClient,
        GithubGraphqlClient.of({
          execute: (request) =>
            Effect.fail(
              new GithubGraphqlRequestError({
                detail: "request budget is open",
                kind: "CircuitOpen",
                operation: request._tag
              })
            )
        })
      )
    )
    expect(failure._tag).toBe("TrackerGraphReader.AdapterReadError")
    if (failure._tag === "TrackerGraphReader.AdapterReadError") {
      expect(failure.reason._tag).toBe("CircuitOpen")
    }
  })
)

it.effect("fails closed for inaccessible, contradictory, and unsupported GitHub observations", () =>
  Effect.gen(function* () {
    const override = (replacement: (request: GithubGraphqlRequest) => ReturnType<typeof page> | undefined) =>
      clientLayerFor((request) => replacement(request) ?? responseFor(request))
    const scenarios = [
      failedRead(
        override((request) => (request._tag === "ResolveIssue" ? page({ data: { repository: null } }) : undefined))
      ),
      failedRead(
        override((request) =>
          request._tag === "ResolveIssue"
            ? page({ data: { repository: { id: "repository-node", issue: null } } })
            : undefined
        )
      ),
      failedRead(override((request) => (request._tag === "ResolveIssue" ? page(42) : undefined))),
      failedRead(
        override((request) =>
          request._tag === "ReadIssue" && request.issueNodeId === "root-node"
            ? page({ data: { node: null } })
            : undefined
        )
      ),
      failedRead(
        override((request) =>
          request._tag === "ReadIssue" && request.issueNodeId === "root-node"
            ? issue("different-node", null)
            : undefined
        )
      ),
      failedRead(
        override((request) =>
          request._tag === "ReadIssue" && request.issueNodeId === "root-node"
            ? issue("root-node", null, "OPEN", null, "different-repository")
            : undefined
        )
      ),
      failedRead(
        override((request) =>
          request._tag === "ReadIssue" && request.issueNodeId === "child-node"
            ? issue("child-node", "root-node", "OPEN", null, "different-repository")
            : undefined
        )
      ),
      failedRead(
        override((request) =>
          request._tag === "ReadIssue" && request.issueNodeId === "child-node"
            ? issue("child-node", "different-parent")
            : undefined
        )
      ),
      failedRead(
        override((request) =>
          request._tag === "ReadIssue" && request.issueNodeId === "root-node"
            ? issue("root-node", null, "OPEN", "COMPLETED")
            : undefined
        )
      ),
      failedRead(
        override((request) =>
          request._tag === "ReadIssue" && request.issueNodeId === "root-node"
            ? issue("root-node", null, "CLOSED", null)
            : undefined
        )
      ),
      failedRead(
        override((request) =>
          request._tag === "ReadSubIssues" && request.issueNodeId === "root-node"
            ? connection("subIssues", ["child-node", "child-node"])
            : undefined
        )
      ),
      failedRead(
        override((request) =>
          request._tag === "ReadSubIssues" && request.issueNodeId === "root-node"
            ? connection("subIssues", [], false, null, "different-node")
            : undefined
        )
      ),
      failedRead(
        override((request) =>
          request._tag === "ReadSubIssues" && request.issueNodeId === "root-node"
            ? connection("subIssues", [], true, "repeat")
            : undefined
        )
      ),
      failedRead(
        override((request) => {
          if (request._tag !== "ReadSubIssues" || request.issueNodeId !== "root-node") {
            return undefined
          }
          const pageIndex = request.cursor === null ? 0 : Number(request.cursor)
          const hasNextPage = pageIndex < githubConnectionPageLimit
          return connection("subIssues", [], hasNextPage, hasNextPage ? String(pageIndex + 1) : null)
        })
      ),
      failedRead(
        override((request) => {
          const childPrefix = "bounded-child-"
          if (request._tag === "ReadSubIssues" && request.issueNodeId === "root-node") {
            return connection(
              "subIssues",
              Array.from({ length: githubSnapshotTaskLimit }, (_, index) => `${childPrefix}${index}`)
            )
          }
          if (request._tag === "ReadIssue" && request.issueNodeId.startsWith(childPrefix)) {
            return issue(request.issueNodeId, "root-node")
          }
          return undefined
        })
      ),
      failedRead(
        override((request) =>
          request._tag === "ReadSubIssues" && request.issueNodeId === "root-node"
            ? page({ data: { node: null } })
            : undefined
        )
      ),
      failedRead(
        override((request) =>
          request._tag === "ReadBlockedBy" && request.issueNodeId === "root-node"
            ? page({ data: { node: null } })
            : undefined
        )
      ),
      failedRead(
        override((request) =>
          request._tag === "ReadSubIssues" && request.issueNodeId === "child-node"
            ? connection("subIssues", ["root-node"], false, null, "child-node")
            : undefined
        )
      ),
      failedRead(
        override((request) => {
          if (request._tag === "ReadBlockedBy" && request.issueNodeId === "root-node") {
            return connection("blockedBy", ["first-blocker-node"])
          }
          if (request._tag === "ReadSubIssues" && request.issueNodeId === "child-node") {
            return connection("subIssues", ["first-blocker-node"], false, null, "child-node")
          }
          return undefined
        })
      ),
      failedRead(
        override((request) => {
          if (request._tag === "ReadSubIssues" && request.issueNodeId === "root-node") {
            return connection("subIssues", ["child-node", "second-blocker-node"])
          }
          if (request._tag === "ReadIssue" && request.issueNodeId === "second-blocker-node") {
            return issue("second-blocker-node", "root-node")
          }
          if (
            request._tag === "ReadSubIssues" &&
            (request.issueNodeId === "child-node" || request.issueNodeId === "second-blocker-node")
          ) {
            return connection("subIssues", ["transitive-blocker-node"], false, null, request.issueNodeId)
          }
          return undefined
        })
      ),
      failedRead(
        override((request) =>
          request._tag === "ReadBlockedBy" && request.issueNodeId === "root-node"
            ? connection("blockedBy", ["root-node"])
            : undefined
        )
      ),
      failedRead(
        Layer.succeed(
          GithubGraphqlClient,
          GithubGraphqlClient.of({
            execute: (request) =>
              Effect.fail(new GithubGraphqlRequestError({ detail: "offline", operation: request._tag }))
          })
        )
      ),
      failedRead(clientLayer, FixtureTarget.make("fixture.json"))
    ]
    const failures = yield* Effect.all(scenarios)

    expect(failures).toHaveLength(scenarios.length)
    expect(failures.some(({ _tag }) => _tag === "TaskDag.GraphProjectionError")).toBe(true)
    expect(failures.filter(({ _tag }) => _tag === "TrackerGraphReader.AdapterReadError")).toHaveLength(
      scenarios.length - 1
    )
    expect(
      failures.filter(
        (failure) =>
          failure._tag === "TrackerGraphReader.AdapterReadError" && failure.reason._tag === "ResourceLimitExceeded"
      )
    ).toHaveLength(2)
  })
)

it.effect("maps reopened and duplicate GitHub lifecycle states", () =>
  Effect.gen(function* () {
    const reader = yield* TrackerGraphReader
    const graph = yield* reader.read(target)
    expect(graph.taskIds()).toHaveLength(5)
  }).pipe(
    Effect.provide(githubTrackerGraphReaderLayer),
    Effect.provide(
      clientLayerFor((request) => {
        if (request._tag === "ReadIssue" && request.issueNodeId === "child-node") {
          return issue("child-node", "root-node", "OPEN", "REOPENED")
        }
        if (request._tag === "ReadIssue" && request.issueNodeId === "second-blocker-node") {
          return issue("second-blocker-node", null, "CLOSED", "DUPLICATE")
        }
        return responseFor(request)
      })
    )
  )
)

trackerGraphReaderContract({
  complete: {
    expectedTasks: [
      {
        id: transitiveBlocker,
        lifecycle: TaskLifecycle.cases.CompletedSuccessfully.make({}),
        parentTaskId: null,
        prerequisiteIds: []
      },
      {
        id: child,
        lifecycle: TaskLifecycle.cases.Open.make({}),
        parentTaskId: root,
        prerequisiteIds: [firstBlocker, secondBlocker]
      },
      {
        id: firstBlocker,
        lifecycle: TaskLifecycle.cases.CompletedSuccessfully.make({}),
        parentTaskId: null,
        prerequisiteIds: [transitiveBlocker]
      },
      { id: root, lifecycle: TaskLifecycle.cases.Open.make({}), parentTaskId: null, prerequisiteIds: [] },
      {
        id: secondBlocker,
        lifecycle: TaskLifecycle.cases.TerminalWithoutSuccess.make({}),
        parentTaskId: null,
        prerequisiteIds: []
      }
    ],
    forbiddenTaskIdFragments: ["42", "dalph", "github.com", "octo", "repository-node", "root-node"],
    layer: githubTrackerGraphReaderLayer.pipe(Layer.provide(clientLayer)),
    target
  },
  failures: [
    {
      expectedErrorTag: "TrackerGraphReader.AdapterReadError",
      layer: githubTrackerGraphReaderLayer.pipe(Layer.provide(incompleteClientLayer)),
      name: "a partial observation",
      target
    },
    {
      expectedErrorTag: "TrackerGraphReader.AdapterReadError",
      layer: githubTrackerGraphReaderLayer.pipe(Layer.provide(inaccessibleClientLayer)),
      name: "an inaccessible observation",
      target
    },
    {
      expectedErrorTag: "TrackerGraphReader.AdapterReadError",
      layer: githubTrackerGraphReaderLayer.pipe(Layer.provide(malformedClientLayer)),
      name: "a malformed observation",
      target
    }
  ],
  focused: {
    expected: makeTaskWorkSpecification({ body: "Exact current body", taskId: root, title: "Exact current title" }),
    taskId: root
  },
  name: "GitHub tracker reader"
})

it.effect("rejects a cross-repository native relationship without exposing a graph", () =>
  Effect.gen(function* () {
    const reader = yield* TrackerGraphReader
    const error = yield* reader.read(target).pipe(Effect.flip, Effect.orDie)

    expect(error._tag).toBe("TrackerGraphReader.AdapterReadError")
    if (error._tag !== "TrackerGraphReader.AdapterReadError") return
    expect(error.reason._tag).toBe("IncompleteSnapshot")
    expect(error.detail).toContain("outside the root repository")
  }).pipe(
    Effect.provide(githubTrackerGraphReaderLayer),
    Effect.provide(
      clientLayerFor((request) =>
        request._tag === "ReadIssue" && request.issueNodeId === "child-node"
          ? issue("child-node", "root-node", "OPEN", null, "foreign-repository")
          : responseFor(request)
      )
    )
  )
)

it.effect("reads exact GitHub title and body for one claimed task", () =>
  Effect.gen(function* () {
    const reader = yield* TrackerGraphReader
    const specification = yield* reader.readTaskWorkSpecification(target, root)
    expect(specification).toEqual(
      makeTaskWorkSpecification({ body: "Exact current body", taskId: root, title: "Exact current title" })
    )
  }).pipe(Effect.provide(githubTrackerGraphReaderLayer), Effect.provide(clientLayer))
)

it.effect(
  "focused GitHub task-work read fails closed on missing cross-repository partial malformed and throttled evidence",
  () =>
    Effect.gen(function* () {
      const foreignTaskId = githubTaskIdFor(
        GithubRepositoryNodeId.make("foreign-repository"),
        GithubIssueNodeId.make("root-node")
      )
      const cases: ReadonlyArray<{
        readonly expectedRequests: ReadonlyArray<GithubGraphqlRequest["_tag"]>
        readonly handler: (request: GithubGraphqlRequest) => GithubGraphqlResponse
        readonly name: string
        readonly reason: TrackerAdapterReadFailureReason["_tag"]
        readonly taskId: TaskId
      }> = [
        {
          expectedRequests: ["ResolveIssue", "ReadTaskWorkSpecification"],
          handler: (request) =>
            request._tag === "ReadTaskWorkSpecification" ? page({ data: { node: null } }) : responseFor(request),
          name: "missing",
          reason: "IncompleteSnapshot",
          taskId: root
        },
        {
          expectedRequests: ["ResolveIssue"],
          handler: responseFor,
          name: "cross-repository",
          reason: "IncompleteSnapshot",
          taskId: foreignTaskId
        },
        {
          expectedRequests: ["ResolveIssue", "ReadTaskWorkSpecification"],
          handler: (request) =>
            request._tag === "ReadTaskWorkSpecification"
              ? page({
                  data: {
                    node: {
                      __typename: "Issue",
                      body: "must not be published",
                      id: "root-node",
                      repository: { id: "repository-node" },
                      title: "Partial provider title"
                    }
                  },
                  errors: [{ message: "partial provider result" }]
                })
              : responseFor(request),
          name: "partial",
          reason: "IncompleteSnapshot",
          taskId: root
        },
        {
          expectedRequests: ["ResolveIssue", "ReadTaskWorkSpecification"],
          handler: (request) =>
            request._tag === "ReadTaskWorkSpecification"
              ? page({ data: { node: { __typename: "Issue", body: "missing title", id: "root-node" } } })
              : responseFor(request),
          name: "malformed",
          reason: "BoundaryDecode",
          taskId: root
        },
        {
          expectedRequests: ["ResolveIssue", "ReadTaskWorkSpecification"],
          handler: (request) =>
            request._tag === "ReadTaskWorkSpecification"
              ? page({
                  data: {
                    node: {
                      __typename: "Issue",
                      body: "body",
                      id: "another-issue",
                      repository: { id: "repository-node" },
                      title: "Another issue"
                    }
                  }
                })
              : responseFor(request),
          name: "wrong issue node",
          reason: "IncompleteSnapshot",
          taskId: root
        },
        {
          expectedRequests: ["ResolveIssue", "ReadTaskWorkSpecification"],
          handler: (request) =>
            request._tag === "ReadTaskWorkSpecification"
              ? page({
                  data: {
                    node: {
                      __typename: "Issue",
                      body: "body",
                      id: "root-node",
                      repository: { id: "repository-node" },
                      title: ""
                    }
                  }
                })
              : responseFor(request),
          name: "empty title",
          reason: "BoundaryDecode",
          taskId: root
        },
        {
          expectedRequests: ["ResolveIssue", "ReadTaskWorkSpecification"],
          handler: (request) =>
            request._tag === "ReadTaskWorkSpecification"
              ? page({ errors: [{ message: "API rate limit exceeded", type: "RATE_LIMITED" }] })
              : responseFor(request),
          name: "throttled",
          reason: "Throttled",
          taskId: root
        },
        {
          expectedRequests: ["ResolveIssue", "ReadTaskWorkSpecification"],
          handler: (request) =>
            request._tag === "ReadTaskWorkSpecification"
              ? page({ errors: [{ message: "secondary rate limit" }] })
              : responseFor(request),
          name: "secondary throttling",
          reason: "Throttled",
          taskId: root
        },
        {
          expectedRequests: ["ResolveIssue", "ReadTaskWorkSpecification"],
          handler: (request) =>
            request._tag === "ReadTaskWorkSpecification"
              ? page({ errors: [{ message: "API rate limit exceeded" }] })
              : responseFor(request),
          name: "primary throttling",
          reason: "Throttled",
          taskId: root
        },
        {
          expectedRequests: [],
          handler: responseFor,
          name: "malformed task identity",
          reason: "BoundaryDecode",
          taskId: TaskId.make("not-a-github-task")
        }
      ]

      for (const scenario of cases) {
        const requests = yield* Ref.make<ReadonlyArray<GithubGraphqlRequest["_tag"]>>([])
        const layer = Layer.succeed(
          GithubGraphqlClient,
          GithubGraphqlClient.of({
            execute: (request) =>
              Ref.update(requests, (current) => [...current, request._tag]).pipe(Effect.as(scenario.handler(request)))
          })
        )
        const error = yield* Effect.gen(function* () {
          const reader = yield* TrackerGraphReader
          return yield* reader.readTaskWorkSpecification(target, scenario.taskId)
        }).pipe(Effect.provide(githubTrackerGraphReaderLayer), Effect.provide(layer), Effect.flip, Effect.orDie)
        expect(error, scenario.name).toMatchObject({
          _tag: "TrackerGraphReader.AdapterReadError",
          reason: { _tag: scenario.reason }
        })
        expect(yield* Ref.get(requests), scenario.name).toEqual(scenario.expectedRequests)
      }
    })
)

it.effect("maps a transport-classified GitHub throttle to the focused typed read failure", () =>
  Effect.gen(function* () {
    const reader = yield* TrackerGraphReader
    const error = yield* reader.readTaskWorkSpecification(target, root).pipe(Effect.flip, Effect.orDie)
    expect(error).toMatchObject({ _tag: "TrackerGraphReader.AdapterReadError", reason: { _tag: "Throttled" } })
  }).pipe(
    Effect.provide(githubTrackerGraphReaderLayer),
    Effect.provide(
      Layer.succeed(
        GithubGraphqlClient,
        githubGraphqlTestClient((request) =>
          request._tag === "ReadTaskWorkSpecification"
            ? Effect.fail(
                new GithubGraphqlReadThrottled({
                  detail: "GitHub request throttled",
                  operation: request._tag,
                  retry: GithubGraphqlThrottleEvidence.cases.Unavailable.make({})
                })
              )
            : Effect.succeed(responseFor(request))
        )
      )
    )
  )
)

it.effect("repeats only the read-only GitHub instruction protocol after a lost response", () =>
  Effect.gen(function* () {
    const attempts = yield* Ref.make(0)
    const requests = yield* Ref.make<ReadonlyArray<GithubGraphqlRequest["_tag"]>>([])
    const layer = Layer.succeed(
      GithubGraphqlClient,
      GithubGraphqlClient.of({
        execute: (request) =>
          Ref.update(requests, (current) => [...current, request._tag]).pipe(
            Effect.andThen(
              request._tag === "ReadTaskWorkSpecification"
                ? Ref.getAndUpdate(attempts, (value) => value + 1).pipe(
                    Effect.flatMap((attempt) =>
                      attempt === 0
                        ? Effect.fail(
                            new GithubGraphqlRequestError({ detail: "response lost", operation: request._tag })
                          )
                        : Effect.succeed(responseFor(request))
                    )
                  )
                : Effect.succeed(responseFor(request))
            )
          )
      })
    )
    const read = Effect.gen(function* () {
      const reader = yield* TrackerGraphReader
      return yield* reader.readTaskWorkSpecification(target, root)
    }).pipe(Effect.provide(githubTrackerGraphReaderLayer), Effect.provide(layer))

    const lost = yield* read.pipe(Effect.flip, Effect.orDie)
    const recovered = yield* read
    expect(lost).toMatchObject({ _tag: "TrackerGraphReader.AdapterReadError", reason: { _tag: "Transport" } })
    expect(recovered.title).toBe("Exact current title")
    expect(yield* Ref.get(requests)).toEqual([
      "ResolveIssue",
      "ReadTaskWorkSpecification",
      "ResolveIssue",
      "ReadTaskWorkSpecification"
    ])
  })
)

it.effect("reads a six-task closure with shared prerequisites in fewer than sixteen provider requests", () =>
  Effect.gen(function* () {
    const calls = yield* Ref.make(0)
    const layer = Layer.succeed(
      GithubGraphqlClient,
      GithubGraphqlClient.of({
        execute: (request) =>
          Ref.update(calls, (n) => n + 1).pipe(
            Effect.andThen(
              request._tag === "ReadGraphBatch"
                ? interpretGithubGraphBatch(request, (read) => Effect.succeed(sixTaskResponse(read)))
                : Effect.succeed(sixTaskResponse(request))
            )
          )
      })
    )
    const graph = yield* Effect.gen(function* () {
      return yield* (yield* TrackerGraphReader).read(target)
    }).pipe(Effect.provide(githubTrackerGraphReaderLayer), Effect.provide(layer))
    expect(graph.taskIds()).toHaveLength(6)
    expect(graph.childrenOf(root)).toEqual([child, taskIdFor("other-child-node")].sort())
    expect(graph.prerequisitesOf(child)).toEqual([firstBlocker, secondBlocker])
    expect(graph.prerequisitesOf(taskIdFor("other-child-node"))).toEqual([firstBlocker])
    expect(graph.prerequisitesOf(firstBlocker)).toEqual([transitiveBlocker])
    expect(Option.getOrThrow(graph.lifecycleOf(firstBlocker))).toEqual(
      TaskLifecycle.cases.CompletedSuccessfully.make({})
    )
    expect(yield* Ref.get(calls)).toBeLessThan(16)
  })
)

const sixTaskResponse = (request: GithubGraphqlRequest) =>
  request._tag === "ReadSubIssues" && request.issueNodeId === "root-node"
    ? connection("subIssues", ["child-node", "other-child-node"])
    : request._tag === "ReadIssue" && request.issueNodeId === "other-child-node"
      ? issue("other-child-node", "root-node")
      : request._tag === "ReadBlockedBy" && request.issueNodeId === "other-child-node"
        ? connection("blockedBy", ["first-blocker-node"], false, null, "other-child-node")
        : responseFor(request)

it.effect("deduplicates discovered fields and batches exact independent pagination cursors", () =>
  Effect.gen(function* () {
    const requests = yield* Ref.make<ReadonlyArray<GithubGraphqlRequest>>([])
    const layer = Layer.succeed(
      GithubGraphqlClient,
      GithubGraphqlClient.of({
        execute: (request) =>
          Ref.update(requests, (all) => [...all, request]).pipe(
            Effect.andThen(
              request._tag === "ReadGraphBatch"
                ? interpretGithubGraphBatch(request, (read) => Effect.succeed(sixTaskResponse(read)))
                : Effect.succeed(sixTaskResponse(request))
            )
          )
      })
    )
    yield* Effect.gen(function* () {
      return yield* (yield* TrackerGraphReader).read(target)
    }).pipe(Effect.provide(githubTrackerGraphReaderLayer), Effect.provide(layer))
    const all = yield* Ref.get(requests)
    const fields = all.flatMap((request) => (request._tag === "ReadGraphBatch" ? request.reads : []))
    const keys = fields.map(
      (field) => `${field._tag}/${field.issueNodeId}/${"cursor" in field ? field.cursor : "identity"}`
    )
    expect(new Set(keys).size).toBe(keys.length)
    expect(
      fields.filter((field) => field._tag === "ReadIssue" && field.issueNodeId === "first-blocker-node")
    ).toHaveLength(1)
    expect(fields).toContainEqual({ _tag: "ReadBlockedBy", issueNodeId: "child-node", cursor: "next-blocker" })
    expect(fields.some((field) => field._tag === "ReadSubIssues" && field.issueNodeId === "first-blocker-node")).toBe(
      false
    )
    expect(all.every((request) => request._tag === "ResolveIssue" || request._tag === "ReadGraphBatch")).toBe(true)
  })
)

it.effect("rejects missing and partial batch fields without returning a graph", () =>
  Effect.gen(function* () {
    for (const body of [
      { data: {} },
      { data: { field0: null, field1: null, field2: null } },
      { data: { field0: { __typename: "Issue", id: "root-node" } }, errors: [{ message: "partial read" }] },
      { errors: [{ type: "RATE_LIMITED", message: "API rate limit exceeded" }] }
    ]) {
      const error = yield* failedRead(
        Layer.succeed(
          GithubGraphqlClient,
          GithubGraphqlClient.of({
            execute: (request) => Effect.succeed(request._tag === "ReadGraphBatch" ? page(body) : responseFor(request))
          })
        )
      )
      expect(error._tag).toBe("TrackerGraphReader.AdapterReadError")
    }
  })
)

it.effect("reads changed lifecycle and edges afresh through the same reader", () =>
  Effect.gen(function* () {
    const changed = yield* Ref.make(false)
    const interpret = (request: GithubGraphqlRequest) =>
      Ref.get(changed).pipe(
        Effect.map((fresh) => {
          if (!fresh) return responseFor(request)
          if (request._tag === "ReadSubIssues" && request.issueNodeId === "root-node")
            return connection("subIssues", [])
          if (request._tag === "ReadBlockedBy" && request.issueNodeId === "root-node")
            return connection("blockedBy", ["first-blocker-node"])
          if (request._tag === "ReadIssue" && request.issueNodeId === "root-node")
            return issue("root-node", null, "CLOSED", "COMPLETED")
          return responseFor(request)
        })
      )
    yield* Effect.gen(function* () {
      const reader = yield* TrackerGraphReader
      const first = yield* reader.read(target)
      yield* Ref.set(changed, true)
      const next = yield* reader.read(target)
      expect(next.childrenOf(root)).toEqual([])
      expect(next.prerequisitesOf(root)).toEqual([firstBlocker])
      expect(next.taskIds()).toHaveLength(3)
      expect(next.revision).not.toBe(first.revision)
    }).pipe(
      Effect.provide(githubTrackerGraphReaderLayer),
      Effect.provide(Layer.succeed(GithubGraphqlClient, githubGraphqlBatchTestClient(interpret)))
    )
  })
)

it.effect("abandons partial batch state after transport failure and throttling before a fresh read", () =>
  Effect.gen(function* () {
    for (const failure of ["transport", "throttle"] as const) {
      const failNext = yield* Ref.make(true)
      const calls = yield* Ref.make<ReadonlyArray<GithubGraphqlRequest["_tag"]>>([])
      const interpret = (request: GithubGraphqlRequest): GithubGraphqlReadExecution =>
        Ref.update(calls, (all) => [...all, request._tag]).pipe(
          Effect.andThen(
            request._tag === "ReadGraphBatch"
              ? (request.reads.some((read) => read.issueNodeId === "child-node")
                  ? Ref.getAndSet(failNext, false)
                  : Effect.succeed(false)
                ).pipe(
                  Effect.flatMap(
                    (fail): GithubGraphqlReadExecution =>
                      fail
                        ? failure === "transport"
                          ? Effect.fail(
                              new GithubGraphqlRequestError({ operation: request._tag, detail: "response lost" })
                            )
                          : Effect.fail(
                              new GithubGraphqlReadThrottled({
                                operation: request._tag,
                                detail: "throttled",
                                retry: GithubGraphqlThrottleEvidence.cases.Unavailable.make({})
                              })
                            )
                        : interpretGithubGraphBatch(request, (read) => Effect.succeed(responseFor(read)))
                  )
                )
              : Effect.succeed(responseFor(request))
          )
        )
      yield* Effect.gen(function* () {
        const reader = yield* TrackerGraphReader
        const error = yield* reader.read(target).pipe(Effect.flip, Effect.orDie)
        expect(error).toMatchObject({ reason: { _tag: failure === "transport" ? "Transport" : "Throttled" } })
        expect((yield* Ref.get(calls)).filter((tag) => tag === "ResolveIssue")).toHaveLength(1)
        const next = yield* reader.read(target)
        expect(next.taskIds()).toHaveLength(5)
        expect((yield* Ref.get(calls)).filter((tag) => tag === "ResolveIssue")).toHaveLength(2)
      }).pipe(
        Effect.provide(githubTrackerGraphReaderLayer),
        Effect.provide(Layer.succeed(GithubGraphqlClient, githubGraphqlTestClient(interpret)))
      )
    }
  })
)

it.effect("bounds wide closure batches and follows both relation cursors together", () =>
  Effect.gen(function* () {
    const batches = yield* Ref.make<ReadonlyArray<Extract<GithubGraphqlRequest, { readonly _tag: "ReadGraphBatch" }>>>(
      []
    )
    const children = Array.from({ length: 45 }, (_, index) => `wide-child-${index}`)
    const interpret = (read: GithubGraphqlRequest) => {
      if (read._tag === "ReadIssue" && children.includes(read.issueNodeId)) return issue(read.issueNodeId, "root-node")
      if (read._tag === "ReadSubIssues" && read.issueNodeId === "root-node")
        return read.cursor === null
          ? connection("subIssues", children, true, "children-page")
          : connection("subIssues", [])
      if (read._tag === "ReadBlockedBy" && read.issueNodeId === "root-node")
        return read.cursor === null ? connection("blockedBy", [], true, "blockers-page") : connection("blockedBy", [])
      return responseFor(read)
    }
    const layer = Layer.succeed(
      GithubGraphqlClient,
      GithubGraphqlClient.of({
        execute: (request) =>
          request._tag === "ReadGraphBatch"
            ? Ref.update(batches, (all) => [...all, request]).pipe(
                Effect.andThen(interpretGithubGraphBatch(request, (read) => Effect.succeed(interpret(read))))
              )
            : Effect.succeed(interpret(request))
      })
    )
    const graph = yield* Effect.gen(function* () {
      return yield* (yield* TrackerGraphReader).read(target)
    }).pipe(Effect.provide(githubTrackerGraphReaderLayer), Effect.provide(layer))
    expect(graph.taskIds()).toHaveLength(46)
    const all = yield* Ref.get(batches)
    expect(all.every((batch) => batch.reads.length <= 30)).toBe(true)
    expect(
      all.some(
        (batch) =>
          batch.reads.some((read) => read._tag === "ReadSubIssues" && read.cursor === "children-page") &&
          batch.reads.some((read) => read._tag === "ReadBlockedBy" && read.cursor === "blockers-page")
      )
    ).toBe(true)
  })
)
