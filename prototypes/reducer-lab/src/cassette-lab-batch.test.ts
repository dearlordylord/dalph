import assert from "node:assert/strict"
import { Duration, Effect } from "effect"
import { maintainedAuthoredCassetteCatalog } from "../../../packages/dalph/src/cassettes/catalog.ts"
import {
  AuthoredObservationCaptureOrder,
  AuthoredStoryPosition
} from "../../../packages/dalph/src/cassettes/authored-runner.ts"
import { AuthoredRunActivationOrdinal } from "../../../packages/dalph/src/cassettes/authored-domain.ts"
import {
  type CassetteExecution,
  maintainedCassetteBatchConcurrency,
  runBoundedCassetteBatch,
  runMaintainedCassetteExecution,
  selectCassetteWatchdogCursor
} from "./cassette-lab.ts"

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

assert.deepEqual(
  selectCassetteWatchdogCursor(
    { activation: 1, captureOrder: 6, itemTag: "OlderProjectedItem", storyPosition: 3 },
    { activation: 2, captureOrder: 7, itemTag: "LatestCapturedItem", storyPosition: 4 }
  ),
  { activation: 2, captureOrder: 7, itemTag: "LatestCapturedItem", storyPosition: 4 },
  "a newer raw capture owns timeout cursor diagnostics while projection trails"
)

let interrupted = false
const stalledKey = "authored:singletonTaskCompletes" as const
const firstStoryItem = maintainedAuthoredCassetteCatalog.singletonTaskCompletes.story[0]
if (firstStoryItem === undefined) throw new Error("controlled stalled cassette requires one story item")
const stalled = await runMaintainedCassetteExecution(
  stalledKey,
  (observer) =>
    Effect.sync(() => observer.onObservationCapture?.({
      _tag: "AuthoredStoryOccurrenceCaptured",
      activationOrdinal: AuthoredRunActivationOrdinal.make(2),
      captureOrder: AuthoredObservationCaptureOrder.make(7),
      occurrence: firstStoryItem,
      storyPosition: AuthoredStoryPosition.make(1)
    })).pipe(
      Effect.andThen(Effect.callback<CassetteExecution>(() => Effect.sync(() => { interrupted = true })))
    ),
  Duration.millis(20)
)
assert.equal(interrupted, true, "watchdog interrupts the non-settling Effect before returning")
assert.equal(stalled._tag, "Failed")
if (stalled._tag !== "Failed") throw new Error("watchdog must fail the stalled cassette")
assert.equal(stalled.catalogKey, stalledKey)
assert.equal(stalled.watchdog?.latestActivation, 2)
assert.equal(stalled.watchdog?.latestStoryPosition, 1)
assert.equal(stalled.watchdog?.latestStoryItemTag, firstStoryItem._tag)
assert.match(stalled.watchdog?.lastObservationCheckpoint ?? "", /AuthoredStoryOccurrenceCaptured#7/u)
assert.match(stalled.detail, /authored:singletonTaskCompletes/u)
assert.match(stalled.detail, /after \d+ms/u)
console.log("✓ interrupts a stalled cassette and reports its exact key and latest checkpoint")
