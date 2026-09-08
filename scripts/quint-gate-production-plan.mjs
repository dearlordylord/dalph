import { plannedAttemptExecutorObligations } from "./quint-model-obligations.mjs"
import { quintGateFamilyConcurrency } from "./quint-gate-concurrency.mjs"

const plannedCommand = (name, args) => Object.freeze({ name, args: Object.freeze(args) })

/**
 * The first evaluator-using family in the production gate. Its deterministic
 * test owns cold evaluator installation and must settle before parallel work.
 */
export const plannedAttemptExecutorInitialFamily = Object.freeze({
  concurrency: quintGateFamilyConcurrency,
  serializedPrefix: 1,
  commands: Object.freeze([
    plannedCommand("planned-attempt executor deterministic tests", [
      "test",
      "specs/plannedAttemptExecutor_test.qnt",
      "--main",
      "plannedAttemptExecutorTest"
    ]),
    plannedCommand("planned-attempt executor negative mutation profile", [
      "test",
      "specs/plannedAttemptExecutor_negative_test.qnt",
      "--main",
      "plannedAttemptExecutorNegativeTest"
    ]),
    plannedCommand("planned-attempt executor sampled model", [
      "run",
      "specs/plannedAttemptExecutor.qnt",
      "--invariants",
      ...plannedAttemptExecutorObligations.invariants,
      "--witnesses",
      ...plannedAttemptExecutorObligations.witnesses,
      "--max-steps",
      "45",
      "--max-samples",
      "10000",
      "--verbosity",
      "1"
    ])
  ])
})
