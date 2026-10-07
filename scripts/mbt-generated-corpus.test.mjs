import assert from "node:assert/strict"
import childProcess from "node:child_process"
import http from "node:http"
import https from "node:https"
import { readFile } from "node:fs/promises"
import { test } from "node:test"
import {
  corpusManifestPath,
  deriveCorpusManifest,
  validateCorpus,
  validateCorpusManifest
} from "./mbt-corpus-contract.mjs"
import { decodeCorpusTraces } from "./mbt-corpus-loader.mjs"

void test("every required generated artifact has current provenance and decodes without generation or network", async (t) => {
  let processes = 0
  let network = 0
  for (const name of ["spawn", "spawnSync", "exec", "execSync", "execFile", "execFileSync", "fork"])
    t.mock.method(childProcess, name, () => {
      processes++
      throw new Error("Corpus validation attempted a process")
    })
  for (const boundary of [http, https])
    for (const name of ["request", "get"])
      t.mock.method(boundary, name, () => {
        network++
        throw new Error("Corpus validation attempted network")
      })
  t.mock.method(globalThis, "fetch", () => {
    network++
    throw new Error("Corpus validation attempted fetch")
  })
  const manifest = JSON.parse(await readFile(corpusManifestPath, "utf8"))
  const expected = await deriveCorpusManifest()
  validateCorpusManifest(manifest, expected)
  let bytesTotal = 0
  let tracesTotal = 0
  for (const lane of manifest.lanes) {
    const bytes = await readFile(lane.corpus)
    const receipt = JSON.parse(await readFile(`${lane.corpus}.receipt.json`, "utf8"))
    const traces = decodeCorpusTraces(validateCorpus(receipt, bytes, manifest, expected, lane.id))
    bytesTotal += bytes.length
    tracesTotal += traces.length
    t.diagnostic(`${lane.id}: ${traces.length} traces, ${bytes.length} bytes`)
  }
  assert.equal(manifest.lanes.length, 39)
  assert.ok(bytesTotal <= manifest.budgets.bytes)
  assert.equal(
    tracesTotal,
    manifest.lanes.reduce((sum, lane) => sum + lane.limits.traces, 0)
  )
  assert.equal(processes, 0)
  assert.equal(network, 0)
})
