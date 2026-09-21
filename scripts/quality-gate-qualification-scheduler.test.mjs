import assert from "node:assert/strict"
import { test } from "node:test"
import {
  isOrdinaryQualificationFailure,
  localQualificationConcurrency,
  qualificationAggregateError,
  runQualificationStages
} from "./quality-gate-qualification-scheduler.mjs"

const stages = (names) => names.map((id) => ({ id }))
const failure = (result, message = result) => Object.assign(new Error(message), { quintCommandResult: result })

void test("LQ01 all passing obligations respect the fixed cap and retain one canonical candidate inventory", async () => {
  const active = { value: 0 }
  let peak = 0
  const started = []
  const result = await runQualificationStages({
    concurrency: 99,
    stages: stages(["delivery", "catalog", "coverage"]),
    run: async (stage) => {
      active.value += 1
      peak = Math.max(peak, active.value)
      started.push(stage.id)
      active.value -= 1
      return { candidate: "c" }
    }
  })

  assert.equal(localQualificationConcurrency, 1)
  assert.equal(peak, 1)
  assert.deepEqual(started, ["delivery", "catalog", "coverage"])
  assert.equal(result.succeeded, true)
  assert.deepEqual(
    result.outcomes.map(({ stageId, status }) => [stageId, status]),
    [
      ["delivery", "passed"],
      ["catalog", "passed"],
      ["coverage", "passed"]
    ]
  )
})

void test("LQ02 two ordinary failures and one pass produce one canonical fail-slow inventory", async () => {
  const result = await runQualificationStages({
    stages: stages(["delivery", "catalog", "coverage"]),
    run: async (stage) => {
      if (stage.id === "delivery") throw failure("exit:23", "delivery failed")
      if (stage.id === "coverage") throw failure("timed-out", "coverage timed out")
      return { candidate: "c" }
    }
  })

  assert.equal(result.succeeded, false)
  assert.equal(result.safetyError, undefined)
  assert.deepEqual(
    result.outcomes.map(({ stageId, status }) => [stageId, status]),
    [
      ["delivery", "failed"],
      ["catalog", "passed"],
      ["coverage", "failed"]
    ]
  )
  const aggregate = qualificationAggregateError({
    outcomes: result.outcomes,
    stages: stages(["delivery", "catalog", "coverage"])
  })
  assert.match(aggregate.message, /delivery=failed[\s\S]*catalog=passed[\s\S]*coverage=failed/u)
})

void test("LQ03 a proved timeout settles before its permit is released and preserves the timeout failure", async () => {
  let cleanupComplete = false
  let secondStarted = false
  const result = await runQualificationStages({
    stages: stages(["timeout", "sibling"]),
    run: async (stage) => {
      if (stage.id === "timeout") {
        await Promise.resolve()
        cleanupComplete = true
        throw failure("timed-out", "timeout after cleanup")
      }
      secondStarted = true
      assert.equal(cleanupComplete, true)
      return undefined
    }
  })

  assert.equal(secondStarted, true)
  assert.equal(result.outcomes[0].status, "failed")
  assert.equal(result.outcomes[0].error.quintCommandResult, "timed-out")
  assert.equal(result.outcomes[1].status, "passed")
})

void test("LQ04 a safety failure stops queued launches and records unproven work separately", async () => {
  const started = []
  const result = await runQualificationStages({
    stages: stages(["unsafe", "queued", "later"]),
    run: async (stage, signal) => {
      started.push(stage.id)
      if (stage.id === "unsafe") throw failure("failed", "custody became ambiguous")
      await new Promise((resolve) => signal.addEventListener("abort", resolve, { once: true }))
      throw failure("cancelled", "cancelled by safety stop")
    }
  })

  assert.deepEqual(started, ["unsafe"])
  assert.match(result.safetyError.message, /custody became ambiguous/u)
  assert.deepEqual(
    result.outcomes.map(({ stageId, status }) => [stageId, status]),
    [
      ["unsafe", "unproven"],
      ["queued", "not-run"],
      ["later", "not-run"]
    ]
  )
})

void test("LQ05 interruption drains launched siblings and leaves queued obligations not run", async () => {
  const interruption = new AbortController()
  const started = []
  const resultPromise = runQualificationStages({
    signal: interruption.signal,
    stages: stages(["first", "queued", "later"]),
    run: async (stage, signal) => {
      started.push(stage.id)
      await new Promise((resolve) => signal.addEventListener("abort", resolve, { once: true }))
      throw failure("cancelled", `${stage.id} drained`)
    }
  })
  await Promise.resolve()
  interruption.abort(new Error("operator interrupted"))
  const result = await resultPromise

  assert.deepEqual(started, ["first"])
  assert.match(result.safetyError.message, /operator interrupted/u)
  assert.deepEqual(
    result.outcomes.map(({ stageId, status }) => [stageId, status]),
    [
      ["first", "unproven"],
      ["queued", "not-run"],
      ["later", "not-run"]
    ]
  )
})

void test("only bounded exits and proved timeout/launch failure are ordinary scheduler failures", () => {
  assert.equal(isOrdinaryQualificationFailure(failure("exit:1")), true)
  assert.equal(isOrdinaryQualificationFailure(failure("timed-out")), true)
  assert.equal(isOrdinaryQualificationFailure(failure("launch-failed")), true)
  assert.equal(isOrdinaryQualificationFailure(failure("failed")), false)
  assert.equal(isOrdinaryQualificationFailure(failure("interrupted")), false)
})
