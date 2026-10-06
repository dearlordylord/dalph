import type { GithubGraphqlResponse } from "../../orchestrator/src/authorities/task-tracker/github/graphql-response.js"
import { GithubGraphqlRequestError, type GithubGraphqlRequest, type GithubIssueNodeId } from "@dalph/orchestrator"
import { Effect, Ref } from "effect"
import { hermeticQualificationTrackerIdentity } from "../src/application/production-hermetic-contract.js"

/** Authored task edits and deliberately incomplete provider fields are separate controlled facts. */
export const makeRunningHostTrackerEdits = Effect.fn("RunningHostFixture.trackerEdits")(function* (
  rootNode: GithubIssueNodeId,
  childB: GithubIssueNodeId,
  childC: GithubIssueNodeId,
  childE: GithubIssueNodeId,
  includeBlockedChildren: boolean,
  discovery?: {
    readonly startupIncludesE?: boolean
    readonly independentB?: boolean
    readonly authoredIntermediateD?: boolean
    readonly onRootGraphRead?: () => Effect.Effect<void>
  }
) {
  const includesE = yield* Ref.make(discovery?.startupIncludesE === true)
  const includesD = yield* Ref.make(false)
  const observationOrder = yield* Ref.make<ReadonlyArray<string>>([])
  const incompleteEvidence = yield* Ref.make<"MissingPage" | "MissingBlocker" | "Contradictory" | "Unreadable" | null>(
    null
  )
  const respond = Effect.fn("RunningHostFixture.readAuthoredFields")(function* (
    request: GithubGraphqlRequest
  ): Effect.fn.Return<GithubGraphqlResponse | undefined, GithubGraphqlRequestError> {
    if (
      request._tag === "ReadSubIssues" &&
      request.issueNodeId === rootNode &&
      discovery?.onRootGraphRead !== undefined
    )
      yield* discovery.onRootGraphRead()
    const incomplete = yield* Ref.get(incompleteEvidence)
    if (discovery?.authoredIntermediateD === true) {
      if (request._tag === "ReadSubIssues" && request.issueNodeId === rootNode && incomplete === "MissingPage")
        return {
          body: {
            data: {
              node: {
                __typename: "Issue",
                id: rootNode,
                subIssues: { nodes: [{ id: childB }], pageInfo: { endCursor: null, hasNextPage: true } }
              }
            }
          }
        }
      if (request._tag === "ReadBlockedBy" && request.issueNodeId === childB) {
        if (incomplete === "MissingBlocker") return { body: { data: { node: null } } }
        if (incomplete === "Unreadable")
          return yield* Effect.fail(
            new GithubGraphqlRequestError({ operation: request._tag, detail: "D blocker read is unavailable" })
          )
      }
      if (request._tag === "ReadIssue" && request.issueNodeId === childB && incomplete === "Contradictory")
        return {
          body: {
            data: {
              node: {
                __typename: "Issue",
                id: childB,
                parent: { id: "foreign-parent" },
                repository: { id: hermeticQualificationTrackerIdentity.repositoryNodeId },
                state: "OPEN",
                stateReason: null
              }
            }
          }
        }
    }
    const connection = (field: "subIssues" | "blockedBy", ids: ReadonlyArray<GithubIssueNodeId>) => ({
      body: {
        data: {
          node: {
            __typename: "Issue",
            id: "issueNodeId" in request ? request.issueNodeId : rootNode,
            [field]: { nodes: ids.map((id) => ({ id })), pageInfo: { endCursor: null, hasNextPage: false } }
          }
        }
      }
    })
    if (request._tag === "ReadSubIssues") {
      return connection(
        "subIssues",
        discovery?.authoredIntermediateD === true && request.issueNodeId === rootNode
          ? [...((yield* Ref.get(includesD)) ? [childB] : []), ...((yield* Ref.get(includesE)) ? [childE] : [])]
          : includeBlockedChildren && request.issueNodeId === rootNode
            ? [childB, childC, ...((yield* Ref.get(includesE)) ? [childE] : [])]
            : []
      )
    }
    if (includeBlockedChildren && request._tag === "ReadBlockedBy")
      return connection(
        "blockedBy",
        discovery?.authoredIntermediateD === true && request.issueNodeId === childB
          ? (yield* Ref.get(includesE))
            ? [childE]
            : []
          : request.issueNodeId === childC
            ? [rootNode, childB, ...((yield* Ref.get(includesE)) ? [childE] : [])]
            : request.issueNodeId === childE
              ? [rootNode]
              : []
      )
    if (
      includeBlockedChildren &&
      request._tag === "ReadIssue" &&
      request.issueNodeId !== rootNode &&
      !(discovery?.independentB === true && request.issueNodeId === childB)
    )
      return {
        body: {
          data: {
            node: {
              __typename: "Issue",
              id: request.issueNodeId,
              parent: { id: rootNode },
              repository: { id: hermeticQualificationTrackerIdentity.repositoryNodeId },
              state: "OPEN",
              stateReason: null
            }
          }
        }
      }
    if (
      includeBlockedChildren &&
      request._tag === "ReadTaskWorkSpecification" &&
      request.issueNodeId !== rootNode &&
      !(discovery?.independentB === true && request.issueNodeId === childB)
    ) {
      return yield* Effect.die("blocked child must not reach a work-specification read")
    }
    return undefined
  })
  return {
    respond,
    observationOrder,
    authorD: Ref.update(observationOrder, (all) => [...all, "AuthoredD"]).pipe(
      Effect.andThen(Ref.set(includesD, true))
    ),
    authorE: Ref.update(observationOrder, (all) => [...all, "AuthoredE"]).pipe(
      Effect.andThen(Ref.set(includesE, true))
    ),
    setIncompleteEvidence: (value: "MissingPage" | "MissingBlocker" | "Contradictory" | "Unreadable" | null) =>
      Ref.set(incompleteEvidence, value)
  }
})
