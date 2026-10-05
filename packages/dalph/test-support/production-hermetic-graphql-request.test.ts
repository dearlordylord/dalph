import { GithubCursor } from "../../orchestrator/src/authorities/task-tracker/github/graphql-client.js"
import { it } from "@effect/vitest"
import { Effect } from "effect"
import { expect } from "vitest"
import { GithubGraphqlRequest, GithubIssueNodeId } from "@dalph/orchestrator"
import { graphBatchRequestBody } from "../../orchestrator/src/authorities/task-tracker/github/graph-batch-query.js"
import { decodeHermeticGraphqlRequest } from "./production-hermetic-graphql-request.js"

it.effect("decodes the production graph batch with descriptors and hierarchy as the exact requested reads", () =>
  Effect.gen(function* () {
    const issueNodeId = GithubIssueNodeId.make("hermetic-issue")
    const request = GithubGraphqlRequest.cases.ReadGraphBatch.make({
      reads: [
        { _tag: "ReadIssue", issueNodeId },
        { _tag: "ReadBlockedBy", issueNodeId, cursor: GithubCursor.make("next-blocker-page") },
        { _tag: "ReadSubIssues", issueNodeId, cursor: null }
      ]
    })
    const decoded = yield* decodeHermeticGraphqlRequest(graphBatchRequestBody(request, 100))
    expect(decoded).toEqual(request)
  })
)
