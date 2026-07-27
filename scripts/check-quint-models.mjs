import { performance } from "node:perf_hooks"

import {
  quintGateRegressionBudgetMilliseconds,
  frontierModelBudgetMilliseconds,
  taskSessionModelBudgetMilliseconds
} from "./quint-gate-policy.mjs"
import { runBoundedCommand } from "./run-bounded-command.mjs"

const pnpmEntryPoint = process.env.npm_execpath

if (pnpmEntryPoint === undefined) {
  throw new Error("Run this model gate through pnpm")
}

const run = async (name, executable, args, timeoutMilliseconds) => {
  process.stdout.write(`\n== ${name} ==\n`)
  const startedAt = performance.now()
  await runBoundedCommand({ args, executable, name, timeoutMilliseconds })
  const elapsedMilliseconds = performance.now() - startedAt
  process.stdout.write(
    `${name} completed in ${(elapsedMilliseconds / 1000).toFixed(2)}s\n`
  )
  return elapsedMilliseconds
}

const remainingTaskSessionBudget = () =>
  Math.max(
    1,
    taskSessionModelBudgetMilliseconds - taskSessionElapsedMilliseconds
  )

const gateStartedAt = performance.now()
let taskSessionElapsedMilliseconds = 0

taskSessionElapsedMilliseconds += await run(
  "task-session model typecheck",
  process.execPath,
  [
    pnpmEntryPoint,
    "quint",
    "typecheck",
    "specs/taskWorkSessionRecovery.qnt"
  ],
  remainingTaskSessionBudget()
)
taskSessionElapsedMilliseconds += await run(
  "task-session deterministic tests",
  process.execPath,
  [
    pnpmEntryPoint,
    "quint",
    "test",
    "specs/taskWorkSessionRecovery_test.qnt",
    "--main",
    "taskWorkSessionRecoveryTest"
  ],
  remainingTaskSessionBudget()
)
taskSessionElapsedMilliseconds += await run(
  "task-session sampled model",
  process.execPath,
  [
    pnpmEntryPoint,
    "quint",
    "run",
    "specs/taskWorkSessionRecovery.qnt",
    "--invariants",
    "requestRequiresIntent",
    "everyRequestUsesStableIdentity",
    "everyRequestUsesStablePayload",
    "causalPredecessorsAreStable",
    "absenceAloneAuthorizesRepeat",
    "unreadableAndConflictNeverAuthorize",
    "establishmentRequiresMatchingReport",
    "lookupBoundIsRespected",
    "terminalOutcomeIsStable",
    "--witnesses",
    "intentReached",
    "requestReached",
    "absenceAuthorizedRepeatReached",
    "matchingReached",
    "outcomeReached",
    "unreadableBoundReached",
    "absenceBoundReached",
    "conflictReached",
    "crashRestartReached",
    "--max-steps",
    "40",
    "--max-samples",
    "10000",
    "--verbosity",
    "1"
  ],
  remainingTaskSessionBudget()
)

process.stdout.write(
  `\nTask-session model total: ${(taskSessionElapsedMilliseconds / 1000).toFixed(2)}s ` +
    `(budget ${taskSessionModelBudgetMilliseconds / 1000}s)\n`
)
if (taskSessionElapsedMilliseconds > taskSessionModelBudgetMilliseconds) {
  throw new Error(
    `Task-session models exceeded their ${taskSessionModelBudgetMilliseconds / 1000}-second regression budget`
  )
}

await run(
  "frontier recovery models",
  process.execPath,
  ["scripts/check-frontier-recovery-model.mjs"],
  frontierModelBudgetMilliseconds
)

const gateElapsedMilliseconds = performance.now() - gateStartedAt
process.stdout.write(
  `\nComplete Quint recovery gate: ${(gateElapsedMilliseconds / 1000).toFixed(2)}s ` +
    `(regression budget ${quintGateRegressionBudgetMilliseconds / 1000}s)\n`
)
if (gateElapsedMilliseconds > quintGateRegressionBudgetMilliseconds) {
  throw new Error(
    `Quint recovery gate exceeded its ${quintGateRegressionBudgetMilliseconds / 1000}-second regression budget`
  )
}
