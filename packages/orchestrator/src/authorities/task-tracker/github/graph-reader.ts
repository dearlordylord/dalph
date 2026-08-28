import { Effect, Layer, Option } from "effect"
import { GraphProjectionError, projectTrackerSnapshot } from "../graph.js"
import {
  type GithubTrackerReadOperation,
  type TrackerAdapterReadError,
  TrackerAdapterReadFailureReason,
  TrackerGraphReader
} from "../graph-reader.js"
import type { TaskLifecycle, TrackerTask } from "../task.js"
import { type TrackerTarget } from "../target.js"
import { GithubGraphqlClient, githubGraphqlClientNodeLayer, GithubGraphqlRequest } from "./graphql-client.js"
import type {
  GithubCursor,
  GithubGraphqlResponse,
  GithubIssueNodeId,
  GithubRepositoryNodeId
} from "./graphql-client.js"
import { BlockedByResponse, ReadIssueResponse, ResolveIssueResponse, SubIssuesResponse } from "./graph-schema.js"
import {
  type GithubIssueConnectionPage,
  type GithubIssueRelation,
  type GithubTargetClosureNode,
  type GithubTargetClosureReadStage,
  readCompleteGithubIssueConnection,
  requireGithubIssueIdentity,
  traverseGithubTargetClosure
} from "./read-primitives.js"
import {
  adapterError,
  decodeResponse,
  githubTarget,
  incomplete,
  operationForRequest,
  resourceLimitExceeded,
  type GithubTrackerGraphReadRequest
} from "./read-boundary.js"
import { githubTaskIdFor, trackerRevisionFor } from "./task-identity.js"
import { makeReadTaskWorkSpecification } from "./task-work-specification-reader.js"
import { type GithubIssueState, type GithubIssueStateReason, githubTaskLifecycleFrom } from "./task-lifecycle.js"

interface IssueProjection {
  readonly id: GithubIssueNodeId
  readonly lifecycle: TaskLifecycle
  readonly parentNodeId: GithubIssueNodeId | null
}

type ExecuteGraphRead = (
  request: GithubTrackerGraphReadRequest
) => Effect.Effect<GithubGraphqlResponse, TrackerAdapterReadError>

const lifecycleFrom = (
  state: GithubIssueState,
  stateReason: GithubIssueStateReason
): Effect.Effect<TaskLifecycle, TrackerAdapterReadError> => {
  const lifecycle = githubTaskLifecycleFrom(state, stateReason)
  return lifecycle === undefined
    ? Effect.fail(
        incomplete(
          "GithubTrackerGraphReader.readIssue",
          `unsupported GitHub issue lifecycle ${state}/${stateReason ?? "null"}`
        )
      )
    : Effect.succeed(lifecycle)
}

const operationForRelation = (relation: GithubIssueRelation): GithubTrackerReadOperation =>
  relation === "blockedBy" ? "GithubTrackerGraphReader.readBlockedBy" : "GithubTrackerGraphReader.readSubIssues"

const operationForClosureStage = (stage: GithubTargetClosureReadStage): GithubTrackerReadOperation =>
  stage === "issue" ? "GithubTrackerGraphReader.readIssue" : operationForRelation(stage)

const requireConnectionPage = (
  operation: GithubTrackerReadOperation,
  issueNodeId: GithubIssueNodeId,
  page: GithubIssueConnectionPage | null
): Effect.Effect<GithubIssueConnectionPage, TrackerAdapterReadError> =>
  page === null
    ? Effect.fail(incomplete(operation, `GitHub issue ${issueNodeId} is inaccessible`))
    : Effect.succeed(page)

const readConnectionPage = Effect.fn("GithubTrackerGraphReader.readConnectionPage")(function* (
  execute: ExecuteGraphRead,
  issueNodeId: GithubIssueNodeId,
  relation: GithubIssueRelation,
  cursor: GithubCursor | null
) {
  const operation = operationForRelation(relation)
  if (relation === "blockedBy") {
    const response = yield* execute(GithubGraphqlRequest.cases.ReadBlockedBy.make({ cursor, issueNodeId }))
    const { data } = yield* decodeResponse(BlockedByResponse, operation, response)
    return yield* requireConnectionPage(
      operation,
      issueNodeId,
      data.node === null ? null : { connection: data.node.blockedBy, issueNodeId: data.node.id }
    )
  }
  const response = yield* execute(GithubGraphqlRequest.cases.ReadSubIssues.make({ cursor, issueNodeId }))
  const { data } = yield* decodeResponse(SubIssuesResponse, operation, response)
  return yield* requireConnectionPage(
    operation,
    issueNodeId,
    data.node === null ? null : { connection: data.node.subIssues, issueNodeId: data.node.id }
  )
})

const readConnection = (
  execute: ExecuteGraphRead,
  issueNodeId: GithubIssueNodeId,
  relation: GithubIssueRelation
): Effect.Effect<ReadonlyArray<GithubIssueNodeId>, TrackerAdapterReadError> => {
  const operation = operationForRelation(relation)
  return readCompleteGithubIssueConnection({
    invalid: (_stage, detail) => Effect.fail(incomplete(operation, detail)),
    issueNodeId,
    readPage: (cursor) => readConnectionPage(execute, issueNodeId, relation, cursor),
    relation,
    resourceLimit: (_stage, detail) => Effect.fail(resourceLimitExceeded(operation, detail))
  })
}

const readIssueProjection = Effect.fn("GithubTrackerGraphReader.readIssueProjection")(function* (
  execute: ExecuteGraphRead,
  repositoryNodeId: GithubRepositoryNodeId,
  issueNodeId: GithubIssueNodeId
) {
  const operation: GithubTrackerReadOperation = "GithubTrackerGraphReader.readIssue"
  const response = yield* execute(GithubGraphqlRequest.cases.ReadIssue.make({ issueNodeId }))
  const decoded = yield* decodeResponse(ReadIssueResponse, operation, response)
  const node = decoded.data.node
  const identity = yield* requireGithubIssueIdentity(
    issueNodeId,
    repositoryNodeId,
    "root",
    node === null
      ? null
      : {
          id: node.id,
          parentNodeId: node.parent?.id ?? null,
          repositoryNodeId: node.repository.id,
          state: node.state,
          stateReason: node.stateReason
        },
    (detail) => Effect.fail(incomplete(operation, detail))
  )
  const lifecycle = yield* lifecycleFrom(identity.state, identity.stateReason)
  return { id: identity.id, lifecycle, parentNodeId: identity.parentNodeId } satisfies IssueProjection
})

const normalizedTasks = (
  nodes: ReadonlyMap<GithubIssueNodeId, GithubTargetClosureNode<IssueProjection>>,
  hierarchyParents: ReadonlyMap<GithubIssueNodeId, GithubIssueNodeId | null>,
  repositoryNodeId: GithubRepositoryNodeId
): ReadonlyArray<TrackerTask> => {
  const taskIds = new Map(
    [...nodes.values()].map(({ issue }) => [issue.id, githubTaskIdFor(repositoryNodeId, issue.id)])
  )
  return [...nodes.values()].map(({ issue, prerequisiteNodeIds }) => {
    const id = Option.getOrThrow(Option.fromUndefinedOr(taskIds.get(issue.id)))
    const parentNodeId = hierarchyParents.get(issue.id) ?? null
    const parentTaskId =
      parentNodeId === null ? null : Option.getOrThrow(Option.fromUndefinedOr(taskIds.get(parentNodeId)))
    const prerequisiteIds = prerequisiteNodeIds.map((prerequisiteNodeId) =>
      Option.getOrThrow(Option.fromUndefinedOr(taskIds.get(prerequisiteNodeId)))
    )
    return { id, lifecycle: issue.lifecycle, parentTaskId, prerequisiteIds }
  })
}

export const githubTrackerGraphReaderLayer: Layer.Layer<TrackerGraphReader, never, GithubGraphqlClient> = Layer.effect(
  TrackerGraphReader,
  Effect.gen(function* () {
    const client = yield* GithubGraphqlClient
    const execute = Effect.fn("GithubTrackerGraphReader.execute")(function* (request: GithubTrackerGraphReadRequest) {
      const operation = operationForRequest(request)
      return yield* client
        .execute(request)
        .pipe(
          Effect.mapError((error) =>
            adapterError(
              operation,
              error._tag === "GithubGraphqlClient.ReadThrottled"
                ? TrackerAdapterReadFailureReason.cases.Throttled.make({})
                : TrackerAdapterReadFailureReason.cases.Transport.make({}),
              error.detail
            )
          )
        )
    })

    const resolveTarget = Effect.fn("GithubTrackerGraphReader.resolveTarget")(function* (target: TrackerTarget) {
      const selectedTarget = yield* githubTarget(target)
      const response = yield* execute(GithubGraphqlRequest.cases.ResolveIssue.make({ target: selectedTarget }))
      const resolved = yield* decodeResponse(ResolveIssueResponse, "GithubTrackerGraphReader.resolveIssue", response)
      if (resolved.data.repository === null || resolved.data.repository.issue === null) {
        return yield* incomplete(
          "GithubTrackerGraphReader.resolveIssue",
          "GitHub repository or root issue is inaccessible"
        )
      }
      return { repositoryNodeId: resolved.data.repository.id, rootIssueNodeId: resolved.data.repository.issue.id }
    })

    /** Produces an all-or-nothing bounded observation, not a GitHub point-in-time transaction. */
    const read = Effect.fn("GithubTrackerGraphReader.read")(function* (target: TrackerTarget) {
      const resolved = yield* resolveTarget(target)
      const traversal = yield* traverseGithubTargetClosure({
        closureDescription: "tracker target closure",
        invalid: (stage, detail) => Effect.fail(incomplete(operationForClosureStage(stage), detail)),
        readConnection: (issueNodeId, relation) => readConnection(execute, issueNodeId, relation),
        readIssue: (issueNodeId) => readIssueProjection(execute, resolved.repositoryNodeId, issueNodeId),
        resourceLimit: (stage, detail) => Effect.fail(resourceLimitExceeded(operationForRelation(stage), detail)),
        rootIssueNodeId: resolved.rootIssueNodeId
      })
      const tasks = normalizedTasks(traversal.nodes, traversal.hierarchyParents, resolved.repositoryNodeId)
      const graph = projectTrackerSnapshot({
        revision: trackerRevisionFor(tasks),
        rootTaskId: githubTaskIdFor(resolved.repositoryNodeId, resolved.rootIssueNodeId),
        tasks
      })
      if (graph._tag === "Invalid") return yield* new GraphProjectionError({ issues: graph.issues })
      return graph.snapshot
    })

    const readTaskWorkSpecification = makeReadTaskWorkSpecification(execute, resolveTarget)
    return TrackerGraphReader.of({ read, readTaskWorkSpecification })
  })
)

export const githubTrackerGraphReaderNodeLayer = githubTrackerGraphReaderLayer.pipe(
  Layer.provide(githubGraphqlClientNodeLayer)
)
