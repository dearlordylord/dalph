import { readFile } from "node:fs/promises"
import { Effect } from "effect"
import { quintRunWithTraceGeneration, TraceGeneration } from "@firfi/quint-connect/effect"
import { corpusManifestPath, validateCorpusManifest } from "./mbt-corpus-contract.mjs"
import { corpusOptions, corpusTraceGenerationLayer } from "./mbt-corpus-loader.mjs"

// Each maintained suite supplies its exact source identity for lane selection.
export const corpusReplayFor = (source) => {
  const selectLayer = (options) =>
    Effect.tryPromise(async () => {
      const manifest = JSON.parse(await readFile(new URL(`../${corpusManifestPath}`, import.meta.url), "utf8"))
      const candidates = manifest.lanes.filter((lane) => lane.source === source && lane.spec === options.spec)
      const lane = candidates.find((lane) => {
        try {
          validateCorpusManifest(corpusOptions(options), lane.options)
          return true
        } catch {
          return false
        }
      })
      if (!lane) throw new Error(`No MBT corpus matches generation options in ${source}`)
      return corpusTraceGenerationLayer(lane.id)
    })
  const quintRun = Effect.fn("CorpusReplay.run")(function* (options) {
    const layer = yield* selectLayer(options)
    return yield* quintRunWithTraceGeneration(options).pipe(Effect.provide(layer))
  })
  const generateTraces = Effect.fn("CorpusReplay.load")(function* (options) {
    const layer = yield* selectLayer(options)
    return yield* Effect.gen(function* () {
      const service = yield* TraceGeneration
      return yield* service.generate(options)
    }).pipe(Effect.provide(layer))
  })
  const quintIt = (itEffect, name, options, timeout) =>
    itEffect(name, () => quintRun(options), { timeout: timeout ?? 30000 })
  return { quintRun, quintIt, generateTraces }
}
