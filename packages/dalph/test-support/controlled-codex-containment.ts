import { Channel, Deferred, Effect, PubSub, Ref, Stream } from "effect"
import {
  CodexAppServer,
  CodexAppServerFailure,
  CodexThreadListSummary,
  CodexThreadWorkingDirectory,
  type CodexThreadSnapshot,
  type CodexToolEffectNotification,
  type CodexTurnCompletedHint
} from "../src/application/codex-app-server.js"
import { CodexServerIncarnation, CodexThreadId, CodexTurnId } from "../src/application/codex-attempt-store.js"

/** Controlled provider protocol; the production executor and integrator still own their workflows. */
export const makeControlledCodexContainment = (name: string, stateDirectory: string) =>
  Effect.gen(function* () {
    const closed = yield* Ref.make(false)
    const turnStarts = yield* Ref.make(0)
    const interrupts = yield* Ref.make(0)
    const threadStarts = yield* Ref.make(0)
    const bound = yield* Deferred.make<void>()
    const tools = yield* PubSub.unbounded<CodexToolEffectNotification>()
    const completions = yield* PubSub.unbounded<CodexTurnCompletedHint>()
    const thread = yield* Ref.make<CodexThreadSnapshot>({
      id: CodexThreadId.make(`thread-${name}`),
      cwd: CodexThreadWorkingDirectory.make("/not-started"),
      status: "idle",
      turns: []
    })
    const read = Effect.gen(function* () {
      if (yield* Ref.get(closed))
        return yield* new CodexAppServerFailure({
          kind: "Unavailable",
          operation: "thread/read",
          detail: "controlled containment is closed"
        })
      return yield* Ref.get(thread)
    })
    const close = Ref.getAndSet(closed, true).pipe(
      Effect.flatMap((alreadyClosed) => (alreadyClosed ? Effect.void : PubSub.shutdown(completions)))
    )
    const app = CodexAppServer.of({
      incarnation: CodexServerIncarnation.make(`incarnation-${name}`),
      unattendedPolicyAdmission: Effect.void,
      attachTurnCompletedHints: Effect.succeed(Stream.empty),
      attachOwnedActivityHints: Effect.succeed(Stream.empty),
      attachToolEffects: PubSub.subscribe(tools).pipe(
        Effect.map((subscription) => Stream.fromChannel(Channel.fromSubscriptionArray(subscription)))
      ),
      attachExactTurnCompletedHints: () =>
        PubSub.subscribe(completions).pipe(
          Effect.map((subscription) => ({
            hints: Stream.fromChannel(Channel.fromSubscriptionArray(subscription)),
            expectTurnId: () => Deferred.succeed(bound, undefined).pipe(Effect.asVoid)
          }))
        ),
      listThreadsComplete: true,
      listThreads: () =>
        Ref.get(threadStarts).pipe(
          Effect.flatMap((count) =>
            count === 0
              ? Effect.succeed([])
              : read.pipe(
                  Effect.map((current) => [CodexThreadListSummary.IdentityOnly({ id: current.id, cwd: current.cwd })])
                )
          )
        ),
      startThread: (cwd, ownedThreadToken) =>
        Effect.gen(function* () {
          yield* Ref.update(threadStarts, (count) => count + 1)
          const current = yield* Ref.get(thread)
          const started: CodexThreadSnapshot = {
            ...current,
            cwd: CodexThreadWorkingDirectory.make(cwd),
            ...(ownedThreadToken === undefined ? {} : { ownedThreadToken })
          }
          yield* Ref.set(thread, started)
          return started
        }),
      readThread: () => read,
      resumeThread: () => read,
      startTurn: (_thread, _cwd, _text, ownedTurnToken) =>
        Effect.gen(function* () {
          yield* Ref.update(turnStarts, (count) => count + 1)
          const turn = {
            id: CodexTurnId.make(`turn-${name}`),
            status: "inProgress" as const,
            items: [],
            ...(ownedTurnToken === undefined ? {} : { ownedTurnToken })
          }
          yield* Ref.update(thread, (current) => ({ ...current, status: "active" as const, turns: [turn] }))
          return turn
        }),
      interruptTurn: () =>
        Ref.update(interrupts, (count) => count + 1).pipe(
          Effect.andThen(
            Ref.update(thread, (current) => ({
              ...current,
              status: "idle" as const,
              turns: current.turns.map((turn) => ({ ...turn, status: "interrupted" as const }))
            }))
          )
        ),
      listBackgroundTerminals: () => Effect.succeed([]),
      terminateBackgroundTerminal: () => Effect.succeed(true),
      close
    })
    yield* Effect.addFinalizer(() => close)
    const complete = (text: string, status: "completed" | "failed" = "completed") =>
      Effect.gen(function* () {
        const current = yield* Ref.get(thread)
        const turn = current.turns[0]
        if (turn === undefined) return yield* Effect.die("controlled completion needs an admitted turn")
        yield* Ref.set(thread, {
          ...current,
          status: "idle",
          turns: [{ ...turn, status, items: [{ type: "agentMessage", text }] }]
        })
        yield* PubSub.publish(completions, { threadId: current.id, turnId: turn.id })
      })
    return { app, stateDirectory, closed, interrupts, turnStarts, bound, tools, read, complete }
  })
export type ControlledCodexContainment = Effect.Success<ReturnType<typeof makeControlledCodexContainment>>
