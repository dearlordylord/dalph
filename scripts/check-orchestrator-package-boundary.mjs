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
}
