import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import vitestConfig from "../vitest.config.js"

// @ts-expect-error The production quality-gate helper is an executable JavaScript module.
import { runBoundedCommand } from "./run-bounded-command.mjs"

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url))

export const resolveVitestConfig = (mode: string) => {
  if (typeof vitestConfig !== "function") throw new Error("Vitest configuration must be mode-aware")
  return vitestConfig({ command: "serve", isPreview: false, isSsrBuild: false, mode })
}

const readInvocations = async (path: string) => (await readFile(path, "utf8")).trim().split("\n").filter(Boolean)

const parseInvocationArguments = (line: string): ReadonlyArray<string> => {
  const parsed: unknown = JSON.parse(line)
  if (!Array.isArray(parsed) || !parsed.every((argument) => typeof argument === "string")) {
    throw new Error("quality-gate fixture recorded invalid invocation arguments")
  }
  return parsed
}

const parseInvocationCoverageBase = (line: string): readonly [string, string] => {
  const parsed: unknown = JSON.parse(line)
  if (!Array.isArray(parsed) || parsed.length !== 2 || typeof parsed[0] !== "string" || typeof parsed[1] !== "string") {
    throw new Error("quality-gate fixture recorded an invalid coverage-base observation")
  }
  return [parsed[0], parsed[1]]
}

export const runQualityGateFixture = async ({
  environment,
  failureCommand,
  fixtureName,
  gateArguments = []
}: {
  readonly environment?: Readonly<Record<string, string>>
  readonly failureCommand?: string
  readonly gateArguments?: ReadonlyArray<string>
  readonly fixtureName: string
}) => {
  const directory = await mkdtemp(join(tmpdir(), `dalph-${fixtureName}-gate-`))
  const entryPoint = join(directory, "pnpm-entry-point.mjs")
  const invocationLog = join(directory, "invocations.log")
  const invocationArgumentsLog = join(directory, "invocation-arguments.log")
  const invocationCoverageBaseLog = join(directory, "invocation-coverage-base.log")

  await writeFile(
    entryPoint,
    `import { appendFileSync } from "node:fs"
const command = process.argv[3]
appendFileSync(process.env.DALPH_QUALITY_GATE_INVOCATIONS, command + "\\n")
appendFileSync(process.env.DALPH_QUALITY_GATE_INVOCATION_ARGUMENTS, JSON.stringify(process.argv.slice(3)) + "\\n")
appendFileSync(process.env.DALPH_QUALITY_GATE_INVOCATION_COVERAGE_BASES, JSON.stringify([command, process.env.DALPH_COVERAGE_BASE_SHA ?? ""]) + "\\n")
if (command === process.env.DALPH_QUALITY_GATE_FAILURE_COMMAND) process.exit(23)
`
  )
  await writeFile(invocationLog, "")
  await writeFile(invocationArgumentsLog, "")
  await writeFile(invocationCoverageBaseLog, "")

  try {
    const result = await runBoundedCommand({
      acceptedExitCodes: failureCommand === undefined ? [0] : [1],
      args: ["scripts/run-quality-gate.mjs", ...gateArguments],
      captureOutput: true,
      cwd: repositoryRoot,
      environment: {
        ...process.env,
        DALPH_QUALITY_GATE_FAILURE_COMMAND: failureCommand,
        DALPH_QUALITY_GATE_INVOCATION_ARGUMENTS: invocationArgumentsLog,
        DALPH_QUALITY_GATE_INVOCATION_COVERAGE_BASES: invocationCoverageBaseLog,
        DALPH_QUALITY_GATE_INVOCATIONS: invocationLog,
        // The fixture intentionally exercises the complete stage list, so it
        // acknowledges the same full-gate boundary required of a local caller.
        DALPH_FULL_GATE: "1",
        ...environment,
        npm_execpath: entryPoint
      },
      executable: process.execPath,
      forwardOutput: false,
      name: `${fixtureName} quality-gate fixture`,
      timeoutMilliseconds: 10_000
    })
    return {
      invocationArguments: (await readInvocations(invocationArgumentsLog)).map(parseInvocationArguments),
      invocationCoverageBases: (await readInvocations(invocationCoverageBaseLog)).map(parseInvocationCoverageBase),
      invocations: await readInvocations(invocationLog),
      result
    }
  } finally {
    await rm(directory, { force: true, recursive: true })
  }
}
