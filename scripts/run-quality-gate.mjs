import { runBoundedCommand } from "./run-bounded-command.mjs"
import { addSuccessfulOutputLines } from "./quality-output-budget.mjs"

const SECOND = 1_000
const maximumSuccessfulOutputLines = 550
const pnpmEntryPoint = process.env.npm_execpath
const withoutQuint = process.argv.includes("--without-quint")
const candidateArgument = process.argv.find((argument) => argument.startsWith("--candidate="))
// The full gate rebuilds the whole program several times and runs every suite, so it belongs to a frozen candidate and
// to hosted verification. Development uses the focused tiers instead, which is why local runs state their intent.
const acknowledgedFullGate =
  candidateArgument !== undefined || process.env["DALPH_FULL_GATE"] === "1" || process.env["CI"] !== undefined
const testEnvironment = {
  ...process.env,
  NODE_OPTIONS: [process.env.NODE_OPTIONS, "--disable-warning=ExperimentalWarning"].filter(Boolean).join(" ")
}

if (pnpmEntryPoint === undefined) {
  throw new Error("Run the quality gate through pnpm so its executable can be resolved safely")
}

if (!acknowledgedFullGate) {
  console.error(
    [
      "The full quality gate runs once per frozen candidate.",
      "Development loop: pnpm check:fast",
      "Before freezing: pnpm typecheck && pnpm lint:code && pnpm test",
      "Frozen candidate: pnpm check:all --candidate=<base sha>"
    ].join("\n")
  )
  process.exit(2)
}

const gates = [
  { args: ["check:artifacts"], name: "build and production artifacts", timeout: 5 * 60 * SECOND },
  { args: ["test:ci-change-classification"], name: "CI change classification", timeout: 60 * SECOND },
  { args: ["typecheck"], name: "typecheck", timeout: 2 * 60 * SECOND },
  { args: ["typecheck:effect"], name: "Effect diagnostics", timeout: 3 * 60 * SECOND },
  { args: ["check:format"], name: "format and lint", timeout: 5 * 60 * SECOND },
  { args: ["check:circular"], name: "dependency cycles", timeout: 60 * SECOND },
  { args: ["check:complexity"], name: "cyclomatic complexity", timeout: 60 * SECOND },
  { args: ["check:duplicates"], name: "duplication", timeout: 60 * SECOND },
  { args: ["test:memory"], name: "project memory scenarios", timeout: 60 * SECOND },
  {
    args: ["test:issue-268-c4"],
    name: "issue 268 fresh-process repeatability",
    terminationGrace: 15 * SECOND,
    timeout: 19 * 60 * SECOND
  },
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
    // Omit pnpm lifecycle banners; retain the child tool's output and exit status.
    args: [pnpmEntryPoint, "--silent", ...gate.args],
    environment: gate.environment,
    executable: process.execPath,
    name: `Quality gate '${gate.name}'`,
    relayParentSignals: true,
    terminationGraceMilliseconds: gate.terminationGrace,
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
