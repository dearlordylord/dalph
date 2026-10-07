import { readFile, writeFile } from "node:fs/promises"
import { resolve } from "node:path"
import { Effect } from "effect"
import { TraceGeneration, traceGenerationLayer } from "@firfi/quint-connect/effect"
import {
  corpusProvenanceDigest,
  deriveCorpusManifest,
  digest,
  validateCorpus,
  validateCorpusManifest
} from "./mbt-corpus-contract.mjs"
import { decodeCorpusTraces } from "./mbt-corpus-loader.mjs"

const [manifestPath, laneId, directory, milliseconds] = process.argv.slice(2)
const manifest = JSON.parse(await readFile(manifestPath, "utf8"))
validateCorpusManifest(manifest, await deriveCorpusManifest())
const lane = manifest.lanes.find(({ id }) => id === laneId)
if (!lane) throw new Error(`Unknown MBT lane: ${laneId}`)
const options = {
  ...lane.options,
  spec: lane.spec,
  quintBin: resolve("node_modules/.bin/quint"),
  traceDir: resolve(directory, "raw")
}
if (options.maxSteps === null) Reflect.deleteProperty(options, "maxSteps")
const traces = await Effect.runPromise(
  Effect.gen(function* () {
    const generator = yield* TraceGeneration
    return yield* generator.generate(options)
  }).pipe(Effect.provide(traceGenerationLayer), Effect.timeout(Number(milliseconds)))
)
const bytes = Buffer.from(JSON.stringify(traces))
const receipt = {
  version: 1,
  lane: laneId,
  provenanceSha256: corpusProvenanceDigest(manifest),
  corpusSha256: digest(bytes)
}
validateCorpusManifest(manifest, await deriveCorpusManifest())
decodeCorpusTraces(validateCorpus(receipt, bytes, manifest, manifest, laneId))
await writeFile(resolve(directory, "corpus.json"), bytes, { flag: "wx" })
await writeFile(resolve(directory, "receipt.json"), `${JSON.stringify(receipt, null, 2)}\n`, { flag: "wx" })
