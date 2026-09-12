import { spawn } from "node:child_process"
import { fileURLToPath } from "node:url"

export const inputObserverScript = fileURLToPath(new URL("./gate-input-observer.py", import.meta.url))

/** The helper shares the registered parent process group and exits on control EOF. Any lost observation is sticky. */
export const startInputObserver = async ({
  excludedRoots = [],
  protectedRoots = [],
  pythonExecutable = "python3",
  roots
}) => {
  const child = spawn(pythonExecutable, [inputObserverScript], { stdio: ["pipe", "pipe", "pipe"], detached: false })
  let failure
  let readyResolve
  let readyReject
  let buffer = ""
  let ordinal = 0
  let closed = false
  const pending = new Map()
  const ready = new Promise((resolve, reject) => {
    readyResolve = resolve
    readyReject = reject
  })
  const fail = (reason) => {
    failure ??= reason
    readyReject(new Error(failure))
    for (const request of pending.values()) request.reject(new Error(failure))
    pending.clear()
  }
  child.on("error", (error) => fail(`Input observer spawn failed: ${error.message}`))
  child.stdin.on("error", (error) => {
    if (!closed) fail(`Input observer control failed: ${error.message}`)
  })
  child.on("exit", (code, signal) => {
    if (!closed) fail(`Input observer exited: ${String(code)}/${String(signal)}`)
  })
  child.stderr.on("data", (data) => fail(`Input observer error: ${String(data).slice(0, 1024)}`))
  child.stdout.on("data", (data) => {
    buffer += data.toString("utf8")
    if (buffer.length > 1024 * 1024) {
      fail("Input observer message limit exceeded")
      return
    }
    let newline
    while ((newline = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, newline)
      buffer = buffer.slice(newline + 1)
      try {
        if (line.length > 4096) throw new Error("Input observer message too large")
        const message = JSON.parse(line)
        if (message.kind === "ready" && message.version === 1) readyResolve()
        else if (message.kind === "dirty" || message.kind === "error")
          fail(`${message.kind}: ${message.reason} ${message.path ?? ""}`)
        else if (message.kind === "ack" && pending.has(message.requestId)) {
          pending.get(message.requestId).resolve()
          pending.delete(message.requestId)
        } else throw new Error("Unknown input observer message")
      } catch (error) {
        fail(error.message)
      }
    }
  })
  child.stdout.on("end", () => {
    if (!closed) fail(buffer.length > 0 ? "Truncated input observer message" : "Input observer output EOF")
  })
  const request = (command, fields = {}) =>
    new Promise((resolve, reject) => {
      if (closed) {
        reject(new Error("Input observer is closed"))
        return
      }
      if (failure !== undefined) {
        reject(new Error(failure))
        return
      }
      const requestId = ++ordinal
      const timer = setTimeout(() => {
        pending.delete(requestId)
        fail("Input observer response timeout")
        reject(new Error(failure))
      }, 30_000)
      pending.set(requestId, {
        resolve: () => {
          clearTimeout(timer)
          resolve()
        },
        reject: (error) => {
          clearTimeout(timer)
          reject(error)
        }
      })
      child.stdin.write(`${JSON.stringify({ command, requestId, ...fields })}\n`)
    })
  const close = async () => {
    if (closed) return
    closed = true
    child.stdin.end()
    if (child.exitCode === null && child.signalCode === null) {
      await new Promise((resolve) => {
        child.once("close", resolve)
        setTimeout(() => {
          child.kill("SIGKILL")
        }, 1000).unref()
      })
    }
  }
  child.stdin.write(`${JSON.stringify({ roots, excludedRoots, protectedRoots })}\n`)
  const setupTimer = setTimeout(() => fail("Input observer readiness timeout"), 30_000)
  try {
    await ready
    clearTimeout(setupTimer)
    await request("drain")
  } catch (error) {
    clearTimeout(setupTimer)
    await close()
    throw error
  }
  return {
    assertUnchanged: () => request("drain"),
    protect: (paths) => request("protect", { roots: paths }),
    pause: () => request("pause"),
    processId: child.pid,
    close
  }
}
