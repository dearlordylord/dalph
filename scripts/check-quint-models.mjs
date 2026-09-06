import { createRequire } from "node:module"
import { performance } from "node:perf_hooks"

import { applicationExitCheckRegistry } from "./application-exit-model-registry.mjs"
import {
  acceptedResultIntegrationObligations,
  acceptedResultIntegrationQuarantineProofObligations,
  freshTaskAdmissionObligations,
  freshTaskAdmissionProofObligations,
  plannedAttemptExecutorObligations,
  plannedAttemptExecutorProofObligations,
  runCancellationObligations,
  runActivationObligations,
  taskFactReconciliationObligations
} from "./quint-model-obligations.mjs"
import { quintGateRegressionBudgetMilliseconds, quintGateSafetyTimeoutMilliseconds } from "./quint-gate-policy.mjs"
import {
  apalacheVersion,
  assertCleanTemporalVerdict,
  assertTlcArtifactPrepared,
  assertViolatedTemporalVerdict,
  runPreparedTemporalCheck
} from "./quint-temporal-gate.mjs"
import { runBoundedCommand } from "./run-bounded-command.mjs"

if (process.env.npm_execpath === undefined) {
  throw new Error("Run this model gate through pnpm")
}

const quintEntryPoint = createRequire(import.meta.url).resolve("@informalsystems/quint/dist/src/cli.js")

const startedAt = performance.now()
const completedStageTimings = []

const remainingSafetyTimeoutMilliseconds = () =>
  Math.max(1, quintGateSafetyTimeoutMilliseconds - (performance.now() - startedAt))

const run = async (name, args, options = {}) => {
  process.stdout.write(`\n== ${name} ==\n`)
  const stageStartedAt = performance.now()
  const result = await runBoundedCommand({
    args: [quintEntryPoint, ...args],
    executable: process.execPath,
    name,
    timeoutMilliseconds: remainingSafetyTimeoutMilliseconds(),
    ...options
  })
  completedStageTimings.push({ elapsedMilliseconds: Number((performance.now() - stageStartedAt).toFixed(2)), name })
  return result
}

// Collected tests are exact chronological examples or mutation witnesses.
// Unconstrained random exploration belongs in a separately named sampled-test
// stage with its own budget.
const runCollectedTest = async (name, args, seed) => run(name, ["test", ...args, "--max-samples", "1", "--seed", seed])

const canonicalCollectedTestSeeds = Object.freeze({
  plannedAttemptExecutor: Object.freeze({ deterministic: "26401", negative: "26402" }),
  applicationExit: Object.freeze({ deterministic: "20301", negative: "20302" }),
  controlDirectionApplication: Object.freeze({ deterministic: "65001", negative: "65002" }),
  runActivation: Object.freeze({ deterministic: "21801", negative: "21802" }),
  freshTaskAdmission: Object.freeze({ deterministic: "31501", negative: "31502" }),
  runCancellation: Object.freeze({ deterministic: "10201", negative: "10202" }),
  taskFactReconciliation: Object.freeze({ deterministic: "13601", negative: "13602" }),
  gitReconciliation: Object.freeze({ deterministic: "69001", negative: "69002" }),
  acceptedResultIntegration: Object.freeze({ deterministic: "68001", negative: "68002" }),
  acceptedResultIntegrationQuarantineProof: Object.freeze({ deterministic: "680101", negative: "680102" }),
  integrationFinality: Object.freeze({ deterministic: "61001", negative: "61002" })
})

await run("planned-attempt executor model typecheck", ["typecheck", "specs/plannedAttemptExecutor.qnt"])
await runCollectedTest(
  "planned-attempt executor deterministic tests",
  ["specs/plannedAttemptExecutor_test.qnt", "--main", "plannedAttemptExecutorTest"],
  canonicalCollectedTestSeeds.plannedAttemptExecutor.deterministic
)
await runCollectedTest(
  "planned-attempt executor negative mutation profile",
  ["specs/plannedAttemptExecutor_negative_test.qnt", "--main", "plannedAttemptExecutorNegativeTest"],
  canonicalCollectedTestSeeds.plannedAttemptExecutor.negative
)
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
    maxSteps: "16",
    seed: "6511",
    invariants: plannedAttemptExecutorProofObligations.evidence.invariants,
    witnesses: plannedAttemptExecutorProofObligations.evidence.witnesses
  },
  {
    main: "plannedAttemptExecutorSuspendBoundProof",
    testMain: "plannedAttemptExecutorSuspendBoundProofTest",
    negativeTestMain: "plannedAttemptExecutorSuspendBoundProofNegativeTest",
    title: "planned-attempt executor Suspend-bound proof",
    maxSteps: "24",
    seed: "6513",
    invariants: plannedAttemptExecutorProofObligations.suspendBound.invariants,
    witnesses: plannedAttemptExecutorProofObligations.suspendBound.witnesses
  }
]

await run("planned-attempt executor proof projection typecheck", [
  "typecheck",
  "specs/plannedAttemptExecutor_proof.qnt"
])
for (const proof of plannedAttemptExecutorProofs) {
  await runCollectedTest(
    `${proof.title} deterministic tests`,
    ["specs/plannedAttemptExecutor_proof_test.qnt", "--main", proof.testMain],
    `${proof.seed}01`
  )
  await runCollectedTest(
    `${proof.title} negative mutation profile`,
    ["specs/plannedAttemptExecutor_proof_negative_test.qnt", "--main", proof.negativeTestMain],
    `${proof.seed}02`
  )
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
  // TLC enumerates each complete finite projection graph without imposing the
  // sampled runner's depth bound; sampled exploration above remains a separate
  // seeded check of longer traces.
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
await runCollectedTest(
  "application Exit deterministic tests",
  [applicationExitCheck.testFile, "--main", applicationExitCheck.testMain],
  canonicalCollectedTestSeeds.applicationExit.deterministic
)
await runCollectedTest(
  "application Exit negative mutation profile",
  [applicationExitCheck.negativeTestFile, "--main", applicationExitCheck.negativeTestMain],
  canonicalCollectedTestSeeds.applicationExit.negative
)
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
  await runCollectedTest(
    `${proof.title} deterministic tests`,
    [applicationExitCheckRegistry.proofTestFile, "--main", proof.testMain],
    `${proof.seed}01`
  )
  await runCollectedTest(
    `${proof.title} negative mutation profile`,
    [applicationExitCheckRegistry.proofNegativeTestFile, "--main", proof.negativeTestMain],
    `${proof.seed}02`
  )
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
await runCollectedTest(
  "control-direction application deterministic tests",
  ["specs/controlDirectionApplication_test.qnt", "--main", "controlDirectionApplicationTest"],
  canonicalCollectedTestSeeds.controlDirectionApplication.deterministic
)
await runCollectedTest(
  "control-direction application negative mutation profile",
  ["specs/controlDirectionApplication_negative_test.qnt", "--main", "controlDirectionApplicationNegativeTest"],
  canonicalCollectedTestSeeds.controlDirectionApplication.negative
)
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
await runCollectedTest(
  "Run activation deterministic tests",
  ["specs/runActivation_test.qnt", "--main", "runActivationTest"],
  canonicalCollectedTestSeeds.runActivation.deterministic
)
await runCollectedTest(
  "Run activation negative mutation profile",
  ["specs/runActivation_negative_test.qnt", "--main", "runActivationNegativeTest"],
  canonicalCollectedTestSeeds.runActivation.negative
)
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

const freshTaskAdmissionInvariants = freshTaskAdmissionObligations.invariants
const freshTaskAdmissionWitnesses = freshTaskAdmissionObligations.witnesses

await run("fresh-task admission model typecheck", ["typecheck", "specs/freshTaskAdmission.qnt"])
await runCollectedTest(
  "fresh-task admission deterministic tests",
  ["specs/freshTaskAdmission_test.qnt", "--main", "freshTaskAdmissionTest"],
  canonicalCollectedTestSeeds.freshTaskAdmission.deterministic
)
await runCollectedTest(
  "fresh-task admission negative mutation profile",
  ["specs/freshTaskAdmission_negative_test.qnt", "--main", "freshTaskAdmissionNegativeTest"],
  canonicalCollectedTestSeeds.freshTaskAdmission.negative
)
await run("fresh-task admission sampled model", [
  "run",
  "specs/freshTaskAdmission.qnt",
  "--invariants",
  ...freshTaskAdmissionInvariants,
  "--witnesses",
  ...freshTaskAdmissionWitnesses,
  "--max-steps",
  "45",
  "--max-samples",
  "10000",
  "--seed",
  "315",
  "--verbosity",
  "1"
])
await run("fresh-task admission proof projection typecheck", ["typecheck", "specs/freshTaskAdmission_proof.qnt"])
const freshTaskAdmissionProofs = [
  {
    key: "capacity",
    title: "fresh-task admission capacity proof",
    main: "freshTaskAdmissionCapacityProof",
    testMain: "freshTaskAdmissionCapacityProofTest",
    negativeTestMain: "freshTaskAdmissionCapacityProofNegativeTest",
    maxSteps: "20",
    seed: "3151"
  },
  {
    key: "ambiguity",
    title: "fresh-task admission ambiguity proof",
    main: "freshTaskAdmissionAmbiguityProof",
    testMain: "freshTaskAdmissionAmbiguityProofTest",
    negativeTestMain: "freshTaskAdmissionAmbiguityProofNegativeTest",
    maxSteps: "36",
    seed: "3152"
  }
]
for (const proof of freshTaskAdmissionProofs) {
  const obligations = freshTaskAdmissionProofObligations[proof.key]
  await runCollectedTest(
    `${proof.title} deterministic tests`,
    ["specs/freshTaskAdmission_proof_test.qnt", "--main", proof.testMain],
    `${proof.seed}01`
  )
  await runCollectedTest(
    `${proof.title} negative mutation profile`,
    ["specs/freshTaskAdmission_proof_negative_test.qnt", "--main", proof.negativeTestMain],
    `${proof.seed}02`
  )
  await run(`${proof.title} sampled model`, [
    "run",
    "specs/freshTaskAdmission_proof.qnt",
    "--main",
    proof.main,
    "--invariants",
    ...obligations.invariants,
    "--witnesses",
    ...obligations.witnesses,
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
  // token; the canonical five-task model retains the richer sampled behavior.
  await run(`${proof.title} exhaustive model`, [
    "verify",
    "specs/freshTaskAdmission_proof.qnt",
    "--main",
    proof.main,
    "--backend",
    "tlc",
    "--invariants",
    ...obligations.invariants,
    "--verbosity",
    "1"
  ])
}

const runCancellationInvariants = runCancellationObligations.invariants
const runCancellationWitnesses = runCancellationObligations.witnesses

await run("Run cancellation model typecheck", ["typecheck", "specs/runCancellation.qnt"])
await runCollectedTest(
  "Run cancellation deterministic tests",
  ["specs/runCancellation_test.qnt", "--main", "runCancellationTest"],
  canonicalCollectedTestSeeds.runCancellation.deterministic
)
await runCollectedTest(
  "Run cancellation negative mutation profile",
  ["specs/runCancellation_negative_test.qnt", "--main", "runCancellationNegativeTest"],
  canonicalCollectedTestSeeds.runCancellation.negative
)
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
await runCollectedTest(
  "task-fact reconciliation deterministic tests",
  ["specs/taskFactReconciliation_test.qnt", "--main", "taskFactReconciliationTest"],
  canonicalCollectedTestSeeds.taskFactReconciliation.deterministic
)
await runCollectedTest(
  "task-fact reconciliation negative mutation profile",
  ["specs/taskFactReconciliation_negative_test.qnt", "--main", "taskFactReconciliationNegativeTest"],
  canonicalCollectedTestSeeds.taskFactReconciliation.negative
)
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
// #65 choice, current terminal-choice cancellation, claim-disposition, and
// independent-task sentinels
// together. Its production-backed MBT and sampled run stay canonical. ADR 0010
// permits the following smaller projections of the same accepted chronology
// to own exhaustive proof without becoming another runtime behavior source.
// The active-work entry below is the #218/#281 proof slice: it keeps Running
// establishment distinct from a tracker/timer refresh offer and checks source
// provenance plus the healthy/unreadable observation obligations.
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
    main: "historicalTaskFactStopRecoveryProof",
    testMain: "historicalTaskFactStopRecoveryProofTest",
    negativeTestMain: "historicalTaskFactStopRecoveryProofNegativeTest",
    title: "historical task-fact Stop recovery proof",
    maxSteps: "22",
    seed: "6502",
    invariants: [
      "stopCallsFollowExactDurableIntents",
      "historicalExecutingRequiresAcceptedCommandReport",
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
  },
  {
    main: "taskFactActiveRefreshProof",
    testMain: "taskFactActiveRefreshProofTest",
    negativeTestMain: "taskFactActiveRefreshProofNegativeTest",
    title: "task-fact active-work refresh proof",
    maxSteps: "8",
    seed: "6504",
    invariants: [
      "activeRefreshUnreadableAuthorizesNoExecutorAction",
      "healthyActiveRefreshAuthorizesNoExecutorAction",
      "runningEstablishmentRetainsAuthority",
      "activeRefreshOfferRequiresRunningEstablished",
      "activeRefreshSourceIsTrackerOrTimer",
      "ordinaryUnreadableStillRequestsSafeSuspension",
      "positionReleasesOnlyOnExactSafeEvidence",
      "independentTaskRemainsEligible",
      "activeRefreshProofTypeOk"
    ],
    witnesses: [
      "activeRefreshOfferedReached",
      "activeRefreshRunningEstablishedReached",
      "activeRefreshTrackerOfferedReached",
      "activeRefreshTimerOfferedReached",
      "activeRefreshHealthyReached",
      "activeRefreshUnreadableReached",
      "lifecycleClosedReached",
      "ordinaryUnreadableReached",
      "safelySuspendedReached",
      "lifecycleReopenedReached",
      "independentTaskSelectedReached"
    ]
  }
]

await run("task-fact proof projection typecheck", ["typecheck", "specs/taskFactReconciliation_proof.qnt"])
for (const proof of taskFactProofs) {
  await runCollectedTest(
    `${proof.title} deterministic tests`,
    ["specs/taskFactReconciliation_proof_test.qnt", "--main", proof.testMain],
    `${proof.seed}01`
  )
  await runCollectedTest(
    `${proof.title} negative mutation profile`,
    ["specs/taskFactReconciliation_proof_negative_test.qnt", "--main", proof.negativeTestMain],
    `${proof.seed}02`
  )
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
  // TLC enumerates the complete finite projection graph with no depth token.
  // Generated-state totals and diameter are tool/version/platform output, not
  // a proof contract, so this commentary intentionally carries no fixed counts.
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
await runCollectedTest(
  "Git reconciliation deterministic tests",
  ["specs/gitReconciliation_test.qnt", "--main", "gitReconciliationTest"],
  canonicalCollectedTestSeeds.gitReconciliation.deterministic
)
await runCollectedTest(
  "Git reconciliation negative mutation profile",
  ["specs/gitReconciliation_negative_test.qnt", "--main", "gitReconciliationNegativeTest"],
  canonicalCollectedTestSeeds.gitReconciliation.negative
)
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
await runCollectedTest(
  "accepted-result integration deterministic tests",
  ["specs/acceptedResultIntegration_test.qnt", "--main", "acceptedResultIntegrationTest"],
  canonicalCollectedTestSeeds.acceptedResultIntegration.deterministic
)
await runCollectedTest(
  "accepted-result integration negative mutation profile",
  ["specs/acceptedResultIntegration_negative_test.qnt", "--main", "acceptedResultIntegrationNegativeTest"],
  canonicalCollectedTestSeeds.acceptedResultIntegration.negative
)
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
await runCollectedTest(
  "accepted-result integration quarantine proof deterministic tests",
  ["specs/acceptedResultIntegration_proof_test.qnt", "--main", "acceptedResultIntegrationQuarantineProofTest"],
  canonicalCollectedTestSeeds.acceptedResultIntegrationQuarantineProof.deterministic
)
await runCollectedTest(
  "accepted-result integration quarantine proof negative mutation profile",
  [
    "specs/acceptedResultIntegration_proof_negative_test.qnt",
    "--main",
    "acceptedResultIntegrationQuarantineProofNegativeTest"
  ],
  canonicalCollectedTestSeeds.acceptedResultIntegrationQuarantineProof.negative
)
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
await runCollectedTest(
  "integration finality deterministic tests",
  ["specs/integrationFinality_test.qnt", "--main", "integrationFinalityTest"],
  canonicalCollectedTestSeeds.integrationFinality.deterministic
)
await runCollectedTest(
  "integration finality negative mutation profile",
  ["specs/integrationFinality_negative_test.qnt", "--main", "integrationFinalityNegativeTest"],
  canonicalCollectedTestSeeds.integrationFinality.negative
)
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
process.stdout.write(`\nCompleted Quint stage timings: ${JSON.stringify(completedStageTimings)}\n`)
process.stdout.write(
  `\nComplete Quint model gate: ${(elapsedMilliseconds / 1000).toFixed(
    2
  )}s (budget ${quintGateRegressionBudgetMilliseconds / 1000}s)\n`
)
if (elapsedMilliseconds > quintGateRegressionBudgetMilliseconds) {
  throw new Error("Quint models exceeded their regression budget")
}
