import { runBoundedCommand } from "./run-bounded-command.mjs"
import { runPreflightCensus } from "./preflight-census.mjs"
import { baselineQualityGates, boundedQualityGateCommand } from "./quality-gate-stage-policy.mjs"

// Admitted lint must inspect formatter inputs without incremental result reuse.
process.env.DALPH_DPRINT_INCREMENTAL = "disabled"

const pnpmEntryPoint = process.env.npm_execpath
if (pnpmEntryPoint === undefined)
  throw new Error("Run the baseline through pnpm so its executable can be resolved safely")

const result = await runPreflightCensus({
  gates: baselineQualityGates(),
  runStage: (gate) =>
    runBoundedCommand(boundedQualityGateCommand({ gate, nodeExecutable: process.execPath, pnpmEntryPoint }))
})
process.exitCode = result.succeeded ? 0 : 1
