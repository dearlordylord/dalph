import { writeSync } from "node:fs"
import { performance } from "node:perf_hooks"
import { clearInterval, setInterval } from "node:timers"
import { wallClockTimestamp } from "./gate-custody-records.mjs"

/**
 * Lifecycle messages are live presentation only. Formal reports, receipts and
 * custody records remain the authorities for command results.
 */
export const formalProgressEventVersion = 1
export const formalProgressHeartbeatMilliseconds = 15_000

const finiteNonNegative = (value, name) => {
  if (!Number.isFinite(value) || value < 0) throw new Error(`${name} must be a finite non-negative number`)
  return value
}

const asIdentity = (identity) => {
  if (identity === undefined) return {}
  if (identity === null || typeof identity !== "object" || Array.isArray(identity))
    throw new Error("Formal progress identity must be an object")
  for (const name of ["position", "kind", "name"]) {
    if (identity[name] === undefined) continue
    if (name === "position" && (!Number.isSafeInteger(identity[name]) || identity[name] < 0))
      throw new Error("Formal progress identity position must be a non-negative safe integer")
    if (name !== "position" && (typeof identity[name] !== "string" || identity[name] === ""))
      throw new Error(`Formal progress identity ${name} must be a non-empty string`)
  }
  return { ...identity }
}

const serialize = (event) => `${JSON.stringify(event)}\n`

/**
 * Best-effort writer for the opt-in inherited fd3 channel. A closed parent is
 * expected during interruption/reconciliation; callers retain the real child
 * outcome even when this writer can no longer publish presentation events.
 */
export const createFormalProgressWriter = ({ fd = 3, write = writeSync } = {}) => {
  if (!Number.isSafeInteger(fd) || fd < 0) throw new Error("Formal progress fd must be a non-negative integer")
  let open = true
  return {
    get open() {
      return open
    },
    emit(event) {
      if (!open) return false
      try {
        write(fd, serialize(event))
        return true
      } catch {
        open = false
        return false
      }
    },
    close() {
      open = false
    }
  }
}

/**
 * Incremental NDJSON reader for the other end of fd3. Invalid messages are
 * reported to the optional diagnostic callback and never alter child verdicts.
 */
export const createFormalProgressReader = ({ onError = () => {}, onEvent } = {}) => {
  if (typeof onEvent !== "function") throw new Error("Formal progress reader requires an event callback")
  let remainder = ""
  let closed = false
  const parse = (line) => {
    if (line.length === 0) return
    try {
      const event = JSON.parse(line)
      if (
        event === null ||
        typeof event !== "object" ||
        Array.isArray(event) ||
        event.version !== formalProgressEventVersion ||
        typeof event.type !== "string"
      )
        throw new Error("invalid formal progress event")
      onEvent(event)
    } catch (error) {
      try {
        onError(error, line)
      } catch {
        // Diagnostics are deliberately outside the formal outcome contract.
      }
    }
  }
  return {
    push(chunk) {
      if (closed) return
      remainder += Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk)
      let newline
      while ((newline = remainder.indexOf("\n")) >= 0) {
        parse(remainder.slice(0, newline).replace(/\r$/u, ""))
        remainder = remainder.slice(newline + 1)
      }
    },
    close() {
      closed = true
      // A writer always emits newline-delimited records. Do not fabricate an
      // event from a truncated line when the parent disappears.
      remainder = ""
    }
  }
}

const monotonicNow = () => performance.now()

/**
 * Attach live-only lifecycle facts to a bounded child. The runner calls
 * observeOutput for bytes observed from stdout/stderr, and calls terminal only
 * after its caller has validated the command's required verdict.
 */
export const createFormalProgressLifecycle = ({
  clock = wallClockTimestamp,
  deadline,
  emit,
  heartbeatMilliseconds = formalProgressHeartbeatMilliseconds,
  identity,
  logPath = null,
  now = monotonicNow,
  startedAt = wallClockTimestamp(),
  startedEpochMilliseconds = monotonicNow()
} = {}) => {
  if (typeof emit !== "function") throw new Error("Formal progress lifecycle requires an event emitter")
  if (typeof startedAt !== "string" || startedAt === "") throw new Error("Formal progress start requires a timestamp")
  finiteNonNegative(startedEpochMilliseconds, "Formal progress start time")
  if (typeof deadline !== "string" || deadline === "") throw new Error("Formal progress requires an absolute deadline")
  finiteNonNegative(heartbeatMilliseconds, "Formal progress heartbeat interval")
  const semanticIdentity = asIdentity(identity)
  let ended = false
  let transportOpen = true
  let lastObservedOutputAt
  let timer

  const elapsed = () => Math.max(0, now() - startedEpochMilliseconds)
  const common = () => ({
    version: formalProgressEventVersion,
    ...semanticIdentity,
    elapsedMilliseconds: elapsed(),
    deadline,
    logPath,
    lastObservedOutputAt: lastObservedOutputAt ?? null
  })
  const send = (event) => {
    if (!transportOpen) return false
    try {
      const accepted = emit({ ...common(), ...event })
      if (accepted === false) {
        transportOpen = false
        if (timer !== undefined) clearInterval(timer)
        timer = undefined
        return false
      }
      return true
    } catch {
      transportOpen = false
      if (timer !== undefined) clearInterval(timer)
      timer = undefined
      return false
    }
  }

  const startSent = send({ type: "start", startedAt })
  if (startSent && heartbeatMilliseconds > 0) {
    timer = setInterval(() => {
      if (ended || !transportOpen) return
      send({ type: "heartbeat", backendProgress: "unknown", heartbeatAt: clock() })
    }, heartbeatMilliseconds)
    timer.unref()
  }

  return {
    observeOutput() {
      if (ended) return
      lastObservedOutputAt = clock()
    },
    terminal({ backendProgress, exitCode = null, finishedAt = clock(), outcome, signal = null } = {}) {
      if (ended) return false
      ended = true
      if (timer !== undefined) clearInterval(timer)
      timer = undefined
      if (typeof outcome !== "string" || outcome === "") throw new Error("Formal progress terminal needs an outcome")
      return send({
        type: "terminal",
        outcome,
        exitCode,
        signal,
        finishedAt,
        ...(backendProgress === undefined ? {} : { backendProgress })
      })
    },
    close() {
      ended = true
      if (timer !== undefined) clearInterval(timer)
      timer = undefined
    },
    get lastObservedOutputAt() {
      return lastObservedOutputAt
    },
    get open() {
      return transportOpen
    }
  }
}

const displayIdentity = (event) =>
  event.name === undefined
    ? `position=${event.position ?? "?"}`
    : `${event.name}${event.position === undefined ? "" : ` [${event.position}]`}`

const displayElapsed = (event) => `${(event.elapsedMilliseconds / 1000).toFixed(2)}s`

/** Render one bounded lifecycle line; raw child output is intentionally absent. */
export const renderFormalProgressEvent = (event) => {
  const identity = displayIdentity(event)
  const log = event.logPath ?? "no retained log"
  if (event.type === "start")
    return `Formal: start ${identity}; elapsed=${displayElapsed(event)}; deadline=${event.deadline}; log=${log}`
  if (event.type === "heartbeat")
    return (
      `Formal: heartbeat ${identity}; elapsed=${displayElapsed(event)}; ` +
      `last observed child output=${event.lastObservedOutputAt ?? "none"}; deadline=${event.deadline}; log=${log}; ` +
      "backend progress unknown"
    )
  if (event.type === "terminal")
    return `Formal: complete ${identity}; outcome=${event.outcome}; elapsed=${displayElapsed(event)}; log=${log}`
  return `Formal: lifecycle ${identity}; type=${event.type}; elapsed=${displayElapsed(event)}; log=${log}`
}
