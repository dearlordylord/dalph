/* eslint-disable import/no-nodejs-modules -- This control observes native process identities and the exact coordinator lock. */
import { setTimeout as scheduleStop, clearTimeout as cancelStop } from "node:timers"
import { spawn, execFileSync, type ChildProcess } from "node:child_process"
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import nodeProcess from "node:process"
import { it } from "@effect/vitest"
import { Clock, Effect, Schema } from "effect"
import { ApplicationExitOwners } from "@dalph/orchestrator"
import { expect } from "vitest"

const fixture = new URL("../../dist/bin/exit-owner-custody-host-fixture.js", import.meta.url).pathname
const successorFixture = new URL("../../dist/bin/linux-application-exit-host-fixture.js", import.meta.url).pathname
const Event = Schema.Struct({
  stage: Schema.String,
  pid: Schema.optionalKey(Schema.Int),
  descendantPid: Schema.optionalKey(Schema.Int),
  startIdentity: Schema.optionalKey(Schema.String),
  owners: Schema.optionalKey(ApplicationExitOwners),
  result: Schema.optionalKey(
    Schema.Struct({ _tag: Schema.String, requestedStatus: Schema.Int, owners: ApplicationExitOwners })
  )
})
type Event = typeof Event.Type

const terminated = (child: ChildProcess) =>
  new Promise<number | null>((resolve, reject) => {
    child.once("error", reject)
    child.once("exit", resolve)
  })
const groupMembers = (id: number) =>
  execFileSync("ps", ["-eo", "pid=,pgid="], { encoding: "utf8" })
    .trim()
    .split("\n")
    .map((line) => line.trim().split(/\s+/).map(Number))
    .filter(([, group]) => group === id)
    .map(([pid]) => pid)

const processIdentity = (pid: number) =>
  existsSync(`/proc/${pid}/stat`) ? readFileSync(`/proc/${pid}/stat`, "utf8").split(") ")[1]?.split(" ")[19] : undefined

it.live(
  "a timed-out native provider owner retains its exact descendant and lock until close proves stopped writers",
  () =>
    Effect.gen(function* () {
      const clock = yield* Clock.Clock
      return yield* Effect.tryPromise(async () => {
        const directory = mkdtempSync(join(tmpdir(), "dalph-exit-owner-custody-"))
        const child = spawn(nodeProcess.execPath, [fixture, directory], {
          stdio: ["ignore", "pipe", "pipe", "ipc"],
          detached: true
        })
        const childExit = terminated(child)
        const parentIdentity = child.pid === undefined ? undefined : processIdentity(child.pid)
        const events: Array<Event> = []
        const waiters = new Map<
          string,
          { readonly resolve: (event: Event) => void; readonly reject: (error: Error) => void }
        >()
        let text = ""
        let descendantPid: number | undefined
        let descendantIdentity: string | undefined
        const failWaiters = () => {
          for (const waiter of waiters.values())
            waiter.reject(new Error("native fixture stopped before its expected observation"))
          waiters.clear()
        }
        child.once("exit", failWaiters)
        const stop = scheduleStop(() => {
          failWaiters()
          if (child.pid !== undefined && parentIdentity !== undefined && processIdentity(child.pid) === parentIdentity)
            nodeProcess.kill(-child.pid, "SIGKILL")
        }, 15000)
        child.stdout?.on("data", (bytes: Uint8Array) => {
          text += new TextDecoder().decode(bytes)
          const lines = text.split("\n")
          text = lines.pop() ?? ""
          for (const line of lines) {
            const event = Schema.decodeUnknownSync(Schema.fromJsonString(Event))(line)
            events.push(event)
            if (event.descendantPid !== undefined) {
              descendantPid = event.descendantPid
              descendantIdentity = event.startIdentity
            }
            waiters.get(event.stage)?.resolve(event)
            waiters.delete(event.stage)
          }
        })
        const awaitEvent = (stage: string) => {
          const known = events.find((event) => event.stage === stage)
          return known === undefined
            ? new Promise<Event>((resolve, reject) => waiters.set(stage, { resolve, reject }))
            : Promise.resolve(known)
        }
        try {
          const ready = await awaitEvent("ready")
          if (child.pid === undefined || ready.descendantPid === undefined)
            throw new Error("fixture has no exact identities")
          const started = clock.currentTimeMillisUnsafe()
          child.kill("SIGTERM")
          await awaitEvent("requested")
          child.kill("SIGTERM")
          const result = await awaitEvent("result")
          expect(clock.currentTimeMillisUnsafe() - started).toBeGreaterThanOrEqual(4500)
          expect(clock.currentTimeMillisUnsafe() - started).toBeLessThan(6500)
          expect(result.result?._tag).toBe("TimedOut")
          expect(result.result?.owners.owners).toMatchObject([
            {
              family: "LocalDrain",
              ownerId: 0,
              name: "CodexProvider",
              subject: { _tag: "NoRun" },
              evidence: "DrainPending",
              missingEvidence: "LocalCloseAcknowledgement",
              nextAction: "AwaitLocalClose"
            }
          ])
          expect(existsSync(`/proc/${child.pid}`)).toBe(true)
          expect(readFileSync(`/proc/${ready.descendantPid}/stat`, "utf8").split(") ")[1]?.split(" ")[19]).toBe(
            ready.startIdentity
          )
          expect(groupMembers(ready.descendantPid)).toEqual([ready.descendantPid])
          const refused = spawn(nodeProcess.execPath, [successorFixture, "acquire-once", directory], {
            stdio: ["ignore", "pipe", "ignore"]
          })
          let refusedOutput = ""
          refused.stdout.on("data", (bytes: Uint8Array) => {
            refusedOutput += new TextDecoder().decode(bytes)
          })
          expect(await terminated(refused)).toBe(70)
          expect(refusedOutput).toContain("CoordinatorLockHeld")
          child.send("release")
          await awaitEvent("descendant-stopped")
          expect(await childExit).toBe(1)
          expect(existsSync(`/proc/${child.pid}`)).toBe(false)
          expect(groupMembers(child.pid)).toEqual([])
          expect(existsSync(`/proc/${ready.descendantPid}`)).toBe(false)
          expect(groupMembers(ready.descendantPid)).toEqual([])
          const successor = spawn(nodeProcess.execPath, [successorFixture, "acquire-once", directory], {
            stdio: "ignore"
          })
          expect(await terminated(successor)).toBe(0)
        } finally {
          cancelStop(stop)
          if (
            descendantPid !== undefined &&
            descendantIdentity !== undefined &&
            processIdentity(descendantPid) === descendantIdentity
          )
            nodeProcess.kill(-descendantPid, "SIGKILL")
          if (child.pid !== undefined && parentIdentity !== undefined && processIdentity(child.pid) === parentIdentity)
            nodeProcess.kill(-child.pid, "SIGKILL")
          await childExit
          rmSync(directory, { recursive: true, force: true })
        }
      })
    }),
  20000
)
