import { appendFileSync, mkdirSync, writeFileSync } from "node:fs"
import { join, resolve as resolvePath } from "node:path"
import { stageArtifactEvidence } from "./gate-run-artifacts.mjs"
import { artifactEvidence } from "./gate-run-evidence.mjs"
import { wallClockTimestamp, atomicRecord, custodyVersion, readRecord } from "./gate-custody-records.mjs"
import { proveStageDescendantsStopped, publishAbsence, publishNoChild, registerSpawn } from "./gate-registration.mjs"
import { spawn, spawnSync } from "node:child_process"
import { performance } from "node:perf_hooks"
import { clearTimeout, setTimeout } from "node:timers"
import {
  createFormalProgressLifecycle,
  createFormalProgressReader,
  formalProgressHeartbeatMilliseconds
} from "./formal-progress-events.mjs"
import { createConsoleOutputPresenter } from "./quality-output-budget.mjs"
import { isOrdinaryQualityCommandResult } from "./quality-gate-failure-policy.mjs"

const defaultTerminationGraceMilliseconds = 5000
const defaultProcessGroupAbsenceTimeoutMilliseconds = 2000
const processGroupObservationIntervalMilliseconds = 25

const commandError = (message, quintCommandResult) => Object.assign(new Error(message), { quintCommandResult })

const retainedLogFailure = (name, phase, error) =>
  Object.assign(commandError(`${name} retained log ${phase} failed: ${error.message}`, "logging-failed"), {
    loggingFailure: { phase, message: error.message }
  })

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
  onProgress,
  processGroupAbsenceTimeoutMilliseconds = defaultProcessGroupAbsenceTimeoutMilliseconds,
  progress,
  progressHeartbeatMilliseconds = formalProgressHeartbeatMilliseconds,
  progressTransport,
  relayedSignalGraceMilliseconds,
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

    const progressSpec = typeof progress === "function" ? { emit: progress } : progress
    if (
      progressSpec !== undefined &&
      (progressSpec === null || typeof progressSpec !== "object" || typeof progressSpec.emit !== "function")
    )
      throw new Error("Bounded command progress requires an event emitter")
    const transportSpec =
      typeof progressTransport === "function"
        ? { onEvent: progressTransport }
        : progressTransport === true
          ? { onEvent: typeof onProgress === "function" ? onProgress : () => {} }
          : progressTransport
    if (
      transportSpec !== undefined &&
      (transportSpec === null || typeof transportSpec !== "object" || typeof transportSpec.onEvent !== "function")
    )
      throw new Error("Bounded command progress transport requires an event callback")
    const hasProgressTransport = transportSpec !== undefined

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
      const command = {
        executable,
        args,
        cwd: resolvePath(cwd ?? process.cwd()),
        name,
        timeoutMilliseconds,
        acceptedExitCodes,
        relayParentSignals,
        terminationGraceMilliseconds,
        processGroupAbsenceTimeoutMilliseconds
      }
      if (relayedSignalGraceMilliseconds !== undefined)
        command.relayedSignalGraceMilliseconds = relayedSignalGraceMilliseconds
      registered = registerSpawn({
        command,
        environment: environment ?? process.env,
        spawnChild: (childEnvironment) =>
          spawn(executable, args, {
            cwd,
            detached: process.platform !== "win32",
            env: childEnvironment,
            stdio: ["inherit", "pipe", "pipe", hasProgressTransport ? "pipe" : "ignore"]
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
        loggingError = retainedLogFailure(name, "create", error)
      }
    }
    let actualExit
    let absenceProven = false
    const progressReader =
      hasProgressTransport && child.stdio?.[3] !== undefined
        ? createFormalProgressReader({ onEvent: transportSpec.onEvent, onError: transportSpec.onError })
        : undefined
    child.stdio?.[3]?.on("data", (chunk) => progressReader?.push(chunk))
    child.stdio?.[3]?.on("error", () => progressReader?.close())
    const progressStartedAt = wallClockTimestamp()
    const progressStartedEpochMilliseconds = performance.now()
    const progressDeadline = Number.isFinite(timeoutMilliseconds)
      ? new Date(Date.parse(progressStartedAt) + timeoutMilliseconds).toISOString()
      : progressStartedAt
    const progressLifecycle =
      progressSpec === undefined
        ? undefined
        : createFormalProgressLifecycle({
            emit: progressSpec.emit,
            identity: progressSpec.identity,
            startedAt: progressStartedAt,
            startedEpochMilliseconds: progressStartedEpochMilliseconds,
            deadline: progressDeadline,
            logPath,
            heartbeatMilliseconds: progressHeartbeatMilliseconds
          })
    try {
      progressSpec?.onLifecycle?.(progressLifecycle)
    } catch {
      progressLifecycle?.close()
    }
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
            ["test", "test:coverage", "coverage:body"].includes(argument)
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
    const presenter =
      forwardOutput && logPath !== undefined ? createConsoleOutputPresenter({ name, logPath }) : undefined
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
      if (loggingError === undefined && logPath !== undefined) error.logPath = logPath
      if (loggingError !== undefined) error.loggingFailure = loggingError.loggingFailure
      return error
    }

    const cleanup = () => {
      clearTimeout(timer)
      clearTimeout(escalationTimer)
      clearTimeout(absenceTimer)
      signal?.removeEventListener("abort", cancel)
      for (const [parentSignal, listener] of signalListeners) process.removeListener(parentSignal, listener)
      progressReader?.close()
    }

    const settle = (settler, value) => {
      if (settled) return
      if (absenceProven && (settler === resolve || isOrdinaryQualityCommandResult(value))) {
        try {
          proveStageDescendantsStopped(obligation)
        } catch (error) {
          settler = reject
          value = commandError(`${name} descendant custody is not proven stopped: ${error.message}`, "failed")
        }
      }
      if (obligation !== undefined && value !== undefined) value.gateObligationId = obligation.intent.obligationId
      if (loggingError !== undefined && value instanceof Error) value.loggingFailure = loggingError.loggingFailure
      settled = true
      publishTerminal(settler === resolve ? value : undefined, settler === reject ? value : undefined)
      presenter?.finish({
        failed: settler === reject,
        logAvailable: loggingError === undefined,
        logFailure: loggingError?.message
      })
      if (progressLifecycle !== undefined && progressSpec?.terminal !== false) {
        const outcome =
          (settler === reject ? value?.quintCommandResult : undefined) ??
          (settler === resolve ? `exit:${value?.exitCode}` : "failed")
        progressLifecycle.terminal({ outcome, exitCode: actualExit?.code ?? null, signal: actualExit?.signal ?? null })
      }
      cleanup()
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
        relayedSignal === undefined
          ? terminationGraceMilliseconds
          : (relayedSignalGraceMilliseconds ?? Math.min(1000, terminationGraceMilliseconds))
      escalationTimer = setTimeout(forceTermination, grace)
    }

    const cancel = () => beginTermination({ error: commandError(`${name} cancelled`, "cancelled") })

    const observeOutput = (output, destination, lineCounter) => {
      if (logPath !== undefined && loggingError === undefined) {
        try {
          appendFileSync(logPath, output)
        } catch (error) {
          loggingError = retainedLogFailure(name, "append", error)
        }
      }
      if (captureOutput) outputChunks.push(output)
      lineCounter.wasWritten = true
      lineCounter.endsWithLineBreak = output.at(-1) === 10
      progressLifecycle?.observeOutput()
      for (const byte of output) {
        if (byte === 10) lineCounter.lineBreaks += 1
      }
      if (forwardOutput) {
        if (presenter === undefined) destination.write(output)
        else presenter.write(output, destination)
      }
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
        } else if (loggingError !== undefined) {
          const failure = commandError(loggingError.message, "logging-failed")
          failure.loggingFailure = loggingError.loggingFailure
          failure.exitCode = code
          failure.signal = childSignal
          settle(reject, attachCapturedOutput(failure))
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
