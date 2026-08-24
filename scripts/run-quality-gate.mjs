import { runBoundedCommand } from "./run-bounded-command.mjs"
import { addSuccessfulOutputLines } from "./quality-output-budget.mjs"

const SECOND = 1_000
const maximumSuccessfulOutputLines = 550
const pnpmEntryPoint = process.env.npm_execpath
const withoutQuint = process.argv.includes("--without-quint")
const testEnvironment = {
  ...process.env,
  NODE_OPTIONS: [process.env.NODE_OPTIONS, "--disable-warning=ExperimentalWarning"].filter(Boolean).join(" ")
}

if (pnpmEntryPoint === undefined) {
  throw new Error("Run the quality gate through pnpm so its executable can be resolved safely")
}

const gates = [
  { args: ["build"], name: "build", timeout: 2 * 60 * SECOND },
  { args: ["check:package-boundary"], name: "production package boundary", timeout: 60 * SECOND },
  { args: ["test:capability-registration"], name: "capability registration", timeout: 60 * SECOND },
  { args: ["test:ci-change-classification"], name: "CI change classification", timeout: 60 * SECOND },
  { args: ["typecheck"], name: "typecheck", timeout: 2 * 60 * SECOND },
  { args: ["typecheck:effect"], name: "Effect diagnostics", timeout: 3 * 60 * SECOND },
  { args: ["check:format"], name: "format and lint", timeout: 5 * 60 * SECOND },
  { args: ["check:circular"], name: "dependency cycles", timeout: 60 * SECOND },
  { args: ["check:complexity"], name: "cyclomatic complexity", timeout: 60 * SECOND },
  { args: ["check:duplicates"], name: "duplication", timeout: 60 * SECOND },
  { args: ["test:memory"], name: "project memory scenarios", timeout: 60 * SECOND },
  { args: ["check:lab"], name: "Reducer Lab maintained evaluation", timeout: 5 * 60 * SECOND },
  ...(withoutQuint
    ? []
    : [{ args: ["test:mbt"], name: "Quint-connected model-based tests", timeout: 8 * 60 * SECOND }]),
  // The supported-Node hosted matrix is slower than local coverage after the
  // real process-boundary suites; keep the command bounded without cutting
  // off Vitest before it can report a concrete failure.
  { args: ["test:coverage"], environment: testEnvironment, name: "tests and coverage", timeout: 20 * 60 * SECOND },
  { args: ["check:secrets"], name: "secret scan", timeout: 5 * 60 * SECOND }
]

let successfulOutputLines = 0

for (const gate of gates) {
  const result = await runBoundedCommand({
    args: [pnpmEntryPoint, ...gate.args],
    environment: gate.environment,
    executable: process.execPath,
    name: `Quality gate '${gate.name}'`,
    timeoutMilliseconds: gate.timeout
  })
  successfulOutputLines = addSuccessfulOutputLines({
    currentOutputLines: successfulOutputLines,
    maximumOutputLines: maximumSuccessfulOutputLines,
    stageName: gate.name,
    stageOutputLines: result.outputLineCount
  })
}

console.log(`Quality gate emitted ${successfulOutputLines}/${maximumSuccessfulOutputLines} successful output lines.`)
