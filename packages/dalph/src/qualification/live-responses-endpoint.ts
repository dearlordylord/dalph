/* eslint-disable import/no-nodejs-modules -- The protected qualification owns one loopback model endpoint. */
/* eslint-disable import-x/no-unused-modules -- Shipped qualification and external test-support consume these boundary contracts outside the production lint graph. */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http"
import type { Socket } from "node:net"
import nodePath from "node:path"
import { GitCommitSha } from "@dalph/contracts"
import { Effect, MutableHashSet, Ref, Schema } from "effect"

const baseUrlPattern = /^http:\/\/127\.0\.0\.1:\d+\/v1$/u
const secondTurn = 2
const successStatus = 200
const notFoundStatus = 404
const internalErrorStatus = 500

export class ProductionLiveResponsesEndpointFailure extends Schema.TaggedError<ProductionLiveResponsesEndpointFailure>()(
  "ProductionLiveResponsesEndpointFailure",
  { operation: Schema.Literals(["Listen", "ReadRequest", "Request", "ReadHead", "Close"]) }
) {}

/** Locates one canonical worktree named by the executor or Integrator prompt. */
export const ProductionLiveResponsesWorktreeLocator = Schema.NonEmptyString.check(
  Schema.makeFilter((value) =>
    nodePath.isAbsolute(value) && nodePath.normalize(value) === value
      ? undefined
      : "Responses worktree locator must be normalized and absolute"
  )
).pipe(Schema.brand("ProductionLiveResponsesWorktreeLocator"))
export type ProductionLiveResponsesWorktreeLocator = typeof ProductionLiveResponsesWorktreeLocator.Type

/** Locates the one loopback-only Responses API owned by the qualification scope. */
export const ProductionLiveResponsesEndpointLocator = Schema.String.check(
  Schema.makeFilter((value) => (baseUrlPattern.test(value) ? undefined : "Responses endpoint must be loopback-only"))
).pipe(Schema.brand("ProductionLiveResponsesEndpointLocator"))
export type ProductionLiveResponsesEndpointLocator = typeof ProductionLiveResponsesEndpointLocator.Type

export interface ProductionLiveResponsesCounts {
  readonly executor: number
  readonly integrator: number
  readonly total: number
}

export type ProductionLiveResponsesObservationTag =
  | "ExecutorRequest"
  | "ExecutorGitReadHead"
  | "IntegratorRequest"
  | "IntegratorGitReadHead"

export interface ProductionLiveResponsesObservation {
  readonly counts: ProductionLiveResponsesCounts
  readonly orderedTags: ReadonlyArray<ProductionLiveResponsesObservationTag>
}

export interface ProductionLiveResponsesEndpoint {
  readonly baseUrl: ProductionLiveResponsesEndpointLocator
  readonly observation: Effect.Effect<ProductionLiveResponsesObservation>
}

const stringsIn = (value: unknown): ReadonlyArray<string> => {
  if (typeof value === "string") return [value]
  if (Array.isArray(value)) return value.flatMap(stringsIn)
  if (typeof value !== "object" || value === null) return []
  return Object.values(value).flatMap(stringsIn)
}

const lineValue = (source: string, label: string): string | undefined => {
  const separatorWidth = 2
  const line = source.split("\n").find((candidate) => candidate.startsWith(`${label}: `))
  return line?.slice(label.length + separatorWidth)
}

const sse = (value: unknown) => `data: ${JSON.stringify(value)}\n\n`
const responseCreated = (id: string) => ({ type: "response.created", response: { id } })
const responseCompleted = (id: string) => ({
  type: "response.completed",
  response: { id, usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 } }
})
const functionCall = (id: string, command: string, workdir: ProductionLiveResponsesWorktreeLocator) => ({
  type: "response.output_item.done",
  item: {
    type: "function_call",
    call_id: `live-qualification-call-${id}`,
    name: "shell_command",
    arguments: JSON.stringify({ command, workdir, timeout_ms: 10_000 })
  }
})
const assistantMessage = (id: string, text: string) => ({
  type: "response.output_item.done",
  item: {
    type: "message",
    role: "assistant",
    id: `live-qualification-message-${id}`,
    content: [{ type: "output_text", text }]
  }
})

const readRequest = (request: IncomingMessage) =>
  Effect.tryPromise({
    try: () =>
      new Promise<unknown>((resolve, reject) => {
        let body = ""
        request.setEncoding("utf8")
        request.on("data", (chunk: string) => {
          body += chunk
        })
        request.on("end", () => {
          try {
            resolve(JSON.parse(body))
          } catch (error) {
            reject(error)
          }
        })
        request.on("error", reject)
      }),
    catch: () => new ProductionLiveResponsesEndpointFailure({ operation: "ReadRequest" })
  })

type TurnKind = "Executor" | "Integrator"
const promptOf = (input: unknown): { readonly kind: TurnKind; readonly text: string } | undefined => {
  const strings = stringsIn(input)
  const executor = strings.find((text) => text.includes("Dalph immutable attempt facts:"))
  if (executor !== undefined) return { kind: "Executor", text: executor }
  const integrator = strings.find((text) => text.includes("You are the Dalph integration provider."))
  return integrator === undefined ? undefined : { kind: "Integrator", text: integrator }
}

const send = (response: ServerResponse, id: string, item: unknown) => {
  response.writeHead(successStatus, { "content-type": "text/event-stream", "cache-control": "no-cache" })
  response.write(sse(responseCreated(id)))
  response.write(sse(item))
  response.write(sse(responseCompleted(id)))
  response.end()
}

interface ResponseTurn {
  readonly prompt: { readonly kind: TurnKind; readonly text: string }
  readonly worktree: ProductionLiveResponsesWorktreeLocator
  readonly ordinal: number
  readonly id: string
}

const requestFailure = () => new ProductionLiveResponsesEndpointFailure({ operation: "Request" })

const decodeResponseTurn = Effect.fn("ProductionLiveResponsesEndpoint.decodeTurn")(function* (
  input: unknown,
  observations: Ref.Ref<ProductionLiveResponsesObservation>
) {
  const prompt = promptOf(input)
  if (prompt === undefined) return yield* requestFailure()
  const worktree = yield* Schema.decodeUnknownEffect(ProductionLiveResponsesWorktreeLocator)(
    lineValue(prompt.text, prompt.kind === "Executor" ? "worktree" : "Candidate worktree")
  ).pipe(Effect.mapError(requestFailure))
  const ordinal = yield* Ref.modify(observations, (current) => {
    const field = prompt.kind === "Executor" ? "executor" : "integrator"
    const counts = { ...current.counts, [field]: current.counts[field] + 1, total: current.counts.total + 1 }
    return [counts[field], { counts, orderedTags: [...current.orderedTags, `${prompt.kind}Request`] }] as const
  })
  return { prompt, worktree, ordinal, id: `${prompt.kind.toLowerCase()}-${ordinal}` } satisfies ResponseTurn
})

const respondToFirstTurn = Effect.fn("ProductionLiveResponsesEndpoint.respondToFirstTurn")(function* (
  turn: ResponseTurn,
  response: ServerResponse
) {
  if (turn.prompt.kind === "Executor") {
    send(
      response,
      turn.id,
      functionCall(
        turn.id,
        "printf '%s\\n' 'Dalph protected live qualification' > LIVE-QUALIFICATION.md && git add LIVE-QUALIFICATION.md && git commit -m 'dalph live qualification' >/dev/null",
        turn.worktree
      )
    )
    return
  }
  const commit = yield* Schema.decodeUnknownEffect(GitCommitSha)(lineValue(turn.prompt.text, "Accepted commit C")).pipe(
    Effect.mapError(requestFailure)
  )
  send(
    response,
    turn.id,
    functionCall(turn.id, `git merge --no-ff ${commit} -m 'dalph live integration' >/dev/null`, turn.worktree)
  )
})

const respondToSecondTurn = Effect.fn("ProductionLiveResponsesEndpoint.respondToSecondTurn")(function* <E, R>(
  turn: ResponseTurn,
  response: ServerResponse,
  observations: Ref.Ref<ProductionLiveResponsesObservation>,
  readHead: (worktree: ProductionLiveResponsesWorktreeLocator) => Effect.Effect<string, E, R>
) {
  const head = yield* readHead(turn.worktree).pipe(
    Effect.flatMap(Schema.decodeUnknownEffect(GitCommitSha)),
    Effect.mapError(() => new ProductionLiveResponsesEndpointFailure({ operation: "ReadHead" }))
  )
  const readHeadTag: ProductionLiveResponsesObservationTag =
    turn.prompt.kind === "Executor" ? "ExecutorGitReadHead" : "IntegratorGitReadHead"
  yield* Ref.update(observations, (current) => ({ ...current, orderedTags: [...current.orderedTags, readHeadTag] }))
  if (turn.prompt.kind === "Integrator") {
    send(
      response,
      turn.id,
      assistantMessage(turn.id, JSON.stringify({ version: 1, outcome: "PreparedCandidate", candidate: head }))
    )
    return
  }
  const runId = lineValue(turn.prompt.text, "run_id")
  const attemptId = lineValue(turn.prompt.text, "attempt_id")
  if (runId === undefined || attemptId === undefined) return yield* requestFailure()
  send(
    response,
    turn.id,
    assistantMessage(turn.id, JSON.stringify({ commit: head, correlation: { runId, attemptId } }))
  )
})

const respondToTurn = Effect.fn("ProductionLiveResponsesEndpoint.respondToTurn")(function* <E, R>(
  turn: ResponseTurn,
  response: ServerResponse,
  observations: Ref.Ref<ProductionLiveResponsesObservation>,
  readHead: (worktree: ProductionLiveResponsesWorktreeLocator) => Effect.Effect<string, E, R>
) {
  if (turn.ordinal === 1) return yield* respondToFirstTurn(turn, response)
  if (turn.ordinal !== secondTurn) return yield* requestFailure()
  return yield* respondToSecondTurn(turn, response, observations, readHead)
})

const handleResponsesRequest = Effect.fn("ProductionLiveResponsesEndpoint.handleRequest")(function* <E, R>(
  request: IncomingMessage,
  response: ServerResponse,
  observations: Ref.Ref<ProductionLiveResponsesObservation>,
  readHead: (worktree: ProductionLiveResponsesWorktreeLocator) => Effect.Effect<string, E, R>
) {
  if (request.method !== "POST" || request.url?.split("?", 1)[0] !== "/v1/responses") {
    response.writeHead(notFoundStatus).end()
    return
  }
  const turn = yield* readRequest(request).pipe(Effect.flatMap((input) => decodeResponseTurn(input, observations)))
  yield* respondToTurn(turn, response, observations, readHead)
})

/**
 * Starts one Q-scoped Responses endpoint. It retains only safe ordered request
 * and Git-read tags plus their counts; prompts, tool output, provider response
 * bodies, thread IDs and turn IDs are discarded.
 */
export const makeProductionLiveResponsesEndpoint = Effect.fn("ProductionLiveResponsesEndpoint.make")(function* <E, R>(
  readHead: (worktree: ProductionLiveResponsesWorktreeLocator) => Effect.Effect<string, E, R>
) {
  const observations = yield* Ref.make<ProductionLiveResponsesObservation>({
    counts: { executor: 0, integrator: 0, total: 0 },
    orderedTags: []
  })
  const context = yield* Effect.context<R>()
  const runPromise = Effect.runPromiseWith(context)
  const sockets = MutableHashSet.empty<Socket>()
  const server = createServer((request, response) => {
    request.socket.once("close", () => MutableHashSet.remove(sockets, request.socket))
    MutableHashSet.add(sockets, request.socket)
    void runPromise(
      handleResponsesRequest(request, response, observations, readHead).pipe(
        Effect.catch(() =>
          Effect.sync(() => {
            if (!response.headersSent) response.writeHead(internalErrorStatus)
            response.end()
          })
        )
      )
    )
  })
  const baseUrl = yield* Effect.acquireRelease(
    Effect.tryPromise({
      try: () =>
        new Promise<ProductionLiveResponsesEndpointLocator>((resolve, reject) => {
          server.once("error", reject)
          server.listen(0, "127.0.0.1", () => {
            const address = server.address()
            if (address === null || typeof address === "string") return reject(new Error("missing loopback address"))
            const selected = `http://127.0.0.1:${address.port}/v1`
            if (!baseUrlPattern.test(selected)) return reject(new Error("invalid loopback address"))
            resolve(ProductionLiveResponsesEndpointLocator.make(selected))
          })
        }),
      catch: () => new ProductionLiveResponsesEndpointFailure({ operation: "Listen" })
    }),
    () =>
      Effect.tryPromise({
        try: () =>
          new Promise<void>((resolve, reject) => {
            for (const socket of sockets) socket.destroy()
            server.close((error) => (error === undefined ? resolve() : reject(error)))
          }),
        catch: () => new ProductionLiveResponsesEndpointFailure({ operation: "Close" })
      }).pipe(Effect.ignore)
  )
  return { baseUrl, observation: Ref.get(observations) } satisfies ProductionLiveResponsesEndpoint
})
