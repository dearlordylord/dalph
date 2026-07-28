import { readFile, readdir } from "node:fs/promises"
import { URL } from "node:url"

const packageRoot = new URL("../packages/orchestrator/", import.meta.url)
const buildOutput = new URL("dist/", packageRoot)
const forbiddenPathFragments = [
  ".test.",
  "ambiguity-boundary",
  "recovery-conformance",
  "recovery-model-controls",
  "recovery-model-journal",
  "task-work-session-reopening"
]
const forbiddenProductionVocabulary =
  /(?:\bP[0-6]\b|AmbiguityBoundaryV1|RecoveryActivationOrdinal|TaskWorkSessionRecoveryConformance)/
const genericCapacityModules = new Set([
  "activation-coordinator",
  "reconstructed-managed-run-state",
  "runnable-frontier",
  "task-admission-controller",
  "task-work-capacity"
])
const reviewLoopStageVocabulary =
  /(?:ImplementationDisposition|ImplementationEvidenceSealing|ImplementationReview|ReviewFindingsHandback|TaskExecution)/

const filesBelow = async (directory) => {
  const entries = await readdir(directory, { withFileTypes: true })
  const nested = await Promise.all(entries.map((entry) => {
    const url = new URL(`${entry.name}${entry.isDirectory() ? "/" : ""}`, directory)
    return entry.isDirectory() ? filesBelow(url) : [url]
  }))
  return nested.flat()
}

const manifest = JSON.parse(await readFile(new URL("package.json", packageRoot), "utf8"))
if (JSON.stringify(manifest.files) !== JSON.stringify(["dist"])) {
  throw new Error("@dalph/orchestrator must package only its dist directory")
}

const emittedFiles = await filesBelow(buildOutput)
const checkedGenericCapacityModules = new Set()
for (const file of emittedFiles) {
  const relativePath = decodeURIComponent(file.href.slice(buildOutput.href.length))
  if (forbiddenPathFragments.some((fragment) => relativePath.includes(fragment))) {
    throw new Error(`test support was emitted in @dalph/orchestrator: ${relativePath}`)
  }
  if (
    (relativePath.endsWith(".js") || relativePath.endsWith(".d.ts"))
    && forbiddenProductionVocabulary.test(await readFile(file, "utf8"))
  ) {
    throw new Error(`test-only recovery vocabulary was emitted in @dalph/orchestrator: ${relativePath}`)
  }
  const moduleName = relativePath
    .replace(/^src\//u, "")
    .replace(/\.(?:d\.ts|js)$/u, "")
  if (
    genericCapacityModules.has(moduleName)
    && reviewLoopStageVocabulary.test(await readFile(file, "utf8"))
  ) {
    throw new Error(
      `review-loop stage vocabulary leaked into generic capacity module: ${relativePath}`
    )
  }
  if (genericCapacityModules.has(moduleName)) {
    checkedGenericCapacityModules.add(moduleName)
  }
}

for (const moduleName of genericCapacityModules) {
  if (!checkedGenericCapacityModules.has(moduleName)) {
    throw new Error(`generic capacity source-firewall target was not emitted: ${moduleName}`)
  }
}
