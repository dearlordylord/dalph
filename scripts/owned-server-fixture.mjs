import { existsSync, readdirSync, rmSync } from "node:fs"
import { join } from "node:path"
import { readRecord, repositoryLocation } from "./gate-custody-records.mjs"
import { closeAndProveCustodyStopped } from "./gate-registration.mjs"
import { reconcileGateRun } from "./reconcile-gate-run.mjs"

/** Fixture disposal must never erase the only registration of an escaped writer. */
export const disposeOwnedServerFixture = (root, boundaries = {}) => {
  const { custodyRoot } = repositoryLocation(root)
  const runsRoot = join(custodyRoot, "runs")
  const runDirectories = existsSync(runsRoot) ? readdirSync(runsRoot).map((id) => join(runsRoot, id)) : []
  return disposeProvenFixture({
    root,
    runDirectories,
    prove:
      boundaries.prove ??
      ((runDirectory) => {
        const run = readRecord(join(runDirectory, "run.json"))
        if (existsSync(join(runDirectory, "terminal.json"))) {
          closeAndProveCustodyStopped({ run, runDirectory })
        } else {
          reconcileGateRun({ runDirectory, runId: run.runId })
        }
      }),
    remove: boundaries.remove ?? ((path) => rmSync(path, { recursive: true, force: true }))
  })
}

/** Prove the complete inventory before removing any fixture evidence. */
export const disposeProvenFixture = ({ prove, remove, root, runDirectories }) => {
  try {
    for (const runDirectory of runDirectories) prove(runDirectory)
  } catch (cause) {
    throw new Error(`Owned-server fixture retained at ${root}: stopped writers are unproven`, { cause })
  }
  remove(root)
}
