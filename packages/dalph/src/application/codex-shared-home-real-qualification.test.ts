/* eslint-disable import/no-nodejs-modules -- Qualification owns one local endpoint and exact disposable provider scopes. */
import { createServer } from "node:http"
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import nodeProcess from "node:process"
import { NodeServices } from "@effect/platform-node"
import { makeApplicationExitShell, ApplicationExitShell } from "@dalph/orchestrator"
import { Context, Duration, Effect, Layer, Option, Schema, Stream } from "effect"
import { expect, it } from "vitest"
import { CodexAppServer, codexAppServerNodeLayer } from "./codex-app-server.js"
import { CodexAttemptStore, nodeCodexAttemptStoreLayer } from "./codex-attempt-store.js"

const enabled = nodeProcess.env["DALPH_RUN_REAL_CODEX_QUALIFICATION"] === "1"
const qualify = enabled ? it : it.skip
const requestSchema = Schema.Struct({ input: Schema.Array(Schema.Unknown) })
const toolOutputSchema = Schema.Struct({ type: Schema.Literal("function_call_output") })

qualify(
  "shared home sustains independent turns and tools while one owner's Exit preserves its siblings",
  async () => {
    const root = await realpath(await mkdtemp(path.join(tmpdir(), "dalph-shared-home-real-")))
    const home = path.join(root, "provider-home")
    await mkdir(home, { mode: 0o700 })
    let requests = 0
    const server = createServer(async (request, response) => {
      const chunks: Array<Buffer> = []
      for await (const chunk of request) chunks.push(Buffer.from(chunk))
      const decoded = Schema.decodeUnknownSync(requestSchema)(JSON.parse(Buffer.concat(chunks).toString("utf8")))
      requests += 1
      const id = `shared-home-response-${requests}`
      const output = Schema.is(toolOutputSchema)(decoded.input.at(-1))
        ? {
            type: "message",
            role: "assistant",
            id: `message-${requests}`,
            content: [{ type: "output_text", text: "shared home turn complete" }]
          }
        : {
            type: "function_call",
            call_id: `tool-${requests}`,
            name: "exec_command",
            arguments: JSON.stringify({
              cmd: "printf '%s\\n' shared-home-tool >> .shared-home-tools",
              yield_time_ms: 1000
            })
          }
      response.writeHead(200, { "content-type": "text/event-stream" })
      for (const event of [
        { type: "response.created", response: { id } },
        { type: "response.output_item.done", item: output },
        { type: "response.completed", response: { id, usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 } } }
      ])
        response.write(`data: ${JSON.stringify(event)}\n\n`)
      response.end()
    })
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
    const address = server.address()
    if (address === null || typeof address === "string") throw new Error("local fixture did not bind")
    await writeFile(
      path.join(home, "config.toml"),
      [
        "features.plugins = false",
        'model = "shared-home-fixture"',
        'model_provider = "shared-home-fixture"',
        "[model_providers.shared-home-fixture]",
        'name = "Shared home fixture"',
        `base_url = "http://127.0.0.1:${address.port}/v1"`,
        'env_key = "DALPH_SHARED_HOME_FIXTURE_KEY"',
        'wire_api = "responses"',
        "request_max_retries = 0",
        "stream_max_retries = 0"
      ].join("\n")
    )
    try {
      await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const owners = yield* Effect.all(
              [0, 1, 2].map((ordinal) =>
                Effect.gen(function* () {
                  const cwd = path.join(root, `work-${ordinal}`)
                  yield* Effect.promise(() => mkdir(cwd))
                  const shell = yield* makeApplicationExitShell(
                    { release: Effect.void, runMutation: (mutation) => mutation },
                    { requestEnd: () => Effect.void }
                  )
                  const storeLayer = nodeCodexAttemptStoreLayer({ stateDirectory: path.join(root, `state-${ordinal}`) })
                  const appLayer = codexAppServerNodeLayer({
                    executable: nodeProcess.env["CODEX_BIN"] ?? path.resolve("node_modules/.bin/codex"),
                    environment: {
                      CODEX_HOME: home,
                      HOME: root,
                      PATH: nodeProcess.env["PATH"] ?? "/usr/bin:/bin",
                      DALPH_SHARED_HOME_FIXTURE_KEY: "local-fixture-key"
                    },
                    extendEnvironment: false
                  }).pipe(Layer.provide(Layer.succeed(ApplicationExitShell, shell)), Layer.provideMerge(storeLayer))
                  const context = yield* Layer.build(appLayer)
                  const app = Context.get(context, CodexAppServer)
                  const store = Context.get(context, CodexAttemptStore)
                  const startup = yield* store.readServerStartup()
                  expect(Option.isSome(startup)).toBe(true)
                  if (Option.isSome(startup)) expect(startup.value).toMatchObject({ _tag: "Initialized", home })
                  const thread = yield* app.startThread(cwd)
                  return { app, cwd, thread, shell, store }
                })
              ),
              { concurrency: "unbounded" }
            )
            const runTurn = (owner: (typeof owners)[number]) =>
              Effect.scoped(
                Effect.gen(function* () {
                  if (owner.app.attachExactTurnCompletedHints === undefined)
                    return yield* Effect.die("exact completion subscription is required")
                  const subscription = yield* owner.app.attachExactTurnCompletedHints(owner.thread.id)
                  const turn = yield* owner.app.startTurn(
                    owner.thread.id,
                    owner.cwd,
                    "Execute the fixture tool, then finish this turn."
                  )
                  yield* subscription.expectTurnId(turn.id)
                  expect(Option.isSome(yield* Stream.runHead(subscription.hints))).toBe(true)
                  const observed = yield* owner.app.readThread(owner.thread.id)
                  expect(observed.turns.find((item) => item.id === turn.id)?.status).toBe("completed")
                })
              ).pipe(Effect.timeout(Duration.seconds(15)))
            for (const round of [0, 1])
              yield* Effect.all(owners.map(runTurn), { concurrency: "unbounded" }).pipe(Effect.as(round))
            const [first, ...siblings] = owners
            if (first === undefined) return yield* Effect.die("three providers are required")
            yield* Effect.all(
              [
                first.shell.requestBoundary.requestExit.pipe(
                  Effect.tap((result) => Effect.sync(() => expect(result._tag).toBe("Succeeded")))
                ),
                ...siblings.map(runTurn)
              ],
              { concurrency: "unbounded" }
            )
            expect(yield* first.store.readServerLaunch()).toEqual(Option.none())
            expect(requests).toBe(16)
            for (const owner of siblings) {
              expect(Option.isSome(yield* owner.store.readServerLaunch())).toBe(true)
              const markers = yield* Effect.promise(() => readFile(path.join(owner.cwd, ".shared-home-tools"), "utf8"))
              expect(markers.trim().split("\n")).toHaveLength(3)
            }
            for (const owner of siblings)
              expect((yield* owner.shell.requestBoundary.requestExit)._tag).toBe("Succeeded")
          })
        ).pipe(Effect.provide(NodeServices.layer))
      )
      await rm(root, { recursive: true, force: true })
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error === undefined ? resolve() : reject(error)))
      )
    }
  },
  60_000
)
