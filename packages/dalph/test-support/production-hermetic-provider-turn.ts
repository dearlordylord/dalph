import { Effect, Ref } from "effect"
import {
  type CodexAppServerFailure,
  type CodexThreadSnapshot,
  type CodexTurnCompletedHint,
  type CodexTurnSnapshot
} from "../src/application/codex-app-server.js"
import { CodexTurnId, type CodexOwnedTurnToken, type CodexThreadId } from "../src/application/codex-attempt-store.js"
import { providerFailure } from "./production-hermetic-provider-result.js"

type HermeticProviderTurnStarterDependencies<E> = {
  readonly countStartTurn: () => Effect.Effect<void>
  readonly readThread: (id: CodexThreadId) => Effect.Effect<CodexThreadSnapshot, CodexAppServerFailure>
  readonly produceResult: (cwd: string, text: string) => Effect.Effect<string, E>
  readonly threads: Ref.Ref<ReadonlyMap<CodexThreadId, CodexThreadSnapshot>>
}

/** Models a distinct completion notification after terminal provider state exists. */
export const makeHermeticProviderTurnStarter = <E>({
  countStartTurn,
  produceResult,
  readThread,
  threads
}: HermeticProviderTurnStarterDependencies<E>) =>
  Effect.fn("HermeticProvider.startTurnWithCompletion")(function* (
    id: CodexThreadId,
    cwd: string,
    text: string,
    ownedTurnToken: CodexOwnedTurnToken | undefined
  ) {
    yield* countStartTurn()
    const thread = yield* readThread(id)
    if (thread.cwd !== cwd || ownedTurnToken === undefined) {
      return yield* providerFailure("turn/start", "thread or turn ownership is missing")
    }
    const retained = thread.turns.find((turn) => turn.ownedTurnToken === ownedTurnToken)
    if (retained !== undefined) return { turn: retained, completionNotifications: [] as const }

    const response = yield* produceResult(cwd, text).pipe(
      Effect.mapError(() => providerFailure("turn/start", "controlled result could not be produced"))
    )
    const turnId = CodexTurnId.make(`hermetic-turn:${id}:${thread.turns.length}`)
    const startResponse: CodexTurnSnapshot = {
      id: turnId,
      status: "inProgress",
      ownedTurnToken,
      items: [{ type: "agentMessage", text: response }]
    }
    const completedTurn: CodexTurnSnapshot = { ...startResponse, status: "completed" }
    yield* Ref.update(
      threads,
      (values) => new Map([...values, [id, { ...thread, turns: [...thread.turns, completedTurn] }]])
    )

    const completionNotification: CodexTurnCompletedHint = { threadId: id, turnId }
    return { turn: startResponse, completionNotifications: [completionNotification] }
  })
