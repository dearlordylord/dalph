import { existsSync, mkdirSync } from "node:fs"
import { join, resolve } from "node:path"
import { setTimeout } from "node:timers/promises"
import {
  epochMilliseconds,
  wallClockTimestamp,
  atomicRecord,
  custodyVersion,
  inheritedCustody,
  localHostIdentity,
  newIdentity,
  openFileLock,
  readRecord,
  removeRecord,
  repositoryLocation,
  requireWorktreeLock
} from "./gate-custody-records.mjs"
import { closeAndProveCustodyStopped } from "./gate-registration.mjs"
import {
  gateSlotCountEnvironmentName,
  gateSlotEnvironmentName,
  gateSlots,
  resolveGateSlotCount
} from "./gate-slot-policy.mjs"
import { createRunInputIdentity, currentSourceInputDigest } from "./gate-run-identity.mjs"
import { artifactEvidence, readRunEvidence } from "./gate-run-evidence.mjs"
import { runBoundedCommand } from "./run-bounded-command.mjs"

const commandArguments = process.argv.slice(process.argv.indexOf("--") + 1)
if (commandArguments.length === 0) throw new Error("Name an admitted command after --")
if (process.env.DALPH_RUN_REAL_CODEX_QUALIFICATION === "1")
  throw new Error(
    "Real Codex qualification is outside supported gate custody; run direct opt-in qualification separately"
  )
const inherited = inheritedCustody()
if (process.env.DALPH_QUALIFICATION_ENV_CAPTURE !== undefined)
  throw new Error("Ambient qualification environment capture is outside supported gate custody")
if (inherited !== undefined) throw new Error("The fresh custody runner cannot inherit an active run")
const location = repositoryLocation()
requireWorktreeLock(location.worktreeLock)
if (existsSync(location.worktreeFence)) {
  const fence = readRecord(location.worktreeFence)
  throw new Error(`Worktree requires reconciliation of gate run ${fence.runId}; no writer launched`)
}
const slots = gateSlots({
  lockDirectory: location.commonDirectory,
  slotCount: resolveGateSlotCount({ configured: process.env[gateSlotCountEnvironmentName] })
})
let ownedSlot
let releaseSlot
const startedWaiting = Number(process.env.DALPH_GATE_WAIT_STARTED_MILLISECONDS ?? epochMilliseconds())
if (!Number.isFinite(startedWaiting)) throw new Error("Invalid admission wait observation")
for (;;) {
  const fenced = []
  for (const slot of slots) {
    const release = openFileLock(slot.lock, true)
    if (release === undefined) continue
    if (existsSync(slot.fence)) {
      fenced.push(readRecord(slot.fence).runId)
      release()
      continue
    }
    ownedSlot = slot
    releaseSlot = release
    break
  }
  if (ownedSlot !== undefined) break
  if (fenced.length === slots.length)
    throw new Error(`All clone gate slots require reconciliation: ${fenced.join(", ")}`)
  console.error(
    `[gate-slot] waiting; holders: ${slots.map((slot) => (existsSync(slot.fence) ? readRecord(slot.fence).runId : "busy or available")).join(", ")}`
  )
  await setTimeout(250)
}
const runId = newIdentity()
const runDirectory = join(location.custodyRoot, "runs", runId)
const reportDirectory = join(location.worktree, ".scratch", "quality-gates", runId)
const run = {
  version: custodyVersion,
  ...location,
  runId,
  reportDirectory,
  slot: ownedSlot.ordinal,
  slotFence: ownedSlot.fence,
  slotLock: ownedSlot.lock,
  host: localHostIdentity(),
  ownerPid: process.pid,
  commandArguments,
  requiresQualityComposite:
    process.env.npm_lifecycle_event === "check:all" &&
    resolve(commandArguments[1] ?? "") === join(location.worktree, "scripts", "run-quality-gate.mjs"),
  startedAt: wallClockTimestamp(),
  queueMilliseconds: epochMilliseconds() - startedWaiting
}
mkdirSync(join(runDirectory, "obligations"), { recursive: true })
atomicRecord(join(runDirectory, "run.json"), run)
atomicRecord(join(runDirectory, "registration.json"), {
  version: custodyVersion,
  runId,
  state: "open",
  obligations: []
})
const fence = { version: custodyVersion, runId, runDirectory, worktree: run.worktree, slot: run.slot }
atomicRecord(location.worktreeFence, fence)
atomicRecord(ownedSlot.fence, fence)
console.error(`[gate-run] ${runId} reports=${reportDirectory}`)
let commandExit = 1
try {
  const identity = createRunInputIdentity({ commandArguments, worktree: run.worktree })
  atomicRecord(join(runDirectory, "identity.json"), identity)
  const environment = {
    ...process.env,
    DALPH_GATE_RUN_DIRECTORY: runDirectory,
    DALPH_GATE_RUN_ID: runId,
    DALPH_GATE_OBLIGATION: "root",
    [gateSlotEnvironmentName]: String(run.slot),
    DALPH_COVERAGE_BASE_SHA: identity.baseSha,
    DALPH_COVERAGE_DIRECTORY: join(reportDirectory, "coverage")
  }
  let result
  let failure
  try {
    result = await runBoundedCommand({
      args: commandArguments.slice(1),
      captureOutput: false,
      environment,
      executable: commandArguments[0],
      name: "admitted gate command",
      relayParentSignals: true,
      timeoutMilliseconds: 24 * 60 * 60 * 1000
    })
    commandExit = result.exitCode
  } catch (error) {
    failure = error
    commandExit = /^exit:\d+$/u.test(error.quintCommandResult ?? "") ? Number(error.quintCommandResult.slice(5)) : 1
    console.error(error.message)
  }
  const context = { run, runDirectory }
  const obligationCount = closeAndProveCustodyStopped(context)
  const sourceUnchanged = currentSourceInputDigest(run.worktree) === identity.sourceInputDigest
  atomicRecord(join(runDirectory, "terminal.json"), {
    version: custodyVersion,
    runId,
    inputDigest: identity.inputDigest,
    commandExit,
    outcome: failure?.quintCommandResult ?? (commandExit === 0 ? "passed" : "failed"),
    custody: "stopped",
    obligationCount,
    sourceUnchanged,
    finishedAt: wallClockTimestamp(),
    coverage: {
      final: artifactEvidence(join(reportDirectory, "coverage", "coverage-final.json")),
      summary: artifactEvidence(join(reportDirectory, "coverage", "coverage-summary.json"))
    }
  })
  const evidence = readRunEvidence({ runDirectory, runId })
  if (commandExit === 0 && evidence.qualification !== "passed") {
    console.error("Gate qualification UNPROVEN: terminal evidence is incomplete")
    commandExit = 1
  }
  for (const path of [ownedSlot.fence, location.worktreeFence]) {
    if (readRecord(path).runId !== runId) throw new Error("Gate fence changed; cannot clear another run's custody")
    removeRecord(path)
  }
  if (!sourceUnchanged) {
    console.error("Candidate inputs changed during qualification; result is UNPROVEN")
    commandExit = 1
  }
} catch (error) {
  console.error(`[gate-run] ${runId} remains fenced: ${error.message}`)
  commandExit = 1
} finally {
  releaseSlot()
}
process.exitCode = commandExit
