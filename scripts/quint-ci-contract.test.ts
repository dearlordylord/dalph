import { execFileSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import {
  assertQuintHostedDeadlineContract,
  quintGateRegressionBudgetMilliseconds,
  quintGateSafetyTimeoutMilliseconds
} from "./quint-gate-policy.mjs"

// @ts-expect-error The production quality-gate helper is an executable JavaScript module.
import { runBoundedCommand } from "./run-bounded-command.mjs"
// @ts-expect-error The production stage inventory is an executable JavaScript module.
import { fullQualityGateManifest, preflightQualityGates } from "./quality-gate-stage-policy.mjs"

const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
  engines: { node: string }
  scripts: Record<string, string>
}
const ciWorkflow = readFileSync(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8")
const qualityGate = readFileSync(new URL("./run-quality-gate.mjs", import.meta.url), "utf8")
const quintGate = readFileSync(new URL("./check-quint-models.mjs", import.meta.url), "utf8")
const profileEvidence = readFileSync(new URL("../research/quint-hosted-equivalent-profile.md", import.meta.url), "utf8")
const repositoryRoot = fileURLToPath(new URL("../", import.meta.url))

// The retained stressed profile measured 36.26s through the three commands
// preceding mutation detection. The nested bound leaves 23.74s beyond that
// prefix; the enclosing Vitest budget leaves another 30s for termination,
// temporary-copy cleanup, and runner overhead.
const negativeControlMeasuredPrefixMilliseconds = 36_260
const negativeControlChildTimeoutMilliseconds = 60_000
const negativeControlTestTimeoutMilliseconds = 90_000

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
    expect(packageJson.scripts["check:ci:quality"]).toBe(
      "node scripts/with-gate-slot.mjs -- node scripts/run-quality-gate.mjs"
    )
    expect(packageJson.scripts["check:ci:formal"]).toBe("pnpm check:quint")
    expect(packageJson.scripts["test:mbt"]).toBe("vitest run --mode mbt")
    expect(packageJson.engines.node).toBe("^24.20.0")

    const jobs = parseWorkflowJobs(ciWorkflow)
    const formalJob = jobs.get("formal-models")?.join("\n")
    expect(formalJob).toBeDefined()
    expect(formalJob).toContain("\n    runs-on: ubuntu-24.04-arm")
    expect(formalJob).toContain("\n    timeout-minutes: 16")
    expect(formalJob).toMatch(/\n\s+node-version: \$\{\{ matrix\.node-version \}\}/)
    expect(formalJob).toContain("\n        run: pnpm check:quint")
    expect(formalJob).toContain(
      "\n      matrix:\n        node-version: ${{ fromJSON(needs.change-plan.outputs.versions) }}"
    )
    expect(jobs.get("quality")?.join("\n")).toContain("\n    runs-on: ubuntu-latest")
    expect(jobs.get("quality")?.join("\n")).not.toContain("pnpm check:quint")
    expect(quintGate).toContain("remainingSafetyTimeoutMilliseconds")
    expect(quintGate).toContain("createQuintGateTiming")
    expect(quintGate).toContain("assertQuintGateCommandContract")
    expect(quintGate).toContain(
      'assertQuintHostedDeadlineContract(await readFile(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8"))'
    )
    expect(quintGate).toContain("createQuintGateDeadline({ startedAt })")
    expect(quintGate).toContain("remainingSafetyTimeoutMilliseconds(command.name)")
    expect(profileEvidence).toContain("Node 22.22.2 and Node 24.15.0")
    expect(profileEvidence).toContain("retained historical evidence")
    expect(profileEvidence).toContain("Node 24.20.0 run")
    expect(profileEvidence).toContain("105 commands: 15 typechecks, 46 tests, 23")
    expect(profileEvidence).toContain("| 24.15.0 | final post-change |")
    expect(profileEvidence).toContain("| Node 22.22.2 repeat 1 | planned-attempt executor | 20 |")
    expect(profileEvidence).toContain("| Node 24.15.0 final post-change | integration finality | 5 |")
    expect(profileEvidence).toContain("572.29")
    expect(profileEvidence).toContain("210.000s hosted checkout/setup/network/final-reporting allowance")
    expect(profileEvidence).toContain("The allowance is reserved, not measured")
    expect(profileEvidence).toContain("outer `pnpm check:quint` command exited 0")
    expect(profileEvidence).toContain("intentionally exits 1")
  })

  it("keeps exhaustive formal checking out of check:all", () => {
    expect(packageJson.scripts["check:all"]).toBe(
      "node scripts/with-gate-slot.mjs -- node scripts/run-quality-gate.mjs"
    )
    expect(qualityGate).not.toContain('args: ["check:quint"]')
    const stageCommands = fullQualityGateManifest("fixture-base").map(
      (stage: { args: ReadonlyArray<string> }) => stage.args[0]
    )
    const structuralCommands = preflightQualityGates("fixture-base").map(
      (stage: { args: ReadonlyArray<string> }) => stage.args[0]
    )
    expect(structuralCommands).not.toContain("test:mbt")
    expect(stageCommands).not.toContain("test:mbt")
    expect(stageCommands).not.toContain("check:quint")
    expect(packageJson.scripts["check:ci:quality"]).not.toContain("test:mbt")
  })

  it("uses the hosted regression budget with a distinct safety stop", () => {
    expect(quintGateRegressionBudgetMilliseconds).toBe(750_000)
    expect(quintGateSafetyTimeoutMilliseconds).toBe(720_000)
    expect(() => assertQuintHostedDeadlineContract(ciWorkflow)).not.toThrow()
  })

  it(
    "fails the formal command when a selected model obligation is deliberately broken",
    async () => {
      expect(negativeControlChildTimeoutMilliseconds - negativeControlMeasuredPrefixMilliseconds).toBe(23_740)
      expect(negativeControlTestTimeoutMilliseconds - negativeControlChildTimeoutMilliseconds).toBe(30_000)
      expect(negativeControlChildTimeoutMilliseconds).toBeGreaterThan(negativeControlMeasuredPrefixMilliseconds)
      expect(negativeControlTestTimeoutMilliseconds).toBeGreaterThan(negativeControlChildTimeoutMilliseconds)

      const pnpmEntryPoint = process.env["npm_execpath"] ?? "pnpm"
      await mkdir(join(repositoryRoot, ".scratch"), { recursive: true })
      const directory = await mkdtemp(join(repositoryRoot, ".scratch", "dalph-broken-quint-model-"))
      const selectedModel = join(directory, "specs", "plannedAttemptExecutor.qnt")
      const repositorySelectedModel = join(repositoryRoot, "specs", "plannedAttemptExecutor.qnt")

      let commandStarted = false
      let commandStopped = false
      try {
        await cp(join(repositoryRoot, "package.json"), join(directory, "package.json"))
        await cp(join(repositoryRoot, "pnpm-lock.yaml"), join(directory, "pnpm-lock.yaml"))
        await cp(join(repositoryRoot, "scripts"), join(directory, "scripts"), { recursive: true })
        await cp(join(repositoryRoot, ".github"), join(directory, ".github"), { recursive: true })
        await cp(join(repositoryRoot, "specs"), join(directory, "specs"), { recursive: true })
        await symlink(join(repositoryRoot, "node_modules"), join(directory, "node_modules"), "dir")

        const originalSelectedModel = await readFile(selectedModel, "utf8")
        const selectedObligation =
          "val boundaryEvidenceUsesExactCommandIdentity: bool = commandEvidenceMatchesActive(state)"
        expect(originalSelectedModel).toContain(selectedObligation)
        await writeFile(
          selectedModel,
          originalSelectedModel.replace(
            selectedObligation,
            "val boundaryEvidenceUsesExactCommandIdentity: bool = false"
          )
        )

        let failure: unknown
        try {
          // The ignored copy shares the original Git worktree and inherits writer custody.
          expect(
            execFileSync("git", ["rev-parse", "--show-toplevel"], { cwd: directory, encoding: "utf8" }).trim()
          ).toBe(repositoryRoot.replace(/\/$/u, ""))
          commandStarted = true
          await runBoundedCommand({
            args:
              process.env["npm_execpath"] === undefined
                ? ["--dir", directory, "check:ci:formal"]
                : [pnpmEntryPoint, "--dir", directory, "check:ci:formal"],
            environment: { ...process.env },
            executable: process.env["npm_execpath"] === undefined ? pnpmEntryPoint : process.execPath,
            captureOutput: true,
            forwardOutput: false,
            name: "hosted formal model gate with broken selected obligation",
            relayParentSignals: true,
            timeoutMilliseconds: negativeControlChildTimeoutMilliseconds
          })
        } catch (error) {
          failure = error
          // The bounded boundary retains exit:1 only after proving this command
          // and every registered descendant stopped; ambiguous custody is failed.
          commandStopped =
            error instanceof Error && "quintCommandResult" in error && error.quintCommandResult === "exit:1"
        }

        expect(failure).toMatchObject({
          message: "hosted formal model gate with broken selected obligation failed with exit 1",
          output: expect.stringContaining("boundaryEvidenceUsesExactCommandIdentity"),
          outputLineCount: expect.any(Number)
        })

        expect(await readFile(repositorySelectedModel, "utf8")).toBe(originalSelectedModel)
      } finally {
        if (!commandStarted || commandStopped) {
          await rm(directory, { force: true, recursive: true })
        } else {
          console.error(`Preserving formal negative-control fixture with unproven stopped custody: ${directory}`)
        }
      }
    },
    negativeControlTestTimeoutMilliseconds
  )
})
