/* eslint-disable functional/immutable-data -- Cached projections are private adapter scratch and never become authority. */
import { makeTaskWorkSpecification, type TaskId } from "@dalph/contracts"
import { Effect, Schema } from "effect"
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
  GithubGraphqlClient,
  GithubGraphqlResponse,
  GithubIssueNodeId,
  GithubRepositoryNodeId
} from "./graphql-client.js"
import { GithubGraphqlRequest } from "./graphql-client.js"
import {
  BlockedByResponse,
  GraphqlErrorsEnvelope,
  ReadIssueResponse,
  ReadTaskWorkSpecificationResponse,
  ResolveIssueResponse,
  SubIssuesResponse
} from "./graph-schema.js"
import {
  type GithubIssueConnectionPage,
  type GithubIssueRelation,
  readCompleteGithubIssueConnection,
  requireGithubIssueIdentity,
  traverseGithubTargetClosure
} from "./read-primitives.js"
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

interface ResolvedFocusedTask {
  readonly issueNodeId: GithubIssueNodeId
  readonly repositoryNodeId: GithubRepositoryNodeId
}

type ExecuteFocusedRead = (
  request: FocusedGithubReadRequest
) => Effect.Effect<GithubGraphqlResponse, FocusedTaskCompletionReadFailure>

interface FocusedReadData {
  readonly completionClaims: CompletionClaimBoundaryService
  readonly projections: Map<GithubIssueNodeId, GithubIssueProjection>
  readonly request: FocusedTaskCompletionReadRequest
  readonly target: ResolvedFocusedTarget
  readonly taskIdentity: ResolvedFocusedTask
}

interface FocusedReadOperations {
  readonly execute: ExecuteFocusedRead
}

type FocusedReadContext = FocusedReadData & FocusedReadOperations

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

const resolveFocusedTarget = Effect.fn("GithubCompletionTask.resolveTarget")(function* (
  execute: ExecuteFocusedRead,
  request: FocusedTaskCompletionReadRequest
) {
  if (typeof request.target === "string") {
    return yield* focusedFailure(request.taskId, "GitHub completion boundary cannot read a fixture target")
  }
  const response = yield* execute(GithubGraphqlRequest.cases.ResolveIssue.make({ target: request.target }))
  const decoded = yield* decodeFocusedResponse(ResolveIssueResponse, response, request)
  const repository = decoded.data.repository
  if (repository === null || repository.issue === null) {
    return yield* focusedFailure(request.taskId, "GitHub target repository or root issue is inaccessible")
  }
  return { repositoryNodeId: repository.id, rootIssueNodeId: repository.issue.id } satisfies ResolvedFocusedTarget
})

const resolveFocusedTask = Effect.fn("GithubCompletionTask.resolveTask")(function* (
  request: FocusedTaskCompletionReadRequest,
  target: ResolvedFocusedTarget
) {
  const taskIdentity = yield* decodeGithubTaskId(request.taskId).pipe(
    Effect.mapError((cause) => focusedFailure(request.taskId, cause.detail))
  )
  if (taskIdentity.repositoryNodeId !== target.repositoryNodeId) {
    return yield* focusedFailure(request.taskId, "GitHub task identity belongs to another repository")
  }
  return taskIdentity satisfies ResolvedFocusedTask
})

const readIssue = Effect.fn("GithubCompletionTask.readIssue")(function* (
  context: FocusedReadContext,
  issueNodeId: GithubIssueNodeId
) {
  const cached = context.projections.get(issueNodeId)
  if (cached !== undefined) return cached
  const response = yield* context.execute(GithubGraphqlRequest.cases.ReadIssue.make({ issueNodeId }))
  const decoded = yield* decodeFocusedResponse(ReadIssueResponse, response, context.request)
  const node = decoded.data.node
  const issue = yield* requireGithubIssueIdentity(
    issueNodeId,
    context.target.repositoryNodeId,
    "target",
    node === null
      ? null
      : {
          id: node.id,
          parentNodeId: node.parent?.id ?? null,
          repositoryNodeId: node.repository.id,
          state: node.state,
          stateReason: node.stateReason
        },
    (detail) => Effect.fail(focusedFailure(context.request.taskId, detail))
  )
  const projection = {
    id: issue.id,
    parentNodeId: issue.parentNodeId,
    state: issue.state,
    stateReason: issue.stateReason
  } satisfies GithubIssueProjection
  context.projections.set(issueNodeId, projection)
  return projection
})

const requireConnectionPage = (
  request: FocusedTaskCompletionReadRequest,
  issueNodeId: GithubIssueNodeId,
  page: GithubIssueConnectionPage | null
): Effect.Effect<GithubIssueConnectionPage, FocusedTaskCompletionReadFailure> =>
  page === null
    ? Effect.fail(focusedFailure(request.taskId, `GitHub issue ${issueNodeId} is inaccessible`))
    : Effect.succeed(page)

const readConnectionPage = Effect.fn("GithubCompletionTask.readConnectionPage")(function* (
  context: FocusedReadContext,
  issueNodeId: GithubIssueNodeId,
  relation: GithubIssueRelation,
  cursor: GithubCursor | null
) {
  if (relation === "blockedBy") {
    const response = yield* context.execute(GithubGraphqlRequest.cases.ReadBlockedBy.make({ cursor, issueNodeId }))
    const decoded = yield* decodeFocusedResponse(BlockedByResponse, response, context.request)
    return yield* requireConnectionPage(
      context.request,
      issueNodeId,
      decoded.data.node === null ? null : { connection: decoded.data.node.blockedBy, issueNodeId: decoded.data.node.id }
    )
  }
  const response = yield* context.execute(GithubGraphqlRequest.cases.ReadSubIssues.make({ cursor, issueNodeId }))
  const decoded = yield* decodeFocusedResponse(SubIssuesResponse, response, context.request)
  return yield* requireConnectionPage(
    context.request,
    issueNodeId,
    decoded.data.node === null ? null : { connection: decoded.data.node.subIssues, issueNodeId: decoded.data.node.id }
  )
})

const readConnection = (
  context: FocusedReadContext,
  issueNodeId: GithubIssueNodeId,
  relation: GithubIssueRelation
): Effect.Effect<ReadonlyArray<GithubIssueNodeId>, FocusedTaskCompletionReadFailure> =>
  readCompleteGithubIssueConnection({
    invalid: (_stage, detail) => Effect.fail(focusedFailure(context.request.taskId, detail)),
    issueNodeId,
    readPage: (cursor) => readConnectionPage(context, issueNodeId, relation, cursor),
    relation,
    resourceLimit: (_stage, detail) => Effect.fail(focusedFailure(context.request.taskId, detail))
  })

const readTaskSpecification = Effect.fn("GithubCompletionTask.readSpecification")(function* (
  context: FocusedReadContext
) {
  const response = yield* context.execute(
    GithubGraphqlRequest.cases.ReadTaskWorkSpecification.make({ issueNodeId: context.taskIdentity.issueNodeId })
  )
  const decoded = yield* decodeFocusedResponse(ReadTaskWorkSpecificationResponse, response, context.request)
  const issue = decoded.data.node
  if (issue === null) {
    return yield* focusedFailure(
      context.request.taskId,
      `GitHub issue ${context.taskIdentity.issueNodeId} is inaccessible`
    )
  }
  if (issue.id !== context.taskIdentity.issueNodeId || issue.repository.id !== context.target.repositoryNodeId) {
    return yield* focusedFailure(
      context.request.taskId,
      "GitHub task-work specification contradicts the exact task or repository"
    )
  }
  return makeTaskWorkSpecification({ body: issue.body, taskId: context.request.taskId, title: issue.title })
})

const readTargetMembership = Effect.fn("GithubCompletionTask.readTargetMembership")(function* (
  context: FocusedReadContext
) {
  const traversal = yield* traverseGithubTargetClosure({
    closureDescription: "focused membership traversal",
    invalid: (_stage, detail) => Effect.fail(focusedFailure(context.request.taskId, detail)),
    readConnection: (issueNodeId, relation) => readConnection(context, issueNodeId, relation),
    readIssue: (issueNodeId) => readIssue(context, issueNodeId),
    resourceLimit: (_stage, detail) => Effect.fail(focusedFailure(context.request.taskId, detail)),
    rootIssueNodeId: context.target.rootIssueNodeId,
    stopAfterIssue: (issue) => issue.id === context.taskIdentity.issueNodeId
  })
  return traversal._tag === "Stopped" ? ("Member" as const) : ("NotMember" as const)
})

const lifecycleFor = (
  context: FocusedReadContext,
  issue: GithubIssueProjection,
  subject: "prerequisite" | "task"
): Effect.Effect<FocusedTaskCompletionFacts["lifecycle"], FocusedTaskCompletionReadFailure> => {
  const lifecycle = githubTaskLifecycleFrom(issue.state, issue.stateReason)
  return lifecycle === undefined
    ? Effect.fail(
        focusedFailure(
          context.request.taskId,
          `unsupported GitHub ${subject} lifecycle ${issue.state}/${issue.stateReason ?? "null"}`
        )
      )
    : Effect.succeed(lifecycle._tag)
}

const readUnfinishedPrerequisites = Effect.fn("GithubCompletionTask.readUnfinishedPrerequisites")(function* (
  context: FocusedReadContext
) {
  const prerequisiteNodeIds = yield* readConnection(context, context.taskIdentity.issueNodeId, "blockedBy")
  if (prerequisiteNodeIds.includes(context.taskIdentity.issueNodeId)) {
    return yield* focusedFailure(context.request.taskId, "GitHub task cannot be its own prerequisite")
  }
  const unfinishedPrerequisiteTaskIds: Array<TaskId> = []
  for (const prerequisiteNodeId of prerequisiteNodeIds) {
    const prerequisite = yield* readIssue(context, prerequisiteNodeId)
    const lifecycle = yield* lifecycleFor(context, prerequisite, "prerequisite")
    if (lifecycle !== "CompletedSuccessfully") {
      unfinishedPrerequisiteTaskIds.push(githubTaskIdFor(context.target.repositoryNodeId, prerequisiteNodeId))
    }
  }
  unfinishedPrerequisiteTaskIds.sort()
  return unfinishedPrerequisiteTaskIds
})

const makeFocusedFacts = Effect.fn("GithubCompletionTask.makeFocusedFacts")(function* (
  context: FocusedReadContext,
  revisionContent: typeof FocusedCompletionRevisionContent.Type
) {
  const trackerRevision = yield* Schema.encodeUnknownEffect(CanonicalFocusedCompletionRevisionContent)(
    revisionContent
  ).pipe(Effect.mapError((cause) => focusedFailure(context.request.taskId, String(cause))))
  return yield* Schema.decodeUnknownEffect(FocusedTaskCompletionFacts)({
    ...revisionContent,
    operationId: context.request.operationId,
    trackerRevision: TrackerRevision.make(trackerRevision)
  }).pipe(
    Effect.mapError((cause) =>
      focusedFailure(context.request.taskId, `GitHub returned contradictory focused completion facts: ${String(cause)}`)
    )
  )
})

const readFocusedFacts = Effect.fn("GithubCompletionTask.readFocusedFacts")(function* (context: FocusedReadContext) {
  const taskIssue = yield* readIssue(context, context.taskIdentity.issueNodeId)
  const lifecycle = yield* lifecycleFor(context, taskIssue, "task")
  const specification = yield* readTaskSpecification(context)
  const targetMembership = yield* readTargetMembership(context)
  const unfinishedPrerequisiteTaskIds = yield* readUnfinishedPrerequisites(context)
  const currentClaim = yield* context.completionClaims
    .readTaskClaim(completionClaimReadRequestFor(context.request.expectedClaim))
    .pipe(Effect.mapError((cause) => focusedFailure(context.request.taskId, cause.detail)))
  return yield* makeFocusedFacts(context, {
    currentClaim,
    lifecycle,
    target: context.request.target,
    targetMembership,
    taskId: context.request.taskId,
    taskRevision: specification.fingerprint,
    unfinishedPrerequisiteTaskIds
  })
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
    const target = yield* resolveFocusedTarget(execute, request)
    const taskIdentity = yield* resolveFocusedTask(request, target)
    return yield* readFocusedFacts({ completionClaims, execute, projections: new Map(), request, target, taskIdentity })
  })
