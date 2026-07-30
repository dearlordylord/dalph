import { performance } from "node:perf_hooks"

import { quintGateRegressionBudgetMilliseconds } from "./quint-gate-policy.mjs"
import { runBoundedCommand } from "./run-bounded-command.mjs"

const pnpmEntryPoint = process.env.npm_execpath

if (pnpmEntryPoint === undefined) {
  throw new Error("Run this model gate through pnpm")
}

const run = async (name, args) => {
  process.stdout.write(`\n== ${name} ==\n`)
  await runBoundedCommand({
    args: [pnpmEntryPoint, "quint", ...args],
    executable: process.execPath,
    name,
    timeoutMilliseconds: quintGateRegressionBudgetMilliseconds
  })
}

const startedAt = performance.now()

await run("planned-attempt executor model typecheck", [
  "typecheck",
  "specs/plannedAttemptExecutor.qnt"
])
await run("planned-attempt executor deterministic tests", [
  "test",
  "specs/plannedAttemptExecutor_test.qnt",
  "--main",
  "plannedAttemptExecutorTest"
])
await run("planned-attempt executor sampled model", [
  "run",
  "specs/plannedAttemptExecutor.qnt",
  "--invariants",
  "everyStatusUsesExactPlannedAttempt",
  "positionHeldUntilSuspensionResult",
  "safeSuspensionReleasesPosition",
  "suspensionRequestRetainsPosition",
  "terminalReleasesPosition",
  "--witnesses",
  "responsibilityBeganReached",
  "runningReached",
  "suspensionRequestedReached",
  "safelySuspendedReached",
  "terminalReached",
  "--max-steps",
  "20",
  "--max-samples",
  "10000",
  "--verbosity",
  "1"
])
await run("planned-attempt executor exhaustive model", [
  "verify",
  "specs/plannedAttemptExecutor.qnt",
  "--invariants",
  "everyStatusUsesExactPlannedAttempt",
  "positionHeldUntilSuspensionResult",
  "safeSuspensionReleasesPosition",
  "suspensionRequestRetainsPosition",
  "terminalReleasesPosition",
  "--max-steps",
  "20",
  "--verbosity",
  "1"
])

const acceptedResultIntegrationInvariants = [
  "cancellationExactlyQueued",
  "queuePositionsAreUnique",
  "targetHeldExactlyStarted",
  "atMostOneTargetHolder",
  "startedPrecedesRemainingQueue",
  "dependencyWaitPreservesQueueOrder"
]

await run("accepted-result integration model typecheck", [
  "typecheck",
  "specs/acceptedResultIntegration.qnt"
])
await run("accepted-result integration deterministic tests", [
  "test",
  "specs/acceptedResultIntegration_test.qnt",
  "--main",
  "acceptedResultIntegrationTest"
])
await run("accepted-result integration sampled model", [
  "run",
  "specs/acceptedResultIntegration.qnt",
  "--invariants",
  ...acceptedResultIntegrationInvariants,
  "--witnesses",
  "acceptedReached",
  "queuedReached",
  "startedReached",
  "dependencyWaitReached",
  "restartReached",
  "dependencyWaitReleasedTarget",
  "--max-steps",
  "12",
  "--max-samples",
  "10000",
  "--verbosity",
  "1"
])
await run("accepted-result integration exhaustive model", [
  "verify",
  "specs/acceptedResultIntegration.qnt",
  "--backend",
  "tlc",
  "--invariants",
  ...acceptedResultIntegrationInvariants,
  "--max-steps",
  "12",
  "--verbosity",
  "1"
])

const elapsedMilliseconds = performance.now() - startedAt
process.stdout.write(
  `\nComplete planned-attempt executor model gate: ${
    (elapsedMilliseconds / 1000).toFixed(2)
  }s (budget ${quintGateRegressionBudgetMilliseconds / 1000}s)\n`
)
if (elapsedMilliseconds > quintGateRegressionBudgetMilliseconds) {
  throw new Error("Planned-attempt executor models exceeded their regression budget")
}
