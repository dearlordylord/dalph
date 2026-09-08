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

export const runQualityGateFixture = async ({
  failureCommand,
  fixtureName
}: {
  readonly failureCommand?: string
  readonly fixtureName: string
}) => {
  const directory = await mkdtemp(join(tmpdir(), `dalph-${fixtureName}-gate-`))
  const entryPoint = join(directory, "pnpm-entry-point.mjs")
  const invocationLog = join(directory, "invocations.log")

  await writeFile(
    entryPoint,
    `import { appendFileSync } from "node:fs"
const command = process.argv[3]
appendFileSync(process.env.DALPH_QUALITY_GATE_INVOCATIONS, command + "\\n")
if (command === process.env.DALPH_QUALITY_GATE_FAILURE_COMMAND) process.exit(23)
`
  )
  await writeFile(invocationLog, "")

  try {
    const result = await runBoundedCommand({
      acceptedExitCodes: failureCommand === undefined ? [0] : [1],
      args: ["scripts/run-quality-gate.mjs"],
      captureOutput: true,
      cwd: repositoryRoot,
      environment: {
        ...process.env,
        DALPH_QUALITY_GATE_FAILURE_COMMAND: failureCommand,
        DALPH_QUALITY_GATE_INVOCATIONS: invocationLog,
        // The fixture intentionally exercises the complete stage list, so it
        // acknowledges the same full-gate boundary required of a local caller.
        DALPH_FULL_GATE: "1",
        npm_execpath: entryPoint
      },
      executable: process.execPath,
      forwardOutput: false,
      name: `${fixtureName} quality-gate fixture`,
      timeoutMilliseconds: 10_000
    })
    return { invocations: await readInvocations(invocationLog), result }
  } finally {
    await rm(directory, { force: true, recursive: true })
  }
}
