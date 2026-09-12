import { spawnSync } from "node:child_process"
import { selectFinalQuintGate } from "./final-quint-selection.mjs"

const argumentsList = process.argv.slice(2)
const candidate =
  argumentsList.length === 1 && argumentsList[0].startsWith("--candidate=")
    ? argumentsList[0].slice("--candidate=".length)
    : undefined
const selection = selectFinalQuintGate(candidate)
console.log(
  `Formal comparison base: ${selection.baseSha || "unavailable"}; HEAD: ${selection.headSha ?? "unavailable"}`
)
for (const file of selection.changedFiles) console.log(`  ${JSON.stringify(file)}`)
console.log(selection.reason)
if (!selection.full) process.exit(0)
const pnpmEntryPoint = process.env["npm_execpath"]
if (pnpmEntryPoint === undefined) throw new Error("Run the final formal selection through pnpm")
const result = spawnSync(process.execPath, [pnpmEntryPoint, "check:quint"], { stdio: "inherit" })
if (result.error !== undefined) throw result.error
process.exit(result.status ?? 1)
