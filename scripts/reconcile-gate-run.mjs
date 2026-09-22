import { existsSync, readFileSync } from "node:fs"
import { pathToFileURL } from "node:url"
import { join, resolve } from "node:path"
import {
  canonicalUuidPattern,
  wallClockTimestamp,
  atomicRecord,
  custodyVersion,
  digest,
  localHostIdentity,
  readRecord,
  readRecordBytes,
  removeRecord,
  repositoryLocation,
  validateRun,
  validatePreviousBootRun,
  registrationLockPath,
  withFileLock
} from "./gate-custody-records.mjs"
import { closeAndDigestPreviousBootInventoryLocked, closeAndProveCustodyStopped } from "./gate-registration.mjs"
import { reconcileGateRecovery } from "./gate-recovery.mjs"

const reconcileRecovery = ({ run, runDirectory, runId }) =>
  reconcileGateRecovery({
    identity: existsSync(join(runDirectory, "identity.json"))
      ? readRecord(join(runDirectory, "identity.json"))
      : undefined,
    location: repositoryLocation(run.worktree),
    run,
    runId
  })

export const reconcileGateRun = ({ runDirectory, runId }) => {
  const run = validateRun(runDirectory, runId)
  return withFileLock(run.worktreeLock, () =>
    withFileLock(run.slotLock, () => {
      const count = closeAndProveCustodyStopped({ run, runDirectory })
      atomicRecord(join(runDirectory, "reconciled.json"), {
        version: custodyVersion,
        runId,
        custody: "stopped",
        obligationCount: count,
        reconciledAt: wallClockTimestamp(),
        qualification: "UNPROVEN"
      })
      reconcileRecovery({ run, runDirectory, runId })
      for (const path of [run.slotFence, run.worktreeFence]) {
        if (!existsSync(path)) continue
        const fence = readRecord(path)
        if (fence.runId !== runId || fence.runDirectory !== runDirectory)
          throw new Error("Another run owns this fence; refusing clearance")
        removeRecord(path)
      }
      return { runId, custody: "stopped", qualification: "UNPROVEN" }
    })
  )
}

const previousBootProofName = "previous-boot-ended.json"
const sha256Pattern = /^[0-9a-f]{64}$/u
const canonicalTimestampPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u
const stableValue = (value) => {
  if (Array.isArray(value)) return value.map(stableValue)
  if (value !== null && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, stableValue(item)])
    )
  return value
}
const stableJson = (value) => JSON.stringify(stableValue(value))
const validHostIdentity = (host) =>
  host !== null &&
  typeof host === "object" &&
  !Array.isArray(host) &&
  JSON.stringify(Object.keys(host).sort((left, right) => left.localeCompare(right))) ===
    JSON.stringify(["bootId", "hostname"]) &&
  typeof host.hostname === "string" &&
  canonicalUuidPattern.test(host.bootId ?? "")
const hostIsCurrentGeneration = (host, run) =>
  validHostIdentity(host) && host.hostname === run.host.hostname && host.bootId !== run.host.bootId
const exactRecord = (value, keys, label) => {
  const actual = Object.keys(value).sort((left, right) => left.localeCompare(right))
  const expected = [...keys].sort((left, right) => left.localeCompare(right))
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`Invalid ${label}`)
}
const readRunSnapshot = (runDirectory, run) => {
  const bytes = readFileSync(join(runDirectory, "run.json"))
  const reread = readRecordBytes(bytes, join(runDirectory, "run.json"))
  if (stableJson(reread) !== stableJson(run)) throw new Error("Gate run changed during previous-boot reconciliation")
  return { sha256: digest(bytes) }
}
const expectedFence = ({ run, runDirectory }) => ({
  version: custodyVersion,
  runId: run.runId,
  runDirectory,
  worktree: run.worktree,
  slot: run.slot
})
const readFenceSnapshot = ({ path, required, run, runDirectory }) => {
  if (!existsSync(path)) {
    if (required) throw new Error(`Missing previous-boot custody fence: ${path}`)
    return undefined
  }
  const bytes = readFileSync(path)
  const fence = readRecordBytes(bytes, path)
  if (stableJson(fence) !== stableJson(expectedFence({ runDirectory, run })))
    throw new Error(`Previous-boot custody fence ownership does not match: ${path}`)
  return { bytes, fence, sha256: digest(bytes), path }
}
const assertFenceUnchanged = (expected, context) => {
  const current = readFenceSnapshot({ ...context, required: true })
  if (current.sha256 !== expected.sha256) throw new Error(`Previous-boot custody fence changed: ${expected.path}`)
  return current
}
const clearFence = (expected, context) => {
  if (!existsSync(expected.path)) return false
  assertFenceUnchanged(expected, context)
  removeRecord(expected.path)
  return true
}
/** Pure durable-proof validation; it never reads, probes, clears, or publishes custody. */
export const validatePreviousBootProof = ({ currentHost, inventory, proof, run, runDirectory, runSnapshot }) => {
  exactRecord(
    proof,
    [
      "basis",
      "commonDirectory",
      "custody",
      "custodyRoot",
      "currentHost",
      "recordedAt",
      "fences",
      "inventoryDigest",
      "obligationCount",
      "previousBootId",
      "previousHost",
      "qualification",
      "registrationState",
      "reportDirectory",
      "runDigest",
      "runDirectory",
      "runId",
      "slot",
      "slotFence",
      "slotLock",
      "version",
      "worktree",
      "worktreeFence",
      "worktreeLock"
    ],
    "previous-boot proof"
  )
  exactRecord(proof.fences?.slot ?? {}, ["path", "sha256"], "previous-boot slot proof")
  exactRecord(proof.fences?.worktree ?? {}, ["path", "sha256"], "previous-boot worktree proof")
  if (
    proof.version !== custodyVersion ||
    proof.runId !== run.runId ||
    proof.runDirectory !== runDirectory ||
    proof.basis !== "previous-boot" ||
    proof.custody !== "stopped" ||
    proof.qualification !== "UNPROVEN" ||
    proof.registrationState !== "closed" ||
    proof.previousBootId !== run.host.bootId ||
    stableJson(proof.previousHost) !== stableJson(run.host) ||
    !hostIsCurrentGeneration(proof.currentHost, run) ||
    !hostIsCurrentGeneration(currentHost, run) ||
    proof.worktree !== run.worktree ||
    proof.commonDirectory !== run.commonDirectory ||
    proof.custodyRoot !== run.custodyRoot ||
    proof.reportDirectory !== run.reportDirectory ||
    proof.slot !== run.slot ||
    proof.slotLock !== run.slotLock ||
    proof.slotFence !== run.slotFence ||
    proof.worktreeLock !== run.worktreeLock ||
    proof.worktreeFence !== run.worktreeFence ||
    proof.obligationCount !== inventory.count ||
    proof.inventoryDigest !== inventory.digest ||
    proof.runDigest !== runSnapshot.sha256 ||
    !canonicalTimestampPattern.test(proof.recordedAt ?? "") ||
    proof.fences.slot.path !== run.slotFence ||
    proof.fences.worktree.path !== run.worktreeFence ||
    !sha256Pattern.test(proof.fences.slot.sha256) ||
    !sha256Pattern.test(proof.fences.worktree.sha256)
  )
    throw new Error("Previous-boot proof does not match the recorded run")
}
const injectFailure = (failurePhase, phase) => {
  if (failurePhase === phase) throw new Error(`Injected previous-boot reconciliation failure at ${phase}`)
}

/**
 * Reconcile a run left by an earlier host boot. This path never inspects or
 * signals a recorded process group: the prior boot is accepted only when every
 * obligation is already a structurally valid no-child or observed record.
 */
export const reconcilePreviousBootGateRun = ({ failurePhase, previousBootId, runDirectory, runId }) => {
  const run = validatePreviousBootRun({ runDirectory, expectedRunId: runId, previousBootId })
  const currentHost = localHostIdentity()
  return withFileLock(run.worktreeLock, () =>
    withFileLock(run.slotLock, () =>
      withFileLock(registrationLockPath(runDirectory), () => {
        const runSnapshot = readRunSnapshot(runDirectory, run)
        const proofPath = join(runDirectory, previousBootProofName)
        const proofExists = existsSync(proofPath)
        if (proofExists) {
          const inventory = closeAndDigestPreviousBootInventoryLocked({ runDirectory, runId, closeOpen: false })
          if (inventory.wasOpen) throw new Error("Previous-boot proof requires closed registration")
          const proof = readRecord(proofPath)
          validatePreviousBootProof({ proof, run, runDirectory, runSnapshot, inventory, currentHost })
          const slotFence = readFenceSnapshot({ path: run.slotFence, runDirectory, run, required: false })
          const worktreeFence = readFenceSnapshot({ path: run.worktreeFence, runDirectory, run, required: false })
          if (
            (slotFence !== undefined && slotFence.sha256 !== proof.fences.slot.sha256) ||
            (worktreeFence !== undefined && worktreeFence.sha256 !== proof.fences.worktree.sha256)
          )
            throw new Error("Previous-boot proof fence digest does not match current custody")
          injectFailure(failurePhase, "proof-validated")
          reconcileRecovery({ run, runDirectory, runId })
          if (slotFence !== undefined) clearFence(slotFence, { runDirectory, run, path: run.slotFence })
          injectFailure(failurePhase, "slot-cleared")
          if (worktreeFence !== undefined) clearFence(worktreeFence, { runDirectory, run, path: run.worktreeFence })
          injectFailure(failurePhase, "worktree-cleared")
          return {
            runId,
            custody: "stopped",
            qualification: "UNPROVEN",
            basis: "previous-boot",
            obligationCount: inventory.count
          }
        }
        const initialSlotFence = readFenceSnapshot({ path: run.slotFence, runDirectory, run, required: true })
        const initialWorktreeFence = readFenceSnapshot({ path: run.worktreeFence, runDirectory, run, required: true })
        injectFailure(failurePhase, "fences-validated")
        const closedInventory = closeAndDigestPreviousBootInventoryLocked({ runDirectory, runId, closeOpen: true })
        injectFailure(failurePhase, "inventory-closed")
        assertFenceUnchanged(initialSlotFence, { runDirectory, run, path: run.slotFence })
        assertFenceUnchanged(initialWorktreeFence, { runDirectory, run, path: run.worktreeFence })
        injectFailure(failurePhase, "fences-stable")
        const proof = {
          version: custodyVersion,
          runId,
          basis: "previous-boot",
          custody: "stopped",
          qualification: "UNPROVEN",
          previousBootId: run.host.bootId,
          previousHost: run.host,
          currentHost,
          runDirectory,
          worktree: run.worktree,
          commonDirectory: run.commonDirectory,
          custodyRoot: run.custodyRoot,
          reportDirectory: run.reportDirectory,
          slot: run.slot,
          slotLock: run.slotLock,
          slotFence: run.slotFence,
          worktreeLock: run.worktreeLock,
          worktreeFence: run.worktreeFence,
          registrationState: "closed",
          obligationCount: closedInventory.count,
          inventoryDigest: closedInventory.digest,
          runDigest: runSnapshot.sha256,
          fences: {
            slot: { path: run.slotFence, sha256: initialSlotFence.sha256 },
            worktree: { path: run.worktreeFence, sha256: initialWorktreeFence.sha256 }
          },
          recordedAt: wallClockTimestamp()
        }
        atomicRecord(proofPath, proof)
        injectFailure(failurePhase, "proof-published")
        reconcileRecovery({ run, runDirectory, runId })
        clearFence(initialSlotFence, { runDirectory, run, path: run.slotFence })
        injectFailure(failurePhase, "slot-cleared")
        clearFence(initialWorktreeFence, { runDirectory, run, path: run.worktreeFence })
        injectFailure(failurePhase, "worktree-cleared")
        return {
          runId,
          custody: "stopped",
          qualification: "UNPROVEN",
          basis: "previous-boot",
          obligationCount: closedInventory.count
        }
      })
    )
  )
}

export const parseReconcileArguments = (arguments_) => {
  if (!Array.isArray(arguments_) || arguments_.length < 1 || arguments_.length > 2)
    throw new Error("Usage: pnpm gate:reconcile <run-id> [--previous-boot=<boot-id>]")
  const [runId, option] = arguments_
  if (typeof runId !== "string" || !canonicalUuidPattern.test(runId)) throw new Error("Invalid gate run ID")
  if (arguments_.length === 1) return { runId, previousBootId: undefined }
  if (typeof option !== "string") throw new Error("Usage: pnpm gate:reconcile <run-id> [--previous-boot=<boot-id>]")
  const prefix = "--previous-boot="
  if (!option.startsWith(prefix)) throw new Error("Usage: pnpm gate:reconcile <run-id> [--previous-boot=<boot-id>]")
  const previousBootId = option.slice(prefix.length)
  if (!canonicalUuidPattern.test(previousBootId)) throw new Error("Invalid previous-boot ID")
  return { runId, previousBootId }
}
if (pathToFileURL(resolve(process.argv[1] ?? "")).href === import.meta.url) {
  const { previousBootId, runId } = parseReconcileArguments(process.argv.slice(2))
  const location = repositoryLocation()
  const runDirectory = join(location.custodyRoot, "runs", runId)
  console.log(
    JSON.stringify(
      previousBootId === undefined
        ? reconcileGateRun({ runDirectory, runId })
        : reconcilePreviousBootGateRun({ runDirectory, runId, previousBootId })
    )
  )
}
