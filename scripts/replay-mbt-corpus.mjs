import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { Clock, Effect } from "effect"
import { corpusManifestPath, deriveCorpusManifest, validateCorpusManifest } from "./mbt-corpus-contract.mjs"
import { loadCorpus } from "./mbt-corpus-loader.mjs"
import { runCorpusConsumer } from "./mbt-corpus-controls.mjs"

const root = fileURLToPath(new URL("../", import.meta.url))
const manifest = JSON.parse(await readFile(join(root, corpusManifestPath), "utf8"))
validateCorpusManifest(manifest, await deriveCorpusManifest(root))
await mkdir(join(root, ".scratch/mbt-replay"), { recursive: true })
const evidence = await mkdtemp(join(root, ".scratch/mbt-replay/batch-"))
const now = () => Effect.runSync(Clock.currentTimeMillis)
const stop = now() + manifest.budgets.replayMilliseconds
await writeFile(
  join(evidence, "intent.json"),
  JSON.stringify(
    { expectedMilliseconds: 600000, stop: new Date(stop).toISOString(), lanes: manifest.lanes.map(({ id }) => id) },
    null,
    2
  )
)
// Validate the entire required inventory before launching any driver.
for (const lane of manifest.lanes) {
  if (now() >= stop) throw new Error("MBT replay budget exhausted during validation")
  await loadCorpus(lane.id, root)
}
const sentinel = join(evidence, "generator-refused")
const executable = join(evidence, "quint-refused")
await writeFile(executable, `#!/bin/sh\nprintf 'generator attempted\\n' >> '${sentinel}'\nexit 99\n`, {
  mode: 0o700,
  flag: "wx"
})
for (const project of ["mbt", "accepted-result-integration-mbt"]) {
  const remaining = stop - now()
  if (remaining <= 0) throw new Error("MBT replay budget exhausted before child launch")
  await runCorpusConsumer({
    cleanup: async () => {},
    retain: async () => {
      await writeFile(join(evidence, "cleanup-retained.json"), JSON.stringify({ disposition: "WritersUnproven" }))
    },
    command: {
      name: `validated MBT corpus replay: ${project}`,
      executable: "pnpm",
      args: ["exec", "vitest", "run", "--mode", "mbt", `--project=${project}`],
      cwd: root,
      timeoutMilliseconds: Math.min(600000, remaining),
      relayParentSignals: true,
      environment: { ...process.env, QUINT_BIN: executable }
    }
  })
}
try {
  await readFile(sentinel)
  throw new Error("MBT replay attempted generation")
} catch (error) {
  if (error.code !== "ENOENT") throw error
}
console.log("Required corpus replay passed; generator executable invocations: 0")
