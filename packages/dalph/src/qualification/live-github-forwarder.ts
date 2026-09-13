/* eslint-disable import/no-nodejs-modules -- Q owns one loopback forwarding endpoint. */
/* eslint-disable import-x/no-unused-modules -- Shipped qualification and external test-support consume these boundary contracts outside the production lint graph. */
import {
  createServer,
  request as httpRequest,
  type IncomingHttpHeaders,
  type IncomingMessage,
  type ServerResponse
} from "node:http"
import { request as httpsRequest } from "node:https"
import { Buffer } from "node:buffer"
import { createHash } from "node:crypto"
import type { Socket } from "node:net"
import { EvidenceDigest } from "@dalph/contracts"
import { GithubLabelName, GithubLabelNodeId } from "@dalph/orchestrator"
import { Effect, MutableHashSet, Option, Ref, Schema } from "effect"

const RequestShape = Schema.Struct({ query: Schema.String })
export const productionLiveGithubOperationTags = [
  "ResolveIssue",
  "ResolveRepository",
  "ReadIssue",
  "ReadIssueDetails",
  "ReadTaskWorkSpecification",
  "ReadSubIssues",
  "ReadBlockedBy",
  "FindClaimLabel",
  "CreateClaimLabel",
  "DeleteClaimLabel",
  "CloseIssue",
  "Unrecognized"
] as const
export type ProductionLiveGithubOperationTag = (typeof productionLiveGithubOperationTags)[number]
const CreateClaimLabelResponse = Schema.Struct({
  data: Schema.Struct({
    createLabel: Schema.Struct({
      label: Schema.Struct({ id: GithubLabelNodeId, name: GithubLabelName, description: Schema.NonEmptyString })
    })
  })
})

export interface ProductionLiveCreatedLabelReceipt {
  readonly nodeId: GithubLabelNodeId
  readonly name: GithubLabelName
  readonly fingerprint: EvidenceDigest
}

export interface ProductionLiveGithubForwarderObservation {
  readonly requestCount: number
  readonly orderedOperations: ReadonlyArray<ProductionLiveGithubOperationTag>
  readonly createdLabels: ReadonlyArray<ProductionLiveCreatedLabelReceipt>
}

export interface ProductionLiveGithubForwarder {
  readonly endpoint: string
  readonly observation: Effect.Effect<ProductionLiveGithubForwarderObservation>
}

export class ProductionLiveGithubForwarderFailure extends Schema.TaggedError<ProductionLiveGithubForwarderFailure>()(
  "ProductionLiveGithubForwarderFailure",
  { operation: Schema.Literals(["Listen", "Read", "Forward", "Close"]) }
) {}
const badGatewayStatus = 502

const forwardBytes = (upstream: string, headers: Readonly<Record<string, string>>, body: Uint8Array) =>
  Effect.tryPromise({
    try: () =>
      new Promise<{ readonly body: Uint8Array; readonly headers: IncomingHttpHeaders; readonly status: number }>(
        (resolve, reject) => {
          const selected = upstream.startsWith("https:") ? httpsRequest : httpRequest
          const outgoing = selected(upstream, { method: "POST", headers }, (incoming) => {
            const chunks: Array<Uint8Array> = []
            // eslint-disable-next-line functional/immutable-data -- Node delivers one response body as incremental stream chunks.
            incoming.on("data", (chunk: Uint8Array) => chunks.push(chunk))
            incoming.on("end", () =>
              resolve({
                body: Buffer.concat(chunks),
                headers: incoming.headers,
                status: incoming.statusCode ?? badGatewayStatus
              })
            )
          })
          outgoing.on("error", reject)
          outgoing.end(Buffer.from(body))
        }
      ),
    catch: () => new ProductionLiveGithubForwarderFailure({ operation: "Forward" })
  })

const readBytes = (request: IncomingMessage) =>
  Effect.tryPromise({
    try: () =>
      new Promise<Uint8Array>((resolve, reject) => {
        const chunks: Array<Uint8Array> = []
        // eslint-disable-next-line functional/immutable-data -- Node delivers one request body as incremental stream chunks.
        request.on("data", (chunk: Uint8Array) => chunks.push(chunk))
        request.on("end", () => resolve(Buffer.concat(chunks)))
        request.on("error", reject)
      }),
    catch: () => new ProductionLiveGithubForwarderFailure({ operation: "Read" })
  })

const isCreateClaimLabel = (bytes: Uint8Array) => {
  try {
    const decoded = Schema.decodeUnknownSync(RequestShape)(JSON.parse(new TextDecoder().decode(bytes)))
    return decoded.query.includes("mutation CreateClaimLabel")
  } catch {
    return false
  }
}

const operationTag = (bytes: Uint8Array): ProductionLiveGithubOperationTag => {
  try {
    const decoded = Schema.decodeUnknownSync(RequestShape)(JSON.parse(new TextDecoder().decode(bytes)))
    const operation = /\b(?:query|mutation)\s+([A-Za-z_][A-Za-z0-9_]*)/u.exec(decoded.query)?.[1]
    return productionLiveGithubOperationTags.find((tag) => tag === operation) ?? "Unrecognized"
  } catch {
    return "Unrecognized"
  }
}

const decodeCreateReceipt = (bytes: Uint8Array) => {
  try {
    return Schema.decodeUnknownOption(CreateClaimLabelResponse)(JSON.parse(new TextDecoder().decode(bytes)))
  } catch {
    return Option.none()
  }
}

/** Forwards once and retains only safe operation tags, counts, and decoded label receipts. */
export const makeProductionLiveGithubForwarder = Effect.fn("ProductionLiveGithubForwarder.make")(function* (
  upstream: string
) {
  const operations = yield* Ref.make<ReadonlyArray<ProductionLiveGithubOperationTag>>([])
  const labels = yield* Ref.make<ReadonlyMap<GithubLabelNodeId, ProductionLiveCreatedLabelReceipt>>(new Map())
  const sockets = MutableHashSet.empty<Socket>()
  const context = yield* Effect.context<never>()
  const runPromise = Effect.runPromiseWith(context)
  const header = (value: string | ReadonlyArray<string> | undefined, fallback: string) =>
    Array.isArray(value) ? (value[0] ?? fallback) : (value ?? fallback)
  const handle = (request: IncomingMessage, response: ServerResponse) =>
    runPromise(
      Effect.gen(function* () {
        const body = yield* readBytes(request)
        yield* Ref.update(operations, (current) => [...current, operationTag(body)])
        const forwarded = yield* forwardBytes(
          upstream,
          {
            accept: header(request.headers.accept, "application/json"),
            authorization: header(request.headers.authorization, ""),
            "content-type": header(request.headers["content-type"], "application/json"),
            "user-agent": header(request.headers["user-agent"], "dalph-orchestrator"),
            "x-github-next-global-id": header(request.headers["x-github-next-global-id"], "1")
          },
          body
        )
        const responseBytes = forwarded.body
        if (isCreateClaimLabel(body)) {
          const receipt = decodeCreateReceipt(responseBytes)
          if (Option.isSome(receipt)) {
            const decoded = receipt.value
            const label = decoded.data.createLabel.label
            yield* Ref.update(
              labels,
              (current) =>
                new Map([
                  ...current,
                  [
                    label.id,
                    {
                      nodeId: label.id,
                      name: label.name,
                      fingerprint: EvidenceDigest.make(createHash("sha256").update(label.description).digest("hex"))
                    }
                  ]
                ])
            )
          }
        }
        response.writeHead(forwarded.status, forwarded.headers)
        response.end(responseBytes)
      })
    ).catch(() => {
      if (!response.headersSent) response.writeHead(badGatewayStatus)
      response.end()
    })
  const server = createServer(handle)
  server.on("connection", (socket) => {
    MutableHashSet.add(sockets, socket)
    socket.once("close", () => MutableHashSet.remove(sockets, socket))
  })
  yield* Effect.acquireRelease(
    Effect.tryPromise({
      try: () =>
        new Promise<void>((resolve, reject) => {
          server.once("error", reject)
          server.listen(0, "127.0.0.1", resolve)
        }),
      catch: () => new ProductionLiveGithubForwarderFailure({ operation: "Listen" })
    }),
    () =>
      Effect.tryPromise({
        try: () =>
          new Promise<void>((resolve) => {
            for (const socket of sockets) socket.destroy()
            server.close(() => resolve())
          }),
        catch: () => new ProductionLiveGithubForwarderFailure({ operation: "Close" })
      }).pipe(Effect.ignore)
  )
  const address = server.address()
  if (address === null || typeof address === "string")
    return yield* new ProductionLiveGithubForwarderFailure({ operation: "Listen" })
  return {
    endpoint: `http://127.0.0.1:${address.port}/graphql`,
    observation: Effect.all({
      requestCount: Ref.get(operations).pipe(Effect.map((tags) => tags.length)),
      orderedOperations: Ref.get(operations),
      createdLabels: Ref.get(labels).pipe(Effect.map((receipts) => Array.from(receipts.values())))
    })
  } satisfies ProductionLiveGithubForwarder
})
