import { spawn, spawnSync } from "node:child_process"
import { clearTimeout, setTimeout } from "node:timers"

const defaultTerminationGraceMilliseconds = 5000

const terminate = (child, signal) => {
  if (child.pid === undefined) return

  if (process.platform === "win32") {
    spawnSync("taskkill", ["/pid", String(child.pid), "/t", "/f"], {
      stdio: "ignore"
    })
    return
  }

  try {
    process.kill(-child.pid, signal)
  } catch (error) {
    if (error.code !== "ESRCH") throw error
  }
}

export const runBoundedCommand = ({
  args,
  executable,
  name,
  terminationGraceMilliseconds = defaultTerminationGraceMilliseconds,
  timeoutMilliseconds
}) =>
  new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      detached: process.platform !== "win32",
      stdio: "inherit"
    })
    let timedOut = false
    let escalationTimer

    const timer = setTimeout(() => {
      timedOut = true
      try {
        terminate(child, "SIGTERM")
      } catch (error) {
        reject(error)
        return
      }
      if (process.platform === "win32") {
        reject(
          new Error(
            `${name} exceeded ${timeoutMilliseconds / 1000} seconds`
          )
        )
        return
      }
      escalationTimer = setTimeout(() => {
        try {
          terminate(child, "SIGKILL")
          reject(
            new Error(
              `${name} exceeded ${timeoutMilliseconds / 1000} seconds`
            )
          )
        } catch (error) {
          reject(error)
        }
      }, terminationGraceMilliseconds)
    }, timeoutMilliseconds)

    child.once("error", (error) => {
      clearTimeout(timer)
      if (!timedOut) {
        clearTimeout(escalationTimer)
        reject(error)
      }
    })
    child.once("exit", (code, signal) => {
      clearTimeout(timer)

      if (timedOut) {
        return
      }
      clearTimeout(escalationTimer)
      if (code !== 0) {
        reject(new Error(`${name} failed with ${signal ?? `exit ${code}`}`))
      } else {
        resolve()
      }
    })
  })
