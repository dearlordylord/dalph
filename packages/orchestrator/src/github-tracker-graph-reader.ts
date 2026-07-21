/* eslint-disable functional/immutable-data -- Request accumulation is private adapter scratch and never becomes authority. */
import { Effect, Layer, Option, Schema } from "effect"
import {
  type GithubIssueTarget,
  TaskId,
  TaskLifecycle,
  TrackerRevision,
  type TrackerTarget,
  type TrackerTask
} from "./domain.js"
import {
  GithubCursor,
  GithubGraphqlClient,
  githubGraphqlClientNodeLayer,
  GithubGraphqlRequest,
  type GithubGraphqlResponse,
  GithubIssueNodeId,
  GithubRepositoryNodeId,
  type GithubRequestId
} from "./github-graphql-client.js"
import { GraphProjectionError, projectTrackerSnapshot } from "./task-dag.js"
import {
  type GithubTrackerReadOperation,
  TrackerAdapterReadContext,
  TrackerAdapterReadError,
  TrackerAdapterReadFailureReason,
  TrackerGraphReader
} from "./tracker-graph-reader.js"

const GraphqlError = Schema.Struct({ message: Schema.String })
const GraphqlErrorsEnvelope = Schema.Struct({
  errors: Schema.optionalKey(Schema.Array(GraphqlError))
})

const NodeReference = Schema.Struct({ id: GithubIssueNodeId })
const RepositoryReference = Schema.Struct({ id: GithubRepositoryNodeId })
const PageInfo = Schema.Struct({
  endCursor: Schema.NullOr(GithubCursor),
  hasNextPage: Schema.Boolean
})
const IssueConnection = Schema.Struct({
  nodes: Schema.Array(NodeReference),
  pageInfo: PageInfo
})
type IssueConnection = typeof IssueConnection.Type
const ResolveIssueResponse = Schema.Struct({
  data: Schema.Struct({
    repository: Schema.NullOr(Schema.Struct({
      id: GithubRepositoryNodeId,
      issue: Schema.NullOr(NodeReference)
    }))
  })
})
const ReadIssueResponse = Schema.Struct({
  data: Schema.Struct({
    node: Schema.NullOr(Schema.Struct({
      __typename: Schema.Literal("Issue"),
      id: GithubIssueNodeId,
      parent: Schema.NullOr(NodeReference),
      repository: RepositoryReference,
      state: Schema.Literals(["CLOSED", "OPEN"]),
      stateReason: Schema.NullOr(
        Schema.Literals(["COMPLETED", "DUPLICATE", "NOT_PLANNED", "REOPENED"])
      )
    }))
  })
})
const SubIssuesResponse = Schema.Struct({
  data: Schema.Struct({
    node: Schema.NullOr(Schema.Struct({
      __typename: Schema.Literal("Issue"),
      subIssues: IssueConnection
    }))
  })
})
const BlockedByResponse = Schema.Struct({
  data: Schema.Struct({
    node: Schema.NullOr(Schema.Struct({
      __typename: Schema.Literal("Issue"),
      blockedBy: IssueConnection
    }))
  })
})

interface IssueProjection {
  readonly issueNodeId: GithubIssueNodeId
  readonly lifecycle: TaskLifecycle
  readonly observedParentNodeId: GithubIssueNodeId | null
  readonly prerequisiteNodeIds: ReadonlyArray<GithubIssueNodeId>
  readonly repositoryNodeId: GithubRepositoryNodeId
}

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

const taskIdFor = (
  repositoryNodeId: GithubRepositoryNodeId,
  issueNodeId: GithubIssueNodeId
): TaskId => TaskId.make(JSON.stringify([repositoryNodeId, issueNodeId]))

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
  request: GithubGraphqlRequest
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

    const read = Effect.fn("GithubTrackerGraphReader.read")(function*(
      target: TrackerTarget
    ) {
      const selectedTarget = yield* githubTarget(target)
      const requestIds: Array<GithubRequestId> = []
      const execute = Effect.fn("GithubTrackerGraphReader.execute")(function*(
        request: GithubGraphqlRequest
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
        requestIds.push(response.requestId)
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
      const pending: Array<{ readonly expandChildren: boolean; readonly issueNodeId: GithubIssueNodeId }> = [
        { expandChildren: true, issueNodeId: rootNodeId }
      ]
      const hierarchyParents = new Map<GithubIssueNodeId, GithubIssueNodeId | null>([[rootNodeId, null]])
      const projections = new Map<GithubIssueNodeId, IssueProjection>()
      const expandedChildren = new Set<GithubIssueNodeId>()

      const readConnection = Effect.fn("GithubTrackerGraphReader.readConnection")(function*(
        issueNodeId: GithubIssueNodeId,
        relation: "blockedBy" | "subIssues"
      ) {
        const nodeIds: Array<GithubIssueNodeId> = []
        const seenCursors = new Set<GithubCursor>()
        const seenNodeIds = new Set<GithubIssueNodeId>()
        let cursor: GithubCursor | null = null
        let hasNextPage = true
        while (hasNextPage) {
          const request: GithubGraphqlRequest = relation === "subIssues"
            ? GithubGraphqlRequest.cases.ReadSubIssues.make({ cursor, issueNodeId })
            : GithubGraphqlRequest.cases.ReadBlockedBy.make({ cursor, issueNodeId })
          const response: GithubGraphqlResponse = yield* execute(request)
          const operation: GithubTrackerReadOperation = relation === "subIssues"
            ? "GithubTrackerGraphReader.readSubIssues"
            : "GithubTrackerGraphReader.readBlockedBy"
          const connection: IssueConnection = relation === "subIssues"
            ? yield* decodeResponse(SubIssuesResponse, operation, response).pipe(
              Effect.flatMap(({ data }) =>
                data.node === null
                  ? Effect.fail(incomplete(operation, `GitHub issue ${issueNodeId} is inaccessible`))
                  : Effect.succeed(data.node.subIssues)
              )
            )
            : yield* decodeResponse(BlockedByResponse, operation, response).pipe(
              Effect.flatMap(({ data }) =>
                data.node === null
                  ? Effect.fail(incomplete(operation, `GitHub issue ${issueNodeId} is inaccessible`))
                  : Effect.succeed(data.node.blockedBy)
              )
            )
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
          projections.set(issueNodeId, {
            issueNodeId,
            lifecycle,
            observedParentNodeId: node.parent?.id ?? null,
            prerequisiteNodeIds,
            repositoryNodeId: node.repository.id
          })
          pending.push(...prerequisiteNodeIds.map((prerequisiteNodeId) => ({
            expandChildren: false,
            issueNodeId: prerequisiteNodeId
          })))
        }

        if (expandChildren && !expandedChildren.has(issueNodeId)) {
          expandedChildren.add(issueNodeId)
          const childNodeIds = yield* readConnection(issueNodeId, "subIssues")
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
          taskIdFor(projection.repositoryNodeId, projection.issueNodeId)
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
        revision: TrackerRevision.make(JSON.stringify(requestIds)),
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
