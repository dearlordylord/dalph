import { spawn, spawnSync } from "node:child_process"
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  gateSlotCountEnvironmentName,
  gateSlotEnvironmentName,
  gateSlots,
  resolveGateSlotCount,
  shouldAcquireGateSlot
} from "./gate-slot-policy.mjs"

const retryDelayMilliseconds = 5_000

const separatorIndex = process.argv.indexOf("--")
const commandArguments = separatorIndex === -1 ? [] : process.argv.slice(separatorIndex + 1)

if (commandArguments.length === 0) {
  throw new Error("Name the admitted command after --, for example: with-gate-slot.mjs -- pnpm coverage:body")
}

const commandName = commandArguments.join(" ")

const exitCodeOf = (code, signal) => (signal === null ? (code ?? 0) : 1)

const runUnadmitted = () =>
  new Promise((resolve) => {
    const child = spawn(commandArguments[0], commandArguments.slice(1), { stdio: "inherit" })
    child.on("exit", (code, signal) => resolve(exitCodeOf(code, signal)))
  })

if (!shouldAcquireGateSlot({ occupiedSlot: process.env[gateSlotEnvironmentName] })) {
  process.exit(await runUnadmitted())
}

const lockDirectoryResult = spawnSync("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], {
  encoding: "utf8"
})

// Admission coordinates the worktrees of one clone. A copy that sits outside any repository, such as a hermetic
// fixture, has no other worktree to coordinate with, so it runs the gate directly.
if (lockDirectoryResult.status !== 0) {
  process.exit(await runUnadmitted())
}

const slots = gateSlots({
  lockDirectory: lockDirectoryResult.stdout.trim(),
  slotCount: resolveGateSlotCount({ configured: process.env[gateSlotCountEnvironmentName] })
})

// The acquiring shell holds the flock on descriptor 9 and then replaces itself with the gate, so the kernel releases
// the slot when the gate ends however it ends. It records the acquisition before that replacement, which is how the
// caller tells an unacquired slot apart from a gate that chose the same exit code.
const acquisitionScript = [
  "set -eu",
  'exec 9>"$DALPH_SLOT_LOCK"',
  "flock -n 9 || exit 0",
  'printf "acquired\\n" >"$DALPH_SLOT_STATUS"',
  'printf "%s pid=%s slot=%s command=%s\\n" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$$" "$DALPH_GATE_SLOT" "$DALPH_SLOT_COMMAND" >"$DALPH_SLOT_HOLDER" 2>/dev/null || true',
  'if [ -n "${DALPH_SLOT_WAITED_FROM:-}" ]; then',
  '  echo "[gate-slot] admitted: $DALPH_SLOT_COMMAND to slot $DALPH_GATE_SLOT after $(( $(date +%s%N) / 1000000 - DALPH_SLOT_WAITED_FROM ))ms" >&2',
  "fi",
  'exec "$@"'
].join("\n")

// Every timestamp in this wrapper comes from the same `date` reading the acquiring shell uses, so a queue report and
// the holder record it names are directly comparable.
const clockReading = () => {
  const reading = spawnSync("date", ["-u", "+%s%3N %Y-%m-%dT%H:%M:%SZ"], { encoding: "utf8" })
  const [epochMilliseconds, timestamp] = reading.stdout.trim().split(" ")
  return { epochMilliseconds, timestamp }
}

const currentHolder = (slot) => {
  try {
    const record = readFileSync(slot.holder, "utf8").trim()
    return record === "" ? "unknown" : record
  } catch {
    return "unknown"
  }
}

const attemptSlot = ({ slot, statusDirectory, waitedFrom }) =>
  new Promise((resolve) => {
    const statusPath = join(statusDirectory, `slot-${slot.ordinal}`)
    const child = spawn("bash", ["-c", acquisitionScript, commandName, ...commandArguments], {
      env: {
        ...process.env,
        DALPH_SLOT_COMMAND: commandName,
        DALPH_SLOT_HOLDER: slot.holder,
        DALPH_SLOT_LOCK: slot.lock,
        DALPH_SLOT_STATUS: statusPath,
        DALPH_SLOT_WAITED_FROM: waitedFrom,
        [gateSlotEnvironmentName]: String(slot.ordinal)
      },
      stdio: "inherit"
    })
    child.on("exit", (code, signal) => {
      let acquired = false
      try {
        acquired = readFileSync(statusPath, "utf8").startsWith("acquired")
      } catch {
        acquired = false
      }
      resolve({ acquired, exitCode: exitCodeOf(code, signal) })
    })
  })

const statusDirectory = mkdtempSync(join(tmpdir(), "dalph-gate-slot-"))
const waitStartedAt = clockReading().epochMilliseconds
let waitedFrom = ""

const admittedExitCode = await (async () => {
  for (;;) {
    for (const slot of slots) {
      const attempt = await attemptSlot({ slot, statusDirectory, waitedFrom })
      if (attempt.acquired) {
        return attempt.exitCode
      }
    }
    if (waitedFrom === "") {
      waitedFrom = waitStartedAt
      console.error(
        [
          `[gate-slot] waiting: ${commandName} at ${clockReading().timestamp}`,
          ...slots.map((slot) => `  slot ${slot.ordinal} holder: ${currentHolder(slot)}`)
        ].join("\n")
      )
    }
    await new Promise((resolve) => setTimeout(resolve, retryDelayMilliseconds))
  }
})()

rmSync(statusDirectory, { force: true, recursive: true })
process.exit(admittedExitCode)
