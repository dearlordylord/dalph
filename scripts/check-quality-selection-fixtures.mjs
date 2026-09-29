import { runBoundedCommand } from "./run-bounded-command.mjs"
import { withoutInheritedCustody } from "./gate-custody-records.mjs"

const baseSha = process.env.DALPH_DIAGNOSTICS_BASE

if (baseSha === undefined || baseSha.length === 0) {
  console.error("Quality-stage fixture probe skipped: DALPH_DIAGNOSTICS_BASE is not set")
} else {
  if (process.env.DALPH_COVERAGE_BASE_SHA !== undefined && process.env.DALPH_COVERAGE_BASE_SHA !== baseSha) {
    throw new Error("Quality-stage fixture probe received conflicting Base SHAs")
  }

  const pnpmEntryPoint = process.env.npm_execpath
  if (pnpmEntryPoint === undefined) {
    throw new Error("Run the quality-stage fixture probe through pnpm check:fast")
  }

  await runBoundedCommand({
    name: "Base-scoped quality-stage fixture probe",
    executable: process.execPath,
    args: [
      pnpmEntryPoint,
      "exec",
      "vitest",
      "run",
      "scripts/capability-registration-quality-gate.test.ts",
      "scripts/preflight-quality-gate.test.ts",
      "scripts/recorded-catalog-gate.test.ts"
    ],
    cwd: process.cwd(),
    environment: { ...withoutInheritedCustody(process.env), DALPH_COVERAGE_BASE_SHA: baseSha },
    relayParentSignals: true,
    timeoutMilliseconds: 120_000
  })
}
