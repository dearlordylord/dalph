import { spawn } from "node:child_process"
import { basename } from "node:path"
import { fileURLToPath } from "node:url"
import { epochMilliseconds, inheritedCustody, repositoryLocation, withFileLock } from "./gate-custody-records.mjs"
import { ensureRegistrationOpen, registrationLockPath } from "./gate-registration.mjs"
import { runBoundedCommand } from "./run-bounded-command.mjs"
import { gateDeadlineEnvironmentName, remainingGateMilliseconds, resolveGateDeadline } from "./gate-deadline.mjs"
import {
  formalVerificationExecutables,
  qualityVerificationExecutables,
  stabilizeVerificationEnvironment
} from "./stabilize-verification-path.mjs"

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
const entryName = basename(commandArguments[1] ?? "")
if (
  process.env.DALPH_GATE_RECOVERY_MODE !== undefined &&
  [
    "run-baseline.mjs",
    "run-formal-gate.mjs",
    "run-hosted-quality-stage.mjs",
    "run-preflight.mjs",
    "run-quality-gate.mjs"
  ].includes(entryName)
)
  throw new Error("A focused gate recovery action cannot launch a broad admitted command")
const requiredExecutables = ["run-hosted-quality-stage.mjs", "run-quality-gate.mjs"].includes(entryName)
  ? qualityVerificationExecutables(process.env, commandArguments[0])
  : entryName === "run-formal-gate.mjs"
    ? formalVerificationExecutables(process.env, commandArguments[0])
    : undefined
const effectiveEnvironment =
  requiredExecutables === undefined
    ? process.env
    : stabilizeVerificationEnvironment({ environment: process.env, requiredExecutables })
if (effectiveEnvironment.PATH !== undefined) process.env.PATH = effectiveEnvironment.PATH
const context = inheritedCustody()
const location = repositoryLocation()
const deadline = resolveGateDeadline({
  configured: effectiveEnvironment[gateDeadlineEnvironmentName],
  inherited: context?.run.deadline
})
const deadlineEnvironment = { ...effectiveEnvironment, [gateDeadlineEnvironmentName]: deadline }
if (context !== undefined) {
  if (context.run.worktree !== location.worktree || context.run.commonDirectory !== location.commonDirectory)
    throw new Error("Inherited gate custody belongs to another worktree")
  withFileLock(
    registrationLockPath(context.runDirectory),
    () => ensureRegistrationOpen(context),
    remainingGateMilliseconds(deadline)
  )
  try {
    const result = await runBoundedCommand({
      args: commandArguments.slice(1),
      executable: commandArguments[0],
      environment: deadlineEnvironment,
      name: "nested admitted gate",
      relayParentSignals: true,
      timeoutMilliseconds: remainingGateMilliseconds(deadline)
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
    'if ! flock -n 8; then echo "[gate-slot] waiting for worktree writer" >&2; flock -w "$DALPH_GATE_LOCK_WAIT_SECONDS" 8 || { echo "Gate deadline expired waiting for worktree writer" >&2; exit 1; }; fi',
    'exec "$@"'
  ].join("\n")
  const { mkdirSync } = await import("node:fs")
  mkdirSync(location.custodyRoot, { recursive: true })
  const child = spawn("bash", ["-c", shell, "gate-custody", process.execPath, runner, "--", ...commandArguments], {
    env: {
      ...deadlineEnvironment,
      DALPH_GATE_LOCK_WAIT_SECONDS: String(remainingGateMilliseconds(deadline) / 1000),
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
