import { Context, Crypto, Effect, Layer, Ref, Stream } from "effect"
import { NodeCrypto } from "@effect/platform-node"
import {
  CodexAppServer,
  CodexAppServerFailure,
  CodexOwnedActivityCensus,
  CodexThreadWorkingDirectory,
  type CodexAppServerService,
  type CodexOwnedActivityCensusProjection,
  CodexThreadListSummary,
  type CodexThreadSnapshot,
  type CodexTurnSnapshot
} from "./codex-app-server.js"
import { KimiAcpClient, KimiAcpSessionId, type KimiAcpSessionObservation } from "./kimi-acp.js"
import {
  CodexOwnedTurnToken,
  CodexServerIncarnation,
  CodexThreadId,
  type CodexThreadOwnershipToken,
  CodexTurnId
} from "./codex-attempt-store.js"
import { codexIntegratorLayer } from "./codex-integrator.js"
import {
  type CodexIntegratorConfiguration,
  nodeCodexIntegratorPrivateStoreLayer
} from "./codex-integrator-private-store.js"

const operationFailure = (
  operation: ConstructorParameters<typeof CodexAppServerFailure>[0]["operation"],
  detail: string,
  kind: ConstructorParameters<typeof CodexAppServerFailure>[0]["kind"] = "Protocol"
): CodexAppServerFailure => new CodexAppServerFailure({ operation, kind, detail })

const threadIdFor = (sessionId: string): CodexThreadId => CodexThreadId.make(`kimi:${sessionId}`)
const sessionIdFor = (threadId: CodexThreadId): string => threadId.slice("kimi:".length)
const turnIdFor = (threadId: CodexThreadId, token: CodexOwnedTurnToken): CodexTurnId =>
  CodexTurnId.make(`${threadId}:${token}`)

const mapFailure =
  <A>(operation: ConstructorParameters<typeof CodexAppServerFailure>[0]["operation"]) =>
  (effect: Effect.Effect<A, unknown>): Effect.Effect<A, CodexAppServerFailure> =>
    effect.pipe(
      Effect.mapError((error) => operationFailure(operation, error instanceof Error ? error.message : String(error)))
    )

const turnFor = (
  threadId: CodexThreadId,
  token: CodexOwnedTurnToken,
  observation: KimiAcpSessionObservation
): CodexTurnSnapshot => ({
  id: turnIdFor(threadId, token),
  status:
    observation.status === "executing"
      ? "inProgress"
      : observation.status === "unavailable"
        ? "failed"
        : observation.stopReason !== undefined && /fail|error|cancel/iu.test(observation.stopReason)
          ? "failed"
          : "completed",
  ownedTurnToken: token,
  items: observation.lastMessage === undefined ? [] : [{ type: "agentMessage", text: observation.lastMessage }]
})

const threadFor = (
  sessionId: string,
  cwd: string,
  observation: KimiAcpSessionObservation,
  turn?: CodexTurnSnapshot,
  ownedThreadToken?: CodexThreadOwnershipToken
): CodexThreadSnapshot => ({
  id: threadIdFor(sessionId),
  cwd: CodexThreadWorkingDirectory.make(cwd),
  status: observation.status === "executing" ? "active" : observation.status === "unavailable" ? "systemError" : "idle",
  turns: turn === undefined ? [] : [turn],
  ...(ownedThreadToken === undefined ? {} : { ownedThreadToken })
})

/**
 * Adapts the provider-neutral Integrator core to Kimi ACP. The Integrator
 * lifecycle, private record, candidate worktree, and cleanup rules remain
 * shared with Codex; only this process/session protocol differs.
 */
export const kimiIntegratorProviderLayer = Layer.effectContext(
  Effect.gen(function* () {
    const client = yield* KimiAcpClient
    const crypto = yield* Crypto.Crypto
    const incarnation = CodexServerIncarnation.make(
      `kimi-integrator:${yield* crypto.randomUUIDv4.pipe(Effect.mapError((error) => operationFailure("initialize", String(error))))}`
    )
    const threadTokens = yield* Ref.make<ReadonlyMap<string, CodexThreadOwnershipToken>>(new Map())
    const turns = yield* Ref.make<ReadonlyMap<string, CodexTurnSnapshot>>(new Map())
    const app: CodexAppServerService = {
      incarnation,
      attachTurnCompletedHints: Effect.succeed(Stream.empty),
      attachOwnedActivityHints: Effect.succeed(Stream.empty),
      startThread: (cwd, ownedThreadToken) =>
        client.newSession(cwd).pipe(
          mapFailure("thread/start"),
          Effect.flatMap((sessionId) => {
            const remember =
              ownedThreadToken === undefined
                ? Effect.void
                : Ref.update(threadTokens, (current) => new Map([...current, [sessionId, ownedThreadToken]] as const))
            return remember.pipe(
              Effect.andThen(client.observe(sessionId)),
              mapFailure("thread/start"),
              Effect.map((observation) => threadFor(sessionId, cwd, observation, undefined, ownedThreadToken))
            )
          })
        ),
      listThreads: () =>
        Effect.gen(function* () {
          const sessions = yield* Ref.get(threadTokens)
          return yield* Effect.forEach(sessions.keys(), (sessionId) =>
            client.observe(clientSessionId(sessionId)).pipe(
              mapFailure("thread/list"),
              Effect.map((observation) =>
                CodexThreadListSummary.IdentityOnly({
                  id: threadIdFor(sessionId),
                  cwd: CodexThreadWorkingDirectory.make(observation.cwd)
                })
              )
            )
          )
        }),
      listThreadsComplete: true,
      readThread: (threadId) => {
        const sessionId = sessionIdFor(threadId)
        return Effect.gen(function* () {
          const tokenMap = yield* Ref.get(threadTokens)
          const turnMap = yield* Ref.get(turns)
          const observation = yield* client.observe(clientSessionId(sessionId)).pipe(mapFailure("thread/read"))
          return threadFor(sessionId, observation.cwd, observation, turnMap.get(sessionId), tokenMap.get(sessionId))
        })
      },
      resumeThread: (threadId, cwd) => {
        const sessionId = sessionIdFor(threadId)
        return client.resumeSession(clientSessionId(sessionId), cwd).pipe(
          mapFailure("thread/resume"),
          Effect.flatMap((restored) =>
            Effect.gen(function* () {
              const tokenMap = yield* Ref.get(threadTokens)
              const turnMap = yield* Ref.get(turns)
              const observation = yield* client.observe(restored).pipe(mapFailure("thread/resume"))
              return threadFor(restored, cwd, observation, turnMap.get(restored), tokenMap.get(restored))
            })
          )
        )
      },
      startTurn: (threadId, _cwd, text, ownedTurnToken) => {
        const sessionId = sessionIdFor(threadId)
        return Effect.gen(function* () {
          const token =
            ownedTurnToken ??
            CodexOwnedTurnToken.make(
              `kimi-integrator:${yield* crypto.randomUUIDv4.pipe(Effect.mapError((error) => operationFailure("turn/start", String(error))))}`
            )
          yield* client.prompt(clientSessionId(sessionId), text).pipe(mapFailure("turn/start"))
          const observation = yield* client.observe(clientSessionId(sessionId)).pipe(mapFailure("turn/start"))
          const turn = turnFor(threadId, token, observation)
          yield* Ref.update(turns, (current) => new Map([...current, [sessionId, turn]] as const))
          return turn
        })
      },
      interruptTurn: (threadId) =>
        client.cancel(clientSessionId(sessionIdFor(threadId))).pipe(mapFailure("turn/interrupt")),
      listBackgroundTerminals: () => Effect.succeed([]),
      terminateBackgroundTerminal: () => Effect.succeed(false),
      close: client.close().pipe(Effect.mapError((error) => operationFailure("close", String(error))))
    }
    const census = CodexOwnedActivityCensus.of({
      observe: (thread, _terminals) =>
        thread.status === "active"
          ? Effect.succeed<CodexOwnedActivityCensusProjection>({ _tag: "ExactLive", activities: [] })
          : Effect.succeed<CodexOwnedActivityCensusProjection>({ _tag: "Absent" }),
      terminateDescendants: () => Effect.void
    })
    return Context.empty().pipe(Context.add(CodexAppServer, app), Context.add(CodexOwnedActivityCensus, census))
  })
)

/** Kimi-backed Integrator using the shared candidate, lineage, and cleanup core. */
export const nodeKimiIntegratorLayer = <E, R>(
  config: CodexIntegratorConfiguration,
  clientLayer: Layer.Layer<KimiAcpClient, E, R>
) =>
  codexIntegratorLayer(config).pipe(
    Layer.provide(nodeCodexIntegratorPrivateStoreLayer(config)),
    Layer.provide(kimiIntegratorProviderLayer.pipe(Layer.provide(clientLayer))),
    Layer.provide(NodeCrypto.layer)
  )

const clientSessionId = (value: string): KimiAcpSessionId => KimiAcpSessionId.make(value)
