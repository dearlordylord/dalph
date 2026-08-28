import { it } from "@effect/vitest"
import { expect } from "vitest"
import { OperationId } from "../../../workflow/identity.js"
import {
  TaskTrackerMutationThrottled,
  TaskTrackerThrottleTimingEvidence,
  TaskTrackerThrottleRetryAfterSeconds,
  taskTrackerMutationOperations
} from "../mutation-throttling.js"
import { GithubGraphqlThrottled } from "./graphql-client.js"
import { mapGithubMutationFailure } from "./mutation-throttling.js"

it("maps every authoritative tracker-mutation family with diagnostic timing evidence", () => {
  const timingEvidence = TaskTrackerThrottleTimingEvidence.cases.RetryAfter.make({
    seconds: TaskTrackerThrottleRetryAfterSeconds.make(23)
  })

  for (const operation of taskTrackerMutationOperations) {
    const operationId = OperationId.make(`throttled:${operation}`)
    const mapped = mapGithubMutationFailure(
      operation,
      operationId,
      () => new Error("unexpected generic failure")
    )(
      new GithubGraphqlThrottled({
        detail: "GitHub secondary rate limit rejected the GraphQL request",
        kind: "Secondary",
        operation: "CloseIssue",
        timingEvidence
      })
    )

    expect(mapped).toBeInstanceOf(TaskTrackerMutationThrottled)
    expect(mapped).toEqual(
      new TaskTrackerMutationThrottled({
        detail: "GitHub secondary rate limit rejected the GraphQL request",
        operation,
        operationId,
        timingEvidence
      })
    )
  }
})
