import { mkdir, mkdtemp, readFile, unlink, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import ts from "typescript"
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
const created = []
let cleanupDisposition = "SafeToClean"
try {
  for (const source of manifest.selection.files) {
    const original = await readFile(join(root, source), "utf8")
    const syntax = ts.createSourceFile(source, original, ts.ScriptTarget.Latest, true)
    const edits = []
    const routed = new Set()
    for (const node of syntax.statements) {
      if (!ts.isImportDeclaration(node) || !node.moduleSpecifier.text.startsWith("@firfi/quint-connect")) continue
      const bindings = node.importClause?.namedBindings
      if (!bindings || !ts.isNamedImports(bindings)) continue
      for (const binding of bindings.elements) {
        if (["quintRun", "quintIt", "generateTraces"].includes(binding.name.text)) {
          if (binding.propertyName) throw new Error("Aliased generation import requires explicit review")
          routed.add(binding.name.text)
          edits.push({
            start: binding.getStart(syntax),
            end: binding.end,
            text: `${binding.name.text} as unusedLive${binding.name.text}`
          })
        }
      }
    }
    let copy = original
    for (const edit of edits.sort((a, b) => b.start - a.start))
      copy = copy.slice(0, edit.start) + edit.text + copy.slice(edit.end)
    if (routed.size > 0)
      copy = `import { corpusReplayFor } from "../../../../scripts/mbt-corpus-replay.mjs"\nconst { ${[...routed].join(", ")} } = corpusReplayFor(${JSON.stringify(source)})\n${copy}`
    const target = join(root, source.replace(".mbt.test.ts", ".corpus.test.ts"))
    await writeFile(target, copy, { flag: "wx" })
    created.push(target)
  }
  const accepted = created.filter((path) => path.endsWith("accepted-result-integration.corpus.test.ts"))
  const ordinary = created.filter((path) => !accepted.includes(path))
  for (const { files, workers } of [
    { files: ordinary, workers: 4 },
    { files: accepted, workers: 1 }
  ]) {
    const remaining = stop - now()
    if (remaining <= 0) throw new Error("MBT replay budget exhausted before child launch")
    cleanupDisposition = "WritersUnproven"
    await runCorpusConsumer({
      cleanup: async () => {
        cleanupDisposition = "SafeToClean"
      },
      retain: async () => {
        await writeFile(
          join(evidence, "cleanup-retained.json"),
          JSON.stringify({ disposition: "WritersUnproven", paths: created })
        )
      },
      command: {
        name: "validated MBT corpus replay",
        executable: "pnpm",
        args: ["exec", "vitest", "run", ...files, `--maxWorkers=${workers}`],
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
} finally {
  if (cleanupDisposition === "SafeToClean") for (const path of created) await unlink(path)
}
