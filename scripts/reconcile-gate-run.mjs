import { existsSync } from "node:fs"
import { pathToFileURL } from "node:url"
import { join, resolve } from "node:path"
import {
  wallClockTimestamp,
  atomicRecord,
  custodyVersion,
  readRecord,
  removeRecord,
  repositoryLocation,
  validateRun,
  withFileLock
} from "./gate-custody-records.mjs"
import { closeAndProveCustodyStopped } from "./gate-registration.mjs"

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
if (process.argv[1] !== undefined && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const runId = process.argv[2]
  if (runId === undefined) throw new Error("Usage: pnpm gate:reconcile <run-id>")
  const location = repositoryLocation()
  console.log(JSON.stringify(reconcileGateRun({ runDirectory: join(location.custodyRoot, "runs", runId), runId })))
}
