/* eslint-disable import/no-nodejs-modules -- fixture kills only its exact disposable host and token-owned children. */
import { execFile, spawn } from "node:child_process"
import { watch } from "node:fs"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import nodeProcess from "node:process"
import { setTimeout as wait } from "node:timers/promises"
import { setTimeout as schedule, clearTimeout as cancel } from "node:timers"
import { NodeServices } from "@effect/platform-node"
import { GitCommand, GitSenderCustody, nodeGitCommandLayer } from "@dalph/orchestrator"
import { Effect } from "effect"
import { expect, it } from "vitest"
import { fileGitSenderCustodyLayer } from "./git-sender-custody.js"
import { parseLinuxProcessStat, type LinuxProcessStat } from "./codex-app-server.js"

const fixture = new URL("../../dist/bin/git-sender-custody-host-fixture.js", import.meta.url).pathname
const subject = { requestId: "real-host-sigkill-publication", attemptOrdinal: 1 }
const startupLimitMillis = 5000
const exitPollMillis = 25
const exitPollLimit = 80
const observe = async (pid: number): Promise<LinuxProcessStat | undefined> => {
  try {
    return parseLinuxProcessStat(pid, await readFile(`/proc/${pid}/stat`, "utf8"))
  } catch (error: unknown) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      (error.code === "ENOENT" || error.code === "ESRCH")
    )
      return undefined
    throw error
  }
}
const signalExact = async (identity: LinuxProcessStat | undefined) => {
  if (identity === undefined) return
  if ((await observe(identity.pid))?.startIdentity !== identity.startIdentity) return
  try {
    nodeProcess.kill(identity.pid, "SIGKILL")
  } catch (error: unknown) {
    if (typeof error !== "object" || error === null || !("code" in error) || error.code !== "ESRCH") throw error
  }
}
const proveAbsent = async (identity: LinuxProcessStat) => {
  for (let attempt = 0; attempt < exitPollLimit; attempt += 1) {
    if ((await observe(identity.pid))?.startIdentity !== identity.startIdentity) return
    await wait(exitPollMillis)
  }
  throw new Error(`exact fixture process remains: ${identity.pid}:${identity.startIdentity}`)
}

it("replacement stops the escaped Git sender after exact host SIGKILL before a later remote boundary", async () => {
  const directory = await mkdtemp(join(tmpdir(), "dalph-real-sender-restart-"))
  await new Promise<void>((resolve, reject) =>
    execFile("git", ["init", "--bare", directory], (error) => (error === null ? resolve() : reject(error)))
  )
  const marker = join(directory, "escaped.stat")
  await writeFile(
    join(directory, "helper.cjs"),
    `const fs = require('node:fs'); fs.writeFileSync(${JSON.stringify(marker + ".tmp")}, fs.readFileSync('/proc/' + process.pid + '/stat')); fs.renameSync(${JSON.stringify(marker + ".tmp")}, ${JSON.stringify(marker)}); setInterval(() => {}, 1000);`
  )
  await writeFile(
    join(directory, "launcher.cjs"),
    `require('node:child_process').spawn(process.execPath, [${JSON.stringify(join(directory, "helper.cjs"))}], { detached: true, stdio: 'ignore', env: process.env }); setInterval(() => {}, 1000);`
  )
  const watcher = watch(directory)
  let timer: ReturnType<typeof schedule> | undefined
  const ready = new Promise<string>((resolve, reject) => {
    timer = schedule(() => reject(new Error("escaped sender readiness deadline")), startupLimitMillis)
    watcher.on("change", (_event, filename) => {
      if (filename === "escaped.stat") void readFile(marker, "utf8").then(resolve, reject)
    })
  })
  const host = spawn(nodeProcess.execPath, [fixture, directory], { detached: true, stdio: ["ignore", "pipe", "pipe"] })
  const hostClosed = new Promise<void>((resolve) => host.once("close", () => resolve()))
  let diagnostics = ""
  host.stderr.on("data", (chunk) => {
    diagnostics += String(chunk)
  })
  let hostIdentity: LinuxProcessStat | undefined
  let escapedIdentity: LinuxProcessStat | undefined
  let nextRemoteCalls = 0
  try {
    if (host.pid === undefined) throw new Error("fixture host did not spawn")
    hostIdentity = await observe(host.pid)
    expect(hostIdentity).toBeDefined()
    const readyStat = await ready.catch((error: unknown) => {
      throw new Error(`${String(error)}: ${diagnostics}`)
    })
    escapedIdentity = parseLinuxProcessStat(Number(readyStat.slice(0, readyStat.indexOf(" "))), readyStat)
    if (escapedIdentity === undefined) throw new Error("escaped child identity missing")
    expect(escapedIdentity.processGroupId).toBe(escapedIdentity.pid)
    await signalExact(hostIdentity)
    await hostClosed
    expect((await observe(escapedIdentity.pid))?.startIdentity).toBe(escapedIdentity.startIdentity)
    await Effect.runPromise(
      Effect.gen(function* () {
        yield* (yield* GitSenderCustody).reconcile(subject)
        const command = yield* GitCommand
        if (command.runBoundedInRepository === undefined) return yield* Effect.die("bounded Git missing")
        const observed = yield* command.runBoundedInRepository(
          directory,
          ["ls-remote", directory, "refs/heads/main"],
          "2 seconds"
        )
        expect(observed.exitCode).toBe(0)
        yield* Effect.sync(() => {
          nextRemoteCalls += 1
        })
      }).pipe(
        Effect.provide(nodeGitCommandLayer),
        Effect.provide(fileGitSenderCustodyLayer(directory)),
        Effect.provide(NodeServices.layer)
      )
    )
    await proveAbsent(escapedIdentity)
    expect(nextRemoteCalls).toBe(1)
    const escapedGroupId = escapedIdentity.processGroupId
    expect(() => nodeProcess.kill(-escapedGroupId, 0)).toThrow()
  } finally {
    if (timer !== undefined) cancel(timer)
    watcher.close()
    await signalExact(hostIdentity)
    await hostClosed
    await Effect.runPromise(
      Effect.flatMap(GitSenderCustody, (custody) => custody.reconcile(subject)).pipe(
        Effect.provide(fileGitSenderCustodyLayer(directory))
      )
    )
    await signalExact(escapedIdentity)
    if (escapedIdentity !== undefined) await proveAbsent(escapedIdentity)
    await rm(directory, { recursive: true, force: true })
  }
}, 15000)
