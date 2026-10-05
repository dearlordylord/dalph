import { Deferred, Effect, Queue, Ref, Stream } from "effect"
import type { CodexTurnCompletedHint } from "../src/application/codex-app-server.js"
import type { CodexThreadId, CodexTurnId } from "../src/application/codex-attempt-store.js"
import type { makeHermeticProviderResult } from "./production-hermetic-provider-result.js"

/** Keeps the controlled Git candidate intact while several responses describe it. */
export const makeRetainedTaskResultSelector = Effect.gen(function* () {
  const retained = yield* Ref.make<ReadonlyMap<string, string>>(new Map())
  return (produce: Effect.Success<ReturnType<typeof makeHermeticProviderResult>>) => (cwd: string, text: string) =>
    Effect.gen(function* () {
      if (text.startsWith("You are the Dalph integration provider.\n")) return yield* produce(cwd, text)
      const previous = (yield* Ref.get(retained)).get(cwd)
      if (previous !== undefined) return previous
      const result = yield* produce(cwd, text)
      yield* Ref.update(retained, (results) => new Map(results).set(cwd, result))
      return result
    })
})

/** Emits each exact owned turn after the fixture exposes its terminal provider state. */
export const attachControlledResultCompletions =
  (release: Deferred.Deferred<void>) => (threadId: CodexThreadId, expectedTurnId?: CodexTurnId) =>
    Effect.gen(function* () {
      const hints = yield* Queue.unbounded<CodexTurnCompletedHint>()
      yield* Effect.addFinalizer(() => Queue.shutdown(hints))
      const expected = yield* Ref.make<CodexTurnId | undefined>(undefined)
      const bind = (turnId: CodexTurnId) =>
        Effect.gen(function* () {
          if ((yield* Ref.get(expected)) === turnId) return
          yield* Ref.set(expected, turnId)
          yield* Queue.offer(hints, { threadId, turnId })
        })
      if (expectedTurnId !== undefined) yield* bind(expectedTurnId)
      return {
        expectTurnId: bind,
        expectNextTurn: () => Ref.set(expected, undefined),
        hints: Stream.fromEffect(Deferred.await(release)).pipe(Stream.flatMap(() => Stream.fromQueue(hints)))
      }
    })
