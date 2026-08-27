/* eslint-disable functional/immutable-data -- Request accumulation is private adapter scratch and never becomes authority. */
import { Effect, Layer, Option } from "effect"
import { TaskLifecycle } from "../task.js"
import { type TrackerTask } from "../task.js"
import { type TrackerTarget } from "../target.js"
import { GithubGraphqlClient, githubGraphqlClientNodeLayer, GithubGraphqlRequest } from "./graphql-client.js"
import type { GithubCursor, GithubGraphqlResponse, GithubIssueNodeId } from "./graphql-client.js"
import {
  BlockedByResponse,
  type IssueConnection,
  ReadIssueResponse,
  ResolveIssueResponse,
  SubIssuesResponse
} from "./graph-schema.js"
import { githubTaskIdFor, trackerRevisionFor } from "./task-identity.js"
import { githubConnectionPageLimit, githubSnapshotTaskLimit } from "./read-limits.js"
import { GraphProjectionError, projectTrackerSnapshot } from "../graph.js"
import {
  type GithubTrackerReadOperation,
  type TrackerAdapterReadError,
  TrackerAdapterReadFailureReason,
  TrackerGraphReader
} from "../graph-reader.js"
import {
  adapterError,
  decodeResponse,
  githubTarget,
  incomplete,
  operationForRequest,
  resourceLimitExceeded,
  type GithubTrackerGraphReadRequest
} from "./read-boundary.js"
import { makeReadTaskWorkSpecification } from "./task-work-specification-reader.js"

interface IssueProjection {
  readonly issueNodeId: GithubIssueNodeId
  readonly lifecycle: TaskLifecycle
  readonly observedParentNodeId: GithubIssueNodeId | null
  readonly prerequisiteNodeIds: ReadonlyArray<GithubIssueNodeId>
}

const isOpenLifecycle = (
  state: "CLOSED" | "OPEN",
  stateReason: "COMPLETED" | "DUPLICATE" | "NOT_PLANNED" | "REOPENED" | null
): boolean => state === "OPEN" && (stateReason === null || stateReason === "REOPENED")

const isCompletedLifecycle = (
  state: "CLOSED" | "OPEN",
  stateReason: "COMPLETED" | "DUPLICATE" | "NOT_PLANNED" | "REOPENED" | null
): boolean => state === "CLOSED" && stateReason === "COMPLETED"

const isTerminalWithoutSuccessLifecycle = (
  state: "CLOSED" | "OPEN",
  stateReason: "COMPLETED" | "DUPLICATE" | "NOT_PLANNED" | "REOPENED" | null
): boolean => state === "CLOSED" && (stateReason === "DUPLICATE" || stateReason === "NOT_PLANNED")

const lifecycleFrom = (
  state: "CLOSED" | "OPEN",
  stateReason: "COMPLETED" | "DUPLICATE" | "NOT_PLANNED" | "REOPENED" | null
): Effect.Effect<TaskLifecycle, TrackerAdapterReadError> => {
  if (isOpenLifecycle(state, stateReason)) {
    return Effect.succeed(TaskLifecycle.cases.Open.make({}))
  }
  if (isCompletedLifecycle(state, stateReason)) {
    return Effect.succeed(TaskLifecycle.cases.CompletedSuccessfully.make({}))
  }
  if (isTerminalWithoutSuccessLifecycle(state, stateReason)) {
    return Effect.succeed(TaskLifecycle.cases.TerminalWithoutSuccess.make({}))
  }
  return Effect.fail(
    incomplete(
      "GithubTrackerGraphReader.readIssue",
      `unsupported GitHub issue lifecycle ${state}/${stateReason ?? "null"}`
    )
  )
}

export const githubTrackerGraphReaderLayer: Layer.Layer<TrackerGraphReader, never, GithubGraphqlClient> = Layer.effect(
  TrackerGraphReader,
  Effect.gen(function* () {
    const client = yield* GithubGraphqlClient
    const execute = Effect.fn("GithubTrackerGraphReader.execute")(function* (request: GithubTrackerGraphReadRequest) {
      const operation = operationForRequest(request)
      const response = yield* client
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
      return response
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

    /**
     * Produces an all-or-nothing bounded observation, not a GitHub
     * point-in-time transaction. See docs/ARCHITECTURE.md.
     */
    const read = Effect.fn("GithubTrackerGraphReader.read")(function* (target: TrackerTarget) {
      const { repositoryNodeId: rootRepositoryNodeId, rootIssueNodeId: rootNodeId } = yield* resolveTarget(target)
      const pending: Array<{ readonly expandChildren: boolean; readonly issueNodeId: GithubIssueNodeId }> = [
        { expandChildren: true, issueNodeId: rootNodeId }
      ]
      const hierarchyParents = new Map<GithubIssueNodeId, GithubIssueNodeId | null>([[rootNodeId, null]])
      const projections = new Map<GithubIssueNodeId, IssueProjection>()
      const expandedChildren = new Set<GithubIssueNodeId>()
      const discoveredNodeIds = new Set<GithubIssueNodeId>([rootNodeId])

      const registerDiscovered = Effect.fn("GithubTrackerGraphReader.registerDiscovered")(function* (
        operation: GithubTrackerReadOperation,
        nodeIds: ReadonlyArray<GithubIssueNodeId>
      ) {
        const undiscoveredCount = nodeIds.filter((nodeId) => !discoveredNodeIds.has(nodeId)).length
        if (discoveredNodeIds.size + undiscoveredCount > githubSnapshotTaskLimit) {
          return yield* resourceLimitExceeded(
            operation,
            `GitHub tracker target closure exceeds ${githubSnapshotTaskLimit} tasks`
          )
        }
        for (const nodeId of nodeIds) discoveredNodeIds.add(nodeId)
      })

      const decodeSubIssuesConnection = Effect.fn("GithubTrackerGraphReader.decodeSubIssuesConnection")(function* (
        operation: GithubTrackerReadOperation,
        response: GithubGraphqlResponse,
        issueNodeId: GithubIssueNodeId
      ) {
        const { data } = yield* decodeResponse(SubIssuesResponse, operation, response)
        return yield* requireConnectionNode(
          operation,
          issueNodeId,
          data.node === null ? null : { connection: data.node.subIssues, id: data.node.id }
        )
      })

      const decodeBlockedByConnection = Effect.fn("GithubTrackerGraphReader.decodeBlockedByConnection")(function* (
        operation: GithubTrackerReadOperation,
        response: GithubGraphqlResponse,
        issueNodeId: GithubIssueNodeId
      ) {
        const { data } = yield* decodeResponse(BlockedByResponse, operation, response)
        return yield* requireConnectionNode(
          operation,
          issueNodeId,
          data.node === null ? null : { connection: data.node.blockedBy, id: data.node.id }
        )
      })

      const requireConnectionNode = Effect.fn("GithubTrackerGraphReader.requireConnectionNode")(function* (
        operation: GithubTrackerReadOperation,
        issueNodeId: GithubIssueNodeId,
        node: { readonly connection: IssueConnection; readonly id: GithubIssueNodeId } | null
      ) {
        if (node === null) {
          return yield* incomplete(operation, `GitHub issue ${issueNodeId} is inaccessible`)
        }
        return node
      })

      const connectionProtocolFor = (relation: "blockedBy" | "subIssues", issueNodeId: GithubIssueNodeId) => {
        if (relation === "subIssues") {
          const operation: GithubTrackerReadOperation = "GithubTrackerGraphReader.readSubIssues"
          return {
            decode: decodeSubIssuesConnection,
            operation,
            request: (cursor: GithubCursor | null): GithubTrackerGraphReadRequest =>
              GithubGraphqlRequest.cases.ReadSubIssues.make({ cursor, issueNodeId })
          }
        }
        const operation: GithubTrackerReadOperation = "GithubTrackerGraphReader.readBlockedBy"
        return {
          decode: decodeBlockedByConnection,
          operation,
          request: (cursor: GithubCursor | null): GithubTrackerGraphReadRequest =>
            GithubGraphqlRequest.cases.ReadBlockedBy.make({ cursor, issueNodeId })
        }
      }

      const appendUniqueConnectionNodes = Effect.fn("GithubTrackerGraphReader.appendUniqueConnectionNodes")(function* (
        connection: IssueConnection,
        relation: "blockedBy" | "subIssues",
        operation: GithubTrackerReadOperation,
        seenNodeIds: Set<GithubIssueNodeId>,
        nodeIds: Array<GithubIssueNodeId>
      ) {
        for (const { id } of connection.nodes) {
          if (seenNodeIds.has(id)) {
            return yield* incomplete(operation, `GitHub returned duplicate ${relation} endpoint ${id}`)
          }
          seenNodeIds.add(id)
          nodeIds.push(id)
        }
      })

      const validateNextConnectionPage = Effect.fn("GithubTrackerGraphReader.validateNextConnectionPage")(function* (
        connection: IssueConnection,
        relation: "blockedBy" | "subIssues",
        operation: GithubTrackerReadOperation,
        seenCursors: Set<GithubCursor>
      ) {
        if (!connection.pageInfo.hasNextPage) return
        const endCursor = connection.pageInfo.endCursor
        if (endCursor === null) {
          return yield* incomplete(operation, `GitHub returned an incomplete ${relation} page`)
        }
        if (seenCursors.has(endCursor)) {
          return yield* incomplete(operation, `GitHub repeated a ${relation} pagination cursor without making progress`)
        }
        seenCursors.add(endCursor)
      })

      const readConnection = Effect.fn("GithubTrackerGraphReader.readConnection")(function* (
        issueNodeId: GithubIssueNodeId,
        relation: "blockedBy" | "subIssues"
      ) {
        const nodeIds: Array<GithubIssueNodeId> = []
        const seenCursors = new Set<GithubCursor>()
        const seenNodeIds = new Set<GithubIssueNodeId>()
        let cursor: GithubCursor | null = null
        let hasNextPage = true
        let pageCount = 0
        const protocol = connectionProtocolFor(relation, issueNodeId)
        while (hasNextPage) {
          if (pageCount >= githubConnectionPageLimit) {
            return yield* resourceLimitExceeded(
              protocol.operation,
              `GitHub ${relation} connection exceeds ${githubConnectionPageLimit} pages`
            )
          }
          pageCount++
          const response: GithubGraphqlResponse = yield* execute(protocol.request(cursor))
          const relationNode = yield* protocol.decode(protocol.operation, response, issueNodeId)
          if (relationNode.id !== issueNodeId) {
            return yield* incomplete(
              protocol.operation,
              `GitHub returned issue ${relationNode.id} while reading ${issueNodeId}`
            )
          }
          const connection: IssueConnection = relationNode.connection
          yield* appendUniqueConnectionNodes(connection, relation, protocol.operation, seenNodeIds, nodeIds)
          hasNextPage = connection.pageInfo.hasNextPage
          yield* validateNextConnectionPage(connection, relation, protocol.operation, seenCursors)
          cursor = connection.pageInfo.endCursor
        }
        return nodeIds
      })

      const readIssueProjection = Effect.fn("GithubTrackerGraphReader.readIssueProjection")(function* (
        issueNodeId: GithubIssueNodeId
      ) {
        const issueResponse = yield* execute(GithubGraphqlRequest.cases.ReadIssue.make({ issueNodeId }))
        const decoded = yield* decodeResponse(ReadIssueResponse, "GithubTrackerGraphReader.readIssue", issueResponse)
        const node = decoded.data.node
        if (node === null) {
          return yield* incomplete("GithubTrackerGraphReader.readIssue", `GitHub issue ${issueNodeId} is inaccessible`)
        }
        if (node.id !== issueNodeId) {
          return yield* incomplete(
            "GithubTrackerGraphReader.readIssue",
            `GitHub returned issue ${node.id} while reading ${issueNodeId}`
          )
        }
        // V1 target closure policy accepts only issues from the resolved root
        // repository; a foreign relationship is not schedulable.
        if (node.repository.id !== rootRepositoryNodeId) {
          return yield* incomplete(
            "GithubTrackerGraphReader.readIssue",
            `GitHub issue ${issueNodeId} is outside the root repository`
          )
        }
        const expectedParent = hierarchyParents.get(issueNodeId)
        const parentContradictsHierarchy = (): boolean =>
          expectedParent !== undefined && expectedParent !== null && node.parent?.id !== expectedParent
        if (parentContradictsHierarchy()) {
          return yield* incomplete(
            "GithubTrackerGraphReader.readIssue",
            `GitHub issue ${issueNodeId} has a contradictory parent`
          )
        }
        const lifecycle = yield* lifecycleFrom(node.state, node.stateReason)
        const prerequisiteNodeIds = yield* readConnection(issueNodeId, "blockedBy")
        yield* registerDiscovered("GithubTrackerGraphReader.readBlockedBy", prerequisiteNodeIds)
        projections.set(issueNodeId, {
          issueNodeId,
          lifecycle,
          observedParentNodeId: node.parent?.id ?? null,
          prerequisiteNodeIds
        })
        // Prerequisites enter the target closure, but their grouping
        // descendants do not unless reached from the selected root hierarchy.
        pending.push(
          ...prerequisiteNodeIds.map((prerequisiteNodeId) => ({
            expandChildren: false,
            issueNodeId: prerequisiteNodeId
          }))
        )
      })

      const validateChildParent = Effect.fn("GithubTrackerGraphReader.validateChildParent")(function* (
        childNodeId: GithubIssueNodeId,
        issueNodeId: GithubIssueNodeId
      ) {
        const observedChild = projections.get(childNodeId)
        if (observedChild !== undefined && observedChild.observedParentNodeId !== issueNodeId) {
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
      })

      const expandIssueChildren = Effect.fn("GithubTrackerGraphReader.expandIssueChildren")(function* (
        expandChildren: boolean,
        issueNodeId: GithubIssueNodeId
      ) {
        if (!expandChildren || expandedChildren.has(issueNodeId)) return
        expandedChildren.add(issueNodeId)
        const childNodeIds = yield* readConnection(issueNodeId, "subIssues")
        yield* registerDiscovered("GithubTrackerGraphReader.readSubIssues", childNodeIds)
        for (const childNodeId of childNodeIds) {
          yield* validateChildParent(childNodeId, issueNodeId)
          hierarchyParents.set(childNodeId, issueNodeId)
          pending.push({ expandChildren: true, issueNodeId: childNodeId })
        }
      })

      const normalizedTasks = (): ReadonlyArray<TrackerTask> => {
        const taskIds = new Map(
          [...projections.values()].map((projection) => [
            projection.issueNodeId,
            githubTaskIdFor(rootRepositoryNodeId, projection.issueNodeId)
          ])
        )
        return [...projections.values()].map((projection) => {
          const id = Option.getOrThrow(Option.fromUndefinedOr(taskIds.get(projection.issueNodeId)))
          const parentNodeId = hierarchyParents.get(projection.issueNodeId) ?? null
          const parentTaskId =
            parentNodeId === null ? null : Option.getOrThrow(Option.fromUndefinedOr(taskIds.get(parentNodeId)))
          const prerequisiteIds = projection.prerequisiteNodeIds.map((prerequisiteNodeId) =>
            Option.getOrThrow(Option.fromUndefinedOr(taskIds.get(prerequisiteNodeId)))
          )
          return { id, lifecycle: projection.lifecycle, parentTaskId, prerequisiteIds }
        })
      }

      while (pending.length > 0) {
        const next = Option.getOrThrow(Option.fromUndefinedOr(pending.shift()))
        const { expandChildren, issueNodeId } = next

        if (!projections.has(issueNodeId)) {
          yield* readIssueProjection(issueNodeId)
        }
        yield* expandIssueChildren(expandChildren, issueNodeId)
      }

      const tasks = normalizedTasks()

      const graph = projectTrackerSnapshot({
        revision: trackerRevisionFor(tasks),
        rootTaskId: githubTaskIdFor(rootRepositoryNodeId, rootNodeId),
        tasks
      })
      if (graph._tag === "Invalid") {
        return yield* new GraphProjectionError({ issues: graph.issues })
      }
      return graph.snapshot
    })

    const readTaskWorkSpecification = makeReadTaskWorkSpecification(execute, resolveTarget)

    return TrackerGraphReader.of({ read, readTaskWorkSpecification })
  })
)

export const githubTrackerGraphReaderNodeLayer = githubTrackerGraphReaderLayer.pipe(
  Layer.provide(githubGraphqlClientNodeLayer)
)
