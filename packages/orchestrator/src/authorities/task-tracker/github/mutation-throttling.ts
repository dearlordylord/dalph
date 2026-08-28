import { GithubGraphqlThrottled, type GithubGraphqlRequestError } from "./graphql-client.js"
import { TaskTrackerMutationThrottled, type TaskTrackerMutationOperation } from "../mutation-throttling.js"
import type { OperationId } from "../../../workflow/identity.js"

/** Translates one GitHub throttle for every provider-neutral tracker-mutation family. */
export const mapGithubMutationFailure =
  <E>(
    operation: TaskTrackerMutationOperation,
    operationId: OperationId,
    otherwise: (failure: GithubGraphqlRequestError) => E
  ) =>
  (failure: GithubGraphqlRequestError | GithubGraphqlThrottled): E | TaskTrackerMutationThrottled =>
    failure instanceof GithubGraphqlThrottled
      ? new TaskTrackerMutationThrottled({
          detail: failure.detail,
          operation,
          operationId,
          retry: failure.timingEvidence
        })
      : otherwise(failure)
