import { mkdir, mkdtemp, readFile, rename, stat, writeFile } from "node:fs/promises"
import { Clock, Effect } from "effect"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { corpusManifestPath, deriveCorpusManifest, validateCorpusManifest } from "./mbt-corpus-contract.mjs"
import { checkRawCorpusBudget } from "./mbt-corpus-controls.mjs"
import { runBoundedCommand } from "./run-bounded-command.mjs"
import { proveMbtGenerationProcessGroupAbsent } from "./mbt-corpus-process-custody.mjs"

const now = () => Effect.runSync(Clock.currentTimeMillis)
const root = fileURLToPath(new URL("../", import.meta.url))
const manifest = JSON.parse(await readFile(join(root, corpusManifestPath), "utf8"))
validateCorpusManifest(manifest, await deriveCorpusManifest(root))
const requested = process.argv.slice(2)
if (requested.length === 0 || (requested.includes("--all") && requested.length !== 1))
  throw new Error("Usage: pnpm mbt:generate --all | <lane-id> [<lane-id> ...]")
const lanes =
  requested[0] === "--all"
    ? manifest.lanes
    : requested.map((id) => {
        const lane = manifest.lanes.find((lane) => lane.id === id)
        if (!lane) throw new Error(`Unknown MBT lane: ${id}`)
        return lane
      })
if (new Set(lanes.map(({ id }) => id)).size !== lanes.length) throw new Error("Duplicate MBT lane")
const started = now()
const stop = started + manifest.budgets.generationMilliseconds
await mkdir(join(root, ".scratch/mbt-generation"), { recursive: true })
const evidence = await mkdtemp(join(root, ".scratch/mbt-generation/batch-"))
await writeFile(join(evidence, "manifest.json"), JSON.stringify(manifest))
await writeFile(
  join(evidence, "intent.json"),
  JSON.stringify(
    { lanes: lanes.map(({ id }) => id), expectedMilliseconds: 600000, stop: new Date(stop).toISOString() },
    null,
    2
  )
)
console.log(`Generation evidence: ${evidence}; batch stop ${new Date(stop).toISOString()}`)
let totalBytes = 0
for (const lane of lanes) {
  const duration = Math.min(lane.limits.generationMilliseconds, stop - now())
  if (duration <= 10000) throw new Error(`MBT batch budget exhausted before ${lane.id}; evidence ${evidence}`)
  const directory = join(evidence, lane.id)
  await mkdir(directory, { recursive: true })
  const intent = {
    lane: lane.id,
    options: lane.options,
    expectedMilliseconds: 60000,
    stop: new Date(now() + duration).toISOString()
  }
  await writeFile(join(directory, "intent.json"), JSON.stringify(intent, null, 2))
  console.log(JSON.stringify(intent))
  const controller = new AbortController()
  const budgetFailures = []
  const sample = async () => {
    try {
      await checkRawCorpusBudget(join(directory, "raw"), lane, totalBytes, manifest.budgets.bytes)
    } catch (error) {
      budgetFailures.push(String(error))
      controller.abort()
    }
  }
  const observation = { pending: Promise.resolve() }
  const monitor = setInterval(() => {
    observation.pending = observation.pending.then(sample)
  }, 100)
  try {
    const result = await runBoundedCommand({
      name: `MBT generation ${lane.id}`,
      executable: process.execPath,
      args: [
        join(root, "scripts/generate-mbt-corpus-worker.mjs"),
        join(evidence, "manifest.json"),
        lane.id,
        directory,
        String(duration - 10000)
      ],
      cwd: root,
      timeoutMilliseconds: duration,
      relayParentSignals: true,
      signal: controller.signal,
      captureOutput: true,
      forwardOutput: false
    })
    clearInterval(monitor)
    await observation.pending
    await sample()
    await writeFile(join(directory, "command.json"), JSON.stringify(result, null, 2))
    if (budgetFailures.length > 0) throw new Error(budgetFailures.join("\n"))
    proveMbtGenerationProcessGroupAbsent(directory)
    validateCorpusManifest(manifest, await deriveCorpusManifest(root))
    const bytes = (await stat(join(directory, "corpus.json"))).size
    totalBytes += bytes
    if (totalBytes > manifest.budgets.bytes) throw new Error("MBT batch byte budget exceeded")
    const target = join(root, lane.corpus)
    await mkdir(dirname(target), { recursive: true })
    // Receipt is the commit marker: any interrupted pair fails closed at replay.
    const temporary = `${target}.pending-${now()}`
    await writeFile(temporary, await readFile(join(directory, "corpus.json")), { flag: "wx" })
    await rename(temporary, target)
    const receiptTemporary = `${target}.receipt.pending-${now()}`
    await writeFile(receiptTemporary, await readFile(join(directory, "receipt.json")), { flag: "wx" })
    await rename(receiptTemporary, `${target}.receipt.json`)
    await writeFile(join(directory, "outcome.json"), JSON.stringify({ status: "passed", bytes }))
    console.log(`${lane.id}: complete (${bytes} bytes)`)
  } catch (error) {
    await writeFile(
      join(directory, "outcome.json"),
      JSON.stringify({
        status: "failed",
        error: String(error),
        output: error.output,
        cause: String(error.cause ?? ""),
        budgetFailures
      })
    )
    throw new Error(`Unsupported MBT lane ${lane.id}; generation stopped without retry; evidence ${directory}`, {
      cause: error
    })
  } finally {
    clearInterval(monitor)
    await observation.pending
  }
}
await writeFile(
  join(evidence, "outcome.json"),
  JSON.stringify({ status: "passed", lanes: lanes.length, totalBytes, milliseconds: now() - started })
)
