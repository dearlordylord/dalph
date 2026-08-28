import { it } from "@effect/vitest"
import { expect } from "vitest"
import { OperationId } from "../../../workflow/identity.js"
import {
  TaskTrackerMutationThrottled,
  TaskTrackerThrottleRetry,
  TaskTrackerThrottleRetryAfterSeconds,
  type TaskTrackerMutationOperation
} from "../mutation-throttling.js"
import { GithubGraphqlThrottled } from "./graphql-client.js"
import { mapGithubMutationFailure } from "./mutation-throttling.js"

it("maps GitHub throttle to exact provider-neutral TaskTrackerMutationThrottled with safe retry evidence", () => {
  const operations: ReadonlyArray<TaskTrackerMutationOperation> = [
    "AcquireTaskClaim",
    "ReleaseTaskClaim",
    "ReplaceCompletionClaim",
    "DeleteCompletionClaim",
    "CompleteTask"
  ]
  const retry = TaskTrackerThrottleRetry.cases.RetryAfter.make({
    seconds: TaskTrackerThrottleRetryAfterSeconds.make(23)
  })

  for (const operation of operations) {
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
        retry
      })
    )

    expect(mapped).toBeInstanceOf(TaskTrackerMutationThrottled)
    expect(mapped).toEqual(
      new TaskTrackerMutationThrottled({
        detail: "GitHub secondary rate limit rejected the GraphQL request",
        operation,
        operationId,
        retry
      })
    )
  }
})
