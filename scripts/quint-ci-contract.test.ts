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
const formalGate = readFileSync(new URL("./run-formal-gate.mjs", import.meta.url), "utf8")
const quintGate = readFileSync(new URL("./check-quint-models.mjs", import.meta.url), "utf8")
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
      "node scripts/with-gate-slot.mjs -- node scripts/run-quality-gate.mjs --hosted-quality"
    )
    expect(packageJson.scripts["check:quint"]).toBe(
      "node scripts/with-gate-slot.mjs -- node scripts/run-formal-gate.mjs"
    )
    expect(packageJson.scripts["check:ci:formal"]).toBe(
      "node scripts/with-gate-slot.mjs -- node scripts/check-quint-models.mjs"
    )
    expect(packageJson.scripts["check:ci:formal:shard"]).toBe(
      "node scripts/with-gate-slot.mjs -- node scripts/run-hosted-formal-shard.mjs"
    )
    expect(packageJson.scripts["test:mbt"]).toBe("vitest run --mode mbt")
    expect(packageJson.engines.node).toBe("^24.20.0")

    const jobs = parseWorkflowJobs(ciWorkflow)
    const changePlanJob = jobs.get("change-plan")?.join("\n")
    expect(changePlanJob).toBeDefined()
    expect(changePlanJob).toContain("\n      head-sha: ${{ steps.change.outputs.head-sha }}")
    expect(changePlanJob).toContain("\n      formal-required: ${{ steps.change.outputs.formal-required }}")
    expect(changePlanJob).toContain("\n      formal-classification: ${{ steps.change.outputs.formal-classification }}")
    const formalJob = jobs.get("formal-models")?.join("\n")
    expect(formalJob).toBeDefined()
    expect(formalJob).toContain("\n    if: needs.change-plan.outputs.formal-required == 'true'")
    expect(formalJob).not.toContain("docs-only")
    expect(formalJob).toContain("\n    runs-on: ubuntu-24.04-arm")
    expect(formalJob).toContain("\n    timeout-minutes: 16")
    expect(formalJob).toMatch(/\n\s+node-version: \$\{\{ matrix\.node-version \}\}/)
    expect(formalJob).toContain("\n        shard: [0, 1]")
    expect(formalJob).toContain('pnpm check:ci:formal:shard --shard "${{ matrix.shard }}"')
    expect(formalJob).not.toContain("run: node scripts/run-hosted-formal-shard.mjs")
    expect(formalJob).toContain("\n        uses: actions/upload-artifact@v4")
    expect(formalJob).toContain("path: formal-shard-reports/shard-${{ matrix.shard }}.json")
    expect(formalJob).not.toContain(".formal-shard-reports")
    expect(
      execFileSync("git", ["check-ignore", "formal-shard-reports/shard-0.json"], {
        cwd: repositoryRoot,
        encoding: "utf8"
      }).trim()
    ).toBe("formal-shard-reports/shard-0.json")
    expect(formalJob).toContain(
      "\n      matrix:\n        node-version: ${{ fromJSON(needs.change-plan.outputs.versions) }}\n        shard: [0, 1]"
    )
    const aggregateJob = jobs.get("formal-model-aggregate")?.join("\n")
    expect(aggregateJob).toBeDefined()
    expect(aggregateJob).toContain("\n    needs: [change-plan, formal-models]")
    expect(aggregateJob).toContain("\n    if: always()")
    expect(aggregateJob).toMatch(
      /- name: Refuse failed change plan\n\s+if: needs\.change-plan\.result != 'success'\n\s+run: \|\n\s+printf 'Formal model change plan did not succeed; refusing a successful required check\.\\n' >&2\n\s+exit 1/u
    )
    const supportedVersions = packageJson.engines.node.split(" || ").map((range) => range.slice(1))
    expect(aggregateJob).toContain(
      `node-version: \${{ fromJSON(needs.change-plan.outputs.versions || '${JSON.stringify(supportedVersions)}') }}`
    )
    expect(aggregateJob).toContain("DALPH_FORMAL_BASE_SHA: ${{ needs.change-plan.outputs.base-sha }}")
    expect(aggregateJob).toContain("DALPH_FORMAL_HEAD_SHA: ${{ needs.change-plan.outputs.head-sha }}")
    expect(aggregateJob).toContain(
      "DALPH_FORMAL_CLASSIFICATION: ${{ needs.change-plan.outputs.formal-classification }}"
    )
    expect(aggregateJob).toMatch(
      /- name: Checkout\n\s+if: needs\.change-plan\.result == 'success' && needs\.change-plan\.outputs\.formal-required == 'true'/u
    )
    expect(aggregateJob).toMatch(
      /- name: Set up Node\.js\n\s+if: needs\.change-plan\.result == 'success' && needs\.change-plan\.outputs\.formal-required == 'true'/u
    )
    expect(aggregateJob).toMatch(
      /- name: Download formal model shard evidence\n\s+if: needs\.change-plan\.result == 'success' && needs\.change-plan\.outputs\.formal-required == 'true'\n\s+uses: actions\/download-artifact@v4/u
    )
    expect(aggregateJob).toContain("\n          path: formal-shard-reports")
    expect(aggregateJob).not.toContain(".formal-shard-reports")
    expect(aggregateJob).toMatch(
      /- name: Validate complete formal model evidence\n\s+if: needs\.change-plan\.result == 'success' && needs\.change-plan\.outputs\.formal-required == 'true'\n\s+run: node scripts\/aggregate-hosted-formal-shards\.mjs formal-shard-reports\/shard-0\.json formal-shard-reports\/shard-1\.json/u
    )
    expect(aggregateJob).toMatch(
      /- name: Report formal model gate not applicable\n\s+if: needs\.change-plan\.result == 'success' && needs\.change-plan\.outputs\.formal-required == 'false'/u
    )
    expect(aggregateJob).toContain("Formal model gate not applicable.")
    expect(aggregateJob).toContain("printf 'Base SHA: %s\\n' \"$DALPH_FORMAL_BASE_SHA\"")
    expect(aggregateJob).toContain("printf 'Head SHA: %s\\n' \"$DALPH_FORMAL_HEAD_SHA\"")
    expect(aggregateJob).toContain("printf 'Classification: %s\\n' \"$DALPH_FORMAL_CLASSIFICATION\"")
    expect(aggregateJob).toMatch(
      /- name: Refuse missing formal classification\n\s+if: needs\.change-plan\.result == 'success' && needs\.change-plan\.outputs\.formal-required != 'true' && needs\.change-plan\.outputs\.formal-required != 'false'/u
    )
    expect(aggregateJob).not.toContain("pnpm install")
    expect(jobs.get("quality")?.join("\n")).toContain("\n    runs-on: ubuntu-latest")
    expect(jobs.get("quality")?.join("\n")).not.toContain("pnpm check:quint")
    expect(formalGate).toContain("Use the admitted pnpm check:quint entry point")
    expect(formalGate).toContain("run-formal-workflow.mjs")
    expect(formalGate).toContain("formalGatePolicy.outerMilliseconds")
    expect(quintGate).toContain("createQuintGateTiming")
    expect(quintGate).toContain("assertQuintGateCommandContract")
    expect(quintGate).toContain(
      'assertQuintHostedDeadlineContract(await readFile(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8"))'
    )
    expect(quintGate).toContain(
      "createQuintGateDeadline({\n    startedAt,\n    allowanceMilliseconds: profile.policy.safetyTimeoutMilliseconds\n  })"
    )
    expect(quintGate).toContain("const timeoutFor = (name) =>")
    expect(quintGate).toContain("remainingExecutionMilliseconds(name)")
    expect(quintGate).toContain("timeoutMilliseconds: timeoutFor(command.name)")
  })

  it("preserves required application checks alongside automatic local formal handoff", () => {
    expect(packageJson.scripts["check:all"]).toBe(
      "node scripts/with-gate-slot.mjs -- node scripts/run-quality-gate.mjs --local-handoff"
    )
    const stageCommands = fullQualityGateManifest("fixture-base").map(
      (stage: { args: ReadonlyArray<string> }) => stage.args[0]
    )
    const structuralCommands = preflightQualityGates("fixture-base").map(
      (stage: { args: ReadonlyArray<string> }) => stage.args[0]
    )
    const manifest = fullQualityGateManifest("fixture-base")
    const reducerLab = manifest.find((stage) => stage.id === "reducer-lab")
    expect(structuralCommands).not.toContain("test:mbt")
    expect(stageCommands).not.toContain("test:mbt")
    expect(stageCommands).not.toContain("check:quint")
    expect(structuralCommands.indexOf("check:lab")).toBe(structuralCommands.indexOf("lint:code") + 1)
    expect(reducerLab).toMatchObject({
      args: ["check:lab"],
      artifactRoots: ["prototypes/reducer-lab/dist"],
      boundary: "preflight"
    })
    expect(stageCommands.slice(structuralCommands.length)).toEqual([
      "test:delivery-repeatability",
      "test:recorded-catalog",
      "test"
    ])
    expect(packageJson.scripts["check:ci:quality"]).not.toContain("test:mbt")
  })

  it("uses the hosted regression budget with a distinct safety stop", () => {
    expect(quintGateRegressionBudgetMilliseconds).toBe(750_000)
    expect(quintGateSafetyTimeoutMilliseconds).toBe(720_000)
    expect(() => assertQuintHostedDeadlineContract(ciWorkflow)).not.toThrow()
  })

  it("forwards shard flags without a separator through pnpm's script shorthand", async () => {
    await mkdir(join(repositoryRoot, ".scratch"), { recursive: true })
    const directory = await mkdtemp(join(repositoryRoot, ".scratch", "dalph-pnpm-shard-"))
    const capturedArgumentsPath = join(directory, "captured-arguments.json")
    try {
      await writeFile(
        join(directory, "package.json"),
        JSON.stringify({ private: true, scripts: { "check:ci:formal:shard": "node capture-arguments.mjs" } })
      )
      await writeFile(
        join(directory, "capture-arguments.mjs"),
        [
          'import { writeFile } from "node:fs/promises"',
          "const destination = process.env.DALPH_TEST_ARGUMENT_CAPTURE",
          'if (destination === undefined) throw new Error("argument capture path is missing")',
          "await writeFile(destination, JSON.stringify(process.argv.slice(2)))",
          ""
        ].join("\n")
      )

      const pnpmEntryPoint = process.env["npm_execpath"] ?? "pnpm"
      const pnpmArguments = ["check:ci:formal:shard", "--shard", "1", "--report", "formal-shard-reports/shard-1.json"]
      execFileSync(
        process.env["npm_execpath"] === undefined ? pnpmEntryPoint : process.execPath,
        process.env["npm_execpath"] === undefined ? pnpmArguments : [pnpmEntryPoint, ...pnpmArguments],
        {
          cwd: directory,
          encoding: "utf8",
          env: { ...process.env, DALPH_TEST_ARGUMENT_CAPTURE: capturedArgumentsPath }
        }
      )

      expect(JSON.parse(await readFile(capturedArgumentsPath, "utf8"))).toEqual([
        "--shard",
        "1",
        "--report",
        "formal-shard-reports/shard-1.json"
      ])
    } finally {
      await rm(directory, { force: true, recursive: true })
    }
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
