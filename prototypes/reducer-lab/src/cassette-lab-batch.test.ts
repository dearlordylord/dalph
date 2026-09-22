import assert from "node:assert/strict"
import { maintainedCassetteBatchConcurrency, runBoundedCassetteBatch } from "./cassette-lab.ts"

const keys = Array.from({ length: maintainedCassetteBatchConcurrency * 2 + 1 }, (_, index) => index)
const started: Array<number> = []
const settled: Array<number> = []
const releases = new Map<number, () => void>()
let active = 0
let peakActive = 0

const waitForStarted = async (count: number) => {
  while (started.length < count) await new Promise((resolve) => setTimeout(resolve, 0))
}

const run = (key: number) =>
  new Promise<number>((resolve) => {
    active += 1
    peakActive = Math.max(peakActive, active)
    started.push(key)
    releases.set(key, () => {
      active -= 1
      resolve(key * 10)
    })
  })

const batch = runBoundedCassetteBatch(keys, run, (key) => settled.push(key))
await waitForStarted(maintainedCassetteBatchConcurrency)
assert.equal(peakActive, maintainedCassetteBatchConcurrency, "batch reaches its exact concurrency bound")
assert.deepEqual(started.toSorted((left, right) => left - right), [0, 1, 2, 3], "first window remains bounded")
for (const key of started.slice(0, maintainedCassetteBatchConcurrency).toReversed()) releases.get(key)?.()

await waitForStarted(maintainedCassetteBatchConcurrency * 2)
assert.equal(peakActive, maintainedCassetteBatchConcurrency, "batch never exceeds its concurrency bound")
for (const key of started.slice(maintainedCassetteBatchConcurrency).toReversed()) releases.get(key)?.()

await waitForStarted(keys.length)
releases.get(keys.at(-1) ?? -1)?.()
const results = await batch
assert.equal(active, 0, "batch retains no active work after completion")
assert.deepEqual(results, keys.map((key) => key * 10), "results retain input order despite reverse settlement")
assert.equal(settled.length, keys.length, "every result publishes exactly one progress item")
assert.equal(new Set(settled).size, keys.length, "progress has no duplicate keys")
assert.deepEqual(settled.toSorted((left, right) => left - right), keys, "progress has no omitted keys")

console.log("✓ bounds maintained cassette work while preserving ordered results and exact progress")
