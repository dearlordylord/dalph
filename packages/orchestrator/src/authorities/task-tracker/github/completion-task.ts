import { Effect, Layer, Schema } from "effect"
import { CompletionClaimBoundary } from "../../../workflow/protocols/integration-finality/completion-claim.js"
import {
  CompletionTaskAcknowledgement,
  CompletionTaskBoundary,
  type CompletionTaskRequest,
  CompletionTaskRequestFailure,
  CompletionTaskRequestLookup
} from "../../../workflow/protocols/integration-finality/events.js"
import { GraphqlErrorsEnvelope } from "./graph-schema.js"
import { GithubGraphqlClient, GithubGraphqlRequest, GithubIssueNodeId } from "./graphql-client.js"
import { decodeGithubTaskId } from "./task-identity.js"
import { makeGithubFocusedTaskCompletionReader } from "./focused-completion-reader.js"

/** Exact GitHub acknowledgement fields for one close request; issue lifecycle is deliberately excluded. */
const CloseIssueAcknowledgementResponse = Schema.Struct({
  data: Schema.Struct({
    closeIssue: Schema.Struct({
      clientMutationId: Schema.NullOr(Schema.String),
      issue: Schema.Struct({ id: GithubIssueNodeId })
    })
  })
})

const completionFailure = (
  request: CompletionTaskRequest,
  outcome: "DefinitelyNotApplied" | "Unknown",
  detail: string
): CompletionTaskRequestFailure => new CompletionTaskRequestFailure({ detail, outcome, request })

/** GitHub task-completion adapter using one shared client and the separately supplied completion-claim reader. */
export const githubCompletionTaskBoundaryLayer = Layer.effect(
  CompletionTaskBoundary,
  Effect.gen(function* () {
    const client = yield* GithubGraphqlClient
    const completionClaims = yield* CompletionClaimBoundary
    const readFocusedTaskCompletion = makeGithubFocusedTaskCompletionReader(client, completionClaims)

    const completeTask = Effect.fn("GithubCompletionTask.completeTask")(function* (request: CompletionTaskRequest) {
      const identity = yield* decodeGithubTaskId(request.taskId).pipe(
        Effect.mapError((cause) => completionFailure(request, "DefinitelyNotApplied", cause.detail))
      )
      const response = yield* client
        .execute(
          GithubGraphqlRequest.cases.CloseIssue.make({
            issueNodeId: identity.issueNodeId,
            operationId: request.operationId
          })
        )
        .pipe(
          Effect.catchTags({
            "GithubGraphqlClient.ReadThrottled": (cause) =>
              Effect.fail(completionFailure(request, "Unknown", cause.detail)),
            "GithubGraphqlClient.RequestError": (cause) =>
              Effect.fail(completionFailure(request, "Unknown", cause.detail))
          })
        )
      const header = yield* Schema.decodeUnknownEffect(GraphqlErrorsEnvelope)(response.body).pipe(
        Effect.mapError((cause) => completionFailure(request, "Unknown", String(cause)))
      )
      if (header.errors !== undefined && header.errors.length > 0) {
        return yield* completionFailure(request, "Unknown", header.errors.map(({ message }) => message).join("; "))
      }
      const decoded = yield* Schema.decodeUnknownEffect(CloseIssueAcknowledgementResponse)(response.body).pipe(
        Effect.mapError((cause) => completionFailure(request, "Unknown", String(cause)))
      )
      if (
        decoded.data.closeIssue.clientMutationId !== request.operationId ||
        decoded.data.closeIssue.issue.id !== identity.issueNodeId
      ) {
        return yield* completionFailure(request, "Unknown", "GitHub acknowledged another completion request")
      }
      return CompletionTaskAcknowledgement.make({ operationId: request.operationId, taskId: request.taskId })
    })

    const readCompletionRequest = Effect.fn("GithubCompletionTask.readCompletionRequest")(
      (request: CompletionTaskRequest) =>
        Effect.succeed(
          CompletionTaskRequestLookup.cases.Unreadable.make({
            detail: "GitHub cannot query a prior CloseIssue request by clientMutationId",
            request
          })
        )
    )

    return CompletionTaskBoundary.of({ completeTask, readCompletionRequest, readFocusedTaskCompletion })
  })
)
