import { runBoundedCommand } from "./run-bounded-command.mjs"
import { runPreflightCensus } from "./preflight-census.mjs"
import { boundedQualityGateCommand, preflightQualityGates } from "./quality-gate-stage-policy.mjs"
import { resolveQualityGateBase } from "./resolve-quality-gate-base.mjs"

// Admitted structural checks always inspect formatter inputs without incremental result reuse.
process.env.DALPH_DPRINT_INCREMENTAL = "disabled"

const pnpmEntryPoint = process.env.npm_execpath
if (pnpmEntryPoint === undefined) throw new Error("Run preflight through pnpm so its executable can be resolved safely")
const candidateArgument = process.argv.find((argument) => argument.startsWith("--candidate="))
const baseSha = resolveQualityGateBase({
  candidateBase: candidateArgument?.slice("--candidate=".length),
  hostedBase: process.env.DALPH_COVERAGE_BASE_SHA
})
const result = await runPreflightCensus({
  gates: preflightQualityGates(baseSha),
  runStage: (gate) =>
    runBoundedCommand(boundedQualityGateCommand({ gate, nodeExecutable: process.execPath, pnpmEntryPoint }))
})
process.exitCode = result.succeeded ? 0 : 1
