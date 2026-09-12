import { appendFileSync, mkdirSync, writeFileSync } from "node:fs"
import { join, resolve as resolvePath } from "node:path"
import { stageArtifactEvidence } from "./gate-run-artifacts.mjs"
import { artifactEvidence } from "./gate-run-evidence.mjs"
import { wallClockTimestamp, atomicRecord, custodyVersion, readRecord } from "./gate-custody-records.mjs"
import { proveStageDescendantsStopped, publishAbsence, publishNoChild, registerSpawn } from "./gate-registration.mjs"
import { spawn, spawnSync } from "node:child_process"
import { performance } from "node:perf_hooks"
import { clearTimeout, setTimeout } from "node:timers"

const defaultTerminationGraceMilliseconds = 5000
const defaultProcessGroupAbsenceTimeoutMilliseconds = 2000
const processGroupObservationIntervalMilliseconds = 25

const commandError = (message, quintCommandResult) => Object.assign(new Error(message), { quintCommandResult })

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
  cwd,
  environment,
  executable,
  forwardOutput = true,
  name,
  processGroupAbsenceTimeoutMilliseconds = defaultProcessGroupAbsenceTimeoutMilliseconds,
  relayParentSignals = false,
  signal,
  terminationGraceMilliseconds = defaultTerminationGraceMilliseconds,
  timeoutMilliseconds
}) =>
  new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(commandError(`${name} cancelled`, "cancelled"))
      return
    }

    // Install signal ownership before the spawn/observation publication gap can expose a live child.
    const signalListeners = new Map()
    const requestParentTermination = (parentSignal) =>
      beginTermination({
        error: commandError(`${name} interrupted by ${parentSignal}`, "interrupted"),
        relayedSignal: parentSignal
      })
    if (relayParentSignals)
      for (const parentSignal of ["SIGTERM", "SIGINT"]) {
        const listener = () => {
          requestParentTermination(parentSignal)
        }
        signalListeners.set(parentSignal, listener)
        process.on(parentSignal, listener)
      }
    let registered
    try {
      registered = registerSpawn({
        command: {
          executable,
          args,
          cwd: resolvePath(cwd ?? process.cwd()),
          name,
          timeoutMilliseconds,
          acceptedExitCodes,
          relayParentSignals,
          terminationGraceMilliseconds,
          processGroupAbsenceTimeoutMilliseconds
        },
        environment: environment ?? process.env,
        spawnChild: (childEnvironment) =>
          spawn(executable, args, {
            cwd,
            detached: process.platform !== "win32",
            env: childEnvironment,
            stdio: ["inherit", "pipe", "pipe"]
          })
      })
    } catch (error) {
      for (const [parentSignal, listener] of signalListeners) process.removeListener(parentSignal, listener)
      throw error
    }
    const { child, obligation, observationError } = registered
    let loggingError
    const logPath =
      obligation === undefined
        ? undefined
        : join(obligation.context.run.reportDirectory, "logs", `${obligation.intent.obligationId}.log`)
    if (logPath !== undefined) {
      try {
        mkdirSync(join(obligation.context.run.reportDirectory, "logs"), { recursive: true })
        writeFileSync(logPath, "", { flag: "wx" })
      } catch (error) {
        loggingError = error
      }
    }
    let actualExit
    let absenceProven = false
    const publishTerminal = (result, error) => {
      if (obligation === undefined) return
      try {
        if (loggingError !== undefined) throw loggingError
        const identity = readRecord(join(obligation.context.runDirectory, "identity.json"))
        atomicRecord(join(obligation.context.runDirectory, "receipts", `${obligation.intent.obligationId}.json`), {
          version: custodyVersion,
          runId: obligation.intent.runId,
          obligationId: obligation.intent.obligationId,
          inputDigest: identity.inputDigest,
          command: obligation.intent.command,
          startedAt: obligation.intent.startedAt,
          finishedAt: wallClockTimestamp(),
          exitCode: actualExit?.code ?? null,
          signal: actualExit?.signal ?? null,
          outcome: error?.quintCommandResult ?? (result !== undefined ? "passed" : "failed"),
          outputLineCount: outputLineCount(),
          artifacts: stageArtifactEvidence({ command: obligation.intent.command, run: obligation.context.run }),
          groupAbsent: absenceProven,
          logPath,
          log: artifactEvidence(logPath),
          coverage: obligation.intent.command.args.some((argument) =>
            ["test:coverage", "coverage:body"].includes(argument)
          )
            ? {
                final: artifactEvidence(
                  join(obligation.context.run.reportDirectory, "coverage", "coverage-final.json")
                ),
                summary: artifactEvidence(
                  join(obligation.context.run.reportDirectory, "coverage", "coverage-summary.json")
                )
              }
            : undefined
        })
      } catch (publicationError) {
        console.error(`Gate terminal evidence UNPROVEN: ${publicationError.message}`)
      }
    }
    const stdoutLineCounter = { endsWithLineBreak: true, lineBreaks: 0, wasWritten: false }
    const stderrLineCounter = { endsWithLineBreak: true, lineBreaks: 0, wasWritten: false }
    const outputChunks = []
    let absenceTimer
    let closed = false
    let escalationTimer
    let settled = false
    let termination

    const outputLineCount = () =>
      [stdoutLineCounter, stderrLineCounter].reduce(
        (total, lineCounter) =>
          total + lineCounter.lineBreaks + (lineCounter.wasWritten && !lineCounter.endsWithLineBreak ? 1 : 0),
        0
      )

    const attachCapturedOutput = (error) => {
      if (!captureOutput) return error
      error.output = Buffer.concat(outputChunks).toString("utf8")
      error.outputLineCount = outputLineCount()
      return error
    }

    const cleanup = () => {
      clearTimeout(timer)
      clearTimeout(escalationTimer)
      clearTimeout(absenceTimer)
      signal?.removeEventListener("abort", cancel)
      for (const [parentSignal, listener] of signalListeners) process.removeListener(parentSignal, listener)
    }

    const settle = (settler, value) => {
      if (settled) return
      if (
        absenceProven &&
        (settler === resolve || /^(?:exit:\d+|launch-failed|timed-out)$/u.test(value?.quintCommandResult ?? ""))
      ) {
        try {
          proveStageDescendantsStopped(obligation)
        } catch (error) {
          settler = reject
          value = commandError(`${name} descendant custody is not proven stopped: ${error.message}`, "failed")
        }
      }
      if (obligation !== undefined && value !== undefined) value.gateObligationId = obligation.intent.obligationId
      settled = true
      cleanup()
      publishTerminal(settler === resolve ? value : undefined, settler === reject ? value : undefined)
      settler(value)
    }

    const settleTermination = (error) => {
      const relayedSignal = termination?.relayedSignal
      settle(reject, attachCapturedOutput(error))
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
      absenceProven = true
      try {
        publishAbsence(obligation)
      } catch (error) {
        settleTermination(commandError(`${name} absence publication failed: ${error.message}`, "failed"))
        return true
      }
      settleTermination(termination.error)
      return true
    }

    const observeAbsenceAfterKill = () => {
      if (finishTerminatedGroupIfAbsent() || settled) return
      if (performance.now() >= termination.absenceDeadline) {
        settleTermination(
          commandError(
            `${name} sent SIGKILL but could not prove process group ${String(child.pid)} absent within ` +
              `${processGroupAbsenceTimeoutMilliseconds}ms`,
            "failed"
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

    const cancel = () => beginTermination({ error: commandError(`${name} cancelled`, "cancelled") })

    const observeOutput = (output, destination, lineCounter) => {
      if (logPath !== undefined && loggingError === undefined) {
        try {
          appendFileSync(logPath, output)
        } catch (error) {
          loggingError = error
        }
      }
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
      () =>
        beginTermination({
          error: commandError(`${name} exceeded ${timeoutMilliseconds / 1000} seconds`, "timed-out")
        }),
      timeoutMilliseconds
    )

    signal?.addEventListener("abort", cancel, { once: true })
    if (signal?.aborted) cancel()

    if (observationError !== undefined)
      beginTermination({
        error: commandError(`${name} spawn observation publication failed: ${observationError.message}`, "failed")
      })

    child.once("error", (error) => {
      if (termination === undefined) {
        if (child.pid === undefined) {
          try {
            publishNoChild(obligation)
            absenceProven = true
          } catch (publicationError) {
            settle(reject, commandError(`${name} no-child publication failed: ${publicationError.message}`, "failed"))
            return
          }
        }
        const launchFailure = commandError(`${name} could not start: ${error.message}`, "launch-failed")
        settle(reject, attachCapturedOutput(launchFailure))
      }
    })
    child.once("close", (code, childSignal) => {
      actualExit = { code, signal: childSignal }
      closed = true
      if (termination !== undefined) {
        finishTerminatedGroupIfAbsent()
        return
      }
      const deadline = performance.now() + processGroupAbsenceTimeoutMilliseconds
      const finishOrdinaryExit = () => {
        if (settled) return
        let absent
        try {
          absent = processGroupIsAbsent(child, closed)
        } catch (error) {
          settle(reject, commandError(`${name} group observation failed: ${error.message}`, "failed"))
          return
        }
        if (!absent) {
          if (performance.now() >= deadline) {
            settle(
              reject,
              attachCapturedOutput(
                commandError(`${name} child exited but process group ${child.pid} is not proven absent`, "failed")
              )
            )
            return
          }
          absenceTimer = setTimeout(finishOrdinaryExit, processGroupObservationIntervalMilliseconds)
          return
        }
        absenceProven = true
        try {
          publishAbsence(obligation)
        } catch (error) {
          settle(reject, commandError(`${name} absence publication failed: ${error.message}`, "failed"))
          return
        }
        if (!acceptedExitCodes.includes(code)) {
          settle(
            reject,
            attachCapturedOutput(
              commandError(
                `${name} failed with ${childSignal ?? `exit ${code}`}`,
                Number.isInteger(code) && code >= 0 ? `exit:${code}` : "failed"
              )
            )
          )
        } else {
          settle(
            resolve,
            captureOutput
              ? {
                  exitCode: code,
                  output: Buffer.concat(outputChunks).toString("utf8"),
                  outputLineCount: outputLineCount()
                }
              : { exitCode: code, outputLineCount: outputLineCount() }
          )
        }
      }
      finishOrdinaryExit()
    })
  })
