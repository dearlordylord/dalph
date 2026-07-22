/* eslint-disable functional/immutable-data -- Request accumulation is private adapter scratch and never becomes authority. */
import { Effect, Layer, Option, Schema } from "effect"
import { TaskLifecycle } from "./domain.js"
import type { GithubIssueTarget, TaskId, TrackerTarget, TrackerTask } from "./domain.js"
import { GithubGraphqlClient, githubGraphqlClientNodeLayer, GithubGraphqlRequest } from "./github-graphql-client.js"
import type { GithubCursor, GithubGraphqlResponse, GithubIssueNodeId } from "./github-graphql-client.js"
import {
  BlockedByResponse,
  GraphqlErrorsEnvelope,
  type IssueConnection,
  ReadIssueResponse,
  ResolveIssueResponse,
  SubIssuesResponse
} from "./github-task-graph-schema.js"
import { githubTaskIdFor, trackerRevisionFor } from "./github-task-identity.js"
import { githubConnectionPageLimit, githubSnapshotTaskLimit } from "./github-tracker-read-limits.js"
import { GraphProjectionError, projectTrackerSnapshot } from "./task-dag.js"
import {
  type GithubTrackerReadOperation,
  TrackerAdapterReadContext,
  TrackerAdapterReadError,
  TrackerAdapterReadFailureReason,
  TrackerGraphReader
} from "./tracker-graph-reader.js"

interface IssueProjection {
  readonly issueNodeId: GithubIssueNodeId
  readonly lifecycle: TaskLifecycle
  readonly observedParentNodeId: GithubIssueNodeId | null
  readonly prerequisiteNodeIds: ReadonlyArray<GithubIssueNodeId>
}

type GithubTrackerGraphReadRequest = Exclude<
  GithubGraphqlRequest,
  { readonly _tag: "CreateClaimLabel" | "DeleteClaimLabel" | "FindClaimLabel" }
>

const adapterError = (
  operation: GithubTrackerReadOperation,
  reason: TrackerAdapterReadFailureReason,
  detail: string
) =>
  new TrackerAdapterReadError({
    context: TrackerAdapterReadContext.cases.Github.make({ operation }),
    detail,
    reason
  })

const decodeResponse = <S extends Schema.Constraint>(
  schema: S,
  operation: GithubTrackerReadOperation,
  response: GithubGraphqlResponse
) =>
  Effect.gen(function*() {
    const header = yield* Schema.decodeUnknownEffect(GraphqlErrorsEnvelope)(response.body).pipe(
      Effect.mapError((cause) =>
        adapterError(
          operation,
          TrackerAdapterReadFailureReason.cases.BoundaryDecode.make({}),
          String(cause)
        )
      )
    )
    if (header.errors !== undefined && header.errors.length > 0) {
      return yield* adapterError(
        operation,
        TrackerAdapterReadFailureReason.cases.IncompleteSnapshot.make({}),
        header.errors.map(({ message }) => message).join("; ")
      )
    }
    return yield* Schema.decodeUnknownEffect(schema)(response.body).pipe(
      Effect.mapError((cause) =>
        adapterError(
          operation,
          TrackerAdapterReadFailureReason.cases.BoundaryDecode.make({}),
          String(cause)
        )
      )
    )
  })

const incomplete = (
  operation: GithubTrackerReadOperation,
  detail: string
) =>
  adapterError(
    operation,
    TrackerAdapterReadFailureReason.cases.IncompleteSnapshot.make({}),
    detail
  )

const resourceLimitExceeded = (
  operation: GithubTrackerReadOperation,
  detail: string
) =>
  adapterError(
    operation,
    TrackerAdapterReadFailureReason.cases.ResourceLimitExceeded.make({}),
    detail
  )

const lifecycleFrom = (
  state: "CLOSED" | "OPEN",
  stateReason: "COMPLETED" | "DUPLICATE" | "NOT_PLANNED" | "REOPENED" | null
): Effect.Effect<TaskLifecycle, TrackerAdapterReadError> => {
  if (state === "OPEN" && (stateReason === null || stateReason === "REOPENED")) {
    return Effect.succeed(TaskLifecycle.cases.Open.make({}))
  }
  if (state === "CLOSED" && stateReason === "COMPLETED") {
    return Effect.succeed(TaskLifecycle.cases.CompletedSuccessfully.make({}))
  }
  if (state === "CLOSED" && (stateReason === "DUPLICATE" || stateReason === "NOT_PLANNED")) {
    return Effect.succeed(TaskLifecycle.cases.TerminalWithoutSuccess.make({}))
  }
  return Effect.fail(incomplete(
    "GithubTrackerGraphReader.readIssue",
    `unsupported GitHub issue lifecycle ${state}/${stateReason ?? "null"}`
  ))
}

const githubTarget = (
  target: TrackerTarget
): Effect.Effect<GithubIssueTarget, TrackerAdapterReadError> =>
  typeof target === "string"
    ? Effect.fail(adapterError(
      "GithubTrackerGraphReader.selectAdapter",
      TrackerAdapterReadFailureReason.cases.UnsupportedTarget.make({}),
      "GitHub reader cannot read a fixture target"
    ))
    : Effect.succeed(target)

const operationForRequest = (
  request: GithubTrackerGraphReadRequest
): GithubTrackerReadOperation => {
  switch (request._tag) {
    case "ResolveIssue":
      return "GithubTrackerGraphReader.resolveIssue"
    case "ReadIssue":
      return "GithubTrackerGraphReader.readIssue"
    case "ReadSubIssues":
      return "GithubTrackerGraphReader.readSubIssues"
    case "ReadBlockedBy":
      return "GithubTrackerGraphReader.readBlockedBy"
  }
}

export const githubTrackerGraphReaderLayer: Layer.Layer<
  TrackerGraphReader,
  never,
  GithubGraphqlClient
> = Layer.effect(
  TrackerGraphReader,
  Effect.gen(function*() {
    const client = yield* GithubGraphqlClient

    /**
     * Produces an all-or-nothing bounded observation, not a GitHub
     * point-in-time transaction. See docs/ARCHITECTURE.md.
     */
    const read = Effect.fn("GithubTrackerGraphReader.read")(function*(
      target: TrackerTarget
    ) {
      const selectedTarget = yield* githubTarget(target)
      const execute = Effect.fn("GithubTrackerGraphReader.execute")(function*(
        request: GithubTrackerGraphReadRequest
      ) {
        const operation = operationForRequest(request)
        const response = yield* client.execute(request).pipe(
          Effect.mapError((error) =>
            adapterError(
              operation,
              TrackerAdapterReadFailureReason.cases.Transport.make({}),
              error.detail
            )
          )
        )
        return response
      })

      const resolvedResponse = yield* execute(
        GithubGraphqlRequest.cases.ResolveIssue.make({ target: selectedTarget })
      )
      const resolved = yield* decodeResponse(
        ResolveIssueResponse,
        "GithubTrackerGraphReader.resolveIssue",
        resolvedResponse
      )
      if (resolved.data.repository === null || resolved.data.repository.issue === null) {
        return yield* incomplete(
          "GithubTrackerGraphReader.resolveIssue",
          "GitHub repository or root issue is inaccessible"
        )
      }

      const rootNodeId = resolved.data.repository.issue.id
      const rootRepositoryNodeId = resolved.data.repository.id
      const pending: Array<{ readonly expandChildren: boolean; readonly issueNodeId: GithubIssueNodeId }> = [
        { expandChildren: true, issueNodeId: rootNodeId }
      ]
      const hierarchyParents = new Map<GithubIssueNodeId, GithubIssueNodeId | null>([[rootNodeId, null]])
      const projections = new Map<GithubIssueNodeId, IssueProjection>()
      const expandedChildren = new Set<GithubIssueNodeId>()
      const discoveredNodeIds = new Set<GithubIssueNodeId>([rootNodeId])

      const registerDiscovered = Effect.fn("GithubTrackerGraphReader.registerDiscovered")(
        function*(operation: GithubTrackerReadOperation, nodeIds: ReadonlyArray<GithubIssueNodeId>) {
          const undiscoveredCount = nodeIds.filter((nodeId) => !discoveredNodeIds.has(nodeId)).length
          if (discoveredNodeIds.size + undiscoveredCount > githubSnapshotTaskLimit) {
            return yield* resourceLimitExceeded(
              operation,
              `GitHub tracker target closure exceeds ${githubSnapshotTaskLimit} tasks`
            )
          }
          for (const nodeId of nodeIds) discoveredNodeIds.add(nodeId)
        }
      )

      const readConnection = Effect.fn("GithubTrackerGraphReader.readConnection")(function*(
        issueNodeId: GithubIssueNodeId,
        relation: "blockedBy" | "subIssues"
      ) {
        const nodeIds: Array<GithubIssueNodeId> = []
        const seenCursors = new Set<GithubCursor>()
        const seenNodeIds = new Set<GithubIssueNodeId>()
        let cursor: GithubCursor | null = null
        let hasNextPage = true
        let pageCount = 0
        const operation: GithubTrackerReadOperation = relation === "subIssues"
          ? "GithubTrackerGraphReader.readSubIssues"
          : "GithubTrackerGraphReader.readBlockedBy"
        while (hasNextPage) {
          if (pageCount >= githubConnectionPageLimit) {
            return yield* resourceLimitExceeded(
              operation,
              `GitHub ${relation} connection exceeds ${githubConnectionPageLimit} pages`
            )
          }
          pageCount++
          const request: GithubGraphqlRequest = relation === "subIssues"
            ? GithubGraphqlRequest.cases.ReadSubIssues.make({ cursor, issueNodeId })
            : GithubGraphqlRequest.cases.ReadBlockedBy.make({ cursor, issueNodeId })
          const response: GithubGraphqlResponse = yield* execute(request)
          const relationNode = relation === "subIssues"
            ? yield* decodeResponse(SubIssuesResponse, operation, response).pipe(
              Effect.flatMap(({ data }) =>
                data.node === null
                  ? Effect.fail(incomplete(operation, `GitHub issue ${issueNodeId} is inaccessible`))
                  : Effect.succeed({ connection: data.node.subIssues, id: data.node.id })
              )
            )
            : yield* decodeResponse(BlockedByResponse, operation, response).pipe(
              Effect.flatMap(({ data }) =>
                data.node === null
                  ? Effect.fail(incomplete(operation, `GitHub issue ${issueNodeId} is inaccessible`))
                  : Effect.succeed({ connection: data.node.blockedBy, id: data.node.id })
              )
            )
          if (relationNode.id !== issueNodeId) {
            return yield* incomplete(
              operation,
              `GitHub returned issue ${relationNode.id} while reading ${issueNodeId}`
            )
          }
          const connection: IssueConnection = relationNode.connection
          for (const { id } of connection.nodes) {
            if (seenNodeIds.has(id)) {
              return yield* incomplete(
                operation,
                `GitHub returned duplicate ${relation} endpoint ${id}`
              )
            }
            seenNodeIds.add(id)
            nodeIds.push(id)
          }
          hasNextPage = connection.pageInfo.hasNextPage
          if (hasNextPage && connection.pageInfo.endCursor === null) {
            return yield* incomplete(operation, `GitHub returned an incomplete ${relation} page`)
          }
          if (
            hasNextPage
            && connection.pageInfo.endCursor !== null
            && seenCursors.has(connection.pageInfo.endCursor)
          ) {
            return yield* incomplete(
              operation,
              `GitHub repeated a ${relation} pagination cursor without making progress`
            )
          }
          if (hasNextPage && connection.pageInfo.endCursor !== null) {
            seenCursors.add(connection.pageInfo.endCursor)
          }
          cursor = connection.pageInfo.endCursor
        }
        return nodeIds
      })

      while (pending.length > 0) {
        const next = Option.getOrThrow(Option.fromUndefinedOr(pending.shift()))
        const { expandChildren, issueNodeId } = next

        if (!projections.has(issueNodeId)) {
          const issueResponse = yield* execute(
            GithubGraphqlRequest.cases.ReadIssue.make({ issueNodeId })
          )
          const decoded = yield* decodeResponse(
            ReadIssueResponse,
            "GithubTrackerGraphReader.readIssue",
            issueResponse
          )
          const node = decoded.data.node
          if (node === null) {
            return yield* incomplete(
              "GithubTrackerGraphReader.readIssue",
              `GitHub issue ${issueNodeId} is inaccessible`
            )
          }
          if (node.id !== issueNodeId) {
            return yield* incomplete(
              "GithubTrackerGraphReader.readIssue",
              `GitHub returned issue ${node.id} while reading ${issueNodeId}`
            )
          }
          // Cross-repository closure policy is revisited by:
          // https://github.com/dearlordylord/dalph/issues/71
          if (node.repository.id !== rootRepositoryNodeId) {
            return yield* incomplete(
              "GithubTrackerGraphReader.readIssue",
              `GitHub issue ${issueNodeId} is outside the root repository`
            )
          }
          const expectedParent = hierarchyParents.get(issueNodeId)
          if (
            expectedParent !== undefined
            && expectedParent !== null
            && node.parent?.id !== expectedParent
          ) {
            return yield* incomplete(
              "GithubTrackerGraphReader.readIssue",
              `GitHub issue ${issueNodeId} has a contradictory parent`
            )
          }
          const lifecycle = yield* lifecycleFrom(node.state, node.stateReason)
          const prerequisiteNodeIds = yield* readConnection(issueNodeId, "blockedBy")
          yield* registerDiscovered(
            "GithubTrackerGraphReader.readBlockedBy",
            prerequisiteNodeIds
          )
          projections.set(issueNodeId, {
            issueNodeId,
            lifecycle,
            observedParentNodeId: node.parent?.id ?? null,
            prerequisiteNodeIds
          })
          // Prerequisites enter the target closure, but their grouping
          // descendants do not unless reached from the selected root hierarchy.
          pending.push(...prerequisiteNodeIds.map((prerequisiteNodeId) => ({
            expandChildren: false,
            issueNodeId: prerequisiteNodeId
          })))
        }

        if (expandChildren && !expandedChildren.has(issueNodeId)) {
          expandedChildren.add(issueNodeId)
          const childNodeIds = yield* readConnection(issueNodeId, "subIssues")
          yield* registerDiscovered("GithubTrackerGraphReader.readSubIssues", childNodeIds)
          for (const childNodeId of childNodeIds) {
            const observedChild = projections.get(childNodeId)
            if (
              observedChild !== undefined
              && observedChild.observedParentNodeId !== issueNodeId
            ) {
              return yield* incomplete(
                "GithubTrackerGraphReader.readSubIssues",
                `GitHub issue ${childNodeId} has a contradictory parent`
              )
            }
            const knownParent = hierarchyParents.get(childNodeId)
            if (knownParent !== undefined && knownParent !== issueNodeId) {
              return yield* incomplete(
                "GithubTrackerGraphReader.readSubIssues",
                `GitHub issue ${childNodeId} appears under multiple parents`
              )
            }
            hierarchyParents.set(childNodeId, issueNodeId)
            pending.push({ expandChildren: true, issueNodeId: childNodeId })
          }
        }
      }

      const taskIds = new Map<GithubIssueNodeId, TaskId>()
      for (const projection of projections.values()) {
        taskIds.set(
          projection.issueNodeId,
          githubTaskIdFor(rootRepositoryNodeId, projection.issueNodeId)
        )
      }
      const tasks: Array<TrackerTask> = []
      for (const projection of projections.values()) {
        const id = Option.getOrThrow(Option.fromUndefinedOr(taskIds.get(projection.issueNodeId)))
        const parentNodeId = hierarchyParents.get(projection.issueNodeId) ?? null
        const parentTaskId = parentNodeId === null
          ? null
          : Option.getOrThrow(Option.fromUndefinedOr(taskIds.get(parentNodeId)))
        const prerequisiteIds: Array<TaskId> = []
        for (const prerequisiteNodeId of projection.prerequisiteNodeIds) {
          const prerequisiteId = Option.getOrThrow(
            Option.fromUndefinedOr(taskIds.get(prerequisiteNodeId))
          )
          prerequisiteIds.push(prerequisiteId)
        }
        tasks.push({
          id,
          lifecycle: projection.lifecycle,
          parentTaskId,
          prerequisiteIds
        })
      }

      const graph = projectTrackerSnapshot({
        revision: trackerRevisionFor(tasks),
        tasks
      })
      if (graph._tag === "Invalid") {
        return yield* new GraphProjectionError({ issues: graph.issues })
      }
      return graph.snapshot
    })

    return TrackerGraphReader.of({ read })
  })
)

export const githubTrackerGraphReaderNodeLayer = githubTrackerGraphReaderLayer.pipe(
  Layer.provide(githubGraphqlClientNodeLayer)
)
