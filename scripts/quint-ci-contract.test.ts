import { readFileSync } from "node:fs"
import { cp, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

// @ts-expect-error The production quality-gate helper is an executable JavaScript module.
import { runBoundedCommand } from "./run-bounded-command.mjs"

const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
  scripts: Record<string, string>
}
const ciWorkflow = readFileSync(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8")
const qualityGate = readFileSync(new URL("./run-quality-gate.mjs", import.meta.url), "utf8")
const quintPolicy = readFileSync(new URL("./quint-gate-policy.mjs", import.meta.url), "utf8")
const quintGate = readFileSync(new URL("./check-quint-models.mjs", import.meta.url), "utf8")
const profileEvidence = readFileSync(new URL("../research/quint-hosted-equivalent-profile.md", import.meta.url), "utf8")
const repositoryRoot = fileURLToPath(new URL("../", import.meta.url))

describe("hosted formal-model contract", () => {
  it("exposes complete CI and independently runnable quality/formal subgates", () => {
    expect(packageJson.scripts["check:ci"]).toBe("pnpm check:ci:quality && pnpm check:ci:formal")
    expect(packageJson.scripts["check:ci:quality"]).toBe("node scripts/run-quality-gate.mjs --without-quint")
    expect(packageJson.scripts["check:ci:formal"]).toBe("pnpm check:quint")

    expect(ciWorkflow).toContain("formal-models:")
    expect(ciWorkflow).toContain("timeout-minutes: 16")
    expect(ciWorkflow).toContain("run: pnpm check:quint")
    expect(ciWorkflow).toContain("matrix.node-version")
    expect(quintGate).toContain("runWithQuintGateTiming")
    expect(profileEvidence).toContain("| 22.22.2 |")
    expect(profileEvidence).toContain("| 24.15.0 |")
    expect(profileEvidence).toContain("| 24.15.0 | final post-change |")
    expect(profileEvidence).toContain("572.29")
    expect(profileEvidence).toContain("300.000s explicit hosted checkout/setup/network allowance")
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

  it("fails the formal command when a selected model obligation is deliberately broken", async () => {
    const pnpmEntryPoint = process.env["npm_execpath"] ?? "pnpm"
    const directory = await mkdtemp(join(tmpdir(), "dalph-broken-quint-model-"))
    const selectedModel = join(directory, "specs", "plannedAttemptExecutor.qnt")
    const repositorySelectedModel = join(repositoryRoot, "specs", "plannedAttemptExecutor.qnt")

    try {
      await cp(join(repositoryRoot, "package.json"), join(directory, "package.json"))
      await cp(join(repositoryRoot, "pnpm-lock.yaml"), join(directory, "pnpm-lock.yaml"))
      await cp(join(repositoryRoot, "scripts"), join(directory, "scripts"), { recursive: true })
      await cp(join(repositoryRoot, "specs"), join(directory, "specs"), { recursive: true })
      await symlink(join(repositoryRoot, "node_modules"), join(directory, "node_modules"), "dir")

      const originalSelectedModel = await readFile(selectedModel, "utf8")
      const selectedObligation = "not(isCommandProjectionEvidence(state.evidence)) or and {"
      expect(originalSelectedModel).toContain(selectedObligation)
      await writeFile(
        selectedModel,
        originalSelectedModel.replace(selectedObligation, "isCommandProjectionEvidence(state.evidence) or and {")
      )

      await expect(
        runBoundedCommand({
          args:
            process.env["npm_execpath"] === undefined
              ? ["--dir", directory, "check:ci:formal"]
              : [pnpmEntryPoint, "--dir", directory, "check:ci:formal"],
          executable: process.env["npm_execpath"] === undefined ? pnpmEntryPoint : process.execPath,
          forwardOutput: false,
          name: "hosted formal model gate with broken selected obligation",
          timeoutMilliseconds: 30_000
        })
      ).rejects.toThrow("hosted formal model gate with broken selected obligation failed")

      expect(await readFile(repositorySelectedModel, "utf8")).toContain(selectedObligation)
    } finally {
      await rm(directory, { force: true, recursive: true })
    }
  }, 45_000)
})
