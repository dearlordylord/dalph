import { NodeHttpClient } from "@effect/platform-node"
import { PlannedAttemptExecutorCorrelation } from "@dalph/contracts"
import { githubGraphqlClientLayer, type TargetPromotionGitRequest } from "@dalph/orchestrator"
import { Effect, Layer, Schema, Stream } from "effect"
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/unstable/http"
import { BoundaryReached } from "./production-hermetic-contract.js"
import { CodexAppServer, CodexAppServerFailure, CodexThreadWorkingDirectory } from "./codex-app-server.js"
import {
  CodexOwnedTurnToken,
  type CodexServerIncarnation,
  CodexThreadId,
  CodexThreadOwnershipToken,
  CodexTurnId
} from "./codex-attempt-store.js"
import type { ProductionRepositoryHostConfiguration } from "./production-configuration.js"

type CodexAppServerOperation = CodexAppServerFailure["operation"]

const isHermeticControllerOrigin = (url: URL): boolean =>
  url.protocol === "http:" &&
  url.hostname === "127.0.0.1" &&
  url.port !== "" &&
  url.pathname === "/" &&
  url.username === "" &&
  url.password === "" &&
  url.search === "" &&
  url.hash === ""

/** The qualification child can contact only its parent controller's loopback endpoint. */
export const HermeticControllerEndpoint = Schema.NonEmptyString.check(
  Schema.makeFilter((value) => {
    try {
      const url = new URL(value)
      return isHermeticControllerOrigin(url)
        ? undefined
        : "hermetic controller endpoint must be a credential-free loopback origin"
    } catch {
      return "hermetic controller endpoint is not a URL"
    }
  })
).pipe(Schema.brand("HermeticControllerEndpoint"))
export type HermeticControllerEndpoint = typeof HermeticControllerEndpoint.Type

/** Only the existing Codex outer boundary methods cross this qualification transport. */
export const HermeticCodexRequest = Schema.TaggedUnion({
  StartThread: { cwd: CodexThreadWorkingDirectory, ownedThreadToken: Schema.optionalKey(CodexThreadOwnershipToken) },
  ReadThread: { threadId: CodexThreadId },
  ResumeThread: { threadId: CodexThreadId, cwd: CodexThreadWorkingDirectory },
  StartTurn: {
    threadId: CodexThreadId,
    cwd: CodexThreadWorkingDirectory,
    text: Schema.String,
    ownedTurnToken: Schema.optionalKey(CodexOwnedTurnToken)
  },
  InterruptTurn: { threadId: CodexThreadId, turnId: CodexTurnId },
  ListThreads: {},
  ListBackgroundTerminals: { threadId: CodexThreadId },
  TerminateBackgroundTerminal: { threadId: CodexThreadId, processId: Schema.NonEmptyString },
  Close: {}
})
export type HermeticCodexRequest = typeof HermeticCodexRequest.Type

const HermeticCodexTurn = Schema.Struct({
  id: CodexTurnId,
  status: Schema.Literals(["completed", "interrupted", "failed", "inProgress"]),
  items: Schema.Array(Schema.Unknown),
  ownedTurnToken: Schema.optionalKey(CodexOwnedTurnToken),
  correlation: Schema.optionalKey(PlannedAttemptExecutorCorrelation)
})
const HermeticCodexThread = Schema.Struct({
  id: CodexThreadId,
  cwd: CodexThreadWorkingDirectory,
  status: Schema.Literals(["active", "idle", "notLoaded", "systemError"]),
  turns: Schema.Array(HermeticCodexTurn),
  ownedThreadToken: Schema.optionalKey(CodexThreadOwnershipToken),
  correlation: Schema.optionalKey(PlannedAttemptExecutorCorrelation)
})
const HermeticCodexThreadSummary = Schema.TaggedUnion({
  IdentityOnly: { id: CodexThreadId, cwd: CodexThreadWorkingDirectory },
  CompleteSummary: {
    id: CodexThreadId,
    cwd: CodexThreadWorkingDirectory,
    summary: Schema.Struct({
      status: Schema.Literals(["active", "idle", "notLoaded", "systemError"]),
      turns: Schema.Array(HermeticCodexTurn)
    })
  }
})
const HermeticBackgroundTerminal = Schema.Struct({
  processId: Schema.NonEmptyString,
  itemId: Schema.NonEmptyString,
  command: Schema.String,
  cwd: Schema.String,
  osPid: Schema.optionalKey(Schema.NullOr(Schema.Finite))
})

const requestCodex = Effect.fn("HermeticProviderBridge.requestCodex")(function* (
  client: HttpClient.HttpClient,
  endpoint: HermeticControllerEndpoint,
  request: HermeticCodexRequest,
  operation: CodexAppServerOperation
) {
  return yield* HttpClientRequest.post(`${endpoint}/codex`).pipe(
    HttpClientRequest.bodyJson(request),
    Effect.flatMap(client.execute),
    Effect.flatMap(HttpClientResponse.filterStatusOk),
    Effect.flatMap((response) => response.json),
    Effect.mapError(
      () => new CodexAppServerFailure({ operation, kind: "Unavailable", detail: "hermetic provider boundary failed" })
    )
  )
})

/** The real GitHub GraphQL client still classifies HTTP responses, including the controlled 429. */
export const hermeticGithubClientLayer = (
  endpoint: HermeticControllerEndpoint,
  configuration: ProductionRepositoryHostConfiguration
) => {
  const transport = Layer.effect(
    HttpClient.HttpClient,
    Effect.map(HttpClient.HttpClient, HttpClient.mapRequest(HttpClientRequest.setUrl(`${endpoint}/github`)))
  ).pipe(Layer.provide(NodeHttpClient.layerUndici))
  return githubGraphqlClientLayer({ token: configuration.githubToken }).pipe(Layer.provide(transport))
}

/** The same parent-owned provider recordings back the ordinary executor and Integrator in both children. */
export const hermeticCodexAppServerLayer = (
  endpoint: HermeticControllerEndpoint,
  incarnation: CodexServerIncarnation
) =>
  Layer.effect(
    CodexAppServer,
    Effect.gen(function* () {
      const client = yield* HttpClient.HttpClient
      const decodeThread = Schema.decodeUnknownEffect(HermeticCodexThread)
      const request = (value: HermeticCodexRequest, operation: CodexAppServerOperation) =>
        requestCodex(client, endpoint, value, operation)
      const unavailable = (operation: CodexAppServerOperation, failure: unknown) =>
        failure instanceof CodexAppServerFailure
          ? failure
          : new CodexAppServerFailure({
              operation,
              kind: "Protocol",
              detail: "hermetic provider returned invalid boundary data"
            })
      return CodexAppServer.of({
        incarnation,
        attachTurnCompletedHints: Effect.succeed(Stream.empty),
        attachOwnedActivityHints: Effect.succeed(Stream.empty),
        listThreadsComplete: true,
        startThread: Effect.fn("HermeticProviderBridge.startThread")(function* (cwd, ownedThreadToken) {
          return yield* request(
            {
              _tag: "StartThread",
              cwd: CodexThreadWorkingDirectory.make(cwd),
              ...(ownedThreadToken === undefined ? {} : { ownedThreadToken })
            },
            "thread/start"
          ).pipe(
            Effect.flatMap(decodeThread),
            Effect.mapError((failure) => unavailable("thread/start", failure))
          )
        }),
        readThread: (threadId) =>
          request({ _tag: "ReadThread", threadId }, "thread/read").pipe(
            Effect.flatMap(decodeThread),
            Effect.mapError((failure) => unavailable("thread/read", failure))
          ),
        resumeThread: (threadId, cwd) =>
          request({ _tag: "ResumeThread", threadId, cwd: CodexThreadWorkingDirectory.make(cwd) }, "thread/resume").pipe(
            Effect.flatMap(decodeThread),
            Effect.mapError((failure) => unavailable("thread/resume", failure))
          ),
        startTurn: (threadId, cwd, text, ownedTurnToken) =>
          request(
            {
              _tag: "StartTurn",
              threadId,
              cwd: CodexThreadWorkingDirectory.make(cwd),
              text,
              ...(ownedTurnToken === undefined ? {} : { ownedTurnToken })
            },
            "turn/start"
          ).pipe(
            Effect.flatMap(Schema.decodeUnknownEffect(HermeticCodexTurn)),
            Effect.mapError((failure) => unavailable("turn/start", failure))
          ),
        interruptTurn: (threadId, turnId) =>
          request({ _tag: "InterruptTurn", threadId, turnId }, "turn/interrupt").pipe(Effect.asVoid),
        listThreads: () =>
          request({ _tag: "ListThreads" }, "thread/list").pipe(
            Effect.flatMap(Schema.decodeUnknownEffect(Schema.Array(HermeticCodexThreadSummary))),
            Effect.mapError((failure) => unavailable("thread/list", failure))
          ),
        listBackgroundTerminals: (threadId) =>
          request({ _tag: "ListBackgroundTerminals", threadId }, "thread/backgroundTerminals/list").pipe(
            Effect.flatMap(Schema.decodeUnknownEffect(Schema.Array(HermeticBackgroundTerminal))),
            Effect.mapError((failure) => unavailable("thread/backgroundTerminals/list", failure))
          ),
        terminateBackgroundTerminal: (threadId, processId) =>
          request(
            { _tag: "TerminateBackgroundTerminal", threadId, processId },
            "thread/backgroundTerminals/terminate"
          ).pipe(
            Effect.flatMap(Schema.decodeUnknownEffect(Schema.Boolean)),
            Effect.mapError((failure) => unavailable("thread/backgroundTerminals/terminate", failure))
          ),
        close: request({ _tag: "Close" }, "close").pipe(Effect.asVoid)
      })
    })
  ).pipe(Layer.provide(NodeHttpClient.layerUndici))

/** Synchronizes before the real expected-head command; its result is never replaced. */
export const hermeticPromotionCompareAndSetObserver = (endpoint: HermeticControllerEndpoint) =>
  Effect.fn("HermeticProviderBridge.promotionCompareAndSet")(
    function* (request: TargetPromotionGitRequest) {
      const client = yield* HttpClient.HttpClient
      const boundary = BoundaryReached.cases.PromotionCompareAndSet.make(request)
      yield* HttpClientRequest.post(`${endpoint}/boundary`).pipe(
        HttpClientRequest.bodyJson(boundary),
        Effect.flatMap(client.execute),
        Effect.flatMap(HttpClientResponse.filterStatusOk)
      )
    },
    Effect.provide(NodeHttpClient.layerUndici),
    Effect.orDie
  )
