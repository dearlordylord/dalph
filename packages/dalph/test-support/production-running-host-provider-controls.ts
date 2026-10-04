import {
  type GithubGraphqlRequest,
  type GithubGraphqlReadThrottled,
  type GithubGraphqlRequestError
} from "@dalph/orchestrator"
import { Effect, Ref } from "effect"
import { CodexAppServerFailure, type CodexThreadSnapshot } from "../src/application/codex-app-server.js"

/** Controlled provider observations leave actual host, Git and journal composition intact. */
export const projectControlledThread = (
  thread: CodexThreadSnapshot,
  visible: boolean,
  stopped: boolean,
  rejectResult: boolean
): CodexThreadSnapshot =>
  stopped
    ? { ...thread, status: "idle", turns: thread.turns.map((turn) => ({ ...turn, status: "interrupted" as const })) }
    : visible
      ? rejectResult
        ? {
            ...thread,
            turns: thread.turns.map((turn) => ({
              ...turn,
              items: [...turn.items, { type: "agentMessage", text: "invalid qualification result" }]
            }))
          }
        : thread
      : { ...thread, status: "active", turns: thread.turns.map((turn) => ({ ...turn, status: "inProgress" as const })) }

export const failControlledGraphRead = (
  request: GithubGraphqlRequest,
  failure: Ref.Ref<GithubGraphqlReadThrottled | GithubGraphqlRequestError | null>
) =>
  Effect.gen(function* () {
    if (request._tag !== "ReadIssue" && request._tag !== "ReadSubIssues" && request._tag !== "ReadBlockedBy") return
    const observed = yield* Ref.get(failure)
    if (observed !== null) return yield* observed
  })

export const failControlledProviderClose = (enabled: Ref.Ref<boolean>) =>
  Ref.get(enabled).pipe(
    Effect.flatMap((shouldFail) =>
      shouldFail
        ? Effect.die(
            new CodexAppServerFailure({
              operation: "close",
              kind: "Ownership",
              detail: "private provider payload must stay private"
            })
          )
        : Effect.void
    )
  )
