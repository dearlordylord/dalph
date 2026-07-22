import { spawn, spawnSync } from "node:child_process"
import { clearTimeout, setTimeout } from "node:timers"

const SECOND = 1_000
const pnpmEntryPoint = process.env.npm_execpath

if (pnpmEntryPoint === undefined) {
  throw new Error("Run the quality gate through pnpm so its executable can be resolved safely")
}

const gates = [
  { args: ["build"], name: "build", timeout: 2 * 60 * SECOND },
  { args: ["typecheck"], name: "typecheck", timeout: 2 * 60 * SECOND },
  { args: ["check:format"], name: "format and lint", timeout: 2 * 60 * SECOND },
  { args: ["check:circular"], name: "dependency cycles", timeout: 60 * SECOND },
  { args: ["check:duplicates"], name: "duplication", timeout: 60 * SECOND },
  { args: ["check:quint"], name: "Quint recovery model", timeout: 2 * 60 * SECOND },
  { args: ["test:coverage"], name: "tests and coverage", timeout: 5 * 60 * SECOND },
  { args: ["check:secrets"], name: "secret scan", timeout: 2 * 60 * SECOND }
]

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

const runGate = ({ args, name, timeout }) =>
  new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [pnpmEntryPoint, ...args], {
      detached: process.platform !== "win32",
      stdio: "inherit"
    })
    let timedOut = false

    const timer = setTimeout(() => {
      timedOut = true
      terminate(child, "SIGTERM")
      if (process.platform !== "win32") {
        setTimeout(() => terminate(child, "SIGKILL"), 5 * SECOND)
      }
    }, timeout)

    child.once("error", (error) => {
      clearTimeout(timer)
      reject(error)
    })
    child.once("exit", (code, signal) => {
      clearTimeout(timer)

      if (timedOut) {
        reject(new Error(`Quality gate '${name}' exceeded ${timeout / SECOND} seconds`))
      } else if (code !== 0) {
        reject(new Error(`Quality gate '${name}' failed with ${signal ?? `exit ${code}`}`))
      } else {
        resolve()
      }
    })
  })

for (const gate of gates) {
  await runGate(gate)
}
