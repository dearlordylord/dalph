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
  "everyReportCarriesPlannedAttempt",
  "continuationCountBounded",
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
  "continuationLimitReached",
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
  "everyReportCarriesPlannedAttempt",
  "continuationCountBounded",
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
  "typeOk"
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
// TLC checks the complete state graph: 476 generated / 175 distinct states,
// depth 10, ~0.7s (Quint 0.32.0, linux-aarch64). The graph is finite because
// `appliedCount` saturates in the spec; unbounded it diverged past 36M states.
// No --max-steps: a future regression shows as a diameter change, not truncation.
await run("control-direction application exhaustive model", [
  "verify",
  "specs/controlDirectionApplication.qnt",
  "--backend",
  "tlc",
  "--invariants",
  ...controlDirectionApplicationInvariants,
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
// TLC checks the complete state graph: 101 generated / 44 distinct states,
// depth 5, ~0.7s (Quint 0.32.0, linux-aarch64) — replacing a 7-step Apalache
// BMC with exhaustive checking. No --max-steps: TLC reports the diameter, so
// "is the bound binding" stops being a separate investigation.
await run("Git reconciliation exhaustive model", [
  "verify",
  "specs/gitReconciliation.qnt",
  "--backend",
  "tlc",
  "--step",
  "verificationStep",
  "--invariants",
  ...gitReconciliationInvariants,
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
// TLC checks the complete state graph: 4309 generated / 1890 distinct states,
// diameter 19, ~0.9s (Quint 0.32.0, linux-aarch64). A previous --max-steps 12
// truncated the check four levels short of the diameter; with no bound the
// whole graph is covered against all eight invariants and future growth shows
// up as a diameter change rather than silent truncation.
await run("accepted-result integration exhaustive model", [
  "verify",
  "specs/acceptedResultIntegration.qnt",
  "--backend",
  "tlc",
  "--invariants",
  ...acceptedResultIntegrationInvariants,
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
