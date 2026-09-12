import { spawn } from "node:child_process"
import { fileURLToPath } from "node:url"
import { epochMilliseconds, inheritedCustody, repositoryLocation, withFileLock } from "./gate-custody-records.mjs"
import { ensureRegistrationOpen, registrationLockPath } from "./gate-registration.mjs"
import { runBoundedCommand } from "./run-bounded-command.mjs"

const separator = process.argv.indexOf("--")
const commandArguments = separator === -1 ? [] : process.argv.slice(separator + 1)
if (commandArguments.length === 0) throw new Error("Name the admitted command after --")
if (process.env.DALPH_RUN_REAL_CODEX_QUALIFICATION === "1")
  throw new Error(
    "Real Codex qualification is outside supported gate custody; run direct opt-in qualification separately"
  )
if (process.env.DALPH_QUALIFICATION_ENV_CAPTURE !== undefined)
  throw new Error(
    "Ambient qualification environment capture is outside supported gate custody; tests set only disposable fixture paths"
  )
const context = inheritedCustody()
const location = repositoryLocation()
if (context !== undefined) {
  if (context.run.worktree !== location.worktree || context.run.commonDirectory !== location.commonDirectory)
    throw new Error("Inherited gate custody belongs to another worktree")
  withFileLock(registrationLockPath(context.runDirectory), () => ensureRegistrationOpen(context))
  try {
    const result = await runBoundedCommand({
      args: commandArguments.slice(1),
      executable: commandArguments[0],
      name: "nested admitted gate",
      relayParentSignals: true,
      timeoutMilliseconds: 24 * 60 * 60 * 1000
    })
    process.exitCode = result.exitCode
  } catch (error) {
    console.error(error.message)
    process.exitCode = /^exit:\d+$/u.test(error.quintCommandResult ?? "")
      ? Number(error.quintCommandResult.slice(5))
      : 1
  }
} else {
  const runner = fileURLToPath(new URL("./run-admitted-gate.mjs", import.meta.url))
  // The shell holds the exact worktree lock before the custody runner takes a clone slot. Descendants need no lock fd.
  const shell = [
    "set -eu",
    'exec 8>"$DALPH_WORKTREE_LOCK"',
    'if ! flock -n 8; then echo "[gate-slot] waiting for worktree writer" >&2; flock 8; fi',
    'exec "$@"'
  ].join("\n")
  const { mkdirSync } = await import("node:fs")
  mkdirSync(location.custodyRoot, { recursive: true })
  const child = spawn("bash", ["-c", shell, "gate-custody", process.execPath, runner, "--", ...commandArguments], {
    env: {
      ...process.env,
      DALPH_WORKTREE_LOCK: location.worktreeLock,
      DALPH_GATE_WAIT_STARTED_MILLISECONDS: String(epochMilliseconds())
    },
    stdio: "inherit"
  })
  const listeners = new Map(["SIGINT", "SIGTERM"].map((signal) => [signal, () => child.kill(signal)]))
  for (const [signal, listener] of listeners) process.on(signal, listener)
  process.exitCode = await new Promise((resolve) => {
    child.once("error", (error) => {
      console.error(error.message)
      resolve(1)
    })
    child.once("close", (code, signal) => resolve(signal === null ? (code ?? 1) : 1))
  })
  for (const [signal, listener] of listeners) process.removeListener(signal, listener)
}
