import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { currentSourceContentDigest, currentSourceInputDigest } from "./gate-run-identity.mjs"
import {
  atomicRecord,
  digest,
  inheritedCustody,
  newIdentity,
  repositoryLocation,
  wallClockTimestamp
} from "./gate-custody-records.mjs"
import { gateRecoveryPath, readGateRecovery, withGateRecoveryLock } from "./gate-recovery.mjs"
import { runBoundedCommand } from "./run-bounded-command.mjs"

const arguments_ = process.argv.slice(2)
const failedRunId = arguments_.shift()
const intervention = arguments_
  .find((argument) => argument.startsWith("--intervention="))
  ?.slice("--intervention=".length)
if (
  failedRunId === undefined ||
  arguments_.some((argument) => !argument.startsWith("--intervention=")) ||
  (intervention !== undefined && intervention.trim() === "")
)
  throw new Error("Usage: pnpm gate:verify-repair <failed-run-id> [--intervention=<observed external change>]")
const location = repositoryLocation()
const custody = inheritedCustody()
if (custody === undefined || custody.run.worktree !== location.worktree)
  throw new Error("Run repair verification through the admitted pnpm gate:verify-repair entry point")
const actionId = newIdentity()
const sourceInputDigest = currentSourceInputDigest(location.worktree)
const sourceContentDigest = currentSourceContentDigest(location.worktree)
let command
withGateRecoveryLock(location, () => {
  const record = readGateRecovery(location)
  if (record === undefined || record.failedRunId !== failedRunId)
    throw new Error(`No matching gate obstruction for run ${failedRunId}`)
  if (!new Set(["repair-required", "verified"]).has(record.state))
    throw new Error(`Gate obstruction is ${record.state}, not repair-required`)
  const diagnosis = [...record.diagnosisAttempts].reverse().find((attempt) => attempt.outcome === "observed")
  if (diagnosis === undefined) throw new Error("Repair verification requires an observed focused diagnosis")
  if (diagnosis.sourceContentDigest === sourceContentDigest && intervention === undefined)
    throw new Error(
      "Repair verification requires changed candidate content or --intervention=<observed external change>"
    )
  command = diagnosis.command
  const verificationFingerprint = digest(JSON.stringify({ diagnosisActionId: diagnosis.actionId, sourceInputDigest }))
  if (
    record.verificationAttempts.some(
      (attempt) =>
        attempt.diagnosisActionId === diagnosis.actionId &&
        attempt.sourceInputDigest === sourceInputDigest &&
        attempt.outcome !== "UNPROVEN"
    )
  )
    throw new Error("This diagnosed intervention already completed verification; run a changed diagnosis")
  atomicRecord(gateRecoveryPath(location), {
    ...record,
    state: "verification-running",
    verificationRunId: custody.run.runId,
    nextAction: "observe-repair-verification",
    verificationAttempts: [
      ...record.verificationAttempts,
      {
        actionId,
        verificationFingerprint,
        diagnosisActionId: diagnosis.actionId,
        command,
        intervention: intervention ?? null,
        sourceInputDigest,
        sourceContentDigest,
        startedAt: wallClockTimestamp(),
        outcome: "UNPROVEN"
      }
    ]
  })
})

let result
let failure
try {
  result = await runBoundedCommand({
    executable: command[0],
    args: command.slice(1),
    captureOutput: true,
    environment: { ...process.env, DALPH_GATE_RECOVERY_MODE: "verification" },
    name: "focused repair verification",
    relayParentSignals: true,
    timeoutMilliseconds: Number(process.env.DALPH_GATE_DIAGNOSIS_TIMEOUT_MILLISECONDS ?? 10 * 60 * 1000)
  })
} catch (error) {
  failure = error
}
const output = result?.output ?? failure?.output ?? ""
const logDirectory = join(location.custodyRoot, "recovery", "logs")
mkdirSync(logDirectory, { recursive: true })
const logPath = join(logDirectory, `${actionId}.log`)
writeFileSync(logPath, output)
withGateRecoveryLock(location, () => {
  const record = readGateRecovery(location)
  if (record?.state !== "verification-running" || record.verificationAttempts.at(-1)?.actionId !== actionId)
    throw new Error("Repair verification ownership changed before observation")
  const passed = failure === undefined && result?.exitCode === 0
  const finished = {
    ...record.verificationAttempts.at(-1),
    finishedAt: wallClockTimestamp(),
    outcome: passed ? "passed" : (failure?.quintCommandResult ?? "failed"),
    exitCode: result?.exitCode ?? failure?.exitCode ?? null,
    log: { path: logPath, sha256: digest(output), bytes: Buffer.byteLength(output) }
  }
  atomicRecord(gateRecoveryPath(location), {
    ...record,
    state: passed ? "verified" : "repair-required",
    verificationRunId: undefined,
    nextAction: passed ? "run-qualification" : "change-repair-or-verification",
    verificationAttempts: [...record.verificationAttempts.slice(0, -1), finished],
    ...(passed ? { verifiedSourceInputDigest: sourceInputDigest, verifiedAt: wallClockTimestamp() } : {})
  })
})
if (failure !== undefined) {
  console.error(failure.message)
  process.exitCode = 1
} else {
  console.error(`[gate-recovery] focused repair verified for ${failedRunId}; qualification is now admitted`)
}
