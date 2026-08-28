/* eslint-disable functional/immutable-data -- Bounded traversal state is private adapter scratch and is never published as authority. */
import { Effect, Option } from "effect"
import type { GithubCursor, GithubIssueNodeId, GithubRepositoryNodeId } from "./graphql-client.js"
import type { IssueConnection } from "./graph-schema.js"
import { githubConnectionPageLimit, githubSnapshotTaskLimit } from "./read-limits.js"

/** The closed GitHub issue relations used to construct one target closure. */
export type GithubIssueRelation = "blockedBy" | "subIssues"

/** One decoded connection page still bound to the issue GitHub says it describes. */
export interface GithubIssueConnectionPage {
  readonly connection: IssueConnection
  readonly issueNodeId: GithubIssueNodeId
}

/** Provider identity fields checked before an issue may enter a target closure. */
interface GithubIssueIdentityObservation {
  readonly id: GithubIssueNodeId
  readonly parentNodeId: GithubIssueNodeId | null
  readonly repositoryNodeId: GithubRepositoryNodeId
}

/** Minimal issue shape required by the shared target-closure traversal. */
interface GithubTargetClosureIssue {
  readonly id: GithubIssueNodeId
  readonly parentNodeId: GithubIssueNodeId | null
}

/** The boundary stage whose current observation contradicted target-closure rules. */
export type GithubTargetClosureReadStage = "blockedBy" | "issue" | "subIssues"

export interface GithubTargetClosureNode<Issue extends GithubTargetClosureIssue> {
  readonly issue: Issue
  readonly prerequisiteNodeIds: ReadonlyArray<GithubIssueNodeId>
}

type GithubTargetClosureTraversal<Issue extends GithubTargetClosureIssue> =
  | {
      readonly _tag: "Complete"
      readonly hierarchyParents: ReadonlyMap<GithubIssueNodeId, GithubIssueNodeId | null>
      readonly nodes: ReadonlyMap<GithubIssueNodeId, GithubTargetClosureNode<Issue>>
    }
  | { readonly _tag: "Stopped"; readonly issue: Issue }

interface GithubReadFailureBoundary<Failure> {
  readonly invalid: (stage: GithubTargetClosureReadStage, detail: string) => Effect.Effect<never, Failure>
  readonly resourceLimit: (stage: GithubIssueRelation, detail: string) => Effect.Effect<never, Failure>
}

interface GithubConnectionReadData {
  readonly issueNodeId: GithubIssueNodeId
  readonly relation: GithubIssueRelation
}

interface GithubConnectionReadOperations<Failure> extends GithubReadFailureBoundary<Failure> {
  readonly readPage: (cursor: GithubCursor | null) => Effect.Effect<GithubIssueConnectionPage, Failure>
}

type GithubConnectionRead<Failure> = GithubConnectionReadData & GithubConnectionReadOperations<Failure>

interface GithubTargetClosureReadData {
  readonly closureDescription: "focused membership traversal" | "tracker target closure"
  readonly rootIssueNodeId: GithubIssueNodeId
}

interface GithubTargetClosureReadOperations<
  Issue extends GithubTargetClosureIssue,
  Failure
> extends GithubReadFailureBoundary<Failure> {
  readonly readConnection: (
    issueNodeId: GithubIssueNodeId,
    relation: GithubIssueRelation
  ) => Effect.Effect<ReadonlyArray<GithubIssueNodeId>, Failure>
  readonly readIssue: (issueNodeId: GithubIssueNodeId) => Effect.Effect<Issue, Failure>
}

interface GithubTargetClosureStopOperation<Issue extends GithubTargetClosureIssue> {
  readonly stopAfterIssue: (issue: Issue) => boolean
}

type GithubCompleteTargetClosureRead<Issue extends GithubTargetClosureIssue, Failure> = GithubTargetClosureReadData &
  GithubTargetClosureReadOperations<Issue, Failure>

type GithubStoppingTargetClosureRead<Issue extends GithubTargetClosureIssue, Failure> = GithubCompleteTargetClosureRead<
  Issue,
  Failure
> &
  GithubTargetClosureStopOperation<Issue>

type GithubTargetClosureRead<Issue extends GithubTargetClosureIssue, Failure> =
  | GithubCompleteTargetClosureRead<Issue, Failure>
  | GithubStoppingTargetClosureRead<Issue, Failure>

interface GithubTargetClosureScratch<Issue extends GithubTargetClosureIssue> {
  readonly discovered: Set<GithubIssueNodeId>
  readonly expandedChildren: Set<GithubIssueNodeId>
  readonly hierarchyParents: Map<GithubIssueNodeId, GithubIssueNodeId | null>
  readonly issues: Map<GithubIssueNodeId, Issue>
  readonly nodes: Map<GithubIssueNodeId, GithubTargetClosureNode<Issue>>
  readonly pending: Array<{ readonly expandChildren: boolean; readonly issueNodeId: GithubIssueNodeId }>
}

/** Rejects inaccessible, cross-issue, and cross-repository identity observations uniformly. */
export const requireGithubIssueIdentity = <Observation extends GithubIssueIdentityObservation, Failure>(
  issueNodeId: GithubIssueNodeId,
  repositoryNodeId: GithubRepositoryNodeId,
  repositoryDescription: "root" | "target",
  observation: Observation | null,
  invalid: (detail: string) => Effect.Effect<never, Failure>
): Effect.Effect<Observation, Failure> => {
  if (observation === null) return invalid(`GitHub issue ${issueNodeId} is inaccessible`)
  if (observation.id !== issueNodeId) {
    return invalid(`GitHub returned issue ${observation.id} while reading ${issueNodeId}`)
  }
  if (observation.repositoryNodeId !== repositoryNodeId) {
    return invalid(`GitHub issue ${issueNodeId} is outside the ${repositoryDescription} repository`)
  }
  return Effect.succeed(observation)
}

const appendUniqueConnectionNodes = <Failure>(
  connection: IssueConnection,
  relation: GithubIssueRelation,
  seenNodeIds: Set<GithubIssueNodeId>,
  nodeIds: Array<GithubIssueNodeId>,
  invalid: (detail: string) => Effect.Effect<never, Failure>
): Effect.Effect<void, Failure> =>
  Effect.gen(function* () {
    for (const { id } of connection.nodes) {
      if (seenNodeIds.has(id)) return yield* invalid(`GitHub returned duplicate ${relation} endpoint ${id}`)
      seenNodeIds.add(id)
      nodeIds.push(id)
    }
  })

const validateNextConnectionCursor = <Failure>(
  connection: IssueConnection,
  relation: GithubIssueRelation,
  seenCursors: Set<GithubCursor>,
  invalid: (detail: string) => Effect.Effect<never, Failure>
): Effect.Effect<void, Failure> => {
  if (!connection.pageInfo.hasNextPage) return Effect.void
  const endCursor = connection.pageInfo.endCursor
  if (endCursor === null) return invalid(`GitHub returned an incomplete ${relation} page`)
  if (seenCursors.has(endCursor)) {
    return invalid(`GitHub repeated a ${relation} pagination cursor without making progress`)
  }
  seenCursors.add(endCursor)
  return Effect.void
}

/** Reads one complete bounded relation and rejects duplicate or non-progressing provider pages. */
export const readCompleteGithubIssueConnection = <Failure>({
  invalid,
  issueNodeId,
  readPage,
  relation,
  resourceLimit
}: GithubConnectionRead<Failure>): Effect.Effect<ReadonlyArray<GithubIssueNodeId>, Failure> =>
  Effect.gen(function* () {
    const nodeIds: Array<GithubIssueNodeId> = []
    const seenCursors = new Set<GithubCursor>()
    const seenNodeIds = new Set<GithubIssueNodeId>()
    let cursor: GithubCursor | null = null
    let hasNextPage = true
    let pageCount = 0

    while (hasNextPage) {
      if (pageCount >= githubConnectionPageLimit) {
        return yield* resourceLimit(
          relation,
          `GitHub ${relation} connection exceeds ${githubConnectionPageLimit} pages`
        )
      }
      pageCount += 1
      const page: GithubIssueConnectionPage = yield* readPage(cursor)
      if (page.issueNodeId !== issueNodeId) {
        return yield* invalid(relation, `GitHub returned issue ${page.issueNodeId} while reading ${issueNodeId}`)
      }
      yield* appendUniqueConnectionNodes(page.connection, relation, seenNodeIds, nodeIds, (detail) =>
        invalid(relation, detail)
      )
      yield* validateNextConnectionCursor(page.connection, relation, seenCursors, (detail) => invalid(relation, detail))
      hasNextPage = page.connection.pageInfo.hasNextPage
      cursor = page.connection.pageInfo.endCursor
    }
    return nodeIds
  })

const registerDiscoveredSubjects = <Issue extends GithubTargetClosureIssue, Failure>(
  scratch: GithubTargetClosureScratch<Issue>,
  issueNodeIds: ReadonlyArray<GithubIssueNodeId>,
  stage: GithubIssueRelation,
  closureDescription: GithubTargetClosureReadData["closureDescription"],
  resourceLimit: GithubReadFailureBoundary<Failure>["resourceLimit"]
): Effect.Effect<void, Failure> =>
  Effect.gen(function* () {
    const additions = issueNodeIds.filter((issueNodeId) => !scratch.discovered.has(issueNodeId))
    if (scratch.discovered.size + additions.length > githubSnapshotTaskLimit) {
      return yield* resourceLimit(stage, `GitHub ${closureDescription} exceeds ${githubSnapshotTaskLimit} tasks`)
    }
    for (const issueNodeId of additions) scratch.discovered.add(issueNodeId)
  })

const validateObservedParent = <Issue extends GithubTargetClosureIssue, Failure>(
  scratch: GithubTargetClosureScratch<Issue>,
  issue: Issue,
  invalid: GithubReadFailureBoundary<Failure>["invalid"]
): Effect.Effect<void, Failure> => {
  const expectedParent = scratch.hierarchyParents.get(issue.id)
  return expectedParent !== undefined && expectedParent !== null && issue.parentNodeId !== expectedParent
    ? invalid("issue", `GitHub issue ${issue.id} has a contradictory parent`)
    : Effect.void
}

const readClosureIssue = <Issue extends GithubTargetClosureIssue, Failure>(
  scratch: GithubTargetClosureScratch<Issue>,
  issueNodeId: GithubIssueNodeId,
  boundary: GithubTargetClosureRead<Issue, Failure>
): Effect.Effect<Issue, Failure> =>
  Effect.gen(function* () {
    const existing = scratch.issues.get(issueNodeId)
    if (existing !== undefined) return existing
    const issue = yield* boundary.readIssue(issueNodeId)
    yield* validateObservedParent(scratch, issue, boundary.invalid)
    scratch.issues.set(issueNodeId, issue)
    return issue
  })

const expandClosurePrerequisites = <Issue extends GithubTargetClosureIssue, Failure>(
  scratch: GithubTargetClosureScratch<Issue>,
  issue: Issue,
  boundary: GithubTargetClosureRead<Issue, Failure>
): Effect.Effect<void, Failure> =>
  Effect.gen(function* () {
    if (scratch.nodes.has(issue.id)) return
    const issueNodeId = issue.id
    const prerequisiteNodeIds = yield* boundary.readConnection(issueNodeId, "blockedBy")
    yield* registerDiscoveredSubjects(
      scratch,
      prerequisiteNodeIds,
      "blockedBy",
      boundary.closureDescription,
      boundary.resourceLimit
    )
    const node = { issue, prerequisiteNodeIds } satisfies GithubTargetClosureNode<Issue>
    scratch.nodes.set(issueNodeId, node)
    scratch.pending.push(
      ...prerequisiteNodeIds.map((prerequisiteNodeId) => ({ expandChildren: false, issueNodeId: prerequisiteNodeId }))
    )
  })

const validateChildParent = <Issue extends GithubTargetClosureIssue, Failure>(
  scratch: GithubTargetClosureScratch<Issue>,
  childNodeId: GithubIssueNodeId,
  parentNodeId: GithubIssueNodeId,
  invalid: GithubReadFailureBoundary<Failure>["invalid"]
): Effect.Effect<void, Failure> => {
  const observedChild = scratch.issues.get(childNodeId)
  if (observedChild !== undefined && observedChild.parentNodeId !== parentNodeId) {
    return invalid("subIssues", `GitHub issue ${childNodeId} has a contradictory parent`)
  }
  const knownParent = scratch.hierarchyParents.get(childNodeId)
  return knownParent !== undefined && knownParent !== parentNodeId
    ? invalid("subIssues", `GitHub issue ${childNodeId} appears under multiple parents`)
    : Effect.void
}

const expandClosureChildren = <Issue extends GithubTargetClosureIssue, Failure>(
  scratch: GithubTargetClosureScratch<Issue>,
  expandChildren: boolean,
  issueNodeId: GithubIssueNodeId,
  boundary: GithubTargetClosureRead<Issue, Failure>
): Effect.Effect<void, Failure> =>
  Effect.gen(function* () {
    if (!expandChildren || scratch.expandedChildren.has(issueNodeId)) return
    scratch.expandedChildren.add(issueNodeId)
    const childNodeIds = yield* boundary.readConnection(issueNodeId, "subIssues")
    yield* registerDiscoveredSubjects(
      scratch,
      childNodeIds,
      "subIssues",
      boundary.closureDescription,
      boundary.resourceLimit
    )
    for (const childNodeId of childNodeIds) {
      yield* validateChildParent(scratch, childNodeId, issueNodeId, boundary.invalid)
      scratch.hierarchyParents.set(childNodeId, issueNodeId)
      scratch.pending.push({ expandChildren: true, issueNodeId: childNodeId })
    }
  })

/** Walks the one bounded closure: root descendants plus prerequisite edges, without prerequisite descendants. */
export function traverseGithubTargetClosure<Issue extends GithubTargetClosureIssue, Failure>(
  boundary: GithubStoppingTargetClosureRead<Issue, Failure>
): Effect.Effect<GithubTargetClosureTraversal<Issue>, Failure>
export function traverseGithubTargetClosure<Issue extends GithubTargetClosureIssue, Failure>(
  boundary: GithubCompleteTargetClosureRead<Issue, Failure>
): Effect.Effect<Extract<GithubTargetClosureTraversal<Issue>, { readonly _tag: "Complete" }>, Failure>
export function traverseGithubTargetClosure<Issue extends GithubTargetClosureIssue, Failure>(
  boundary: GithubTargetClosureRead<Issue, Failure>
): Effect.Effect<GithubTargetClosureTraversal<Issue>, Failure> {
  return Effect.gen(function* () {
    const scratch: GithubTargetClosureScratch<Issue> = {
      discovered: new Set([boundary.rootIssueNodeId]),
      expandedChildren: new Set(),
      hierarchyParents: new Map([[boundary.rootIssueNodeId, null]]),
      issues: new Map(),
      nodes: new Map(),
      pending: [{ expandChildren: true, issueNodeId: boundary.rootIssueNodeId }]
    }

    while (scratch.pending.length > 0) {
      const next = Option.getOrThrow(Option.fromUndefinedOr(scratch.pending.shift()))
      const issue = yield* readClosureIssue(scratch, next.issueNodeId, boundary)
      yield* validateObservedParent(scratch, issue, boundary.invalid)
      if ("stopAfterIssue" in boundary && boundary.stopAfterIssue(issue)) return { _tag: "Stopped", issue }
      yield* expandClosurePrerequisites(scratch, issue, boundary)
      yield* expandClosureChildren(scratch, next.expandChildren, next.issueNodeId, boundary)
    }
    return { _tag: "Complete", hierarchyParents: scratch.hierarchyParents, nodes: scratch.nodes }
  })
}
