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

const controlDirectionApplicationInvariants = [
  "appliedDirectionIsOperatorInitiated",
  "applicationClaimsNoLaterEffects",
  "appliedCountIsNonNegative"
]

await run("control-direction application model typecheck", [
  "typecheck",
  "specs/controlDirectionApplication.qnt"
])
await run("control-direction application deterministic tests", [
  "test",
  "specs/controlDirectionApplication_test.qnt",
  "--main",
  "controlDirectionApplicationTest"
])
await run("control-direction application sampled model", [
  "run",
  "specs/controlDirectionApplication.qnt",
  "--invariants",
  ...controlDirectionApplicationInvariants,
  "--witnesses",
  "runPauseAppliedReached",
  "taskPauseAppliedReached",
  "taskUnpauseAppliedReached",
  "--max-steps",
  "8",
  "--max-samples",
  "5000",
  "--verbosity",
  "1"
])
await run("control-direction application exhaustive model", [
  "verify",
  "specs/controlDirectionApplication.qnt",
  "--invariants",
  ...controlDirectionApplicationInvariants,
  "--max-steps",
  "8",
  "--verbosity",
  "1"
])

const taskFactReconciliationInvariants = [
  "positionHeldUntilSafeSuspension",
  "changedFactsPreserveWip",
  "specificationOffersEveryExactChoice",
  "externalSuccessPreventsDuplicateDelivery",
  "externalSuccessReleasesOnlyAfterSafeSuspension",
  "externalSuccessSettlesAfterExactClaimRelease",
  "replacementClaimRequiresDirectionAndIntent",
  "replacementClaimIdentityIsFresh",
  "foreignClaimIsNeverChanged",
  "unreadableClaimCannotAuthorizeReplacement",
  "claimConstraintPreservesIndependentEligibility"
]

await run("task-fact reconciliation model typecheck", [
  "typecheck",
  "specs/taskFactReconciliation.qnt"
])
await run("task-fact reconciliation deterministic tests", [
  "test",
  "specs/taskFactReconciliation_test.qnt",
  "--main",
  "taskFactReconciliationTest"
])
await run("task-fact reconciliation sampled model", [
  "run",
  "specs/taskFactReconciliation.qnt",
  "--invariants",
  ...taskFactReconciliationInvariants,
  "--witnesses",
  "membershipWaitReached",
  "lifecycleWaitReached",
  "specificationChoicesReached",
  "externalSuccessSettledReached",
  "foreignClaimWaitReached",
  "missingClaimWaitReached",
  "unreadableClaimWaitReached",
  "replacementClaimObserved",
  "--max-steps",
  "12",
  "--max-samples",
  "10000",
  "--verbosity",
  "1"
])
await run("task-fact reconciliation exhaustive model", [
  "verify",
  "specs/taskFactReconciliation.qnt",
  "--invariants",
  ...taskFactReconciliationInvariants,
  "--max-steps",
  "12",
  "--verbosity",
  "1"
])

const gitReconciliationInvariants = [
  "compatibleTargetAdvanceDoesNotConstrainAttempt",
  "incompatibleRewriteConstrainsOnlyAffectedAttempt",
  "gitConstraintPreservesIndependentEligibility",
  "lostWorktreeNeverAuthorizesRepair",
  "registrationConflictNeverAuthorizesRepair",
  "positionHeldUntilSafeSuspension",
  "rejectedResultPreservesWorktree",
  "staleTargetNeverOverwrites",
  "ambiguousTargetNeverPromotes",
  "promotionRequiresExactExpectedHead",
  "unverifiedCandidateNeverPromotes"
]

await run("Git reconciliation model typecheck", [
  "typecheck",
  "specs/gitReconciliation.qnt"
])
await run("Git reconciliation deterministic tests", [
  "test",
  "specs/gitReconciliation_test.qnt",
  "--main",
  "gitReconciliationTest"
])
await run("Git reconciliation negative mutation profile", [
  "test",
  "specs/gitReconciliation_negative_test.qnt",
  "--main",
  "gitReconciliationNegativeTest"
])
await run("Git reconciliation sampled model", [
  "run",
  "specs/gitReconciliation.qnt",
  "--invariants",
  ...gitReconciliationInvariants,
  "--witnesses",
  "compatibleAdvanceReached",
  "targetRewriteWaitReached",
  "lostWorktreeWaitReached",
  "registrationConflictWaitReached",
  "independentTaskSelectedReached",
  "missingResultRejectedReached",
  "nonDescendantResultRejectedReached",
  "eligibleResultReached",
  "exactCompareAndSetReached",
  "staleTargetReconciliationReached",
  "ambiguousTargetRereadReached",
  "unverifiedCandidateRejectionReached",
  "--max-steps",
  "7",
  "--max-samples",
  "10000",
  "--verbosity",
  "1"
])
await run("Git reconciliation exhaustive model", [
  "verify",
  "specs/gitReconciliation.qnt",
  "--step",
  "verificationStep",
  "--invariants",
  ...gitReconciliationInvariants,
  "--max-steps",
  "7",
  "--verbosity",
  "1"
])

const acceptedResultIntegrationInvariants = [
  "cancellationExactlyQueued",
  "queuePositionsAreUnique",
  "targetHeldExactlyActiveIntegration",
  "atMostOneTargetHolder",
  "startedPrecedesRemainingQueue",
  "dependencyWaitPreservesQueueOrder",
  "candidateReadyHasExactOrderedParents",
  "sessionIdentityFixedAfterStart"
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
  "candidateReadyReached",
  "correctionRequiredReached",
  "correctionLimitReached",
  "continuationLimitReached",
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
  `\nComplete Quint model gate: ${
    (elapsedMilliseconds / 1000).toFixed(2)
  }s (budget ${quintGateRegressionBudgetMilliseconds / 1000}s)\n`
)
if (elapsedMilliseconds > quintGateRegressionBudgetMilliseconds) {
  throw new Error("Quint models exceeded their regression budget")
}
