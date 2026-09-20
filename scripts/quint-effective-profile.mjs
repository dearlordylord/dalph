import { applicationExitCheckRegistry } from "./application-exit-model-registry.mjs"
import {
  acceptedResultIntegrationObligations,
  acceptedResultIntegrationQuarantineProofObligations,
  freshTaskAdmissionObligations,
  freshTaskAdmissionProofObligations,
  plannedAttemptExecutorProofObligations,
  runCancellationObligations,
  runActivationObligations,
  taskFactReconciliationObligations
} from "./quint-model-obligations.mjs"
import { quintGateCommandManifest } from "./quint-gate-command-manifest.mjs"
import {
  assertQuintGateCommandContract,
  quintGateExpectedCommandCounts,
  withQuintGateSampleThreadContract
} from "./quint-gate-command-contract.mjs"
import { apalacheVersion } from "./quint-temporal-gate.mjs"
import { quintGateFamilyConcurrency } from "./quint-gate-concurrency.mjs"
import { plannedAttemptExecutorInitialFamily } from "./quint-gate-production-plan.mjs"
import { quintCommandKindForArgs } from "./quint-gate-timing.mjs"
import { quintWitnessesFromCommandArgs } from "./quint-witness-coverage.mjs"
import {
  quintGateRegressionBudgetMilliseconds,
  quintLocalSafetyTimeoutMilliseconds,
  quintLocalRegressionBudgetMilliseconds,
  quintGateSafetyTimeoutMilliseconds,
  quintGateTerminationGraceMilliseconds,
  quintGateProcessGroupAbsenceTimeoutMilliseconds
} from "./quint-gate-policy.mjs"

const freezeTree = (value) => {
  if (value !== null && typeof value === "object") {
    for (const child of Object.values(value)) freezeTree(child)
    Object.freeze(value)
  }
  return value
}

/** Materialize all effective CLI tokens and verdict obligations before launching anything. */
export const createQuintEffectiveProfile = ({ purpose = "hosted" } = {}) => {
  if (purpose !== "hosted" && purpose !== "local-guarded") {
    throw new Error("Quint effective profile requires a supported execution purpose")
  }
  const commands = []
  const steps = []
  const reserveCommand = (name, args, options = {}) => {
    const position = commands.length
    const kind = quintCommandKindForArgs(args)
    if (position >= quintGateCommandManifest.length) {
      throw new Error(`Quint gate command manifest has no entry at ${position}`)
    }
    const expected = quintGateCommandManifest[position]
    if (expected.kind !== kind || expected.name !== name) {
      throw new Error(`Quint gate command manifest mismatch at ${position}: received ${kind} ${name}`)
    }
    let executionArgs = [...args]
    if (kind === "test") executionArgs.push("--max-samples", "1", "--seed", String(153_000 + position))
    if (kind === "sampled-run") {
      if (!executionArgs.includes("--seed")) executionArgs.push("--seed", String(154_000 + position))
      executionArgs = withQuintGateSampleThreadContract(executionArgs)
    }
    const { artifactPreparedAfter = false, temporalVerdict, ...processOptions } = options
    const command = {
      position,
      kind,
      name,
      args: executionArgs,
      options: { acceptedExitCodes: [0], captureOutput: true, ...processOptions },
      verdict: {
        acceptedExitCodes: processOptions.acceptedExitCodes ?? [0],
        witnesses: quintWitnessesFromCommandArgs(executionArgs),
        temporal: temporalVerdict ?? null,
        collectedReplacementTest: name === "task-fact reconciliation deterministic tests",
        artifactPreparedAfter
      }
    }
    commands.push(command)
    return command
  }
  const run = (name, args, options) => {
    const command = reserveCommand(name, args, options)
    steps.push({ kind: "commands", positions: [command.position], concurrency: 1, serializedPrefix: 0 })
  }
  const runFamily = (family, { concurrency = quintGateFamilyConcurrency, serializedPrefix = 0 } = {}) => {
    const reserved = family.map(({ args, name, options }) => reserveCommand(name, args, options))
    steps.push({ kind: "commands", positions: reserved.map(({ position }) => position), concurrency, serializedPrefix })
  }
  run("planned-attempt executor model typecheck", ["typecheck", "specs/plannedAttemptExecutor.qnt"])
  runFamily(plannedAttemptExecutorInitialFamily.commands, plannedAttemptExecutorInitialFamily)
  steps.push({ kind: "evaluator-provenance" })
  run(
    "planned-attempt executor TLC artifact preparation",
    [
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
    ],
    { artifactPreparedAfter: true }
  )
  run(
    "planned-attempt executor temporal releasableEvidenceEventuallyReleasesPosition (TLC)",
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
      "releasableEvidenceEventuallyReleasesPosition",
      "--verbosity",
      "1"
    ],
    { temporalVerdict: "clean" }
  )
  run(
    "planned-attempt executor temporal mutant releasableEvidenceNeverReleasesPosition (TLC)",
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
      "releasableEvidenceNeverReleasesPosition",
      "--verbosity",
      "1"
    ],
    { acceptedExitCodes: [1], temporalVerdict: "violation" }
  )

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

  run("planned-attempt executor proof projection typecheck", ["typecheck", "specs/plannedAttemptExecutor_proof.qnt"])
  for (const proof of plannedAttemptExecutorProofs) {
    // TLC enumerates each complete finite projection graph without imposing the
    // sampled runner's depth bound; sampled exploration remains a separate seeded check.
    runFamily([
      {
        name: `${proof.title} deterministic tests`,
        args: ["test", "specs/plannedAttemptExecutor_proof_test.qnt", "--main", proof.testMain]
      },
      {
        name: `${proof.title} negative mutation profile`,
        args: ["test", "specs/plannedAttemptExecutor_proof_negative_test.qnt", "--main", proof.negativeTestMain]
      },
      {
        name: `${proof.title} sampled model`,
        args: [
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
        ]
      },
      {
        name: `${proof.title} exhaustive model`,
        args: [
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
        ]
      }
    ])
  }

  const applicationExitCheck = applicationExitCheckRegistry.canonical

  run("application Exit model typecheck", ["typecheck", applicationExitCheck.file])
  runFamily([
    {
      name: "application Exit deterministic tests",
      args: ["test", applicationExitCheck.testFile, "--main", applicationExitCheck.testMain]
    },
    {
      name: "application Exit negative mutation profile",
      args: ["test", applicationExitCheck.negativeTestFile, "--main", applicationExitCheck.negativeTestMain]
    },
    {
      name: "application Exit sampled model",
      args: [
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
      ]
    }
  ])

  // The canonical state product deliberately keeps the two owners, two executor
  // attempts, five ticks, drain resources, process endings, and restart in one
  // production-backed model. ADR 0010 permits these smaller acyclic projections
  // to own complete enumeration while the canonical model retains behavior.
  run("application Exit proof projection typecheck", ["typecheck", applicationExitCheckRegistry.proofFile])
  for (const proof of applicationExitCheckRegistry.proofs) {
    // Each finite projection graph is completely enumerated without a depth
    // token. A future diameter increase therefore remains visible to the gate.
    runFamily([
      {
        name: `${proof.title} deterministic tests`,
        args: ["test", applicationExitCheckRegistry.proofTestFile, "--main", proof.testMain]
      },
      {
        name: `${proof.title} negative mutation profile`,
        args: ["test", applicationExitCheckRegistry.proofNegativeTestFile, "--main", proof.negativeTestMain]
      },
      {
        name: `${proof.title} sampled model`,
        args: [
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
        ]
      },
      {
        name: `${proof.title} exhaustive model`,
        args: [
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
        ]
      }
    ])
  }

  const controlDirectionApplicationInvariants = [
    "appliedDirectionIsOperatorInitiated",
    "applicationClaimsNoLaterEffects",
    "rejectedTaskControlPreservesPauseState",
    "typeOk"
  ]

  run("control-direction application model typecheck", ["typecheck", "specs/controlDirectionApplication.qnt"])
  // TLC checks the complete state graph: 476 generated / 175 distinct states,
  // depth 10, ~0.7s (Quint 0.32.0, linux-aarch64). The graph is finite because
  // `appliedCount` saturates in the spec; unbounded it diverged past 36M states.
  // No --max-steps: a future regression shows as a diameter change, not truncation.
  runFamily([
    {
      name: "control-direction application deterministic tests",
      args: ["test", "specs/controlDirectionApplication_test.qnt", "--main", "controlDirectionApplicationTest"]
    },
    {
      name: "control-direction application negative mutation profile",
      args: [
        "test",
        "specs/controlDirectionApplication_negative_test.qnt",
        "--main",
        "controlDirectionApplicationNegativeTest"
      ]
    },
    {
      name: "control-direction application sampled model",
      args: [
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
      ]
    },
    {
      name: "control-direction application exhaustive model",
      args: [
        "verify",
        "specs/controlDirectionApplication.qnt",
        "--backend",
        "tlc",
        "--invariants",
        ...controlDirectionApplicationInvariants,
        "--verbosity",
        "1"
      ]
    }
  ])

  const runActivationInvariants = runActivationObligations.invariants
  const runActivationWitnesses = runActivationObligations.witnesses

  run("Run activation model typecheck", ["typecheck", "specs/runActivation.qnt"])
  // TLC checks the complete finite state graph without a depth token. The model
  // bounds process loss and activation cycles explicitly, so a future diameter
  // increase remains visible instead of being truncated by the gate.
  runFamily([
    {
      name: "Run activation deterministic tests",
      args: ["test", "specs/runActivation_test.qnt", "--main", "runActivationTest"]
    },
    {
      name: "Run activation negative mutation profile",
      args: ["test", "specs/runActivation_negative_test.qnt", "--main", "runActivationNegativeTest"]
    },
    {
      name: "Run activation sampled model",
      args: [
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
      ]
    },
    {
      name: "Run activation exhaustive model",
      args: [
        "verify",
        "specs/runActivation.qnt",
        "--backend",
        "tlc",
        "--invariants",
        ...runActivationInvariants,
        "--verbosity",
        "1"
      ]
    }
  ])

  const freshTaskAdmissionInvariants = freshTaskAdmissionObligations.invariants
  const freshTaskAdmissionWitnesses = freshTaskAdmissionObligations.witnesses

  run("fresh-task admission model typecheck", ["typecheck", "specs/freshTaskAdmission.qnt"])
  runFamily([
    {
      name: "fresh-task admission deterministic tests",
      args: ["test", "specs/freshTaskAdmission_test.qnt", "--main", "freshTaskAdmissionTest"]
    },
    {
      name: "fresh-task admission negative mutation profile",
      args: ["test", "specs/freshTaskAdmission_negative_test.qnt", "--main", "freshTaskAdmissionNegativeTest"]
    },
    {
      name: "fresh-task admission sampled model",
      args: [
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
      ]
    }
  ])

  run("fresh-task admission proof projection typecheck", ["typecheck", "specs/freshTaskAdmission_proof.qnt"])
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
    // TLC enumerates each complete finite projection graph without a depth
    // token; the canonical five-task model retains the richer sampled behavior.
    runFamily([
      {
        name: `${proof.title} deterministic tests`,
        args: ["test", "specs/freshTaskAdmission_proof_test.qnt", "--main", proof.testMain]
      },
      {
        name: `${proof.title} negative mutation profile`,
        args: ["test", "specs/freshTaskAdmission_proof_negative_test.qnt", "--main", proof.negativeTestMain]
      },
      {
        name: `${proof.title} sampled model`,
        args: [
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
        ]
      },
      {
        name: `${proof.title} exhaustive model`,
        args: [
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
        ]
      }
    ])
  }

  const runCancellationInvariants = runCancellationObligations.invariants
  const runCancellationWitnesses = runCancellationObligations.witnesses

  run("Run cancellation model typecheck", ["typecheck", "specs/runCancellation.qnt"])
  // TLC enumerates this finite cancellation boundary without a depth token;
  // every counter is explicitly bounded in the model so an accidental new
  // retry cycle changes the complete state graph rather than being truncated.
  runFamily([
    {
      name: "Run cancellation deterministic tests",
      args: ["test", "specs/runCancellation_test.qnt", "--main", "runCancellationTest"]
    },
    {
      name: "Run cancellation negative mutation profile",
      args: ["test", "specs/runCancellation_negative_test.qnt", "--main", "runCancellationNegativeTest"]
    },
    {
      name: "Run cancellation sampled model",
      args: [
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
      ]
    },
    {
      name: "Run cancellation exhaustive model",
      args: [
        "verify",
        "specs/runCancellation.qnt",
        "--backend",
        "tlc",
        "--invariants",
        ...runCancellationInvariants,
        "--verbosity",
        "1"
      ]
    }
  ])

  const taskFactReconciliationInvariants = taskFactReconciliationObligations.invariants
  const taskFactReconciliationWitnesses = taskFactReconciliationObligations.witnesses

  run("task-fact reconciliation model typecheck", ["typecheck", "specs/taskFactReconciliation.qnt"])
  runFamily([
    {
      name: "task-fact reconciliation deterministic tests",
      args: ["test", "specs/taskFactReconciliation_test.qnt", "--main", "taskFactReconciliationTest"]
    },
    {
      name: "task-fact reconciliation negative mutation profile",
      args: ["test", "specs/taskFactReconciliation_negative_test.qnt", "--main", "taskFactReconciliationNegativeTest"]
    },
    {
      name: "task-fact reconciliation sampled model",
      args: [
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
      ]
    }
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

  run("task-fact proof projection typecheck", ["typecheck", "specs/taskFactReconciliation_proof.qnt"])
  for (const proof of taskFactProofs) {
    // TLC enumerates the complete finite projection graph with no depth token.
    runFamily([
      {
        name: `${proof.title} deterministic tests`,
        args: ["test", "specs/taskFactReconciliation_proof_test.qnt", "--main", proof.testMain]
      },
      {
        name: `${proof.title} negative mutation profile`,
        args: ["test", "specs/taskFactReconciliation_proof_negative_test.qnt", "--main", proof.negativeTestMain]
      },
      {
        name: `${proof.title} sampled model`,
        args: [
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
        ]
      },
      {
        name: `${proof.title} exhaustive model`,
        args: [
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
        ]
      }
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

  run("Git reconciliation model typecheck", ["typecheck", "specs/gitReconciliation.qnt"])
  // TLC checks the complete state graph: 101 generated / 44 distinct states,
  // depth 5, ~0.7s (Quint 0.32.0, linux-aarch64) — replacing a 7-step Apalache
  // BMC with exhaustive checking. No --max-steps: TLC reports the diameter, so
  // "is the bound binding" stops being a separate investigation.
  runFamily([
    {
      name: "Git reconciliation deterministic tests",
      args: ["test", "specs/gitReconciliation_test.qnt", "--main", "gitReconciliationTest"]
    },
    {
      name: "Git reconciliation negative mutation profile",
      args: ["test", "specs/gitReconciliation_negative_test.qnt", "--main", "gitReconciliationNegativeTest"]
    },
    {
      name: "Git reconciliation sampled model",
      args: [
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
      ]
    },
    {
      name: "Git reconciliation exhaustive model",
      args: [
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
      ]
    }
  ])

  const acceptedResultIntegrationInvariants = acceptedResultIntegrationObligations.invariants
  const acceptedResultIntegrationWitnesses = acceptedResultIntegrationObligations.witnesses
  const acceptedResultIntegrationQuarantineProofInvariants =
    acceptedResultIntegrationQuarantineProofObligations.invariants
  const acceptedResultIntegrationQuarantineProofWitnesses =
    acceptedResultIntegrationQuarantineProofObligations.witnesses

  run("accepted-result integration model typecheck", ["typecheck", "specs/acceptedResultIntegration.qnt"])
  runFamily([
    {
      name: "accepted-result integration deterministic tests",
      args: ["test", "specs/acceptedResultIntegration_test.qnt", "--main", "acceptedResultIntegrationTest"]
    },
    {
      name: "accepted-result integration negative mutation profile",
      args: [
        "test",
        "specs/acceptedResultIntegration_negative_test.qnt",
        "--main",
        "acceptedResultIntegrationNegativeTest"
      ]
    },
    {
      name: "accepted-result integration sampled model",
      args: [
        "run",
        "specs/acceptedResultIntegration.qnt",
        "--invariants",
        ...acceptedResultIntegrationInvariants,
        "--witnesses",
        ...acceptedResultIntegrationWitnesses,
        "--step",
        "acceptedResultIntegrationSampleStep",
        "--max-steps",
        "35",
        "--max-samples",
        "10000",
        "--seed",
        "270",
        "--verbosity",
        "1"
      ]
    }
  ])
  // The canonical model retains the full accepted-result vocabulary, collected
  // scenarios, and sampled obligations. Its issue #68 quarantine product is
  // exhaustively enumerated by the subject-scoped projection below, as allowed
  // by ADR 0010.
  run("accepted-result integration quarantine proof typecheck", [
    "typecheck",
    "specs/acceptedResultIntegration_proof.qnt"
  ])
  // TLC checks the complete finite projection graph. No --max-steps is used:
  // future growth shows up as a diameter change rather than silent truncation.
  runFamily([
    {
      name: "accepted-result integration quarantine proof deterministic tests",
      args: [
        "test",
        "specs/acceptedResultIntegration_proof_test.qnt",
        "--main",
        "acceptedResultIntegrationQuarantineProofTest"
      ]
    },
    {
      name: "accepted-result integration quarantine proof negative mutation profile",
      args: [
        "test",
        "specs/acceptedResultIntegration_proof_negative_test.qnt",
        "--main",
        "acceptedResultIntegrationQuarantineProofNegativeTest"
      ]
    },
    {
      name: "accepted-result integration quarantine proof sampled model",
      args: [
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
      ]
    },
    {
      name: "accepted-result integration quarantine proof exhaustive model",
      args: [
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
      ]
    }
  ])

  const integrationFinalityInvariants = [
    "exactProofAndBinding",
    "completionClaimRequiresExactPromotionProof",
    "completionProofCarriesAcceptedEvidenceAndNoReturnedRefs",
    "completionClaimRequiresRemotePublicationProof",
    "publicationProofRetainedAcrossContradiction",
    "publicationContradictionBlocksUnsentFinality",
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
    "completionRequestsAreBounded",
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
    "runTerminationRequiresWholeRunSettlement",
    "dependantReleaseBoundaryRemainsExternal"
  ]

  run("integration finality model typecheck", ["typecheck", "specs/integrationFinality.qnt"])
  runFamily([
    {
      name: "integration finality deterministic tests",
      args: ["test", "specs/integrationFinality_test.qnt", "--main", "integrationFinalityTest"]
    },
    {
      name: "integration finality negative mutation profile",
      args: ["test", "specs/integrationFinality_negative_test.qnt", "--main", "integrationFinalityNegativeTest"]
    },
    {
      name: "integration finality sampled model",
      args: [
        "run",
        "specs/integrationFinality.qnt",
        "--invariants",
        ...integrationFinalityInvariants,
        "--witnesses",
        "promotedProofReached",
        "publicationProofReached",
        "publicationContradictionReached",
        "publicationPauseReached",
        "publicationRestartReached",
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
      ]
    },
    {
      name: "integration finality exhaustive model",
      args: [
        "verify",
        "specs/integrationFinality.qnt",
        "--backend",
        "tlc",
        "--invariants",
        ...integrationFinalityInvariants,
        "--verbosity",
        "1"
      ]
    }
  ])
  assertQuintGateCommandContract({ manifest: commands, executed: quintGateExpectedCommandCounts })
  return freezeTree({
    version: 1,
    commands,
    steps,
    execution: {
      executable: "identified-node",
      entryPoint: "@informalsystems/quint/dist/src/cli.js",
      captureOutput: true,
      forwardOutput: false,
      relayParentSignals: true,
      abortSignal: "family-shared-fail-fast-and-owned-server-lifetime",
      serverEndpoint: "invocation-owned-local-or-quint-hosted-default",
      evaluatorProvenanceAfterPosition: 3
    },
    policy: {
      regressionBudgetMilliseconds:
        purpose === "local-guarded" ? quintLocalRegressionBudgetMilliseconds : quintGateRegressionBudgetMilliseconds,
      safetyTimeoutMilliseconds:
        purpose === "local-guarded" ? quintLocalSafetyTimeoutMilliseconds : quintGateSafetyTimeoutMilliseconds,
      terminationGraceMilliseconds: quintGateTerminationGraceMilliseconds,
      processGroupAbsenceTimeoutMilliseconds: quintGateProcessGroupAbsenceTimeoutMilliseconds,
      apalacheVersion
    }
  })
}

/** Reject partial or substituted execution plans, independently of saved success evidence. */
export const assertQuintEffectiveProfile = (profile, options = {}) => {
  assertQuintGateCommandContract({ manifest: profile.commands, executed: quintGateExpectedCommandCounts })
  if (JSON.stringify(profile) !== JSON.stringify(createQuintEffectiveProfile(options))) {
    throw new Error("Quint effective profile differs from the complete supported profile")
  }
}
