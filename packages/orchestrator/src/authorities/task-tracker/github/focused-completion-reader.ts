/* eslint-disable functional/immutable-data -- Bounded traversal state is private adapter scratch and is never published as authority. */
import { makeTaskWorkSpecification, type TaskId } from "@dalph/contracts"
import { Effect, Option, Schema } from "effect"
import type { CompletionClaimBoundaryService } from "../../../workflow/protocols/integration-finality/completion-claim.js"
import {
  CompletionClaimObservation,
  completionClaimReadRequestFor
} from "../../../workflow/protocols/integration-finality/completion-claim.js"
import {
  FocusedTaskCompletionFacts,
  type FocusedTaskCompletionReadRequest,
  FocusedTaskCompletionReadFailure
} from "../../../workflow/protocols/integration-finality/events.js"
import { TrackerRevision } from "../task.js"
import { TrackerTarget } from "../target.js"
import type {
  GithubCursor,
  GithubGraphqlResponse,
  GithubIssueNodeId,
  GithubRepositoryNodeId,
  GithubGraphqlClient
} from "./graphql-client.js"
import { GithubGraphqlRequest } from "./graphql-client.js"
import {
  BlockedByResponse,
  GraphqlErrorsEnvelope,
  type IssueConnection,
  ReadIssueResponse,
  ReadTaskWorkSpecificationResponse,
  ResolveIssueResponse,
  SubIssuesResponse
} from "./graph-schema.js"
import { githubConnectionPageLimit, githubSnapshotTaskLimit } from "./read-limits.js"
import { decodeGithubTaskId, githubTaskIdFor } from "./task-identity.js"
import { type GithubIssueState, type GithubIssueStateReason, githubTaskLifecycleFrom } from "./task-lifecycle.js"

type FocusedGithubReadRequest = Extract<
  GithubGraphqlRequest,
  { readonly _tag: "ReadBlockedBy" | "ReadIssue" | "ReadSubIssues" | "ReadTaskWorkSpecification" | "ResolveIssue" }
>

interface GithubIssueProjection {
  readonly id: GithubIssueNodeId
  readonly parentNodeId: GithubIssueNodeId | null
  readonly state: GithubIssueState
  readonly stateReason: GithubIssueStateReason
}

interface ResolvedFocusedTarget {
  readonly repositoryNodeId: GithubRepositoryNodeId
  readonly rootIssueNodeId: GithubIssueNodeId
}

type GithubRelation = "blockedBy" | "subIssues"

const FocusedCompletionRevisionContent = Schema.Struct({
  currentClaim: CompletionClaimObservation,
  lifecycle: FocusedTaskCompletionFacts.fields.lifecycle,
  target: TrackerTarget,
  targetMembership: FocusedTaskCompletionFacts.fields.targetMembership,
  taskId: FocusedTaskCompletionFacts.fields.taskId,
  taskRevision: FocusedTaskCompletionFacts.fields.taskRevision,
  unfinishedPrerequisiteTaskIds: FocusedTaskCompletionFacts.fields.unfinishedPrerequisiteTaskIds
})
const CanonicalFocusedCompletionRevisionContent = Schema.fromJsonString(
  Schema.toCodecJson(FocusedCompletionRevisionContent)
)

const focusedFailure = (taskId: TaskId, detail: string): FocusedTaskCompletionReadFailure =>
  new FocusedTaskCompletionReadFailure({ detail, taskId })

const decodeFocusedResponse = <S extends Schema.Constraint>(
  schema: S,
  response: GithubGraphqlResponse,
  request: FocusedTaskCompletionReadRequest
) =>
  Effect.gen(function* () {
    const header = yield* Schema.decodeUnknownEffect(GraphqlErrorsEnvelope)(response.body).pipe(
      Effect.mapError((cause) => focusedFailure(request.taskId, `malformed GitHub response: ${String(cause)}`))
    )
    if (header.errors !== undefined && header.errors.length > 0) {
      return yield* focusedFailure(
        request.taskId,
        `GitHub could not complete the focused read: ${header.errors.map(({ message }) => message).join("; ")}`
      )
    }
    return yield* Schema.decodeUnknownEffect(schema)(response.body).pipe(
      Effect.mapError((cause) => focusedFailure(request.taskId, `malformed GitHub response: ${String(cause)}`))
    )
  })

/** Builds one all-or-nothing GitHub read for exactly the facts needed to complete one task. */
export const makeGithubFocusedTaskCompletionReader = (
  client: GithubGraphqlClient["Service"],
  completionClaims: CompletionClaimBoundaryService
) =>
  Effect.fn("GithubCompletionTask.readFocusedTaskCompletion")(function* (request: FocusedTaskCompletionReadRequest) {
    const execute = Effect.fn("GithubCompletionTask.executeFocusedRead")(function* (
      githubRequest: FocusedGithubReadRequest
    ) {
      return yield* client
        .execute(githubRequest)
        .pipe(Effect.mapError((cause) => focusedFailure(request.taskId, cause.detail)))
    })

    const decode = <S extends Schema.Constraint>(schema: S, response: GithubGraphqlResponse) =>
      decodeFocusedResponse(schema, response, request)

    const resolveTarget = Effect.fn("GithubCompletionTask.resolveTarget")(function* () {
      if (typeof request.target === "string") {
        return yield* focusedFailure(request.taskId, "GitHub completion boundary cannot read a fixture target")
      }
      const response = yield* execute(GithubGraphqlRequest.cases.ResolveIssue.make({ target: request.target }))
      const decoded = yield* decode(ResolveIssueResponse, response)
      const repository = decoded.data.repository
      if (repository === null || repository.issue === null) {
        return yield* focusedFailure(request.taskId, "GitHub target repository or root issue is inaccessible")
      }
      return { repositoryNodeId: repository.id, rootIssueNodeId: repository.issue.id } satisfies ResolvedFocusedTarget
    })

    const target = yield* resolveTarget()
    const taskIdentity = yield* decodeGithubTaskId(request.taskId).pipe(
      Effect.mapError((cause) => focusedFailure(request.taskId, cause.detail))
    )
    if (taskIdentity.repositoryNodeId !== target.repositoryNodeId) {
      return yield* focusedFailure(request.taskId, "GitHub task identity belongs to another repository")
    }

    const projections = new Map<GithubIssueNodeId, GithubIssueProjection>()
    const readIssue = Effect.fn("GithubCompletionTask.readIssue")(function* (issueNodeId: GithubIssueNodeId) {
      const cached = projections.get(issueNodeId)
      if (cached !== undefined) return cached
      const response = yield* execute(GithubGraphqlRequest.cases.ReadIssue.make({ issueNodeId }))
      const decoded = yield* decode(ReadIssueResponse, response)
      const issue = decoded.data.node
      if (issue === null) {
        return yield* focusedFailure(request.taskId, `GitHub issue ${issueNodeId} is inaccessible`)
      }
      if (issue.id !== issueNodeId) {
        return yield* focusedFailure(request.taskId, `GitHub returned issue ${issue.id} while reading ${issueNodeId}`)
      }
      if (issue.repository.id !== target.repositoryNodeId) {
        return yield* focusedFailure(request.taskId, `GitHub issue ${issueNodeId} is outside the target repository`)
      }
      const projection: GithubIssueProjection = {
        id: issue.id,
        parentNodeId: issue.parent?.id ?? null,
        state: issue.state,
        stateReason: issue.stateReason
      }
      projections.set(issueNodeId, projection)
      return projection
    })

    const readConnection = Effect.fn("GithubCompletionTask.readConnection")(function* (
      issueNodeId: GithubIssueNodeId,
      relation: GithubRelation
    ) {
      const readPage = Effect.fn("GithubCompletionTask.readConnectionPage")(function* (
        cursor: GithubCursor | null
      ): Effect.fn.Return<
        { readonly connection: IssueConnection; readonly issueNodeId: GithubIssueNodeId },
        FocusedTaskCompletionReadFailure
      > {
        if (relation === "blockedBy") {
          const response = yield* execute(GithubGraphqlRequest.cases.ReadBlockedBy.make({ cursor, issueNodeId }))
          const decoded = yield* decode(BlockedByResponse, response)
          const node = decoded.data.node
          if (node === null) {
            return yield* focusedFailure(request.taskId, `GitHub issue ${issueNodeId} is inaccessible`)
          }
          return { connection: node.blockedBy, issueNodeId: node.id }
        }
        const response = yield* execute(GithubGraphqlRequest.cases.ReadSubIssues.make({ cursor, issueNodeId }))
        const decoded = yield* decode(SubIssuesResponse, response)
        const node = decoded.data.node
        if (node === null) {
          return yield* focusedFailure(request.taskId, `GitHub issue ${issueNodeId} is inaccessible`)
        }
        return { connection: node.subIssues, issueNodeId: node.id }
      })

      const nodeIds: Array<GithubIssueNodeId> = []
      const seenNodeIds = new Set<GithubIssueNodeId>()
      const seenCursors = new Set<GithubCursor>()
      let cursor: GithubCursor | null = null
      let hasNextPage = true
      let pageCount = 0
      while (hasNextPage) {
        if (pageCount >= githubConnectionPageLimit) {
          return yield* focusedFailure(
            request.taskId,
            `GitHub ${relation} connection exceeds ${githubConnectionPageLimit} pages`
          )
        }
        pageCount += 1
        const page: { readonly connection: IssueConnection; readonly issueNodeId: GithubIssueNodeId } =
          yield* readPage(cursor)
        if (page.issueNodeId !== issueNodeId) {
          return yield* focusedFailure(
            request.taskId,
            `GitHub returned issue ${page.issueNodeId} while reading ${issueNodeId}`
          )
        }
        const connection: IssueConnection = page.connection
        for (const endpoint of connection.nodes) {
          if (seenNodeIds.has(endpoint.id)) {
            return yield* focusedFailure(
              request.taskId,
              `GitHub returned duplicate ${relation} endpoint ${endpoint.id}`
            )
          }
          seenNodeIds.add(endpoint.id)
          nodeIds.push(endpoint.id)
        }
        hasNextPage = connection.pageInfo.hasNextPage
        const endCursor: GithubCursor | null = connection.pageInfo.endCursor
        if (hasNextPage && endCursor === null) {
          return yield* focusedFailure(request.taskId, `GitHub returned an incomplete ${relation} page`)
        }
        if (hasNextPage && endCursor !== null && seenCursors.has(endCursor)) {
          return yield* focusedFailure(
            request.taskId,
            `GitHub repeated a ${relation} pagination cursor without making progress`
          )
        }
        if (endCursor !== null) seenCursors.add(endCursor)
        cursor = endCursor
      }
      return nodeIds
    })

    const readSpecification = Effect.fn("GithubCompletionTask.readSpecification")(function* () {
      const response = yield* execute(
        GithubGraphqlRequest.cases.ReadTaskWorkSpecification.make({ issueNodeId: taskIdentity.issueNodeId })
      )
      const decoded = yield* decode(ReadTaskWorkSpecificationResponse, response)
      const issue = decoded.data.node
      if (issue === null) {
        return yield* focusedFailure(request.taskId, `GitHub issue ${taskIdentity.issueNodeId} is inaccessible`)
      }
      if (issue.id !== taskIdentity.issueNodeId || issue.repository.id !== target.repositoryNodeId) {
        return yield* focusedFailure(
          request.taskId,
          "GitHub task-work specification contradicts the exact task or repository"
        )
      }
      return makeTaskWorkSpecification({ body: issue.body, taskId: request.taskId, title: issue.title })
    })

    const readTargetMembership = Effect.fn("GithubCompletionTask.readTargetMembership")(function* () {
      const pending: Array<{ readonly expandChildren: boolean; readonly issueNodeId: GithubIssueNodeId }> = [
        { expandChildren: true, issueNodeId: target.rootIssueNodeId }
      ]
      const discovered = new Set<GithubIssueNodeId>([target.rootIssueNodeId])
      const expandedPrerequisites = new Set<GithubIssueNodeId>()
      const expandedChildren = new Set<GithubIssueNodeId>()
      const hierarchyParents = new Map<GithubIssueNodeId, GithubIssueNodeId>()

      const register = Effect.fn("GithubCompletionTask.registerMembershipSubjects")(function* (
        issueNodeIds: ReadonlyArray<GithubIssueNodeId>
      ) {
        const additions = issueNodeIds.filter((issueNodeId) => !discovered.has(issueNodeId))
        if (discovered.size + additions.length > githubSnapshotTaskLimit) {
          return yield* focusedFailure(
            request.taskId,
            `GitHub focused membership traversal exceeds ${githubSnapshotTaskLimit} tasks`
          )
        }
        for (const issueNodeId of additions) discovered.add(issueNodeId)
      })

      while (pending.length > 0) {
        const next = Option.getOrThrow(Option.fromUndefinedOr(pending.shift()))
        const issue = yield* readIssue(next.issueNodeId)
        const expectedParent = hierarchyParents.get(next.issueNodeId)
        if (expectedParent !== undefined && issue.parentNodeId !== expectedParent) {
          return yield* focusedFailure(request.taskId, `GitHub issue ${next.issueNodeId} has a contradictory parent`)
        }
        if (next.issueNodeId === taskIdentity.issueNodeId) return "Member" as const

        if (!expandedPrerequisites.has(next.issueNodeId)) {
          expandedPrerequisites.add(next.issueNodeId)
          const prerequisiteNodeIds = yield* readConnection(next.issueNodeId, "blockedBy")
          yield* register(prerequisiteNodeIds)
          pending.push(...prerequisiteNodeIds.map((issueNodeId) => ({ expandChildren: false, issueNodeId })))
        }
        if (next.expandChildren && !expandedChildren.has(next.issueNodeId)) {
          expandedChildren.add(next.issueNodeId)
          const childNodeIds = yield* readConnection(next.issueNodeId, "subIssues")
          yield* register(childNodeIds)
          for (const childNodeId of childNodeIds) {
            const priorParent = hierarchyParents.get(childNodeId)
            if (priorParent !== undefined && priorParent !== next.issueNodeId) {
              return yield* focusedFailure(request.taskId, `GitHub issue ${childNodeId} appears under multiple parents`)
            }
            hierarchyParents.set(childNodeId, next.issueNodeId)
            pending.push({ expandChildren: true, issueNodeId: childNodeId })
          }
        }
      }
      return "NotMember" as const
    })

    const taskIssue = yield* readIssue(taskIdentity.issueNodeId)
    const lifecycle = githubTaskLifecycleFrom(taskIssue.state, taskIssue.stateReason)
    if (lifecycle === undefined) {
      return yield* focusedFailure(
        request.taskId,
        `unsupported GitHub issue lifecycle ${taskIssue.state}/${taskIssue.stateReason ?? "null"}`
      )
    }
    const specification = yield* readSpecification()
    const targetMembership = yield* readTargetMembership()
    const prerequisiteNodeIds = yield* readConnection(taskIdentity.issueNodeId, "blockedBy")
    if (prerequisiteNodeIds.includes(taskIdentity.issueNodeId)) {
      return yield* focusedFailure(request.taskId, "GitHub task cannot be its own prerequisite")
    }
    const unfinishedPrerequisiteTaskIds: Array<TaskId> = []
    for (const prerequisiteNodeId of prerequisiteNodeIds) {
      const prerequisite = yield* readIssue(prerequisiteNodeId)
      const prerequisiteLifecycle = githubTaskLifecycleFrom(prerequisite.state, prerequisite.stateReason)
      if (prerequisiteLifecycle === undefined) {
        return yield* focusedFailure(
          request.taskId,
          `unsupported GitHub prerequisite lifecycle ${prerequisite.state}/${prerequisite.stateReason ?? "null"}`
        )
      }
      if (prerequisiteLifecycle._tag !== "CompletedSuccessfully") {
        unfinishedPrerequisiteTaskIds.push(githubTaskIdFor(target.repositoryNodeId, prerequisiteNodeId))
      }
    }
    unfinishedPrerequisiteTaskIds.sort()
    const currentClaim = yield* completionClaims
      .readTaskClaim(completionClaimReadRequestFor(request.expectedClaim))
      .pipe(Effect.mapError((cause) => focusedFailure(request.taskId, cause.detail)))
    const lifecycleTag = lifecycle._tag
    const revisionContent = {
      currentClaim,
      lifecycle: lifecycleTag,
      target: request.target,
      targetMembership,
      taskId: request.taskId,
      taskRevision: specification.fingerprint,
      unfinishedPrerequisiteTaskIds
    }
    const trackerRevision = yield* Schema.encodeUnknownEffect(CanonicalFocusedCompletionRevisionContent)(
      revisionContent
    ).pipe(Effect.mapError((cause) => focusedFailure(request.taskId, String(cause))))

    return yield* Schema.decodeUnknownEffect(FocusedTaskCompletionFacts)({
      ...revisionContent,
      operationId: request.operationId,
      trackerRevision: TrackerRevision.make(trackerRevision)
    }).pipe(
      Effect.mapError((cause) =>
        focusedFailure(request.taskId, `GitHub returned contradictory focused completion facts: ${String(cause)}`)
      )
    )
  })
