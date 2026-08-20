import { performance } from "node:perf_hooks"

import { applicationExitCheckRegistry } from "./application-exit-model-registry.mjs"
import {
  acceptedResultIntegrationObligations,
  acceptedResultIntegrationQuarantineProofObligations,
  plannedAttemptExecutorObligations,
  runCancellationObligations,
  runActivationObligations,
  taskFactReconciliationObligations
} from "./quint-model-obligations.mjs"
import { quintGateRegressionBudgetMilliseconds } from "./quint-gate-policy.mjs"
import {
  apalacheVersion,
  assertCleanTemporalVerdict,
  assertTlcArtifactPrepared,
  assertViolatedTemporalVerdict,
  runPreparedTemporalCheck
} from "./quint-temporal-gate.mjs"
import { runBoundedCommand } from "./run-bounded-command.mjs"

const pnpmEntryPoint = process.env.npm_execpath

if (pnpmEntryPoint === undefined) {
  throw new Error("Run this model gate through pnpm")
}

const startedAt = performance.now()

const remainingBudgetMilliseconds = () =>
  Math.max(1, quintGateRegressionBudgetMilliseconds - (performance.now() - startedAt))

const run = async (name, args, options = {}) => {
  process.stdout.write(`\n== ${name} ==\n`)
  return runBoundedCommand({
    args: [pnpmEntryPoint, "quint", ...args],
    executable: process.execPath,
    name,
    timeoutMilliseconds: remainingBudgetMilliseconds(),
    ...options
  })
}

await run("planned-attempt executor model typecheck", ["typecheck", "specs/plannedAttemptExecutor.qnt"])
await run("planned-attempt executor deterministic tests", [
  "test",
  "specs/plannedAttemptExecutor_test.qnt",
  "--main",
  "plannedAttemptExecutorTest"
])
await run("planned-attempt executor negative mutation profile", [
  "test",
  "specs/plannedAttemptExecutor_negative_test.qnt",
  "--main",
  "plannedAttemptExecutorNegativeTest"
])
const plannedAttemptExecutorInvariants = plannedAttemptExecutorObligations.invariants
const plannedAttemptExecutorWitnesses = plannedAttemptExecutorObligations.witnesses
await run("planned-attempt executor sampled model", [
  "run",
  "specs/plannedAttemptExecutor.qnt",
  "--invariants",
  ...plannedAttemptExecutorInvariants,
  "--witnesses",
  ...plannedAttemptExecutorWitnesses,
  "--max-steps",
  "45",
  "--max-samples",
  "10000",
  "--verbosity",
  "1"
])
await runPreparedTemporalCheck({
  assertArtifactPrepared: () => assertTlcArtifactPrepared(),
  // Quint's TLC backend loads TLC from the Apalache distribution. On a cold
  // runner this existing default-backend verification prepares/downloads that
  // versioned artifact before the temporal command is allowed to start.
  prepareArtifact: () =>
    run("planned-attempt executor TLC artifact preparation", [
      "verify",
      "specs/plannedAttemptExecutor_proof.qnt",
      "--main",
      "plannedAttemptExecutorEvidenceProof",
      "--invariants",
      "evidenceProofTypeOk",
      "--max-steps",
      "1",
      "--apalache-version",
      apalacheVersion,
      "--verbosity",
      "1"
    ]),
  verifyTemporal: async () => {
    const property = "releasableEvidenceEventuallyReleasesPosition"
    const verdict = await run(
      `planned-attempt executor temporal ${property} (TLC)`,
      [
        "verify",
        "specs/plannedAttemptExecutor.qnt",
        "--backend",
        "tlc",
        "--apalache-version",
        apalacheVersion,
        "--step",
        "releasableEvidenceStep",
        "--temporal",
        property,
        "--verbosity",
        "1"
      ],
      { captureOutput: true }
    )
    assertCleanTemporalVerdict(verdict, property)
  }
})

{
  const property = "releasableEvidenceNeverReleasesPosition"
  const verdict = await run(
    `planned-attempt executor temporal mutant ${property} (TLC)`,
    [
      "verify",
      "specs/plannedAttemptExecutor_temporal_negative.qnt",
      "--main",
      "plannedAttemptExecutorTemporalNegative",
      "--backend",
      "tlc",
      "--apalache-version",
      apalacheVersion,
      "--step",
      "releasableEvidenceStep",
      "--temporal",
      property,
      "--verbosity",
      "1"
    ],
    { acceptedExitCodes: [1], captureOutput: true }
  )
  assertViolatedTemporalVerdict(verdict, property)
}

const plannedAttemptExecutorProofs = [
  {
    main: "plannedAttemptExecutorEvidenceProof",
    testMain: "plannedAttemptExecutorEvidenceProofTest",
    negativeTestMain: "plannedAttemptExecutorEvidenceProofNegativeTest",
    title: "planned-attempt executor evidence proof",
    maxSteps: "10",
    seed: "6511",
    invariants: [
      "everyCallHasDurableIntent",
      "directResponsesAndProjectionsStayDistinct",
      "settlementUsesExactOrdinalAndCorrelation",
      "freshStateProjectionNeverSettlesCommand",
      "oneReconciliationReadPerActivation",
      "ambiguousOrUnavailableEvidenceRetainsPosition",
      "positionReleasesOnlyForSafeOrTerminalEvidence",
      "evidenceProofTypeOk"
    ],
    witnesses: [
      "startIntentReached",
      "suspendIntentReached",
      "commandCalledReached",
      "responseLostReached",
      "directResponseReached",
      "commandProjectionReached",
      "unavailableProjectionReached",
      "recoveryActivatedReached",
      "directResponseSettledReached",
      "commandProjectionSettledReached",
      "freshSafeStateProjectionReached",
      "safePositionReleasedReached",
      "terminalPositionReleasedReached"
    ]
  },
  {
    main: "plannedAttemptExecutorStartBoundProof",
    testMain: "plannedAttemptExecutorStartBoundProofTest",
    negativeTestMain: "plannedAttemptExecutorStartBoundProofNegativeTest",
    title: "planned-attempt executor Start-bound proof",
    maxSteps: "18",
    seed: "6512",
    invariants: [
      "everyStartCallHasItsIntent",
      "everyStartSettlementUsesItsOrdinal",
      "lostResponsesStillConsumeStartBudget",
      "startLimitBlocksFourthCommand",
      "terminalStartReleasesPosition",
      "startProofTypeOk"
    ],
    witnesses: [
      "firstStartIntentReached",
      "thirdStartIntentReached",
      "startCalledReached",
      "startResponseLostReached",
      "directStartSettledReached",
      "projectedStartSettledReached",
      "thirdStartSettledReached",
      "terminalStartReached"
    ]
  },
  {
    main: "plannedAttemptExecutorSuspendBoundProof",
    testMain: "plannedAttemptExecutorSuspendBoundProofTest",
    negativeTestMain: "plannedAttemptExecutorSuspendBoundProofNegativeTest",
    title: "planned-attempt executor Suspend-bound proof",
    maxSteps: "24",
    seed: "6513",
    invariants: [
      "everySuspendCallHasItsIntent",
      "everySuspendSettlementUsesItsOrdinal",
      "lostResponsesStillConsumeSuspendBudget",
      "suspendLimitBlocksFourthCommand",
      "postLimitRecoveryIsReadOnly",
      "positionReleasesOnlyForSafeOrTerminalEvidence",
      "suspendProofTypeOk"
    ],
    witnesses: [
      "firstSuspendIntentReached",
      "thirdSuspendIntentReached",
      "suspendCalledReached",
      "suspendResponseLostReached",
      "directSuspendSettledReached",
      "projectedSuspendSettledReached",
      "thirdSuspendSettledReached",
      "safeSuspendReached",
      "terminalSuspendReached",
      "readOnlyRecoveryReached",
      "readOnlySafeReached"
    ]
  }
]

await run("planned-attempt executor proof projection typecheck", [
  "typecheck",
  "specs/plannedAttemptExecutor_proof.qnt"
])
for (const proof of plannedAttemptExecutorProofs) {
  await run(`${proof.title} deterministic tests`, [
    "test",
    "specs/plannedAttemptExecutor_proof_test.qnt",
    "--main",
    proof.testMain
  ])
  await run(`${proof.title} negative mutation profile`, [
    "test",
    "specs/plannedAttemptExecutor_proof_negative_test.qnt",
    "--main",
    proof.negativeTestMain
  ])
  await run(`${proof.title} sampled model`, [
    "run",
    "specs/plannedAttemptExecutor_proof.qnt",
    "--main",
    proof.main,
    "--invariants",
    ...proof.invariants,
    "--witnesses",
    ...proof.witnesses,
    "--max-steps",
    proof.maxSteps,
    "--max-samples",
    "5000",
    "--seed",
    proof.seed,
    "--verbosity",
    "1"
  ])
  // TLC enumerates each complete finite projection graph without a depth
  // token: evidence 109 generated / 45 distinct / depth 8; Start 55 / 52 /
  // depth 16; Suspend 79 / 76 / depth 19 (Quint 0.32.0, linux-aarch64).
  await run(`${proof.title} exhaustive model`, [
    "verify",
    "specs/plannedAttemptExecutor_proof.qnt",
    "--main",
    proof.main,
    "--backend",
    "tlc",
    "--invariants",
    ...proof.invariants,
    "--verbosity",
    "1"
  ])
}

const applicationExitCheck = applicationExitCheckRegistry.canonical

await run("application Exit model typecheck", ["typecheck", applicationExitCheck.file])
await run("application Exit deterministic tests", [
  "test",
  applicationExitCheck.testFile,
  "--main",
  applicationExitCheck.testMain
])
await run("application Exit negative mutation profile", [
  "test",
  applicationExitCheck.negativeTestFile,
  "--main",
  applicationExitCheck.negativeTestMain
])
await run("application Exit sampled model", [
  "run",
  applicationExitCheck.file,
  "--invariants",
  ...applicationExitCheck.invariants,
  "--witnesses",
  ...applicationExitCheck.witnesses,
  "--max-steps",
  applicationExitCheck.maxSteps,
  "--max-samples",
  applicationExitCheck.maxSamples,
  "--seed",
  applicationExitCheck.seed,
  "--verbosity",
  "1"
])

// The canonical state product deliberately keeps the two owners, two executor
// attempts, five ticks, drain resources, process endings, and restart in one
// production-backed model. ADR 0010 permits these smaller acyclic projections
// to own complete enumeration while the canonical model retains behavior.
await run("application Exit proof projection typecheck", ["typecheck", applicationExitCheckRegistry.proofFile])
for (const proof of applicationExitCheckRegistry.proofs) {
  await run(`${proof.title} deterministic tests`, [
    "test",
    applicationExitCheckRegistry.proofTestFile,
    "--main",
    proof.testMain
  ])
  await run(`${proof.title} negative mutation profile`, [
    "test",
    applicationExitCheckRegistry.proofNegativeTestFile,
    "--main",
    proof.negativeTestMain
  ])
  await run(`${proof.title} sampled model`, [
    "run",
    applicationExitCheckRegistry.proofFile,
    "--main",
    proof.main,
    "--invariants",
    ...proof.invariants,
    "--witnesses",
    ...proof.witnesses,
    "--max-steps",
    proof.maxSteps,
    "--max-samples",
    proof.maxSamples,
    "--seed",
    proof.seed,
    "--verbosity",
    "1"
  ])
  // Each finite projection graph is completely enumerated without a depth
  // token. A future diameter increase therefore remains visible to the gate.
  await run(`${proof.title} exhaustive model`, [
    "verify",
    applicationExitCheckRegistry.proofFile,
    "--main",
    proof.main,
    "--backend",
    "tlc",
    "--invariants",
    ...proof.invariants,
    "--verbosity",
    "1"
  ])
}

const controlDirectionApplicationInvariants = [
  "appliedDirectionIsOperatorInitiated",
  "applicationClaimsNoLaterEffects",
  "rejectedTaskControlPreservesPauseState",
  "typeOk"
]

await run("control-direction application model typecheck", ["typecheck", "specs/controlDirectionApplication.qnt"])
await run("control-direction application deterministic tests", [
  "test",
  "specs/controlDirectionApplication_test.qnt",
  "--main",
  "controlDirectionApplicationTest"
])
await run("control-direction application negative mutation profile", [
  "test",
  "specs/controlDirectionApplication_negative_test.qnt",
  "--main",
  "controlDirectionApplicationNegativeTest"
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
  "staleTaskRejectedReached",
  "unreadableMembershipReached",
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

const runActivationInvariants = runActivationObligations.invariants
const runActivationWitnesses = runActivationObligations.witnesses

await run("Run activation model typecheck", ["typecheck", "specs/runActivation.qnt"])
await run("Run activation deterministic tests", ["test", "specs/runActivation_test.qnt", "--main", "runActivationTest"])
await run("Run activation negative mutation profile", [
  "test",
  "specs/runActivation_negative_test.qnt",
  "--main",
  "runActivationNegativeTest"
])
await run("Run activation sampled model", [
  "run",
  "specs/runActivation.qnt",
  "--invariants",
  ...runActivationInvariants,
  "--witnesses",
  ...runActivationWitnesses,
  "--max-steps",
  "28",
  "--max-samples",
  "10000",
  "--verbosity",
  "1"
])
// TLC checks the complete finite state graph without a depth token. The model
// bounds process loss and activation cycles explicitly, so a future diameter
// increase remains visible instead of being truncated by the gate.
await run("Run activation exhaustive model", [
  "verify",
  "specs/runActivation.qnt",
  "--backend",
  "tlc",
  "--invariants",
  ...runActivationInvariants,
  "--verbosity",
  "1"
])

const runCancellationInvariants = runCancellationObligations.invariants
const runCancellationWitnesses = runCancellationObligations.witnesses

await run("Run cancellation model typecheck", ["typecheck", "specs/runCancellation.qnt"])
await run("Run cancellation deterministic tests", [
  "test",
  "specs/runCancellation_test.qnt",
  "--main",
  "runCancellationTest"
])
await run("Run cancellation negative mutation profile", [
  "test",
  "specs/runCancellation_negative_test.qnt",
  "--main",
  "runCancellationNegativeTest"
])
await run("Run cancellation sampled model", [
  "run",
  "specs/runCancellation.qnt",
  "--invariants",
  ...runCancellationInvariants,
  "--witnesses",
  ...runCancellationWitnesses,
  "--max-steps",
  "45",
  "--max-samples",
  "10000",
  "--seed",
  "102",
  "--verbosity",
  "1"
])
// TLC enumerates this finite cancellation boundary without a depth token;
// every counter is explicitly bounded in the model so an accidental new
// retry cycle changes the complete state graph rather than being truncated.
await run("Run cancellation exhaustive model", [
  "verify",
  "specs/runCancellation.qnt",
  "--backend",
  "tlc",
  "--invariants",
  ...runCancellationInvariants,
  "--verbosity",
  "1"
])

const taskFactReconciliationInvariants = taskFactReconciliationObligations.invariants
const taskFactReconciliationWitnesses = taskFactReconciliationObligations.witnesses

await run("task-fact reconciliation model typecheck", ["typecheck", "specs/taskFactReconciliation.qnt"])
await run("task-fact reconciliation deterministic tests", [
  "test",
  "specs/taskFactReconciliation_test.qnt",
  "--main",
  "taskFactReconciliationTest"
])
await run("task-fact reconciliation negative mutation profile", [
  "test",
  "specs/taskFactReconciliation_negative_test.qnt",
  "--main",
  "taskFactReconciliationNegativeTest"
])
await run("task-fact reconciliation sampled model", [
  "run",
  "specs/taskFactReconciliation.qnt",
  "--invariants",
  ...taskFactReconciliationInvariants,
  "--witnesses",
  ...taskFactReconciliationWitnesses,
  "--max-steps",
  "55",
  "--max-samples",
  "10000",
  "--verbosity",
  "1"
])

// The canonical subject model deliberately keeps #136/#137 task facts and the
// #65 choice, stoppage, claim-disposition, and independent-task sentinels
// together. Its production-backed MBT and sampled run stay canonical. ADR 0010
// permits the following smaller projection of the same accepted #65 chronology
// to own exhaustive proof without becoming another runtime behavior source.
const taskFactProofs = [
  {
    main: "taskFactChoiceProof",
    testMain: "taskFactChoiceProofTest",
    negativeTestMain: "taskFactChoiceProofNegativeTest",
    title: "task-fact choice proof",
    maxSteps: "18",
    seed: "6501",
    invariants: [
      "firstChoiceAndExactRedeliveryAreIdempotent",
      "requestIdentityErrorsStayDistinct",
      "continueUsesSixFreshReadsForImmutableP",
      "laterF3RequiresItsOwnChoiceAndFreshReads",
      "postCutoffChoiceHasNoDownstreamEffect",
      "choiceProofTypeOk"
    ],
    witnesses: [
      "exactRedeliveryReached",
      "bothIdentityErrorsReached",
      "stopWinnerReached",
      "immutableAttemptPResumedReached",
      "continueF3Reached",
      "postCutoffContinueRejectionReached",
      "postCutoffStopRejectionReached"
    ]
  },
  {
    main: "taskFactStopProof",
    testMain: "taskFactStopProofTest",
    negativeTestMain: "taskFactStopProofNegativeTest",
    title: "task-fact Stop proof",
    maxSteps: "22",
    seed: "6502",
    invariants: [
      "stopCallsFollowExactDurableIntents",
      "stoppageAndRecoveryAreBounded",
      "thirdRunningResultLeavesOnlyReadOnlyRecovery",
      "abandonmentRequiresExactUnbrokenQuiescence",
      "unprovedWriterRetainsPositionAndClaim",
      "stopPreservesArtifactsAndNeverIntegrates",
      "readOnlyRecoveryIssuesNoFourthCommand"
    ],
    witnesses: [
      "retainedSafeProofAbandonedReached",
      "ambiguousSafeProjectionReached",
      "thirdRunningProjectionReached",
      "readOnlySafeRecoveryReached"
    ]
  },
  {
    main: "taskFactClaimProof",
    testMain: "taskFactClaimProofTest",
    negativeTestMain: "taskFactClaimProofNegativeTest",
    title: "task-fact stopped-claim proof",
    maxSteps: "18",
    seed: "6503",
    invariants: [
      "claimChangesOnlyAfterAbandonmentExactReadAndIntent",
      "absentForeignUnreadableClaimsAreNeverMutated",
      "unreadableClaimRetainsSeparateResponsibility",
      "claimReleaseIsBoundedAndReconciled",
      "unrelatedTaskRemainsEligible"
    ],
    witnesses: [
      "exactReleaseReached",
      "absentDispositionReached",
      "foreignDispositionReached",
      "unreadableDispositionReached",
      "ambiguousReleaseSettledReached",
      "laterReadAfterAmbiguityReached",
      "unrelatedTaskSelectedReached"
    ]
  }
]

await run("task-fact proof projection typecheck", ["typecheck", "specs/taskFactReconciliation_proof.qnt"])
for (const proof of taskFactProofs) {
  await run(`${proof.title} deterministic tests`, [
    "test",
    "specs/taskFactReconciliation_proof_test.qnt",
    "--main",
    proof.testMain
  ])
  await run(`${proof.title} negative mutation profile`, [
    "test",
    "specs/taskFactReconciliation_proof_negative_test.qnt",
    "--main",
    proof.negativeTestMain
  ])
  await run(`${proof.title} sampled model`, [
    "run",
    "specs/taskFactReconciliation_proof.qnt",
    "--main",
    proof.main,
    "--invariants",
    ...proof.invariants,
    "--witnesses",
    ...proof.witnesses,
    "--max-steps",
    proof.maxSteps,
    "--max-samples",
    "5000",
    "--seed",
    proof.seed,
    "--verbosity",
    "1"
  ])
  // TLC enumerates the complete finite projection graph with no depth token:
  // choice 261 generated / 152 distinct / depth 14; Stop 42 / 36 / depth 20;
  // claim 440 / 279 / depth 16 (Quint 0.32.0, linux-aarch64).
  await run(`${proof.title} exhaustive model`, [
    "verify",
    "specs/taskFactReconciliation_proof.qnt",
    "--main",
    proof.main,
    "--backend",
    "tlc",
    "--invariants",
    ...proof.invariants,
    "--verbosity",
    "1"
  ])
}

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
  "unqualifiedCandidateNeverPromotes",
  "prePromotionBlockerPreservesCandidate",
  "prePromotionBlockerReleasesTarget",
  "postPromotionBlockerPreservesProof",
  "postPromotionBlockerNeverRollsBack",
  "clearedPromotionRequiresFreshAncestry",
  "clearedPromotionNeverReintegrates",
  "incompleteFactsReleaseTarget",
  "oneSuccessorRequiresDurableSupersession",
  "onePriorSessionHasOneSupersession",
  "successorIdentityUsesOwnSessionChain",
  "completionRacePreservesAcceptedCompletion",
  "completionWarningIsDerivedOnly"
]

await run("Git reconciliation model typecheck", ["typecheck", "specs/gitReconciliation.qnt"])
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
  "--step",
  "gitReconciliationStep",
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
  "unqualifiedCandidateRejectionReached",
  "prePromotionBlockerReached",
  "prePromotionRereadReached",
  "unrelatedSupersessionReached",
  "sessionSupersessionReached",
  "successorStartedReached",
  "postPromotionBlockerReached",
  "promotedAncestryProvenReached",
  "completionAuthorizedReached",
  "completionAcceptedReached",
  "completionWarningReached",
  "incompleteFactsWaitReached",
  "--max-steps",
  "24",
  "--max-samples",
  "5000",
  "--seed",
  "6511",
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
  "gitReconciliationStep",
  "--invariants",
  ...gitReconciliationInvariants,
  "--verbosity",
  "1"
])

const acceptedResultIntegrationInvariants = acceptedResultIntegrationObligations.invariants
const acceptedResultIntegrationWitnesses = acceptedResultIntegrationObligations.witnesses
const acceptedResultIntegrationQuarantineProofInvariants =
  acceptedResultIntegrationQuarantineProofObligations.invariants
const acceptedResultIntegrationQuarantineProofWitnesses = acceptedResultIntegrationQuarantineProofObligations.witnesses

await run("accepted-result integration model typecheck", ["typecheck", "specs/acceptedResultIntegration.qnt"])
await run("accepted-result integration deterministic tests", [
  "test",
  "specs/acceptedResultIntegration_test.qnt",
  "--main",
  "acceptedResultIntegrationTest"
])
await run("accepted-result integration negative mutation profile", [
  "test",
  "specs/acceptedResultIntegration_negative_test.qnt",
  "--main",
  "acceptedResultIntegrationNegativeTest"
])
await run("accepted-result integration sampled model", [
  "run",
  "specs/acceptedResultIntegration.qnt",
  "--invariants",
  ...acceptedResultIntegrationInvariants,
  "--witnesses",
  ...acceptedResultIntegrationWitnesses,
  "--max-steps",
  "35",
  "--max-samples",
  "10000",
  "--verbosity",
  "1"
])
// The canonical model retains the full accepted-result vocabulary, collected
// scenarios, and sampled obligations. Its issue #68 quarantine product is
// exhaustively enumerated by the subject-scoped projection below, as allowed
// by ADR 0010.
await run("accepted-result integration quarantine proof typecheck", [
  "typecheck",
  "specs/acceptedResultIntegration_proof.qnt"
])
await run("accepted-result integration quarantine proof deterministic tests", [
  "test",
  "specs/acceptedResultIntegration_proof_test.qnt",
  "--main",
  "acceptedResultIntegrationQuarantineProofTest"
])
await run("accepted-result integration quarantine proof negative mutation profile", [
  "test",
  "specs/acceptedResultIntegration_proof_negative_test.qnt",
  "--main",
  "acceptedResultIntegrationQuarantineProofNegativeTest"
])
await run("accepted-result integration quarantine proof sampled model", [
  "run",
  "specs/acceptedResultIntegration_proof.qnt",
  "--invariants",
  ...acceptedResultIntegrationQuarantineProofInvariants,
  "--witnesses",
  ...acceptedResultIntegrationQuarantineProofWitnesses,
  "--max-steps",
  "24",
  "--max-samples",
  "5000",
  "--seed",
  "6801",
  "--verbosity",
  "1"
])
// TLC checks the complete finite projection graph. No --max-steps is used:
// future growth shows up as a diameter change rather than silent truncation.
await run("accepted-result integration quarantine proof exhaustive model", [
  "verify",
  "specs/acceptedResultIntegration_proof.qnt",
  "--main",
  "acceptedResultIntegrationQuarantineProof",
  "--backend",
  "tlc",
  "--invariants",
  ...acceptedResultIntegrationQuarantineProofInvariants,
  "--verbosity",
  "1"
])

const integrationFinalityInvariants = [
  "exactProofAndBinding",
  "completionClaimRequiresExactPromotionProof",
  "completionProofCarriesAcceptedEvidenceAndNoReturnedRefs",
  "noLegacyEvidenceAuthorizesFinality",
  "clearedPromotionRequiresFreshAncestry",
  "replacementIntentPrecedesRequest",
  "deletionIntentPrecedesRequest",
  "replacementRereadPrecedesRetry",
  "deletionRereadPrecedesRetry",
  "completionClaimRequestsAreBounded",
  "completionClaimDeletionRequestsAreBounded",
  "completionIntentPrecedesRequest",
  "completionAttemptIntentPrecedesRequest",
  "completionRequestsAreBoundedForIssue61",
  "completionRetryRequiresExactRequestLookup",
  "completionLookupRequiresPostLossConfirmation",
  "completionRequestUsesExactPremises",
  "completionAcknowledgementIsApplied",
  "focusedSuccessRequiresCompletionObservation",
  "trackerSuccessRequiresFocusedObservation",
  "humanFocusedSuccessIsAccepted",
  "dependantReleaseRequiresLaterCompleteGraph",
  "foreignClaimIsNeverMutated",
  "noReintegration",
  "successfulTaskNeverReopens",
  "freshTrackerSuccessPrecedesCompletionClaimDeletion",
  "completionClaimDeletionTargetsExactClaim",
  "currentCompletionClaimIsExact",
  "settledTaskRequiresExactCleanup",
  "subjectSettlementIsLocal",
  "emptyFrontierDoesNotSettleRetainedResponsibility",
  "runTerminationRemainsOwnedByIssue102",
  "dependantReleaseBoundaryRemainsExternal"
]

await run("integration finality model typecheck", ["typecheck", "specs/integrationFinality.qnt"])
await run("integration finality deterministic tests", [
  "test",
  "specs/integrationFinality_test.qnt",
  "--main",
  "integrationFinalityTest"
])
await run("integration finality negative mutation profile", [
  "test",
  "specs/integrationFinality_negative_test.qnt",
  "--main",
  "integrationFinalityNegativeTest"
])
await run("integration finality sampled model", [
  "run",
  "specs/integrationFinality.qnt",
  "--invariants",
  ...integrationFinalityInvariants,
  "--witnesses",
  "promotedProofReached",
  "blockerWaitReached",
  "postPromotionAncestryPendingReached",
  "postPromotionAncestryWaitReached",
  "postPromotionAncestryReached",
  "replacementIntentPendingReached",
  "replacementIntentReached",
  "replacementRequestedReached",
  "replacementResponseLostReached",
  "replacementRetryReadyReached",
  "replacementWaitReached",
  "replacementExhaustedReached",
  "completionClaimCurrentReached",
  "completionFactsReached",
  "completionAncestryReached",
  "completionEvidenceReached",
  "completionIntentReached",
  "completionAttemptIntentReached",
  "completionRequestedReached",
  "completionResponseLostReached",
  "completionConfirmationReached",
  "completionAcknowledgedReached",
  "completionRetryReadyReached",
  "completionWaitReached",
  "trackerSuccessReached",
  "focusedCompletionSuccessReached",
  "humanSuccessWithAbsentClaimReached",
  "humanSuccessWithForeignClaimReached",
  "completeGraphBlockedReached",
  "completeGraphReleasedReached",
  "deleteIntentReached",
  "deleteRequestedReached",
  "deleteResponseLostReached",
  "deleteRetryReadyReached",
  "deleteResponseObservedReached",
  "cleanupWaitReached",
  "settledReached",
  "emptyFrontierReached",
  "unrelatedResponsibilityReached",
  "--max-steps",
  "35",
  "--max-samples",
  "10000",
  "--verbosity",
  "1"
])
await run("integration finality exhaustive model", [
  "verify",
  "specs/integrationFinality.qnt",
  "--backend",
  "tlc",
  "--invariants",
  ...integrationFinalityInvariants,
  "--verbosity",
  "1"
])

const elapsedMilliseconds = performance.now() - startedAt
process.stdout.write(
  `\nComplete Quint model gate: ${(elapsedMilliseconds / 1000).toFixed(
    2
  )}s (budget ${quintGateRegressionBudgetMilliseconds / 1000}s)\n`
)
if (elapsedMilliseconds > quintGateRegressionBudgetMilliseconds) {
  throw new Error("Quint models exceeded their regression budget")
}
