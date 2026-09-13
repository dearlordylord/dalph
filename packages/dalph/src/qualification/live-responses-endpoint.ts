/* eslint-disable import/no-nodejs-modules -- The protected qualification owns one loopback model endpoint. */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http"
import type { Socket } from "node:net"
import nodePath from "node:path"
import { GitCommitSha } from "@dalph/contracts"
import { Effect, Ref, Schema } from "effect"

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
  const sockets = new Set<Socket>()
  const server = createServer((request, response) => {
    request.socket.once("close", () => sockets.delete(request.socket))
    sockets.add(request.socket)
    void runPromise(
      Effect.gen(function* () {
        if (request.method !== "POST" || request.url?.split("?", 1)[0] !== "/v1/responses") {
          response.writeHead(notFoundStatus).end()
          return
        }
        const input = yield* readRequest(request)
        const prompt = promptOf(input)
        if (prompt === undefined) return yield* new ProductionLiveResponsesEndpointFailure({ operation: "Request" })
        const worktree = yield* Schema.decodeUnknownEffect(ProductionLiveResponsesWorktreeLocator)(
          lineValue(prompt.text, prompt.kind === "Executor" ? "worktree" : "Candidate worktree")
        ).pipe(Effect.mapError(() => new ProductionLiveResponsesEndpointFailure({ operation: "Request" })))
        const ordinal = yield* Ref.modify(observations, (current) => {
          const field = prompt.kind === "Executor" ? "executor" : "integrator"
          const counts = { ...current.counts, [field]: current.counts[field] + 1, total: current.counts.total + 1 }
          return [counts[field], { counts, orderedTags: [...current.orderedTags, `${prompt.kind}Request`] }] as const
        })
        const id = `${prompt.kind.toLowerCase()}-${ordinal}`
        if (ordinal === 1) {
          if (prompt.kind === "Executor") {
            send(
              response,
              id,
              functionCall(
                id,
                "printf '%s\\n' 'Dalph protected live qualification' > LIVE-QUALIFICATION.md && git add LIVE-QUALIFICATION.md && git commit -m 'dalph live qualification' >/dev/null",
                worktree
              )
            )
            return
          }
          const accepted = lineValue(prompt.text, "Accepted commit C")
          const commit = yield* Schema.decodeUnknownEffect(GitCommitSha)(accepted).pipe(
            Effect.mapError(() => new ProductionLiveResponsesEndpointFailure({ operation: "Request" }))
          )
          send(
            response,
            id,
            functionCall(id, `git merge --no-ff ${commit} -m 'dalph live integration' >/dev/null`, worktree)
          )
          return
        }
        if (ordinal !== secondTurn) return yield* new ProductionLiveResponsesEndpointFailure({ operation: "Request" })
        const head = yield* readHead(worktree).pipe(
          Effect.flatMap(Schema.decodeUnknownEffect(GitCommitSha)),
          Effect.mapError(() => new ProductionLiveResponsesEndpointFailure({ operation: "ReadHead" }))
        )
        const readHeadTag: ProductionLiveResponsesObservationTag =
          prompt.kind === "Executor" ? "ExecutorGitReadHead" : "IntegratorGitReadHead"
        yield* Ref.update(observations, (current) => ({
          ...current,
          orderedTags: [...current.orderedTags, readHeadTag]
        }))
        if (prompt.kind === "Integrator") {
          send(
            response,
            id,
            assistantMessage(id, JSON.stringify({ version: 1, outcome: "PreparedCandidate", candidate: head }))
          )
          return
        }
        const runId = lineValue(prompt.text, "run_id")
        const attemptId = lineValue(prompt.text, "attempt_id")
        if (runId === undefined || attemptId === undefined)
          return yield* new ProductionLiveResponsesEndpointFailure({ operation: "Request" })
        send(response, id, assistantMessage(id, JSON.stringify({ commit: head, correlation: { runId, attemptId } })))
      }).pipe(
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
