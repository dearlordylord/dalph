import { expect, it } from "@effect/vitest"
import { Effect, Layer } from "effect"
import { trackerGraphReaderContract } from "../test/tracker-graph-reader-contract.js"
import {
  FixtureTarget,
  GithubIssueNumber,
  GithubIssueTarget,
  GithubRepositoryName,
  GithubRepositoryOwner,
  TaskId,
  TaskLifecycle,
  type TrackerTarget
} from "./domain.js"
import {
  GithubGraphqlClient,
  type GithubGraphqlRequest,
  GithubGraphqlRequestError,
  type GithubGraphqlResponse,
  GithubRequestId
} from "./github-graphql-client.js"
import { githubTrackerGraphReaderLayer } from "./github-tracker-graph-reader.js"
import { TrackerAdapterReadError, TrackerGraphReader } from "./tracker-graph-reader.js"

const page = (
  requestId: string,
  body: unknown
): GithubGraphqlResponse => ({ body, requestId: GithubRequestId.make(requestId) })

const issue = (
  id: string,
  parentId: string | null,
  state: "CLOSED" | "OPEN" = "OPEN",
  stateReason: "COMPLETED" | "DUPLICATE" | "NOT_PLANNED" | "REOPENED" | null = null
) =>
  page(`issue-${id}`, {
    data: {
      node: {
        __typename: "Issue",
        id,
        parent: parentId === null ? null : { id: parentId },
        repository: { id: "repository-node" },
        state,
        stateReason
      }
    }
  })

const connection = (
  requestId: string,
  field: "blockedBy" | "subIssues",
  ids: ReadonlyArray<string>,
  hasNextPage = false,
  endCursor: string | null = null
) =>
  page(requestId, {
    data: {
      node: {
        __typename: "Issue",
        [field]: {
          nodes: ids.map((id) => ({ id })),
          pageInfo: { endCursor, hasNextPage }
        }
      }
    }
  })

const responseFor = (request: GithubGraphqlRequest) => {
  switch (request._tag) {
    case "ResolveIssue":
      return page("resolve-root", {
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
        return connection("root-subissues-1", "subIssues", ["child-node"], true, "next-child")
      }
      if (request.issueNodeId === "root-node" && request.cursor === "next-child") {
        return connection("root-subissues-2", "subIssues", [])
      }
      return connection(`subissues-${request.issueNodeId}`, "subIssues", [])
    case "ReadBlockedBy":
      if (request.issueNodeId === "child-node" && request.cursor === null) {
        return connection("child-blockers-1", "blockedBy", ["first-blocker-node"], true, "next-blocker")
      }
      if (request.issueNodeId === "child-node" && request.cursor === "next-blocker") {
        return connection("child-blockers-2", "blockedBy", ["second-blocker-node"])
      }
      if (request.issueNodeId === "first-blocker-node") {
        return connection("transitive-blocker", "blockedBy", ["transitive-blocker-node"])
      }
      return connection(`blockers-${request.issueNodeId}`, "blockedBy", [])
  }

  return page("unexpected", { data: null })
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

const root = TaskId.make("[\"repository-node\",\"root-node\"]")
const child = TaskId.make("[\"repository-node\",\"child-node\"]")
const firstBlocker = TaskId.make("[\"repository-node\",\"first-blocker-node\"]")
const secondBlocker = TaskId.make("[\"repository-node\",\"second-blocker-node\"]")
const transitiveBlocker = TaskId.make("[\"repository-node\",\"transitive-blocker-node\"]")

const incompleteClientLayer = clientLayerFor((request) =>
  request._tag === "ReadSubIssues" && request.issueNodeId === "root-node"
    ? connection("partial-subissues", "subIssues", [], true, null)
    : responseFor(request)
)

const malformedClientLayer = clientLayerFor((request) =>
  request._tag === "ResolveIssue"
    ? page("malformed", { data: { repository: { issue: 42 } } })
    : responseFor(request)
)

const inaccessibleClientLayer = clientLayerFor((request) =>
  request._tag === "ResolveIssue"
    ? page("inaccessible", { data: { repository: null } })
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
      child,
      firstBlocker,
      root,
      secondBlocker,
      transitiveBlocker
    ])
    expect(graph.childrenOf(root)).toEqual([child])
    expect(graph.prerequisitesOf(child)).toEqual([firstBlocker, secondBlocker])
    expect(graph.prerequisitesOf(firstBlocker)).toEqual([transitiveBlocker])
    expect(graph.eligibleTaskIds()).toEqual([root])
  }).pipe(
    Effect.provide(githubTrackerGraphReaderLayer),
    Effect.provide(clientLayer)
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
        ? page("graphql-error", { data: null, errors: [{ message: "forbidden" }] })
        : responseFor(request)
    ))
    const malformed = yield* failedRead(clientLayerFor((request) =>
      request._tag === "ResolveIssue"
        ? page("malformed", { data: { repository: { issue: 42 } } })
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
          ? page("missing-repository", { data: { repository: null } })
          : undefined
      )),
      failedRead(override((request) =>
        request._tag === "ResolveIssue"
          ? page("missing-root", { data: { repository: { id: "repository-node", issue: null } } })
          : undefined
      )),
      failedRead(override((request) =>
        request._tag === "ResolveIssue"
          ? page("malformed-envelope", 42)
          : undefined
      )),
      failedRead(override((request) =>
        request._tag === "ReadIssue" && request.issueNodeId === "root-node"
          ? page("missing-issue", { data: { node: null } })
          : undefined
      )),
      failedRead(override((request) =>
        request._tag === "ReadIssue" && request.issueNodeId === "root-node"
          ? issue("different-node", null)
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
          ? connection("duplicate-child", "subIssues", ["child-node", "child-node"])
          : undefined
      )),
      failedRead(override((request) =>
        request._tag === "ReadSubIssues" && request.issueNodeId === "root-node"
          ? connection("repeated-cursor", "subIssues", [], true, "repeat")
          : undefined
      )),
      failedRead(override((request) =>
        request._tag === "ReadSubIssues" && request.issueNodeId === "root-node"
          ? page("missing-subissues", { data: { node: null } })
          : undefined
      )),
      failedRead(override((request) =>
        request._tag === "ReadBlockedBy" && request.issueNodeId === "root-node"
          ? page("missing-blockers", { data: { node: null } })
          : undefined
      )),
      failedRead(override((request) =>
        request._tag === "ReadSubIssues" && request.issueNodeId === "child-node"
          ? connection("containment-cycle", "subIssues", ["root-node"])
          : undefined
      )),
      failedRead(override((request) => {
        if (request._tag === "ReadBlockedBy" && request.issueNodeId === "root-node") {
          return connection("early-prerequisite", "blockedBy", ["first-blocker-node"])
        }
        if (request._tag === "ReadSubIssues" && request.issueNodeId === "child-node") {
          return connection("late-parent", "subIssues", ["first-blocker-node"])
        }
        return undefined
      })),
      failedRead(override((request) => {
        if (request._tag === "ReadSubIssues" && request.issueNodeId === "root-node") {
          return connection("two-parents", "subIssues", ["child-node", "second-blocker-node"])
        }
        if (request._tag === "ReadIssue" && request.issueNodeId === "second-blocker-node") {
          return issue("second-blocker-node", "root-node")
        }
        if (
          request._tag === "ReadSubIssues"
          && (request.issueNodeId === "child-node" || request.issueNodeId === "second-blocker-node")
        ) {
          return connection(
            `shared-child-${request.issueNodeId}`,
            "subIssues",
            ["transitive-blocker-node"]
          )
        }
        return undefined
      })),
      failedRead(override((request) =>
        request._tag === "ReadBlockedBy" && request.issueNodeId === "root-node"
          ? connection("dependency-cycle", "blockedBy", ["root-node"])
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
      },
      {
        id: transitiveBlocker,
        lifecycle: TaskLifecycle.cases.CompletedSuccessfully.make({}),
        parentTaskId: null,
        prerequisiteIds: []
      }
    ],
    forbiddenTaskIdFragments: ["42", "dalph", "octo", "github.com"],
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
