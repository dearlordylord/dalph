import {
  type GithubGraphqlRequest,
  type GithubGraphqlReadThrottled,
  type GithubGraphqlRequestError
} from "@dalph/orchestrator"
import { Effect, Ref } from "effect"
import { CodexThreadId } from "../src/application/codex-attempt-store.js"
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

/** Fails only the retained candidate's census; executor observations stay ordinary. */
export const failControlledIntegrationRead = (
  cwd: string | undefined,
  candidateRoot: string,
  kind: "ResponseDeadline" | "Unavailable" | undefined,
  calls: Ref.Ref<number>
) =>
  kind !== undefined && cwd?.startsWith(candidateRoot)
    ? Ref.update(calls, (count) => count + 1).pipe(
        Effect.andThen(
          Effect.fail(
            new CodexAppServerFailure({ operation: "thread/list", kind, detail: "controlled integration read failure" })
          )
        )
      )
    : Effect.void

/** Controlled failure inputs for the real Git/SQLite host composition. */
export interface ControlledProviderDiagnostics {
  readonly rejectResult?: boolean
  readonly failClose?: boolean
  readonly integratorReadFailure?: "ResponseDeadline" | "Unavailable"
}

export interface PausedRunningHostFixture {
  readonly afterInsert?: () => Effect.Effect<void>
  readonly afterCommit?: () => Effect.Effect<void, string>
  readonly onTimerStateChange?: (state: "Started" | "Stopped") => Effect.Effect<void>
  readonly onAcceptedRunControl?: (direction: "Pause" | "Unpause") => Effect.Effect<void>
}

export const reactivationObserversFor = (paused: PausedRunningHostFixture | undefined) => ({
  ...(paused?.onTimerStateChange === undefined ? {} : { onTimerStateChange: paused.onTimerStateChange }),
  ...(paused?.onAcceptedRunControl === undefined ? {} : { onAcceptedRunControl: paused.onAcceptedRunControl })
})

/** Executor evidence cuts exercise the production cancellation observation boundary. */
export const makeControlledExecutorEvidence = Effect.fn("RunningHostFixture.executorEvidence")(function* (
  beforeRead?: () => Effect.Effect<void>
) {
  const evidence = yield* Ref.make<"Ordinary" | "Unavailable" | "Foreign">("Ordinary")
  return {
    set: (value: "Ordinary" | "Unavailable" | "Foreign") => Ref.set(evidence, value),
    read: (thread: CodexThreadSnapshot, visible: boolean, stopped: boolean, rejected: boolean) =>
      (beforeRead?.() ?? Effect.void).pipe(
        Effect.andThen(Ref.get(evidence)),
        Effect.flatMap((value) =>
          value === "Unavailable"
            ? Effect.fail(
                new CodexAppServerFailure({
                  operation: "thread/read",
                  kind: "Unavailable",
                  detail: "controlled unavailable executor"
                })
              )
            : Effect.succeed(
                projectControlledThread(
                  value === "Foreign" ? { ...thread, id: CodexThreadId.make("foreign-thread") } : thread,
                  visible,
                  stopped,
                  rejected
                )
              )
        )
      )
  }
})
