import { join } from "node:path"
import { repositoryLocation } from "./gate-custody-records.mjs"
import { readRunEvidence } from "./gate-run-evidence.mjs"

const runId = process.argv[2]
if (runId === undefined) throw new Error("Usage: pnpm gate:status <run-id>")
const location = repositoryLocation()
const evidence = readRunEvidence({ runDirectory: join(location.custodyRoot, "runs", runId), runId })
console.log(JSON.stringify(evidence, null, 2))
