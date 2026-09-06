import { spawn, spawnSync } from "node:child_process"
import { performance } from "node:perf_hooks"
import { clearTimeout, setTimeout } from "node:timers"

const defaultTerminationGraceMilliseconds = 5000
const defaultProcessGroupAbsenceTimeoutMilliseconds = 2000
const processGroupObservationIntervalMilliseconds = 25

const terminate = (child, signal) => {
  if (child.pid === undefined) return

  if (process.platform === "win32") {
    spawnSync("taskkill", ["/pid", String(child.pid), "/t", "/f"], { stdio: "ignore" })
    return
  }

  try {
    process.kill(-child.pid, signal)
  } catch (error) {
    if (error.code !== "ESRCH") throw error
  }
}

const processGroupIsAbsent = (child, closed) => {
  if (process.platform === "win32" || child.pid === undefined) return closed
  try {
    process.kill(-child.pid, 0)
    return false
  } catch (error) {
    if (error.code === "ESRCH") return true
    if (error.code === "EPERM") return false
    throw error
  }
}

export const runBoundedCommand = ({
  acceptedExitCodes = [0],
  args,
  captureOutput = false,
  environment,
  executable,
  forwardOutput = true,
  name,
  processGroupAbsenceTimeoutMilliseconds = defaultProcessGroupAbsenceTimeoutMilliseconds,
  relayParentSignals = false,
  terminationGraceMilliseconds = defaultTerminationGraceMilliseconds,
  timeoutMilliseconds
}) =>
  new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      detached: process.platform !== "win32",
      env: environment,
      stdio: ["inherit", "pipe", "pipe"]
    })
    const stdoutLineCounter = { endsWithLineBreak: true, lineBreaks: 0, wasWritten: false }
    const stderrLineCounter = { endsWithLineBreak: true, lineBreaks: 0, wasWritten: false }
    const outputChunks = []
    let absenceTimer
    let closed = false
    let escalationTimer
    let settled = false
    let termination

    const parentSignals = ["SIGTERM", "SIGINT"]
    const signalListeners = new Map()

    const cleanup = () => {
      clearTimeout(timer)
      clearTimeout(escalationTimer)
      clearTimeout(absenceTimer)
      for (const [signal, listener] of signalListeners) process.removeListener(signal, listener)
    }

    const settle = (settler, value) => {
      if (settled) return
      settled = true
      cleanup()
      settler(value)
    }

    const settleTermination = (error) => {
      const relayedSignal = termination?.relayedSignal
      settle(reject, error)
      if (relayedSignal !== undefined) {
        setTimeout(() => process.kill(process.pid, relayedSignal), 0)
      }
    }

    const finishTerminatedGroupIfAbsent = () => {
      if (termination === undefined || settled) return false
      let absent
      try {
        absent = processGroupIsAbsent(child, closed)
      } catch (error) {
        settleTermination(error)
        return true
      }
      if (!closed || !absent) return false
      settleTermination(termination.error)
      return true
    }

    const observeAbsenceAfterKill = () => {
      if (finishTerminatedGroupIfAbsent() || settled) return
      if (performance.now() >= termination.absenceDeadline) {
        settleTermination(
          new Error(
            `${name} sent SIGKILL but could not prove process group ${String(child.pid)} absent within ` +
              `${processGroupAbsenceTimeoutMilliseconds}ms`
          )
        )
        return
      }
      absenceTimer = setTimeout(observeAbsenceAfterKill, processGroupObservationIntervalMilliseconds)
    }

    const forceTermination = () => {
      if (termination === undefined || settled) return
      try {
        terminate(child, "SIGKILL")
      } catch (error) {
        termination = { ...termination, error }
      }
      termination = {
        ...termination,
        absenceDeadline: performance.now() + processGroupAbsenceTimeoutMilliseconds,
        forced: true
      }
      observeAbsenceAfterKill()
    }

    const beginTermination = ({ error, relayedSignal }) => {
      if (termination !== undefined || settled) return
      termination = { error, relayedSignal, forced: false }
      clearTimeout(timer)
      try {
        terminate(child, "SIGTERM")
      } catch (terminationError) {
        termination = { ...termination, error: terminationError }
      }
      if (finishTerminatedGroupIfAbsent()) return
      const grace =
        relayedSignal === undefined ? terminationGraceMilliseconds : Math.min(1000, terminationGraceMilliseconds)
      escalationTimer = setTimeout(forceTermination, grace)
    }

    const observeOutput = (output, destination, lineCounter) => {
      if (captureOutput) outputChunks.push(output)
      lineCounter.wasWritten = true
      lineCounter.endsWithLineBreak = output.at(-1) === 10
      for (const byte of output) {
        if (byte === 10) lineCounter.lineBreaks += 1
      }
      if (forwardOutput) destination.write(output)
    }

    child.stdout.on("data", (output) => {
      observeOutput(output, process.stdout, stdoutLineCounter)
    })
    child.stderr.on("data", (output) => {
      observeOutput(output, process.stderr, stderrLineCounter)
    })

    const timer = setTimeout(
      () => beginTermination({ error: new Error(`${name} exceeded ${timeoutMilliseconds / 1000} seconds`) }),
      timeoutMilliseconds
    )

    if (relayParentSignals) {
      for (const signal of parentSignals) {
        const listener = () =>
          beginTermination({ error: new Error(`${name} interrupted by ${signal}`), relayedSignal: signal })
        signalListeners.set(signal, listener)
        process.on(signal, listener)
      }
    }

    child.once("error", (error) => {
      if (termination === undefined) settle(reject, error)
    })
    child.once("close", (code, signal) => {
      closed = true
      if (termination !== undefined) {
        finishTerminatedGroupIfAbsent()
        return
      }
      if (!acceptedExitCodes.includes(code)) {
        settle(reject, new Error(`${name} failed with ${signal ?? `exit ${code}`}`))
      } else {
        const outputLineCount = [stdoutLineCounter, stderrLineCounter].reduce(
          (total, lineCounter) =>
            total + lineCounter.lineBreaks + (lineCounter.wasWritten && !lineCounter.endsWithLineBreak ? 1 : 0),
          0
        )
        settle(
          resolve,
          captureOutput
            ? { exitCode: code, output: Buffer.concat(outputChunks).toString("utf8"), outputLineCount }
            : { outputLineCount }
        )
      }
    })
  })
