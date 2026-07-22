import { expect, it } from "@effect/vitest"
import { Effect, Layer } from "effect"
import { trackerGraphReaderContract } from "../test/tracker-graph-reader-contract.js"
import {
  FixtureTarget,
  GithubIssueNumber,
  GithubIssueTarget,
  GithubRepositoryName,
  GithubRepositoryOwner,
  TaskLifecycle
} from "./domain.js"
import type { TaskId, TrackerTarget } from "./domain.js"
import {
  GithubGraphqlClient,
  type GithubGraphqlRequest,
  GithubGraphqlRequestError,
  type GithubGraphqlResponse,
  GithubIssueNodeId,
  GithubRepositoryNodeId
} from "./github-graphql-client.js"
import { githubTaskIdFor } from "./github-task-identity.js"
import { githubTrackerGraphReaderLayer } from "./github-tracker-graph-reader.js"
import { githubConnectionPageLimit, githubSnapshotTaskLimit } from "./github-tracker-read-limits.js"
import { TrackerAdapterReadError, TrackerGraphReader } from "./tracker-graph-reader.js"

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
        [field]: {
          nodes: ids.map((id) => ({ id })),
          pageInfo: { endCursor, hasNextPage }
        }
      }
    }
  })

const responseFor = (request: GithubGraphqlRequest) => {
  switch (request._tag) {
    case "FindClaimLabel":
    case "CreateClaimLabel":
    case "DeleteClaimLabel":
      return page({ errors: [{ message: "unexpected claim request" }] })
    case "ResolveIssue":
      return page({
        data: {
          repository: {
            id: "repository-node",
            issue: { id: "root-node" }
          }
        }
      })
    case "ReadIssue":
      switch (request.issueNodeId) {
        case "root-node":
          return issue("root-node", null)
        case "child-node":
          return issue("child-node", "root-node")
        case "first-blocker-node":
          return issue("first-blocker-node", null, "CLOSED", "COMPLETED")
        case "second-blocker-node":
          return issue("second-blocker-node", null, "CLOSED", "NOT_PLANNED")
        case "transitive-blocker-node":
          return issue("transitive-blocker-node", null, "CLOSED", "COMPLETED")
      }
      break
    case "ReadSubIssues":
      if (request.issueNodeId === "root-node" && request.cursor === null) {
        return connection("subIssues", ["child-node"], true, "next-child")
      }
      if (request.issueNodeId === "root-node" && request.cursor === "next-child") {
        return connection("subIssues", [])
      }
      return connection("subIssues", [], false, null, request.issueNodeId)
    case "ReadBlockedBy":
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

  return page({ data: null })
}

const clientLayerFor = (
  handler: (request: GithubGraphqlRequest) => GithubGraphqlResponse
) =>
  Layer.succeed(
    GithubGraphqlClient,
    GithubGraphqlClient.of({
      execute: Effect.fn("GithubGraphqlClient.Test.execute")((request) => Effect.succeed(handler(request)))
    })
  )

const clientLayer = clientLayerFor(responseFor)

const target = GithubIssueTarget.make({
  issueNumber: GithubIssueNumber.make(42),
  owner: GithubRepositoryOwner.make("octo"),
  repository: GithubRepositoryName.make("dalph")
})

const taskIdFor = (issueNodeId: string): TaskId =>
  githubTaskIdFor(
    GithubRepositoryNodeId.make("repository-node"),
    GithubIssueNodeId.make(issueNodeId)
  )
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
  request._tag === "ResolveIssue"
    ? page({ data: { repository: { issue: 42 } } })
    : responseFor(request)
)

const inaccessibleClientLayer = clientLayerFor((request) =>
  request._tag === "ResolveIssue"
    ? page({ data: { repository: null } })
    : responseFor(request)
)

const failedRead = (
  layer: Layer.Layer<GithubGraphqlClient>,
  readTarget: TrackerTarget = target
) =>
  Effect.gen(function*() {
    const reader = yield* TrackerGraphReader
    return yield* reader.read(readTarget)
  }).pipe(
    Effect.provide(githubTrackerGraphReaderLayer.pipe(Layer.provide(layer))),
    Effect.flip,
    Effect.orDie
  )

it.effect("projects paginated grouping and transitive prerequisite closure atomically", () =>
  Effect.gen(function*() {
    const reader = yield* TrackerGraphReader
    const graph = yield* reader.read(target)

    expect(graph.taskIds()).toEqual([
      transitiveBlocker,
      child,
      firstBlocker,
      root,
      secondBlocker
    ])
    expect(graph.childrenOf(root)).toEqual([child])
    expect(graph.prerequisitesOf(child)).toEqual([firstBlocker, secondBlocker])
    expect(graph.prerequisitesOf(firstBlocker)).toEqual([transitiveBlocker])
    expect(graph.eligibleTaskIds()).toEqual([root])
  }).pipe(
    Effect.provide(githubTrackerGraphReaderLayer),
    Effect.provide(clientLayer)
  ))

it.effect("derives a stable revision from canonical snapshot content", () =>
  Effect.gen(function*() {
    const readWith = (layer: Layer.Layer<GithubGraphqlClient>) =>
      Effect.gen(function*() {
        const reader = yield* TrackerGraphReader
        return yield* reader.read(target)
      }).pipe(Effect.provide(githubTrackerGraphReaderLayer), Effect.provide(layer))

    const first = yield* readWith(clientLayer)
    const second = yield* readWith(clientLayerFor((request) =>
      request._tag === "ReadBlockedBy" && request.issueNodeId === "child-node"
        ? connection("blockedBy", ["second-blocker-node", "first-blocker-node"], false, null, "child-node")
        : responseFor(request)
    ))

    expect(second.revision).toBe(first.revision)
  }))

it.effect("keeps grouping descendants of prerequisite-only tasks outside the target closure", () =>
  Effect.gen(function*() {
    const reader = yield* TrackerGraphReader
    const graph = yield* reader.read(target)

    expect(graph.taskIds()).toEqual([
      transitiveBlocker,
      child,
      firstBlocker,
      root,
      secondBlocker
    ])
  }).pipe(
    Effect.provide(githubTrackerGraphReaderLayer),
    Effect.provide(clientLayerFor((request) => {
      if (request._tag === "ReadSubIssues" && request.issueNodeId === "first-blocker-node") {
        return connection("subIssues", ["outside-target-closure"], false, null, "first-blocker-node")
      }
      if (request._tag === "ReadIssue" && request.issueNodeId === "outside-target-closure") {
        return issue("outside-target-closure", "first-blocker-node")
      }
      return responseFor(request)
    }))
  ))

it.effect("accepts a relation that completes on the exact page limit", () =>
  Effect.gen(function*() {
    const reader = yield* TrackerGraphReader
    const graph = yield* reader.read(target)
    expect(graph.taskIds()).toEqual([root])
  }).pipe(
    Effect.provide(githubTrackerGraphReaderLayer),
    Effect.provide(clientLayerFor((request) => {
      if (request._tag !== "ReadSubIssues" || request.issueNodeId !== "root-node") {
        return responseFor(request)
      }
      const pageIndex = request.cursor === null ? 0 : Number(request.cursor)
      const hasNextPage = pageIndex + 1 < githubConnectionPageLimit
      return connection("subIssues", [], hasNextPage, hasNextPage ? String(pageIndex + 1) : null)
    }))
  ))

it.effect("rejects an incomplete pagination response without exposing a snapshot", () =>
  Effect.gen(function*() {
    const reader = yield* TrackerGraphReader
    const error = yield* reader.read(target).pipe(Effect.flip, Effect.orDie)

    expect(error).toBeInstanceOf(TrackerAdapterReadError)
    if (error._tag === "TrackerGraphReader.AdapterReadError") {
      expect(error.context.operation).toBe("GithubTrackerGraphReader.readSubIssues")
      expect(error.reason._tag).toBe("IncompleteSnapshot")
    }
  }).pipe(
    Effect.provide(githubTrackerGraphReaderLayer),
    Effect.provide(incompleteClientLayer)
  ))

it.effect("rejects GraphQL errors and malformed provider payloads as distinct failures", () =>
  Effect.gen(function*() {
    const graphqlError = yield* failedRead(clientLayerFor((request) =>
      request._tag === "ResolveIssue"
        ? page({ data: null, errors: [{ message: "forbidden" }] })
        : responseFor(request)
    ))
    const malformed = yield* failedRead(clientLayerFor((request) =>
      request._tag === "ResolveIssue"
        ? page({ data: { repository: { issue: 42 } } })
        : responseFor(request)
    ))

    expect(graphqlError._tag).toBe("TrackerGraphReader.AdapterReadError")
    expect(malformed._tag).toBe("TrackerGraphReader.AdapterReadError")
    if (
      graphqlError._tag === "TrackerGraphReader.AdapterReadError"
      && malformed._tag === "TrackerGraphReader.AdapterReadError"
    ) {
      expect(graphqlError.reason._tag).toBe("IncompleteSnapshot")
      expect(malformed.reason._tag).toBe("BoundaryDecode")
    }
  }))

it.effect("fails closed for inaccessible, contradictory, and unsupported GitHub observations", () =>
  Effect.gen(function*() {
    const override = (
      replacement: (request: GithubGraphqlRequest) => ReturnType<typeof page> | undefined
    ) => clientLayerFor((request) => replacement(request) ?? responseFor(request))
    const scenarios = [
      failedRead(override((request) =>
        request._tag === "ResolveIssue"
          ? page({ data: { repository: null } })
          : undefined
      )),
      failedRead(override((request) =>
        request._tag === "ResolveIssue"
          ? page({ data: { repository: { id: "repository-node", issue: null } } })
          : undefined
      )),
      failedRead(override((request) =>
        request._tag === "ResolveIssue"
          ? page(42)
          : undefined
      )),
      failedRead(override((request) =>
        request._tag === "ReadIssue" && request.issueNodeId === "root-node"
          ? page({ data: { node: null } })
          : undefined
      )),
      failedRead(override((request) =>
        request._tag === "ReadIssue" && request.issueNodeId === "root-node"
          ? issue("different-node", null)
          : undefined
      )),
      failedRead(override((request) =>
        request._tag === "ReadIssue" && request.issueNodeId === "root-node"
          ? issue("root-node", null, "OPEN", null, "different-repository")
          : undefined
      )),
      failedRead(override((request) =>
        request._tag === "ReadIssue" && request.issueNodeId === "child-node"
          ? issue("child-node", "root-node", "OPEN", null, "different-repository")
          : undefined
      )),
      failedRead(override((request) =>
        request._tag === "ReadIssue" && request.issueNodeId === "child-node"
          ? issue("child-node", "different-parent")
          : undefined
      )),
      failedRead(override((request) =>
        request._tag === "ReadIssue" && request.issueNodeId === "root-node"
          ? issue("root-node", null, "OPEN", "COMPLETED")
          : undefined
      )),
      failedRead(override((request) =>
        request._tag === "ReadIssue" && request.issueNodeId === "root-node"
          ? issue("root-node", null, "CLOSED", null)
          : undefined
      )),
      failedRead(override((request) =>
        request._tag === "ReadSubIssues" && request.issueNodeId === "root-node"
          ? connection("subIssues", ["child-node", "child-node"])
          : undefined
      )),
      failedRead(override((request) =>
        request._tag === "ReadSubIssues" && request.issueNodeId === "root-node"
          ? connection("subIssues", [], false, null, "different-node")
          : undefined
      )),
      failedRead(override((request) =>
        request._tag === "ReadSubIssues" && request.issueNodeId === "root-node"
          ? connection("subIssues", [], true, "repeat")
          : undefined
      )),
      failedRead(override((request) => {
        if (request._tag !== "ReadSubIssues" || request.issueNodeId !== "root-node") {
          return undefined
        }
        const pageIndex = request.cursor === null ? 0 : Number(request.cursor)
        const hasNextPage = pageIndex < githubConnectionPageLimit
        return connection("subIssues", [], hasNextPage, hasNextPage ? String(pageIndex + 1) : null)
      })),
      failedRead(override((request) => {
        const childPrefix = "bounded-child-"
        if (request._tag === "ReadSubIssues" && request.issueNodeId === "root-node") {
          return connection(
            "subIssues",
            Array.from(
              { length: githubSnapshotTaskLimit },
              (_, index) => `${childPrefix}${index}`
            )
          )
        }
        if (request._tag === "ReadIssue" && request.issueNodeId.startsWith(childPrefix)) {
          return issue(request.issueNodeId, "root-node")
        }
        return undefined
      })),
      failedRead(override((request) =>
        request._tag === "ReadSubIssues" && request.issueNodeId === "root-node"
          ? page({ data: { node: null } })
          : undefined
      )),
      failedRead(override((request) =>
        request._tag === "ReadBlockedBy" && request.issueNodeId === "root-node"
          ? page({ data: { node: null } })
          : undefined
      )),
      failedRead(override((request) =>
        request._tag === "ReadSubIssues" && request.issueNodeId === "child-node"
          ? connection("subIssues", ["root-node"], false, null, "child-node")
          : undefined
      )),
      failedRead(override((request) => {
        if (request._tag === "ReadBlockedBy" && request.issueNodeId === "root-node") {
          return connection("blockedBy", ["first-blocker-node"])
        }
        if (request._tag === "ReadSubIssues" && request.issueNodeId === "child-node") {
          return connection("subIssues", ["first-blocker-node"], false, null, "child-node")
        }
        return undefined
      })),
      failedRead(override((request) => {
        if (request._tag === "ReadSubIssues" && request.issueNodeId === "root-node") {
          return connection("subIssues", ["child-node", "second-blocker-node"])
        }
        if (request._tag === "ReadIssue" && request.issueNodeId === "second-blocker-node") {
          return issue("second-blocker-node", "root-node")
        }
        if (
          request._tag === "ReadSubIssues"
          && (request.issueNodeId === "child-node" || request.issueNodeId === "second-blocker-node")
        ) {
          return connection("subIssues", ["transitive-blocker-node"], false, null, request.issueNodeId)
        }
        return undefined
      })),
      failedRead(override((request) =>
        request._tag === "ReadBlockedBy" && request.issueNodeId === "root-node"
          ? connection("blockedBy", ["root-node"])
          : undefined
      )),
      failedRead(
        Layer.succeed(
          GithubGraphqlClient,
          GithubGraphqlClient.of({
            execute: (request) =>
              Effect.fail(
                new GithubGraphqlRequestError({
                  detail: "offline",
                  operation: request._tag
                })
              )
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
    expect(failures.filter((failure) =>
      failure._tag === "TrackerGraphReader.AdapterReadError"
      && failure.reason._tag === "ResourceLimitExceeded"
    )).toHaveLength(2)
  }))

it.effect("maps reopened and duplicate GitHub lifecycle states", () =>
  Effect.gen(function*() {
    const reader = yield* TrackerGraphReader
    const graph = yield* reader.read(target)
    expect(graph.taskIds()).toHaveLength(5)
  }).pipe(
    Effect.provide(githubTrackerGraphReaderLayer),
    Effect.provide(clientLayerFor((request) => {
      if (request._tag === "ReadIssue" && request.issueNodeId === "child-node") {
        return issue("child-node", "root-node", "OPEN", "REOPENED")
      }
      if (request._tag === "ReadIssue" && request.issueNodeId === "second-blocker-node") {
        return issue("second-blocker-node", null, "CLOSED", "DUPLICATE")
      }
      return responseFor(request)
    }))
  ))

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
      {
        id: root,
        lifecycle: TaskLifecycle.cases.Open.make({}),
        parentTaskId: null,
        prerequisiteIds: []
      },
      {
        id: secondBlocker,
        lifecycle: TaskLifecycle.cases.TerminalWithoutSuccess.make({}),
        parentTaskId: null,
        prerequisiteIds: []
      }
    ],
    forbiddenTaskIdFragments: [
      "42",
      "dalph",
      "github.com",
      "octo",
      "repository-node",
      "root-node"
    ],
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
  name: "GitHub tracker reader"
})
