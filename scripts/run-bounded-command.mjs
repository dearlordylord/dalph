import { spawn, spawnSync } from "node:child_process"
import { clearTimeout, setTimeout } from "node:timers"

const defaultTerminationGraceMilliseconds = 5000

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

export const runBoundedCommand = ({
  acceptedExitCodes = [0],
  args,
  captureOutput = false,
  environment,
  executable,
  forwardOutput = true,
  name,
  signal,
  terminationGraceMilliseconds = defaultTerminationGraceMilliseconds,
  timeoutMilliseconds
}) =>
  new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error(`${name} cancelled`))
      return
    }

    const child = spawn(executable, args, {
      detached: process.platform !== "win32",
      env: environment,
      stdio: ["inherit", "pipe", "pipe"]
    })
    const stdoutLineCounter = { endsWithLineBreak: true, lineBreaks: 0, wasWritten: false }
    const stderrLineCounter = { endsWithLineBreak: true, lineBreaks: 0, wasWritten: false }
    const outputChunks = []
    let timedOut = false
    let cancelled = false
    let settled = false
    let escalationTimer
    const timer = setTimeout(() => {
      timedOut = true
      try {
        terminate(child, "SIGTERM")
      } catch (error) {
        cleanupSignal()
        finishReject(error)
        return
      }
      if (process.platform === "win32") {
        cleanupSignal()
        finishReject(new Error(`${name} exceeded ${timeoutMilliseconds / 1000} seconds`))
        return
      }
      escalationTimer = setTimeout(() => {
        try {
          terminate(child, "SIGKILL")
          cleanupSignal()
          finishReject(new Error(`${name} exceeded ${timeoutMilliseconds / 1000} seconds`))
        } catch (error) {
          cleanupSignal()
          finishReject(error)
        }
      }, terminationGraceMilliseconds)
    }, timeoutMilliseconds)

    const finishReject = (error) => {
      if (settled) return
      settled = true
      reject(error)
    }

    const cleanupSignal = () => signal?.removeEventListener("abort", cancel)

    const cancel = () => {
      if (timedOut || cancelled || settled) return
      cancelled = true
      clearTimeout(timer)
      try {
        terminate(child, "SIGTERM")
      } catch (error) {
        cleanupSignal()
        finishReject(error)
        return
      }
      if (process.platform === "win32") {
        cleanupSignal()
        finishReject(new Error(`${name} cancelled`))
        return
      }
      escalationTimer = setTimeout(() => {
        try {
          terminate(child, "SIGKILL")
          cleanupSignal()
          finishReject(new Error(`${name} cancelled`))
        } catch (error) {
          cleanupSignal()
          finishReject(error)
        }
      }, terminationGraceMilliseconds)
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

    signal?.addEventListener("abort", cancel, { once: true })
    if (signal?.aborted) cancel()

    child.once("error", (error) => {
      clearTimeout(timer)
      if (!timedOut && !cancelled) {
        clearTimeout(escalationTimer)
        cleanupSignal()
        finishReject(error)
      }
    })
    child.once("close", (code, childSignal) => {
      clearTimeout(timer)

      if (timedOut) {
        return
      }
      if (cancelled) {
        clearTimeout(escalationTimer)
        cleanupSignal()
        finishReject(new Error(`${name} cancelled`))
        return
      }
      clearTimeout(escalationTimer)
      cleanupSignal()
      if (!acceptedExitCodes.includes(code)) {
        const error = new Error(`${name} failed with ${childSignal ?? `exit ${code}`}`)
        if (captureOutput) {
          error.output = Buffer.concat(outputChunks).toString("utf8")
          error.outputLineCount = [stdoutLineCounter, stderrLineCounter].reduce(
            (total, lineCounter) =>
              total + lineCounter.lineBreaks + (lineCounter.wasWritten && !lineCounter.endsWithLineBreak ? 1 : 0),
            0
          )
        }
        finishReject(error)
      } else {
        const outputLineCount = [stdoutLineCounter, stderrLineCounter].reduce(
          (total, lineCounter) =>
            total + lineCounter.lineBreaks + (lineCounter.wasWritten && !lineCounter.endsWithLineBreak ? 1 : 0),
          0
        )
        if (settled) return
        settled = true
        resolve(
          captureOutput
            ? { exitCode: code, output: Buffer.concat(outputChunks).toString("utf8"), outputLineCount }
            : { outputLineCount }
        )
      }
    })
  })
