import { Match, Schema } from "effect"
import { TaskLifecycle } from "../task.js"

/** GitHub's issue state vocabulary at the tracker adapter boundary. */
export const GithubIssueState = Schema.Literals(["CLOSED", "OPEN"])
export type GithubIssueState = typeof GithubIssueState.Type

/** GitHub's supported issue state-reason vocabulary, including an absent reason. */
export const GithubIssueStateReason = Schema.NullOr(
  Schema.Literals(["COMPLETED", "DUPLICATE", "NOT_PLANNED", "REOPENED"])
)
export type GithubIssueStateReason = typeof GithubIssueStateReason.Type

/** Normalizes one supported GitHub issue lifecycle without inventing a state for contradictory fields. */
export const githubTaskLifecycleFrom = (
  state: GithubIssueState,
  stateReason: GithubIssueStateReason
): TaskLifecycle | undefined =>
  Match.value({ state, stateReason }).pipe(
    Match.when(
      ({ state, stateReason }) => state === "OPEN" && (stateReason === null || stateReason === "REOPENED"),
      () => TaskLifecycle.cases.Open.make({})
    ),
    Match.when(
      ({ state, stateReason }) => state === "CLOSED" && stateReason === "COMPLETED",
      () => TaskLifecycle.cases.CompletedSuccessfully.make({})
    ),
    Match.when(
      ({ state, stateReason }) => state === "CLOSED" && (stateReason === "DUPLICATE" || stateReason === "NOT_PLANNED"),
      () => TaskLifecycle.cases.TerminalWithoutSuccess.make({})
    ),
    Match.orElse(() => undefined)
  )
