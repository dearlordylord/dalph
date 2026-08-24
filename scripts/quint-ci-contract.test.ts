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

const parseWorkflowJobs = (source: string) => {
  const lines = source.split("\n")
  const jobsLine = lines.findIndex((line) => line === "jobs:")
  if (jobsLine < 0) throw new Error("workflow has no jobs mapping")
  const jobs = new Map<string, Array<string>>()
  let currentJob: string | undefined
  for (const line of lines.slice(jobsLine + 1)) {
    const job = /^  ([A-Za-z0-9_-]+):$/.exec(line)
    if (job !== null) {
      const name = job[1]
      if (name === undefined) continue
      currentJob = name
      jobs.set(currentJob, [])
      continue
    }
    if (currentJob !== undefined) jobs.get(currentJob)?.push(line)
  }
  return jobs
}

describe("hosted formal-model contract", () => {
  it("exposes complete CI and independently runnable quality/formal subgates", () => {
    expect(packageJson.scripts["check:ci"]).toBe("pnpm check:ci:quality && pnpm check:ci:formal")
    expect(packageJson.scripts["check:ci:quality"]).toBe("node scripts/run-quality-gate.mjs --without-quint")
    expect(packageJson.scripts["check:ci:formal"]).toBe("pnpm check:quint")

    const jobs = parseWorkflowJobs(ciWorkflow)
    const formalJob = jobs.get("formal-models")?.join("\n")
    expect(formalJob).toBeDefined()
    expect(formalJob).toContain("\n    timeout-minutes: 16")
    expect(formalJob).toMatch(/\n\s+node-version: \$\{\{ matrix\.node-version \}\}/)
    expect(formalJob).toContain("\n        run: pnpm check:quint")
    expect(formalJob).toContain(
      "\n      matrix:\n        node-version: ${{ fromJSON(needs.change-plan.outputs.versions) }}"
    )
    expect(jobs.get("quality")?.join("\n")).not.toContain("pnpm check:quint")
    expect(quintGate).toContain("runWithQuintGateTiming")
    expect(profileEvidence).toContain("| 22.22.2 |")
    expect(profileEvidence).toContain("| 24.15.0 |")
    expect(profileEvidence).toContain("| 24.15.0 | final post-change |")
    expect(profileEvidence).toContain("| Node 22.22.2 repeat 1 | planned-attempt executor | 20 |")
    expect(profileEvidence).toContain("| Node 24.15.0 final post-change | integration finality | 5 |")
    expect(profileEvidence).toContain("572.29")
    expect(profileEvidence).toContain("300.000s explicit hosted checkout/setup/network allowance")
    expect(profileEvidence).toContain("that allowance is reserved, not measured")
    expect(profileEvidence).toContain("outer `pnpm check:quint` command exited 0")
    expect(profileEvidence).toContain("intentionally exits 1")
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

      let failure: unknown
      try {
        await runBoundedCommand({
          args:
            process.env["npm_execpath"] === undefined
              ? ["--dir", directory, "check:ci:formal"]
              : [pnpmEntryPoint, "--dir", directory, "check:ci:formal"],
          executable: process.env["npm_execpath"] === undefined ? pnpmEntryPoint : process.execPath,
          captureOutput: true,
          forwardOutput: false,
          name: "hosted formal model gate with broken selected obligation",
          timeoutMilliseconds: 30_000
        })
      } catch (error) {
        failure = error
      }

      expect(failure).toMatchObject({
        message: "hosted formal model gate with broken selected obligation failed with exit 1",
        output: expect.stringContaining("commandProjectionBelongsToCalledCommand"),
        outputLineCount: expect.any(Number)
      })

      expect(await readFile(repositorySelectedModel, "utf8")).toBe(originalSelectedModel)
    } finally {
      await rm(directory, { force: true, recursive: true })
    }
  }, 45_000)
})
