import assert from "node:assert/strict"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { test } from "node:test"
import { checkRawCorpusBudget, runCorpusConsumer } from "./mbt-corpus-controls.mjs"

for (const outcome of ["success", "stopped-failure", "unproven-failure"]) {
  void test(`consumer cleanup preserves exact inputs on ${outcome}`, async () => {
    await mkdir(".scratch/mbt-custody-controls", { recursive: true })
    const directory = await mkdtemp(".scratch/mbt-custody-controls/case-")
    const path = join(directory, "input")
    await writeFile(path, "exact retained input")
    const failure = Object.assign(new Error("controlled child failure"), {
      stoppedWritersProven: outcome === "stopped-failure"
    })
    let retained = 0
    let cleaned = 0
    try {
      const operation = runCorpusConsumer({
        command: {},
        run: async () => {
          if (outcome !== "success") throw failure
          return "passed"
        },
        cleanup: async () => {
          cleaned++
          await rm(path)
        },
        retain: async () => {
          retained++
          assert.equal(await readFile(path, "utf8"), "exact retained input")
        }
      })
      if (outcome === "success") assert.equal(await operation, "passed")
      else await assert.rejects(operation, (error) => error === failure)
      assert.equal(retained, outcome === "unproven-failure" ? 1 : 0)
      assert.equal(cleaned, outcome === "unproven-failure" ? 0 : 1)
      if (outcome === "unproven-failure") assert.equal(await readFile(path, "utf8"), "exact retained input")
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })
}

void test("the final raw measurement refuses a last burst and remaining batch overflow", async () => {
  await mkdir(".scratch/mbt-custody-controls", { recursive: true })
  const directory = await mkdtemp(".scratch/mbt-custody-controls/raw-")
  const lane = { id: "controlled", limits: { bytes: 5 } }
  try {
    await writeFile(join(directory, "first"), "123")
    assert.equal(await checkRawCorpusBudget(directory, lane, 0, 10), 3)
    // Complete the writer's final burst after the earlier successful observation.
    await writeFile(join(directory, "last"), "456")
    await assert.rejects(checkRawCorpusBudget(directory, lane, 0, 10), /byte budget/u)
    await rm(join(directory, "last"))
    await assert.rejects(checkRawCorpusBudget(directory, lane, 8, 10), /byte budget/u)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
