import { describe, expect, it } from "vitest"
// @ts-expect-error The model scope policy is shared with the executable JavaScript runner.
import { modelGovernedChanges } from "./quint-model-scope.mjs"

describe("quint model scope", () => {
  it("finds no governed change in ordinary implementation files", () => {
    expect(
      modelGovernedChanges({
        changedFiles: ["packages/orchestrator/src/control/policy.ts", "docs/DEVELOPMENT.md", "package.json"]
      })
    ).toEqual([])
  })

  it("reports specifications, gate scripts, and conformance adapters", () => {
    expect(
      modelGovernedChanges({
        changedFiles: [
          "packages/orchestrator/src/control/policy.ts",
          "specs/run_activation.qnt",
          "scripts/quint-model-obligations.mjs",
          "packages/dalph/test/conformance/run-activation.mbt.test.ts",
          "specs/run_activation.qnt"
        ]
      })
    ).toEqual([
      "packages/dalph/test/conformance/run-activation.mbt.test.ts",
      "scripts/quint-model-obligations.mjs",
      "specs/run_activation.qnt"
    ])
  })
})
