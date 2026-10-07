import { readFile, stat } from "node:fs/promises"
import { fileURLToPath } from "node:url"
import { join } from "node:path"
import { Effect, Layer, Schema } from "effect"
import { ItfTrace, TraceGeneration } from "@firfi/quint-connect/effect"
import {
  corpusManifestPath,
  deriveCorpusManifest,
  validateCorpus,
  validateCorpusManifest
} from "./mbt-corpus-contract.mjs"

const repository = fileURLToPath(new URL("../", import.meta.url))

// Match only generation inputs; driver factories and state checks stay with the caller.
export const corpusOptions = (options) => {
  const result = {
    backend: "typescript",
    generation: { mode: "run" },
    init: "init",
    step: "step",
    maxSamples: 10000,
    maxSteps: 20,
    nTraces: 10
  }
  for (const key of [
    "backend",
    "generation",
    "init",
    "step",
    "main",
    "maxSamples",
    "maxSteps",
    "nTraces",
    "seed",
    "invariants",
    "witnesses"
  ])
    if (options[key] !== undefined) result[key] = options[key]
  if (result.generation.mode === "test") {
    result.maxSteps = null
    result.nTraces = result.maxSamples
  }
  return result
}

export const decodeCorpusTraces = (traces) => traces.map((raw) => Schema.decodeUnknownSync(ItfTrace)(raw))

export const loadCorpus = async (laneId, worktree = repository) => {
  const manifest = JSON.parse(await readFile(join(worktree, corpusManifestPath), "utf8"))
  const expected = await deriveCorpusManifest(worktree)
  validateCorpusManifest(manifest, expected)
  const lane = manifest.lanes.find(({ id }) => id === laneId)
  if (!lane) throw new Error(`Unknown MBT lane: ${laneId}`)
  const path = join(worktree, lane.corpus)
  const size = await stat(path)
  if (size.size > lane.limits.bytes) throw new Error(`MBT corpus exceeds byte budget: ${laneId}`)
  const receiptPath = `${path}.receipt.json`
  if ((await stat(receiptPath)).size > 4096) throw new Error(`MBT receipt exceeds byte budget: ${laneId}`)
  const receipt = JSON.parse(await readFile(receiptPath, "utf8"))
  const bytes = await readFile(path)
  return decodeCorpusTraces(validateCorpus(receipt, bytes, manifest, expected, laneId))
}

export const corpusTraceGenerationLayer = (laneId, worktree = repository) =>
  Layer.succeed(
    TraceGeneration,
    TraceGeneration.of({
      generate: Effect.fn("CorpusTraceGeneration.generate")((options) =>
        Effect.tryPromise(async () => {
          // Refuse alternative generation inputs that have no corpus interpretation.
          if (options.compiledInput !== undefined || options.traceDir !== undefined || options.quintBin !== undefined)
            throw new Error("MBT corpus replay refuses live generator configuration")
          const manifest = JSON.parse(await readFile(join(worktree, corpusManifestPath), "utf8"))
          const lane = manifest.lanes.find(({ id }) => id === laneId)
          if (!lane || options.spec !== lane.spec) throw new Error(`MBT corpus option mismatch: ${laneId}`)
          validateCorpusManifest(corpusOptions(options), lane.options)
          return await loadCorpus(laneId, worktree)
        })
      )
    })
  )
