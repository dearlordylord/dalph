import { quintGateSafetyTimeoutMilliseconds } from "./quint-gate-policy.mjs"
import { runBoundedCommand } from "./run-bounded-command.mjs"

const SECOND = 1_000
const pnpmEntryPoint = process.env.npm_execpath
const withoutQuint = process.argv.includes("--without-quint")

if (pnpmEntryPoint === undefined) {
  throw new Error("Run the quality gate through pnpm so its executable can be resolved safely")
}

const gates = [
  { args: ["build"], name: "build", timeout: 2 * 60 * SECOND },
  { args: ["check:package-boundary"], name: "production package boundary", timeout: 60 * SECOND },
  { args: ["typecheck"], name: "typecheck", timeout: 2 * 60 * SECOND },
  { args: ["check:format"], name: "format and lint", timeout: 2 * 60 * SECOND },
  { args: ["check:circular"], name: "dependency cycles", timeout: 60 * SECOND },
  { args: ["check:complexity"], name: "cyclomatic complexity", timeout: 60 * SECOND },
  { args: ["check:duplicates"], name: "duplication", timeout: 60 * SECOND },
  { args: ["test:memory"], name: "project memory scenarios", timeout: 60 * SECOND },
  ...(withoutQuint
    ? []
    : [{ args: ["check:quint"], name: "Quint recovery models", timeout: quintGateSafetyTimeoutMilliseconds }]),
  { args: ["test:mbt"], name: "Quint-connected model-based tests", timeout: 5 * 60 * SECOND },
  { args: ["test:coverage"], name: "tests and coverage", timeout: 5 * 60 * SECOND },
  { args: ["check:secrets"], name: "secret scan", timeout: 2 * 60 * SECOND }
]

for (const gate of gates) {
  await runBoundedCommand({
    args: [pnpmEntryPoint, ...gate.args],
    executable: process.execPath,
    name: `Quality gate '${gate.name}'`,
    timeoutMilliseconds: gate.timeout
  })
}
