import assert from "node:assert/strict"
import { readdir } from "node:fs/promises"
import { test } from "node:test"
import { runBoundedCommand } from "./run-bounded-command.mjs"

void test("unknown duplicate and malformed generation selections refuse before batch effects", async () => {
  const batches = async () =>
    (
      await readdir(".scratch/mbt-generation").catch((error) => {
        if (error.code === "ENOENT") return []
        throw error
      })
    ).sort((a, b) => a.localeCompare(b))
  const before = await batches()
  for (const args of [
    ["unknown"],
    ["result-recovery-direction/1", "result-recovery-direction/1"],
    ["--all", "--all"],
    []
  ]) {
    await assert.rejects(
      runBoundedCommand({
        name: "MBT selection refusal control",
        executable: process.execPath,
        args: ["scripts/generate-mbt-corpus.mjs", ...args],
        cwd: process.cwd(),
        timeoutMilliseconds: 20000,
        captureOutput: true,
        forwardOutput: false
      }),
      (error) => {
        assert.equal(error.stoppedWritersProven, true)
        assert.match(error.output, /Unknown MBT lane|Duplicate MBT lane|Usage:/u)
        assert.doesNotMatch(error.output, /Generation evidence:/u)
        return true
      }
    )
  }
  assert.deepEqual(await batches(), before)
})
