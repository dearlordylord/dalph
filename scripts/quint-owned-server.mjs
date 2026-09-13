import { randomUUID } from "node:crypto"
import { readdirSync, readFileSync, readlinkSync } from "node:fs"
import { createRequire } from "node:module"
import { createServer } from "node:net"
import { isAbsolute, join } from "node:path"
import { performance } from "node:perf_hooks"
import { setTimeout as delay } from "node:timers/promises"
import {
  atomicRecord,
  inheritedCustody,
  readRecord,
  wallClockTimestamp,
  withFileLock
} from "./gate-custody-records.mjs"
import { groupIsAbsent, registrationLockPath } from "./gate-registration.mjs"
import { runBoundedCommand } from "./run-bounded-command.mjs"

export const quintOwnedServerEnvironmentName = "DALPH_QUINT_OWNED_SERVER_ENDPOINT"
export const quintJavaExecutableEnvironmentName = "DALPH_QUINT_JAVA_EXECUTABLE"
export const quintJavaUserHomeEnvironmentName = "DALPH_QUINT_JAVA_USER_HOME"

/** The endpoint is runner transport metadata, never caller-authored configuration. */
export const ownedQuintServerEnvironment = (environment, serverEndpoint, { javaExecutable, javaUserHome }) => ({
  ...Object.fromEntries(
    Object.entries(environment).filter(
      ([name]) =>
        ![
          quintOwnedServerEnvironmentName,
          quintJavaExecutableEnvironmentName,
          quintJavaUserHomeEnvironmentName
        ].includes(name)
    )
  ),
  [quintOwnedServerEnvironmentName]: serverEndpoint,
  [quintJavaExecutableEnvironmentName]: javaExecutable,
  [quintJavaUserHomeEnvironmentName]: javaUserHome
})

const reservePort = async () => {
  const server = createServer()
  await new Promise((resolve, reject) => {
    server.once("error", reject)
    server.listen(0, "127.0.0.1", resolve)
  })
  const address = server.address()
  await new Promise((resolve, reject) => server.close((error) => (error === undefined ? resolve() : reject(error))))
  if (address === null || typeof address === "string") throw new Error("No private Apalache port allocated")
  return address.port
}

export const ownedQuintListeningSockets = (port) =>
  ["tcp", "tcp6"].flatMap((family) =>
    readFileSync(`/proc/net/${family}`, "utf8")
      .split("\n")
      .slice(1)
      .map((line) => line.trim().split(/\s+/u))
      .filter((fields) => fields[3] === "0A" && Number.parseInt(fields[1]?.split(":")[1], 16) === port)
      .map((fields) => ({ family, address: fields[1], inode: fields[9] }))
  )

const waitForOwnedSocket = async ({ port, processGroup, remainingExecutionMilliseconds, signal }) => {
  for (;;) {
    remainingExecutionMilliseconds("owned Apalache listening socket")
    signal.throwIfAborted()
    const sockets = ownedQuintListeningSockets(port)
    if (sockets.length > 0) {
      const links = readdirSync(`/proc/${processGroup}/fd`).map((fd) => {
        try {
          return readlinkSync(`/proc/${processGroup}/fd/${fd}`)
        } catch (error) {
          if (error.code === "ENOENT") return undefined
          throw error
        }
      })
      if (!sockets.every(({ inode }) => links.includes(`socket:[${inode}]`)))
        throw new Error("Apalache endpoint belongs to another process; owned socket proof refused")
      return sockets
    }
    await delay(Math.min(25, remainingExecutionMilliseconds("owned Apalache listening socket")), undefined, { signal })
  }
}

const patchedApalache = () => {
  const require = createRequire(import.meta.url)
  const apalache = require("@informalsystems/quint/dist/src/apalache.js")
  if (typeof apalache.ownedServerReadiness !== "function")
    throw new Error("Pinned Quint owned-server patch is not installed")
  return apalache
}

const assertPrerequisites = () => {
  patchedApalache()
  ownedQuintListeningSockets(0)
}

const readiness = async ({ environment, port }) => {
  const apalache = patchedApalache()
  // The API reads the process environment. The helper is executed in its own
  // admitted formal child; restore transport metadata even on readiness failure.
  const previous = process.env[quintOwnedServerEnvironmentName]
  process.env[quintOwnedServerEnvironmentName] = environment[quintOwnedServerEnvironmentName]
  try {
    const result = await apalache.ownedServerReadiness({ hostname: "127.0.0.1", port })
    if (result.isLeft()) throw new Error(`Owned Apalache readiness failed: ${result.value.explanation}`)
  } finally {
    if (previous === undefined) delete process.env[quintOwnedServerEnvironmentName]
    else process.env[quintOwnedServerEnvironmentName] = previous
  }
}

const observedServer = ({ context, name }) =>
  withFileLock(registrationLockPath(context.runDirectory), () => {
    const registration = readRecord(join(context.runDirectory, "registration.json"))
    const obligations = registration.obligations
      .map((id) => readRecord(join(context.runDirectory, "obligations", `${id}.json`)))
      .filter((record) => record.parentId === context.parentId && record.command.name === name)
    if (obligations.length !== 1 || obligations[0].state !== "observed")
      throw new Error("Owned Apalache launch has no exact observed custody record")
    return obligations[0]
  })

const terminalEvidence = ({ context, obligation, ownedSockets, stop }) => {
  const receiptPath = join(context.runDirectory, "receipts", `${obligation.obligationId}.json`)
  const receipt = readRecord(receiptPath)
  const absence = readRecord(join(context.runDirectory, "absence", `${obligation.obligationId}.json`))
  if (
    receipt.runId !== context.run.runId ||
    receipt.obligationId !== obligation.obligationId ||
    JSON.stringify(receipt.command) !== JSON.stringify(obligation.command) ||
    receipt.outcome !== "cancelled" ||
    receipt.groupAbsent !== true ||
    (receipt.exitCode === null && receipt.signal === null) ||
    absence.state !== "observed" ||
    absence.runId !== context.run.runId ||
    absence.obligationId !== obligation.obligationId ||
    absence.processGroup !== obligation.processGroup ||
    !groupIsAbsent(obligation.processGroup)
  )
    throw new Error("Owned Apalache terminal custody is not proven stopped after planned cancellation")
  return {
    obligationId: obligation.obligationId,
    processGroup: obligation.processGroup,
    receiptPath,
    receipt,
    stopPath: join(context.runDirectory, "owned-server-stops", `${obligation.obligationId}.json`),
    stop,
    ownedSockets
  }
}

const realBoundaries = {
  assertPrerequisites,
  reservePort,
  waitForOwnedSocket,
  readiness,
  observedServer,
  terminalEvidence,
  runBoundedCommand,
  listeningSockets: ownedQuintListeningSockets
}

/** Start only the identified server, then preserve its planned cancellation as
 * distinct evidence after checking; it is never a passed checker obligation. */
export const withOwnedQuintServer = async ({
  apalacheJar,
  boundaries: overrides = {},
  environment,
  javaArguments,
  javaExecutable,
  javaUserHome,
  processGroupAbsenceTimeoutMilliseconds = 2000,
  remainingExecutionMilliseconds,
  runProfile,
  signal,
  terminationGraceMilliseconds = 5000
}) => {
  if (process.platform !== "linux") throw new Error("Owned Apalache socket observation requires Linux /proc")
  const context = inheritedCustody()
  if (context === undefined) throw new Error("Owned Apalache requires inherited exact-worktree admission and custody")
  signal?.throwIfAborted()
  if (!isAbsolute(javaExecutable) || !isAbsolute(javaUserHome ?? ""))
    throw new Error("Owned Apalache requires identified absolute Java executable and user.home")
  const homeArguments = javaArguments.filter((argument) => argument.startsWith("-Duser.home="))
  if (homeArguments.length !== 1 || homeArguments[0] !== `-Duser.home=${javaUserHome}`)
    throw new Error("Owned Apalache Java arguments do not enforce the identified user.home")
  const boundaries = { ...realBoundaries, ...overrides }
  boundaries.assertPrerequisites()
  remainingExecutionMilliseconds("owned Apalache endpoint allocation")
  const port = await boundaries.reservePort()
  const serverEndpoint = `127.0.0.1:${port}`
  const childEnvironment = ownedQuintServerEnvironment(environment, serverEndpoint, { javaExecutable, javaUserHome })
  const name = `owned Apalache server ${randomUUID()}`
  const serverTimeoutMilliseconds = remainingExecutionMilliseconds("owned Apalache server launch")
  const serverController = new AbortController()
  const profileController = new AbortController()
  const cancel = () => {
    profileController.abort(signal?.reason)
    serverController.abort(signal?.reason)
  }
  signal?.addEventListener("abort", cancel, { once: true })
  if (signal?.aborted) cancel()
  /** @type {{ outcome: { result?: unknown; error?: Error & { quintCommandResult?: string } } | undefined }} */
  const serverState = { outcome: undefined }
  let obligation
  let ownedSockets
  let profilePromise
  let stop
  let profileResult
  let failure
  let ownedSocketAt
  let reflectionStartedAt
  let readyAt
  let plannedStopAt
  const launchedAt = performance.now()
  const serverPromise = boundaries
    .runBoundedCommand({
      executable: javaExecutable,
      // Apalache otherwise writes _apalache-out in the observed checkout.
      // The original admitted helper owns these generated diagnostics.
      args: [
        ...javaArguments,
        "-jar",
        apalacheJar,
        `--out-dir=${join(context.runDirectory, "owned-server-output", context.parentId)}`,
        "server",
        `--port=${port}`
      ],
      environment: childEnvironment,
      name,
      captureOutput: true,
      timeoutMilliseconds: serverTimeoutMilliseconds,
      terminationGraceMilliseconds,
      processGroupAbsenceTimeoutMilliseconds,
      signal: serverController.signal
    })
    .then(
      (result) => {
        serverState.outcome = { result }
      },
      (error) => {
        serverState.outcome = { error }
      }
    )
  const unexpectedServer = serverPromise.then(() => {
    if (stop === undefined)
      throw new Error(
        `Owned Apalache stopped before planned shutdown: ${serverState.outcome.error?.message ?? "ordinary exit"}`
      )
    return new Promise(() => {})
  })
  // Settlement rejection is observed immediately, including failures before a
  // launch observation can be read.
  unexpectedServer.catch(() => {})
  try {
    obligation = boundaries.observedServer({ context, name })
    const observation = {
      port,
      processGroup: obligation.processGroup,
      remainingExecutionMilliseconds,
      signal: profileController.signal
    }
    ownedSockets = await Promise.race([boundaries.waitForOwnedSocket(observation), unexpectedServer])
    ownedSocketAt = performance.now()
    reflectionStartedAt = performance.now()
    await Promise.race([boundaries.readiness({ ...observation, environment: childEnvironment }), unexpectedServer])
    readyAt = performance.now()
    signal?.throwIfAborted()
    remainingExecutionMilliseconds("formal profile after owned Apalache readiness")
    profilePromise = Promise.resolve().then(() =>
      runProfile({
        serverEndpoint,
        environment: childEnvironment,
        remainingExecutionMilliseconds,
        signal: profileController.signal
      })
    )
    profileResult = await Promise.race([profilePromise, unexpectedServer])
    if (serverState.outcome !== undefined) throw new Error("Owned Apalache stopped before planned shutdown")
    stop = {
      version: 1,
      runId: context.run.runId,
      obligationId: obligation.obligationId,
      processGroup: obligation.processGroup,
      serverEndpoint,
      disposition: "profile-complete",
      requestedAt: wallClockTimestamp()
    }
    plannedStopAt = performance.now()
    atomicRecord(join(context.runDirectory, "owned-server-stops", `${obligation.obligationId}.json`), stop)
  } catch (error) {
    failure = error
  } finally {
    profileController.abort()
    serverController.abort()
    await Promise.allSettled([serverPromise, ...(profilePromise === undefined ? [] : [profilePromise])])
    signal?.removeEventListener("abort", cancel)
  }
  if (failure !== undefined) throw failure
  signal?.throwIfAborted()
  if (serverState.outcome.error?.quintCommandResult !== "cancelled")
    throw new Error(
      `Owned Apalache shutdown failed: ${serverState.outcome.error?.message ?? "unplanned ordinary exit"}`
    )
  if (boundaries.listeningSockets(port).length !== 0)
    throw new Error("Owned Apalache endpoint still has a listener after shutdown")
  const serverEvidence = boundaries.terminalEvidence({ context, obligation, ownedSockets, stop })
  const timing = {
    launchToOwnedSocketMilliseconds: ownedSocketAt - launchedAt,
    reflectionReadinessMilliseconds: readyAt - reflectionStartedAt,
    launchToReadyMilliseconds: readyAt - launchedAt,
    plannedStopToProvenAbsenceMilliseconds: performance.now() - plannedStopAt
  }
  return { profileResult, serverEvidence: { ...serverEvidence, serverEndpoint, timing } }
}
