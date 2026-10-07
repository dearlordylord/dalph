import assert from "node:assert/strict"
import childProcess from "node:child_process"
import http from "node:http"
import https from "node:https"
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { dirname, join, resolve } from "node:path"
import { test } from "node:test"
import { Effect } from "effect"
import { TraceGeneration } from "@firfi/quint-connect/effect"
import { corpusManifestPath, corpusProvenanceDigest, digest } from "./mbt-corpus-contract.mjs"
import { corpusTraceGenerationLayer, loadCorpus } from "./mbt-corpus-loader.mjs"

void test("validated corpus replay refuses missing stale corrupt and malformed inputs without process or network effects", async (t) => {
  const manifest = JSON.parse(await readFile(corpusManifestPath, "utf8"))
  await mkdir(".scratch/mbt-loader-tests", { recursive: true })
  const worktree = await mkdtemp(resolve(".scratch/mbt-loader-tests/fixture-"))
  const lane = manifest.lanes.find(({ id }) => id === "result-recovery-direction/2")
  assert.ok(lane)
  const corpus = join(worktree, lane.corpus)
  const receiptPath = `${corpus}.receipt.json`
  const trace = {
    vars: ["mbt::actionTaken", "mbt::nondetPicks"],
    states: [{ "mbt::actionTaken": "init", "mbt::nondetPicks": {} }]
  }
  const bytes = Buffer.from(JSON.stringify([trace]))
  const receipt = {
    version: 1,
    lane: lane.id,
    provenanceSha256: corpusProvenanceDigest(manifest),
    corpusSha256: digest(bytes)
  }
  try {
    await Promise.all(
      Object.keys(manifest.semanticInputs).map(async (path) => {
        const target = join(worktree, path)
        await mkdir(dirname(target), { recursive: true })
        await copyFile(path, target)
      })
    )
    await mkdir(dirname(corpus), { recursive: true })
    const reset = async () => {
      await writeFile(join(worktree, corpusManifestPath), JSON.stringify(manifest))
      await writeFile(corpus, bytes)
      await writeFile(receiptPath, JSON.stringify(receipt))
    }
    await reset()
    let processes = 0
    let network = 0
    for (const name of ["spawn", "spawnSync", "exec", "execSync", "execFile", "execFileSync", "fork"])
      t.mock.method(childProcess, name, () => {
        processes++
        throw new Error("Replay attempted a process")
      })
    for (const boundary of [http, https])
      for (const name of ["request", "get"])
        t.mock.method(boundary, name, () => {
          network++
          throw new Error("Replay attempted network")
        })
    t.mock.method(globalThis, "fetch", () => {
      network++
      throw new Error("Replay attempted fetch")
    })
    const replay = (options = { spec: lane.spec, ...lane.options }) =>
      Effect.runPromise(
        Effect.gen(function* () {
          const service = yield* TraceGeneration
          return yield* service.generate(options)
        }).pipe(Effect.provide(corpusTraceGenerationLayer(lane.id, worktree)))
      )
    assert.deepEqual(await replay(), [trace])
    assert.deepEqual(await replay(), [trace])
    for (const path of [corpus, receiptPath]) {
      await rm(path)
      await assert.rejects(replay())
      await reset()
    }
    await writeFile(corpus, "{corrupt")
    await assert.rejects(replay())
    await reset()
    for (const mutate of [
      (m) => {
        m.tools.quint = "stale"
      },
      (m) => {
        m.semanticInputs[lane.spec] = "0".repeat(64)
      },
      (m) => {
        m.lanes.find(({ id }) => id === lane.id).options.seed = "999"
      }
    ]) {
      const stale = structuredClone(manifest)
      mutate(stale)
      await writeFile(join(worktree, corpusManifestPath), JSON.stringify(stale))
      await writeFile(receiptPath, JSON.stringify({ ...receipt, provenanceSha256: corpusProvenanceDigest(stale) }))
      await assert.rejects(replay(), (error) => /stale/u.test(String(error.cause)))
      await reset()
    }
    for (const malformed of [{ states: trace.states }, { ...trace, vars: [5] }, { ...trace, states: [null] }]) {
      const invalid = Buffer.from(JSON.stringify([malformed]))
      await writeFile(corpus, invalid)
      await writeFile(receiptPath, JSON.stringify({ ...receipt, corpusSha256: digest(invalid) }))
      await assert.rejects(replay())
      await reset()
    }
    await assert.rejects(replay({ spec: lane.spec, ...lane.options, seed: "123" }))
    await assert.rejects(replay({ spec: lane.spec, ...lane.options, compiledInput: {} }))
    await assert.rejects(loadCorpus("unknown", worktree))
    assert.equal(processes, 0)
    assert.equal(network, 0)
  } finally {
    t.mock.restoreAll()
    await rm(worktree, { recursive: true, force: true })
  }
})
