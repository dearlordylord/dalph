/**
 * The governed observations and commands for the application Exit model.
 *
 * Keeping these lists outside the gate makes a rename fail checking, witness
 * collection, and mutation analysis together. Proof projections are explicit:
 * the canonical product model stays the production-backed behavior source.
 */
export const applicationExitInvariantRegistry = Object.freeze({
  canonical: Object.freeze([
    "cutoffClosesAtMostOncePerApplicationIncarnation",
    "preparingAdmissionNeverSurvivesTheCutoff",
    "forwardOwnerRegistrationRequiresServing",
    "joinedRequestNeverResetsTheDrain",
    "joinedRequestsReceiveOneSharedResult",
    "onlyEnumeratedQuickDrainActionsBeginAfterCutoff",
    "recoverableAmbiguityRequiresAcknowledgedExactIntent",
    "knownBoundaryObservationRequiresItsAcknowledgedIntent",
    "exactSafeOrTerminalEvidenceControlsPositionRelease",
    "fastSuspensionRequiresAcknowledgedCommandIntent",
    "successfulExitRequiresRecoverableBoundary",
    "conclusiveFailureWaitsForUsefulQuickWork",
    "fifthTickAtomicallyForcesTimedOutTermination",
    "failureAndTimeoutRequestNonzeroForcedTermination",
    "successReportsBeforeGracefulProcessEnd",
    "unexpectedDeathNeverReportsGracefulSuccess",
    "runTerminationRequiresPreCutoffAuthorization",
    "applicationLifecycleNeverEntersWorkflowHistory",
    "exitNeverDisposesDurableWorkflowResources",
    "restartRestoresNoApplicationLifecycleState",
    "modelStateIsFiniteAndBounded"
  ]),
  admissionProof: Object.freeze([
    "cutoffClosesAtMostOnce",
    "preparingNeverSurvivesCutoff",
    "registrationRequiresServing",
    "joinedRequestDoesNotResetTimer",
    "joinedRequestsShareResult",
    "admissionProofTypeOk"
  ]),
  ownerProof: Object.freeze([
    "onlyEnumeratedQuickDrainActionsBegin",
    "recoverableAmbiguityRequiresAcknowledgedIntent",
    "knownObservationRequiresAcknowledgedIntent",
    "runTerminationRequiresPreCutoffAuthorization",
    "applicationLifecycleNeverEntersWorkflowHistory",
    "exitNeverDisposesDurableWorkflowResources",
    "ownerProofTypeOk"
  ]),
  executorProof: Object.freeze([
    "exactSafeOrTerminalEvidenceControlsPositionRelease",
    "fastSuspensionRequiresAcknowledgedIntent",
    "executorProofTypeOk"
  ]),
  resultProof: Object.freeze([
    "successfulExitRequiresRecoverableBoundary",
    "conclusiveFailureWaitsForUsefulQuickWork",
    "fifthTickAtomicallyForcesTimedOutTermination",
    "failureAndTimeoutRequestNonzeroForcedTermination",
    "successReportsBeforeGracefulProcessEnd",
    "unexpectedDeathNeverReportsGracefulSuccess",
    "restartRestoresNoApplicationLifecycleState",
    "applicationLifecycleNeverEntersWorkflowHistory",
    "exitNeverDisposesDurableWorkflowResources",
    "resultProofTypeOk"
  ])
})

export const applicationExitWitnessRegistry = Object.freeze({
  canonical: Object.freeze([
    "servingReached",
    "drainingReached",
    "successReportedReached",
    "failureReportedReached",
    "gracefulProcessGoneReached",
    "failedProcessGoneReached",
    "timedOutProcessGoneReached",
    "unexpectedProcessGoneReached",
    "restartedServingReached",
    "ownerPreparingReached",
    "interruptibleOwnerRegisteredReached",
    "atomicOwnerRegisteredReached",
    "terminationAppendOwnerRegisteredReached",
    "joinedRequestReached",
    "recoverableAmbiguityReached",
    "executingAttemptReached",
    "suspensionIntentReached",
    "fastSuspensionCalledReached",
    "safelySuspendedReached",
    "terminalAttemptReached",
    "suspensionFailureReached",
    "producedWriteReached",
    "acknowledgedWriteReached",
    "failedWriteReached",
    "pausePreservedReached",
    "authorizedTerminationFinishedReached",
    "fourthTickReached"
  ]),
  admissionProof: Object.freeze([
    "servingReached",
    "drainingReached",
    "processGoneReached",
    "preparingOwnerReached",
    "registeredOwnerReached",
    "joinedRequestReached",
    "fourthTickReached",
    "fifthTickReached"
  ]),
  ownerProof: Object.freeze([
    "servingReached",
    "drainingReached",
    "interruptibleOwnerReached",
    "atomicOwnerReached",
    "authorizedTerminationOwnerReached",
    "knownObservationReached",
    "recoverableAmbiguityReached",
    "authorizedTerminationFinishedReached"
  ]),
  executorProof: Object.freeze([
    "servingReached",
    "drainingReached",
    "executingReached",
    "suspensionIntentReached",
    "fastSuspensionCalledReached",
    "safelySuspendedReached",
    "terminalReached",
    "suspensionFailureReached"
  ]),
  resultProof: Object.freeze([
    "servingReached",
    "drainingReached",
    "successReportedReached",
    "failureReportedReached",
    "gracefulProcessGoneReached",
    "failedProcessGoneReached",
    "timedOutProcessGoneReached",
    "unexpectedProcessGoneReached",
    "restartedServingReached",
    "busyAttemptReached",
    "pendingWriteReached",
    "failureDiagnosticReached",
    "fourthTickReached"
  ])
})

const canonicalCheck = Object.freeze({
  file: "specs/applicationExit.qnt",
  main: "applicationExit",
  testFile: "specs/applicationExit_test.qnt",
  testMain: "applicationExitTest",
  negativeTestFile: "specs/applicationExit_negative_test.qnt",
  negativeTestMain: "applicationExitNegativeTest",
  maxSteps: "32",
  maxSamples: "10000",
  seed: "203",
  invariants: applicationExitInvariantRegistry.canonical,
  witnesses: applicationExitWitnessRegistry.canonical
})

export const applicationExitCheckRegistry = Object.freeze({
  canonical: canonicalCheck,
  proofFile: "specs/applicationExit_proof.qnt",
  proofTestFile: "specs/applicationExit_proof_test.qnt",
  proofNegativeTestFile: "specs/applicationExit_proof_negative_test.qnt",
  proofs: Object.freeze([
    Object.freeze({
      main: "applicationExitAdmissionProof",
      testMain: "applicationExitAdmissionProofTest",
      negativeTestMain: "applicationExitAdmissionProofNegativeTest",
      title: "application Exit admission proof",
      maxSteps: "16",
      maxSamples: "5000",
      seed: "2031",
      invariants: applicationExitInvariantRegistry.admissionProof,
      witnesses: applicationExitWitnessRegistry.admissionProof
    }),
    Object.freeze({
      main: "applicationExitOwnerProof",
      testMain: "applicationExitOwnerProofTest",
      negativeTestMain: "applicationExitOwnerProofNegativeTest",
      title: "application Exit owner proof",
      maxSteps: "12",
      maxSamples: "5000",
      seed: "2032",
      invariants: applicationExitInvariantRegistry.ownerProof,
      witnesses: applicationExitWitnessRegistry.ownerProof
    }),
    Object.freeze({
      main: "applicationExitExecutorProof",
      testMain: "applicationExitExecutorProofTest",
      negativeTestMain: "applicationExitExecutorProofNegativeTest",
      title: "application Exit executor proof",
      maxSteps: "10",
      maxSamples: "5000",
      seed: "2033",
      invariants: applicationExitInvariantRegistry.executorProof,
      witnesses: applicationExitWitnessRegistry.executorProof
    }),
    Object.freeze({
      main: "applicationExitResultProof",
      testMain: "applicationExitResultProofTest",
      negativeTestMain: "applicationExitResultProofNegativeTest",
      title: "application Exit result proof",
      maxSteps: "24",
      maxSamples: "5000",
      seed: "2034",
      invariants: applicationExitInvariantRegistry.resultProof,
      witnesses: applicationExitWitnessRegistry.resultProof
    })
  ])
})

/** Mutation analysis intentionally targets the canonical behavior model. */
export const applicationExitMutationRegistry = Object.freeze({
  name: "applicationExit",
  file: canonicalCheck.file,
  invariants: canonicalCheck.invariants,
  witnesses: canonicalCheck.witnesses,
  negativeTestFile: canonicalCheck.negativeTestFile,
  negativeTestMain: canonicalCheck.negativeTestMain
})
