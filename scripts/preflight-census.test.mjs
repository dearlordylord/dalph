import assert from "node:assert/strict"
import { test } from "node:test"
import { runPreflightCensus } from "./preflight-census.mjs"

const stage = (name) => ({ name, args: [name] })

test("reports independent failures together", async () => {
  const invocations = []
  const diagnostics = []
  const result = await runPreflightCensus({
    gates: [stage("format"), stage("artifacts"), stage("unused-export"), stage("complexity")],
    report: (message) => diagnostics.push(message),
    runStage: async (gate) => {
      invocations.push(gate.name)
      if (gate.name !== "complexity")
        throw Object.assign(new Error("controlled exit 23"), { quintCommandResult: "exit:23" })
      return { outputLineCount: 0 }
    }
  })
  assert.deepEqual(invocations, ["format", "artifacts", "unused-export", "complexity"])
  assert.equal(result.succeeded, false)
  for (const command of ["format", "artifacts", "unused-export"])
    assert.ok(diagnostics.some((line) => line.includes(`pnpm ${command}: controlled exit 23`)))
  assert.ok(diagnostics.some((line) => line.includes("3 failed stages")))
})

test("preserves successful command order and output accounting", async () => {
  const invocations = []
  const result = await runPreflightCensus({
    gates: [stage("artifacts"), stage("capability")],
    report: () => {},
    runStage: async (gate) => {
      invocations.push(gate.name)
      return { outputLineCount: 1 }
    }
  })
  assert.deepEqual(invocations, ["artifacts", "capability"])
  assert.equal(result.succeeded, true)
  assert.equal(result.successfulOutputLines, 2)
})

for (const outcome of ["interrupted", "cancelled", "failed"]) {
  test(`stops launching after ${outcome} instead of treating unsafe termination as an ordinary finding`, async () => {
    const invocations = []
    const failure = Object.assign(new Error(outcome), { quintCommandResult: outcome })
    await assert.rejects(
      runPreflightCensus({
        gates: [stage("first"), stage("second")],
        report: () => {},
        runStage: async (gate) => {
          invocations.push(gate.name)
          throw failure
        }
      }),
      (error) => error === failure
    )
    assert.deepEqual(invocations, ["first"])
  })
}

for (const outcome of ["launch-failed", "timed-out"]) {
  test(`continues independent checks after ${outcome} with no surviving process group`, async () => {
    const invocations = []
    const result = await runPreflightCensus({
      gates: [stage("first"), stage("second")],
      report: () => {},
      runStage: async (gate) => {
        invocations.push(gate.name)
        if (gate.name === "first") throw Object.assign(new Error(outcome), { quintCommandResult: outcome })
        return { outputLineCount: 0 }
      }
    })
    assert.deepEqual(invocations, ["first", "second"])
    assert.equal(result.succeeded, false)
  })
}
