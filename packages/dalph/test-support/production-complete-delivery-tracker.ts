import type { GithubGraphqlResponse } from "../../orchestrator/src/authorities/task-tracker/github/graphql-response.js"
import { type GithubGraphqlRequest, type GithubIssueNodeId } from "@dalph/orchestrator"
import { Effect, Ref } from "effect"
import { hermeticQualificationTrackerIdentity } from "../src/application/production-hermetic-contract.js"

/** Tracker-owned C with independent parser A and validator B; an operator later authors E → C. */
export const makeCompleteDeliveryTracker = Effect.fn("CompleteDeliveryTracker.make")(function* (
  c: GithubIssueNodeId,
  b: GithubIssueNodeId,
  a: GithubIssueNodeId,
  e: GithubIssueNodeId
) {
  const includesE = yield* Ref.make(false)
  const completed = yield* Ref.make<ReadonlySet<GithubIssueNodeId>>(new Set())
  const repository = { id: hermeticQualificationTrackerIdentity.repositoryNodeId }
  const respond = Effect.fn("CompleteDeliveryTracker.respond")(function* (
    request: GithubGraphqlRequest
  ): Effect.fn.Return<GithubGraphqlResponse | undefined> {
    if (!("issueNodeId" in request)) return undefined
    const id = request.issueNodeId
    if (![c, b, a, e].includes(id)) return yield* Effect.die("foreign complete-delivery tracker node")
    const base = { __typename: "Issue", id, repository }
    const data = (node: unknown) => ({ body: { data: { node } } })
    const connection = (field: "blockedBy" | "subIssues", ids: ReadonlyArray<GithubIssueNodeId>) =>
      data({
        ...base,
        [field]: { nodes: ids.map((id) => ({ id })), pageInfo: { endCursor: null, hasNextPage: false } }
      })
    switch (request._tag) {
      case "ReadIssue": {
        const done = (yield* Ref.get(completed)).has(id)
        return data({
          ...base,
          parent: id === c ? null : { id: c },
          state: done ? "CLOSED" : "OPEN",
          stateReason: done ? "COMPLETED" : null
        })
      }
      case "ReadBlockedBy":
        return connection("blockedBy", id === c ? [a, b, ...((yield* Ref.get(includesE)) ? [e] : [])] : [])
      case "ReadSubIssues":
        return connection("subIssues", id === c ? [a, b, ...((yield* Ref.get(includesE)) ? [e] : [])] : [])
      case "ReadTaskWorkSpecification":
        return data({
          ...base,
          title:
            id === a
              ? "Build parser A"
              : id === b
                ? "Validate parser B"
                : id === e
                  ? "Document parser E"
                  : "Deliver parser C",
          body: "Produce an immutable accepted commit in the supplied exact worktree and Base."
        })
      case "CloseIssue":
        yield* Ref.update(completed, (ids) => new Set([...ids, id]))
        return {
          body: {
            data: {
              closeIssue: {
                clientMutationId: request.operationId,
                issue: { id, state: "CLOSED", stateReason: "COMPLETED" }
              }
            }
          }
        }
      case "AddBlockedBy":
      case "AddIssueComment":
      case "DeleteIssue":
      case "ReadIssueDetails":
      case "ReopenIssue":
        return undefined
    }
  })
  return { respond, authorE: Ref.set(includesE, true), completed }
})
