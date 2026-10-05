/* eslint-disable import/no-nodejs-modules -- These transport proofs execute the built CLI and stdio MCP clients. */
import { execFile } from "node:child_process"
import process from "node:process"
import { fileURLToPath } from "node:url"
import { NodeServices } from "@effect/platform-node"
import { RunControlPolicy, RunPolicyRevision, TaskWorkCapacity } from "@dalph/orchestrator"
import { it } from "@effect/vitest"
import { Effect, Ref } from "effect"
import { expect } from "vitest"
import { availableLocalHostAddress, makeRunningHostReadProbe } from "../../test-support/running-host-read-probe.js"
import { serveRunningHost } from "./running-host-http.js"

const builtEntry = fileURLToPath(new URL("../../dist/bin/dalph.js", import.meta.url))
const client = (
  adapter: "CLI" | "MCP",
  address: string,
  runId: string,
  capacity?: number,
  expectedRevision = 7,
  beforeCall: () => void = () => {}
) =>
  Effect.promise(
    () =>
      new Promise<unknown>((resolve, reject) => {
        const args =
          adapter === "CLI"
            ? [
                "attach",
                capacity === undefined ? "capacity" : "set-capacity",
                "--host",
                address,
                "--run",
                runId,
                "--json",
                ...(capacity === undefined
                  ? []
                  : ["--capacity", String(capacity), "--expected-revision", String(expectedRevision)])
              ]
            : ["mcp", "--host", address, "--run", "http-test-run"]
        const child = execFile(process.execPath, [builtEntry, ...args], { timeout: 15000 }, (error, stdout) => {
          try {
            if (adapter === "CLI") {
              resolve(JSON.parse(stdout).result)
              return
            }
            const reply = stdout
              .trim()
              .split("\n")
              .map((line) => JSON.parse(line))
              .find((message) => message.id === 2)
            resolve(reply.result?.structuredContent?.result ?? reply.error)
          } catch {
            reject(error ?? new Error(stdout))
          }
        })
        if (adapter === "CLI") {
          beforeCall()
          child.stdin?.end()
        } else {
          let pending = ""
          let initialized = false
          child.stdout?.on("data", (chunk: Buffer) => {
            pending += chunk.toString("utf8")
            if (initialized || !pending.includes("\n")) return
            const reply = JSON.parse(pending.slice(0, pending.indexOf("\n")))
            if (reply.id !== 1 || reply.result === undefined) return
            initialized = true
            beforeCall()
            child.stdin?.end(
              [
                { jsonrpc: "2.0", method: "notifications/initialized" },
                {
                  jsonrpc: "2.0",
                  id: 2,
                  method: "tools/call",
                  params: {
                    name: capacity === undefined ? "dalph_read_capacity" : "dalph_set_capacity",
                    arguments: { runId, ...(capacity === undefined ? {} : { capacity, expectedRevision }) }
                  }
                }
              ]
                .map((message) => JSON.stringify(message))
                .join("\n") + "\n"
            )
          })
          child.stdin?.write(
            JSON.stringify({
              jsonrpc: "2.0",
              id: 1,
              method: "initialize",
              params: {
                protocolVersion: "2025-11-25",
                capabilities: {},
                clientInfo: { name: "capacity", version: "1" }
              }
            }) + "\n"
          )
        }
      })
  )

it.live(
  "actual CLI and MCP read and change capacity from equivalent starting policies",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const results: Array<ReadonlyArray<unknown>> = []
        for (const adapter of ["CLI", "MCP"] as const) {
          const probe = yield* makeRunningHostReadProbe()
          const address = yield* availableLocalHostAddress
          const initial = RunControlPolicy.make({
            revision: RunPolicyRevision.make(7),
            taskExecutionCapacity: TaskWorkCapacity.make(1)
          })
          const policy = yield* Ref.make(initial)
          const operations = yield* Ref.make<ReadonlyArray<unknown>>([])
          yield* serveRunningHost(address, {
            ...probe.observation,
            readAttachedCapacity: Ref.get(policy).pipe(
              Effect.map((policy) => ({ _tag: "CapacityRead" as const, policy }))
            ),
            executeAttachedCommand: (request) =>
              Effect.gen(function* () {
                if (request.operation._tag !== "SetCapacity") return yield* Effect.die("unexpected operation")
                yield* Ref.update(operations, (all) => [...all, request.operation])
                const next = RunControlPolicy.make({
                  revision: RunPolicyRevision.make(8),
                  taskExecutionCapacity: request.operation.capacity
                })
                yield* Ref.set(policy, next)
                return { _tag: "CapacityApplied" as const, policy: next }
              })
          })
          results.push([yield* client(adapter, address, probe.runId), yield* client(adapter, address, probe.runId, 2)])
          expect(yield* Ref.get(operations)).toEqual([{ _tag: "SetCapacity", capacity: 2, expectedRevision: 7 }])
        }
        expect(results[0]).toEqual([
          { _tag: "Success", value: { _tag: "CapacityRead", policy: { revision: 7, taskExecutionCapacity: 1 } } },
          { _tag: "Success", value: { _tag: "CapacityApplied", policy: { revision: 8, taskExecutionCapacity: 2 } } }
        ])
        expect(results[1]).toEqual(results[0])
      })
    ).pipe(Effect.provide(NodeServices.layer)),
  60000
)

for (const adapter of ["CLI", "MCP"] as const)
  it.live(
    `${adapter} refuses malformed capacity and revision, wrong Run and closing before capacity effects`,
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const probe = yield* makeRunningHostReadProbe()
          const address = yield* availableLocalHostAddress
          const effects = yield* Ref.make(0)
          yield* serveRunningHost(address, {
            ...probe.observation,
            readAttachedCapacity: Ref.update(effects, (n) => n + 1).pipe(
              Effect.andThen(Effect.die("read should be refused"))
            ),
            executeAttachedCommand: () =>
              Ref.update(effects, (n) => n + 1).pipe(Effect.andThen(Effect.die("set should be refused")))
          })
          for (const [capacity, revision] of [
            [0, 7],
            [9, 7],
            [1.5, 7],
            [2, 0],
            [2, 1.5],
            [2, Number.MAX_SAFE_INTEGER + 1]
          ]) {
            const result = yield* client(adapter, address, probe.runId, capacity, revision)
            // MCP malformed tool arguments are JSON-RPC parser failures; CLI preserves its application envelope.
            expect(result).toMatchObject(
              adapter === "CLI" ? { _tag: "Failure", error: { _tag: "InvalidRequest" } } : { code: -32602 }
            )
          }
          for (const capacity of [undefined, 2]) {
            expect(yield* client(adapter, address, "foreign-run", capacity)).toMatchObject({
              _tag: "Failure",
              error: { _tag: "RunMismatch" }
            })
          }
          for (const capacity of [undefined, 2]) {
            yield* Ref.set(probe.closing, false)
            expect(
              yield* client(adapter, address, probe.runId, capacity, 7, () =>
                Effect.runSync(Ref.set(probe.closing, true))
              )
            ).toMatchObject({ _tag: "Failure", error: { _tag: "HostClosing" } })
          }
          expect(yield* Ref.get(effects)).toBe(0)
        })
      ).pipe(Effect.provide(NodeServices.layer)),
    60000
  )
