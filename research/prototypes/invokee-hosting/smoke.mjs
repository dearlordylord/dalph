#!/usr/bin/env node

import { mkdtemp, readFile, rm } from "node:fs/promises"
import { existsSync } from "node:fs"
import { spawn } from "node:child_process"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const here = dirname(fileURLToPath(import.meta.url))
const root = await mkdtemp(join("/tmp", "dalph-invokee-hosting-"))
const socket = join(root, "host.sock")
const ready = join(root, "ready.json")
const host = spawn(process.execPath, [join(here, "host.mjs"), "--socket", socket, "--ready", ready], {
  cwd: join(here, "../../.."),
  stdio: ["ignore", "pipe", "pipe"]
})
let badHost
let watcher
let badWatcher
let hostStderr = ""
let badHostStderr = ""
host.stderr.setEncoding("utf8")
host.stderr.on("data", (chunk) => {
  hostStderr += chunk
})

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))
const hasExited = (child) => child.exitCode !== null || child.signalCode !== null
const waitForExit = (child) =>
  hasExited(child) ? Promise.resolve() : new Promise((resolve) => child.once("exit", resolve))
const waitFor = async (predicate, timeoutMilliseconds = 5_000) => {
  const started = Date.now()
  while (!predicate()) {
    if (Date.now() - started > timeoutMilliseconds) throw new Error("timed out waiting for host")
    await sleep(10)
  }
}
const waitForReady = async (child, readyPath, label, stderrOf, timeoutMilliseconds = 60_000) => {
  const started = Date.now()
  while (!existsSync(readyPath)) {
    if (hasExited(child)) throw new Error(`${label} exited before ready: ${stderrOf()}`)
    if (Date.now() - started > timeoutMilliseconds) throw new Error(`timed out waiting for ${label}`)
    await sleep(10)
  }
}

const runClientAt = (readyFile, arguments_) =>
  new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [join(here, "client.mjs"), "--ready", readyFile, ...arguments_], {
      cwd: join(here, "../../.."),
      stdio: ["ignore", "pipe", "pipe"]
    })
    let stdout = ""
    let stderr = ""
    child.stdout.setEncoding("utf8")
    child.stderr.setEncoding("utf8")
    child.stdout.on("data", (chunk) => {
      stdout += chunk
    })
    child.stderr.on("data", (chunk) => {
      stderr += chunk
    })
    child.once("error", reject)
    const timeout = setTimeout(() => child.kill("SIGTERM"), 3_000)
    child.once("exit", (code, signal) => {
      clearTimeout(timeout)
      resolve({ code, signal, stderr, stdout })
    })
  })

const runClient = (arguments_) => runClientAt(ready, arguments_)

const parseOne = (result) => {
  if (result.code !== 0) throw new Error(`client failed (${result.code}): ${result.stderr}`)
  return JSON.parse(result.stdout.trim().split("\n").at(-1))
}

const assert = (condition, message) => {
  if (!condition) throw new Error(message)
}

try {
  await waitForReady(host, ready, "host", () => hostStderr)
  const initialOne = parseOne(await runClient(["--command", "status"]))
  const initialTwo = parseOne(await runClient(["--command", "status"]))
  assert(initialOne.body.state.runId === initialTwo.body.state.runId, "clients did not observe one Run")
  assert(initialOne.body.state.revision === initialTwo.body.state.revision, "clients did not observe one policy")
  assert(initialOne.body.state.journalRecords === 1, "host did not expose the Run beginning record")
  const baselineTicks = initialOne.body.state.ticks
  const baselineRevision = initialOne.body.state.revision
  const runId = initialOne.body.state.runId

  const lost = await runClient([
    "--command",
    "capacity",
    "--capacity",
    "2",
    "--expected-revision",
    String(baselineRevision),
    "--run-id",
    runId,
    "--drop-response",
    "true"
  ])
  assert(lost.code !== 0, "lost-response client unexpectedly received a response")

  const afterLost = parseOne(await runClient(["--command", "status"]))
  assert(afterLost.body.state.capacity === 2, "lost response did not apply capacity")
  assert(afterLost.body.state.revision === baselineRevision + 1, "lost response did not advance revision")
  assert(afterLost.body.state.journalRecords === 2, "lost response did not append exactly one capacity record")

  const replay = parseOne(
    await runClient([
      "--command",
      "capacity",
      "--capacity",
      "2",
      "--expected-revision",
      String(baselineRevision),
      "--run-id",
      runId
    ])
  )
  assert(replay.status === 409, "replaying the ambiguous capacity direction was accepted")
  assert(
    replay.body.current.capacity === 2 && replay.body.current.revision === baselineRevision + 1,
    "replay conflict did not expose the applied current policy"
  )
  const afterReplay = parseOne(await runClient(["--command", "status"]))
  assert(afterReplay.body.state.journalRecords === 2, "stale replay appended a duplicate capacity record")

  const staleRevision = afterLost.body.state.revision
  const racing = await Promise.all([
    runClient([
      "--command",
      "capacity",
      "--capacity",
      "3",
      "--expected-revision",
      String(staleRevision),
      "--run-id",
      runId
    ]),
    runClient([
      "--command",
      "capacity",
      "--capacity",
      "4",
      "--expected-revision",
      String(staleRevision),
      "--run-id",
      runId
    ])
  ])
  const racingResponses = racing.filter((result) => result.code === 0).map(parseOne)
  assert(racingResponses.length === 2, "capacity race did not return both responses")
  const successCount = racingResponses.filter((result) => result.status === 200).length
  const conflictCount = racingResponses.filter((result) => result.status === 409).length
  assert(successCount === 1 && conflictCount === 1, "stale revision did not produce one winner and one conflict")
  const afterRace = parseOne(await runClient(["--command", "status"]))
  assert(afterRace.body.state.journalRecords === 3, "capacity race appended more than one winning record")

  watcher = spawn(process.execPath, [join(here, "client.mjs"), "--ready", ready, "--command", "watch", "--events", "20"], {
    cwd: join(here, "../../.."),
    stdio: ["ignore", "pipe", "pipe"]
  })
  watcher.stdout.setEncoding("utf8")
  const watchedState = await new Promise((resolve, reject) => {
    let buffer = ""
    const timeout = setTimeout(() => reject(new Error("timed out waiting for watcher observation")), 3_000)
    watcher.stdout.on("data", (chunk) => {
      buffer += chunk
      const separator = buffer.indexOf("\n")
      if (separator < 0) return
      const line = buffer.slice(0, separator)
      clearTimeout(timeout)
      try {
        resolve(JSON.parse(line).state)
      } catch (error) {
        reject(error)
      }
    })
  })
  watcher.kill("SIGTERM")
  await waitForExit(watcher)

  await sleep(250)
  const reconnected = parseOne(await runClient(["--command", "status"]))
  assert(reconnected.body.state.runId === runId, "reconnect selected a different Run")
  assert(reconnected.body.state.ticks > watchedState.ticks, "host stopped controlled work after client exit")
  const progressBeforeDisconnect = watchedState.tasks.reduce((sum, task) => sum + task.progress, 0)
  const progressAfterReconnect = reconnected.body.state.tasks.reduce((sum, task) => sum + task.progress, 0)
  assert(progressAfterReconnect > progressBeforeDisconnect, "controlled work made no progress after client exit")

  const badSocket = join(root, "bad-host.sock")
  const badReady = join(root, "bad-ready.json")
  badHost = spawn(
    process.execPath,
    [join(here, "host.mjs"), "--socket", badSocket, "--ready", badReady, "--exit-on-client-close", "true"],
    { cwd: join(here, "../../.."), stdio: ["ignore", "pipe", "pipe"] }
  )
  badHost.stderr.setEncoding("utf8")
  badHost.stderr.on("data", (chunk) => {
    badHostStderr += chunk
  })
  await waitForReady(badHost, badReady, "negative-control host", () => badHostStderr)
  badWatcher = spawn(
    process.execPath,
    [join(here, "client.mjs"), "--ready", badReady, "--command", "watch", "--events", "20"],
    { cwd: join(here, "../../.."), stdio: ["ignore", "pipe", "pipe"] }
  )
  badWatcher.stdout.setEncoding("utf8")
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("timed out waiting for negative-control watcher")), 3_000)
    badWatcher.stdout.once("data", () => {
      clearTimeout(timeout)
      resolve()
    })
  })
  badWatcher.kill("SIGTERM")
  await waitForExit(badWatcher)
  await waitFor(() => badHost.exitCode !== null)
  assert(badHost.exitCode === 0, "negative-control host did not stop cleanly after client close")

  process.stdout.write(
    `${JSON.stringify({
      _tag: "SmokePassed",
      runId,
      initialTicks: baselineTicks,
      reconnectTicks: reconnected.body.state.ticks,
      finalCapacity: reconnected.body.state.capacity,
      finalRevision: reconnected.body.state.revision,
      journalRecords: reconnected.body.state.journalRecords,
      race: { successCount, conflictCount },
      replay: { status: replay.status, current: replay.body.current },
      negativeControl: "client-owned host stopped; good host continued",
      hostPid: JSON.parse(await readFile(ready, "utf8")).pid
    })}\n`
  )
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
  if (hostStderr.length > 0) process.stderr.write(hostStderr)
  process.exitCode = 1
} finally {
  if (watcher !== undefined && !hasExited(watcher)) watcher.kill("SIGTERM")
  if (watcher !== undefined) await waitForExit(watcher)
  if (badWatcher !== undefined && !hasExited(badWatcher)) badWatcher.kill("SIGTERM")
  if (badWatcher !== undefined) await waitForExit(badWatcher)
  if (!hasExited(host)) {
    host.kill("SIGTERM")
    await waitForExit(host)
  }
  if (badHost !== undefined && !hasExited(badHost)) {
    badHost.kill("SIGTERM")
    await waitForExit(badHost)
  }
  await rm(root, { recursive: true, force: true })
}
