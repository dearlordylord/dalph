import { readFileSync } from "node:fs"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

// @ts-expect-error The production quality-gate helper is an executable JavaScript module.
import { runBoundedCommand } from "./run-bounded-command.mjs"

const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
  scripts: Record<string, string>
}
const ciWorkflow = readFileSync(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8")
const qualityGate = readFileSync(new URL("./run-quality-gate.mjs", import.meta.url), "utf8")
const quintPolicy = readFileSync(new URL("./quint-gate-policy.mjs", import.meta.url), "utf8")

describe("hosted formal-model contract", () => {
  it("exposes complete CI and independently runnable quality/formal subgates", () => {
    expect(packageJson.scripts["check:ci"]).toBe("pnpm check:ci:quality && pnpm check:ci:formal")
    expect(packageJson.scripts["check:ci:quality"]).toBe("node scripts/run-quality-gate.mjs --without-quint")
    expect(packageJson.scripts["check:ci:formal"]).toBe("pnpm check:quint")

    expect(ciWorkflow).toContain("formal-models:")
    expect(ciWorkflow).toContain("timeout-minutes: 12")
    expect(ciWorkflow).toContain("run: pnpm check:quint")
    expect(ciWorkflow).toContain("matrix.node-version")
  })

  it("keeps exhaustive formal checking out of check:all", () => {
    expect(packageJson.scripts["check:all"]).toBe("node scripts/run-quality-gate.mjs")
    expect(qualityGate).not.toContain('args: ["check:quint"]')
    expect(qualityGate).toContain('args: ["test:mbt"]')
  })

  it("uses the provisional ten-minute regression budget without a dead safety export", () => {
    expect(quintPolicy).toContain("quintGateRegressionBudgetMilliseconds = 600 * second")
    expect(quintPolicy).not.toContain("quintGateSafetyTimeoutMilliseconds")
  })

  it("fails the formal command when a selected model test is deliberately broken", async () => {
    const pnpmEntryPoint = process.env["npm_execpath"] ?? "pnpm"
    const pnpmArguments = process.env["npm_execpath"] === undefined ? [] : [pnpmEntryPoint]
    const directory = await mkdtemp(join(tmpdir(), "dalph-broken-quint-model-"))
    const model = join(directory, "broken.qnt")

    try {
      await writeFile(
        model,
        `module brokenFormalGate {
  run deliberatelyBrokenTest = { expect(false) }
}
`
      )

      await expect(
        runBoundedCommand({
          args: [...pnpmArguments, "quint", "test", model, "--main", "deliberatelyBrokenTest"],
          executable: process.env["npm_execpath"] === undefined ? pnpmEntryPoint : process.execPath,
          forwardOutput: false,
          name: "broken formal model fixture",
          timeoutMilliseconds: 30_000
        })
      ).rejects.toThrow("broken formal model fixture failed")
    } finally {
      await rm(directory, { force: true, recursive: true })
    }
  })
})
