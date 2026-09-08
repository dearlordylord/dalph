import { spawnSync } from "node:child_process"
import { changedRepositoryFiles } from "./changed-files.mjs"
import { modelGovernedChanges } from "./quint-model-scope.mjs"

const pnpmEntryPoint = process.env["npm_execpath"]
const baseReference = process.env["DALPH_DIAGNOSTICS_BASE"] ?? "origin/master"

if (pnpmEntryPoint === undefined) {
  throw new Error("Run the changed-model gate through pnpm so its executable can be resolved safely")
}

const governedChanges = modelGovernedChanges({ changedFiles: changedRepositoryFiles({ baseReference }) })

if (governedChanges.length === 0) {
  console.log(`No model-governed files changed against ${baseReference}; run pnpm check:quint before integration.`)
  process.exit(0)
}

console.log(`Model-governed changes against ${baseReference}:`)
for (const file of governedChanges) console.log(`  ${file}`)

const result = spawnSync(process.execPath, [pnpmEntryPoint, "check:quint"], { stdio: "inherit" })

if (result.error !== undefined) throw result.error
process.exit(result.status ?? 1)
