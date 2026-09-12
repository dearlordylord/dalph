import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
// @ts-expect-error The custody environment helper is an executable JavaScript module.
import { withoutInheritedCustody } from "./gate-custody-records.mjs"
import vitestConfig from "../vitest.config.js"

// @ts-expect-error The production quality-gate helper is an executable JavaScript module.
import { runBoundedCommand } from "./run-bounded-command.mjs"

// The complete inventory launches 20 bounded fake commands. Inside an admitted
// parallel run, 13 calls measured 7.8s before the old 10s deadline interrupted
// legitimate registration and evidence publication. Keep this fixture finite,
// with room for the full inventory and cleanup. Enclosing tests separately
// reserve cleanup time after one command or two sequential commands.
const qualityGateFixtureCommandTimeoutMilliseconds = 30_000
export const qualityGateFixtureTestTimeoutMilliseconds = 45_000
export const qualityGateFixturePairTestTimeoutMilliseconds = 65_000

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
  failureCommands = [],
  fixtureName,
  gateArguments = [],
  runner = "scripts/run-quality-gate.mjs"
}: {
  readonly environment?: Readonly<Record<string, string>>
  readonly failureCommand?: string
  readonly failureCommands?: ReadonlyArray<string>
  readonly runner?: string
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
if (JSON.parse(process.env.DALPH_QUALITY_GATE_FAILURE_COMMANDS).includes(command)) process.exit(23)
`
  )
  await writeFile(invocationLog, "")
  await writeFile(invocationArgumentsLog, "")
  await writeFile(invocationCoverageBaseLog, "")

  try {
    const result = await runBoundedCommand({
      acceptedExitCodes: failureCommand === undefined && failureCommands.length === 0 ? [0] : [1],
      args: [runner, ...gateArguments],
      captureOutput: true,
      cwd: repositoryRoot,
      environment: {
        ...withoutInheritedCustody(process.env),
        DALPH_QUALITY_GATE_FAILURE_COMMANDS: JSON.stringify(
          failureCommand === undefined ? failureCommands : [failureCommand]
        ),
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
      relayParentSignals: true,
      timeoutMilliseconds: qualityGateFixtureCommandTimeoutMilliseconds
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
